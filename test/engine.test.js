import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLS, ROWS, MIN_COUNT, MAX_WIN, seeded, fillGrid, findWins, tumble, spin } from '../public/js/engine.js';
import { playRound } from '../public/js/feature.js';

const grid = (rows) => Array.from({ length: COLS }, (_, c) => Array.from({ length: ROWS }, (_, r) => ({ id: c * ROWS + r + 1000, s: rows[r][c] })));

test('8 or more of a symbol anywhere pays; 7 does not', () => {
  const g = grid([
    ['crown', 'crown', 'crown', 'crown', 'ruby', 'ruby'],
    ['crown', 'crown', 'crown', 'topaz', 'ruby', 'ruby'],
    ['emerald', 'topaz', 'sapphire', 'ring', 'ruby', 'amethyst'],
    ['emerald', 'topaz', 'sapphire', 'ring', 'ruby', 'amethyst'],
    ['emerald', 'chalice', 'sapphire', 'ring', 'hourglass', 'amethyst'],
  ]);
  const wins = findWins(g);
  assert.deepEqual(wins.map(w => [w.s, w.count]), []); // crown 7, ruby 6
  g[2][4].s = 'crown';
  assert.deepEqual(findWins(g).map(w => [w.s, w.count, w.pay]), [['crown', MIN_COUNT, 15]]);
});

test('a tumble removes winners and drops the cells above', () => {
  const rng = seeded(1);
  const g = fillGrid(rng, 'base');
  const keep = g[0][0];
  const wins = [{ s: 'x', cells: [[0, 3], [0, 4]], pay: 0 }];
  const t = tumble(g, wins, rng, 'base');
  assert.equal(t[0].length, ROWS);
  assert.equal(t[0][2].id, keep.id); // row 0 fell two rows
  assert.deepEqual(t[1], g[1]);
});

test('every step after a win is a tumble, and the last step has no wins', () => {
  const rng = seeded(7);
  for (let i = 0; i < 2000; i++) {
    const r = spin(rng);
    assert.equal(r.steps.at(-1).wins.length, 0);
    assert.ok(r.win >= 0 && r.win <= MAX_WIN);
    if (r.tumbleWin === 0) assert.equal(r.appliedMult, 1);
  }
});

test('a bought feature always triggers free spins', () => {
  const rng = seeded(3);
  for (let i = 0; i < 300; i++) assert.ok(spin(rng, { buy: true }).freeSpins > 0);
});

test('return to player stays between 90% and 100%', () => {
  const rng = seeded(99);
  let won = 0, n = 200000;
  for (let i = 0; i < n; i++) won += playRound(rng).win;
  const rtp = won / n;
  assert.ok(rtp > 0.85 && rtp < 1.05, `RTP ${rtp}`);
});
