// Letters the scatter symbol "MBP": `node scripts/render-scatter-art.mjs`. The painting the game loads
// (public/characters/princess-v2/scatter.png) came with "SCATTER" painted across its foot, so this starts from that
// first painting (read out of git history) and lays a gold-rimmed purple nameplate over the old word, then three
// glossy gold Lilita One letters on it, drawn the way the painted ones were: a dark outline, a deep orange side,
// a gold face with a bright top and a streak of gloss. Needs Playwright, globally or in node_modules.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright'); }
const ROOT = new URL('../', import.meta.url);
const OUT = new URL('public/characters/princess-v2/scatter.png', ROOT);
const SOURCE = 'c9dbea7:public/characters/princess-v2/scatter.png';
const TEXT = process.env.TEXT || 'MBP';

const painting = execSync(`git show ${SOURCE}`, { cwd: ROOT, maxBuffer: 1 << 26 }).toString('base64');
const font = (await readFile(new URL('node_modules/@fontsource/lilita-one/files/lilita-one-latin-400-normal.woff2', ROOT))).toString('base64');

const browser = await playwright.chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage();
const data = await page.evaluate(async ({ painting, font, text }) => {
  const face = new FontFace('Lilita', `url(data:font/woff2;base64,${font})`);
  await face.load(); document.fonts.add(face);
  const img = new Image();
  img.src = `data:image/png;base64,${painting}`;
  await img.decode();
  const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
  const g = canvas.getContext('2d');
  g.drawImage(img, 0, 0);

  const grad = (y0, y1, stops) => { const l = g.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, c]) => l.addColorStop(o, c)); return l; };
  const capsule = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };

  // the nameplate, sized to cover every pixel of the old word and its shadow
  const P = { x: 128, y: 766, w: 1110 + 34, h: 312, r: 96 };
  g.save();
  g.shadowColor = 'rgba(40,10,0,.55)'; g.shadowBlur = 18; g.shadowOffsetY = 8;
  capsule(P.x, P.y, P.w, P.h, P.r); g.fillStyle = '#4a1d04'; g.fill();
  g.restore();
  capsule(P.x + 4, P.y + 4, P.w - 8, P.h - 8, P.r - 4);
  g.fillStyle = grad(P.y, P.y + P.h, [[0, '#fff3b8'], [0.2, '#ffd75a'], [0.5, '#d9921c'], [0.72, '#ffd04a'], [1, '#8a4a0c']]); g.fill();
  capsule(P.x + 22, P.y + 22, P.w - 44, P.h - 44, P.r - 22);
  g.fillStyle = '#5a2a06'; g.fill();
  capsule(P.x + 26, P.y + 26, P.w - 52, P.h - 52, P.r - 26);
  g.fillStyle = grad(P.y + 26, P.y + P.h - 26, [[0, '#6a3fd6'], [0.45, '#3c1c9a'], [1, '#1d0c5a']]); g.fill();
  // a soft light in the plate's middle and a few twinkles, like the sky behind her
  g.save(); g.clip();
  const glow = g.createRadialGradient(P.x + P.w / 2, P.y + P.h * .45, 10, P.x + P.w / 2, P.y + P.h * .45, P.w * .5);
  glow.addColorStop(0, 'rgba(160,130,255,.55)'); glow.addColorStop(1, 'rgba(160,130,255,0)');
  g.fillStyle = glow; g.fillRect(P.x, P.y, P.w, P.h);
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(P.x, P.y + 26, P.w, (P.h - 52) * .42);
  g.restore();

  // the letters
  const size = 410, cx = P.x + P.w / 2, base = P.y + P.h - 52;
  g.font = `${size}px Lilita`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.letterSpacing = '6px';
  const m = g.measureText(text);
  const squeeze = Math.min(1, (P.w - 120) / m.width);
  const top = base - m.actualBoundingBoxAscent, bottom = base + m.actualBoundingBoxDescent;
  const at = (fn, dy = 0) => { g.save(); g.translate(cx, base + dy); g.scale(squeeze, 1); fn(); g.restore(); };
  const DEPTH = 22;
  // shadow and dark outline round the whole extruded stack
  at(() => { g.shadowColor = 'rgba(30,5,0,.7)'; g.shadowBlur = 24; g.shadowOffsetY = 14; g.lineJoin = 'round'; g.lineWidth = 30; g.strokeStyle = '#3a1404'; g.strokeText(text, 0, 0); }, DEPTH);
  for (let d = DEPTH; d >= 0; d -= 2) at(() => { g.lineJoin = 'round'; g.lineWidth = 30; g.strokeStyle = '#3a1404'; g.strokeText(text, 0, 0); }, d);
  // the deep orange side
  for (let d = DEPTH; d > 0; d -= 1) at(() => {
    g.fillStyle = grad(top - base, bottom - base, [[0, '#e07a0c'], [1, '#8a3a06']]); g.fillText(text, 0, 0);
    g.lineJoin = 'round'; g.lineWidth = 10; g.strokeStyle = d > DEPTH - 3 ? '#7a2c04' : '#b5520a'; g.strokeText(text, 0, 0);
  }, d);
  // a thin bright rim, then the gold face
  at(() => { g.lineJoin = 'round'; g.lineWidth = 10; g.strokeStyle = grad(top - base, bottom - base, [[0, '#fff8d0'], [0.5, '#ffc93a'], [1, '#d07a10']]); g.strokeText(text, 0, 0); });
  at(() => {
    g.fillStyle = grad(top - base, bottom - base, [[0, '#fffbe0'], [0.18, '#ffe866'], [0.48, '#ffc214'], [0.7, '#f59a00'], [0.86, '#ffb11c'], [1, '#ffd65a']]);
    g.fillText(text, 0, 0);
  });
  // gloss across the top of each letter, clipped to the face
  const mask = Object.assign(document.createElement('canvas'), { width: canvas.width, height: canvas.height });
  const k = mask.getContext('2d');
  k.font = g.font; k.textAlign = 'center'; k.letterSpacing = g.letterSpacing;
  k.save(); k.translate(cx, base); k.scale(squeeze, 1); k.fillStyle = '#fff'; k.fillText(text, 0, 0); k.restore();
  k.globalCompositeOperation = 'source-in';
  const gl = k.createLinearGradient(0, top, 0, top + (bottom - top) * .5);
  gl.addColorStop(0, 'rgba(255,255,255,.75)'); gl.addColorStop(0.55, 'rgba(255,255,255,.22)'); gl.addColorStop(0.56, 'rgba(255,255,255,0)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  k.fillStyle = gl; k.fillRect(0, 0, mask.width, mask.height);
  g.drawImage(mask, 0, 0);

  // a few sparkles on the gold
  const sparkle = (x, y, r) => {
    g.save(); g.translate(x, y); g.globalCompositeOperation = 'lighter';
    const halo = g.createRadialGradient(0, 0, 0, 0, 0, r * .6); halo.addColorStop(0, 'rgba(255,250,220,.9)'); halo.addColorStop(1, 'rgba(255,240,180,0)');
    g.fillStyle = halo; g.beginPath(); g.arc(0, 0, r * .6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fffbe8'; g.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, l = i % 2 ? r * .12 : r; g.lineTo(Math.cos(a) * l, Math.sin(a) * l); }
    g.fill(); g.restore();
  };
  const half = m.width * squeeze / 2;
  sparkle(cx - half * .78, top + 30, 46);
  sparkle(cx + half * .2, top + 18, 34);
  sparkle(cx + half * .9, base - 40, 40);
  return canvas.toDataURL('image/png');
}, { painting, font, text: TEXT });
await writeFile(OUT, Buffer.from(data.split(',')[1], 'base64'));
console.log(OUT.pathname);
await browser.close();
