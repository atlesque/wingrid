import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seeded, spin, countScatters, scatterPay, MAX_WIN } from '../src/shared/engine.js';
import { fresh, playSpin, spinView, setBet } from '../src/shared/round.js';
import { JACKPOTS, jackpotTier, jackpotDeck, revealJackpot, publicJackpot } from '../src/shared/jackpot.js';

test('natural SCATTERs pay and start 15 free spins', () => {
  const save = fresh();
  const out = playSpin(save, seeded(754));
  assert.ok(countScatters(out.result.steps.at(-1).grid) >= 4);
  assert.equal(out.result.scatterWin, scatterPay(out.result.scatters));
  assert.equal(save.feature.left, 15);
  assert.equal(out.event.type, 'feature-start');
  assert.equal(save.feature.won, out.win);
});

test('multiple base-game orbs add and multiply the complete tumble win', () => {
  const r = spin(seeded(632));
  assert.ok(r.steps.length > 1 && r.mults.length > 1);
  assert.equal(r.appliedMult, r.mults.reduce((a, b) => a + b, 0));
  assert.equal(r.win, Math.min(MAX_WIN, r.tumbleWin * r.appliedMult + r.scatterWin));
});

test('winning free-spin orbs accumulate; no orb or no symbol win leaves the total unchanged', () => {
  const r = spin(seeded(17), { mode: 'free', totalMult: 7 });
  assert.equal(r.totalMult, 7 + r.multSum);
  assert.equal(r.appliedMult, r.totalMult);
  for (const seed of [1, 24]) {
    const quiet = spin(seeded(seed), { mode: 'free', totalMult: 7 });
    assert.ok(!quiet.multSum || !quiet.tumbleWin);
    assert.equal(quiet.totalMult, 7);
    assert.equal(quiet.appliedMult, 1);
  }
});

test('three free-spin SCATTERs retrigger five spins without resetting the multiplier', () => {
  const save = fresh();
  save.feature = { left: 1, played: 14, won: 10, totalMult: 7, bet: 1 };
  const out = playSpin(save, seeded(89));
  assert.equal(out.result.freeSpins, 5);
  assert.deepEqual(out.event, { type: 'feature-retrigger', spins: 5, left: 5 });
  assert.equal(save.feature.played, 15);
  assert.ok(save.feature.totalMult >= 7);
  assert.equal(out.cost, 0);
});

test('feature cap includes the triggering win and ends the remaining free spins', () => {
  const save = fresh();
  save.feature = { left: 10, played: 4, won: 4999.99, totalMult: 4999, bet: 1 };
  const before = save.credits;
  const out = playSpin(save, seeded(17));
  assert.equal(out.win, 0.01);
  assert.equal(save.credits, before + 0.01);
  assert.equal(out.event.won, 5000);
  assert.equal(out.event.type, 'feature-end');
  assert.equal(save.feature, null);
});

test('API win is in credits at non-unit bets; result multipliers stay in bets', () => {
  const save = fresh(); setBet(save, { bet: 3 });
  const out = playSpin(save, seeded(122));
  assert.ok(out.result.win > 0);
  assert.equal(spinView(out).win, out.win);
  assert.equal(out.win, Math.round(out.result.win * 2 * 100) / 100);
  assert.equal(spinView(out).tumbleWin, out.result.tumbleWin);
});

test('buy free spins is prohibited while double chance is on', () => {
  const save = fresh(); save.ante = true;
  assert.throws(() => playSpin(save, seeded(1), { buy: true }), { code: 'ante_buy' });
  assert.equal(save.credits, 1000);
});

test('each jackpot tier has exactly one possible match-three result and hides unpicked cards', () => {
  for (const winner of JACKPOTS) for (let seed = 1; seed <= 50; seed++) {
    const pending = { id: 'test', tier: winner.id, amount: winner.seed, picks: [], deck: jackpotDeck(seeded(seed), winner.id) };
    assert.deepEqual(Object.keys(publicJackpot(pending)).sort(), ['id', 'picks', 'size']);
    let won = false;
    for (let i = 0; i < 9 && !won; i++) won = revealJackpot(pending, 8 - i);
    assert.equal(won, true);
    assert.equal(pending.picks.filter(p => p.tier === winner.id).length, 3);
    for (const tier of JACKPOTS.filter(t => t.id !== winner.id)) assert.ok(pending.picks.filter(p => p.tier === tier.id).length < 3);
  }
});

test('all four tiers can trigger and the jackpot eligibility threshold is enforced', () => {
  for (const [roll, expected] of [[0, 'minor'], [0.81, 'major'], [0.98, 'mega'], [0.999, 'grand']]) {
    const sequence = [0, roll];
    assert.equal(jackpotTier(() => sequence.shift(), 1), expected);
  }
  assert.equal(jackpotTier(() => 0, 0.19), null);
  assert.equal(jackpotTier(() => 0.9, 1), null);
});
