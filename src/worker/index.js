import { secureRandom, BETS, START_CREDITS } from '../shared/engine.js';
import { fresh, normalize, playSpin, spinView, pickJackpot, topUp, setBet, canTopUp, RoundError, TOP_UP_EVERY, round2 } from '../shared/round.js';
import { JACKPOTS, JACKPOT_MIN_BET, JACKPOT_CHANCE_PER_CREDIT, JACKPOT_MAX_CHANCE, JACKPOT_COOLDOWN_SPINS, jackpotTier, jackpotReady, jackpotDeck, publicJackpot } from '../shared/jackpot.js';

// ================= STARLIGHT API =================
// The Worker owns every player's credits: the page asks it to spin and animates what comes back. A browser
// starts as a guest (POST /api/guest gives it a session token). Signing in with Atlesque Play links the
// player to that account; from then on the save also goes up to Atlesque Play after each change, and the
// same account on any device plays from the same credits.
//
//   POST /api/guest                       → { token, state }
//   GET  /api/state                       → { state }
//   POST /api/spin     { buy? }           → { spin, state }
//   POST /api/bet      { bet?, ante? }    → { state }
//   POST /api/topup                       → { state }
//   POST /api/signin   { code, code_verifier, redirect_uri } → { state }
//   POST /api/signout                     → {}
//   GET  /api/config                      → { playUrl, gameId, bets, startCredits }
// Every call but /api/guest and /api/config sends `Authorization: Bearer <token>`.

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/starlight/')) return art(req, env, url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await route(req, env, url, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      if (e instanceof RoundError) return json({ error: e.code, message: e.message }, 400);
      console.error(e);
      return json({ error: 'server', message: 'Something went wrong. Try again.' }, 500);
    }
  },
};

// ---- art ----
// public/starlight/ is git-ignored, so a build from the repo has no art in its static assets. Deployed, the art
// lives in the R2 bucket bound as ART (uploaded with `npm run art:upload`, keyed by URL path). Locally that bucket
// is empty and the request falls through to the static assets, which Vite serves from public/.
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', json: 'application/json', atlas: 'text/plain; charset=utf-8',
  css: 'text/css; charset=utf-8', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', wav: 'audio/wav', woff: 'font/woff', woff2: 'font/woff2' };
async function art(req, env, url) {
  if (!env.ART || !['GET', 'HEAD'].includes(req.method)) return env.ASSETS.fetch(req);
  const obj = await env.ART.get(decodeURIComponent(url.pathname.slice(1)), { range: req.headers, onlyIf: req.headers });
  if (!obj) return env.ASSETS.fetch(req);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has('content-type')) headers.set('content-type', TYPES[url.pathname.split('.').pop().toLowerCase()] || 'application/octet-stream');
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=3600');
  if (!('body' in obj)) return new Response(null, { status: 304, headers });
  if (obj.range && req.headers.has('range')) {
    const r = obj.range, offset = r.suffix != null ? obj.size - r.suffix : r.offset || 0, length = r.suffix != null ? r.suffix : r.length ?? obj.size - offset;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    return new Response(req.method === 'HEAD' ? null : obj.body, { status: 206, headers });
  }
  return new Response(req.method === 'HEAD' ? null : obj.body, { headers });
}

