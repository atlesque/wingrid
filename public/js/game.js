import { COLS, ROWS, BETS, SYMBOLS, SCATTER_PAYS, MIN_COUNT, MAX_WIN, FREE_SPINS, RETRIGGER_SPINS, TRIGGER_SCATTERS,
  RETRIGGER_SCATTERS, BUY_COST, ANTE_COST, START_CREDITS, spin, spinCost, fillGrid, secureRandom } from './engine.js';
import { state, persist, serialize, replace, round2, canTopUp, TOP_UP_EVERY } from './save.js';
import * as acct from './account.js';

// ================= WINGRID =================
// The page: draws the grid, plays each spin's tumbles in order, and keeps the credits and stats.
const rng = secureRandom();
const $ = s => document.querySelector(s);
const board = $('#board');
const els = new Map(); // cell id -> element on the board
let busy = false, auto = 0, turbo = false;
const wait = ms => new Promise(r => setTimeout(r, turbo ? ms * 0.45 : ms));
const fmt = n => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const bet = () => BETS[state.bet];

// ---- board ----
function cellEl(cell) {
  const el = document.createElement('div');
  el.className = 'cell';
  el.dataset.s = cell.s;
  el.innerHTML = `<img src="assets/symbols/${cell.s}.svg" alt="" draggable="false">` + (cell.s === 'mult' ? `<b>${cell.v}x</b>` : '');
  el.setAttribute('aria-label', cell.s === 'mult' ? `${cell.v} times multiplier` : cell.s === 'scatter' ? 'Wish star' : SYMBOLS.find(s => s.id === cell.s).name);
  return el;
}
const place = (el, c, r) => { el.style.left = `${(c * 100) / COLS}%`; el.style.top = `${(r * 100) / ROWS}%`; };

// Show a grid: cells already on the board slide to their new row, new ones fall in from above.
async function show(grid, { drop = false } = {}) {
  const ids = new Set(grid.flat().map(c => c.id));
  for (const [id, el] of els) if (!ids.has(id)) { el.remove(); els.delete(id); }
  const fresh = [];
  grid.forEach((col, c) => {
    // new cells start above the board, as many rows up as this column has new cells
    const newInCol = col.filter(x => !els.has(x.id)).length;
    col.forEach((cell, r) => {
    let el = els.get(cell.id);
    if (!el) {
      el = cellEl(cell); els.set(cell.id, el);
      el.classList.add('instant');
      place(el, c, r - (drop ? ROWS : newInCol) - 0.5);
      board.appendChild(el);
      fresh.push({ el, c, r });
    } else place(el, c, r);
    });
  });
  void board.offsetHeight;
  fresh.forEach(({ el, c, r }) => {
    el.classList.remove('instant');
    if (drop) el.style.transitionDelay = `${c * (turbo ? 25 : 60)}ms`;
    place(el, c, r);
  });
  await wait(drop ? 520 + COLS * 60 : 420);
  fresh.forEach(({ el }) => { el.style.transitionDelay = ''; });
}

// The old grid falls out of the bottom before a new spin drops in.
async function clearBoard() {
  for (const el of els.values()) { el.style.top = '110%'; el.classList.add('falling'); }
  await wait(260);
  for (const el of els.values()) el.remove();
  els.clear();
}

async function popWins(grid, wins) {
  const hit = wins.flatMap(w => w.cells.map(([c, r]) => els.get(grid[c][r].id)));
  hit.forEach(el => el.classList.add('win'));
  await wait(650);
  hit.forEach(el => el.classList.add('pop'));
  await wait(260);
}

// ---- display ----
function setWin(amount, label = 'WIN') {
  $('#win').innerHTML = amount > 0 ? `<span>${label}</span> ${fmt(amount)}` : '';
}
function toast(text, ms = 1800) {
  const t = $('#toast');
  t.innerHTML = text; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}
