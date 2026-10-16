import * as api from './api.js';
import * as scene from './scene.js';
import * as sound from './sound.js';

// ================= PAGE =================
// The spin loop. Each spin is one request; the Worker answers with every tumble of it and the new state, and
// the page plays the tumbles back on the original's layout before showing the new credits. The controls are
// the original's own buttons, drawn in the scene; scene.on() says when one is pressed.
const $ = s => document.querySelector(s);
const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let cfg, state, busy = false;
if (import.meta.env.DEV) globalThis.__sound = sound; // await __sound.status() in the console
// autoplay: spins left, and the settings it was started with (turbo, quick spin, skip screens)
let auto = 0, autoSettings = { turbo: false, quick: false, skip: true };
let idleTimer = null, tumbleNo = 0, scattersThisSpin = 0;

function toast(html, ms = 1200) {
  const t = $('#toast');
  t.innerHTML = html; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}
// a message over the game; with `ask`, it has a cancel button too and resolves to whether it was confirmed
function banner(title, text, auto = 0, ask = false) {
  const d = $('#banner');
  d.querySelector('h2').textContent = title;
  d.querySelector('p').textContent = text;
  const [ok, no] = d.querySelectorAll('button');
  ok.textContent = ask ? ask : 'Continue';
  no.hidden = !ask;
  d.showModal();
  return new Promise(res => {
    const done = v => { d.close(); res(v); };
    ok.onclick = () => done(true);
    no.onclick = () => done(false);
    d.oncancel = () => res(false);
    if (auto) setTimeout(() => d.open && done(true), auto);
  });
}

const betAmount = () => cfg.bets[state.bet];
const message = s => scene.setText('message', s);

function render() {
  const f = state.feature;
  scene.setText('credit', fmt(state.credits));
  scene.setText('bet', fmt(betAmount() * (state.ante && !f ? 1.25 : 1)));
  scene.setText('buyCost', fmt(betAmount() * 100));
  scene.setText('anteValue', fmt(betAmount() * 1.25));
  scene.setAnte(state.ante);
  const locked = busy || !!f;
  scene.setEnabled('betDown', !locked && state.bet > 0);
  scene.setEnabled('betUp', !locked && state.bet < cfg.bets.length - 1);
  scene.setEnabled('buy', !locked && state.credits >= betAmount() * 100);
  scene.setEnabled('ante', !locked);
  scene.setEnabled('anteArrow', !locked);
  scene.setEnabled('autoplay', !f);
  scene.setText('autoplayLabel', auto > 0 ? `STOP (${auto})` : 'AUTOPLAY');
  if (!busy) message(f ? `FREE SPINS LEFT ${f.left}` : auto > 0 ? `AUTOPLAY SPINS LEFT ${auto}` : state.canTopUp ? 'OUT OF CREDITS: PRESS SPIN FOR 1,000 FREE' : scene.idleMessage());
  const a = state.account;
  $('#account').textContent = a ? 'Sign out' : 'Sign in';
  $('#sync').textContent = a ? `Saved to Atlesque Play as ${a.email}` : 'Playing as guest';
}