async function route(req, env, url, ctx) {
  const p = url.pathname, m = req.method;
  if (m === 'POST' && req.headers.get('origin') !== url.origin) throw new HttpError(403, 'bad_origin', 'That request did not come from this site.');
  if (p === '/api/config' && m === 'GET') return json({ playUrl: env.PLAY_URL, gameId: env.PLAY_GAME_ID, bets: BETS, startCredits: START_CREDITS, topUpEvery: TOP_UP_EVERY,
    jackpots: { tiers: await poolsView(env), minBet: JACKPOT_MIN_BET, chancePerCredit: JACKPOT_CHANCE_PER_CREDIT,
      maxChance: JACKPOT_MAX_CHANCE, cooldownSpins: JACKPOT_COOLDOWN_SPINS } });
  if (p === '/api/guest' && m === 'POST') return newGuest(env);

  const session = await auth(req, env);
  if (p === '/api/state' && m === 'GET') {
    if (session.play_token) await pullFromPlay(env, session);
    return json({ state: await view(env, session) });
  }
  if (p === '/api/spin' && m === 'POST') {
    const { buy = false } = await body(req);
    let out;
    await change(env, session, async (save, player) => {
      const rng = secureRandom();
      out = playSpin(save, rng, { buy: !!buy });
      const statements = [env.DB.prepare('INSERT INTO spins (player_id, kind, bet, cost, win, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(player.id, out.kind, out.bet, out.cost, out.win, Date.now())];
      // Optional jackpots are separate from the 5,000x slot-feature cap and only
      // trigger at the end of paid base/ante spins which do not start free spins,
      // and never again until the player has played JACKPOT_COOLDOWN_SPINS more paid spins.
      const tier = ['base', 'ante'].includes(out.kind) && !save.feature && jackpotReady(save.stats) ? jackpotTier(rng, out.cost) : null;
      if (tier) {
        const definition = JACKPOTS.find(t => t.id === tier);
        const pool = await env.DB.prepare('SELECT * FROM jackpot_pools WHERE tier = ?').bind(tier).first();
        const amount = round2(Math.min(definition.cap, pool.amount + out.cost * definition.contribution));
        const id = crypto.randomUUID();
        save.jackpot = { id, tier, amount, deck: jackpotDeck(rng, tier), picks: [] };
        save.stats.lastJackpotSpin = save.stats.spins;
        out.event = { type: 'jackpot-start' };
        statements.push(env.DB.prepare('UPDATE jackpot_pools SET amount = ?, version = version + 1 WHERE tier = ? AND version = ?')
          .bind(definition.seed, tier, pool.version), mutationGuard(env),
        env.DB.prepare('INSERT INTO jackpot_awards (id, player_id, tier, amount, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(id, player.id, tier, amount, Date.now()));
      }
      if (out.cost > 0) for (const definition of JACKPOTS) {
        if (definition.id === tier) continue;
        statements.push(env.DB.prepare('UPDATE jackpot_pools SET amount = MIN(?, ROUND(amount + ?, 4)), version = version + 1 WHERE tier = ?')
          .bind(definition.cap, out.cost * definition.contribution, definition.id));
      }
      return statements;
    });
    const state = await view(env, session);
    return json({ spin: spinView(out), state });
  }
  if (p === '/api/jackpot/pick' && m === 'POST') {
    const { id, index } = await body(req);
    let result;
    await change(env, session, save => {
      if (!save.jackpot || id !== save.jackpot.id) throw new RoundError('no_jackpot', 'That jackpot is no longer open.');
      result = pickJackpot(save, index);
      return result.complete ? [env.DB.prepare('UPDATE jackpot_awards SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL')
        .bind(Date.now(), result.id), mutationGuard(env)] : [];
    });
    return json({ result, state: await view(env, session) });
  }
  if (p === '/api/bet' && m === 'POST') {
    const b = await body(req);
    await change(env, session, save => setBet(save, b), { push: false });
    return json({ state: await view(env, session) });
  }
  if (p === '/api/topup' && m === 'POST') {
    await change(env, session, save => topUp(save));
    return json({ state: await view(env, session) });
  }
  if (p === '/api/signin' && m === 'POST') return signIn(req, env, session);
  if (p === '/api/signout' && m === 'POST') {
    if (session.play_token) ctx.waitUntil(fetch(`${env.PLAY_URL}/api/logout`, { method: 'POST', headers: { authorization: `Bearer ${session.play_token}` } }).catch(() => {}));
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session.token_hash).run();
    return json({});
  }
  throw new HttpError(404, 'not_found', 'No such endpoint.');
}

async function body(req) {
  try { const b = await req.json(); return b && typeof b === 'object' ? b : {}; } catch (e) { return {}; }
}

// ---- sessions ----
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');

async function newGuest(env) {
  const now = Date.now(), id = crypto.randomUUID(), token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const s = fresh();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO players (id, credits, bet, ante, stats, feature, last_top_up, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?)')
      .bind(id, s.credits, s.bet, s.ante ? 1 : 0, JSON.stringify(s.stats), now, now),
    env.DB.prepare('INSERT INTO sessions (token_hash, player_id, created_at, last_seen) VALUES (?, ?, ?, ?)').bind(await sha256(token), id, now, now),
  ]);
  return json({ token, state: await view(env, { player_id: id }) });
}

async function auth(req, env) {
  const m = /^Bearer (\S+)$/.exec(req.headers.get('authorization') || '');
  if (!m) throw new HttpError(401, 'no_session', 'Start a session first.');
  const hash = await sha256(m[1]);
  const s = await env.DB.prepare('SELECT * FROM sessions WHERE token_hash = ?').bind(hash).first();
  if (!s) throw new HttpError(401, 'no_session', 'That session has ended.');
  if (Date.now() - s.last_seen > 60e3) await env.DB.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').bind(Date.now(), hash).run();
  return s;
}

// ---- saves ----
const toSave = row => ({ ...normalize({
  v: 1, credits: row.credits, bet: row.bet, ante: !!row.ante, stats: JSON.parse(row.stats),
  feature: row.feature ? JSON.parse(row.feature) : null, lastTopUp: row.last_top_up,
}), jackpot: row.jackpot ? JSON.parse(row.jackpot) : null });
const player = (env, id) => env.DB.prepare('SELECT * FROM players WHERE id = ?').bind(id).first();

function writeSave(env, row, save, extra = {}) {
  const sets = { credits: save.credits, bet: save.bet, ante: save.ante ? 1 : 0, stats: JSON.stringify(save.stats),
    feature: save.feature ? JSON.stringify(save.feature) : null, jackpot: save.jackpot ? JSON.stringify(save.jackpot) : null,
    last_top_up: save.lastTopUp, updated_at: Date.now(), ...extra };
  const cols = Object.keys(sets);
  return env.DB.prepare(`UPDATE players SET ${cols.map(c => `${c} = ?`).join(', ')}, version = version + 1 WHERE id = ? AND version = ?`)
    .bind(...cols.map(c => sets[c]), row.id, row.version);
}

// Read the save, let `fn` change it, and write it back unless another request changed it first.
async function change(env, session, fn, { push = true } = {}) {
  const row = await player(env, session.player_id);
  const save = toSave(row);
  const more = await fn(save, row) || [];
  let res;
  try { [res] = await env.DB.batch([writeSave(env, row, save), mutationGuard(env), ...more]); }
  catch (error) {
    if (String(error.cause?.message || error.message).includes('current_version')) throw new HttpError(409, 'busy', 'Another action finished first. Try again.');
    throw error;
  }
  if (!res.meta.changes) throw new HttpError(409, 'busy', 'Another spin is still being played. Try again.');
  if (push && session.play_token) await pushToPlay(env, session);
  return save;
}

const mutationGuard = env => env.DB.prepare('INSERT OR REPLACE INTO mutation_guard (id, ok) VALUES (1, changes())');
async function poolsView(env) {
  const { results } = await env.DB.prepare('SELECT tier, amount FROM jackpot_pools').all();
  return JACKPOTS.map(tier => ({ ...tier, amount: round2(results.find(r => r.tier === tier.id).amount) }));
}

// what the page shows
async function view(env, session) {
  const row = await player(env, session.player_id);
  const save = toSave(row);
  return { ...save, jackpot: publicJackpot(save.jackpot), jackpots: await poolsView(env), betAmount: BETS[save.bet], canTopUp: canTopUp(save), nextTopUp: save.lastTopUp + TOP_UP_EVERY,
    account: session.play_token ? { email: row.play_email } : null };
}

// ---- Atlesque Play ----
// The save goes up as the game's progress, with the revision it builds on. When the account's copy moved on
// without us (Wingrid on another device, an admin reset), the account's copy wins and replaces the save here.
async function play(env, session, path, opts = {}) {
  const res = await fetch(env.PLAY_URL + path, { ...opts, headers: { 'content-type': 'application/json', authorization: `Bearer ${session.play_token}`, ...opts.headers }, signal: AbortSignal.timeout(4000) });
  const b = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    // signed out everywhere, or banned: carry on as this player, no longer synced
    await env.DB.prepare('UPDATE sessions SET play_token = NULL WHERE token_hash = ?').bind(session.token_hash).run();
    session.play_token = null;
  }
  return { status: res.status, body: b };
}

