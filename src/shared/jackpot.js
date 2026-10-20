// Wingrid's play-credit jackpots: four fixed prizes, each a multiple of the bet. Any paid spin that does not
// start free spins has the same small chance to open the jackpot, whatever the bet, and the player then picks
// gems until three names match. Tuned with scripts/rtp.mjs to add about 2% on top of the slot's return.
export const JACKPOTS = [
  { id: 'minor', name: 'Minor', x: 10, weight: 82 },
  { id: 'major', name: 'Major', x: 25, weight: 14 },
  { id: 'mega', name: 'Mega', x: 100, weight: 3.6 },
  { id: 'grand', name: 'Grand', x: 1000, weight: 0.4 },
];
export const JACKPOT_CHANCE = 1 / 1000;

const round2 = n => Math.round(n * 100) / 100;
// every tier with its prize in credits at this bet, as the page shows it
export const jackpotPrizes = bet => JACKPOTS.map(({ id, name, x }) => ({ id, name, x, amount: round2(x * bet) }));

export function jackpotTier(rng) {
  if (rng() >= JACKPOT_CHANCE) return null;
  let pick = rng() * JACKPOTS.reduce((sum, tier) => sum + tier.weight, 0);
  return JACKPOTS.find(tier => (pick -= tier.weight) < 0)?.id ?? JACKPOTS.at(-1).id;
}

export function jackpotDeck(rng, winner) {
  // All losing tiers occur only twice; only the awarded tier can match three.
  const cards = JACKPOTS.flatMap(tier => Array(tier.id === winner ? 3 : 2).fill(tier.id));
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function publicJackpot(pending) {
  if (!pending) return null;
  return { id: pending.id, picks: pending.picks, size: pending.deck.length };
}

export function revealJackpot(pending, index) {
  if (!Number.isInteger(index) || index < 0 || index >= pending.deck.length) throw new Error('Choose an unopened gem.');
  if (pending.picks.some(pick => pick.index === index)) throw new Error('That gem is already open.');
  const tier = pending.deck[pending.picks.length];
  pending.picks.push({ index, tier });
  return pending.picks.filter(pick => pick.tier === tier).length === 3;
}
