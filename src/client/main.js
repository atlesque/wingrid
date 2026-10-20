import '@fontsource/lilita-one/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import * as api from './api.js';
import * as scene from './scene.js';
import * as sound from './sound.js';
import { createBonuses } from './bonuses.js';
import { createPresentation } from './presentation.js';
import { motion } from './motion.js';
import { jackpotPrizes } from '../shared/jackpot.js';

// ================= PAGE =================
// The spin loop. Each spin is one request; the Worker answers with every tumble of it and the new state, and
// the page plays the tumbles back on the original's layout before showing the new credits. The controls are
// the original's own buttons, drawn in the scene; scene.on() says when one is pressed.
const $ = s => document.querySelector(s);
const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let cfg, state, busy = false, running = false;
const bonuses = createBonuses({ pick: api.pickJackpot,
  onState: next => { state = next; render(); },
  onError: error => toast(error.message, 2500), react: scene.react });
const presentation = createPresentation({ react: scene.react });
sound.onVoice(scene.speak);
if (import.meta.env.DEV) globalThis.__wingrid = { scene, presentation, bonuses, get state() { return structuredClone(state); } };
if (import.meta.env.DEV) globalThis.__sound = sound; // await __sound.status() in the console
// autoplay: spins left, and the settings it was started with (skip screens); it spins at the speed button's speed
let auto = 0, autoSettings = { skip: true };
let idleTimer = null, tumbleNo = 0, scattersThisSpin = 0, lastWin = '';

function toast(html, ms = 1200) {
  const t = $('#toast');
  t.innerHTML = html; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}
const betAmount = () => cfg.bets[state.bet];
const message = s => scene.setText('message', s);

function render() {
  const f = state.feature;
  scene.setText('credit', fmt(state.credits));
  scene.setText('bet', fmt(betAmount()));
  const locked = busy || !!f || !!state.jackpot;
  scene.setEnabled('betDown', !locked && state.bet > 0);
  scene.setEnabled('betUp', !locked && state.bet < cfg.bets.length - 1);
  scene.setEnabled('betMenu', !locked);
  scene.setEnabled('autoplay', !f && !state.jackpot);
  scene.setText('autoplayLabel', auto > 0 ? `STOP (${auto})` : 'AUTOPLAY');
  if (!busy) message(f ? `FREE SPINS LEFT ${f.left}` : state.jackpot ? 'JACKPOT WAITING: PRESS SPIN TO REVEAL' : auto > 0 ? `AUTOPLAY SPINS LEFT ${auto}` : state.canTopUp ? 'OUT OF CREDITS: PRESS SPIN FOR 1,000 FREE' : lastWin || scene.idleMessage());
  renderAccount();
  bonuses.render(state, cfg);
  if (f) scene.setFreeHud({ left: f.left, mult: f.totalMult });
  $('#bonus-hud').hidden = false;
  fitHud();
}

// the account badge's card: who is playing, a link to Atlesque Play, and sign in or out
function renderAccount() {
  const a = state.account;
  $('#account').setAttribute('aria-label', a ? `Account: ${a.email}` : 'Account: playing as guest');
  $('#sync').textContent = a ? a.email : 'Playing as guest';
  $('.ap-state').textContent = a ? 'Logged in' : 'Guest';
  $('.ap-sub').textContent = a ? 'Saved to Atlesque Play' : 'Sign in to keep your progress';
  // signed in, the avatars show the email's first letter, as on Atlesque Play; a guest gets the user icon
  for (const av of document.querySelectorAll('.who .ap-av')) { av.classList.toggle('has-letter', !!a); av.dataset.letter = a ? a.email[0] : ''; }
  $('.ap-link').href = cfg.playUrl || 'https://play.atlesque.dev';
  $('#account-action').textContent = a ? 'Sign out' : 'Sign in';
  $('#account-action').classList.toggle('is-out', !!a);
  $('#account-action').disabled = busy || !!state.jackpot;
}
function showAccount(open) {
  $('#account-card').hidden = !open;
  $('#account').setAttribute('aria-expanded', open);
}

