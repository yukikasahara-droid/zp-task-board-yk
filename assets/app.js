import { decryptJson } from './crypto.js';

const STATUSES = ['未着手', '進行中', '完了'];
const PW_KEY = 'zp-taskboard-pw';
const FILTER_KEY = 'zp-taskboard-filter';

const $ = (id) => document.getElementById(id);

// localStorage はプライベートモード等で使えないことがあるので必ず try/catch
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 保存できなくても動作は続ける */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 同上 */ } },
};

let tasks = [];
const filter = { q: '', assignee: '', statuses: new Set(['未着手', '進行中']), overdueOnly: false, sort: 'due' };

// ---------- 日付まわり ----------
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  const w = '日月火水木金土'[new Date(y, m - 1, d).getDay()];
  return `${y !== new Date().getFullYear() ? y + '/' : ''}${m}/${d}(${w})`;
}
function isOverdue(t) {
  return t.status !== '完了' && t.due && t.due < today();
}

// ---------- 読み込み ----------
async function fetchData() {
  const res = await fetch(`data/tasks.enc.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`データを取得できませんでした（${res.status}）`);
  return res.json();
}

async function unlock(password, remember) {
  const payload = await fetchData();
  let data;
  try {
    data = await decryptJson(payload, password);
  } catch {
    throw new Error('パスワードが違います');
  }
  if (remember) store.set(PW_KEY, password);
  tasks = data.tasks;
  $('updated').textContent = data.updatedAt ? `最終更新 ${new Date(data.updatedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '';
  $('lock').hidden = true;
  $('app').hidden = false;
  setupFilters();
  render();
}

// ---------- 絞り込み ----------
function loadFilter() {
  try {
    const saved = JSON.parse(store.get(FILTER_KEY) || 'null');
    if (saved) {
      filter.assignee = saved.assignee ?? '';
      filter.sort = saved.sort ?? 'due';
      if (Array.isArray(saved.statuses)) filter.statuses = new Set(saved.statuses.filter((s) => STATUSES.includes(s)));
    }
  } catch { /* 壊れていたら初期値のまま */ }
  loadHash();
}

// URL の # 以降で絞り込み状態を共有できるようにする（例 #who=笠原 雄希&st=未着手,進行中）
// 端末に保存した絞り込みより、リンクで指定された内容を優先する
function loadHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.has('who')) filter.assignee = p.get('who');
  if (p.has('st')) filter.statuses = new Set(p.get('st').split(',').filter((s) => STATUSES.includes(s)));
  filter.overdueOnly = p.get('due') === 'over';
  if (p.has('q')) {
    filter.q = p.get('q');
    $('q').value = filter.q;
  }
}
function hashFromFilter() {
  const p = new URLSearchParams();
  if (filter.assignee) p.set('who', filter.assignee);
  if (filter.overdueOnly) p.set('due', 'over');
  else p.set('st', STATUSES.filter((s) => filter.statuses.has(s)).join(','));
  if (filter.q) p.set('q', filter.q);
  return '#' + p.toString();
}
function syncHash() {
  try {
    history.replaceState(null, '', hashFromFilter());
  } catch { /* file:// 等で使えない場合は何もしない */ }
}
function saveFilter() {
  store.set(FILTER_KEY, JSON.stringify({ assignee: filter.assignee, sort: filter.sort, statuses: [...filter.statuses] }));
}

function setupFilters() {
  loadFilter();
  const names = [...new Set(tasks.flatMap((t) => t.assignees))].sort((a, b) => a.localeCompare(b, 'ja'));
  const sel = $('assignee');
  sel.length = 1;
  for (const n of names) sel.add(new Option(n, n));
  if (!names.includes(filter.assignee)) filter.assignee = '';
  sel.value = filter.assignee;
  $('sort').value = filter.sort;

  const chips = $('status-chips');
  chips.replaceChildren(...STATUSES.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.status = s;
    b.textContent = s;
    b.onclick = () => {
      filter.statuses.has(s) ? filter.statuses.delete(s) : filter.statuses.add(s);
      filter.overdueOnly = false;
      saveFilter();
      render();
    };
    return b;
  }));
}

