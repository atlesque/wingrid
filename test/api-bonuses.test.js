import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/index.js';
import { seeded } from '../src/shared/engine.js';
import { database } from './helpers/database.js';
import { JACKPOT_COOLDOWN_SPINS } from '../src/shared/jackpot.js';

async function withSeed(seed, action) {
  const rng = seeded(seed);
  const method = mock.method(crypto, 'getRandomValues', array => {
    for (let i = 0; i < array.length; i++) array[i] = rng() * 4294967296;
    return array;
  });
  try { return await action(); } finally { method.mock.restore(); }
}

async function game() {
  const DB = database(), env = { DB, PLAY_GAME_ID: 'wingrid', PLAY_URL: 'https://unused.test' };
  let token;
  async function call(path, body) {
    const req = new Request(`https://wingrid.test/api/${path}`, {
      method: body ? 'POST' : 'GET', headers: { origin: 'https://wingrid.test',
        'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const res = await worker.fetch(req, env, { waitUntil() {} });
    return { status: res.status, ...await res.json() };
  }
  const guest = await call('guest', {}); token = guest.token;
  assert.equal(guest.status, 200);
  return { DB, call };
}

test('API settles non-unit-bet bonuses in credits and records the same credited win', async () => {
  const { DB, call } = await game();
  await call('bet', { bet: 3 });
  const response = await withSeed(146, () => call('spin', {}));
  assert.equal(response.status, 200);
  assert.equal(response.spin.win, DB.sqlite.prepare('SELECT win FROM spins').get().win);
  assert.equal(response.state.credits, Math.round((1000 - response.spin.cost + response.spin.win) * 100) / 100);
  assert.ok(response.spin.multSum > 0);
});

test('jackpot reservation, reload, hidden deck, match-three payment and replay protection', async () => {
  const { DB, call } = await game();
  const response = await withSeed(1013, () => call('spin', {}));
  assert.equal(response.spin.event.type, 'jackpot-start');
  const pending = response.state.jackpot;
  assert.deepEqual(Object.keys(pending).sort(), ['id', 'picks', 'size']);
  assert.equal((await call('state')).state.jackpot.id, pending.id);
  assert.equal((await call('spin', {})).error, 'in_jackpot');
  assert.equal((await call('bet', { bet: 1 })).error, 'in_jackpot');
  const credits = response.state.credits;
  let last;
  for (let index = 0; index < 9; index++) {
    last = await call('jackpot/pick', { id: pending.id, index });
    assert.equal(last.status, 200);
    if (last.result.complete) break;
    assert.equal(last.state.credits, credits);
    assert.equal((await call('jackpot/pick', { id: pending.id, index })).error, 'bad_pick');
  }
  assert.equal(last.result.complete, true);
  assert.equal(last.state.credits, Math.round((credits + last.result.won) * 100) / 100);
  assert.equal(last.state.jackpot, null);
  assert.equal(last.state.stats.jackpots, 1);
  assert.equal((await call('jackpot/pick', { id: pending.id, index: 8 })).error, 'no_jackpot');
  const award = DB.sqlite.prepare('SELECT * FROM jackpot_awards').get();
  assert.equal(award.amount, last.result.won);
  assert.ok(award.claimed_at);
  assert.equal(DB.sqlite.prepare("SELECT amount FROM jackpot_pools WHERE tier='minor'").get().amount, 25);
});

test('concurrent spins cannot double debit, append a phantom log or contribute twice', async () => {
  const { DB, call } = await game();
  const prepare = DB.prepare.bind(DB);
  let readers = 0, release;
  const bothRead = new Promise(resolve => { release = resolve; });
  DB.prepare = sql => {
    const statement = prepare(sql);
    if (sql === 'SELECT * FROM players WHERE id = ?') {
      const first = statement.first.bind(statement);
      statement.first = async () => {
        const row = await first();
        if (++readers <= 2) { if (readers === 2) release(); await bothRead; }
        return row;
      };
    }
    return statement;
  };
  const responses = await withSeed(2, () => Promise.all([call('spin', {}), call('spin', {})]));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM spins').get().n, 1);
  assert.equal(DB.sqlite.prepare("SELECT amount FROM jackpot_pools WHERE tier='minor'").get().amount, 25.004);
});

test('natural free-spin events and retriggers survive the actual API and persist', async () => {
  const { call } = await game();
  const response = await withSeed(754, () => call('spin', {}));
  assert.equal(response.spin.event.type, 'feature-start');
  assert.equal((await call('state')).state.feature.left, 15);
  assert.equal(response.state.jackpot, null);
  const retrigger = await withSeed(89, () => call('spin', {}));
  assert.equal(retrigger.spin.event.type, 'feature-retrigger');
  assert.equal(retrigger.spin.cost, 0);
  assert.equal(retrigger.state.feature.left, 19);
});

test('a player who just won a jackpot cannot trigger another until the cooldown has passed', async () => {
  const { DB, call } = await game();
  const stats = spins => DB.sqlite.prepare('UPDATE players SET stats = ?').run(JSON.stringify({ spins, lastJackpotSpin: 0 }));
  stats(JACKPOT_COOLDOWN_SPINS - 2);
  const blocked = await withSeed(1013, () => call('spin', {}));
  assert.equal(blocked.status, 200);
  assert.equal(blocked.state.jackpot, null);
  stats(JACKPOT_COOLDOWN_SPINS - 1);
  const ready = await withSeed(1013, () => call('spin', {}));
  assert.equal(ready.spin.event.type, 'jackpot-start');
  assert.equal(ready.state.stats.lastJackpotSpin, JACKPOT_COOLDOWN_SPINS);
});

test('free spins can no longer be bought: a buy request plays a normal spin at the bet', async () => {
  const { call } = await game();
  const response = await withSeed(3, () => call('spin', { buy: true }));
  assert.equal(response.status, 200);
  assert.equal(response.spin.kind, 'base');
  assert.equal(response.spin.cost, 1);
});

test('a competing jackpot pool reservation rolls back the spin and its log', async () => {
  const { DB, call } = await game();
  const batch = DB.batch.bind(DB);
  DB.batch = statements => {
    DB.batch = batch;
    // Another player changes this pool after it was read, before our transaction.
    DB.sqlite.exec("UPDATE jackpot_pools SET version=version+1 WHERE tier='minor'");
    return batch(statements);
  };
  const response = await withSeed(1013, () => call('spin', {}));
  assert.equal(response.status, 409);
  assert.equal(DB.sqlite.prepare('SELECT credits FROM players').get().credits, 1000);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM spins').get().n, 0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM jackpot_awards').get().n, 0);
});

test('simultaneous final gem picks award a reserved jackpot only once', async () => {
  const { DB, call } = await game();
  const started = await withSeed(1013, () => call('spin', {}));
  const id = started.state.jackpot.id;
  const hidden = JSON.parse(DB.sqlite.prepare('SELECT jackpot FROM players').get().jackpot);
  let before = started.state.credits;
  const final = hidden.deck.lastIndexOf(hidden.tier);
  for (let index = 0; index < final; index++) await call('jackpot/pick', { id, index });
  const prepare = DB.prepare.bind(DB);
  let readers = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  DB.prepare = sql => {
    const s = prepare(sql);
    if (sql === 'SELECT * FROM players WHERE id = ?') {
      const first = s.first.bind(s);
      s.first = async () => {
        const row = await first();
        if (++readers <= 2) { if (readers === 2) release(); await barrier; }
        return row;
      };
    }
    return s;
  };
  const outcomes = await Promise.all([call('jackpot/pick', { id, index: final }), call('jackpot/pick', { id, index: final })]);
  assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 409]);
  assert.equal(DB.sqlite.prepare('SELECT credits FROM players').get().credits, Math.round((before + hidden.amount) * 100) / 100);
  assert.equal(JSON.parse(DB.sqlite.prepare('SELECT stats FROM players').get().stats).jackpots, 1);
});
