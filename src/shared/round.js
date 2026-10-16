import { spin, spinCost, BETS, START_CREDITS, MAX_WIN } from './engine.js';

// ================= ROUNDS =================
// What one press of the spin button does to a player's save. The Worker runs this and is the only place a
// save changes; the page only animates the result it gets back. The save has the same shape as Wingrid's,
// so it syncs to the same Atlesque Play progress: { credits, bet, ante, stats, feature, lastTopUp }.
export const TOP_UP_EVERY = 60 * 60e3; // a broke player can claim START_CREDITS again after this long
export const round2 = n => Math.round(n * 100) / 100;

export const fresh = () => ({
  v: 1,
  credits: START_CREDITS,
  bet: 2, // index into BETS
  ante: false,
  stats: { spins: 0, wagered: 0, won: 0, biggestWin: 0, biggestX: 0, features: 0, topUps: 0 },
  feature: null, // { left, played, totalMult, won, bet } while free spins are in progress
  lastTopUp: 0,
});

// fill in anything an older, partial or foreign save is missing
export function normalize(d) {
  const f = fresh();
  if (!d || typeof d !== 'object' || typeof d.credits !== 'number' || !isFinite(d.credits) || d.credits < 0) return f;
  return {
    ...f, ...d,
    bet: Number.isInteger(d.bet) && d.bet >= 0 && d.bet < BETS.length ? d.bet : f.bet,
    ante: !!d.ante,
    stats: { ...f.stats, ...(d.stats || {}) },
    feature: d.feature && d.feature.left > 0 ? d.feature : null,
  };
}

export class RoundError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Plays the next spin: a free spin while a feature is running, else a paid spin at the saved bet.
// Changes `save` in place and returns what the page needs to animate it.
export function playSpin(save, rng, { buy = false } = {}) {
  const f = save.feature;
  if (f && buy) throw new RoundError('in_feature', 'Finish the free spins first.');
  const b = f ? f.bet : BETS[save.bet];
  const kind = f ? 'free' : buy ? 'buy' : save.ante ? 'ante' : 'base';
  const cost = f ? 0 : round2(b * spinCost({ ante: save.ante, buy }));
  if (save.credits < cost) throw new RoundError('no_credits', 'Not enough credits for that spin.');

  save.credits = round2(save.credits - cost);
  if (!f) save.stats.spins++;
  const r = spin(rng, { mode: f ? 'free' : save.ante ? 'ante' : 'base', totalMult: f ? f.totalMult : 0, buy });

  let win = round2(r.win * b);
  let event = null;
  if (f) {
    win = Math.min(win, round2(MAX_WIN * b - f.won)); // the whole feature is capped too
    f.won = round2(f.won + win);
    f.totalMult = r.totalMult;
    f.left -= 1;
    f.played += 1;
    if (r.freeSpins) f.left += r.freeSpins;
    if (f.won >= MAX_WIN * b) f.left = 0;
  }
  save.credits = round2(save.credits + win);
  const s = save.stats;
  s.wagered = round2(s.wagered + cost);
  s.won = round2(s.won + win);
  if (win > s.biggestWin) s.biggestWin = round2(win);

  if (!f && r.freeSpins) {
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

  return { kind, bet: b, cost, win, result: r, event, feature: f ? { ...f } : null };
}

export function canTopUp(save, now = Date.now()) {
  return !save.feature && save.credits < BETS[0] && now - save.lastTopUp >= TOP_UP_EVERY;
}
export function topUp(save, now = Date.now()) {
  if (!canTopUp(save, now)) throw new RoundError('no_top_up', 'Free credits are for when you run out, once an hour.');
  save.credits = round2(save.credits + START_CREDITS);
  save.lastTopUp = now;
  save.stats.topUps++;
}

export function setBet(save, { bet, ante }) {
  if (save.feature) throw new RoundError('in_feature', 'Finish the free spins first.');
  if (bet !== undefined) {
    if (!Number.isInteger(bet) || bet < 0 || bet >= BETS.length) throw new RoundError('bad_bet', 'That bet is not on the list.');
    save.bet = bet;
  }
  if (ante !== undefined) save.ante = !!ante;
}
