// ================= SERVER =================
// The page never decides a spin: it asks the Worker and animates the answer. This browser keeps only its
// session token; credits, bet and progress live in the Worker's database.
const KEY = 'starlight_session', PENDING = 'starlight_signin';
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
let token = store.get(KEY);

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, b.error, b.message || 'Something went wrong.');
  return b;
}

async function newGuest() {
  const r = await call('/api/guest', { method: 'POST' });
  token = r.token; store.set(KEY, token);
  return r.state;
}

// A session lost on the server (or never started) quietly becomes a fresh guest.
async function authed(path, opts) {
  try { return await call(path, opts); } catch (e) {
    if (e.status !== 401) throw e;
    await newGuest();
    return call(path, opts);
  }
}

export const config = () => call('/api/config');
export async function start() {
  if (!token) return newGuest();
  return (await authed('/api/state')).state;
}
export const spin = (buy = false) => authed('/api/spin', { method: 'POST', body: { buy } });
export const pickJackpot = (id, index) => authed('/api/jackpot/pick', { method: 'POST', body: { id, index } });
export const setBet = b => authed('/api/bet', { method: 'POST', body: b }).then(r => r.state);
export const topUp = () => authed('/api/topup', { method: 'POST' }).then(r => r.state);

// ---- Atlesque Play sign-in (PKCE): the hosted sign-in page sends the player back with a one-time code,
// which the Worker swaps for the account token, so the token never sits in this page ----
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
function backUrl() {
  const u = new URL(location.href);
  u.searchParams.delete('mbpg_code'); u.searchParams.delete('mbpg_state'); u.hash = '';
  return u.toString();
}

export async function beginSignIn({ playUrl, gameId }) {
  const verifier = random(48), state = random(16), redirect = backUrl();
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  store.set(PENDING, { verifier, state, redirect });
  location.assign(`${playUrl}/signin?` + new URLSearchParams({ client: gameId, redirect_uri: redirect, state, code_challenge: challenge }));
}

// Back from the sign-in page with ?mbpg_code: returns the new state, or null when there was nothing to finish.
export async function finishSignIn() {
  const q = new URLSearchParams(location.search);
  const code = q.get('mbpg_code'), state = q.get('mbpg_state');
  if (!code) return null;
  history.replaceState(null, '', backUrl());
  const p = store.get(PENDING); store.set(PENDING, null);
  if (!p || p.state !== state) throw new ApiError(400, 'bad_state', 'That sign-in was started in another browser. Try again here.');
  if (!token) await newGuest();
  return (await authed('/api/signin', { method: 'POST', body: { code, code_verifier: p.verifier, redirect_uri: p.redirect } })).state;
}

// Signing out leaves the account's credits with the account; this browser starts again as a new guest.
export async function signOut() {
  await call('/api/signout', { method: 'POST' }).catch(() => {});
  token = null; store.set(KEY, null);
  return newGuest();
}
