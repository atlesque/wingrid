import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/client/sound.js', import.meta.url), 'utf8');
let serial = 0;
async function audio({ deferFree = false, deferCount = false, deferWin = false } = {}) {
  const started = [], requests = [], nodes = []; let resolveFree, resolveCount, resolveWin;
  globalThis.localStorage = { getItem: () => null };
  const gain = () => ({ value: 0, setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime(value) { this.value = value; } });
  class AudioContext {
    currentTime = 0; state = 'running'; destination = {};
    createGain() { return { gain: gain(), connect() {} }; }
    createBufferSource() { const s = { connect() {}, start() { started.push(s.buffer); }, stop() { s.stopped = true; } }; nodes.push(s); return s; }
    async decodeAudioData(b) { return b; }
  }
  globalThis.window = { AudioContext };
  const module = await import(`data:text/javascript;base64,${Buffer.from(source + `\n// case ${serial++}`).toString('base64')}`);
  const files = Object.values(module.CLIPS).flatMap(v => typeof v === 'object' && !Array.isArray(v) ? Object.values(v).flat() : v).map(id => `${id}.ogg`);
  globalThis.fetch = async url => {
    requests.push(url);
    return { json: async () => files, arrayBuffer: async () => {
      if (deferFree && url.includes(module.CLIPS.freeMusic)) return new Promise(r => { resolveFree = () => r(url); });
      if (deferWin && url.includes(module.CLIPS.bigWinMusic)) return new Promise(r => { resolveWin = () => r(url); });
      if (deferCount && url.includes(module.CLIPS.countLoop)) return new Promise(r => { resolveCount = () => r(url); });
      return url;
    } };
  };
  return { module, started, requests, nodes, free: () => resolveFree?.(), count: () => resolveCount?.(), win: () => resolveWin?.() };
}
const flush = () => new Promise(r => setImmediate(r));
test('resuming free spins before the first gesture starts the free-spin music on unlock', async () => {
  const a = await audio(); a.module.setMood('free'); a.module.unlock(); await flush();
  assert.ok(a.started.some(url => url.includes(a.module.CLIPS.freeMusic)));
  a.module.setMood('free'); await flush();
  assert.equal(a.started.filter(url => url.includes(a.module.CLIPS.freeMusic)).length, 1);
});
test('a slow free-music load is discarded if the feature has already ended', async () => {
  const a = await audio({ deferFree: true }); a.module.unlock(); await flush();
  a.module.setMood('free'); await flush(); a.module.setMood('idle'); a.free(); await flush();
  const free = a.nodes.find(n => n.buffer?.includes(a.module.CLIPS.freeMusic));
  assert.equal(free.stopped, true);
});
test('a slow counter sound never starts after counting has finished', async () => {
  const a = await audio({ deferCount: true }); a.module.unlock(); await flush();
  const pending = a.module.counting(true); await flush(); await a.module.counting(false); a.count(); await pending;
  assert.equal(a.started.some(url => url.includes(a.module.CLIPS.countLoop)), false);
});
test('big-win music that loads after the celebration closed is stopped, not left playing', async () => {
  const a = await audio({ deferWin: true }); a.module.unlock(); await flush();
  const pending = a.module.bigWinMusic(true); await flush(); await a.module.bigWinMusic(false); a.win(); await pending;
  const win = a.nodes.find(n => n.buffer?.includes(a.module.CLIPS.bigWinMusic));
  assert.equal(win.stopped, true);
});
test('big-win music starts once however often a celebration asks for it', async () => {
  const a = await audio(); a.module.unlock(); await flush();
  await Promise.all([a.module.bigWinMusic(true), a.module.bigWinMusic(true)]); await flush();
  const wins = a.nodes.filter(n => n.buffer?.includes(a.module.CLIPS.bigWinMusic));
  assert.equal(wins.filter(n => !n.stopped).length, 1);
});
test('her voice lines tell voice listeners which line plays and how far in it is heard, other sounds do not', async () => {
  const a = await audio(); a.module.unlock(); await flush();
  const heard = [];
  a.module.onVoice(line => heard.push(line));
  a.module.play(a.module.CLIPS.showWin); await flush();
  assert.equal(heard.length, 0);
  await a.module.play(a.module.CLIPS.winVoices.nice);
  assert.equal(heard.length, 1);
  assert.equal(heard[0].clip, a.module.CLIPS.winVoices.nice);
  assert.equal(typeof heard[0].elapsed(), 'number');
});
test('a voice line she cannot be heard saying still tells voice listeners', async () => {
  const a = await audio(); const heard = [];
  a.module.onVoice(line => heard.push(line));
  await a.module.play(a.module.CLIPS.multVoice);
  assert.equal(heard.length, 1);
  assert.ok(a.module.CLIPS.multVoice.includes(heard[0].clip));
  assert.equal(heard[0].elapsed, undefined);
});
test('every voice line has mouth shapes for its sounds, in order, ending at rest', async () => {
  const a = await audio();
  const { lines } = JSON.parse(await readFile(new URL('../public/characters/princess-v2/character-v2-lipsync.json', import.meta.url), 'utf8'));
  const { mouths } = JSON.parse(await readFile(new URL('../public/characters/princess-v2/character-v2-face.json', import.meta.url), 'utf8'));
  const { scatterVoice, multVoice, winVoices } = a.module.CLIPS;
  for (const clip of [scatterVoice, multVoice, Object.values(winVoices)].flat(2)) {
    const keys = lines[clip]?.keys;
    assert.ok(keys?.length, `${clip} has mouth shapes`);
    assert.ok(keys.every(([time, name], i) => mouths.frames.includes(name) && (i === 0 || time > keys[i - 1][0])), `${clip} keys in order`);
    assert.equal(keys.at(-1)[1], 'X');
  }
});
