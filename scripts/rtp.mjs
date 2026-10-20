// Simulates the game math: node scripts/rtp.mjs [spins] [seed]
// Prints RTP, hit rate and how often free spins start, and what the jackpot adds on top. A paid spin costs one bet.
import { spin, seeded } from '../src/shared/engine.js';
import { playFeature } from '../src/shared/feature.js';
import { JACKPOTS, JACKPOT_CHANCE } from '../src/shared/jackpot.js';

const N = +process.argv[2] || 1e6;
const rng = seeded(+process.argv[3] || 1);
const pct = x => (x * 100).toFixed(2) + '%';

let spinWon = 0, featureWon = 0, hits = 0, features = 0;
for (let i = 0; i < N; i++) {
  const r = spin(rng);
  spinWon += r.win;
  if (r.win > 0) hits++;
  if (r.freeSpins) { features++; featureWon += playFeature(rng, { already: r.win }).won; }
}
console.log(`RTP ${pct((spinWon + featureWon) / N)} (free spins ${pct(featureWon / N)}),`,
  `hit rate ${pct(hits / N)}, free spins 1 in ${(N / features).toFixed(0)},`,
  `average feature ${(featureWon / features).toFixed(1)}x`);

const weights = JACKPOTS.reduce((sum, tier) => sum + tier.weight, 0);
const average = JACKPOTS.reduce((sum, tier) => sum + tier.x * tier.weight, 0) / weights;
console.log(`jackpot: 1 in ${1 / JACKPOT_CHANCE} paid spins, average prize ${average.toFixed(1)}x, adds about ${pct(JACKPOT_CHANCE * average)} to RTP`,
  `(${JACKPOTS.map(t => `${t.name} ${t.x}x 1 in ${Math.round(weights / t.weight / JACKPOT_CHANCE).toLocaleString('en-US')}`).join(', ')})`);
