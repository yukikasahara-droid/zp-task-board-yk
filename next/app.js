import { CONFIG } from './config.js';
import { analyze, reaches, daysBetween } from './priority.js';
import { createMockStore, MOCK_PROFILE } from './mock.js';
import * as auth from './auth.js';
import { createSheetsStore, AccessError, STATUSES } from './sheets.js';

const $ = (id) => document.getElementById(id);
const MOCK = new URLSearchParams(location.search).has('mock');
const SIZES = [['S', '〜1時間'], ['M', '半日'], ['L', '1日以上']];

const state = {
  tasks: [], members: [], me: null, store: null,
  who: '', // '' は全員。担当者の名前を入れるとその人だけ
  q: '',
  open: { now: true, blocked: true, later: true, stale: false, done: false },
  loadedAt: 0,
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

let toastTimer = null;
function toast(text, { action, onAction, error = false, ms = 6000 } = {}) {
  const t = $('toast');
  t.classList.toggle('error', error);
  $('toast-text').textContent = text;
  const btn = $('toast-action');
  btn.hidden = !action;
  btn.textContent = action ?? '';
  btn.onclick = () => { hideToast(); onAction?.(); };
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
function hideToast() { $('toast').hidden = true; }

const who = () => state.me?.name ?? '';

// ---------- 読み込み ----------
async function load({ quiet = false } = {}) {
  try {
    const { tasks, members } = await state.store.load();
    state.tasks = tasks;
    state.members = members;
    state.loadedAt = Date.now();
    $('banner').hidden = true;
    if (!state.me?.assignee) resolveMe();
    render();
  } catch (e) {
    if (quiet) return;
    showBanner(e.message);
  }
}
function showBanner(msg) { $('banner').textContent = msg; $('banner').hidden = false; }

/** ログインした人が、担当者の誰にあたるかをメンバー表から探す */
function resolveMe() {
  const email = state.me.email?.toLowerCase();
  const m = state.members.find((x) => x.email && x.email === email) ?? state.members.find((x) => x.name === state.me.name);
  state.me.assignee = m?.name ?? null;
  if (state.firstLoad !== false) {
    state.who = state.me.assignee ?? '';
    state.firstLoad = false;
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
  return el('span', 'badge', `${fmtDate(t.due)}`);
}

function card(info, { done = false } = {}) {
  const t = info.task;
  const li = el('li', `card${info.ownLeft != null && info.ownLeft < 0 && !done ? ' overdue' : ''}${done ? ' done' : ''}`);

  const check = el('button', 'check');
  check.type = 'button';
  check.setAttribute('aria-label', done ? `「${t.title}」を未完了に戻す` : `「${t.title}」を完了にする`);
  check.append(el('span', '', '✓'));
  check.onclick = () => (done ? reopen(t) : complete(t));

  const main = el('button', 'main');
  main.type = 'button';
  main.onclick = () => openEditor(t);
  main.append(el('div', 'title', t.title));

  const meta = el('div', 'meta');
  meta.append(el('span', 'who', t.assignees.join('・') || '担当者なし'));
  if (t.status === '進行中') meta.append(el('span', 'badge doing', '進行中'));
  if (!done) { const b = dueBadge(info); if (b) meta.append(b); }
  if (done && t.completedOn) meta.append(el('span', 'badge', `${fmtDate(t.completedOn)} 完了`));
  if (t.size) meta.append(el('span', `badge size-${t.size}`, t.size));
  main.append(meta);

  if (!done) {
    if (info.openBlockers.length) {
      main.append(el('div', 'note flow', `⏳ 先に必要: ${info.openBlockers.map((b) => b.title).join('、')}`));
    }
    if (info.inheritedFrom) {
      main.append(el('div', 'note flow', `「${info.inheritedFrom.title}」の前提のため ${fmtDate(info.effectiveDue)} までに`));
    } else if (info.dependents.length) {
      main.append(el('div', 'note', `これが終わるのを待っているタスク: ${info.dependents.length}件`));
    }
  }
  li.append(check, main);
  return li;
}

function section(key, title, items, { note, actions, renderItem = (i) => card(i), emptyText } = {}) {
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
      for (const i of items) ul.append(renderItem(i));
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
  const box = $('people');
  const counts = new Map();
  for (const t of state.tasks) if (t.status !== '完了') for (const a of t.assignees) counts.set(a, (counts.get(a) ?? 0) + 1);
  const names = [...new Set([...state.members.map((m) => m.name), ...counts.keys()])]
    .filter((n) => n !== state.me?.assignee && (counts.get(n) || state.members.some((m) => m.name === n)))
    .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  const pills = [];
  if (state.me?.assignee) pills.push([state.me.assignee, `自分（${counts.get(state.me.assignee) ?? 0}）`]);
  pills.push(['', '全員']);
  for (const n of names) pills.push([n, `${n}（${counts.get(n) ?? 0}）`]);
  box.replaceChildren(...pills.map(([value, label]) => {
    const b = el('button', 'pill', label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(state.who === value));
    b.onclick = () => { state.who = value; render(); };
    return b;
  }));
}

function render() {
  renderPeople();
  const view = analyze(state.tasks, today());
  const mine = (infos) => infos.filter((i) => matches(i.task));
  const now = mine(view.buckets.now);
  const blocked = mine(view.buckets.blocked);
  const later = mine(view.buckets.later);
  const stale = mine(view.buckets.stale);
  const done = view.buckets.recentDone.filter(matches).map((t) => ({ task: t, openBlockers: [], dependents: [] }));

  const staleActions = el('p', 'sec-actions');
  const bulk = el('button', 'link', `この${stale.length}件をまとめて完了にする`);
  bulk.type = 'button';
  bulk.onclick = () => completeMany(stale.map((i) => i.task));
  staleActions.append(bulk);

  const root = $('sections');
  root.replaceChildren(
    section('now', '今やる', now, { emptyText: '今やるタスクはありません 🎉' }),
    section('blocked', '待ち', blocked, { note: '先に終わらせるタスクがあるもの。前提が完了すると「今やる」に移ります。' }),
    section('later', 'あとで', later, { emptyText: 'ありません' }),
    section('stale', '要整理', stale, { note: `納期を60日以上過ぎたままのタスクです。もう不要なら、まとめて完了にできます。`, actions: staleActions }),
    section('done', '最近の完了（7日以内）', done, { renderItem: (i) => card(i, { done: true }) }),
  );
  $('sync').textContent = state.loadedAt ? `更新 ${pad(new Date(state.loadedAt).getHours())}:${pad(new Date(state.loadedAt).getMinutes())}` : '';
}

// ---------- 完了・編集の操作 ----------
function applyLocal(updated) {
  const i = state.tasks.findIndex((t) => t.id === updated.id);
  if (i >= 0) state.tasks[i] = updated; else state.tasks.push(updated);
}

/** 画面は先に更新して、保存に失敗したら元に戻す */
async function optimistic(task, fields, { onFail } = {}) {
  const before = { ...task };
  applyLocal({ ...task, ...fields });
  render();
  try {
    const saved = await state.store.patch(task.id, fields, who());
    applyLocal(saved);
    render();
    return saved;
  } catch (e) {
    applyLocal(before);
    render();
    toast(`保存できませんでした: ${e.message}`, { error: true, ms: 8000 });
    onFail?.(e);
    return null;
  }
}

async function complete(task) {
  const prev = { status: task.status, completedOn: task.completedOn ?? '' };
  const saved = await optimistic(task, { status: '完了', completedOn: today() });
  if (!saved) return;
  toast(`「${task.title}」を完了にしました`, { action: '元に戻す', onAction: () => optimistic(saved, prev) });
}

async function reopen(task) {
  await optimistic(task, { status: '未着手', completedOn: '' });
}

async function completeMany(tasks) {
  if (!confirm(`${tasks.length}件を完了にします。よろしいですか？`)) return;
  try {
    const saved = await state.store.patchMany(tasks.map((t) => t.id), { status: '完了', completedOn: today() }, who());
    saved.forEach(applyLocal);
    render();
    toast(`${saved.length}件を完了にしました`);
  } catch (e) {
    toast(`保存できませんでした: ${e.message}`, { error: true, ms: 8000 });
  }
}

// ---------- 追加・編集の画面 ----------
const editor = { task: null, fields: null };

function openEditor(task) {
  const isNew = !task;
  const t = task ?? {
    id: `site-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    title: '', body: '', assignees: state.who ? [state.who] : (state.me?.assignee ? [state.me.assignee] : []),
    status: '未着手', assignedOn: today(), due: null, completedOn: null, size: '', blockedBy: [], source: 'site', slackUrl: '',
  };
  editor.task = t;
  editor.isNew = isNew;
  editor.fields = { assignees: [...t.assignees], size: t.size, status: t.status, blockedBy: [...t.blockedBy] };

  $('editor-title').textContent = isNew ? 'タスクを追加' : 'タスクを編集';
  $('f-title').value = t.title;
  $('f-body').value = t.body;
  $('f-due').value = t.due ?? '';
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
  renderEditorBlocked();
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
    b.onclick = () => { editor.fields[key] = value; renderEditorSeg(boxId, options, key); };
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
    const text = el('span', '', `${t.title}（${t.assignees.join('・') || '担当者なし'}）`);
    label.append(cb, text);
    li.append(label);
    return li;
  }));
}

async function saveEditor(ev) {
  ev.preventDefault();
  const t = editor.task;
  const err = $('editor-error');
  err.hidden = true;
  const title = $('f-title').value.trim();
  if (!title) { err.textContent = 'タスク名を入れてください'; err.hidden = false; return; }

  const status = editor.fields.status;
  const fields = {
    title,
    body: $('f-body').value.trim(),
    assignees: editor.fields.assignees,
    due: $('f-due').value || '',
    size: editor.fields.size,
    status,
    blockedBy: editor.fields.blockedBy,
    completedOn: status === '完了' ? (t.completedOn || today()) : '',
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
    $('editor').close();
    render();
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
  await load();
}

function setLoginMsg(msg) { const m = $('login-msg'); m.textContent = msg; m.hidden = !msg; }

async function boot() {
  $('editor-close').onclick = () => $('editor').close();
  $('editor-form').addEventListener('submit', saveEditor);
  $('f-blocked-q').addEventListener('input', renderEditorBlocked);
  $('fab').onclick = () => openEditor(null);
  $('refresh').onclick = () => load();
  $('q').addEventListener('input', (e) => { state.q = e.target.value.trim(); render(); });
  $('user').onclick = () => {
    if (MOCK) return;
    if (confirm('ログアウトしますか？')) { auth.signOut(); location.reload(); }
  };
  $('editor').addEventListener('click', (e) => { if (e.target === $('editor')) $('editor').close(); });

  // 見ていない間に誰かが変えたかもしれないので、戻ってきたとき・一定時間ごとに読み直す
  const refreshIfStale = () => { if (!$('app').hidden && !$('editor').open && Date.now() - state.loadedAt > 45000) load({ quiet: true }); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfStale(); });
  setInterval(() => { if (!document.hidden) refreshIfStale(); }, 60000);

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
