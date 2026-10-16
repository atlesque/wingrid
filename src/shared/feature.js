import { spin, FREE_SPINS, MAX_WIN } from './engine.js';

// ================= FREE SPINS =================
// Plays a whole free spins feature in one go, for the RTP script and tests. The game itself plays it a
// spin at a time with the same rules: the total multiplier carries over, retriggers add spins, and the
// whole feature (the triggering spin included) never pays more than MAX_WIN bets.
export function playFeature(rng, { already = 0 } = {}) {
  let left = FREE_SPINS, totalMult = 0, won = 0, spins = 0;
  while (left > 0 && already + won < MAX_WIN) {
    left--; spins++;
    const r = spin(rng, { mode: 'free', totalMult });
    totalMult = r.totalMult;
    won += r.win;
    left += r.freeSpins;
  }
  return { won: Math.min(won, MAX_WIN - already), spins, totalMult };
}

// One paid round: a spin and, if it triggers, the free spins after it. Returns the win in bets.
export function playRound(rng, { ante = false, buy = false } = {}) {
  const r = spin(rng, { mode: ante ? 'ante' : 'base', buy });
  let win = r.win;
  if (r.freeSpins) win += playFeature(rng, { already: win }).won;
  return { win: Math.min(win, MAX_WIN), triggered: r.freeSpins > 0 };
}
