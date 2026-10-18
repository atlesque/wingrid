// ================= WINGRID ENGINE =================
// The game's rules, with no DOM: a 6x5 grid that pays for 8 or more of a symbol anywhere on it. Winning
// symbols vanish and the ones above fall into their place (a tumble) until nothing more wins. Multiplier
// orbs and wish stars never vanish; when a spin's tumbles won anything, the orbs left on the grid add up
// and multiply that win. 4 or more wish stars start free spins, where the orbs build one total multiplier
// that stays for the whole feature. Every amount here is in credits; nothing is real money.
export const COLS = 6, ROWS = 5;
export const MIN_COUNT = 8;
export const MAX_WIN = 5000; // times the bet, for one spin or one whole free spins feature
export const FREE_SPINS = 15, RETRIGGER_SPINS = 5;
export const TRIGGER_SCATTERS = 4, RETRIGGER_SCATTERS = 3;
export const BUY_COST = 100;  // times the bet
export const ANTE_COST = 1.25; // times the bet, for increased natural feature chances
export const BETS = [0.2, 0.4, 1, 2, 4, 10, 20, 50, 100];
export const START_CREDITS = 1000;

// Paying symbols, best first. pays[i] is the win in bets for 8-9, 10-11 and 12+ of it.
export const SYMBOLS = [
  { id: 'crown',     name: 'Crown',     pays: [15, 40, 80] },
  { id: 'chalice',   name: 'Chalice',   pays: [5, 15, 40] },
  { id: 'hourglass', name: 'Hourglass', pays: [4, 10, 25] },
  { id: 'ring',      name: 'Ring',      pays: [3, 5, 20] },
  { id: 'amethyst',  name: 'Amethyst',  pays: [2, 3, 15] },
  { id: 'topaz',     name: 'Topaz',     pays: [1.5, 2.5, 12] },
  { id: 'emerald',   name: 'Emerald',   pays: [1, 2, 8] },
  { id: 'sapphire',  name: 'Sapphire',  pays: [0.8, 1.5, 6] },
  { id: 'ruby',      name: 'Ruby',      pays: [0.5, 1, 4] },
];
export const SYMBOL = Object.fromEntries(SYMBOLS.map(s => [s.id, s]));
// wish stars pay for 4, 5 and 6 or more of them anywhere, in bets
export const SCATTER_PAYS = { 4: 3, 5: 5, 6: 100 };

// How often each symbol lands in a cell. Free spins use their own weights with more orbs.
const BASE_WEIGHTS = { crown: 4, chalice: 6, hourglass: 7, ring: 8, amethyst: 10, topaz: 11, emerald: 12, sapphire: 13, ruby: 14 };
const FREE_WEIGHTS = { crown: 5, chalice: 6, hourglass: 7, ring: 8, amethyst: 10, topaz: 11, emerald: 12, sapphire: 13, ruby: 14 };
// chance per cell, on top of the weights above
const SCATTER_CHANCE = { base: 0.0175, ante: 0.0215, free: 0.0125 };
const MULT_CHANCE = { base: 0.0039, free: 0.04 };
export const MULTIPLIERS = [
  [2, 300], [3, 220], [4, 160], [5, 130], [6, 90], [8, 70], [10, 50], [12, 30], [15, 22],
  [20, 14], [25, 9], [50, 4], [100, 2], [250, 0.6], [500, 0.25],
];

// ---- randomness: a function returning [0, 1) ----
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function secureRandom() {
  const b = new Uint32Array(1);
  return () => (crypto.getRandomValues(b), b[0] / 4294967296);
}

function pickWeighted(rng, entries) {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rng() * total;
  for (const [v, w] of entries) if ((r -= w) < 0) return v;
  return entries[entries.length - 1][0];
}
const BASE_ENTRIES = Object.entries(BASE_WEIGHTS), FREE_ENTRIES = Object.entries(FREE_WEIGHTS);

// cells carry an id so the UI can tell which ones fell and which are new
let nextId = 1;
function newCell(rng, mode) {
  const id = nextId++;
  const r = rng();
  const scatter = SCATTER_CHANCE[mode], mult = MULT_CHANCE[mode === 'free' ? 'free' : 'base'];
  if (r < scatter) return { id, s: 'scatter' };
  if (r < scatter + mult) return { id, s: 'mult', v: pickWeighted(rng, MULTIPLIERS) };
  return { id, s: pickWeighted(rng, mode === 'free' ? FREE_ENTRIES : BASE_ENTRIES) };
}

