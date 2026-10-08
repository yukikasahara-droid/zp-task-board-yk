// 優先度の計算の動作確認: node scripts/test-priority.mjs
import assert from 'node:assert/strict';
import { analyze, reaches, daysBetween } from '../next/priority.js';

const T = '2026-10-08';
const mk = (id, o = {}) => ({ id, title: id, body: '', assignees: ['a'], status: '未着手', assignedOn: '2026-10-01', due: null, completedOn: null, size: '', blockedBy: [], ...o });
const bucketOf = (r, id) => r.items.get(id).bucket;

// 日数差
assert.equal(daysBetween('2026-10-08', '2026-10-10'), 2);
assert.equal(daysBetween('2026-10-31', '2026-11-01'), 1);

// 納期が近いほど上、期限切れが最上位
{
  const r = analyze([mk('far', { due: '2026-12-01' }), mk('soon', { due: '2026-10-10' }), mk('over', { due: '2026-10-05' })], T);
  assert.deepEqual(r.buckets.now.map((i) => i.task.id), ['over', 'soon']);
  assert.equal(bucketOf(r, 'far'), 'later');
}

// 重いタスクは、同じ納期なら先
{
  const r = analyze([mk('s', { due: '2026-10-20', size: 'S' }), mk('l', { due: '2026-10-20', size: 'L' })], T);
  assert.ok(r.items.get('l').score > r.items.get('s').score);
}

// 前提タスク: 待ちになり、前提が終われば解除される。前提は後ろの納期を引き継ぐ
{
  const a = mk('A', { due: '2026-11-30' });
  const b = mk('B', { due: '2026-10-09', blockedBy: ['A'] });
  const r = analyze([a, b], T);
  assert.equal(bucketOf(r, 'B'), 'blocked');
  assert.equal(r.items.get('A').effectiveDue, '2026-10-09');
  assert.equal(r.items.get('A').inheritedFrom.id, 'B');
  assert.equal(bucketOf(r, 'A'), 'now');
  const done = analyze([{ ...a, status: '完了', completedOn: T }, b], T);
  assert.equal(bucketOf(done, 'B'), 'now');
}

// 後続が多い前提ほど点数が高い
{
  const r = analyze([mk('P'), mk('Q'), mk('x', { blockedBy: ['P'] }), mk('y', { blockedBy: ['P'] })], T);
  assert.ok(r.items.get('P').score > r.items.get('Q').score);
}

// 前提の循環は無視して、どちらも待ちにならない
{
  const r = analyze([mk('X', { blockedBy: ['Y'] }), mk('Y', { blockedBy: ['X'] })], T);
  assert.notEqual(bucketOf(r, 'X'), 'blocked');
  assert.notEqual(bucketOf(r, 'Y'), 'blocked');
  assert.ok(reaches(new Map([['X', mk('X', { blockedBy: ['Y'] })], ['Y', mk('Y', { blockedBy: ['X'] })]]), 'X', 'X'));
}

// 存在しない前提 id や、自分自身を前提にしたものは無視
{
  const r = analyze([mk('Z', { blockedBy: ['nope', 'Z'] })], T);
  assert.equal(bucketOf(r, 'Z'), 'later');
}

// 古い期限切れは「要整理」、進行中は「今やる」、最近の完了は7日以内のみ
{
  const r = analyze([
    mk('old', { due: '2024-01-30' }),
    mk('wip', { status: '進行中' }),
    mk('d1', { status: '完了', completedOn: '2026-10-05' }),
    mk('d2', { status: '完了', completedOn: '2026-09-01' }),
    mk('d3', { status: '完了' }),
  ], T);
  assert.equal(bucketOf(r, 'old'), 'stale');
  assert.equal(bucketOf(r, 'wip'), 'now');
  assert.deepEqual(r.buckets.recentDone.map((t) => t.id), ['d1']);
}

console.log('priority tests OK');
