// Plays many rounds and prints the return to player, hit rate and free spins frequency.
//   node scripts/rtp.mjs [rounds] [base|ante|buy]
import { seeded, spinCost } from '../public/js/engine.js';
import { playRound } from '../public/js/feature.js';

const rounds = +process.argv[2] || 1e6, kind = process.argv[3] || 'base';
const rng = seeded(12345);
const opts = { ante: kind === 'ante', buy: kind === 'buy' };
const cost = spinCost(opts);
let paid = 0, won = 0, hits = 0, features = 0, max = 0;
for (let i = 0; i < rounds; i++) {
  const r = playRound(rng, opts);
  paid += cost; won += r.win;
  if (r.win > 0) hits++;
  if (r.triggered) features++;
  if (r.win > max) max = r.win;
}
console.log(`${kind}: RTP ${(100 * won / paid).toFixed(2)}%  hit rate 1 in ${(rounds / hits).toFixed(2)}  ` +
  `free spins 1 in ${features ? Math.round(rounds / features) : '-'}  biggest ${max.toFixed(1)}x`);
