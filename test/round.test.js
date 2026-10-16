import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seeded, BETS, START_CREDITS, MAX_WIN } from '../src/shared/engine.js';
import { fresh, normalize, playSpin, topUp, setBet, canTopUp, RoundError, TOP_UP_EVERY } from '../src/shared/round.js';

test('a paid spin costs the bet and adds the win', () => {
  const save = fresh(), rng = seeded(1);
  const before = save.credits;
  const r = playSpin(save, rng);
  assert.equal(r.cost, BETS[save.bet]);
  assert.equal(Math.round((save.credits - (before - r.cost + r.win)) * 100), 0);
  assert.equal(save.stats.spins, 1);
});

test('ante costs 1.25x and buying costs 100x', () => {
  const a = fresh(); a.ante = true;
  assert.equal(playSpin(a, seeded(2)).cost, BETS[a.bet] * 1.25);
  const b = fresh();
  const r = playSpin(b, seeded(3), { buy: true });
  assert.equal(r.cost, BETS[b.bet] * 100);
  assert.ok(b.feature, 'a bought spin starts free spins');
  assert.equal(r.event.type, 'feature-start');
});

test('free spins cost nothing, run to the end and are capped', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const save = fresh();
    playSpin(save, seeded(seed), { buy: true });
    const bet = save.feature.bet;
    let last, n = 0;
    while (save.feature) { last = playSpin(save, seeded(seed * 1000 + n++)); assert.equal(last.cost, 0); }
    assert.equal(last.event.type, 'feature-end');
    assert.ok(last.event.won <= MAX_WIN * bet + 1e-9);
  }
});

test('no spin without the credits for it, and no buying mid-feature', () => {
  const save = fresh(); save.credits = 0.1;
  assert.throws(() => playSpin(save, seeded(4)), RoundError);
  const f = fresh(); playSpin(f, seeded(5), { buy: true });
  assert.throws(() => playSpin(f, seeded(6), { buy: true }), RoundError);
  assert.throws(() => setBet(f, { bet: 0 }), RoundError);
});

test('free credits only when broke, once an hour', () => {
  const save = fresh();
  assert.equal(canTopUp(save), false);
  save.credits = 0;
  topUp(save, 1e12);
  assert.equal(save.credits, START_CREDITS);
  save.credits = 0;
  assert.throws(() => topUp(save, 1e12 + 1000), RoundError);
  topUp(save, 1e12 + TOP_UP_EVERY);
  assert.equal(save.stats.topUps, 2);
});

test('bets stay on the list; foreign saves are cleaned up', () => {
  const save = fresh();
  assert.throws(() => setBet(save, { bet: BETS.length }), RoundError);
  setBet(save, { bet: 0, ante: 1 });
  assert.deepEqual([save.bet, save.ante], [0, true]);
  assert.deepEqual(normalize({ credits: -5 }), fresh());
  assert.equal(normalize({ credits: 12, bet: 99 }).bet, fresh().bet);
});
