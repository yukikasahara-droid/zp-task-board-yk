// スプレッドシート連携の動作確認（Google にはつながず、偽の Sheets API で試す）: node scripts/test-sheets.mjs
import assert from 'node:assert/strict';
import { createSheetsStore, rowToTask, normDate } from '../next/sheets.js';
import { CONFIG } from '../next/config.js';

// 偽のスプレッドシート: タブ名 → 2次元配列
const sheets = {
  tasks: [
    ['id', 'title', 'body', 'assignees', 'status', 'assignedOn', 'due', 'completedOn', 'size', 'blockedBy', 'source', 'slackUrl', 'updatedAt', 'updatedBy', 'links', 'repeat', 'seriesId'],
    ['1791.1', 'A', 'メモ', 'a、b', '未着手', '2026-10-01', '2026/10/09', '', 'M', '', 'slack', '', '', '', '', '', ''],
    ['1791.2', 'B', '', 'a', '進行中', '2026-10-02', '', '', '', '1791.1', 'slack', '', '', '', 'https://example.com', 'weekly:月', ''],
  ],
  members: [['name', 'email'], ['a', 'A@Example.com']],
  comments: [['taskId', 'at', 'by', 'text', 'source'], ['1791.1', '2026-10-08T01:00:00Z', 'a', '了解', 'site']],
  timelog: [['taskId', 'date', 'by', 'minutes', 'note'], ['1791.1', '2026/10/08', 'a', '30', '']],
  設定: [['項目', '値', '説明'], ['S', 90, ''], ['M', 240, ''], ['L', '', ''], ['未設定', 100, '']],
};
const calls = [];
const colIndex = (s) => s.charCodeAt(0) - 65;
function parseRange(r) {
  const [tab, a1] = decodeURIComponent(r).split('!');
  const m = /^([A-Z])(\d*)(?::([A-Z])(\d*))?$/.exec(a1);
  return { tab, c1: colIndex(m[1]), r1: m[2] ? Number(m[2]) : 1, c2: m[3] ? colIndex(m[3]) : colIndex(m[1]), r2: m[4] ? Number(m[4]) : Infinity };
}
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  const path = u.pathname.replace(/^\/v4\/spreadsheets\/[^/]+/, '');
  const method = opts.method ?? 'GET';
  calls.push(`${method} ${path}`);
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const missing = () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Unable to parse range: x' } }) });
  if (method === 'GET' && path.startsWith('/values/')) {
    const r = parseRange(path.slice('/values/'.length));
    if (!sheets[r.tab]) return missing();
    const rows = sheets[r.tab].slice(r.r1 - 1, r.r2).map((row) => row.slice(r.c1, r.c2 + 1));
    return ok({ values: rows });
  }
  if (method === 'POST' && path === '/values:batchUpdate') {
    for (const d of JSON.parse(opts.body).data) {
      const r = parseRange(d.range);
      d.values.forEach((row, i) => row.forEach((v, j) => { sheets[r.tab][r.r1 - 1 + i][r.c1 + j] = v; }));
    }
    return ok({});
  }
  if (method === 'POST' && path.includes(':append')) {
    const tab = decodeURIComponent(path.slice('/values/'.length).split('!')[0]);
    sheets[tab].push(...JSON.parse(opts.body).values);
    return ok({});
  }
  throw new Error(`想定外の呼び出し: ${method} ${path}`);
};
CONFIG.sheetId = 'TEST';
const store = createSheetsStore({ getToken: async () => 'token' });

// 読み込み
let data = await store.load();
assert.equal(data.tasks.length, 2);
assert.deepEqual(data.tasks[0].assignees, ['a', 'b']);
assert.equal(data.tasks[0].due, '2026-10-09'); // 2026/10/09 を直して読む
assert.equal(data.tasks[1].links, 'https://example.com');
assert.equal(data.tasks[1].repeat, 'weekly:月');
assert.deepEqual(data.tasks[1].blockedBy, ['1791.1']);
assert.equal(data.members[0].email, 'a@example.com');
assert.equal(data.comments.length, 1);
assert.deepEqual(data.sizeMinutes, { S: 90, M: 240, L: 480, '': 100 }); // 空欄は初期値
assert.deepEqual(data.times[0], { taskId: '1791.1', date: '2026-10-08', by: 'a', minutes: 30, note: '' });

// 一部の項目だけ更新: 他の項目と、知らない列は消えない
const saved = await store.patch('1791.2', { status: '完了', completedOn: '2026-10-09' }, '笠原');
assert.equal(saved.status, '完了');
assert.equal(sheets.tasks[2][4], '完了');
assert.equal(sheets.tasks[2][7], '2026-10-09');
assert.equal(sheets.tasks[2][14], 'https://example.com');
assert.equal(sheets.tasks[2][13], '笠原');
assert.equal(sheets.tasks[1][4], '未着手'); // 他の行は触らない

// 数式として解釈される文字も、そのままの文字で保存される（RAW）
await store.patch('1791.1', { body: '=1+1' }, 'x');
assert.equal(sheets.tasks[1][2], '=1+1');

// 追加 / 重複しない追加
await store.add({ id: 'site-1', title: 'N', body: '', assignees: ['a'], status: '未着手', blockedBy: [], links: '', repeat: '', seriesId: '' }, 'x');
assert.equal(sheets.tasks.length, 4);
assert.equal(await store.add({ id: 'site-1', title: 'N2', assignees: [], blockedBy: [] }, 'x', { unique: true }), null);
assert.equal(sheets.tasks.length, 4);
assert.ok(await store.add({ id: 'rep-1-2026-10-12', title: 'R', assignees: [], blockedBy: [] }, 'x', { unique: true }));
assert.equal(sheets.tasks.length, 5);

// 無くなった行を更新しようとしたらエラー
await assert.rejects(() => store.patch('nope', { status: '完了' }, 'x'), /無くなっています/);

// コメント・作業時間は追記だけ
await store.addComment('1791.1', '=SUM(A1)', '笠原');
assert.equal(sheets.comments.at(-1)[3], '=SUM(A1)');
await store.addTime('1791.1', 45, '笠原', '2026-10-09');
assert.deepEqual(sheets.timelog.at(-1).slice(0, 4), ['1791.1', '2026-10-09', '笠原', 45]);

// コメント・作業時間のタブが無くても読み込める
delete sheets.comments; delete sheets.timelog;
data = await store.load();
assert.equal(data.comments.length, 0);
assert.equal(data.times.length, 0);

assert.equal(normDate('2026-1-5'), '2026-01-05');
assert.equal(rowToTask(['x', 't', '', '', '未知の状態'], { id: 0, title: 1, body: 2, assignees: 3, status: 4 }).status, '未着手');
console.log('sheets tests OK');
