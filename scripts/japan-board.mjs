// The Japan-theme board: a vermilion lacquer frame with gold mouldings and corner fittings, a gold cherry-blossom
// crest flanked by cloud scrolls, round a reel window patterned with seigaiha waves (base game) or asanoha
// (free spins). It is drawn to the captured reel frame's box, in its units, so the window lines up with the
// symbol grid exactly: 6 x 5 cells of 213.4 x 161.1 starting 50 units in from the left and 74 down from the top.
export const BOX = { w: 1382.8, h: 931.3 };
const COLS = 6, ROWS = 5, CW = 213.4, CH = 161.1;
const WIN = { x: 50, y: 74, w: COLS * CW, h: ROWS * CH };
const CX = WIN.x + WIN.w / 2;

const f = n => +n.toFixed(2);
const stops = list => list.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('');

const LOOKS = {
  base: {
    window: [[0, '#2350b4'], [0.45, '#163a8e'], [1, '#0c1f58']],
    pattern: { fill: '#1d4297', line: '#3a6ad0', alpha: 0.42 },
    glow: '#7fd4ff',
  },
  free: {
    window: [[0, '#8a2fc4'], [0.45, '#5c168f'], [1, '#2e0753']],
    pattern: { fill: 'none', line: '#c27cf0', alpha: 0.3 },
    glow: '#ff9be8',
  },
};

// gold, as bands of light across a moulding (0 = its outer edge, 1 = its inner edge)
const GOLD = [[0, '#fff6cf'], [0.18, '#ffe089'], [0.45, '#d29a2e'], [0.62, '#f6cf63'], [0.82, '#b9771f'], [1, '#7a4510']];
const LACQUER = [[0, '#ef5a33'], [0.22, '#d8381f'], [0.7, '#b01f14'], [1, '#6e0b08']];

// One mitred ring between two rectangles, each side shaded across its own width like a moulding.
let gradId = 0;
function ring(defs, o, i, look) {
  const out = [];
  const sides = [
    { pts: [[o.x, o.y], [o.x + o.w, o.y], [i.x + i.w, i.y], [i.x, i.y]], from: [0, o.y], to: [0, i.y] },
    { pts: [[o.x, o.y + o.h], [o.x + o.w, o.y + o.h], [i.x + i.w, i.y + i.h], [i.x, i.y + i.h]], from: [0, o.y + o.h], to: [0, i.y + i.h] },
    { pts: [[o.x, o.y], [o.x, o.y + o.h], [i.x, i.y + i.h], [i.x, i.y]], from: [o.x, 0], to: [i.x, 0] },
    { pts: [[o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [i.x + i.w, i.y + i.h], [i.x + i.w, i.y]], from: [o.x + o.w, 0], to: [i.x + i.w, 0] },
  ];
  sides.forEach((s, n) => {
    const id = `g${gradId++}`;
    // light falls from the top left: the bottom and right sides sit a little darker
    const shade = n === 1 || n === 3 ? look.map(([p, c, a = 1]) => [p, c, a]) : look;
    defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(s.from[0])}" y1="${f(s.from[1])}" x2="${f(s.to[0] || s.from[0])}" y2="${f(s.to[1] || s.from[1])}">${stops(shade)}</linearGradient>`);
    out.push(`<polygon points="${s.pts.map(p => p.map(f).join(',')).join(' ')}" fill="url(#${id})"${n === 1 || n === 3 ? ' filter="url(#dim)"' : ''}/>`);
  });
  return out.join('');
}
const inset = (r, d) => ({ x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d });
const grow = (r, l, t, rr, b) => ({ x: r.x - l, y: r.y - t, w: r.w + l + rr, h: r.h + t + b });

// a five-petalled cherry blossom, each petal notched at its tip, as a path centred on (x, y)
function sakura(x, y, r, turn = -Math.PI / 2) {
  let d = '';
  for (let i = 0; i < 5; i++) {
    const a = turn + i * Math.PI * 2 / 5, s = Math.PI / 5 * 0.92;
    const p = (ang, rad) => [x + Math.cos(ang) * rad, y + Math.sin(ang) * rad].map(f).join(' ');
    d += `M${p(a - s * 0.18, r * 0.12)} C${p(a - s * 1.05, r * 0.55)} ${p(a - s * 0.8, r * 1.02)} ${p(a - s * 0.22, r * 1.0)}`
      + ` L${p(a, r * 0.8)} L${p(a + s * 0.22, r * 1.0)} C${p(a + s * 0.8, r * 1.02)} ${p(a + s * 1.05, r * 0.55)} ${p(a + s * 0.18, r * 0.12)} Z `;
  }
  return d;
}

