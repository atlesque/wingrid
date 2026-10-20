import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker/index.js';
import { database } from './helpers/database.js';

// A signed-in player and a stand-in for Atlesque Play's progress endpoint, which an admin can top up.
async function signedIn() {
  const DB = database(), env = { DB, PLAY_GAME_ID: 'wingrid', PLAY_URL: 'https://play.test' };
  const play = { data: null, rev: 0, gets: 0, puts: 0 };
  const realFetch = globalThis.fetch;
  mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith(env.PLAY_URL)) return realFetch(input, init);
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if ((init.method || 'GET') === 'GET') { play.gets++; return reply({ data: play.data, rev: play.rev }); }
    play.puts++;
    const b = JSON.parse(init.body);
    if (b.rev !== play.rev) return reply({ error: 'conflict', data: play.data, rev: play.rev }, 409);
    play.data = b.data; play.rev++;
    return reply({ rev: play.rev });
  });
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
  token = (await call('guest', {})).token;
  DB.sqlite.prepare("UPDATE sessions SET play_token = 'play-token'").run();
  DB.sqlite.prepare("UPDATE players SET play_user_id = 'u1', play_email = 'p@test', play_rev = 0").run();
  await call('bet', { bet: 0 }); // bet changes are not pushed, so put the save up with a spin
  await call('spin', {});
  // keep the rare free-spins or jackpot start out of the way of these tests
  DB.sqlite.prepare('UPDATE players SET feature = NULL, jackpot = NULL').run();
  play.data = { ...play.data, feature: null };
  const adminAdds = n => { play.data = { ...play.data, credits: play.data.credits + n }; play.rev++; };
  const setCredits = n => { DB.sqlite.prepare('UPDATE players SET credits = ?').run(n); play.data = { ...play.data, credits: n }; };
  return { DB, call, play, adminAdds, setCredits };
}

test('a spin with enough credit makes no extra call to Atlesque Play', async t => {
  const { call, play } = await signedIn();
  t.after(() => mock.restoreAll());
  const gets = play.gets;
  assert.equal((await call('spin', {})).status, 200);
  assert.equal(play.gets, gets);
});

test('too little credit fetches the account balance first and spins with credits an admin added', async t => {
  const { call, play, adminAdds, setCredits } = await signedIn();
  t.after(() => mock.restoreAll());
  setCredits(0);
  adminAdds(500);
  const gets = play.gets;
  const r = await call('spin', {});
  assert.equal(r.status, 200);
  assert.equal(play.gets, gets + 1);
  assert.equal(r.state.credits, Math.round((500 - r.spin.cost + r.spin.win) * 100) / 100);
  assert.equal(play.data.credits, r.state.credits); // and the result goes back up to the account
});

test('too little credit with nothing added still says not enough credits', async t => {
  const { call, setCredits } = await signedIn();
  t.after(() => mock.restoreAll());
  setCredits(0);
  const r = await call('spin', {});
  assert.equal(r.error, 'no_credits');
});

test('credits an admin added while the player still had enough are kept along with the spin', async t => {
  const { call, play, adminAdds } = await signedIn();
  t.after(() => mock.restoreAll());
  const before = (await call('spin', {})).state.credits;
  adminAdds(250);
  const r = await call('spin', {});
  assert.equal(r.status, 200);
  const expected = Math.round((before - r.spin.cost + r.spin.win + 250) * 100) / 100;
  assert.equal(r.state.credits, expected);
  assert.equal(play.data.credits, expected);
  assert.equal(play.data.stats.spins, r.state.stats.spins);
});