function bigWin(x, amount) {
  const tier = x >= 100 ? 'Sky-high win' : x >= 50 ? 'Mega win' : x >= 20 ? 'Big win' : null;
  if (!tier) return Promise.resolve();
  const o = $('#bigwin');
  o.querySelector('h2').textContent = tier;
  o.querySelector('p').textContent = fmt(amount);
  o.hidden = false;
  return new Promise(res => {
    const done = () => { o.hidden = true; o.removeEventListener('click', done); res(); };
    o.addEventListener('click', done);
    setTimeout(done, turbo ? 1400 : 2800);
  });
}

function render() {
  $('#credits').textContent = fmt(state.credits);
  $('#bet').textContent = fmt(bet() * (state.ante && !state.feature ? ANTE_COST : 1));
  $('#ante').checked = state.ante;
  $('#ante').disabled = busy || !!state.feature;
  $('#buy-cost').textContent = fmt(bet() * BUY_COST);
  const f = state.feature;
  document.body.classList.toggle('in-feature', !!f);
  $('#fs').hidden = !f;
  if (f) {
    $('#fs-left').textContent = f.left;
    $('#fs-mult').textContent = f.totalMult ? `${f.totalMult}x` : '-';
    $('#fs-won').textContent = fmt(f.won);
  }
  const cost = round2(bet() * spinCost({ ante: state.ante }));
  $('#spin').disabled = busy || (!f && state.credits < cost);
  $('#spin').classList.toggle('stop', auto > 0);
  $('#spin').setAttribute('aria-label', auto > 0 ? `Stop autoplay (${auto} left)` : 'Spin');
  $('#auto-left').textContent = auto > 0 ? auto : '';
  $('#buy').disabled = busy || !!f || state.credits < bet() * BUY_COST;
  $('#bet-down').disabled = busy || !!f || state.bet === 0;
  $('#bet-up').disabled = busy || !!f || state.bet === BETS.length - 1;
  $('#auto').disabled = busy || !!f;
  const minCost = BETS[0];
  $('#topup').hidden = !canTopUp(minCost);
  const broke = !f && state.credits < minCost && !canTopUp(minCost);
  $('#broke').hidden = !broke;
  if (broke) {
    const mins = Math.ceil((TOP_UP_EVERY - (Date.now() - state.lastTopUp)) / 60e3);
    $('#broke').textContent = `Out of credits. Free credits again in ${mins} min.`;
  }
  renderAccount();
}

// ---- playing ----
function record(cost, win) {
  const s = state.stats;
  s.wagered = round2(s.wagered + cost);
  s.won = round2(s.won + win);
  if (win > s.biggestWin) s.biggestWin = round2(win);
}