async function playSpin(buy = false) {
  busy = true; render();
  let r;
  try { r = await api.spin(buy); } catch (e) { busy = false; render(); toast(e.message, 2200); return false; }
  const s = r.spin, inFeature = s.kind === 'free';
  scene.setText('credit', fmt(state.credits - s.cost)); // the cost leaves the balance as the reels go
  let shown = inFeature ? s.feature.won - s.win : 0;
  message(inFeature ? `FREE SPINS WIN ${fmt(shown)}` : auto > 0 ? `AUTOPLAY SPINS LEFT ${auto}` : 'GOOD LUCK!');
  clearTimeout(idleTimer);
  sound.setMood(inFeature || s.event?.type === 'feature-start' ? 'free' : 'spinning');
  sound.play(sound.CLIPS.reelsStart);
  tumbleNo = 0; scattersThisSpin = 0;
  await scene.clear();
  for (const [i, { grid, wins }] of s.steps.entries()) {
    await scene.show(grid, { first: i === 0 });
    if (!wins.length) break;
    shown += wins.reduce((t, w) => t + w.pay, 0) * s.bet;
    message(`${inFeature ? 'FREE SPINS WIN' : 'WIN'} ${fmt(shown)}`);
    if (!inFeature) sound.setMood('winning');
    sound.play(sound.CLIPS.showWin);
    await scene.pop(grid, wins);
  }
  if (s.tumbleWin > 0 && s.multSum > 0) {
    message(inFeature ? `+${s.multSum}x · TOTAL MULTIPLIER ${s.totalMult}x` : `${s.multSum}x MULTIPLIER`);
    sound.play(sound.CLIPS.multVoice);
    await scene.highlight('mult');
  }
  if (s.scatters >= 3 || s.scatterWin) { sound.play(sound.CLIPS.scatterVoice); await scene.highlight('scatter'); }
  const won = s.win;
  if (won > 0) { sound.counting(true); await scene.wait(Math.min(1500, 400 + won / s.bet * 40)); sound.counting(false, { free: inFeature }); }

  state = r.state;
  busy = false; render();
  const total = inFeature ? s.feature.won : s.win;
  if (total > 0) message(`${inFeature ? 'FREE SPINS WIN' : 'WIN'} ${fmt(total)}`);
  const pause = autoSettings.skip && auto > 0 ? 1200 : 0;
  if (s.event?.type === 'feature-start') { sound.play(sound.CLIPS.freeSpinsWon); await banner(`${s.event.spins} free spins`, 'Scatters landed! Multipliers now add up to one total multiplier for the whole feature.', pause || 3500); }
  if (s.event?.type === 'feature-end') await banner('Free spins complete', `${s.event.played} free spins won ${fmt(s.event.won)}${s.event.totalMult ? ` with a ${s.event.totalMult}x total multiplier` : ''}.`, pause || 5000);
  // the music settles back to its idle layer a few seconds after play stops
  if (!state.feature) idleTimer = setTimeout(() => { if (!busy) sound.setMood('idle'); }, 5000);
  return true;
}

// free spins play on by themselves, and so does autoplay until its spins run out or it is stopped
async function run(buy) {
  if (busy || !state) return;
  if (!buy && state.canTopUp) return topUp();
  if (!(await playSpin(buy))) { auto = 0; render(); return; }
  for (;;) {
    if (state.feature) { await scene.wait(450); if (!(await playSpin())) break; continue; }
    if (auto <= 0) break;
    if (state.credits < betAmount() * (state.ante ? 1.25 : 1)) { auto = 0; break; }
    auto--; render();
    await scene.wait(autoSettings.quick || autoSettings.turbo ? 150 : 400);
    if (auto < 0 || !(await playSpin())) break;
  }
  auto = Math.max(0, auto);
  render();
}
function startAutoplay(set) {
  autoSettings = set;
  scene.setSpeed(set.turbo ? 2.2 : set.quick ? 1.5 : 1);
  auto = set.spins - 1; // this press is the first
  render();
  run();
}
function stopAutoplay() { auto = 0; scene.setSpeed(1); render(); }
async function topUp() {
  try { state = await api.topUp(); render(); toast(`+${fmt(cfg.startCredits)} free credits`); } catch (e) { toast(e.message, 2000); }
}
const bet = async b => { if (busy || state.feature) return; try { state = await api.setBet(b); render(); } catch (e) { toast(e.message, 2000); } };

