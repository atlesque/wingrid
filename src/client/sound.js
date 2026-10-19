// ================= SOUND =================
// Our own music (public/music) and the original's sound effects, played the way the original plays them (worked
// out by watching its sound engine during spins): an ambience loop that never stops, and music in layers that all
// run in step and crossfade by what is happening (idle, spinning, winning). One-shots go through their own gain.
// Browsers only start audio after a tap or key, so everything waits for the first one.
const AUDIO = '/starlight/audio';
export const CLIPS = {
  ambience: '51cda7df5f1469b40b92ce0120eccf88',
  // music layers: idle, spinning, tumbling wins. The idle layer is the base loop without its drums, so the two
  // stay in step; like the original, winning is the spinning music played louder.
  idle: '/music/wingrid-idle-loop.mp3',
  spinning: '/music/wingrid-base-loop.mp3',
  winning: '/music/wingrid-base-loop.mp3',
  freeMusic: '/music/wingrid-free-loop.mp3',
  bigWinMusic: '/music/wingrid-bigwin-loop.mp3',
  countLoop: 'c3d156f99863c604080c38863d943c75',
  // one-shots
  click: 'ac8c53df56f9f2141b4ed263cfa094ce',
  spinButton: '0864ff107a030e5489388b8012f6af94',
  reelsStart: '785fcb57b7c57f94f831aa76b4fd7a28',
  reelStop: ['2f133b6334f17ea4ea2c6a1ace20e410', '27ff8b791e1fb344ca479b828bd223ef', '4754f15c6dc4b7e43ab40d63e092ce62',
    '5484a589f0896d54695348e8451e29bf', '7e162b9655a59d841b7164d157b837a0', '75c0fe237f4cfba43b88a5b5591249b3'],
  showWin: '03b336f8b4464d3459726fb1d5376756',
  // the vanish sound climbs with each tumble of a spin
  vanish: ['ab24b7b604c18f4408a24d90b82d1a43', '6f3d5afe', '018158fc1d6862541b8e2afa934c1b5f', '97898ffc', '72b1aa6f',
    '56aaef20', '52e72a0b', 'ed46b556', '5942e584', '510da1f7'],
  tumble: ['212fd2438e9a0694598e465e1bf44588', '149dfc6b276037243a37a7926fb9071f', '0b22bf4c63db08b46ae1410250fc8a4c'],
  fill: ['6f63f452607297447b548696ab25552c', '5868424a003418a40adc6f09bad0fbc9'],
  countEnd: '34588ec2cde1a6147915909564947691',
  countEndFree: '4cddbcfa34d126e449e20076272fcabc',
  // the scatter sound climbs with each scatter that lands
  scatter: ['d698db0c12ffcec4eaf6b8a152c0ee2f', 'ed7c4c18', '9daf93f7', 'f58417f9', 'de45bf7f', 'f9ef93f8'],
  scatterVoice: ['524f1e11', '26aedd61', '9afea735', '03779047f93b10646ab3d3eee1309492', '7930fd48', '319798e85499b814fb494fb2872e8bde', '4d014ddc', '1a25a01ef8e7cd547bb75ac540ff52d6'],
  multVoice: ['373fcd708bcd70d4eb782f94907de207', '0aff080168381d74b8ef04d3d99a8de2', 'b03c7eb4', 'c7b7fb85', 'e8c6aa16', '37186c47', '5fba3b88', 'd83927ce', '0a3bc36fc50b9244e87c823d966be202'],
  freeSpinsWon: 'd5805036bab8f57429b5fd1e53422ff8',
  bigWin: 'f7edc1cc9167c8d458d93d7853718b98',
  winVoices: {
    nice: 'be9906e3ebb87f644b77189f8fee5d5f',
    superb: ['9d410ccf521225748a9a57d4b0e6f60e', 'ca9c10c9c9f2c1949b3c8f94e987db41'],
    mega: '4b1c955e88b5b554792afce7bbb6fd8c',
    sensational: ['79ed4b89ec59d2f4e97acf8e18bb03ff', '9b2b89de733f75e408c3f64898e9d93f'],
  },
  jackpotPick: 'fb679d7b77b4ef140ae6e89892ab6bdc',
  jackpotReveal: '34588ec2cde1a6147915909564947691',
  jackpotWin: '2c4a94d9876ba6c4b9337459d43ad667',
};
const LAYERS = { idle: 0.6, spinning: 0.7, winning: 1 };
const FADE = 3; // seconds, as the original crossfades its music layers

let ctx = null, master, musicGain, layerBus, sfxGain, files = null;
const buffers = new Map();
const settings = load();
let mood = 'idle', layerNodes = {}, countNode = null, freePending = null, countWanted = false;

function load() {
  // the original's slider starts at 50
  const d = { music: true, sfx: true, volume: 0.5, muted: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem('starlight_sound') || '{}') }; } catch (e) { return d; }
}
function save() { try { localStorage.setItem('starlight_sound', JSON.stringify(settings)); } catch (e) {} }
export const getSettings = () => ({ ...settings });

// clip ids in the list above may be short; the audio folder's index has the full names. Paths are our own files.
async function resolve(id) {
  if (id.startsWith('/')) return id;
  if (!files) files = fetch(`${AUDIO}/index.json`).then(r => r.json()).catch(() => []);
  const list = await files;
  return list.find(f => f.startsWith(id));
}
function buffer(id) {
  if (!buffers.has(id)) buffers.set(id, (async () => {
    const file = await resolve(id);
    if (!file) return null;
    const data = await (await fetch(file.startsWith('/') ? file : `${AUDIO}/${file}`)).arrayBuffer();
    return ctx.decodeAudioData(data);
  })().catch(() => null));
  return buffers.get(id);
}