async function playSpin(opts = {}) {
  const f = state.feature;
  const b = f ? f.bet : bet();
  const cost = f ? 0 : round2(b * spinCost({ ante: state.ante, buy: opts.buy }));
  if (!f && state.credits < cost) return;
  busy = true;
  state.credits = round2(state.credits - cost);
  if (!f) state.stats.spins++;
  setWin(0);
  render();

  const r = spin(rng, { mode: f ? 'free' : state.ante ? 'ante' : 'base', totalMult: f ? f.totalMult : 0, buy: opts.buy });
  await clearBoard();
  let shown = 0;
  for (let i = 0; i < r.steps.length; i++) {
    const { grid, wins } = r.steps[i];
    await show(grid, { drop: i === 0 });
    if (!wins.length) break;
    const pay = wins.reduce((t, w) => t + w.pay, 0) * b;
    shown += pay;
    setWin(shown);
    toast(wins.map(w => `${w.count} × ${SYMBOLS.find(s => s.id === w.s).name} <b>${fmt(w.pay * b)}</b>`).join('<br>'), 1100);
    await popWins(grid, wins);
  }

  // orbs multiply the tumbles' win
  if (r.tumbleWin > 0 && r.multSum > 0) {
    board.querySelectorAll('.cell[data-s="mult"]').forEach(el => el.classList.add('win'));
    if (f) $('#fs-mult').textContent = `${r.totalMult}x`;
    toast(f ? `+${r.multSum}x · total <b>${r.totalMult}x</b>` : `<b>${r.multSum}x</b> multiplier`, 1300);
    await wait(900);
  }
  const final = r.steps[r.steps.length - 1].grid;
  if (r.scatters >= (f ? RETRIGGER_SCATTERS : TRIGGER_SCATTERS) || r.scatterWin) {
    final.flat().filter(c => c.s === 'scatter').forEach(c => els.get(c.id).classList.add('win'));
    await wait(700);
  }

  let win = round2(r.win * b);
  if (f) {
    win = Math.min(win, round2(MAX_WIN * b - f.won)); // the whole feature is capped too
    f.won = round2(f.won + win);
    f.totalMult = r.totalMult;
    f.left -= 1;
    f.played += 1;
    if (r.freeSpins) { f.left += r.freeSpins; toast(`+${r.freeSpins} free spins!`, 1600); await wait(1200); }
    if (f.won >= MAX_WIN * b) f.left = 0;
  }
  state.credits = round2(state.credits + win);
  record(cost, win);
  setWin(f ? f.won : win, f ? 'FREE SPINS WIN' : 'WIN');
  if (!f) await bigWin(r.win, win);

  // the feature starts after the spin that triggered it, and ends with a summary
  if (!f && r.freeSpins) {
    state.stats.features++;
    state.feature = { left: r.freeSpins, played: 0, totalMult: 0, won: win, bet: b };
    auto = 0;
    persist(); render();
    await banner(`${r.freeSpins} free spins`, `Wish stars landed! Orbs now add up to one total multiplier for the whole feature.`);
  } else if (f && f.left <= 0) {
    state.feature = null;
    const x = f.won / f.bet;
    if (x > state.stats.biggestX) state.stats.biggestX = round2(x);
    if (f.won > state.stats.biggestWin) state.stats.biggestWin = f.won;
    persist(); render();
    await banner('Feature complete', `${f.played} free spins won ${fmt(f.won)} credits${f.totalMult ? ` with a ${f.totalMult}x total multiplier` : ''}.`);
  }
  if (!f && r.win > state.stats.biggestX) state.stats.biggestX = round2(r.win);

  busy = false;
  persist(); render();
  acct.sync();
}

function banner(title, text) {
  const o = $('#banner');
  o.querySelector('h2').textContent = title;
  o.querySelector('p').textContent = text;
  o.hidden = false;
  return new Promise(res => {
    const btn = o.querySelector('button');
    const done = () => { o.hidden = true; btn.removeEventListener('click', done); res(); };
    btn.addEventListener('click', done);
    btn.focus();
    if (auto > 0 || state.feature) setTimeout(done, 3500);
  });
}

// Spins go on by themselves through free spins and autoplay; the spin button stops autoplay.
async function run(opts) {
  if (busy) return;
  await playSpin(opts);
  while (!busy && (state.feature || auto > 0)) {
    if (!state.feature) {
      if (state.credits < round2(bet() * spinCost({ ante: state.ante }))) { auto = 0; break; }
      auto--;
      render();
    }
    await wait(state.feature ? 450 : 250);
    await playSpin();
  }
  if (auto < 0) auto = 0;
  render();
}

// ---- controls ----
$('#spin').addEventListener('click', () => { if (auto > 0) { auto = 0; render(); } else run(); });
$('#bet-down').addEventListener('click', () => { state.bet = Math.max(0, state.bet - 1); persist(); render(); });
$('#bet-up').addEventListener('click', () => { state.bet = Math.min(BETS.length - 1, state.bet + 1); persist(); render(); });
$('#ante').addEventListener('change', e => { state.ante = e.target.checked; persist(); render(); });
$('#turbo').addEventListener('change', e => { turbo = e.target.checked; document.body.classList.toggle('turbo', turbo); });
$('#buy').addEventListener('click', () => {
  const d = $('#buy-dialog');
  d.querySelector('[data-cost]').textContent = fmt(bet() * BUY_COST);
  d.showModal();
});
$('#buy-dialog').addEventListener('close', e => { if (e.target.returnValue === 'buy') run({ buy: true }); });
$('#auto').addEventListener('click', () => $('#auto-dialog').showModal());
$('#auto-dialog').addEventListener('close', e => {
  const n = +e.target.returnValue;
  if (n > 0) { auto = n; run(); }
});
$('#info').addEventListener('click', () => $('#info-dialog').showModal());
$('#topup').addEventListener('click', () => {
  if (!canTopUp(BETS[0])) return;
  state.credits = round2(state.credits + START_CREDITS);
  state.lastTopUp = Date.now();
  state.stats.topUps++;
  persist(); render(); acct.sync();
  toast(`+${fmt(START_CREDITS)} free credits`);
});
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || e.repeat || document.querySelector('dialog[open]') || e.target.closest('button, input')) return;
  e.preventDefault();
  $('#spin').click();
});
setInterval(() => { if (!busy) render(); }, 30e3);