async function playSpin() {
  busy = true; render();
  let r;
  try { await betSync; r = await api.spin(); } catch (e) { busy = false; render(); toast(e.message, 2200); return false; }
  const s = r.spin, inFeature = s.kind === 'free';
  lastWin = '';
  bonuses.setMultiplier(inFeature ? state.feature?.totalMult || 0 : 0);
  // the spins-left count ticks down as the spin starts; a retrigger adds its spins when it is announced
  if (inFeature) scene.setFreeHud({ left: s.feature.left - (s.event?.type === 'feature-retrigger' ? s.event.spins : 0), mult: state.feature?.totalMult || 0 });
  await scene.setFree(inFeature);
  scene.setText('credit', fmt(state.credits - s.cost)); // the cost leaves the balance as the reels go
  let shown = inFeature ? s.feature.won - s.win : 0;
  message(inFeature ? `FREE SPINS WIN ${fmt(shown)}` : auto > 0 ? `AUTOPLAY SPINS LEFT ${auto}` : 'GOOD LUCK!');
  clearTimeout(idleTimer);
  sound.setMood(inFeature || s.event?.type === 'feature-start' ? 'free' : 'spinning');
  sound.play(sound.CLIPS.reelsStart);
  tumbleNo = 0; scattersThisSpin = 0;
  await scene.clear();
  for (const [i, { grid, wins }] of s.steps.entries()) {
    await scene.show(grid, { first: i === 0, scatterTarget: inFeature ? 3 : 4 });
    if (!wins.length) break;
    const from = shown;
    shown = Math.min(shown + wins.reduce((t, w) => t + w.pay, 0) * s.bet, s.maxWin?.won ?? Infinity);
    await motion.animate(320, p => message(`${inFeature ? 'FREE SPINS WIN' : 'WIN'} ${fmt(from + (shown - from) * p)}`));
    if (!inFeature) sound.setMood('winning');
    sound.play(sound.CLIPS.showWin);
    await scene.pop(grid, wins);
  }
  // the base game's sum, for a win that orbs multiplied: the line the orbs fly to, counted up to the total
  const multiplied = !inFeature && s.tumbleWin > 0 && s.multSum > 0 && !s.scatterWin && !s.maxWin;
  const sum = to => `WIN ${fmt(s.tumbleWin * s.bet)} × ${s.appliedMult}${to == null ? '' : ` = ${fmt(to)}`}`;
  if (s.tumbleWin > 0 && s.multSum > 0) {
    message(multiplied ? sum() : `${fmt(s.tumbleWin * s.bet)} × ${s.appliedMult} = ${fmt(s.tumbleWin * s.bet * s.appliedMult)}`);
    sound.play(sound.CLIPS.multVoice);
    await scene.highlight('mult');
    let collected = inFeature ? s.totalMult - s.multSum : 0;
    bonuses.setMultiplier(collected);
    await scene.collectMultipliers(value => { collected += value; bonuses.setMultiplier(collected); if (inFeature) scene.setFreeHud({ mult: collected }); sound.play(sound.CLIPS.jackpotReveal, { volume: .5 }); });
  }
  if ((inFeature && s.scatters >= 3) || s.scatterWin) { sound.play(sound.CLIPS.scatterVoice); await scene.highlight('scatter'); }
  const won = s.win;
  if (won > 0 && won < s.bet * 20 && !s.maxWin) {
    const end = inFeature ? s.feature.won : won;
    sound.counting(true);
    await motion.animate(Math.min(1500, 400 + won / s.bet * 40), p => {
      const at = shown + (end - shown) * p;
      message(multiplied ? sum(at) : `${inFeature ? 'FREE SPINS WIN' : 'WIN'} ${fmt(at)}`);
    });
    sound.counting(false, { free: inFeature });
  }

  state = r.state;
  render();
  const total = inFeature ? s.feature.won : s.win;
  // A multiplied base win keeps its sum on screen, so it is clear the orbs were paid. The last win stays on the
  // message line until the next spin, instead of the line going back to its idle text as soon as play stops.
  const winLine = multiplied ? sum(total)
    : total > 0 ? `${inFeature ? 'FREE SPINS WIN' : 'WIN'} ${fmt(total)}` : '';
  if (winLine) message(winLine);
  if (!state.feature) lastWin = winLine;
  const skip = autoSettings.skip && auto > 0, pause = skip ? 900 : 0;
  if (s.maxWin || s.win >= s.bet * 20) await presentation.win(s.maxWin?.won ?? s.win, s.bet, { capped: !!s.maxWin, skip });
  if (s.event?.type === 'feature-start') {
    await scene.transition(() => scene.setFree(true)); sound.play(sound.CLIPS.freeSpinsWon);
    await presentation.feature(`${s.event.spins} FREE SPINS`, 'Winning orbs build a total multiplier for the whole feature.', { kind: 'feature-start', auto: pause || 3500 });
  }
  if (s.event?.type === 'feature-retrigger') {
    sound.play(sound.CLIPS.freeSpinsWon);
    const carry = s.totalMult ? `Your ${s.totalMult}x multiplier carries on.` : 'Collect winning orbs to build your multiplier.';
    await presentation.feature(`+${s.event.spins} FREE SPINS`, `${s.event.left} spins left. ${carry}`, { kind: 'feature-retrigger', auto: pause || 2200 });
  }
  if (s.event?.type === 'feature-end') {
    await presentation.feature('FREE SPINS COMPLETE', `${s.event.played} free spins${s.event.totalMult ? ` · ${s.event.totalMult}× total multiplier` : ''}`,
      { kind: 'feature-end', amount: s.event.won, auto: pause || 5000 });
    await scene.transition(() => scene.setFree(false)); sound.setMood('idle');
    bonuses.setMultiplier(0); // the feature's total ends with it
  }
  if (state.jackpot) await bonuses.reveal();
  // the music settles back to its idle layer a few seconds after play stops
  if (!state.feature) idleTimer = setTimeout(() => { if (!busy) sound.setMood('idle'); }, 5000);
  return true;
}

