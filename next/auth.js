// Google ログイン（Google Identity Services）。取得したトークンでスプレッドシートを読み書きする。
import { CONFIG } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets openid email profile';
const HINT_KEY = 'zp-board-hint';

let tokenClient = null;
let token = null;
let expiresAt = 0;
let pending = null;
export let profile = null; // { name, email }

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 保存できなくても動く */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 同上 */ } },
};

function loadGsi() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google ログインの部品を読み込めませんでした（ネットワークを確認してください）'));
    document.head.append(s);
  });
}

export async function initAuth() {
  await loadGsi();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.clientId,
    scope: SCOPE,
    callback: () => {},
    error_callback: () => {},
  });
}

export const hasHint = () => !!store.get(HINT_KEY);

/** prompt: '' は同意済みなら画面なしで更新、'select_account' は毎回選ばせる */
function request(prompt) {
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error_description || resp.error));
      token = resp.access_token;
      expiresAt = Date.now() + (Number(resp.expires_in) - 60) * 1000;
      resolve(token);
    };
    tokenClient.error_callback = (err) => reject(new Error(err?.type === 'popup_closed' ? 'ログインが中断されました' : (err?.message || 'ログインに失敗しました')));
    const hint = store.get(HINT_KEY) || undefined;
    tokenClient.requestAccessToken({ prompt, hint });
  }).finally(() => { pending = null; });
  return pending;
}

async function fetchProfile() {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('ログイン情報を取得できませんでした');
  const j = await res.json();
  profile = { name: j.name || j.email, email: j.email };
  store.set(HINT_KEY, j.email);
  return profile;
}

/** ボタンを押したときに呼ぶ（ポップアップが開く） */
export async function signIn() {
  await request('select_account');
  return fetchProfile();
}

/** 前回ログインした人は、画面なしで入り直す。できなければ例外 */
export async function silentSignIn() {
  await request('');
  return fetchProfile();
}

export async function getToken({ force = false } = {}) {
  if (!force && token && Date.now() < expiresAt) return token;
  return request('');
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null;
  profile = null;
  expiresAt = 0;
  store.del(HINT_KEY);
}
