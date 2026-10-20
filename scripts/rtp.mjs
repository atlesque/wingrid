// Simulates the game math: node scripts/rtp.mjs [spins] [seed]
// Prints RTP, hit rate and how often free spins start for normal spins, double chance and a bought feature.
import { spin, seeded, spinCost } from '../src/shared/engine.js';
import { playFeature } from '../src/shared/feature.js';

const N = +process.argv[2] || 1e6;
const rng = seeded(+process.argv[3] || 1);
const pct = x => (x * 100).toFixed(2) + '%';

for (const mode of ['base', 'ante']) {
  const cost = spinCost({ ante: mode === 'ante' });
  let spinWon = 0, featureWon = 0, hits = 0, features = 0;
  for (let i = 0; i < N; i++) {
    const r = spin(rng, { mode });
    spinWon += r.win;
    if (r.win > 0) hits++;
    if (r.freeSpins) { features++; featureWon += playFeature(rng, { already: r.win }).won; }
  }
  console.log(`${mode}: RTP ${pct((spinWon + featureWon) / (N * cost))} (free spins ${pct(featureWon / (N * cost))}),`,
    `hit rate ${pct(hits / N)}, free spins 1 in ${(N / features).toFixed(0)},`,
    `average feature ${(featureWon / features).toFixed(1)}x`);
}

const buys = Math.ceil(N / 20), cost = spinCost({ buy: true });
let won = 0;
for (let i = 0; i < buys; i++) { const r = spin(rng, { buy: true }); won += r.win + playFeature(rng, { already: r.win }).won; }
console.log(`buy: RTP ${pct(won / (buys * cost))} over ${buys} features`);