async function adopt(env, session, data, rev) {
  const row = await player(env, session.player_id);
  if (row.jackpot) return; // a sync response may arrive after another tab reserved a prize
  await writeSave(env, row, data ? normalize(data) : fresh(), { play_rev: rev }).run();
}

async function pushToPlay(env, session) {
  try {
    const row = await player(env, session.player_id);
    if (row.jackpot) return; // reserve/reveal remains local until its award is claimed
    const r = await play(env, session, `/api/games/${env.PLAY_GAME_ID}/progress`, { method: 'PUT', body: JSON.stringify({ data: toSave(row), rev: row.play_rev || 0 }) });
    if (r.status === 200) await env.DB.prepare('UPDATE players SET play_rev = ? WHERE id = ?').bind(r.body.rev, row.id).run();
    else if (r.status === 409) await adopt(env, session, r.body.data, r.body.rev);
  } catch (e) { console.warn('Atlesque Play push failed', e.message); } // tried again after the next change
}

async function pullFromPlay(env, session) {
  try {
    const row = await player(env, session.player_id);
    if (row.jackpot) return;
    const r = await play(env, session, `/api/games/${env.PLAY_GAME_ID}/progress`);
    if (r.status !== 200 || r.body.rev === row.play_rev) return;
    if (r.body.data || row.play_rev != null) await adopt(env, session, r.body.data, r.body.rev);
  } catch (e) { console.warn('Atlesque Play pull failed', e.message); }
}

