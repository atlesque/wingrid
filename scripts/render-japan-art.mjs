// Renders the Japan theme's drawn art to the WebP files the game loads, through a headless Chromium:
// `node scripts/render-japan-art.mjs [board] [backdrop]` (both by default). Needs Playwright, globally or in
// node_modules. The board comes from scripts/japan-board.mjs and the drawn backdrop from japan-backdrop.mjs.
import { writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { boardSvg, BOX } from './japan-board.mjs';
import { backdropSvg } from './japan-backdrop.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = createRequire(execSync('npm root -g').toString().trim() + '/').call(null, 'playwright'); }
const OUT = new URL('../public/theme/japan/', import.meta.url);
const SCALE = 2;
await mkdir(OUT, { recursive: true });
const browser = await playwright.chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage();
async function render(name, svg, w, h, scale, quality) {
  if (process.env.SVG) await writeFile(new URL(`${name}.svg`, OUT), svg);
  const data = await page.evaluate(async ({ svg, w, h, scale, quality }) => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
    await img.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(w * scale), height: Math.round(h * scale) });
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/webp', quality);
  }, { svg, w, h, scale, quality });
  await writeFile(new URL(`${name}.webp`, OUT), Buffer.from(data.split(',')[1], 'base64'));
  console.log(`${name}.webp`);
}
const only = process.argv.slice(2);
for (const mode of ['base', 'free']) {
  if (!only.length || only.includes('board')) await render(`board-${mode}`, boardSvg(mode), BOX.w, BOX.h, SCALE, 0.92);
  // the backdrops at 2560 on their long side
  if (!only.length || only.includes('backdrop')) for (const shape of ['land', 'port'])
    await render(`backdrop-${mode}-${shape}`, backdropSvg({ mode, shape }), shape === 'land' ? 1920 : 1080, shape === 'land' ? 1080 : 1920, 4 / 3, 0.88);
}
await browser.close();