function matches(t) {
  if (filter.overdueOnly) {
    if (!isOverdue(t)) return false;
  } else if (!filter.statuses.has(t.status)) return false;
  if (filter.assignee && !t.assignees.includes(filter.assignee)) return false;
  if (filter.q) {
    const hay = `${t.title}\n${t.body}\n${t.assignees.join(' ')}`.toLowerCase();
    if (!filter.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function compare(a, b) {
  const doneA = a.status === '完了', doneB = b.status === '完了';
  if (doneA !== doneB) return doneA ? 1 : -1;
  if (doneA) return (b.completedOn ?? b.assignedOn ?? '').localeCompare(a.completedOn ?? a.assignedOn ?? '');
  if (filter.sort === 'due') {
    if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
    if (!!a.due !== !!b.due) return a.due ? -1 : 1;
  }
  return (b.assignedOn ?? '').localeCompare(a.assignedOn ?? '') || b.id.localeCompare(a.id);
}

// ---------- 表示 ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function dueBadge(t) {
  if (!t.due || t.status === '完了') return t.due ? el('span', 'badge', `期限 ${fmtDate(t.due)}`) : null;
  const left = daysBetween(today(), t.due);
  if (left < 0) return el('span', 'badge danger', `期限切れ ${-left}日（${fmtDate(t.due)}）`);
  if (left === 0) return el('span', 'badge warn', `今日まで`);
  if (left <= 3) return el('span', 'badge warn', `あと${left}日（${fmtDate(t.due)}）`);
  return el('span', 'badge', `期限 ${fmtDate(t.due)}`);
}

function card(t) {
  const li = el('li', `card${isOverdue(t) ? ' overdue' : ''}${t.status === '完了' ? ' done' : ''}`);
  const head = el('div', 'card-head');
  head.append(el('span', `status s-${STATUSES.indexOf(t.status)}`, t.status), el('h2', 'title', t.title));
  li.append(head);

  const meta = el('div', 'meta');
  meta.append(el('span', 'who', t.assignees.join('・')));
  if (t.assignedOn) meta.append(el('span', 'muted', `指示 ${fmtDate(t.assignedOn)}`));
  const badge = dueBadge(t);
  if (badge) meta.append(badge);
  if (t.status === '完了' && t.completedOn) meta.append(el('span', 'muted', `完了 ${fmtDate(t.completedOn)}`));
  li.append(meta);

  if (t.body && t.body.trim() !== t.title.trim()) li.append(el('p', 'body', t.body));
  if (t.slackUrl) {
    const a = el('a', 'slack', 'Slackで開く ↗');
    a.href = t.slackUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    li.append(a);
  }
  return li;
}

function stat(label, value, cls, onClick, active) {
  const b = el('button', `stat ${cls}${active ? ' active' : ''}`);
  b.type = 'button';
  b.append(el('span', 'stat-num', String(value)), el('span', 'stat-label', label));
  b.onclick = onClick;
  return b;
}

function render() {
  const mine = tasks.filter((t) => !filter.assignee || t.assignees.includes(filter.assignee));
  const count = (s) => mine.filter((t) => t.status === s).length;
  const only = (s) => () => { filter.statuses = new Set([s]); filter.overdueOnly = false; saveFilter(); render(); };
  const single = (s) => !filter.overdueOnly && filter.statuses.size === 1 && filter.statuses.has(s);
  $('stats').replaceChildren(
    stat('未着手', count('未着手'), 's-0', only('未着手'), single('未着手')),
    stat('進行中', count('進行中'), 's-1', only('進行中'), single('進行中')),
    stat('期限切れ', mine.filter(isOverdue).length, 'danger', () => { filter.overdueOnly = !filter.overdueOnly; render(); }, filter.overdueOnly),
    stat('完了', count('完了'), 's-2', only('完了'), single('完了')),
  );

  for (const b of $('status-chips').children) {
    b.classList.toggle('on', !filter.overdueOnly && filter.statuses.has(b.dataset.status));
  }

  const shown = tasks.filter(matches).sort(compare);
  $('count').textContent = filter.overdueOnly ? `期限切れ ${shown.length} 件` : `${shown.length} 件`;
  syncHash();
  $('list').replaceChildren(...(shown.length ? shown.map(card) : [el('li', 'empty muted', '該当するタスクはありません')]));
}

// ---------- 起動 ----------
$('lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('unlock-btn');
  const err = $('lock-error');
  btn.disabled = true;
  btn.textContent = '確認中…';
  err.hidden = true;
  try {
    await unlock($('pw').value, $('remember').checked);
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = '開く';
  }
});

$('q').addEventListener('input', (e) => { filter.q = e.target.value.trim(); render(); });
$('assignee').addEventListener('change', (e) => { filter.assignee = e.target.value; saveFilter(); render(); });
$('sort').addEventListener('change', (e) => { filter.sort = e.target.value; saveFilter(); render(); });
$('copy-link').addEventListener('click', async () => {
  const btn = $('copy-link');
  try {
    await navigator.clipboard.writeText(location.href);
    btn.textContent = 'コピーしました';
  } catch {
    prompt('このリンクをコピーしてください', location.href);
  }
  setTimeout(() => { btn.textContent = 'この表示のリンクをコピー'; }, 2000);
});
$('logout').addEventListener('click', () => {
  store.del(PW_KEY);
  tasks = [];
  $('list').replaceChildren();
  $('pw').value = '';
  $('app').hidden = true;
  $('lock').hidden = false;
});

const saved = store.get(PW_KEY);
if (saved) {
  unlock(saved, true).catch((ex) => {
    if (ex.message === 'パスワードが違います') store.del(PW_KEY); // パスワード変更後は入力画面に戻る
    $('lock-error').textContent = ex.message;
    $('lock-error').hidden = false;
  });
}
