// A drawn Japan backdrop: Mount Fuji over a lake, a pagoda, a torii in the water and cherry trees, by day
// (base game) or on a lantern-lit night (free spins), composed for a landscape or a portrait screen. The game
// board covers the middle, so the landmarks sit at the edges, along the top and, in portrait, at the bottom.
const f = n => +n.toFixed(1);
const stops = list => list.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('');

// a seeded random, so a render is the same every time
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

const PALETTE = {
  day: {
    sky: [[0, '#2a63c9'], [0.42, '#5ea6ef'], [0.72, '#f3c3dc'], [1, '#ffe2c4']],
    glow: '#fff1c9', mist: '#fff3e6', mistAlpha: 0.55,
    fuji: [[0, '#5a78c9'], [1, '#a9b6e8']], snow: [[0, '#ffffff'], [1, '#d9dcf7']],
    far: '#8aa6dc', mid: '#5d84c6', near: '#3f6aae',
    lake: [[0, '#a8d0f5'], [0.5, '#6d9fde'], [1, '#2d5aa6']], shimmer: '#ffffff',
    blossom: ['#ffe3ef', '#ffc2dc', '#f79ac3', '#ef7fb2'], bark: '#4a2a3a',
    vermilion: '#e0452a', roof: '#33243f', shore: '#5c4a6e',
  },
  night: {
    sky: [[0, '#12093a'], [0.45, '#3d1470'], [0.75, '#8a2c8c'], [1, '#d4589a']],
    glow: '#ffd2f0', mist: '#e7b4ff', mistAlpha: 0.28,
    fuji: [[0, '#2b2160'], [1, '#4c2f7c']], snow: [[0, '#f3e9ff'], [1, '#a995d9']],
    far: '#4a2a7c', mid: '#371e63', near: '#28144c',
    lake: [[0, '#6b2f8f'], [0.5, '#3a1764'], [1, '#170a35']], shimmer: '#ffd9f2',
    blossom: ['#ffe6f6', '#ffb7e3', '#f483cc', '#d45fb5'], bark: '#2a1530',
    vermilion: '#d23a2a', roof: '#1c1030', shore: '#24123d',
  },
};

function blossomTree(r, x, y, size, dir, P, flip = 1) {
  // a trunk leaning in from the edge, its branches carrying clouds of blossom
  let out = `<path d="M${f(x)} ${f(y + size * 0.9)} C${f(x + dir * size * 0.1)} ${f(y + size * 0.4)} ${f(x + dir * size * 0.05)} ${f(y)} ${f(x + dir * size * 0.35)} ${f(y - size * 0.35 * flip)}`
    + ` M${f(x + dir * size * 0.08)} ${f(y + size * 0.3)} C${f(x + dir * size * 0.4)} ${f(y + size * 0.15)} ${f(x + dir * size * 0.6)} ${f(y - size * 0.05)} ${f(x + dir * size * 0.85)} ${f(y - size * 0.02)}"`
    + ` stroke="${P.bark}" stroke-width="${f(size * 0.07)}" fill="none" stroke-linecap="round"/>`;
  const puffs = [];
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r());
    puffs.push([x + dir * size * (0.35 + Math.cos(a) * 0.55 * d), y - size * 0.1 * flip + Math.sin(a) * size * 0.38 * d, size * (0.12 + r() * 0.12)]);
  }
  puffs.sort((p, q) => p[1] - q[1]);
  for (const [px, py, pr] of puffs) {
    out += `<circle cx="${f(px)}" cy="${f(py + pr * 0.15)}" r="${f(pr)}" fill="${P.blossom[3]}" opacity=".8"/>`
      + `<circle cx="${f(px - pr * 0.12)}" cy="${f(py - pr * 0.08)}" r="${f(pr * 0.86)}" fill="url(#bloom)"/>`;
  }
  // single blossoms speckled over the canopy
  for (let i = 0; i < 60; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r());
    out += `<circle cx="${f(x + dir * size * (0.35 + Math.cos(a) * 0.62 * d))}" cy="${f(y - size * 0.1 * flip + Math.sin(a) * size * 0.42 * d)}" r="${f(size * 0.012 + r() * size * 0.01)}" fill="#fff" opacity="${f(0.5 + r() * 0.5)}"/>`;
  }
  return out;
}

