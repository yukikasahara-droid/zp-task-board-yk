// 繰り返しタスクの日付計算（画面にもテストにも使う純粋な計算）。
// 書き方（repeat 列）: daily / weekdays / weekly:月 / weekly:月,木 / monthly:15 / monthly:末

const WEEK = '日月火水木金土';
const pad = (n) => String(n).padStart(2, '0');
const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const toIso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function addDaysIso(iso, n) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

/** 文字を { kind, days, dom } にする。読めなければ null */
export function parseRepeat(text) {
  const s = String(text ?? '').trim();
  if (s === 'daily') return { kind: 'daily' };
  if (s === 'weekdays') return { kind: 'weekdays' };
  let m = /^weekly:([日月火水木金土](?:,[日月火水木金土])*)$/.exec(s);
  if (m) return { kind: 'weekly', days: m[1].split(',').map((c) => WEEK.indexOf(c)) };
  m = /^monthly:(\d{1,2}|末)$/.exec(s);
  if (m) return { kind: 'monthly', dom: m[1] === '末' ? 'last' : Math.min(Math.max(Number(m[1]), 1), 31) };
  return null;
}

export function describeRepeat(text) {
  const r = parseRepeat(text);
  if (!r) return '';
  if (r.kind === 'daily') return '毎日';
  if (r.kind === 'weekdays') return '平日';
  if (r.kind === 'weekly') return `毎週 ${r.days.map((d) => WEEK[d]).join('・')}`;
  return r.dom === 'last' ? '毎月 末日' : `毎月 ${r.dom}日`;
}

export function buildRepeat(kind, value) {
  if (kind === 'daily' || kind === 'weekdays') return kind;
  if (kind === 'weekly') return value?.length ? `weekly:${value.join(',')}` : '';
  if (kind === 'monthly') return `monthly:${value}`;
  return '';
}

function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m は 1〜12

/**
 * 次の納期を返す。基準は「前回の納期」と「今日」の遅い方（遅れて完了したときに過去の日付を作らない）。
 * 基準日より後で、ルールに合う最初の日。
 */
export function nextDue(text, baseDue, today) {
  const r = parseRepeat(text);
  if (!r) return null;
  const base = baseDue && baseDue > today ? baseDue : today;

  if (r.kind === 'daily') return addDaysIso(base, 1);

  if (r.kind === 'weekdays' || r.kind === 'weekly') {
    for (let i = 1; i <= 7; i++) {
      const c = addDaysIso(base, i);
      const wd = toDate(c).getUTCDay();
      if (r.kind === 'weekdays' ? wd >= 1 && wd <= 5 : r.days.includes(wd)) return c;
    }
  }

  if (r.kind === 'monthly') {
    const b = toDate(base);
    for (let k = 0; k < 14; k++) {
      const y = b.getUTCFullYear() + Math.floor((b.getUTCMonth() + k) / 12);
      const m = ((b.getUTCMonth() + k) % 12) + 1;
      const day = r.dom === 'last' ? lastDay(y, m) : Math.min(r.dom, lastDay(y, m));
      const c = `${y}-${pad(m)}-${pad(day)}`;
      if (c > base) return c;
    }
  }
  return null;
}

/** 完了した繰り返しタスクの「次の回」の id（同じ回を2人が作っても同じ id になる） */
export const occurrenceId = (seriesId, due) => `rep-${seriesId}-${due}`;