// free spins play on by themselves, and so does autoplay until its spins run out or it is stopped
async function run() {
  if (running || busy || !state) return;
  if (state.jackpot) { await bonuses.reveal(); return; }
  // out of credits while signed in: an admin may have added some on Atlesque Play, so look before the free top-up
  if (state.canTopUp && state.account) { try { await betSync; state = await api.refresh(); render(); } catch (e) {} }
  if (state.canTopUp) return topUp();
  running = true;
  try {
    if (!(await playSpin())) { auto = 0; render(); return; }
    for (;;) {
      if (state.feature) { await scene.wait(450); if (!(await playSpin())) break; continue; }
      if (auto <= 0) break;
      if (state.credits < betAmount() && !state.account) { auto = 0; break; } // signed in, the spin checks Atlesque Play first
      auto--; render();
      await scene.wait(speedLevel > 0 ? 150 : 400);
      if (auto < 0 || !(await playSpin())) break;
    }
    auto = Math.max(0, auto);
  } finally { running = false; busy = false; render(); }
}
function startAutoplay(set) {
  autoSettings = set;
  auto = set.spins - 1; // this press is the first
  render();
  run();
}
function stopAutoplay() { auto = 0; render(); }
async function topUp() {
  try { state = await api.topUp(); render(); toast(`+${fmt(cfg.startCredits)} free credits`); } catch (e) { toast(e.message, 2000); }
}
// A bet change shows at once (the jackpots are fixed multiples of the bet); the Worker hears about it in the
// background, only the latest bet when several presses land during one request, and a spin waits for it.
let betWanted = null, betSync = null;
function bet({ bet: i }) {
  if (busy || state.feature || state.jackpot || i === state.bet || !(i >= 0 && i < cfg.bets.length)) return;
  state = { ...state, bet: i, betAmount: cfg.bets[i], jackpots: jackpotPrizes(cfg.bets[i]) };
  render();
  betWanted = i;
  betSync ??= syncBet().finally(() => { betSync = null; });
}
async function syncBet() {
  while (betWanted != null) {
    const i = betWanted; betWanted = null;
    try {
      const next = await api.setBet({ bet: i });
      if (betWanted == null) { state = next; render(); }
    } catch (e) {
      betWanted = null; toast(e.message, 2000);
      try { state = await api.refresh(); render(); } catch (e) {}
    }
  }
}

