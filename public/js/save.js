import { BETS, START_CREDITS } from './engine.js';

// ================= SAVE =================
// Everything a player keeps: credits, bet settings, lifetime stats and any free spins still to play. It
// lives in this browser and, signed in, in the Atlesque Play account (see account.js). Credits are free
// play money only: they can't be bought or cashed out.
const KEY = 'wingrid_save';
export const TOP_UP_EVERY = 60 * 60e3; // a broke player can claim START_CREDITS again after this long

export const fresh = () => ({
  v: 1,
  credits: START_CREDITS,
  bet: 2, // index into BETS
  ante: false,
  stats: { spins: 0, wagered: 0, won: 0, biggestWin: 0, biggestX: 0, features: 0, topUps: 0 },
  feature: null, // { left, played, totalMult, won, bet } while free spins are in progress
  lastTopUp: 0,
});

export const state = load();

function valid(d) {
  return d && typeof d === 'object' && typeof d.credits === 'number' && isFinite(d.credits) && d.credits >= 0;
}
// fill in anything an older or partial save is missing
function normalize(d) {
  const f = fresh();
  if (!valid(d)) return f;
  return {
    ...f, ...d,
    bet: Number.isInteger(d.bet) && d.bet >= 0 && d.bet < BETS.length ? d.bet : f.bet,
    stats: { ...f.stats, ...(d.stats || {}) },
    feature: d.feature && d.feature.left > 0 ? d.feature : null,
  };
}
function load() {
  try { return normalize(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { return fresh(); }
}
export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
}
export const serialize = () => JSON.parse(JSON.stringify(state));
// the account's copy replaces what's in play (null: an admin reset it, so start over)
export function replace(data) {
  const d = normalize(data);
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, d);
  persist();
}

export const round2 = n => Math.round(n * 100) / 100;
export const canTopUp = (minCost, now = Date.now()) => !state.feature && state.credits < minCost && now - state.lastTopUp >= TOP_UP_EVERY;