scene.on('spin', () => { sound.play(sound.CLIPS.spinButton); if (auto > 0) stopAutoplay(); else run(); });
scene.on('autoplay', () => { sound.play(sound.CLIPS.click); if (auto > 0) stopAutoplay(); else if (!busy) scene.showOverlay('autoplay'); });
scene.on('startAutoplay', set => { sound.play(sound.CLIPS.click); startAutoplay(set); });
scene.on('sound', () => { sound.play(sound.CLIPS.click); scene.overlayOpen('volume') ? scene.hideOverlay('volume') : (scene.showOverlay('volume'), renderSound()); });
scene.on('volume', s => { sound.setSettings(s); renderSound(); });
scene.on('columnLanded', ({ col, first }) => first ? sound.play(sound.CLIPS.reelStop[col]) : sound.play(sound.CLIPS.fill));
scene.on('scatterLanded', () => sound.playNth(sound.CLIPS.scatter, scattersThisSpin++));
scene.on('vanish', () => { sound.playNth(sound.CLIPS.vanish, tumbleNo++); setTimeout(() => sound.play(sound.CLIPS.tumble), 350); });
function renderSound() { const st = sound.getSettings(); scene.renderVolume({ volume: st.volume, muted: st.muted }); scene.setSoundIcon(!st.muted && st.volume > 0); }
scene.on('betDown', () => bet({ bet: state.bet - 1 }));
scene.on('betUp', () => bet({ bet: state.bet + 1 }));
scene.on('ante', () => bet({ ante: !state.ante }));
scene.on('anteArrow', () => bet({ ante: !state.ante }));
scene.on('buy', async () => {
  if (busy || state.feature) return;
  if (await banner('Buy free spins', `Start 15 free spins now for ${fmt(betAmount() * 100)}.`, 0, 'Buy')) run(true);
});
scene.on('rebuilt', () => state && render());
$('#account').onclick = async () => {
  if (state.account) { state = await api.signOut(); render(); toast('Signed out. Playing as a new guest.', 2000); }
  else api.beginSignIn(cfg);
};
addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && !$('#banner').open) { e.preventDefault(); if (auto > 0) stopAutoplay(); else run(); } });
// browsers only allow sound after the player does something
const unlock = () => { sound.unlock(); sound.preload(); };
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);

// the line over the reels rotates through the game's messages, as in the original
const BANNERS = ['WIN UP TO 5000 X BET', 'SYMBOLS PAY ANYWHERE ON THE SCREEN', 'MULTIPLIERS MULTIPLY THE TUMBLE WIN'];
let bannerAt = 0;
setInterval(() => scene.setText('banner', BANNERS[bannerAt = (bannerAt + 1) % BANNERS.length]), 4000);

// ---- boot ----
function loadingProgress(value, message) {
  const percent = Math.round(value);
  $('#loading-progress').setAttribute('aria-valuenow', percent);
  $('#loading-fill').style.width = percent + '%';
  $('#loading-percent').textContent = percent + '%';
  // Keep screen reader announcements to meaningful phase changes.
  if ($('#loading-message').textContent !== message) $('#loading-message').textContent = message;
}
try {
cfg = await api.config();
loadingProgress(2, 'Loading the game artwork…');
await scene.init($('#stage'), loadingProgress);
await scene.show(scene.capturedGrid(), { instant: true });
try {
  const signedIn = await api.finishSignIn();
  state = signedIn || await api.start();
  if (signedIn) toast(`Signed in as ${signedIn.account.email}`, 2200);
} catch (e) {
  toast(e.message, 3000);
  state = await api.start();
}
render();
renderSound();
scene.setText('banner', BANNERS[0]);
loadingProgress(100, 'Ready to play');
await new Promise(resolve => setTimeout(resolve, 250));
$('#loading').classList.add('leaving');
setTimeout(() => { $('#loading').hidden = true; }, 400);
// a feature left unfinished (closed tab) carries on where it stopped
if (state.feature) { toast(`${state.feature.left} free spins left`); await scene.wait(1200); run(); }

} catch (error) {
  console.error(error);
  $('#loading-message').textContent = 'The game could not load. Please try again.';
  $('#loading-progress').hidden = true;
  $('.loading-caption').hidden = true;
  $('#loading-retry').hidden = false;
  $('#loading-retry').onclick = () => location.reload();
}
