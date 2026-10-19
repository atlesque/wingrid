import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/client/sound.js', import.meta.url), 'utf8');
let serial = 0;
async function audio({ deferFree = false, deferCount = false } = {}) {
  const started = [], requests = [], nodes = []; let resolveFree, resolveCount;
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
      if (deferCount && url.includes(module.CLIPS.countLoop)) return new Promise(r => { resolveCount = () => r(url); });
      return url;
    } };
  };
  return { module, started, requests, nodes, free: () => resolveFree?.(), count: () => resolveCount?.() };
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
test('her voice lines tell voice listeners how loud they are, other sounds do not', async () => {
  const a = await audio(); a.module.unlock(); await flush();
  const heard = [];
  a.module.onVoice(line => heard.push(line));
  const samples = new Float32Array(4800).map((_, i) => i < 2400 ? .5 : .1);
  a.module.play(a.module.CLIPS.showWin); await flush();
  assert.equal(heard.length, 0);
  // decoded audio: a buffer with its samples
  globalThis.fetch = async () => ({ json: async () => [`${a.module.CLIPS.winVoices.nice}.ogg`], arrayBuffer: async () => ({ sampleRate: 48000, getChannelData: () => samples }) });
  await a.module.play(a.module.CLIPS.winVoices.nice);
  assert.equal(heard.length, 1);
  assert.equal(heard[0].rate, 60);
  assert.deepEqual([...heard[0].loudness.slice(0, 3)].map(v => +v.toFixed(2)), [1, 1, 1]);
  assert.equal(+heard[0].loudness.at(-1).toFixed(2), .2);
});
test('a voice line she cannot be heard saying still tells voice listeners', async () => {
  const a = await audio(); const heard = [];
  a.module.onVoice(line => heard.push(line));
  await a.module.play(a.module.CLIPS.multVoice);
  assert.deepEqual(heard, [null]);
});
