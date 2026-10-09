// 表示用の小さな部品（リンクの読み取り、時間の表記）。

/**
 * 「ラベル | https://…」または「https://…」の行を読む。
 * http / https 以外（javascript: など）は、リンクとして使わない。
 */
export function parseLinks(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    const bar = s.indexOf('|');
    const label = bar >= 0 ? s.slice(0, bar).trim() : '';
    const url = (bar >= 0 ? s.slice(bar + 1) : s).trim();
    if (!/^https?:\/\/\S+$/i.test(url)) continue;
    let host = url;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { continue; }
    out.push({ label: label || host, url });
  }
  return out;
}

/** 90 → "1時間30分"、45 → "45分"、480 → "8時間" */
export function fmtMinutes(min) {
  const m = Math.round(Number(min) || 0);
  if (m <= 0) return '0分';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}分`;
  return r ? `${h}時間${r}分` : `${h}時間`;
}
