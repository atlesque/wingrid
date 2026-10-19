// Renders the Japan-theme board (scripts/japan-board.mjs) to the WebP files the game loads, through a headless
// Chromium: `node scripts/render-japan-art.mjs`. Needs Playwright, globally or in node_modules.
import { writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { boardSvg, BOX } from './japan-board.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright'); }
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
for (const mode of ['base', 'free']) await render(`board-${mode}`, boardSvg(mode), BOX.w, BOX.h, SCALE, 0.92);
await browser.close();