// Seigaiha: rows of concentric half circles, each row overlapping the one above it.
function seigaiha(defs, p) {
  const r = 22, rings = [1, 0.76, 0.52, 0.28];
  const fan = (x, y) => rings.map((k, i) => `<circle cx="${x}" cy="${y}" r="${f(r * k)}" fill="${i ? 'none' : p.fill}" stroke="${p.line}" stroke-opacity="${p.alpha}" stroke-width="${i ? 1.3 : 1.6}"/>`).join('');
  defs.push(`<pattern id="waves" patternUnits="userSpaceOnUse" x="${WIN.x}" y="${WIN.y}" width="${2 * r}" height="${r}">`
    + `<rect width="${2 * r}" height="${r}" fill="${p.fill}"/>${fan(0, 0)}${fan(2 * r, 0)}${fan(r, r / 2)}${fan(0, r)}${fan(2 * r, r)}</pattern>`);
  return `<rect x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="${WIN.h}" fill="url(#waves)"/>`;
}

// Asanoha (hemp leaf): a triangular lattice with each triangle's corners joined to its centre.
function asanoha(p) {
  const s = 46, h = s * Math.sqrt(3) / 2, seg = [];
  const add = (a, b) => seg.push(`M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}`);
  for (let row = -1; row * h < WIN.h + h; row++) {
    for (let col = -1; col * s < WIN.w + s; col++) {
      const x = WIN.x + col * s + (row % 2 ? s / 2 : 0), y = WIN.y + row * h;
      const tri = [[[x, y], [x + s, y], [x + s / 2, y + h]], [[x + s, y], [x + s / 2, y + h], [x + s * 1.5, y + h]]];
      for (const t of tri) {
        const c = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3];
        add(t[0], t[1]); add(t[1], t[2]);
        for (const v of t) add(v, c);
      }
    }
  }
  return `<path d="${seg.join('')}" stroke="${p.line}" stroke-opacity="${p.alpha}" stroke-width="1.2" fill="none"/>`;
}

// A gold corner fitting: an L-shaped plate wrapping the frame's corner, its arms ending in a pointed
// three-lobed tip, with an engraved border, a blossom over the corner and a pair of rivets on each arm.
function cornerFitting(cx, cy, sx, sy) {
  const L = 118, T = 46; // arm length, plate width
  const tip = (len) => {
    // the arm's end along x, as a lobed point
    const b = T;
    return `L${len} 0 C${len + 10} 0 ${len + 12} ${b * 0.2} ${len + 8} ${b * 0.32} C${len + 20} ${b * 0.36} ${len + 26} ${b * 0.5} ${len + 30} ${b * 0.5}`
      + ` C${len + 26} ${b * 0.5} ${len + 20} ${b * 0.64} ${len + 8} ${b * 0.68} C${len + 12} ${b * 0.8} ${len + 10} ${b} ${len} ${b}`;
  };
  // drawn for the top-left corner, then mirrored into place
  const plate = `M0 6 Q0 0 6 0 ${tip(L)} L${T} ${T} L${T} ${L} C${T} ${L + 10} ${T * 0.8} ${L + 12} ${T * 0.68} ${L + 8}`
    + ` C${T * 0.64} ${L + 20} ${T * 0.5} ${L + 26} ${T * 0.5} ${L + 30} C${T * 0.5} ${L + 26} ${T * 0.36} ${L + 20} ${T * 0.32} ${L + 8}`
    + ` C${T * 0.2} ${L + 12} 0 ${L + 10} 0 ${L} Z`;
  const engraved = `M7 7 L${L - 4} 7 M7 7 L7 ${L - 4} M${T - 7} ${T - 7} L${L - 4} ${T - 7} M${T - 7} ${T - 7} L${T - 7} ${L - 4}`;
  const rivet = (x, y) => `<circle cx="${x}" cy="${y}" r="5.2" fill="#6b3a0b"/><circle cx="${x}" cy="${y}" r="4.2" fill="url(#rivet)"/>`;
  return `<g transform="translate(${cx} ${cy}) scale(${sx} ${sy})" filter="url(#lift)">`
    + `<path d="${plate}" fill="#5a2f07" transform="translate(-1.6 -1.6) scale(1.025)"/>`
    + `<path d="${plate}" fill="url(#plate)" stroke="#6b3a0b" stroke-width="1.6"/>`
    + `<path d="${engraved}" stroke="#7a4a12" stroke-opacity=".55" stroke-width="1.4" fill="none"/>`
    + rivet(L - 6, T / 2) + rivet(T / 2, L - 6) + rivet(L - 36, T / 2) + rivet(T / 2, L - 36)
    + `<path d="${sakura(T / 2, T / 2, 21)}" fill="#6b3a0b" transform="translate(0 1.5)"/>`
    + `<path d="${sakura(T / 2, T / 2, 19)}" fill="url(#bloom)" stroke="#7a4510" stroke-width="1.2"/>`
    + `<circle cx="${T / 2}" cy="${T / 2}" r="5" fill="url(#rivet)" stroke="#7a4510" stroke-width="1"/>`
    + `</g>`;
}

