// 優先度の計算と、「今やる / 待ち / あとで / 要整理 / 最近の完了」への振り分け。
// 画面にもテストにも使う純粋な計算だけを置く（通信・画面の処理は入れない）。

export const STALE_DAYS = 60;   // 納期をこれ以上過ぎた未完了は「要整理」に回す
export const NOW_DAYS = 7;      // 納期がこの日数以内なら「今やる」
export const RECENT_DONE_DAYS = 7;

const URGENCY_STEPS = [[0, 95], [1, 85], [3, 70], [7, 50], [14, 30]];
const SIZE_POINTS = { L: 12, M: 6, S: 0 };

/** 'YYYY-MM-DD' 同士の日数差（b - a）。 */
export function daysBetween(a, b) {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

export const isOpen = (t) => t.status !== '完了';

function urgencyPoints(daysLeft) {
  if (daysLeft == null) return 8;
  if (daysLeft < 0) return 100 + Math.min(-daysLeft, 30) * 0.5;
  for (const [limit, pts] of URGENCY_STEPS) if (daysLeft <= limit) return pts;
  return 15;
}

/** from から blockedBy をたどって target に着くか（前提の循環チェック用）。 */
export function reaches(byId, from, target, seen = new Set()) {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  const t = byId.get(from);
  return !!t && t.blockedBy.some((b) => reaches(byId, b, target, seen));
}

/**
 * 未完了タスクごとに、優先度の点数・振り分け先・補足情報を計算する。
 * 戻り値: { items: Map(id → info), buckets: { now, blocked, later, stale, recentDone } }
 * info = { task, score, bucket, daysLeft, effectiveDue, inheritedFrom, openBlockers, dependents }
 */
export function analyze(tasks, today) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const open = tasks.filter(isOpen);

  // 前提が循環していたら、その辺は無視する（永遠に待ちにならないように）
  const blockersOf = (t) =>
    t.blockedBy
      .map((id) => byId.get(id))
      .filter((b) => b && isOpen(b) && b.id !== t.id && !reaches(byId, b.id, t.id));

  const openBlockers = new Map(open.map((t) => [t.id, blockersOf(t)]));
  const dependents = new Map(open.map((t) => [t.id, []]));
  for (const t of open) for (const b of openBlockers.get(t.id)) dependents.get(b.id).push(t);

  // 実効納期: 自分の納期と、自分を待っているタスクの実効納期のうち早い方
  const memo = new Map();
  const effective = (t) => {
    if (memo.has(t.id)) return memo.get(t.id);
    memo.set(t.id, { due: t.due || null, from: null }); // 循環防止の仮置き
    let best = { due: t.due || null, from: null };
    for (const d of dependents.get(t.id) ?? []) {
      const e = effective(d);
      if (e.due && (!best.due || e.due < best.due)) best = { due: e.due, from: d };
    }
    memo.set(t.id, best);
    return best;
  };

  const items = new Map();
  for (const t of open) {
    const eff = effective(t);
    const daysLeft = eff.due ? daysBetween(today, eff.due) : null;
    const ownLeft = t.due ? daysBetween(today, t.due) : null;
    const blockers = openBlockers.get(t.id);
    const deps = dependents.get(t.id);

    let score = urgencyPoints(daysLeft);
    score += SIZE_POINTS[t.size] ?? 0;
    if (daysLeft != null && t.size === 'L' && daysLeft <= 3) score += 10; // 重いのに間に合わない
    if (daysLeft != null && t.size === 'M' && daysLeft <= 1) score += 5;
    score += Math.min(deps.length * 8, 24);
    if (t.status === '進行中') score += 5;
    if (daysLeft == null && t.assignedOn) score += Math.min(Math.max(daysBetween(t.assignedOn, today), 0) / 5, 12);

    let bucket;
    if (ownLeft != null && ownLeft < -STALE_DAYS) bucket = 'stale';
    else if (blockers.length) bucket = 'blocked';
    else if ((daysLeft != null && daysLeft <= NOW_DAYS) || t.status === '進行中') bucket = 'now';
    else bucket = 'later';

    items.set(t.id, {
      task: t,
      score,
      bucket,
      daysLeft,
      ownLeft,
      effectiveDue: eff.due,
      inheritedFrom: eff.from && eff.due !== t.due ? eff.from : null,
      openBlockers: blockers,
      dependents: deps,
    });
  }

  const byScore = (a, b) =>
    b.score - a.score ||
    (a.effectiveDue ?? '9999').localeCompare(b.effectiveDue ?? '9999') ||
    (a.task.assignedOn ?? '').localeCompare(b.task.assignedOn ?? '');
  const pick = (name) => [...items.values()].filter((i) => i.bucket === name).sort(byScore);

  const recentDone = tasks
    .filter((t) => !isOpen(t) && t.completedOn && daysBetween(t.completedOn, today) <= RECENT_DONE_DAYS)
    .sort((a, b) => b.completedOn.localeCompare(a.completedOn) || b.updatedAt?.localeCompare(a.updatedAt ?? '') || 0);

  return {
    items,
    buckets: { now: pick('now'), blocked: pick('blocked'), later: pick('later'), stale: pick('stale'), recentDone },
  };
}
