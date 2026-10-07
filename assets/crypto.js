// タスクデータの暗号化・復号（ブラウザと Node.js の両方で動く共通コード）
// 方式: パスワード → PBKDF2(SHA-256) で鍵を作る → AES-GCM で暗号化
// リポジトリは公開なので、ここに置かれるのは暗号文だけ。パスワードはコードにもリポジトリにも置かない。

const ITERATIONS = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** オブジェクトを暗号化して、そのまま JSON 保存できる形にして返す */
export async function encryptJson(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iter: ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
  };
}

/** encryptJson の結果を復号する。パスワードが違うと例外になる */
export async function decryptJson(payload, password) {
  if (payload?.v !== 1) throw new Error('未対応のデータ形式です');
  const key = await deriveKey(password, fromB64(payload.salt), payload.iter);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(payload.iv) }, key, fromB64(payload.ct));
  return JSON.parse(dec.decode(pt));
}
