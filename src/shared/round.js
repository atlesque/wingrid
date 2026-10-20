import { spin, BETS, START_CREDITS, MAX_WIN } from './engine.js';
import { revealJackpot } from './jackpot.js';

// ================= ROUNDS =================
// What one press of the spin button does to a player's save. The Worker runs this and is the only place a
// save changes; the page only animates the result it gets back. The save has the same shape as Wingrid's,
// so it syncs to the same Atlesque Play progress: { credits, bet, stats, feature, lastTopUp }.
export const TOP_UP_EVERY = 60 * 60e3; // a broke player can claim START_CREDITS again after this long
export const round2 = n => Math.round(n * 100) / 100;

export const fresh = () => ({
  v: 1,
  credits: START_CREDITS,
  bet: 2, // index into BETS
  stats: { spins: 0, wagered: 0, won: 0, biggestWin: 0, biggestX: 0, features: 0, topUps: 0 },
  feature: null, // { left, played, totalMult, won, bet } while free spins are in progress
  jackpot: null, // an unclaimed, server-owned jackpot reveal; never sync its hidden deck
  lastTopUp: 0,
});

// fill in anything an older, partial or foreign save is missing
export function normalize(d) {
  const f = fresh();
  if (!d || typeof d !== 'object' || typeof d.credits !== 'number' || !isFinite(d.credits) || d.credits < 0) return f;
  const { ante, ...rest } = d; // double chance is gone; older saves may still carry it
  return {
    ...f, ...rest,
    bet: Number.isInteger(d.bet) && d.bet >= 0 && d.bet < BETS.length ? d.bet : f.bet,
    stats: { ...f.stats, ...(d.stats || {}) },
    feature: d.feature && d.feature.left > 0 ? d.feature : null,
    jackpot: null, // only the local database may restore a reserved jackpot
  };
}

export class RoundError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Payouts used by the page are credits; calculation fields remain in bets.
export const spinView = out => ({ ...out.result, kind: out.kind, bet: out.bet,
  cost: out.cost, win: out.win, event: out.event, feature: out.feature, maxWin: out.maxWin });

// Plays the next spin: a free spin while a feature is running, else a paid spin at the saved bet.
// Changes `save` in place and returns what the page needs to animate it.
export function playSpin(save, rng) {
  if (save.jackpot) throw new RoundError('in_jackpot', 'Reveal your jackpot gems first.');
  const f = save.feature;
  const b = f ? f.bet : BETS[save.bet];
  const kind = f ? 'free' : 'base';
  const cost = f ? 0 : b;
  if (save.credits < cost) throw new RoundError('no_credits', 'Not enough credits for that spin.');

  save.credits = round2(save.credits - cost);
  if (!f) save.stats.spins++;
  const r = spin(rng, { mode: f ? 'free' : 'base', totalMult: f ? f.totalMult : 0 });

  let win = round2(r.win * b);
  let event = null;
  if (f) {
    win = Math.min(win, round2(MAX_WIN * b - f.won)); // the whole feature is capped too
    f.won = round2(f.won + win);
    f.totalMult = r.totalMult;
    f.left -= 1;
    f.played += 1;
    if (r.freeSpins) { f.left += r.freeSpins; event = { type: 'feature-retrigger', spins: r.freeSpins, left: f.left }; }
    if (f.won >= MAX_WIN * b) f.left = 0;
  }
  save.credits = round2(save.credits + win);
  const s = save.stats;
  s.wagered = round2(s.wagered + cost);
  s.won = round2(s.won + win);
  if (win > s.biggestWin) s.biggestWin = round2(win);

  if (!f && r.freeSpins && r.win < MAX_WIN) {
    s.features++;
    save.feature = { left: r.freeSpins, played: 0, totalMult: 0, won: win, bet: b };
    event = { type: 'feature-start', spins: r.freeSpins };
  } else if (f && f.left <= 0) {
    save.feature = null;
    const x = f.won / f.bet;
    if (x > s.biggestX) s.biggestX = round2(x);
    if (f.won > s.biggestWin) s.biggestWin = f.won;
    event = { type: 'feature-end', played: f.played, won: f.won, totalMult: f.totalMult };
  }
  if (!f && r.win > s.biggestX) s.biggestX = round2(r.win);

  const capped = f ? f.won >= MAX_WIN * b : r.win >= MAX_WIN;
  return { kind, bet: b, cost, win, result: r, event, feature: f ? { ...f } : null,
    maxWin: capped ? { limit: MAX_WIN, won: f ? f.won : win } : null };
}

export function pickJackpot(save, index) {
  if (!save.jackpot) throw new RoundError('no_jackpot', 'There is no jackpot to reveal.');
  let complete;
  try { complete = revealJackpot(save.jackpot, index); }
  catch (error) { throw new RoundError('bad_pick', error.message); }
  const pending = save.jackpot;
  if (!complete) return { complete: false, pick: pending.picks.at(-1) };
  save.credits = round2(save.credits + pending.amount);
  save.stats.won = round2(save.stats.won + pending.amount);
  save.stats.biggestWin = Math.max(save.stats.biggestWin, pending.amount);
  save.stats.jackpots = (save.stats.jackpots || 0) + 1;
  save.jackpot = null;
  return { complete: true, pick: pending.picks.at(-1), id: pending.id, tier: pending.tier, won: pending.amount };
}

export function canTopUp(save, now = Date.now()) {
  return !save.feature && !save.jackpot && save.credits < BETS[0] && now - save.lastTopUp >= TOP_UP_EVERY;
}
export function topUp(save, now = Date.now()) {
  if (!canTopUp(save, now)) throw new RoundError('no_top_up', 'Free credits are for when you run out, once an hour.');
  save.credits = round2(save.credits + START_CREDITS);
  save.lastTopUp = now;
  save.stats.topUps++;
}

export function setBet(save, { bet }) {
  if (save.jackpot) throw new RoundError('in_jackpot', 'Reveal your jackpot gems first.');
  if (save.feature) throw new RoundError('in_feature', 'Finish the free spins first.');
  if (bet !== undefined) {
    if (!Number.isInteger(bet) || bet < 0 || bet >= BETS.length) throw new RoundError('bad_bet', 'That bet is not on the list.');
    save.bet = bet;
  }
}
