// スプレッドシート（Google Drive）をデータベースとして読み書きする層。
// 書き込みは「その行を読み直して、変えた項目だけ上書き」にして、同時編集で他の人の変更を消さないようにする。
import { CONFIG } from './config.js';
import { getToken } from './auth.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const COLS = ['id', 'title', 'body', 'assignees', 'status', 'assignedOn', 'due', 'completedOn', 'size', 'blockedBy', 'source', 'slackUrl', 'updatedAt', 'updatedBy'];
export const STATUSES = ['未着手', '進行中', '完了'];

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
  const size = g('size').toUpperCase();
  return {
    id: g('id'),
    title: g('title'),
    body: idx.body == null ? '' : String(row[idx.body] ?? ''),
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
  };
}

function taskToRow(t, headers) {
  const flat = {
    ...t,
    assignees: t.assignees.join('、'),
    blockedBy: t.blockedBy.join(','),
  };
  return headers.map((h) => (COLS.includes(h) ? String(flat[h] ?? '') : ''));
}

const colLetter = (n) => String.fromCharCode(64 + n); // 26列まで

export function createSheetsStore() {
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

  async function readAll() {
    const j = await call(`/values/${range(CONFIG.tasksTab, 'A1:Z')}?valueRenderOption=FORMATTED_VALUE`);
    const rows = j.values ?? [];
    const headers = (rows[0] ?? []).map((h) => String(h).trim());
    const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
    if (idx.id == null || idx.title == null) throw new Error('スプレッドシートの1行目に id と title の列が必要です');
    return { rows, headers, idx };
  }

  async function readMembers() {
    try {
      const j = await call(`/values/${range(CONFIG.membersTab, 'A2:B')}?valueRenderOption=FORMATTED_VALUE`);
      return (j.values ?? []).filter((r) => r[0]).map((r) => ({ name: String(r[0]).trim(), email: String(r[1] ?? '').trim().toLowerCase() }));
    } catch (e) {
      if (e instanceof AccessError) return []; // members タブが無いだけのとき
      throw e;
    }
  }

  return {
    async load() {
      const { rows, idx } = await readAll();
      const tasks = rows.slice(1).map((r) => rowToTask(r, idx)).filter((t) => t.id && t.title);
      return { tasks, members: await readMembers() };
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

    async add(task, who) {
      const { headers } = await readAll();
      const full = { ...task, updatedAt: new Date().toISOString(), updatedBy: who };
      await call(`/values/${range(CONFIG.tasksTab, 'A:A')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body: { values: [taskToRow(full, headers)] },
      });
      return full;
    },
  };
}
