// ================= ATLESQUE PLAY ACCOUNT =================
// Players can play as guests (credits stay in this browser) or sign in with their Atlesque Play account
// (github.com/atlesque/mbp-games). Signing in sends the player to the hosted sign-in page and back with a
// one-time code, swapped here for a token (PKCE, so the code is useless to anyone else). Signed in, the
// credits and stats sync to the account after spins, every SYNC_EVERY and when the page closes. Each save
// names the copy (rev) it builds on; when the account's copy moved on without us (another device, an admin
// reset), the account's copy wins and replaces ours.
export const GAME_ID = 'wingrid';
export const SYNC_EVERY = 60e3;
const KEY = 'wingrid_account', PENDING = 'wingrid_signin';
// `?debug&accounts=http://localhost:8787` points a dev build at a local copy of the service
const override = /[?&]debug\b/.test(location.search) && new URLSearchParams(location.search).get('accounts');
export const ACCOUNTS_URL = override || 'https://play.atlesque.dev';

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
// { token, user: { id, email }, rev, syncedAt, sent } once signed in; rev is the account copy we last agreed with
let acct = store.get(KEY);
const persist = () => store.set(KEY, acct);
export const account = () => acct;

// what the menus show; they listen through onAccount
export const status = { banned: null, error: null, busy: false };
const listeners = [];
export function onAccount(fn) { listeners.push(fn); }
const changed = (what) => { for (const fn of listeners) fn(what); };

// set by the game: how to read the progress to save, and how to replace it with the account's copy
let hooks = { read: () => ({}), replace: () => {} };
export function setHooks(h) { hooks = h; }

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
// where the sign-in page sends the player back to: this page, minus our own query parameters
function backUrl() {
  const u = new URL(location.href);
  u.searchParams.delete('mbpg_code'); u.searchParams.delete('mbpg_state'); u.hash = '';
  return u.toString();
}

export async function beginSignIn() {
  const verifier = random(48), state = random(16), redirect = backUrl();
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  store.set(PENDING, { verifier, state, redirect });
  location.assign(`${ACCOUNTS_URL}/signin?` + new URLSearchParams({ client: GAME_ID, redirect_uri: redirect, state, code_challenge: challenge }));
}

async function api(path, opts = {}) {
  const res = await fetch(ACCOUNTS_URL + path, { ...opts, headers: { 'content-type': 'application/json', ...(acct ? { authorization: `Bearer ${acct.token}` } : {}), ...opts.headers } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 || (res.status === 403 && body.error === 'banned')) {
    // signed out elsewhere, or banned: carry on as a guest with what's in this browser
    acct = null; persist();
    status.banned = body.error === 'banned' ? body.message : null;
    changed(body.error === 'banned' ? 'banned' : 'signed-out');
    throw Object.assign(new Error(body.message || 'Signed out'), { code: body.error });
  }
  return { status: res.status, body };
}

// Back from the sign-in page with ?mbpg_code: swap the code for a token. Runs once at boot.
export async function finishSignIn() {
  const q = new URLSearchParams(location.search);
  const code = q.get('mbpg_code'), state = q.get('mbpg_state');
  if (!code) return false;
  history.replaceState(null, '', backUrl());
  const p = store.get(PENDING); store.set(PENDING, null);
  if (!p || p.state !== state) { status.error = 'That sign-in was started in another browser. Try again here.'; return false; }
  try {
    const r = await api('/api/token', { method: 'POST', body: JSON.stringify({ code, code_verifier: p.verifier, client: GAME_ID, redirect_uri: p.redirect }) });
    if (r.status !== 200) { status.error = r.body.message || 'Sign-in failed. Try again.'; return false; }
    acct = { token: r.body.token, user: r.body.user }; persist();
    status.banned = null; status.error = null;
    changed('signed-in');
    return true;
  } catch (e) { status.error = status.error || 'Could not reach Atlesque Play. Try again in a moment.'; return false; }
}

export async function signOut() {
  const t = acct && acct.token;
  acct = null; persist(); changed('signed-out');
  if (t) fetch(ACCOUNTS_URL + '/api/logout', { method: 'POST', headers: { authorization: `Bearer ${t}` } }).catch(() => {});
}

function adopt(data, rev) {
  hooks.replace(data);
  acct.rev = rev; acct.syncedAt = Date.now(); acct.sent = JSON.stringify(hooks.read()); persist();
}

// At boot (after the local save is loaded), line this browser's progress up with the account's copy.
// The first time an account meets this browser, its copy wins if it has one, else the guest progress here
// goes up into it.
export async function connect() {
  if (!acct) return null;
  let r;
  try { r = await api(`/api/games/${GAME_ID}/progress`); } catch (e) { return null; }
  if (r.status !== 200) return null;
  if (r.body.data && acct.rev !== r.body.rev) { adopt(r.body.data, r.body.rev); return 'loaded'; }
  if (!r.body.data && acct.rev != null && acct.rev !== r.body.rev) { adopt(null, r.body.rev); return 'reset'; }
  const first = acct.rev == null;
  if (first) acct.rev = r.body.rev;
  return (await sync()) === 'saved' && first ? 'uploaded' : 'synced';
}

// Push the progress up if it changed since the last push. Returns 'saved', 'same', 'replaced' or 'offline'.
let inFlight = null;
export function sync() {
  if (!acct) return Promise.resolve('guest');
  if (inFlight) return inFlight;
  const data = hooks.read(), json = JSON.stringify(data);
  if (json === acct.sent) return Promise.resolve('same');
  status.busy = true;
  inFlight = (async () => {
    try {
      const r = await api(`/api/games/${GAME_ID}/progress`, { method: 'PUT', body: JSON.stringify({ data, rev: acct.rev || 0 }) });
      if (r.status === 200) { acct.rev = r.body.rev; acct.syncedAt = Date.now(); acct.sent = json; persist(); return 'saved'; }
      if (r.status === 409) { adopt(r.body.data, r.body.rev); return 'replaced'; }
      return 'offline';
    } catch (e) { return 'offline'; } finally { status.busy = false; inFlight = null; changed('synced'); }
  })();
  return inFlight;
}

// Closing the tab: one last push that outlives the page.
export function syncOnLeave() {
  if (!acct) return;
  const data = hooks.read(), json = JSON.stringify(data);
  if (json === acct.sent) return;
  try {
    // rev stays as it was: if this lands, the next boot sees the account one ahead and loads this very copy;
    // if it doesn't, the revs still match and the next boot pushes it again
    fetch(`${ACCOUNTS_URL}/api/games/${GAME_ID}/progress`, { method: 'PUT', keepalive: true, headers: { 'content-type': 'application/json', authorization: `Bearer ${acct.token}` }, body: JSON.stringify({ data, rev: acct.rev || 0 }) });
  } catch (e) {}
}