// A Japanese cloud scroll: puffs along a band, curling into a spiral at the outer end. Drawn for the left
// of the crest (curling leftwards), from x0 (near the crest) to x1 (outer end), along baseline y.
function cloud(x0, x1, y, flip) {
  const len = x0 - x1, puffs = [[0.08, 13], [0.3, 18], [0.52, 15], [0.72, 12]];
  const k = flip ? -1 : 1, X = t => f(flip ? CX + (CX - (x0 - t * len)) : x0 - t * len);
  let back = '', front = '';
  for (const [t, r] of puffs) {
    back += `<circle cx="${X(t)}" cy="${f(y - r * 0.55)}" r="${r + 2.4}" fill="#5a2f07"/>`;
    front += `<circle cx="${X(t)}" cy="${f(y - r * 0.55)}" r="${r}" fill="url(#plate)"/>`;
  }
  const bx0 = X(0), bx1 = X(0.86);
  const band = `<rect x="${Math.min(bx0, bx1)}" y="${y - 6}" width="${Math.abs(bx1 - bx0)}" height="13" rx="6.5"`;
  // the spiral at the outer end
  const sx = X(0.9), sy = y - 6;
  const spiral = `M${f(sx + k * 10)} ${f(sy + 12)} C${f(sx - k * 6)} ${f(sy + 14)} ${f(sx - k * 14)} ${f(sy)} ${f(sx - k * 6)} ${f(sy - 9)}`
    + ` C${f(sx + k * 2)} ${f(sy - 16)} ${f(sx + k * 12)} ${f(sy - 8)} ${f(sx + k * 8)} ${f(sy)} C${f(sx + k * 5)} ${f(sy + 5)} ${f(sx - k * 1)} ${f(sy + 2)} ${f(sx)} ${f(sy - 2)}`;
  const lines = puffs.slice(1).map(([t, r]) => `M${f(X(t) - k * r * 0.7)} ${f(y - r * 0.2)} Q${X(t)} ${f(y - r * 1.15)} ${f(X(t) + k * r * 0.7)} ${f(y - r * 0.2)}`).join(' ');
  return `<g filter="url(#lift)">${back}${band} fill="#5a2f07" transform="translate(0 0)" stroke="#5a2f07" stroke-width="4.8"/>`
    + `<circle cx="${sx}" cy="${sy}" r="16.5" fill="#5a2f07"/>${front}${band} fill="url(#plate)"/>`
    + `<circle cx="${sx}" cy="${sy}" r="14" fill="url(#plate)"/>`
    + `<path d="${spiral}" stroke="#7a4510" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
    + `<path d="${lines}" stroke="#7a4510" stroke-opacity=".7" stroke-width="1.6" fill="none" stroke-linecap="round"/></g>`;
}

export function boardSvg(mode = 'base') {
  gradId = 0;
  const look = LOOKS[mode], defs = [];
  // the frame's bands, by how far each edge stands out from the window (sides and bottom, top)
  const band = (d, top = d) => grow(WIN, d, top, d, d);
  const outer = band(40, 36), gold1 = outer, gold1i = band(32, 28);
  const lacq = band(30, 26), lacqi = band(10), gold2 = band(8), gold2i = band(3);

  defs.push(`<filter id="dim"><feColorMatrix type="matrix" values=".82 0 0 0 0  0 .8 0 0 0  0 0 .78 0 0  0 0 0 1 0"/></filter>`);
  defs.push(`<filter id="shadow" x="-5%" y="-5%" width="110%" height="115%"><feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#0a0420" flood-opacity=".75"/></filter>`);
  defs.push(`<filter id="lift" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="2.5" stdDeviation="2" flood-color="#2a0c00" flood-opacity=".7"/></filter>`);
  defs.push(`<linearGradient id="plate" x1="0" y1="0" x2="1" y2="1">${stops([[0, '#fff3c4'], [0.25, '#ffd977'], [0.55, '#d79b2f'], [0.75, '#f3c85a'], [1, '#9a5a16']])}</linearGradient>`);
  defs.push(`<radialGradient id="rivet" cx=".35" cy=".3" r=".75">${stops([[0, '#fffbe6'], [0.35, '#ffd66e'], [1, '#8a5114']])}</radialGradient>`);
  defs.push(`<radialGradient id="bloom" cx=".4" cy=".35" r=".8">${stops([[0, '#fff8dc'], [0.4, '#ffd36a'], [1, '#b26d1c']])}</radialGradient>`);
  defs.push(`<linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">${stops([[0, '#ffffff', 0.55], [0.45, '#ffffff', 0.08], [1, '#ffffff', 0]])}</linearGradient>`);
  defs.push(`<linearGradient id="window" x1="0" y1="0" x2="0" y2="1">${stops(look.window)}</linearGradient>`);
  defs.push(`<linearGradient id="windowShade" x1="0" y1="0" x2="0" y2="1">${stops([[0, '#000', 0], [0.6, '#000', 0.12], [1, '#000', 0.4]])}</linearGradient>`);
  defs.push(`<radialGradient id="vignette" cx=".5" cy=".45" r=".75">${stops([[0.55, '#000', 0], [1, '#000', 0.45]])}</radialGradient>`);
  defs.push(`<linearGradient id="bottomGlow" x1="0" y1="0" x2="0" y2="1">${stops([[0, look.glow, 0], [1, look.glow, 0.38]])}</linearGradient>`);
  defs.push(`<linearGradient id="edgeT" x1="0" y1="0" x2="0" y2="1">${stops([[0, '#05020f', 0.75], [1, '#05020f', 0]])}</linearGradient>`);
  defs.push(`<linearGradient id="edgeL" x1="0" y1="0" x2="1" y2="0">${stops([[0, '#05020f', 0.6], [1, '#05020f', 0]])}</linearGradient>`);
  defs.push(`<linearGradient id="edgeR" x1="1" y1="0" x2="0" y2="0">${stops([[0, '#05020f', 0.6], [1, '#05020f', 0]])}</linearGradient>`);
  defs.push(`<linearGradient id="divider" x1="0" y1="0" x2="0" y2="1">${stops([[0, '#ffe69a', 0.85], [0.5, '#e2b04a', 0.55], [1, '#ffe69a', 0.85]])}</linearGradient>`);

  // the reel window
  defs.push(`<clipPath id="win"><rect x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="${WIN.h}"/></clipPath>`);
  let body = `<rect x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="${WIN.h}" fill="url(#window)"/>`;
  body += mode === 'base' ? seigaiha(defs, look.pattern) : asanoha(look.pattern);
  body += `<rect x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="${WIN.h}" fill="url(#windowShade)"/>`;
  body += `<rect x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="${WIN.h}" fill="url(#vignette)"/>`;
  body += `<rect x="${WIN.x}" y="${WIN.y + WIN.h - 70}" width="${WIN.w}" height="70" fill="url(#bottomGlow)"/>`;
  for (let c = 1; c < COLS; c++) {
    const x = f(WIN.x + c * CW);
    body += `<rect x="${f(x - 2.2)}" y="${WIN.y}" width="4.4" height="${WIN.h}" fill="#05020f" opacity=".35"/>`
      + `<rect x="${f(x - 0.9)}" y="${WIN.y}" width="1.8" height="${WIN.h}" fill="url(#divider)"/>`;
  }
  body += `<rect x="${WIN.x}" y="${WIN.y}" width="${WIN.w}" height="26" fill="url(#edgeT)"/>`
    + `<rect x="${WIN.x}" y="${WIN.y}" width="20" height="${WIN.h}" fill="url(#edgeL)"/>`
    + `<rect x="${WIN.x + WIN.w - 20}" y="${WIN.y}" width="20" height="${WIN.h}" fill="url(#edgeR)"/>`;

  // the frame: gold moulding, a black line, vermilion lacquer, gold moulding, a dark lip
  let frame = `<rect x="${outer.x}" y="${outer.y}" width="${outer.w}" height="${outer.h}" rx="6" fill="#1a0604"/>`;
  frame += ring(defs, gold1, gold1i, GOLD);
  frame += ring(defs, gold1i, lacq, [[0, '#140302'], [1, '#2a0705']]);
  frame += ring(defs, lacq, lacqi, LACQUER);
  // a glossy streak along the lacquer's top and left
  frame += `<rect x="${lacq.x + 6}" y="${lacq.y + 2}" width="${lacq.w - 12}" height="${f((lacqi.y - lacq.y) * 0.45)}" rx="3" fill="url(#shine)" opacity=".7"/>`;
  frame += ring(defs, lacqi, gold2, [[0, '#1a0403'], [1, '#3a0c08']]);
  frame += ring(defs, gold2, gold2i, GOLD);
  frame += ring(defs, gold2i, WIN, [[0, '#2a1204'], [1, '#05020f']]);
  // small gold blossoms inlaid along the lacquer, between the fittings
  const studs = [];
  const midY = lacq.y + (lacqi.y - lacq.y) / 2, botY = lacqi.y + lacqi.h + (lacq.y + lacq.h - lacqi.y - lacqi.h) / 2;
  const leftX = lacq.x + (lacqi.x - lacq.x) / 2, rightX = lacqi.x + lacqi.w + (lacq.x + lacq.w - lacqi.x - lacqi.w) / 2;
  for (let c = 1; c < COLS; c++) if (c !== 3) studs.push([WIN.x + c * CW, midY], [WIN.x + c * CW, botY]);
  for (let r = 1; r < ROWS; r++) studs.push([leftX, WIN.y + r * CH], [rightX, WIN.y + r * CH]);
  for (const [x, y] of studs) frame += `<path d="${sakura(x, y + 1, 8.2)}" fill="#4a1405"/><path d="${sakura(x, y, 7.4)}" fill="url(#bloom)"/><circle cx="${f(x)}" cy="${f(y)}" r="1.8" fill="#c2421f"/>`;

  // fittings on the corners and the middle of the sides
  const fit = cornerFitting(outer.x - 4, outer.y - 4, 1, 1) + cornerFitting(outer.x + outer.w + 4, outer.y - 4, -1, 1)
    + cornerFitting(outer.x - 4, outer.y + outer.h + 4, 1, -1) + cornerFitting(outer.x + outer.w + 4, outer.y + outer.h + 4, -1, -1);
  const side = (x, y) => `<g filter="url(#lift)"><path d="M${x} ${y - 30} L${x + 22} ${y} L${x} ${y + 30} L${x - 22} ${y} Z" fill="url(#plate)" stroke="#6b3a0b" stroke-width="1.6"/>`
    + `<path d="${sakura(x, y, 12)}" fill="url(#bloom)" stroke="#7a4510" stroke-width="1"/><circle cx="${x}" cy="${y}" r="3.2" fill="url(#rivet)"/></g>`;
  const sides = side(f(leftX), f(WIN.y + WIN.h / 2)) + side(f(rightX), f(WIN.y + WIN.h / 2)) + side(f(CX), f(botY));

  // the crest: a gold cherry-blossom mon on black lacquer, with a cloud scroll either side
  const cy = 47, cr = 30;
  const crest = cloud(CX - 30, CX - 236, 60, false) + cloud(CX - 30, CX - 236, 60, true)
    + `<g filter="url(#lift)"><circle cx="${f(CX)}" cy="${cy}" r="${cr + 3}" fill="#5a2f07"/>`
    + `<circle cx="${f(CX)}" cy="${cy}" r="${cr}" fill="url(#plate)"/>`
    + `<circle cx="${f(CX)}" cy="${cy}" r="${cr - 6}" fill="#1c0605" stroke="#7a4510" stroke-width="1.4"/>`
    + `<circle cx="${f(CX)}" cy="${cy}" r="${cr - 9}" fill="none" stroke="url(#plate)" stroke-width="1.6"/>`
    + `<path d="${sakura(CX, cy, 17)}" fill="#5a2f07" transform="translate(0 1.5)"/>`
    + `<path d="${sakura(CX, cy, 16)}" fill="url(#bloom)" stroke="#7a4510" stroke-width="1"/>`
    + `<circle cx="${f(CX)}" cy="${cy}" r="4" fill="#c2421f"/><circle cx="${f(CX)}" cy="${cy}" r="2" fill="#ffdf8a"/></g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX.w} ${BOX.h}" width="${BOX.w}" height="${BOX.h}">`
    + `<defs>${defs.join('')}</defs>`
    + `<g filter="url(#shadow)">${frame}</g><g clip-path="url(#win)">${body}</g>${fit}${sides}${crest}</svg>`;
}