function pagoda(x, base, h, P, lit) {
  // five storeys narrowing upwards, each a dark sweeping roof over a vermilion body, a spire on top
  let out = '', y = base;
  const storey = h * 0.14;
  for (let i = 0; i < 5; i++) {
    const w = h * (0.34 - i * 0.04), bw = w * 0.62;
    out += `<rect x="${f(x - bw / 2)}" y="${f(y - storey * 0.62)}" width="${f(bw)}" height="${f(storey * 0.62)}" fill="${P.vermilion}"/>`;
    if (lit) out += `<rect x="${f(x - bw * 0.3)}" y="${f(y - storey * 0.5)}" width="${f(bw * 0.6)}" height="${f(storey * 0.36)}" fill="#ffcf7a" opacity=".85"/>`;
    for (let k = -2; k <= 2; k++) out += `<rect x="${f(x + k * bw * 0.22 - 1.5)}" y="${f(y - storey * 0.62)}" width="3" height="${f(storey * 0.62)}" fill="#7a1a10" opacity=".6"/>`;
    const ry = y - storey * 0.62, rw = w * 0.62;
    out += `<path d="M${f(x - rw)} ${f(ry + storey * 0.06)} Q${f(x - rw * 0.6)} ${f(ry - storey * 0.1)} ${f(x - rw * 0.42)} ${f(ry - storey * 0.32)} L${f(x + rw * 0.42)} ${f(ry - storey * 0.32)} Q${f(x + rw * 0.6)} ${f(ry - storey * 0.1)} ${f(x + rw)} ${f(ry + storey * 0.06)} Q${f(x)} ${f(ry - storey * 0.08)} ${f(x - rw)} ${f(ry + storey * 0.06)} Z" fill="${P.roof}"/>`;
    y = ry - storey * 0.32;
  }
  out += `<rect x="${f(x - 2.5)}" y="${f(y - h * 0.22)}" width="5" height="${f(h * 0.22)}" fill="#c9a24a"/>`;
  for (let k = 1; k <= 6; k++) out += `<rect x="${f(x - 7)}" y="${f(y - k * h * 0.028)}" width="14" height="3" fill="#c9a24a"/>`;
  return out;
}

function torii(x, base, h, P) {
  const w = h * 1.05, pw = h * 0.07;
  const left = x - w * 0.36, right = x + w * 0.36;
  return `<rect x="${f(left - pw / 2)}" y="${f(base - h)}" width="${f(pw)}" height="${f(h)}" fill="${P.vermilion}"/>`
    + `<rect x="${f(right - pw / 2)}" y="${f(base - h)}" width="${f(pw)}" height="${f(h)}" fill="${P.vermilion}"/>`
    + `<rect x="${f(x - w * 0.46)}" y="${f(base - h * 0.78)}" width="${f(w * 0.92)}" height="${f(h * 0.07)}" fill="${P.vermilion}"/>`
    + `<path d="M${f(x - w * 0.6)} ${f(base - h * 1.02)} Q${f(x)} ${f(base - h * 0.9)} ${f(x + w * 0.6)} ${f(base - h * 1.02)} L${f(x + w * 0.56)} ${f(base - h * 0.92)} Q${f(x)} ${f(base - h * 0.84)} ${f(x - w * 0.56)} ${f(base - h * 0.92)} Z" fill="${P.vermilion}"/>`
    + `<path d="M${f(x - w * 0.62)} ${f(base - h * 1.08)} Q${f(x)} ${f(base - h * 0.95)} ${f(x + w * 0.62)} ${f(base - h * 1.08)} L${f(x + w * 0.6)} ${f(base - h * 1.01)} Q${f(x)} ${f(base - h * 0.89)} ${f(x - w * 0.6)} ${f(base - h * 1.01)} Z" fill="${P.roof}"/>`
    + `<rect x="${f(x - pw * 0.4)}" y="${f(base - h * 0.92)}" width="${f(pw * 0.8)}" height="${f(h * 0.14)}" fill="${P.vermilion}"/>`;
}

