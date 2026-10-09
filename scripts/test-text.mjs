import assert from 'node:assert/strict';
import { parseLinks, fmtMinutes } from '../next/text.js';

assert.deepEqual(parseLinks('図面 | https://example.com/a\nhttps://www.drive.google.com/x'), [
  { label: '図面', url: 'https://example.com/a' },
  { label: 'drive.google.com', url: 'https://www.drive.google.com/x' },
]);
// 危険なリンクや、ただの文章は読み飛ばす
assert.deepEqual(parseLinks('x | javascript:alert(1)\nメモだけ\n\nftp://a.b/c\n| https://ok.example'), [{ label: 'ok.example', url: 'https://ok.example' }]);
assert.deepEqual(parseLinks(null), []);
assert.equal(fmtMinutes(90), '1時間30分');
assert.equal(fmtMinutes(45), '45分');
assert.equal(fmtMinutes(480), '8時間');
assert.equal(fmtMinutes(0), '0分');
assert.equal(fmtMinutes('x'), '0分');
console.log('text tests OK');
