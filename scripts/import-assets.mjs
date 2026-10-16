// Copies the Starlight Princess art the page uses from the decoded archive into public/starlight/:
//   spines/<name>/   every skeleton, with an .atlas rebuilt from the desktop scene data (see atlases.mjs)
//   ui/              every NGUI atlas page, and ui/atlases.json with each atlas's sprite rects
//   fonts.css        the game's web fonts (base64 WOFF inside), under their original family names
//   layout/          the captured layouts and symbol rigs from layout/
// The folder is git-ignored. Usage: npm run assets [path/to/starlight-princess-archive]
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sceneAtlases, atlasText, uiAtlases, uhtSpines } from './atlases.mjs';

const archive = resolve(process.argv[2] || '../starlight-princess-archive');
const src = join(archive, 'extracted');
const out = resolve('public/starlight');
if (!existsSync(join(src, 'index.json'))) {
  console.error(`No decoded archive at ${src}. Run tools/extract_assets.py in the archive first.`);
  process.exit(1);
}
const index = JSON.parse(readFileSync(join(src, 'index.json'), 'utf8'));
const textureFile = guid => ['png', 'jpg'].map(e => join(src, 'textures', `${guid}.${e}`)).find(existsSync);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'spines'), { recursive: true });

// ---- Spine skeletons ----
// The decoded archive's .atlas files mix in the mini build's sprite rects, so each is rebuilt here from the
// desktop scene data, with its page images taken from the desktop textures.
const { atlases, links } = sceneAtlases(archive);
const skeletonsByName = uhtSpines(archive);
const SPINES = Object.keys(skeletonsByName).filter(s => !/^lobby_button/.test(s));
for (const s of SPINES) {
  const dir = join(out, 'spines', s);
  mkdirSync(join(dir, 'images'), { recursive: true });
  const { id: sid, skeleton: skel } = skeletonsByName[s];
  writeFileSync(join(dir, `${s}.json`), JSON.stringify(skel));
  const list = [...(links[sid] || [])].map(g => atlases[g]).filter(Boolean);
  // some skeletons draw from an atlas their controller doesn't name: add whichever atlas has the missing regions
  const need = new Set();
  for (const skin of Object.values(skel.skins || {})) for (const slot of Object.values(skin))
    for (const [k, a] of Object.entries(slot)) if (!['boundingbox', 'path', 'point', 'clipping'].includes(a.type)) need.add(a.path || a.name || k);
  const has = n => list.some(a => `s_${n}` in a.sprites || n in a.sprites);
  for (const n of need) {
    if (has(n)) continue;
    const extra = Object.values(atlases).find(a => `s_${n}` in a.sprites && textureFile(a.page));
    if (extra) list.push(extra); else console.warn(`  ${s}: no region ${n}`);
  }
  const pages = {};
  for (const a of list) {
    const file = textureFile(a.page);
    if (!file) continue;
    const ext = file.split('.').pop();
    cpSync(file, join(dir, 'images', `${a.page}.${ext}`));
    pages[a.page] = { file, rel: `images/${a.page}.${ext}` };
  }
  if (!Object.keys(pages).length) console.warn(`  ${s}: no atlas found in the scene data`);
  writeFileSync(join(dir, `${s}.atlas`), atlasText(list, pages));
}

// ---- NGUI atlases (backgrounds, reel frame, logo, symbols, buttons) ----
const ui = uiAtlases(archive);
mkdirSync(join(out, 'ui'), { recursive: true });
const uiOut = {};
for (const [name, a] of Object.entries(ui)) {
  const file = a.page && textureFile(a.page);
  if (!file) continue;
  const b = readFileSync(file), png = b[0] === 0x89;
  const size = png ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null;
  const ext = png ? 'png' : 'jpg';
  if (!existsSync(join(out, 'ui', `${a.page}.${ext}`))) cpSync(file, join(out, 'ui', `${a.page}.${ext}`));
  uiOut[name] = { page: `${a.page}.${ext}`, size, sprites: a.sprites };
}
writeFileSync(join(out, 'ui', 'atlases.json'), JSON.stringify(uiOut));

// ---- fonts ----
const css = index.filter(e => e.kind === 'font-css').map(e => readFileSync(join(src, e.path), 'utf8')).join('\n');
writeFileSync(join(out, 'fonts.css'), css);

// ---- sounds: every clip as mp3, and an index of the file names (the page knows clips by id prefix) ----
mkdirSync(join(out, 'audio'), { recursive: true });
const mp3s = readdirSync(join(src, 'audio')).filter(f => f.endsWith('.mp3'));
for (const f of mp3s) cpSync(join(src, 'audio', f), join(out, 'audio', f));
writeFileSync(join(out, 'audio', 'index.json'), JSON.stringify(mp3s));

// ---- captured layouts ----
mkdirSync(join(out, 'layout'), { recursive: true });
for (const f of readdirSync('layout').filter(f => f.endsWith('.json'))) cpSync(join('layout', f), join(out, 'layout', f));

console.log(`Copied ${SPINES.length} skeletons, ${Object.keys(uiOut).length} UI atlases and the fonts to ${out}`);
