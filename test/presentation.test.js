import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../src/client/motion.js';
import { winStages } from '../src/client/events.js';
import { fresh, playSpin, spinView } from '../src/shared/round.js';
import { seeded } from '../src/shared/engine.js';

function clock(reduced = false) {
  let time = 0, next;
  const instance = createClock({ frame: fn => { next = fn; }, now: () => time, reduced });
  return { instance, tick(ms) { time += ms; const fn = next; next = undefined; fn?.(time); } };
}
test('turbo changes synchronize active Spine poses and the rest of an in-progress counter', async () => {
  const c = clock(), values = [];
  const spine = { state: {}, once() {} }; c.instance.track(spine);
  const done = c.instance.animate(1000, p => values.push(p));
  c.tick(200); c.instance.setSpeed(2); c.tick(200);
  assert.equal(spine.state.timeScale, 2); assert.equal(values.at(-1), .6);
  c.instance.setSpeed(1); c.tick(400); assert.equal(await done, true);
  assert.equal(values.at(-1), 1); assert.equal(spine.state.timeScale, 1);
});
test('cancelled count-up stops before the final value; reduced motion completes promptly', async () => {
  const c = clock(), abort = new AbortController(); let last;
  const done = c.instance.animate(1000, p => { last = p; }, { signal: abort.signal });
  c.tick(100); abort.abort(); c.tick(100); assert.equal(await done, false); assert.equal(last, .1);
  const r = clock(true), brief = r.instance.wait(3000); r.tick(100); assert.equal(await brief, true);
});
test('win celebrations include every reached tier at non-unit bets and a distinct maximum win', () => {
  assert.deepEqual(winStages(39, 2), []);
  assert.deepEqual(winStages(70, 2).map(s => s.title), ['BIG WIN', 'SUPERB WIN']);
  assert.deepEqual(winStages(200, 2).map(s => s.art), ['nice', 'superb', 'mega', 'sensational']);
  const max = winStages(10000, 2, true); assert.equal(max.at(-1).title, 'MAXIMUM WIN');
});
test('the server signals the full capped feature award even when its final spin pays only a cent', () => {
  const save = fresh(); save.feature = { left: 10, played: 4, won: 4999.99, totalMult: 4999, bet: 1 };
  const out = spinView(playSpin(save, seeded(17)));
  assert.equal(out.win, .01); assert.deepEqual(out.maxWin, { limit: 5000, won: 5000 });
  assert.equal(out.event.type, 'feature-end'); assert.equal(save.feature, null);
});
