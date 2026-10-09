// スプレッドシート（Google Drive）をデータベースとして読み書きする層。
// 書き込みは「その行を読み直して、変えた項目だけ上書き」にして、同時編集で他の人の変更を消さないようにする。
// コメントと作業時間は、別のタブに1行ずつ追記するだけにして、同時に書いてもぶつからないようにする。
import { CONFIG } from './config.js';
import { getToken as defaultGetToken } from './auth.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const COLS = ['id', 'title', 'body', 'assignees', 'status', 'assignedOn', 'due', 'completedOn', 'size', 'blockedBy', 'source', 'slackUrl', 'updatedAt', 'updatedBy', 'links', 'repeat', 'seriesId'];
export const STATUSES = ['未着手', '進行中', '完了'];
const COMMENTS_TAB = 'comments';
const TIMELOG_TAB = 'timelog';
const SETTINGS_TAB = '設定';
export const DEFAULT_SIZE_MINUTES = { S: 60, M: 240, L: 480, '': 120 };

export class AccessError extends Error {}

const pad = (n) => String(n).padStart(2, '0');

/** 日付らしい文字を YYYY-MM-DD にそろえる（人が手で入れた 2026/10/7 なども読めるように） */
export function normDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = /^(\d{1,2})[/.](\d{1,2})$/.exec(s);
  if (m) return `${new Date().getFullYear()}-${pad(m[1])}-${pad(m[2])}`;
  return null;
}

const splitList = (v) => String(v ?? '').split(/[、,，\n]+/).map((x) => x.trim()).filter(Boolean);

export function rowToTask(row, idx) {
  const g = (name) => (idx[name] == null ? '' : String(row[idx[name]] ?? '').trim());
  const raw = (name) => (idx[name] == null ? '' : String(row[idx[name]] ?? ''));
  const size = g('size').toUpperCase();
  return {
    id: g('id'),
    title: g('title'),
    body: raw('body'),
    assignees: splitList(g('assignees')),
    status: STATUSES.includes(g('status')) ? g('status') : '未着手',
    assignedOn: normDate(g('assignedOn')),
    due: normDate(g('due')),
    completedOn: normDate(g('completedOn')),
    size: ['S', 'M', 'L'].includes(size) ? size : '',
    blockedBy: splitList(g('blockedBy')),
    source: g('source'),
    slackUrl: g('slackUrl'),
    updatedAt: g('updatedAt'),
    updatedBy: g('updatedBy'),
    links: raw('links').trim(),
    repeat: g('repeat'),
    seriesId: g('seriesId'),
  };
}

function taskToRow(t, headers) {
  const flat = { ...t, assignees: (t.assignees ?? []).join('、'), blockedBy: (t.blockedBy ?? []).join(',') };
  return headers.map((h) => (COLS.includes(h) ? String(flat[h] ?? '') : ''));
}

const colLetter = (n) => String.fromCharCode(64 + n); // 26列まで

export function rowToComment(r) {
  return { taskId: String(r[0] ?? '').trim(), at: String(r[1] ?? '').trim(), by: String(r[2] ?? '').trim(), text: String(r[3] ?? ''), source: String(r[4] ?? '').trim() };
}
export function rowToTime(r) {
  return { taskId: String(r[0] ?? '').trim(), date: normDate(r[1]), by: String(r[2] ?? '').trim(), minutes: Number(r[3]) || 0, note: String(r[4] ?? '') };
}

