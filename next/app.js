import { CONFIG } from './config.js';
import { analyze, reaches, daysBetween } from './priority.js';
import { parseRepeat, describeRepeat, buildRepeat, nextDue, occurrenceId } from './repeat.js';
import { parseLinks, fmtMinutes } from './text.js';
import { createMockStore, MOCK_PROFILE } from './mock.js';
import * as auth from './auth.js';
import { createSheetsStore, AccessError, STATUSES, DEFAULT_SIZE_MINUTES } from './sheets.js';

const $ = (id) => document.getElementById(id);
const MOCK = new URLSearchParams(location.search).has('mock');
const SIZES = [['S', '〜1時間'], ['M', '半日'], ['L', '1日以上']];
const WEEK_CHARS = ['月', '火', '水', '木', '金', '土', '日'];
const CACHE_KEY = 'zp-board-cache-v1';
const DENSITY_KEY = 'zp-board-compact';

const state = {
  tasks: [], members: [], comments: [], times: [], sizeMinutes: { ...DEFAULT_SIZE_MINUTES },
  me: null, store: null,
  who: '', // '' は全員。担当者の名前を入れるとその人だけ
  q: '',
  open: { now: true, blocked: true, later: true, stale: false, done: false },
  loadedAt: 0, compact: false, firstLoad: true,
  failedSeries: new Set(),
};

// ---------- 小さな道具 ----------
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDate(d); };
const fmtDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return `${m}/${d}(${'日月火水木金土'[new Date(y, m - 1, d).getDay()]})`;
};
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // ユーザーが書いた文字は textContent で入れる（安全）
  return e;
}
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 保存できなくても動く */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 同上 */ } },
};
const who = () => state.me?.name ?? '';

