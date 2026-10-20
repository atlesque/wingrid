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

// a save whose last paid spin started free spins, from the first seed at or after `from` that does
function inFeature(from = 1) {
  for (let seed = from; ; seed++) {
    const save = fresh(), r = playSpin(save, seeded(seed));
    if (save.feature) return { save, r, seed };
  }
}

test('free spins start from MBP gems on a paid spin that costs the bet', () => {
  const { save, r } = inFeature();
  assert.equal(r.cost, BETS[save.bet]);
  assert.equal(r.event.type, 'feature-start');
});

test('an old save with double chance on plays at the plain bet', () => {
  const save = normalize({ ...fresh(), ante: true });
  assert.equal(save.ante, undefined);
  assert.equal(playSpin(save, seeded(2)).cost, BETS[save.bet]);
});

test('free spins cost nothing, run to the end and are capped', () => {
  for (let i = 0, from = 1; i < 30; i++) {
    const { save, seed } = inFeature(from); from = seed + 1;
    const bet = save.feature.bet;
    let last, n = 0;
    while (save.feature) { last = playSpin(save, seeded(seed * 1000 + n++)); assert.equal(last.cost, 0); }
    assert.equal(last.event.type, 'feature-end');
    assert.ok(last.event.won <= MAX_WIN * bet + 1e-9);
  }
});

test('no spin without the credits for it, and no bet changes mid-feature', () => {
  const save = fresh(); save.credits = 0.1;
  assert.throws(() => playSpin(save, seeded(4)), RoundError);
  const { save: f } = inFeature(5);
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
  assert.deepEqual([save.bet, save.ante], [0, undefined]);
  assert.deepEqual(normalize({ credits: -5 }), fresh());
  assert.equal(normalize({ credits: 12, bet: 99 }).bet, fresh().bet);
});

test('orbs multiply only a winning spin: per spin in the base game, as a running total in free spins', () => {
  const save = fresh(), rng = seeded(7);
  save.credits = 1e9;
  let base = 0, idle = 0, free = 0;
  for (let i = 0; i < 100000 && (base < 20 || idle < 20 || free < 20); i++) {
    save.jackpot = null;
    const before = save.feature ? save.feature.totalMult : 0, credits = save.credits;
    const out = playSpin(save, rng), r = out.result, hit = r.tumbleWin > 0 && r.multSum > 0;
    assert.ok(Math.abs(save.credits - credits - out.win + out.cost) < .005);
    if (out.maxWin) continue;
    if (out.kind === 'base') {
      // an orb on a losing base spin does nothing, and nothing carries to the next spin
      assert.equal(r.appliedMult, hit ? r.multSum : 1);
      assert.ok(Math.abs(r.win - (r.tumbleWin * r.appliedMult + r.scatterWin)) < 1e-9);
      if (hit) base++; else if (r.multSum) idle++;
    } else {
      assert.equal(r.totalMult, hit ? before + r.multSum : before);
      assert.ok(Math.abs(r.win - (r.tumbleWin * (hit ? r.totalMult : 1) + r.scatterWin)) < 1e-9);
      if (hit) free++;
    }
  }
  assert.ok(base >= 20 && idle >= 20 && free >= 20);
});