scene.on('spin', () => { sound.play(sound.CLIPS.spinButton); if (auto > 0) stopAutoplay(); else run(); });
// the autoplay window keeps its choices for the next time it opens; its spin speed is the speed button's, one of
// normal, quick or turbo, and changing either changes both
const AUTOPLAY_STEPS = [10, 20, 30, 50, 70, 100, 500, 1000];
const autoplaySpins = () => AUTOPLAY_STEPS[$('#autoplay .autoplay-spins').value];
const showAutoplaySpins = () => { $('#autoplay .autoplay-count').value = autoplaySpins(); $('#autoplay .autoplay-start').textContent = `Start (${autoplaySpins()})`; };
showAutoplaySpins();
$('#autoplay .autoplay-spins').oninput = showAutoplaySpins;
$('#autoplay .autoplay-close').onclick = () => $('#autoplay').close();
$('#autoplay .autoplay-start').onclick = () => {
  $('#autoplay').close(); sound.play(sound.CLIPS.click);
  startAutoplay({ skip: $('#autoplay [name=skip]').checked, spins: autoplaySpins() });
};
for (const r of document.querySelectorAll('#autoplay [name=speed]')) r.onchange = () => { sound.play(sound.CLIPS.click); setSpeedLevel(+r.value); };
scene.on('autoplay', () => {
  sound.play(sound.CLIPS.click);
  if (auto > 0) return stopAutoplay();
  if (busy) return;
  $(`#autoplay [name=speed][value="${speedLevel}"]`).checked = true;
  $('#autoplay').showModal();
});
scene.on('columnLanded', ({ col, first }) => first ? sound.play(sound.CLIPS.reelStop[col]) : sound.play(sound.CLIPS.fill));
scene.on('scatterLanded', () => sound.playNth(sound.CLIPS.scatter, scattersThisSpin++));
scene.on('anticipation', () => sound.anticipate());
scene.on('vanish', () => { sound.playNth(sound.CLIPS.vanish, tumbleNo++); scene.wait(350).then(() => sound.play(sound.CLIPS.tumble)); });
function renderSound() {
  const st = sound.getSettings();
  scene.setSoundIcon(!st.muted && st.volume > 0);
  $('#setting-sound').checked = !st.muted; $('#setting-volume').value = Math.round(st.volume * 100);
}
// the menu button opens the settings; the info button opens the bonus rules
const rules = () => $('#bonus-hud button').click();
scene.on('menu', () => { sound.play(sound.CLIPS.click); renderSound(); $('#settings').showModal(); });
// the sound button switches the sound off and on; unmuting at zero volume brings it back to half
scene.on('sound', () => {
  const st = sound.getSettings(), on = !st.muted && st.volume > 0;
  sound.setSettings(on ? { muted: true } : { muted: false, volume: st.volume || 0.5 });
  renderSound(); sound.play(sound.CLIPS.click);
});
scene.on('info', () => { sound.play(sound.CLIPS.click); rules(); });
$('#setting-sound').onchange = e => { sound.setSettings({ muted: !e.target.checked }); renderSound(); };
$('#setting-volume').oninput = e => { sound.setSettings({ volume: e.target.value / 100, muted: false }); renderSound(); };
$('#settings .settings-close').onclick = () => $('#settings').close();
// The bonus panel sits in the empty panel by the bet controls, its lettering sized to it; when the panel is
// small it keeps to the jackpots and the rules button. The account line keeps clear of the game's left column.
// On a phone the jackpot panel is left off (the i button still opens the rules).
let hudFont = 12;
function fitHud(hud = $('#bonus-hud'), font = hudFont) {
  hud.style.fontSize = `${font}px`;
  if (hud.hidden) return;
  for (let i = 0; i < 4 && hud.scrollHeight > hud.clientHeight + 1 && font > 9; i++) {
    font = Math.max(9, font * hud.clientHeight / hud.scrollHeight * .98);
    hud.style.fontSize = `${font}px`;
  }
}
scene.on('layout', ({ name, k, phone, world, panel }) => {
  document.documentElement.classList.toggle('is-phone', phone);
  const hud = $('#bonus-hud');
  if (panel) {
    const font = Math.max(9, Math.min(22, panel.w / 10.5));
    Object.assign(hud.style, { left: `${panel.x}px`, top: `${panel.y}px`, width: `${panel.w}px`, height: `${panel.h}px`, fontSize: `${font}px` });
    hud.classList.toggle('is-compact', panel.h / font < 12);
    // then down to what fits the frame's height, if the lettering at that width would overflow it
    hudFont = font;
    fitHud(hud);
  }
  // (the left column ends at x 276 of the 1920 layout; its first panel starts 125 down)
  $('.who').classList.toggle('is-tight', name === 'landscape' && world.x + 276 * k < 190 && world.y + 125 * k < 60);
});
// the speed button steps through normal, quick and turbo spins; the choice is remembered on this device
const SPEEDS = [1, 1.5, 2.2], SPEED_NAMES = ['NORMAL SPIN', 'QUICK SPIN', 'TURBO SPIN'];
let speedLevel = 0;
try { speedLevel = Math.min(2, Math.max(0, +localStorage.getItem('wingrid.speed') || 0)); } catch {}
function setSpeedLevel(level) {
  speedLevel = level;
  try { localStorage.setItem('wingrid.speed', level); } catch {}
  scene.showSpeed(level);
  scene.setSpeed(SPEEDS[level]);
}
scene.on('speed', () => { sound.play(sound.CLIPS.click); setSpeedLevel((speedLevel + 1) % SPEEDS.length); toast(SPEED_NAMES[speedLevel]); });
// the coin-stack button lists every bet to pick from
function openBets() {
  const list = $('#bets .bet-list');
  list.replaceChildren(...cfg.bets.map((amount, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = fmt(amount); b.setAttribute('aria-pressed', i === state.bet);
    b.onclick = () => { $('#bets').close(); if (i !== state.bet) bet({ bet: i }); };
    return b;
  }));
  $('#bets').showModal();
  list.querySelector('[aria-pressed="true"]')?.focus();
}
scene.on('betMenu', () => { sound.play(sound.CLIPS.click); if (!busy && !state.feature && !state.jackpot) openBets(); });
$('#bets .bets-close').onclick = () => $('#bets').close();
// a tap outside the autoplay, settings or bet window closes it
const outside = (e, r) => e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
for (const d of document.querySelectorAll('#autoplay, #settings, #bets')) d.onclick = e => { if (e.target === d && outside(e, d.getBoundingClientRect())) d.close(); };
scene.on('betDown', () => bet({ bet: state.bet - 1 }));
scene.on('betUp', () => bet({ bet: state.bet + 1 }));
scene.on('rebuilt', () => state && render());
$('#account').onclick = () => { sound.play(sound.CLIPS.click); showAccount($('#account-card').hidden); };
$('#account-action').onclick = async () => {
  if (state.account) { showAccount(false); state = await api.signOut(); render(); toast('Signed out. Playing as a new guest.', 2000); }
  else api.beginSignIn(cfg);
};
// a tap anywhere else, or Escape, closes the account card
addEventListener('pointerdown', e => { if (!$('#account-card').hidden && !e.target.closest('.who')) showAccount(false); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#account-card').hidden) { showAccount(false); $('#account').focus(); } });
addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && !document.querySelector('dialog[open]')) { e.preventDefault(); if (auto > 0) stopAutoplay(); else run(); } });
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
scene.showSpeed(speedLevel); scene.setSpeed(SPEEDS[speedLevel]);
scene.setText('banner', BANNERS[0]);
loadingProgress(100, 'Ready to play');
await new Promise(resolve => setTimeout(resolve, 250));
$('#loading').classList.add('leaving');
setTimeout(() => { $('#loading').hidden = true; }, 400);
// a feature left unfinished (closed tab) carries on where it stopped; a reserved jackpot waits for the
// player to press spin or the jackpot button rather than covering the game the moment it loads
if (state.jackpot) toast('Your jackpot is waiting. Press spin to reveal it.', 3000);
else if (state.feature) { await scene.setFree(true); sound.setMood('free'); toast(`${state.feature.left} free spins left`); await scene.wait(1200); run(); }

} catch (error) {
  console.error(error);
  $('#loading-message').textContent = 'The game could not load. Please try again.';
  $('#loading-progress').hidden = true;
  $('.loading-caption').hidden = true;
  $('#loading-retry').hidden = false;
  $('#loading-retry').onclick = () => location.reload();
}