let toastTimer = null;
/** actions: [{ label, fn }] */
function toast(text, { actions = [], error = false, ms = 6000 } = {}) {
  const t = $('toast');
  t.classList.toggle('error', error);
  $('toast-text').textContent = text;
  $('toast-actions').replaceChildren(...actions.map(({ label, fn }) => {
    const b = el('button', '', label);
    b.type = 'button';
    b.onclick = () => { hideToast(); fn(); };
    return b;
  }));
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
function hideToast() { $('toast').hidden = true; }

// ---------- 読み込み（端末に前回分を保存して、開いた瞬間に表示する） ----------
function saveCache() {
  if (MOCK || !state.me?.email) return;
  const { tasks, members, comments, times, sizeMinutes } = state;
  storage.set(CACHE_KEY, JSON.stringify({ email: state.me.email, savedAt: Date.now(), tasks, members, comments, times, sizeMinutes }));
}
function restoreCache() {
  if (MOCK) return;
  try {
    const c = JSON.parse(storage.get(CACHE_KEY) || 'null');
    if (!c || c.email !== state.me.email) return;
    Object.assign(state, { tasks: c.tasks, members: c.members, comments: c.comments, times: c.times, sizeMinutes: c.sizeMinutes, loadedAt: c.savedAt });
    resolveMe();
    render();
  } catch { /* 壊れていたら無視 */ }
}

async function load({ quiet = false } = {}) {
  try {
    const d = await state.store.load();
    Object.assign(state, { tasks: d.tasks, members: d.members, comments: d.comments ?? [], times: d.times ?? [], sizeMinutes: d.sizeMinutes ?? state.sizeMinutes });
    state.loadedAt = Date.now();
    $('banner').hidden = true;
    resolveMe();
    saveCache();
    render();
    ensureRecurring();
  } catch (e) {
    if (quiet) return;
    showBanner(state.tasks.length ? `最新の状態を読み込めませんでした（前回の表示です）: ${e.message}` : e.message);
  }
}
function showBanner(msg) { $('banner').textContent = msg; $('banner').hidden = false; }

/** ログインした人が、担当者の誰にあたるかをメンバー表から探す */
function resolveMe() {
  const email = state.me.email?.toLowerCase();
  const m = state.members.find((x) => x.email && x.email === email) ?? state.members.find((x) => x.name === state.me.name);
  state.me.assignee = m?.name ?? null;
  if (state.firstLoad) {
    state.who = state.me.assignee ?? '';
    state.firstLoad = false;
  }
}

// ---------- 繰り返しタスク ----------
const seriesOf = (t) => t.seriesId || t.id;

/** 完了した繰り返しタスクに「次の回」が無ければ作る（同じ回は同じ id になるので、二重には作られない） */
async function ensureRecurring() {
  const groups = new Map();
  for (const t of state.tasks) {
    if (!parseRepeat(t.repeat)) continue;
    const key = seriesOf(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  for (const [key, list] of groups) {
    if (state.failedSeries.has(key) || list.some((t) => t.status !== '完了')) continue;
    const latest = [...list].sort((a, b) => (b.due ?? b.assignedOn ?? '').localeCompare(a.due ?? a.assignedOn ?? '') || b.id.localeCompare(a.id))[0];
    const due = nextDue(latest.repeat, latest.due, today());
    if (!due) continue;
    const next = {
      id: occurrenceId(key, due), title: latest.title, body: latest.body, assignees: [...latest.assignees],
      status: '未着手', assignedOn: today(), due, completedOn: '', size: latest.size, blockedBy: [], source: 'repeat',
      slackUrl: '', links: latest.links, repeat: latest.repeat, seriesId: key,
    };
    try {
      const saved = await state.store.add(next, who(), { unique: true });
      if (saved) { state.tasks.push(saved); render(); }
      else if (!state.tasks.some((t) => t.id === next.id)) await load({ quiet: true }); // 他の人が先に作っていた
    } catch {
      state.failedSeries.add(key); // 失敗を繰り返さない（次に読み込み直すまで）
    }
  }
}

// ---------- 画面の組み立て ----------
function dueBadge(info) {
  const t = info.task;
  if (!t.due) return null;
  const left = daysBetween(today(), t.due);
  if (left < 0) return el('span', 'badge danger', `期限切れ ${-left}日`);
  if (left === 0) return el('span', 'badge warn', '今日まで');
  if (left === 1) return el('span', 'badge warn', '明日まで');
  if (left <= 3) return el('span', 'badge warn', `${fmtDate(t.due)} あと${left}日`);
  return el('span', 'badge', fmtDate(t.due));
}

function derived() {
  const comments = new Map();
  for (const c of state.comments) comments.set(c.taskId, (comments.get(c.taskId) ?? 0) + 1);
  const minutes = new Map();
  for (const x of state.times) minutes.set(x.taskId, (minutes.get(x.taskId) ?? 0) + x.minutes);
  return { comments, minutes };
}

function card(info, d, { done = false, big = false } = {}) {
  const t = info.task;
  const li = el(big ? 'div' : 'li', `card${info.ownLeft != null && info.ownLeft < 0 && !done ? ' overdue' : ''}${done ? ' done' : ''}`);
  if (big) li.className = 'focus-card';

  const check = el('button', 'check');
  check.type = 'button';
  check.setAttribute('aria-label', done ? `「${t.title}」を未完了に戻す` : `「${t.title}」を完了にする`);
  check.append(el('span', '', '✓'));
  check.onclick = () => (done ? reopen(t) : complete(t));

  const main = el('button', 'main');
  main.type = 'button';
  main.onclick = () => openEditor(t);
  if (big) main.append(el('span', 'label', '次にやること'));
  main.append(el('div', 'title', t.title));

  const meta = el('div', 'meta');
  meta.append(el('span', 'who', t.assignees.join('・') || '担当者なし'));
  if (t.status === '進行中') meta.append(el('span', 'badge doing', '進行中'));
  if (!done) { const b = dueBadge(info); if (b) meta.append(b); }
  if (done && t.completedOn) meta.append(el('span', 'badge', `${fmtDate(t.completedOn)} 完了`));
  if (t.size) meta.append(el('span', `badge size-${t.size}`, t.size));
  if (parseRepeat(t.repeat)) meta.append(el('span', 'extra', `🔁 ${describeRepeat(t.repeat)}`));
  const nc = d.comments.get(t.id); if (nc) meta.append(el('span', 'extra', `💬${nc}`));
  const nl = parseLinks(t.links).length; if (nl) meta.append(el('span', 'extra', `🔗${nl}`));
  const mins = d.minutes.get(t.id); if (mins) meta.append(el('span', 'extra', `⏱${fmtMinutes(mins)}`));
  main.append(meta);

  if (!done) {
    if (info.openBlockers.length) main.append(el('div', 'note flow', `⏳ 先に必要: ${info.openBlockers.map((b) => b.title).join('、')}`));
    if (info.inheritedFrom) main.append(el('div', 'note flow', `「${info.inheritedFrom.title}」の前提のため ${fmtDate(info.effectiveDue)} までに`));
    else if (info.dependents.length) main.append(el('div', 'note', `これが終わるのを待っているタスク: ${info.dependents.length}件`));
  }
  li.append(check, main);
  return li;
}

function section(key, title, items, d, { note, actions, renderItem, emptyText } = {}) {
  const sec = el('section', 'sec');
  const head = el('button', 'sec-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(state.open[key]));
  head.append(el('span', '', title), el('span', 'count', String(items.length)), el('span', 'caret', '▾'));
  head.onclick = () => { state.open[key] = !state.open[key]; render(); };
  sec.append(head);
  if (state.open[key]) {
    if (note) sec.append(el('p', 'sec-note', note));
    if (actions && items.length) sec.append(actions);
    if (items.length) {
      const ul = el('ul', 'list');
      for (const i of items) ul.append(renderItem ? renderItem(i) : card(i, d));
      sec.append(ul);
    } else if (emptyText) {
      sec.append(el('p', 'empty', emptyText));
    }
  }
  return sec;
}

function matches(task) {
  if (state.who && !task.assignees.includes(state.who)) return false;
  if (state.q) {
    const hay = `${task.title}\n${task.body}\n${task.assignees.join(' ')}`.toLowerCase();
    if (!state.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function renderPeople() {
  const counts = new Map();
  for (const t of state.tasks) if (t.status !== '完了') for (const a of t.assignees) counts.set(a, (counts.get(a) ?? 0) + 1);
  const names = [...new Set([...state.members.map((m) => m.name), ...counts.keys()])]
    .filter((n) => n !== state.me?.assignee && (counts.get(n) || state.members.some((m) => m.name === n)))
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  const pills = [];
  if (state.me?.assignee) pills.push([state.me.assignee, `自分（${counts.get(state.me.assignee) ?? 0}）`]);
  pills.push(['', '全員']);
  for (const n of names) pills.push([n, `${n}（${counts.get(n) ?? 0}）`]);
  $('people').replaceChildren(...pills.map(([value, label]) => {
    const b = el('button', 'pill', label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(state.who === value));
    b.onclick = () => { state.who = value; render(); };
    return b;
  }));
}

function render() {
  document.body.classList.toggle('compact', state.compact);
  const dens = $('density');
  dens.textContent = state.compact ? '≡ ふつう' : '≡ 詰める';
  dens.setAttribute('aria-pressed', String(state.compact));
  $('manager').href = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/edit#gid=${CONFIG.managerGid}`;

  renderPeople();
  const d = derived();
  const view = analyze(state.tasks, today());
  const mine = (infos) => infos.filter((i) => matches(i.task));
  const now = mine(view.buckets.now);
  const blocked = mine(view.buckets.blocked);
  const later = mine(view.buckets.later);
  const stale = mine(view.buckets.stale);
  const done = view.buckets.recentDone.filter(matches).map((t) => ({ task: t, openBlockers: [], dependents: [] }));

  // 次の1件だけ大きく出す（片手でちらっと見て、そのまま完了できるように）
  const focus = $('focus');
  if (now.length) {
    focus.hidden = false;
    focus.replaceChildren(card(now[0], d, { big: true }));
    if (now.length > 1) focus.lastChild.querySelector('.main').append(el('div', 'rest', `ほかに「今やる」が ${now.length - 1} 件`));
  } else {
    focus.hidden = true;
  }
  const rest = now.slice(1);

  const staleActions = el('p', 'sec-actions');
  const bulk = el('button', 'link', `この${stale.length}件をまとめて完了にする`);
  bulk.type = 'button';
  bulk.onclick = () => completeMany(stale.map((i) => i.task));
  staleActions.append(bulk);

  $('sections').replaceChildren(
    section('now', now.length ? '今やる（続き）' : '今やる', rest, d, { emptyText: now.length ? '' : '今やるタスクはありません 🎉' }),
    section('blocked', '待ち', blocked, d, { note: '先に終わらせるタスクがあるもの。前提が完了すると「今やる」に移ります。' }),
    section('later', 'あとで', later, d, { emptyText: 'ありません' }),
    section('stale', '要整理', stale, d, { note: '納期を60日以上過ぎたままのタスクです。もう不要なら、まとめて完了にできます。', actions: staleActions }),
    section('done', '最近の完了（7日以内）', done, d, { renderItem: (i) => card(i, d, { done: true }) }),
  );
  $('sync').textContent = state.loadedAt ? `更新 ${pad(new Date(state.loadedAt).getHours())}:${pad(new Date(state.loadedAt).getMinutes())}` : '';
}

// ---------- 完了・時間・編集の操作 ----------
function applyLocal(updated) {
  const i = state.tasks.findIndex((t) => t.id === updated.id);
  if (i >= 0) state.tasks[i] = updated; else state.tasks.push(updated);
}

/** 画面は先に更新して、保存に失敗したら元に戻す */
async function optimistic(task, fields) {
  const before = { ...task };
  applyLocal({ ...task, ...fields });
  render();
  try {
    const saved = await state.store.patch(task.id, fields, who());
    applyLocal(saved);
    saveCache();
    render();
    return saved;
  } catch (e) {
    applyLocal(before);
    render();
    toast(`保存できませんでした: ${e.message}`, { error: true, ms: 8000 });
    return null;
  }
}

async function complete(task) {
  const prev = { status: task.status, completedOn: task.completedOn ?? '' };
  const saved = await optimistic(task, { status: '完了', completedOn: today() });
  if (!saved) return;
  const next = parseRepeat(task.repeat) ? `（次回 ${fmtDate(nextDue(task.repeat, task.due, today()))}）` : '';
  toast(`「${task.title}」を完了にしました${next}`, {
    actions: [{ label: '元に戻す', fn: () => optimistic(saved, prev) }, { label: '時間を記録', fn: () => askTime(saved) }],
    ms: 7000,
  });
  // 取り消せる間は「次の回」を作らない。取り消されなければ、少し後に作る
  if (parseRepeat(task.repeat)) setTimeout(ensureRecurring, 7500);
}

async function reopen(task) {
  await optimistic(task, { status: '未着手', completedOn: '' });
}

async function completeMany(tasks) {
  if (!confirm(`${tasks.length}件を完了にします。よろしいですか？`)) return;
  try {
    const saved = await state.store.patchMany(tasks.map((t) => t.id), { status: '完了', completedOn: today() }, who());
    saved.forEach(applyLocal);
    saveCache();
    render();
    toast(`${saved.length}件を完了にしました`);
  } catch (e) {
    toast(`保存できませんでした: ${e.message}`, { error: true, ms: 8000 });
  }
}

const TIME_CHOICES = [[15, '15分'], [30, '30分'], [60, '1時間'], [120, '2時間'], [240, '半日']];

function askTime(task) {
  toast(`「${task.title}」にかかった時間は？`, {
    actions: TIME_CHOICES.map(([min, label]) => ({ label, fn: () => addTime(task, min) })),
    ms: 9000,
  });
}

async function addTime(task, minutes) {
  const entry = { taskId: task.id, date: today(), by: who(), minutes, note: '' };
  state.times.push(entry);
  render();
  try {
    await state.store.addTime(task.id, minutes, who(), entry.date);
    saveCache();
    toast(`${fmtMinutes(minutes)} を記録しました`, { ms: 2500 });
  } catch (e) {
    state.times.splice(state.times.indexOf(entry), 1);
    render();
    toast(`記録できませんでした: ${e.message}`, { error: true, ms: 8000 });
  }
  if ($('editor').open && editor.task?.id === task.id) renderEditorTime();
}

// ---------- 追加・編集の画面 ----------
const editor = { task: null, fields: null, isNew: false };

function openEditor(task) {
  const isNew = !task;
  const t = task ?? {
    id: `site-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    title: '', body: '', assignees: state.who ? [state.who] : (state.me?.assignee ? [state.me.assignee] : []),
    status: '未着手', assignedOn: today(), due: null, completedOn: null, size: '', blockedBy: [], source: 'site', slackUrl: '',
    links: '', repeat: '', seriesId: '',
  };
  const rep = parseRepeat(t.repeat);
  editor.task = t;
  editor.isNew = isNew;
  editor.fields = {
    assignees: [...t.assignees], size: t.size, status: t.status, blockedBy: [...t.blockedBy],
    repeatKind: rep?.kind ?? '',
    repeatDays: rep?.kind === 'weekly' ? rep.days.map((i) => '日月火水木金土'[i]) : [],
    repeatDom: rep?.kind === 'monthly' ? (rep.dom === 'last' ? '末' : String(rep.dom)) : '15',
  };

  $('editor-title').textContent = isNew ? 'タスクを追加' : 'タスクを編集';
  $('f-title').value = t.title;
  $('f-body').value = t.body;
  $('f-due').value = t.due ?? '';
  $('f-links').value = t.links ?? '';
  $('f-comment').value = '';
  $('editor-error').hidden = true;
  $('editor-save').disabled = false;
  $('editor-save').textContent = '保存';
  $('f-blocked-q').value = '';

  const slack = $('editor-slack');
  slack.hidden = !t.slackUrl;
  if (t.slackUrl) slack.href = t.slackUrl;
  $('editor-meta').textContent = isNew ? '' : `最終更新: ${t.updatedBy || '不明'}${t.updatedAt ? ` / ${new Date(t.updatedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ''}`;

  renderEditorAssignees();
  renderEditorSeg('f-size', [['', '未定', ''], ...SIZES.map(([v, l]) => [v, v, l])], 'size');
  renderEditorSeg('f-status', STATUSES.map((s) => [s, s, '']), 'status');
  renderEditorQuickDue();
  renderEditorRepeat();
  renderEditorLinks();
  renderEditorBlocked();
  $('f-time-box').hidden = isNew;
  $('f-comments-box').hidden = isNew;
  if (!isNew) { renderEditorTime(); renderEditorComments(); }
  $('editor').showModal();
  if (isNew) $('f-title').focus();
}

function toggleChip(label, pressed, onClick) {
  const b = el('button', 'chip', label);
  b.type = 'button';
  b.setAttribute('aria-pressed', String(pressed));
  b.onclick = onClick;
  return b;
}

function renderEditorAssignees() {
  const names = [...new Set([...state.members.map((m) => m.name), ...editor.fields.assignees])];
  $('f-assignees').replaceChildren(...names.map((n) =>
    toggleChip(n, editor.fields.assignees.includes(n), () => {
      const a = editor.fields.assignees;
      editor.fields.assignees = a.includes(n) ? a.filter((x) => x !== n) : [...a, n];
      renderEditorAssignees();
    })));
}

function renderEditorSeg(boxId, options, key) {
  $(boxId).replaceChildren(...options.map(([value, label, sub]) => {
    const b = el('button', '', label);
    b.type = 'button';
    if (sub) b.append(el('small', '', sub));
    b.setAttribute('aria-pressed', String(editor.fields[key] === value));
    b.onclick = () => { editor.fields[key] = value; renderEditorSeg(boxId, options, key); if (key === 'repeatKind') renderEditorRepeat(); };
    return b;
  }));
}

function renderEditorQuickDue() {
  const d = new Date();
  const untilFri = (5 - d.getDay() + 7) % 7 || 7; // 次の金曜（今日が金曜なら来週の金曜）
  const opts = [['今日', 0], ['明日', 1], ['次の金曜', untilFri], ['1週間後', 7], ['クリア', null]];
  $('f-due-quick').replaceChildren(...opts.map(([label, n]) => {
    const b = el('button', '', label);
    b.type = 'button';
    b.onclick = () => { $('f-due').value = n == null ? '' : addDays(n); };
    return b;
  }));
}

function renderEditorRepeat() {
  const f = editor.fields;
  renderEditorSeg('f-repeat-kind', [['', 'なし', ''], ['daily', '毎日', ''], ['weekdays', '平日', ''], ['weekly', '毎週', ''], ['monthly', '毎月', '']], 'repeatKind');
  const wk = $('f-repeat-weekdays');
  wk.hidden = f.repeatKind !== 'weekly';
  wk.replaceChildren(...WEEK_CHARS.map((c) => toggleChip(c, f.repeatDays.includes(c), () => {
    f.repeatDays = f.repeatDays.includes(c) ? f.repeatDays.filter((x) => x !== c) : [...f.repeatDays, c];
    renderEditorRepeat();
  })));
  const dom = $('f-repeat-dom');
  dom.hidden = f.repeatKind !== 'monthly';
  dom.replaceChildren(...[...Array.from({ length: 31 }, (_, i) => String(i + 1)), '末'].map((v) => {
    const o = new Option(v === '末' ? '月末' : `${v}日`, v);
    o.selected = v === f.repeatDom;
    return o;
  }));
  dom.onchange = () => { f.repeatDom = dom.value; };
  const note = $('f-repeat-note');
  note.hidden = !f.repeatKind;
  note.textContent = '完了にすると、次の回のタスクが自動で作られます。';
}

function currentRepeat() {
  const f = editor.fields;
  if (f.repeatKind === 'weekly') return buildRepeat('weekly', WEEK_CHARS.filter((c) => f.repeatDays.includes(c)));
  if (f.repeatKind === 'monthly') return buildRepeat('monthly', f.repeatDom);
  return buildRepeat(f.repeatKind);
}

function renderEditorLinks() {
  const ul = $('f-links-view');
  ul.replaceChildren(...parseLinks($('f-links').value).map(({ label, url }) => {
    const li = el('li');
    const a = el('a', '', `🔗 ${label}`);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    li.append(a);
    return li;
  }));
}

function renderEditorBlocked() {
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const chosen = editor.fields.blockedBy;
  $('f-blocked-chips').replaceChildren(...chosen.map((id) => {
    const title = byId.get(id)?.title ?? id;
    return toggleChip(`${title} ✕`, true, () => { editor.fields.blockedBy = chosen.filter((x) => x !== id); renderEditorBlocked(); });
  }));

  const q = $('f-blocked-q').value.trim().toLowerCase();
  const candidates = state.tasks
    .filter((t) => t.status !== '完了' && t.id !== editor.task.id)
    .filter((t) => !reaches(byId, t.id, editor.task.id)) // 自分を待っているタスクを前提にすると堂々巡りになる
    .filter((t) => !chosen.includes(t.id))
    .filter((t) => !q || t.title.toLowerCase().includes(q))
    .slice(0, 30);
  $('f-blocked-list').replaceChildren(...(q || candidates.length < 12 ? candidates : []).map((t) => {
    const li = el('li');
    const label = el('label');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.onchange = () => { editor.fields.blockedBy = [...editor.fields.blockedBy, t.id]; $('f-blocked-q').value = ''; renderEditorBlocked(); };
    label.append(cb, el('span', '', `${t.title}（${t.assignees.join('・') || '担当者なし'}）`));
    li.append(label);
    return li;
  }));
}

function renderEditorTime() {
  const t = editor.task;
  const total = state.times.filter((x) => x.taskId === t.id).reduce((s, x) => s + x.minutes, 0);
  const est = state.sizeMinutes[t.size ?? ''];
  $('f-time-total').textContent = `実績 ${fmtMinutes(total)}${t.size ? ` ／ 見積 ${fmtMinutes(est)}（重さ ${t.size}）` : ''}`;
  $('f-time-btns').replaceChildren(...TIME_CHOICES.map(([min, label]) => {
    const b = el('button', '', `＋${label}`);
    b.type = 'button';
    b.onclick = () => addTime(t, min);
    return b;
  }));
}

function renderEditorComments() {
  const t = editor.task;
  $('f-comments').replaceChildren(...state.comments.filter((c) => c.taskId === t.id).sort((a, b) => a.at.localeCompare(b.at)).map((c) => {
    const li = el('li');
    const when = c.at ? new Date(c.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    li.append(el('span', 'by', `${c.by || '不明'} ・ ${when}${c.source === 'slack' ? ' ・ Slack' : ''}`), el('span', 'text', c.text));
    return li;
  }));
}

async function sendComment() {
  const text = $('f-comment').value.trim();
  if (!text) return;
  const btn = $('f-comment-send');
  btn.disabled = true;
  const entry = { taskId: editor.task.id, at: new Date().toISOString(), by: who(), text, source: 'site' };
  state.comments.push(entry);
  $('f-comment').value = '';
  renderEditorComments();
  render();
  try {
    await state.store.addComment(entry.taskId, text, who());
    saveCache();
  } catch (e) {
    state.comments.splice(state.comments.indexOf(entry), 1);
    $('f-comment').value = text;
    renderEditorComments();
    render();
    toast(`送れませんでした: ${e.message}`, { error: true, ms: 8000 });
  } finally {
    btn.disabled = false;
  }
}

async function saveEditor(ev) {
  ev.preventDefault();
  const t = editor.task;
  const err = $('editor-error');
  err.hidden = true;
  const title = $('f-title').value.trim();
  if (!title) { err.textContent = 'タスク名を入れてください'; err.hidden = false; return; }
  if (editor.fields.repeatKind === 'weekly' && !editor.fields.repeatDays.length) { err.textContent = 'くり返す曜日を選んでください'; err.hidden = false; return; }

  const status = editor.fields.status;
  const repeat = currentRepeat();
  const fields = {
    title,
    body: $('f-body').value.trim(),
    assignees: editor.fields.assignees,
    due: $('f-due').value || '',
    size: editor.fields.size,
    status,
    blockedBy: editor.fields.blockedBy,
    completedOn: status === '完了' ? (t.completedOn || today()) : '',
    links: $('f-links').value.trim(),
    repeat,
    seriesId: repeat ? (t.seriesId || t.id) : (t.seriesId || ''),
  };

  $('editor-save').disabled = true;
  $('editor-save').textContent = '保存中…';
  try {
    if (editor.isNew) {
      const saved = await state.store.add({ ...t, ...fields }, who());
      applyLocal(saved);
      toast('タスクを追加しました', { ms: 3000 });
    } else {
      // 変えた項目だけ送る（同時に他の人が直した別の項目を消さないため）
      const changed = {};
      for (const [k, v] of Object.entries(fields)) {
        const old = t[k] ?? '';
        if (JSON.stringify(Array.isArray(v) ? v : String(v ?? '')) !== JSON.stringify(Array.isArray(old) ? old : String(old))) changed[k] = v;
      }
      if (Object.keys(changed).length) applyLocal(await state.store.patch(t.id, changed, who()));
    }
    saveCache();
    $('editor').close();
    render();
    if (status === '完了') ensureRecurring();
  } catch (e) {
    err.textContent = `保存できませんでした: ${e.message}`;
    err.hidden = false;
    $('editor-save').disabled = false;
    $('editor-save').textContent = '保存';
  }
}

// ---------- 起動 ----------
function showApp() {
  $('login').hidden = true;
  $('app').hidden = false;
  $('user').textContent = state.me.name;
}

async function start(profile) {
  state.me = { ...profile };
  showApp();
  restoreCache(); // 前回の内容を先に出して、あとから最新に入れ替える
  await load();
}

function setLoginMsg(msg) { const m = $('login-msg'); m.textContent = msg; m.hidden = !msg; }

async function boot() {
  state.compact = storage.get(DENSITY_KEY) === '1';
  $('editor-close').onclick = () => $('editor').close();
  $('editor-form').addEventListener('submit', saveEditor);
  $('f-blocked-q').addEventListener('input', renderEditorBlocked);
  $('f-links').addEventListener('input', renderEditorLinks);
  $('f-comment-send').onclick = sendComment;
  $('fab').onclick = () => openEditor(null);
  $('refresh').onclick = () => load();
  $('density').onclick = () => { state.compact = !state.compact; storage.set(DENSITY_KEY, state.compact ? '1' : '0'); render(); };
  $('q').addEventListener('input', (e) => { state.q = e.target.value.trim(); render(); });
  $('user').onclick = () => {
    if (MOCK) return;
    if (confirm('ログアウトしますか？')) { storage.del(CACHE_KEY); auth.signOut(); location.reload(); }
  };
  $('editor').addEventListener('click', (e) => { if (e.target === $('editor')) $('editor').close(); });

  // 見ていない間に誰かが変えたかもしれないので、戻ってきたとき・一定時間ごとに読み直す
  const refreshIfStale = () => { if (!$('app').hidden && !$('editor').open && Date.now() - state.loadedAt > 45000) load({ quiet: true }); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfStale(); });
  setInterval(() => { if (!document.hidden) refreshIfStale(); }, 60000);

  // ホーム画面に追加したときアプリのように開けるようにする（圏外でも画面は開く）
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 使えなくても通常どおり動く */ });
  }

  if (MOCK) {
    state.store = createMockStore();
    showBanner('これは動作確認用の仮データです（Google にはつながっていません）');
    await start(MOCK_PROFILE);
    return;
  }

  $('login').hidden = false;
  if (!CONFIG.clientId) {
    $('login-btn').disabled = true;
    setLoginMsg('準備中です（Google ログインの設定がまだ済んでいません）。');
    return;
  }
  state.store = createSheetsStore();
  try {
    await auth.initAuth();
  } catch (e) {
    setLoginMsg(e.message);
    return;
  }
  $('login-btn').onclick = async () => {
    setLoginMsg('');
    $('login-btn').disabled = true;
    try {
      await start(await auth.signIn());
    } catch (e) {
      setLoginMsg(e.message);
    } finally {
      $('login-btn').disabled = false;
    }
  };
  if (auth.hasHint()) {
    try { await start(await auth.silentSignIn()); } catch { /* 手動のログインに任せる */ }
  }
}

boot();