function lantern(x, y, s) {
  return `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(s * 2.6)}" ry="${f(s * 2.6)}" fill="url(#lanternGlow)"/>`
    + `<rect x="${f(x - s * 0.55)}" y="${f(y - s * 0.95)}" width="${f(s * 1.1)}" height="${f(s * 0.18)}" fill="#3a1410"/>`
    + `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(s * 0.72)}" ry="${f(s * 0.86)}" fill="url(#lanternBody)"/>`
    + `<rect x="${f(x - s * 0.5)}" y="${f(y + s * 0.78)}" width="${f(s)}" height="${f(s * 0.16)}" fill="#3a1410"/>`;
}

export function backdropSvg({ mode = 'base', shape = 'land' } = {}) {
  const night = mode === 'free', P = PALETTE[night ? 'night' : 'day'];
  const land = shape === 'land';
  const W = land ? 1920 : 1080, H = land ? 1080 : 1920;
  const r = rng(night ? 7 : 3);
  const defs = [], parts = [];
  defs.push(`<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${stops(P.sky)}</linearGradient>`);
  defs.push(`<linearGradient id="fuji" x1="0" y1="0" x2="0" y2="1">${stops(P.fuji)}</linearGradient>`);
  defs.push(`<linearGradient id="snow" x1="0" y1="0" x2="1" y2="1">${stops(P.snow)}</linearGradient>`);
  defs.push(`<linearGradient id="lake" x1="0" y1="0" x2="0" y2="1">${stops(P.lake)}</linearGradient>`);
  defs.push(`<radialGradient id="bloom" cx=".4" cy=".35" r=".7">${stops([[0, P.blossom[0]], [0.5, P.blossom[1]], [1, P.blossom[2]]])}</radialGradient>`);
  defs.push(`<radialGradient id="glow">${stops([[0, P.glow, night ? 0.9 : 0.75], [0.3, P.glow, 0.35], [1, P.glow, 0]])}</radialGradient>`);
  defs.push(`<radialGradient id="lanternGlow">${stops([[0, '#ffb35c', 0.75], [0.4, '#ff7a3c', 0.25], [1, '#ff5a2a', 0]])}</radialGradient>`);
  defs.push(`<radialGradient id="lanternBody" cx=".45" cy=".4" r=".7">${stops([[0, '#fff2b0'], [0.45, '#ff9a3c'], [1, '#c8261c']])}</radialGradient>`);
  defs.push(`<filter id="soft"><feGaussianBlur stdDeviation="${land ? 6 : 7}"/></filter>`);
  defs.push(`<filter id="haze"><feGaussianBlur stdDeviation="2.2"/></filter>`);

  parts.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);
  // the horizon: in landscape behind the board's lower half, in portrait just under the top third
  const hz = land ? 690 : 900;
  const fx = W / 2, peak = land ? 250 : 420, fw = land ? 1700 : 1500;
  // sun or moon
  if (night) {
    const mx = land ? W * 0.8 : W * 0.74, my = land ? 150 : 250, mr = land ? 95 : 120;
    parts.push(`<circle cx="${mx}" cy="${my}" r="${mr * 4}" fill="url(#glow)"/>`
      + `<circle cx="${mx}" cy="${my}" r="${mr}" fill="#fff4e8"/><circle cx="${mx + mr * 0.25}" cy="${my - mr * 0.15}" r="${mr * 0.22}" fill="#f1dcd8" opacity=".6"/>`
      + `<circle cx="${mx - mr * 0.3}" cy="${my + mr * 0.3}" r="${mr * 0.15}" fill="#f1dcd8" opacity=".5"/>`);
    for (let i = 0; i < (land ? 160 : 180); i++) {
      const sx = r() * W, sy = r() * hz * 0.75, sr = 0.8 + r() * 2.2;
      parts.push(`<circle cx="${f(sx)}" cy="${f(sy)}" r="${f(sr)}" fill="#fff" opacity="${f(0.35 + r() * 0.65)}"/>`);
    }
  } else {
    parts.push(`<circle cx="${fx}" cy="${hz - 40}" r="${land ? 700 : 760}" fill="url(#glow)"/>`);
  }
  // golden mist bands, the old painters' way of layering a view
  const band = (x, y, w, h, a) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(h / 2)}" fill="${P.mist}" opacity="${f(a)}"/>`;
  const bands = land
    ? [[-80, 120, 620, 46], [1350, 90, 700, 40], [260, 330, 520, 34], [1220, 300, 560, 36], [-60, 520, 560, 40], [1500, 520, 520, 40]]
    : [[-60, 120, 520, 44], [600, 200, 560, 40], [-80, 640, 460, 36], [680, 700, 480, 38]];
  for (const [x, y, w, h] of bands) parts.push(band(x, y, w, h, P.mistAlpha * (0.6 + r() * 0.4)));
  // Mount Fuji, its snow cap ragged at the foot
  const foot = hz + 20;
  parts.push(`<path d="M${f(fx - fw / 2)} ${foot} C${f(fx - fw * 0.28)} ${f(foot - 90)} ${f(fx - fw * 0.12)} ${f(peak + 70)} ${f(fx - fw * 0.06)} ${peak} L${f(fx + fw * 0.06)} ${peak} C${f(fx + fw * 0.12)} ${f(peak + 70)} ${f(fx + fw * 0.28)} ${f(foot - 90)} ${f(fx + fw / 2)} ${foot} Z" fill="url(#fuji)"/>`);
  const capY = peak + (foot - peak) * 0.36;
  let cap = `M${f(fx - fw * 0.06)} ${peak} L${f(fx + fw * 0.06)} ${peak} C${f(fx + fw * 0.1)} ${f(peak + 50)} ${f(fx + fw * 0.15)} ${f(capY - 30)} ${f(fx + fw * 0.19)} ${f(capY)}`;
  const teeth = 9;
  for (let i = 0; i <= teeth; i++) {
    const t = i / teeth, x = fx + fw * (0.19 - 0.38 * t);
    cap += ` L${f(x + fw * 0.01)} ${f(capY - 30 - r() * 40)} L${f(x - fw * 0.012)} ${f(capY + (i % 2 ? 40 : 10) * r())}`;
  }
  cap += ` C${f(fx - fw * 0.15)} ${f(capY - 30)} ${f(fx - fw * 0.1)} ${f(peak + 50)} ${f(fx - fw * 0.06)} ${peak} Z`;
  parts.push(`<path d="${cap}" fill="url(#snow)"/>`);
  parts.push(band(fx - fw * 0.42, foot - 120, fw * 0.5, 30, P.mistAlpha * 0.8), band(fx + fw * 0.02, foot - 90, fw * 0.4, 26, P.mistAlpha * 0.8));
  // hills, far to near
  const hills = (y, amp, color, seed, step) => {
    let d = `M0 ${H} L0 ${f(y)}`;
    for (let x = 0; x <= W; x += step) d += ` Q${f(x + step / 2)} ${f(y - amp * (0.4 + Math.sin(x * 0.006 + seed) * 0.6))} ${f(x + step)} ${f(y + Math.sin(x * 0.011 + seed) * amp * 0.3)}`;
    return `<path d="${d} L${W} ${H} Z" fill="${color}"/>`;
  };
  parts.push(hills(hz + 10, 40, P.far, 1, 160), hills(hz + 34, 30, P.mid, 3, 120));
  // the lake
  parts.push(`<rect x="0" y="${hz + 46}" width="${W}" height="${H - hz - 46}" fill="url(#lake)"/>`);
  for (let i = 0; i < 70; i++) {
    const y = hz + 56 + r() ** 1.4 * (H - hz - 60), w = 30 + r() * 180;
    parts.push(`<rect x="${f(r() * W)}" y="${f(y)}" width="${f(w)}" height="2.4" rx="1.2" fill="${P.shimmer}" opacity="${f(0.12 + r() * 0.3)}"/>`);
  }
  if (night) {
    const mx = land ? W * 0.8 : W * 0.74;
    parts.push(`<rect x="${f(mx - 40)}" y="${hz + 60}" width="80" height="${H - hz - 80}" fill="#ffe9f6" opacity=".18" filter="url(#soft)"/>`);
  }
  // landmarks: the pagoda on a hill at the left, the torii in the water at the right
  if (land) {
    parts.push(`<path d="M-40 ${H} L-40 ${hz - 40} Q120 ${hz - 110} 300 ${hz - 30} Q380 ${hz + 20} 420 ${H} Z" fill="${P.near}"/>`);
    parts.push(pagoda(165, hz - 70, 560, P, night));
    parts.push(torii(1740, hz + 260, 300, P));
    parts.push(`<g opacity=".35" transform="translate(0 ${2 * (hz + 260)}) scale(1 -1)">${torii(1740, hz + 260, 300, P)}</g>`);
    parts.push(`<path d="M-40 ${H} L-40 ${H - 120} Q300 ${H - 170} 640 ${H - 110} L640 ${H} Z M${W + 40} ${H} L${W + 40} ${H - 110} Q${W - 260} ${H - 150} ${W - 560} ${H - 90} L${W - 560} ${H} Z" fill="${P.shore}"/>`);
    parts.push(blossomTree(r, -30, 230, 520, 1, P), blossomTree(r, W + 30, 250, 520, -1, P));
    parts.push(blossomTree(r, -20, H - 260, 380, 1, P, -1), blossomTree(r, W + 20, H - 240, 360, -1, P, -1));
  } else {
    parts.push(`<path d="M-40 ${hz + 260} Q160 ${hz + 180} 330 ${hz + 260} L330 ${hz + 320} L-40 ${hz + 320} Z" fill="${P.near}" opacity=".9"/>`);
    parts.push(pagoda(150, hz + 270, 420, P, night));
    const tb = H - 200;
    parts.push(torii(W * 0.62, tb, 360, P));
    parts.push(`<g opacity=".35" transform="translate(0 ${2 * tb}) scale(1 -1)">${torii(W * 0.62, tb, 360, P)}</g>`);
    parts.push(`<path d="M-40 ${H} L-40 ${H - 170} Q300 ${H - 230} 620 ${H - 140} Q860 ${H - 90} ${W + 40} ${H - 130} L${W + 40} ${H} Z" fill="${P.shore}"/>`);
    parts.push(blossomTree(r, -30, 170, 520, 1, P), blossomTree(r, W + 30, 230, 500, -1, P));
    parts.push(blossomTree(r, -20, H - 300, 400, 1, P, -1));
  }
  // lanterns strung along the shore on festival nights
  if (night) {
    const rows = land ? [[0, 560, H - 150, 18, 34], [W - 640, W, H - 140, 18, 34]] : [[0, W, H - 250, 22, 36]];
    for (const [x0, x1, y, n, s] of rows) {
      let d = `M${x0} ${y}`;
      const pts = [];
      for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, yy = y + Math.sin(i / n * Math.PI * 2) * 22; pts.push([x, yy]); d += ` L${f(x)} ${f(yy)}`; }
      parts.push(`<path d="${d}" stroke="#2a0f1c" stroke-width="2.5" fill="none"/>`);
      pts.forEach(([x, yy], i) => { if (i % 2) parts.push(lantern(x, yy + s * 1.1, s)); });
    }
  }
  // drifting petals
  for (let i = 0; i < (land ? 90 : 100); i++) {
    const x = r() * W, y = r() * H, s = 4 + r() * 7, a = r() * 180;
    parts.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(s)}" ry="${f(s * 0.6)}" transform="rotate(${f(a)} ${f(x)} ${f(y)})" fill="${P.blossom[1]}" opacity="${f(0.55 + r() * 0.4)}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${defs.join('')}</defs>${parts.join('')}</svg>`;
}
