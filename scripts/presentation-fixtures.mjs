// Deterministic QA responses from the real rules. Never imported by the client or Worker.
// node scripts/presentation-fixtures.mjs /tmp/wingrid-presentation.json
import { writeFile } from 'node:fs/promises';
import { fresh, playSpin, spinView, pickJackpot } from '../src/shared/round.js';
import { seeded } from '../src/shared/engine.js';
import { JACKPOTS, publicJackpot, jackpotDeck } from '../src/shared/jackpot.js';

const save = fresh();
const state = () => structuredClone({ ...save, jackpot: publicJackpot(save.jackpot),
  jackpots: JACKPOTS.map(tier => ({ ...tier, amount: tier.seed })), canTopUp: false });
const fixtures = [];
function push(seed) {
  const out = playSpin(save, seeded(seed));
  fixtures.push({ spin: spinView(out), state: state() });
}
push(754); // natural trigger
save.feature = { left: 1, played: 14, won: 10, totalMult: 7, bet: 1 };
push(89); // retrigger
save.feature = { left: 1, played: 19, won: 4999.99, totalMult: 4999, bet: 1 };
push(17); // winning orbs, then a capped feature exit (only 0.01 newly credited)
const jackpot = [];
for (const [index, tier] of JACKPOTS.entries()) {
  save.feature = null;
  const out = playSpin(save, seeded(1));
  save.jackpot = { id: `presentation-test-${tier.id}`, tier: tier.id, amount: tier.seed,
    picks: [], deck: jackpotDeck(seeded(50 + index), tier.id) };
  const entry = { spin: { ...spinView(out), event: { type: 'jackpot-start' } }, state: state(), picks: [] };
  for (let card = 0; save.jackpot; card++) {
    const result = pickJackpot(save, card);
    entry.picks.push({ result, state: state() });
  }
  jackpot.push(entry);
}
await writeFile(process.argv[2] || '/tmp/wingrid-presentation.json', JSON.stringify({ fixtures, jackpot }, null, 2));
console.log('Saved natural trigger, retrigger, maximum-win and all four jackpot QA responses.');