// grid[c][r], row 0 at the top
export function fillGrid(rng, mode) {
  return Array.from({ length: COLS }, () => Array.from({ length: ROWS }, () => newCell(rng, mode)));
}
const cloneGrid = g => g.map(col => col.map(c => ({ ...c })));

function payFor(id, count) {
  const p = SYMBOL[id].pays;
  return count >= 12 ? p[2] : count >= 10 ? p[1] : p[0];
}

// Every symbol with 8 or more on the grid: { s, count, pay (in bets), cells: [[c, r], ...] }
export function findWins(grid) {
  const seen = {};
  grid.forEach((col, c) => col.forEach((cell, r) => {
    if (!SYMBOL[cell.s]) return;
    (seen[cell.s] ||= []).push([c, r]);
  }));
  const wins = [];
  for (const [s, cells] of Object.entries(seen)) {
    if (cells.length >= MIN_COUNT) wins.push({ s, count: cells.length, pay: payFor(s, cells.length), cells });
  }
  return wins.sort((a, b) => b.pay - a.pay);
}

// Winning cells vanish; what is above falls down and new cells fill the top of each column.
export function tumble(grid, wins, rng, mode) {
  const gone = new Set(wins.flatMap(w => w.cells.map(([c, r]) => c * ROWS + r)));
  return grid.map((col, c) => {
    const kept = col.filter((_, r) => !gone.has(c * ROWS + r));
    const fresh = Array.from({ length: ROWS - kept.length }, () => newCell(rng, mode));
    return [...fresh, ...kept];
  });
}

export const countScatters = grid => grid.reduce((n, col) => n + col.filter(c => c.s === 'scatter').length, 0);
export const multipliersOn = grid => grid.flatMap(col => col.filter(c => c.s === 'mult').map(c => c.v));
export function scatterPay(n) { return n >= 6 ? SCATTER_PAYS[6] : SCATTER_PAYS[n] || 0; }

// Put wish stars into random cells until the grid has `n` of them (a bought feature).
function forceScatters(grid, rng, n) {
  const g = cloneGrid(grid);
  const free = [];
  g.forEach((col, c) => col.forEach((cell, r) => { if (cell.s !== 'scatter') free.push([c, r]); }));
  for (let have = countScatters(g); have < n && free.length; have++) {
    const [c, r] = free.splice(Math.floor(rng() * free.length), 1)[0];
    g[c][r] = { id: nextId++, s: 'scatter' };
  }
  return g;
}

// One spin, start to finish. Amounts in the result are in bets (multiply by the bet for credits).
//   mode: 'base' | 'ante' | 'free';  totalMult: the free spins total multiplier coming into this spin
//   buy: a bought feature, so the first grid gets 4 to 6 wish stars
// Returns { steps, tumbleWin, mults, multSum, appliedMult, totalMult, scatters, scatterWin, win, freeSpins }
// where steps[i] = { grid, wins } is each tumble in order (the last has no wins), and freeSpins is how many
// free spins this spin awards (0 when none).
export function spin(rng, { mode = 'base', totalMult = 0, buy = false } = {}) {
  let grid = fillGrid(rng, mode);
  if (buy) grid = forceScatters(grid, rng, pickWeighted(rng, [[4, 80], [5, 16], [6, 4]]));
  const steps = [];
  let tumbleWin = 0;
  for (;;) {
    const wins = findWins(grid);
    steps.push({ grid: cloneGrid(grid), wins });
    if (!wins.length) break;
    tumbleWin += wins.reduce((t, w) => t + w.pay, 0);
    grid = tumble(grid, wins, rng, mode);
  }
  const mults = multipliersOn(grid);
  const multSum = mults.reduce((a, b) => a + b, 0);
  let appliedMult = 1;
  if (tumbleWin > 0 && multSum > 0) {
    if (mode === 'free') { totalMult += multSum; appliedMult = totalMult; }
    else appliedMult = multSum;
  }
  const scatters = countScatters(grid);
  const scatterWin = scatterPay(scatters);
  const freeSpins = mode === 'free'
    ? (scatters >= RETRIGGER_SCATTERS ? RETRIGGER_SPINS : 0)
    : (scatters >= TRIGGER_SCATTERS ? FREE_SPINS : 0);
  return {
    steps, tumbleWin, mults, multSum, appliedMult, totalMult, scatters, scatterWin,
    win: Math.min(tumbleWin * appliedMult + scatterWin, MAX_WIN), freeSpins,
  };
}

// What a spin costs, in bets
export const spinCost = ({ ante = false, buy = false } = {}) => buy ? BUY_COST : ante ? ANTE_COST : 1;