// ---- paytable ----
function paytable() {
  const rows = SYMBOLS.map(s => `<tr><td><img src="assets/symbols/${s.id}.svg" alt=""> ${s.name}</td>${s.pays.map(p => `<td>${p}x</td>`).join('')}</tr>`).join('');
  $('#paytable').innerHTML = `<thead><tr><th>Symbol</th><th>${MIN_COUNT}-9</th><th>10-11</th><th>12+</th></tr></thead><tbody>${rows}</tbody>`;
  $('#scatter-pays').textContent = Object.entries(SCATTER_PAYS).map(([n, p]) => `${n}${n == 6 ? '+' : ''}: ${p}x`).join(' · ');
  for (const [sel, v] of [['[data-fs]', FREE_SPINS], ['[data-retrigger]', RETRIGGER_SPINS], ['[data-trigger]', TRIGGER_SCATTERS],
    ['[data-retrigger-n]', RETRIGGER_SCATTERS], ['[data-buy]', BUY_COST], ['[data-ante]', ANTE_COST], ['[data-max]', MAX_WIN.toLocaleString()],
    ['[data-start]', START_CREDITS.toLocaleString()]]) document.querySelectorAll(sel).forEach(el => { el.textContent = v; });
}

// ---- account ----
function renderAccount() {
  const a = acct.account();
  const btn = $('#account');
  btn.textContent = a ? a.user.email.split('@')[0] : 'Sign in';
  btn.title = a ? `Signed in as ${a.user.email}` : 'Sign in with Atlesque Play to keep your credits on every device';
  $('#sync').textContent = a ? (acct.status.busy ? 'Saving…' : a.syncedAt ? 'Saved to Atlesque Play' : '') : 'Guest: credits stay in this browser';
  const st = state.stats;
  $('#acct-email').textContent = a ? a.user.email : 'Not signed in';
  $('#acct-signin').hidden = !!a; $('#acct-signout').hidden = !a;
  $('#acct-stats').innerHTML = [['Spins', st.spins], ['Wagered', fmt(st.wagered)], ['Won', fmt(st.won)], ['Biggest win', fmt(st.biggestWin)],
    ['Best multiple', `${st.biggestX}x`], ['Free spins features', st.features]].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#acct-msg').textContent = acct.status.banned || acct.status.error || '';
}
$('#account').addEventListener('click', () => { renderAccount(); $('#account-dialog').showModal(); });
$('#acct-signin').addEventListener('click', () => acct.beginSignIn());
$('#acct-signout').addEventListener('click', () => { acct.signOut(); $('#account-dialog').close(); });
acct.onAccount(renderAccount);
acct.setHooks({
  read: serialize,
  replace: data => { if (!busy) { replace(data); render(); } },
});
setInterval(() => { if (!busy) acct.sync(); }, acct.SYNC_EVERY);
addEventListener('pagehide', () => acct.syncOnLeave());
document.addEventListener('visibilitychange', () => { if (document.hidden) acct.syncOnLeave(); });

// ---- boot ----
async function boot() {
  paytable();
  render();
  await show(fillGrid(rng, 'base'), { drop: true });
  await acct.finishSignIn();
  const r = await acct.connect();
  if (r === 'loaded') toast('Loaded your credits from Atlesque Play');
  if (r === 'uploaded') toast('Your credits are now saved to Atlesque Play');
  if (r === 'reset') toast('Your progress was reset');
  render();
  // a feature left unfinished (closed tab) carries on where it stopped
  if (state.feature) { toast(`${state.feature.left} free spins left`); await wait(1200); run(); }
}
boot();