// Back from the Atlesque Play sign-in page: swap its one-time code for a token, then line the save up with the
// account. An account this game already knows takes over this session; else the account's saved progress, if
// it has any, replaces the guest's, and if not the guest's progress goes up into the account.
async function signIn(req, env, session) {
  const { code, code_verifier, redirect_uri } = await body(req);
  if (!code || !code_verifier || !redirect_uri) throw new HttpError(400, 'bad_request', 'That sign-in is incomplete. Try again.');
  let r;
  try {
    const res = await fetch(`${env.PLAY_URL}/api/token`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier, client: env.PLAY_GAME_ID, redirect_uri }), signal: AbortSignal.timeout(6000) });
    r = { status: res.status, body: await res.json().catch(() => ({})) };
  } catch (e) { throw new HttpError(502, 'play_down', 'Could not reach Atlesque Play. Try again in a moment.'); }
  if (r.status !== 200) throw new HttpError(400, r.body.error || 'signin_failed', r.body.message || 'Sign-in failed. Try again.');
  const { token, user } = r.body;

  const known = await env.DB.prepare('SELECT id FROM players WHERE play_user_id = ?').bind(user.id).first();
  if (known) {
    await env.DB.prepare('UPDATE sessions SET player_id = ?, play_token = ? WHERE token_hash = ?').bind(known.id, token, session.token_hash).run();
    Object.assign(session, { player_id: known.id, play_token: token });
    await pullFromPlay(env, session);
  } else {
    await env.DB.batch([
      env.DB.prepare('UPDATE players SET play_user_id = ?, play_email = ?, play_rev = NULL WHERE id = ?').bind(user.id, user.email, session.player_id),
      env.DB.prepare('UPDATE sessions SET play_token = ? WHERE token_hash = ?').bind(token, session.token_hash),
    ]);
    session.play_token = token;
    const g = await play(env, session, `/api/games/${env.PLAY_GAME_ID}/progress`);
    if (g.status === 200 && g.body.data) await adopt(env, session, g.body.data, g.body.rev);
    else if (g.status === 200) {
      await env.DB.prepare('UPDATE players SET play_rev = ? WHERE id = ?').bind(g.body.rev, session.player_id).run();
      await pushToPlay(env, session);
    }
  }
  if (known) await env.DB.prepare('UPDATE players SET play_email = ? WHERE id = ?').bind(user.email, known.id).run();
  return json({ state: await view(env, session) });
}