/** getToken を差し替えられるようにしてあるのは、テストで Google につながずに動かすため */
export function createSheetsStore({ getToken = defaultGetToken } = {}) {
  async function call(path, { method = 'GET', body, retry = true } = {}) {
    const res = await fetch(`${API}/${CONFIG.sheetId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await getToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && retry) {
      await getToken({ force: true });
      return call(path, { method, body, retry: false });
    }
    if (res.status === 403 || res.status === 404) {
      throw new AccessError('このスプレッドシートを開く権限がありません。管理者にスプレッドシートの共有を頼んでください。');
    }
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error?.message || `通信に失敗しました（${res.status}）`);
    }
    return res.json();
  }

  const range = (tab, a1) => encodeURIComponent(`${tab}!${a1}`);
  const get = (tab, a1) => call(`/values/${range(tab, a1)}?valueRenderOption=FORMATTED_VALUE`);

  async function readAll() {
    const j = await get(CONFIG.tasksTab, 'A1:Z');
    return parseTasks(j.values ?? []);
  }

  function parseTasks(rows) {
    const headers = (rows[0] ?? []).map((h) => String(h).trim());
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
    if (idx.id == null || idx.title == null) throw new Error('スプレッドシートの1行目に id と title の列が必要です');
    return { rows, headers, idx };
  }

  /** メンバー・コメント・作業時間のタブが無いだけなら、空として扱う */
  async function optional(tab, a1) {
    try {
      return (await get(tab, a1)).values ?? [];
    } catch (e) {
      if (e instanceof AccessError || /Unable to parse range|not found/i.test(e.message)) return [];
      throw e;
    }
  }

  return {
    async load() {
      const { rows, idx } = parseTasks((await get(CONFIG.tasksTab, 'A1:Z')).values ?? []);
      const [members, comments, times, cfg] = await Promise.all([
        optional(CONFIG.membersTab, 'A2:B'),
        optional(COMMENTS_TAB, 'A2:E'),
        optional(TIMELOG_TAB, 'A2:E'),
        optional(SETTINGS_TAB, 'B2:B5'),
      ]);
      // 設定タブの「重さごとの想定時間（分）」。読めない項目は初期値のまま
      const sizeMinutes = { ...DEFAULT_SIZE_MINUTES };
      ['S', 'M', 'L', ''].forEach((k, i) => { const v = Number(cfg[i]?.[0]); if (v > 0) sizeMinutes[k] = v; });
      return {
        sizeMinutes,
        tasks: rows.slice(1).map((r) => rowToTask(r, idx)).filter((t) => t.id && t.title),
        members: members.filter((r) => r[0]).map((r) => ({ name: String(r[0]).trim(), email: String(r[1] ?? '').trim().toLowerCase() })),
        comments: comments.map(rowToComment).filter((c) => c.taskId && c.text),
        times: times.map(rowToTime).filter((t) => t.taskId && t.minutes > 0),
      };
    },

    /** 1件の一部の項目だけ更新する。更新後のタスクを返す */
    async patch(id, fields, who) {
      return (await this.patchMany([id], fields, who))[0];
    },

    async patchMany(ids, fields, who) {
      const { rows, headers, idx } = await readAll();
      const now = new Date().toISOString();
      const data = [];
      const out = [];
      for (const id of ids) {
        const i = rows.findIndex((r, n) => n > 0 && String(r[idx.id] ?? '').trim() === id);
        if (i < 0) throw new Error('このタスクはスプレッドシートから無くなっています。画面を更新してください');
        const task = { ...rowToTask(rows[i], idx), ...fields, updatedAt: now, updatedBy: who };
        out.push(task);
        data.push({ range: `${CONFIG.tasksTab}!A${i + 1}:${colLetter(headers.length)}${i + 1}`, values: [taskToRow(task, headers)] });
      }
      await call('/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data } });
      return out;
    },

    /** unique: true のときは、同じ id が既にあれば何もしない（繰り返しの「次の回」を二重に作らないため）。作らなかったら null */
    async add(task, who, { unique = false } = {}) {
      const { rows, headers, idx } = await readAll();
      if (unique && rows.some((r, n) => n > 0 && String(r[idx.id] ?? '').trim() === task.id)) return null;
      const full = { ...task, updatedAt: new Date().toISOString(), updatedBy: who };
      await call(`/values/${range(CONFIG.tasksTab, 'A:A')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body: { values: [taskToRow(full, headers)] },
      });
      return full;
    },

    async addComment(taskId, text, who) {
      const c = { taskId, at: new Date().toISOString(), by: who, text, source: 'site' };
      await call(`/values/${range(COMMENTS_TAB, 'A:A')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body: { values: [[c.taskId, c.at, c.by, c.text, c.source]] },
      });
      return c;
    },

    async addTime(taskId, minutes, who, date) {
      const t = { taskId, date, by: who, minutes, note: '' };
      await call(`/values/${range(TIMELOG_TAB, 'A:A')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body: { values: [[t.taskId, t.date, t.by, t.minutes, t.note]] },
      });
      return t;
    },
  };
}