function applyGains() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(settings.muted ? 0 : settings.volume, t, 0.05);
  musicGain.gain.setTargetAtTime(settings.music ? 1 : 0, t, 0.1);
  sfxGain.gain.setTargetAtTime(settings.sfx ? 1 : 0, t, 0.05);
}

// The first tap or key starts audio: the ambience and every music layer begin together, in step, and only the
// layer for the current mood is audible.
export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.connect(ctx.destination);
  musicGain = ctx.createGain(); musicGain.connect(master);
  // the layers and free-spin music go through their own bus, so a big win can duck them under its music
  layerBus = ctx.createGain(); layerBus.connect(musicGain);
  sfxGain = ctx.createGain(); sfxGain.connect(master);
  applyGains();
  startMusic();
}

async function loop(id, volume, at, out = layerBus) {
  const b = await buffer(id);
  if (!b) return null;
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = b; src.loop = true;
  g.gain.value = volume;
  src.connect(g); g.connect(out);
  src.start(at ?? ctx.currentTime);
  return { src, g };
}

async function startMusic() {
  await Promise.all([CLIPS.ambience, CLIPS.idle, CLIPS.spinning, CLIPS.winning].map(buffer));
  const at = ctx.currentTime + 0.05;
  loop(CLIPS.ambience, 0.9, at);
  for (const name of Object.keys(LAYERS)) layerNodes[name] = await loop(CLIPS[name], 0, at);
  applyMood();
}

// idle | spinning | winning | free
export function setMood(m) {
  mood = m;
  applyMood();
}
function applyMood() {
  if (!ctx) return;
  const m = mood;
  const t = ctx.currentTime;
  for (const [name, node] of Object.entries(layerNodes)) {
    if (!node) continue;
    const target = name === m ? (LAYERS[name] ?? 1) : 0;
    node.g.gain.cancelScheduledValues(t);
    node.g.gain.setValueAtTime(node.g.gain.value, t);
    node.g.gain.linearRampToValueAtTime(target, t + FADE);
  }
  // free spins have their own music in place of the layers
  if (m === 'free' && !layerNodes.free && !freePending) {
    freePending = loop(CLIPS.freeMusic, 0, t).then(n => {
      freePending = null;
      if (!n) return;
      if (mood !== 'free') { n.src.stop(); return; }
      layerNodes.free = n;
      n.g.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE);
    });
  }
  if (m !== 'free' && layerNodes.free) { const n = layerNodes.free; delete layerNodes.free; n.g.gain.linearRampToValueAtTime(0, t + FADE); n.src.stop(t + FADE + 0.1); }
}

// A big win plays its own music over the ducked layers until the celebration closes.
let winMusic = null, winWanted = false;
export async function bigWinMusic(on) {
  winWanted = on;
  if (!ctx) return;
  const t = ctx.currentTime;
  if (on && !winMusic) {
    layerBus.gain.setTargetAtTime(0.04, t, 0.15);
    const n = await loop(CLIPS.bigWinMusic, 1, undefined, musicGain);
    if (!n) return;
    if (!winWanted || winMusic) { n.src.stop(); return; }
    winMusic = n;
  } else if (!on) {
    layerBus.gain.setTargetAtTime(1, t, 0.6);
    if (winMusic) { const n = winMusic; winMusic = null; n.g.gain.setTargetAtTime(0, t, 0.3); n.src.stop(t + 2); }
  }
}

export async function play(id, { volume = 1 } = {}) {
  if (!ctx || !settings.sfx) return;
  const b = await buffer(Array.isArray(id) ? id[Math.floor(Math.random() * id.length)] : id);
  if (!b) return;
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = b; g.gain.value = volume;
  src.connect(g); g.connect(sfxGain);
  src.start();
}
// the n-th of an ordered set (vanish per tumble, scatter per scatter), holding on the last
export const playNth = (list, n, opts) => play(list[Math.min(n, list.length - 1)], opts);

export function anticipate() {
  if (!ctx || !settings.sfx) return;
  const t = ctx.currentTime, oscillator = ctx.createOscillator(), g = ctx.createGain();
  oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(330, t);
  oscillator.frequency.exponentialRampToValueAtTime(880, t + .9);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.12, t + .12);
  g.gain.linearRampToValueAtTime(0, t + 1.2);
  oscillator.connect(g); g.connect(sfxGain); oscillator.start(t); oscillator.stop(t + 1.2);
}

// the coin counter's loop while a win counts up, then its closing sound
export async function counting(on, { free = false } = {}) {
  countWanted = on;
  if (!ctx) return;
  if (on && !countNode) {
    const b = await buffer(CLIPS.countLoop);
    if (!b || countNode || !countWanted) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = b; src.loop = true; src.connect(g); g.connect(sfxGain); src.start();
    countNode = { src, g };
  } else if (!on && countNode) {
    countNode.src.stop(); countNode = null;
    play(free ? CLIPS.countEndFree : CLIPS.countEnd);
  }
}

export function setSettings(s) {
  Object.assign(settings, s);
  save();
  applyGains();
}

// load the clips a spin needs before the first spin, so nothing is late
export function preload() {
  if (!ctx) return;
  const ids = [CLIPS.click, CLIPS.spinButton, CLIPS.reelsStart, ...CLIPS.reelStop, CLIPS.showWin, ...CLIPS.vanish, ...CLIPS.tumble, ...CLIPS.fill, CLIPS.countLoop, CLIPS.countEnd, ...CLIPS.scatter];
  for (const id of ids) buffer(id);
}

// for checking in the console: is audio running, and how many clips are decoded
export async function status() {
  const decoded = (await Promise.all([...buffers.values()])).filter(Boolean).length;
  return { context: ctx?.state || 'not started', decoded, requested: buffers.size, settings: getSettings(), mood };
}
