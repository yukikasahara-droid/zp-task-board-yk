// 繰り返しの日付計算の動作確認: node scripts/test-repeat.mjs
import assert from 'node:assert/strict';
import { parseRepeat, describeRepeat, nextDue, buildRepeat, addDaysIso } from '../next/repeat.js';

// 2026-10-09 は金曜日
assert.equal(addDaysIso('2026-10-31', 1), '2026-11-01');
assert.equal(describeRepeat('weekly:月,木'), '毎週 月・木');
assert.equal(describeRepeat('monthly:末'), '毎月 末日');
assert.equal(parseRepeat('nonsense'), null);
assert.equal(parseRepeat(''), null);
assert.equal(buildRepeat('weekly', ['月', '木']), 'weekly:月,木');
assert.equal(buildRepeat('weekly', []), '');

// 毎日: 期限内に完了 → 前回の納期の翌日。遅れて完了 → 今日の翌日
assert.equal(nextDue('daily', '2026-10-12', '2026-10-09'), '2026-10-13');
assert.equal(nextDue('daily', '2026-10-01', '2026-10-09'), '2026-10-10');
assert.equal(nextDue('daily', null, '2026-10-09'), '2026-10-10');

// 平日: 金曜に完了 → 次の月曜
assert.equal(nextDue('weekdays', '2026-10-09', '2026-10-09'), '2026-10-12');
assert.equal(nextDue('weekdays', '2026-10-08', '2026-10-08'), '2026-10-09');

// 毎週 月・木: 金曜に完了 → 月曜。月曜に完了 → 木曜
assert.equal(nextDue('weekly:月,木', '2026-10-09', '2026-10-09'), '2026-10-12');
assert.equal(nextDue('weekly:月,木', '2026-10-12', '2026-10-12'), '2026-10-15');
assert.equal(nextDue('weekly:金', '2026-10-09', '2026-10-09'), '2026-10-16');

// 毎月15日 / 末日 / 31日（短い月は月末に丸める）
assert.equal(nextDue('monthly:15', '2026-10-15', '2026-10-15'), '2026-11-15');
assert.equal(nextDue('monthly:15', '2026-10-01', '2026-10-09'), '2026-10-15');
assert.equal(nextDue('monthly:末', '2026-10-31', '2026-10-31'), '2026-11-30');
assert.equal(nextDue('monthly:31', '2026-01-31', '2026-01-31'), '2026-02-28');
assert.equal(nextDue('monthly:15', '2026-12-15', '2026-12-20'), '2027-01-15'); // 年またぎ

assert.equal(nextDue('none', '2026-10-09', '2026-10-09'), null);
console.log('repeat tests OK');
