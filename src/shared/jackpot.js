// Wingrid's optional play-credit jackpots. These are our own transparent rules,
// not a claim to reproduce an operator's proprietary jackpot service or RTP.
export const JACKPOTS = [
  { id: 'minor', name: 'Minor', seed: 25, cap: 100, contribution: 0.004, weight: 800 },
  { id: 'major', name: 'Major', seed: 100, cap: 500, contribution: 0.003, weight: 170 },
  { id: 'mega', name: 'Mega', seed: 500, cap: 2500, contribution: 0.002, weight: 28 },
  { id: 'grand', name: 'Grand', seed: 2500, cap: 10000, contribution: 0.001, weight: 2 },
];
export const JACKPOT_MIN_BET = 0.2;
export const JACKPOT_CHANCE_PER_CREDIT = 0.001;
export const JACKPOT_MAX_CHANCE = 0.02;
// paid spins a player must play after one jackpot before the next can trigger
export const JACKPOT_COOLDOWN_SPINS = 150;

export const jackpotReady = stats => stats.lastJackpotSpin == null || stats.spins - stats.lastJackpotSpin >= JACKPOT_COOLDOWN_SPINS;

export function jackpotTier(rng, bet) {
  if (bet < JACKPOT_MIN_BET || rng() >= Math.min(JACKPOT_MAX_CHANCE, bet * JACKPOT_CHANCE_PER_CREDIT)) return null;
  let pick = rng() * JACKPOTS.reduce((sum, tier) => sum + tier.weight, 0);
  return JACKPOTS.find(tier => (pick -= tier.weight) < 0).id;
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
