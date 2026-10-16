import * as PIXI from 'pixi.js';
import { Spine } from 'pixi-spine';
import { createPrincessV2 } from './character-v2.js';

// ================= SCENE =================
// Draws the game exactly as the original lays it out. layout/<name>.json is one captured frame of the original
// (scripts/capture-layout.js): every sprite, label and Spine skeleton it drew, in draw order, with the screen
// transform it had. This file draws that list with the original art, then puts our own grid of symbols where the
// original's reels were, built from the original symbol rigs (layout/symbols.json).
export const COLS = 6, ROWS = 5;
const ART = '/starlight';

// engine symbol id → the original's symbol prefab
const PREFAB = {
  crown: 'S_3', chalice: 'S_4', hourglass: 'S_5', ring: 'S_6',
  amethyst: 'S_7', topaz: 'S_8', emerald: 'S_9', sapphire: 'S_10', ruby: 'S_11',
  scatter: 'S_1', mult: 'S_12',
};
// multipliers come in four colours by size, each with its own sprite and animations
const MULT = [[100, 'Yellow', 'yellow'], [25, 'Pink', 'purple'], [10, 'Blue', 'blue'], [0, 'Green', 'green']];
const multLook = v => MULT.find(([min]) => v >= min);

let app, atlases, rigs, layouts, world, cover, symbolLayer, current;
const textures = new Map(), skeletons = new Map();
const ui = {};            // named widgets the page updates or listens to
const sprites = new Map(); // cell id → symbol container

// ---- loading ----
async function json(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }

// the game's fonts come in through index.html; wait until the ones the labels use are ready
async function loadFonts() {
  await Promise.all(['fa4f86b3ab18f0bb4abc48168c8403b', 'f3320ee73b763d9e4e9793dd9eeb2ee', 'f7c3a065d936c6e04fbe62646823e5a', 'feaa81c33b0c4a80479fac5d3bf0006']
    .map(f => document.fonts.load(`40px ${f}`).catch(() => {})));
}

async function pageTexture(file) {
  if (!textures.has(file)) textures.set(file, PIXI.Assets.load(`${ART}/ui/${file}`));
  return (await textures.get(file)).baseTexture;
}

// One NGUI sprite as a Pixi texture. The sprite list's width and height are its rect on the page; a rotated
// sprite lies there a quarter turn (Pixi's rotation 6) and is h x w upright. Padding is the transparent border
// trimmed off it, which the texture gets back as its original size.
const spriteTextures = new Map();
async function spriteTexture(atlasName, name, { trimmed = false } = {}) {
  const key = `${atlasName}/${name}/${trimmed}`;
  if (spriteTextures.has(key)) return spriteTextures.get(key);
  // Keep our branding outside the imported art so asset imports and the remote
  // archive fallback cannot restore the original game's title in either layout.
  if (atlasName === 'Logo_English' && name === 'Logo_English') {
    const texture = await PIXI.Assets.load('/branding/wingrid-logo.png');
    spriteTextures.set(key, texture);
    return texture;
  }
  const a = atlases[atlasName], s = a && a.sprites[name];
  if (!s) return null;
  const base = await pageTexture(a.page);
  const [pl, pt, pr, pb] = s.pad;
  // (one archived page, S10, came out 2px smaller than its sprite list says: keep the frame on the page)
  const frame = new PIXI.Rectangle(s.x, s.y, Math.min(s.w, base.width - s.x), Math.min(s.h, base.height - s.y));
  const [uw, uh] = s.rotate ? [s.h, s.w] : [s.w, s.h];
  const tex = trimmed
    ? new PIXI.Texture(base, frame, new PIXI.Rectangle(0, 0, uw, uh), new PIXI.Rectangle(0, 0, uw, uh), s.rotate ? 6 : 0)
    : new PIXI.Texture(base, frame, new PIXI.Rectangle(0, 0, uw + pl + pr, uh + pt + pb), new PIXI.Rectangle(pl, pt, uw, uh), s.rotate ? 6 : 0);
  spriteTextures.set(key, tex);
  return tex;
}

async function skeleton(name) {
  name = name.replace(/_SkeletonData$/, '');
  if (!skeletons.has(name)) skeletons.set(name, PIXI.Assets.load(`${ART}/spines/${name}/${name}.json`).then(r => r.spineData));
  return skeletons.get(name);
}

// ---- widgets ----
const rgb = c => c ? (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255) : 0xffffff;
const css = c => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3] ?? 1})`;
const place = (obj, wt) => { obj.transform.setFromMatrix(new PIXI.Matrix(...wt)); return obj; };

// an NGUI sprite of w x h widget units, pivoted at (ax, ay); type 1 is 9-sliced by the sprite's borders
async function makeSprite(it) {
  const s = atlases[it.atlas]?.sprites[it.sprite];
  if (!s) return null;
  let obj;
  if (it.type === 1 && s.border.some(Boolean)) {
    const [l, t, r, b] = s.border;
    obj = new PIXI.NineSlicePlane(await spriteTexture(it.atlas, it.sprite, { trimmed: true }), l, t, r, b);
    obj.width = it.w; obj.height = it.h;
    obj.pivot.set(it.ax * it.w, it.ay * it.h);
  } else {
    obj = new PIXI.Sprite(await spriteTexture(it.atlas, it.sprite));
    obj.anchor.set(it.ax, it.ay);
    obj.width = it.w; obj.height = it.h;
  }
  obj.tint = rgb(it.color);
  obj.alpha = (it.color ? it.color[3] : 1) * (it.alpha ?? 1);
  // the *Add atlases are glow layers drawn additively (black is their resting colour, so they show nothing)
  if (/Add$/.test(it.atlas)) obj.blendMode = PIXI.BLEND_MODES.ADD;
  const box = new PIXI.Container();
  box.addChild(obj);
  return box;
}

// A label drawn the way LabelMultipleLayers draws it: layers stacked bottom first, each a flat or gradient fill
// with an outline and a blurred shadow.
function layerStyle(it, l) {
  const size = it.size;
  const st = { fontFamily: it.font, fontSize: size, align: it.ax === 0 ? 'left' : it.ax === 1 ? 'right' : 'center',
    lineHeight: size + (it.spacingY || 0), padding: Math.round(size / 4), lineJoin: 'round' };
  if (l.fill !== false) {
    if (l.fillGradient && l.fillGradient.colors.length) {
      st.fill = l.fillGradient.colors.map(c => css(c));
      st.fillGradientStops = l.fillGradient.colors.map(c => c[4]);
      st.fillGradientType = PIXI.TEXT_GRADIENT.LINEAR_VERTICAL;
    } else st.fill = css(l.fillColor || [1, 1, 1, 1]);
  } else st.fill = 'rgba(0,0,0,0)';
  if (l.outline && l.outlineThickness) { st.stroke = css(l.outlineColor); st.strokeThickness = l.outlineThickness * size / 12; }
  if (l.shadow && l.shadowSize) {
    st.dropShadow = true; st.dropShadowColor = css(l.shadowColor); st.dropShadowBlur = l.shadowSize * size / 30;
    const [dx, dy] = l.shadowOffset || [0, 0];
    st.dropShadowDistance = Math.hypot(dx, dy) * size / 30; st.dropShadowAngle = Math.atan2(dy, dx) || Math.PI / 2;
  }
  return st;
}
function makeLabel(it, b) {
  const box = new PIXI.Container();
  const layers = it.layers && it.layers.length ? it.layers : [{
    fill: true, fillColor: it.color ? [...it.color.slice(0, 3), 1] : [1, 1, 1, 1],
    outline: it.outline, outlineThickness: it.outlineThickness, outlineColor: it.outlineColor,
    shadow: it.effect === 1 || it.effect === 4, shadowSize: 2, shadowOffset: [0, 1.5], shadowColor: [0, 0, 0, 0.8],
  }];
  const texts = layers.map(l => {
    const t = new PIXI.Text(it.text || '', layerStyle(it, l));
    t.anchor.set(it.ax, it.ay);
    if (l.offset) t.position.set(l.offset[0], -l.offset[1]);
    box.addChild(t);
    return t;
  });
  box.alpha = it.alpha ?? 1;
  box.setText = s => {
    for (const t of texts) t.text = s;
    // shrink to the label's box, as the original's labels do
    const room = b ? Math.max(it.w, (b.w / b.k) - it.size * 0.5) : it.w;
    const k = Math.min(1, room / Math.max(1, texts[0].width - it.size / 2));
    for (const t of texts) t.scale.set(k);
  };
  box.setText(it.text || '');
  box.naturalWidth = texts[0].width; // the captured text's glyph width, unscaled
  return box;
}

// ---- placing captured widgets where the original drew them ----
// The capture holds each widget's drawn pieces: their on-screen bounds and transforms at draw time.
function drawnBounds(it) {
  const ls = (it.leaves || []).filter(l => l.b[2] > 0 && l.b[3] > 0);
  if (!ls.length) return null;
  // the same pieces repeat once per captured frame; the union of them is the drawn area
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of ls) { x0 = Math.min(x0, l.b[0]); y0 = Math.min(y0, l.b[1]); x1 = Math.max(x1, l.b[0] + l.b[2]); y1 = Math.max(y1, l.b[1] + l.b[3]); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, flipX: ls[0].wt[0] < 0, flipY: ls[0].wt[3] < 0, k: Math.abs(ls[0].wt[0]), ky: Math.abs(ls[0].wt[3]) };
}
// a sprite stretched over the drawn area (which includes its padding, except for 9-sliced ones)
async function layoutSprite(it, b) {
  const s = atlases[it.atlas]?.sprites[it.sprite];
  if (!s) return null;
  let obj;
  if (it.type === 1 && s.border.some(Boolean)) {
    const [l, t, r, bb] = s.border;
    obj = new PIXI.NineSlicePlane(await spriteTexture(it.atlas, it.sprite, { trimmed: true }), l, t, r, bb);
    const k = b.ky || 1; // slices keep their pixel size at the widget's scale
    obj.width = b.w / k; obj.height = b.h / k; obj.scale.set(k);
    obj.position.set(b.x, b.y);
  } else {
    obj = new PIXI.Sprite(await spriteTexture(it.atlas, it.sprite));
    obj.anchor.set(0.5);
    obj.position.set(b.x + b.w / 2, b.y + b.h / 2);
    obj.width = b.w; obj.height = b.h;
    if (b.flipX) obj.scale.x *= -1;
    if (b.flipY) obj.scale.y *= -1;
  }
  obj.tint = rgb(it.color);
  obj.alpha = (it.color ? it.color[3] : 1) * (it.alpha ?? 1);
  if (/Add$/.test(it.atlas)) obj.blendMode = PIXI.BLEND_MODES.ADD;
  const box = new PIXI.Container();
  box.addChild(obj);
  return box;
}
// A label placed where the original drew it, at the scale it drew it. The original's text texture carries
// padding round the glyphs, the same each side; measuring the captured text in the same font gives that padding,
// and so where the glyphs started (left aligned), ended (right aligned) or were centred.
function layoutLabel(it, b) {
  const box = makeLabel({ ...it, ay: 0.5 }, b);
  const glyphs = box.naturalWidth || 0;
  const pad = Math.max(0, (b.w / b.k - glyphs) / 2) * b.k;
  const x = it.ax === 0 ? b.x + pad : it.ax === 1 ? b.x + b.w - pad : b.x + b.w / 2;
  box.position.set(x, b.y + b.h / 2);
  box.scale.set(b.k, b.ky || b.k);
  return box;
}

async function makeSpine(it) {
  const data = await skeleton(it.skeleton);
  const s = new Spine(data);
  if (it.anim && data.findAnimation(it.anim)) s.state.setAnimation(0, it.anim, it.mode === 2 || it.mode === undefined);
  if (it.skeleton.replace(/_SkeletonData$/, '') === 'stpr_character_01') {
    // Preserve the original layout anchor and full silhouette bounds. Captured
    // sprite leaves contain only the face; mesh wings/dress are not in those.
    s.autoUpdate = false;
    s.update(0);
    const target = s.getLocalBounds().clone();
    s.destroy({ children: true });
    const princess = await createPrincessV2();
    const bounds = princess.getLocalBounds();
    const scale = Math.min(target.width / bounds.width, target.height / bounds.height);
    princess.scale.set(scale);
    princess.position.set(target.x + target.width/2 - (bounds.x + bounds.width/2)*scale,
      target.y + target.height - (bounds.y + bounds.height)*scale);
    const container = new PIXI.Container();
    container.label = 'Princess v2';
    container.addChild(princess);
    container.alpha = it.alpha ?? 1;
    return container;
  }
  s.alpha = it.alpha ?? 1;
  return s;
}

// ---- the captured layout ----
const DYNAMIC = /ReelsManager\//;
const SKIP = it => it.k === 'UISprite' && it.atlas === 'common' && /BlackBands|ClippingAnchors|\/Mask\/|GUIArranger/.test(it.path) // letterbox bands and clipping helpers
  || /Volatility\//.test(it.path) || /AggregatedInfoLabel$/.test(it.path) || it.k === 'UITexture';
// widgets the page drives, by a piece of their path
const NAMED = {
  credit: /Balance\/ValueParent\/CoinsValue$|Credits\/BalanceValue$/,
  bet: /TotalBet\/ValueParent\/TotalBetValue$|Credits\/TotalBetValue$/,
  message: /MsgResultTeaser\/MsgLabel$/,
  banner: /RA\/Messages\/M_\d\/L$/,
  buyCost: /costTotalLabel$/,
  anteValue: /BetLevel\/.*Texts\/(Bet\/)?Value$/,
  anteOff: /Slider\/Texts\/Off$/,
  spin: /StartSpin_Button\/Background\/Icon\/IconSpin$|StartSpin_Button\/Background\/icon\/icon$/,
  betUp: /BetUp_Button\/Background\/Sprite$|SmartBetPlus\/Button\/Background$/,
  betDown: /BetDown_Button\/Background\/Sprite$|SmartBetMinus\/Button\/Background$/,
  buy: /BuyButtons\/AT\/Option_0\/Content\/Buy\/(Land|Port)\/Back\/S_0$/,
  ante: /BetLevel\/.*(Land|Port)\/Back\/S_0$/,
  anteArrow: /Slider\/Button\/Off$/,
  clock: /AggregatedInfoLabel$/,
  autoplay: /AutoplayOpen\/AutoplayOpenButton$|ButtonGroup\/AutoplayButton\/Buttons\/Open\/Background$/,
  autoplayLabel: /AutoplayOpen\/Text\/AutoplayOpenLabel$/,
  sound: /SoundButtons\/Sound(On|Off)\/Button\/Sprite$|MenuOpenClose\/ButtonOpen\/ButtonOpen\/icon$/,
};

async function makeItem(it) {
  const b = drawnBounds(it);
  let obj = null;
  if (it.k === 'SpineController') { obj = await makeSpine(it); if (obj) place(obj, it.wt); }
  else if (b && it.k === 'UISprite') obj = await layoutSprite(it, b);
  else if (b && it.k === 'UILabel') obj = layoutLabel(it, b);
  if (obj) { obj.item = it; obj.bounds = b; }
  return obj;
}

async function build(name, onProgress = () => {}) {
  const L = layouts[name];
  const root = new PIXI.Container();
  for (const k of Object.keys(ui)) delete ui[k];
  let symbolsAt = -1;
  for (const [index, it] of L.items.entries()) {
    onProgress(75 + index / L.items.length * 19, 'Preparing the artwork and princess…');
    if (DYNAMIC.test(it.path)) { if (symbolsAt < 0) symbolsAt = root.children.length; continue; }
    if (SKIP(it)) continue;
    const obj = await makeItem(it);
    if (!obj) continue;
    if (/^stpr_character_01(?:_SkeletonData)?$/.test(it.skeleton || '') && L.canvas[0] > L.canvas[1]) {
      // Fit the wider wings in the character column, clear of all six reels.
      const bounds = obj.getBounds();
      const anchor = L.items.find(item => item.path.endsWith('Reels/ClippingAnchors/DownRight'))?.leaves?.[0]?.b;
      const left = anchor ? anchor[0] + anchor[2]/2 + 28 : L.canvas[0]*.85;
      const width = L.canvas[0] - 18 - left;
      const fit = Math.min(1, width/bounds.width);
      obj.scale.set(obj.scale.x*fit, obj.scale.y*fit);
      const fitted = obj.getBounds();
      obj.x += left + width/2 - (fitted.x + fitted.width/2);
      obj.y += bounds.y + bounds.height/2 - (fitted.y + fitted.height/2);
    }
    obj.item = it;
    root.addChild(obj);
    for (const [key, re] of Object.entries(NAMED)) if (!ui[key] && re.test(it.path)) ui[key] = obj;
  }
  symbolLayer = new PIXI.Container();
  root.addChildAt(symbolLayer, symbolsAt < 0 ? root.children.length : symbolsAt);
  // symbols are clipped to the reels, between the two clipping anchors the original keeps for that
  const anchor = n => { const it = L.items.find(x => x.path.endsWith(`Reels/ClippingAnchors/${n}`)); const l = it?.leaves?.[0]; return l && [l.b[0] + l.b[2] / 2, l.b[1] + l.b[3] / 2]; };
  const tl = anchor('TopLeft'), br = anchor('DownRight');
  if (tl && br) {
    const mask = new PIXI.Graphics().beginFill(0xffffff).drawRect(tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]).endFill();
    root.addChild(mask);
    symbolLayer.mask = mask;
  }
  return root;
}

// where each cell's symbol root sits, and its scale: worked out from the captured idle symbols
function cellsOf(name) {
  const L = layouts[name], out = {};
  for (const it of L.items) {
    const m = /ReelsManager\/R_(\d)\/Pos(\d)\/(S_\d+)\(Clone\)\/Symbol\/Holder\/Idle\/S$/.exec(it.path);
    if (!m || it.k !== 'UISprite') continue;
    const rig = rigs[m[3]]?.idle;
    if (!rig) continue;
    const K = it.wt[0] / rig.scale;
    out[`${m[1]},${m[2]}`] = { x: it.wt[4] - K * rig.x, y: it.wt[5] - K * rig.y, k: K };
  }
  // a regular grid through the captured cells
  const cs = Object.values(out);
  const k = cs.reduce((a, c) => a + c.k, 0) / cs.length;
  const col = c => Object.entries(out).filter(([p]) => +p.split(',')[0] === c).map(([, v]) => v.x);
  const row = r => Object.entries(out).filter(([p]) => +p.split(',')[1] === r).map(([, v]) => v.y);
  const med = a => a.sort((p, q) => p - q)[a.length >> 1];
  const xs = [...Array(COLS)].map((_, c) => med(col(c))), ys = [...Array(ROWS)].map((_, r) => Math.min(...row(r)));
  return { xs, ys, k, dy: ys[1] - ys[0] };
}

// The symbol rigs: for each prefab, where its idle sprite and its animations sit relative to the symbol root
// (scale multiplied down the chain, y flipped from NGUI's up to Pixi's down).
function rigOf(items) {
  const parse = chain => chain.split(' > ').map(p => { const [n, v] = p.split('@'); const [x, y, sx, sy] = v.replace('(off)', '').split(',').map(Number); return { n, x, y, sx, sy }; });
  const at = list => { let x = 0, y = 0, s = 1, sy = 1; for (const p of list.slice(1)) { x += p.x * s; y -= p.y * sy; s *= p.sx; sy *= p.sy; } return { x, y, scale: s, scaleY: sy }; };
  const rig = { anims: [] };
  for (const it of items) {
    const chain = parse(it.chain);
    if (chain.some(p => /PossibleWin|Excited|Frame|RemoveFX/.test(p.n)) && !(it.k === 'SpineController' && /winframe|disappearance|landing|_land$/.test(it.anim))) continue;
    const pos = at(chain);
    if (it.k === 'UISprite') {
      const key = it.atlas.startsWith('Mult') ? it.atlas : 'idle';
      rig[key] ||= { ...pos, atlas: it.atlas, sprite: it.sprite, w: it.w, h: it.h };
    } else rig.anims.push({ ...pos, skeleton: it.skel, anim: it.anim, scale: pos.scale / 100, scaleY: pos.scaleY / 100 });
  }
  return rig;
}

// ---- setup ----
export async function init(el, onProgress = () => {}) {
  [atlases, layouts, rigs] = await Promise.all([
    json(`${ART}/ui/atlases.json`),
    Promise.all(['landscape', 'portrait'].map(n => json(`${ART}/layout/${n}.json`))).then(([landscape, portrait]) => ({ landscape, portrait })),
    json(`${ART}/layout/symbols.json`).then(s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, rigOf(v)]))),
    loadFonts(),
  ]);
  onProgress(10, 'Loading symbols and animations…');
  for (const r of Object.values(rigs)) if (!r.idle && r.MultGreen) r.idle = r.MultGreen;
  app = new PIXI.Application({ resizeTo: el, backgroundColor: 0x0b0730, antialias: true, autoDensity: true, resolution: Math.min(devicePixelRatio, 2) });
  el.appendChild(app.view);
  if (import.meta.env.DEV) globalThis.__PIXI_APP__ = app;
  const names = [...new Set(Object.values(rigs).flatMap(r => r.anims.map(a => a.skeleton)))];
  for (const [index, name] of names.entries()) {
    await skeleton(name);
    onProgress(10 + (index + 1) / names.length * 65, 'Loading symbols and animations…');
  }
  await layout(onProgress);
  onProgress(96, 'Preparing your game…');
  addEventListener('resize', () => { clearTimeout(layout.t); layout.t = setTimeout(layout, 150); });
}

let grid = null, lastGrid = null;
const listeners = {};
export function on(name, fn) { listeners[name] = fn; }

async function layout(onProgress = () => {}) {
  const sw = app.screen.width, sh = app.screen.height;
  const name = sh > sw ? 'portrait' : 'landscape';
  const L = layouts[name], [cw, ch] = L.canvas;
  if (current !== name) {
    current = name;
    if (world) world.destroy({ children: true });
    world = await build(name, onProgress);
    grid = cellsOf(name);
    app.stage.removeChildren();
    // the background, scaled to cover whatever the layout's own aspect leaves uncovered
    const bgItem = L.items.find(it => /Background\/Base\/.*\/S$/.test(it.path) && it.k === 'UISprite');
    if (bgItem) { cover = await makeSprite({ ...bgItem, ax: 0.5, ay: 0.5 }); app.stage.addChild(cover); }
    app.stage.addChild(world);
    await ensureOverlays();
    hookButtons();
    sprites.clear();
    if (lastGrid) await show(lastGrid, { instant: true });
    listeners.rebuilt?.();
  }
  const k = Math.min(sw / cw, sh / ch);
  world.scale.set(k);
  world.position.set((sw - cw * k) / 2, (sh - ch * k) / 2);
  placeOverlays();
  if (cover) {
    const b = cover.children[0], kc = Math.max(sw / b.width, sh / b.height);
    cover.transform.setFromMatrix(new PIXI.Matrix(kc, 0, 0, kc, sw / 2, sh / 2));
  }
}

function hookButtons() {
  for (const key of ['spin', 'betUp', 'betDown', 'buy', 'ante', 'anteArrow', 'autoplay', 'sound']) {
    const o = ui[key];
    if (!o) continue;
    o.eventMode = 'static';
    o.cursor = 'pointer';
    o.on('pointertap', () => listeners[key]?.());
  }
}

// ---- what the page changes ----
export function setText(key, s) { ui[key]?.setText?.(s); }
export function setEnabled(key, on) { if (ui[key]) { ui[key].alpha = on ? 1 : 0.5; ui[key].eventMode = on ? 'static' : 'none'; } }
export function setAnte(on) { if (ui.anteArrow) ui.anteArrow.scale.x = Math.abs(ui.anteArrow.scale.x) * (on ? -1 : 1); setText('anteOff', on ? 'ON' : 'OFF'); }

// ---- symbols ----
async function makeSymbol(cell) {
  const rig = rigs[PREFAB[cell.s]];
  const box = new PIXI.Container();
  let idleRig = rig.idle;
  if (cell.s === 'mult') idleRig = rig[`Mult${multLook(cell.v)[1]}`] || rig.idle;
  const idle = await makeSprite({ atlas: idleRig.atlas, sprite: idleRig.sprite, w: idleRig.w, h: idleRig.h, ax: 0.5, ay: 0.5, type: 0 });
  idle.position.set(idleRig.x, idleRig.y);
  idle.scale.set(idleRig.scale, idleRig.scaleY);
  box.addChild(idle);
  box.idle = idle;
  if (cell.s === 'mult') {
    const t = new PIXI.Text(`${cell.v}x`, { fontFamily: 'fa4f86b3ab18f0bb4abc48168c8403b', fontSize: 40, fill: '#ffffff', stroke: css([0.9961, 0.2353, 0.502, 1]), strokeThickness: 7, dropShadow: true, dropShadowBlur: 4, dropShadowDistance: 0, padding: 10 });
    t.anchor.set(0.5);
    t.position.set(0, 4);
    box.addChild(t);
  }
  box.cell = cell;
  return box;
}

// a one-off Spine animation from the symbol's rig, drawn over the idle sprite
async function playRig(box, match, { hideIdle = true, loop = false } = {}) {
  const rig = rigs[PREFAB[box.cell.s]];
  const a = rig.anims.find(x => match.test(x.anim) && (box.cell.s !== 'mult' || !/multiplier/.test(x.anim) || x.anim.includes(multLook(box.cell.v)[2])));
  if (!a || box.destroyed) return 0;
  const s = new Spine(await skeleton(a.skeleton));
  s.position.set(a.x, a.y);
  s.scale.set(a.scale, a.scaleY);
  const entry = s.state.setAnimation(0, a.anim, loop);
  box.addChild(s);
  if (hideIdle) box.idle.visible = false;
  const ms = entry.animation.duration * 1000;
  if (!loop) setTimeout(() => { if (!s.destroyed) { s.destroy(); if (!box.destroyed && hideIdle) box.idle.visible = true; } }, ms);
  return ms;
}

const cellPos = (c, r) => ({ x: grid.xs[c], y: grid.ys[r] });

// ---- tweens on the Pixi ticker ----
export let speed = 1;
export function setSpeed(s) { speed = s; }
export const wait = ms => new Promise(r => setTimeout(r, ms / speed));
function tween(obj, to, ms, ease = t => 1 - (1 - t) ** 3) {
  const from = Object.fromEntries(Object.keys(to).map(k => [k, obj[k]]));
  return new Promise(res => {
    let t = 0;
    const step = () => {
      if (obj.destroyed) { app.ticker.remove(step); return res(); }
      t += app.ticker.deltaMS * speed;
      const p = Math.min(1, t / ms), e = ease(p);
      for (const k in to) obj[k] = from[k] + (to[k] - from[k]) * e;
      if (p >= 1) { app.ticker.remove(step); res(); }
    };
    app.ticker.add(step);
  });
}

// Everything on the board falls away (start of a spin).
export async function clear() {
  const all = [...sprites.values()];
  sprites.clear();
  await Promise.all(all.map(b => wait(b.cell.c * 40).then(() =>
    tween(b, { y: b.y + grid.dy * (ROWS + 1) }, 380, t => t * t)).then(() => b.destroy({ children: true }))));
}

// Puts the grid on the board: cells already there slide to their new place, new ones drop in from the top.
export async function show(g, { instant = false, first = false } = {}) {
  lastGrid = g;
  const moves = [];
  const landed = new Array(COLS).fill(0), dropping = new Array(COLS).fill(0);
  for (let c = 0; c < COLS; c++) {
    const col = g[c];
    const fresh = col.filter(cell => !sprites.has(cell.id)).length;
    for (let r = 0; r < ROWS; r++) {
      const cell = col[r];
      const p = cellPos(c, r);
      let b = sprites.get(cell.id);
      if (!b) {
        b = await makeSymbol(cell);
        b.cell.c = c;
        b.scale.set(grid.k);
        b.position.set(p.x, instant ? p.y : p.y - fresh * grid.dy - grid.dy);
        symbolLayer.addChild(b);
        sprites.set(cell.id, b);
        if (!instant) {
          dropping[c]++;
          moves.push(wait(c * 70 + (ROWS - r) * 25).then(() => tween(b, { y: p.y }, 360, t => t * t)).then(() => {
            // a column is down when its last new symbol lands: the reel stop on a spin, a fill on a tumble
            if (++landed[c] === dropping[c]) listeners.columnLanded?.({ col: c, first });
            if (b.cell.s === 'scatter') listeners.scatterLanded?.();
            return land(b);
          }));
        }
      } else if (b.y !== p.y) {
        b.cell.c = c;
        moves.push(wait(c * 40).then(() => tween(b, { y: p.y }, 300, t => t * t)));
      }
    }
  }
  await Promise.all(moves);
}

function land(b) {
  // scatters and multipliers have their own landing; everything gives a small bounce
  if (b.cell.s === 'scatter' || b.cell.s === 'mult') playRig(b, /_land(ing)?$/);
  const y = b.y;
  return tween(b, { y: y - grid.dy * 0.06 }, 70).then(() => tween(b, { y }, 120));
}

// Winning cells play their win animation and the win frame, then the disappearance effect, then vanish.
export async function pop(g, wins) {
  const ids = new Set(wins.flatMap(w => w.cells.map(([c, r]) => g[c][r].id)));
  const boxes = [...ids].map(id => sprites.get(id)).filter(Boolean);
  let longest = 0;
  for (const b of boxes) {
    longest = Math.max(longest, await playRig(b, /_win$|hv3_loop$/));
    playRig(b, /winframe/, { hideIdle: false });
  }
  await wait(Math.min(Math.max(longest, 900), 1600));
  listeners.vanish?.();
  for (const b of boxes) { for (const ch of [...b.children]) ch.visible = false; playRig(b, /disappearance/, { hideIdle: true }); }
  await wait(450);
  for (const id of ids) { sprites.get(id)?.destroy({ children: true }); sprites.delete(id); }
}

// Wish stars or orbs that count play their win animation.
export async function highlight(kind) {
  const boxes = [...sprites.values()].filter(b => b.cell.s === kind);
  let ms = 0;
  for (const b of boxes) ms = Math.max(ms, await playRig(b, kind === 'mult' ? /multiplier_loop$/ : /_win$/));
  if (boxes.length) await wait(Math.min(Math.max(ms, 800), 1800));
}

export function setFree() {}

// The symbols the original showed when it was captured, as an engine grid: the board before the first spin.
export function capturedGrid() {
  const byPrefab = Object.fromEntries(Object.entries(PREFAB).map(([k, v]) => [v, k]));
  const g = [...Array(COLS)].map((_, c) => [...Array(ROWS)].map((_, r) => ({ id: `start-${c}-${r}`, s: 'ruby' })));
  for (const it of layouts[current].items) {
    const m = /ReelsManager\/R_(\d)\/Pos(\d)\/(S_\d+)\(Clone\)\/Symbol\/Holder\/Idle\/S/.exec(it.path);
    if (m && byPrefab[m[3]]) g[+m[1]][+m[2]].s = byPrefab[m[3]];
  }
  return g;
}

// what the message line said in the captured layout, for when nothing is happening
export const idleMessage = () => ui.message?.item?.text || '';

// ================= DIALOGS =================
// The autoplay settings window and the volume popover, drawn from frames captured with them open in the
// original (layout/autoplay-landscape.json, layout/sound-landscape.json). They sit above the game; on a phone
// they are centred and scaled to fit.
const OVERLAYS = {
  autoplay: { layout: 'autoplay-landscape', match: /AutoplayWindow\// },
  volume: { layout: 'sound-landscape', match: /BottomBar\/SoundSlider\// },
};
const overlays = {};
export const AUTOPLAY_STEPS = [10, 20, 30, 50, 70, 100, 500, 1000];

async function buildOverlay(name) {
  const def = OVERLAYS[name], L = await json(`${ART}/layout/${def.layout}.json`);
  const box = new PIXI.Container(), parts = {};
  // a tap outside closes it
  const catcher = new PIXI.Graphics().beginFill(0x000000, 0.001).drawRect(-5000, -5000, 10000, 10000).endFill();
  catcher.eventMode = 'static';
  catcher.on('pointertap', () => hideOverlay(name));
  box.addChild(catcher);
  for (const it of L.items) {
    if (!def.match.test(it.path) || /Volatility\//.test(it.path)) continue;
    const obj = await makeItem(it);
    if (!obj) continue;
    const key = it.path.replace(/^.*?(AutoplaySimpleWindow\/Content\/|SoundSlider\/Content\/|SoundSlider\/)/, '');
    parts[key] = obj;
    box.addChild(obj);
  }
  // everything but the catcher swallows taps, so taps inside don't close it
  const inner = new PIXI.Container();
  for (const ch of box.children.slice(1)) inner.addChild(ch);
  const bnds = inner.getLocalBounds();
  const blocker = new PIXI.Graphics().beginFill(0x000000, 0.001).drawRect(bnds.x, bnds.y, bnds.width, bnds.height).endFill();
  blocker.eventMode = 'static';
  inner.addChildAt(blocker, 0);
  box.addChild(inner);
  box.visible = false;
  box.parts = parts;
  box.area = bnds;
  box.canvas = L.canvas;
  return box;
}

const press = (obj, fn) => { if (!obj) return; obj.eventMode = 'static'; obj.cursor = 'pointer'; obj.on('pointertap', e => { e.stopPropagation(); fn(e); }); };
// a horizontal slider: dragging along `bar` gives 0..1
function slider(bar, onChange) {
  if (!bar) return;
  bar.eventMode = 'static'; bar.cursor = 'pointer';
  const b = bar.bounds;
  bar.hitArea = new PIXI.Rectangle(b.x - 20, b.y - 30, b.w + 40, b.h + 60);
  let dragging = false;
  const at = e => { const p = bar.parent.toLocal(e.global); onChange(Math.max(0, Math.min(1, (p.x - b.x) / b.w))); };
  bar.on('pointerdown', e => { e.stopPropagation(); dragging = true; at(e); });
  bar.on('globalpointermove', e => { if (dragging) at(e); });
  bar.on('pointerup', () => { dragging = false; });
  bar.on('pointerupoutside', () => { dragging = false; });
}

// ---- autoplay settings ----
async function setupAutoplay(box) {
  const p = box.parts, state = { turbo: false, quick: false, skip: true, step: 5 };
  press(p['XButton/CloseButton'], () => hideOverlay('autoplay'));
  press(p['XButton/Background'], () => hideOverlay('autoplay'));
  // checkboxes: the original shows SkipScreens ticked; its tick is copied onto the others
  const tick = p['Checkboxes/SkipScreens/ToOff/Icon'];
  const on = await spriteTexture('GUI_v11', 'checkbox_1'), off = await spriteTexture('GUI_v11', 'checkbox_0');
  // ticked and unticked boxes look as the captured SkipScreens (ticked) and TurboSpin (unticked) boxes did
  const look = path => { const b = p[`Checkboxes/${path}/Box`]?.children[0]; return b ? { tint: b.tint, alpha: b.alpha } : { tint: 0xffffff, alpha: 1 }; };
  const onLook = look('SkipScreens/ToOff'), offLook = look('TurboSpin/ToOn');
  const checks = { turbo: 'TurboSpin/ToOn', quick: 'FastPlay/ToOn', skip: 'SkipScreens/ToOff' };
  const ticks = {};
  for (const [k, path] of Object.entries(checks)) {
    const boxSprite = p[`Checkboxes/${path}/Box`];
    if (!boxSprite) continue;
    let t = k === 'skip' ? tick : null;
    if (!t && tick) {
      t = new PIXI.Container();
      const src = tick.children[0], s2 = new PIXI.Sprite(src.texture);
      s2.anchor.set(0.5); s2.width = src.width; s2.height = src.height;
      s2.position.set(boxSprite.bounds.x + boxSprite.bounds.w / 2, boxSprite.bounds.y + boxSprite.bounds.h / 2);
      t.addChild(s2); tick.parent.addChild(t);
    }
    ticks[k] = t;
    const render = () => { const sp = boxSprite.children[0], l = state[k] ? onLook : offLook; sp.texture = state[k] ? on : off; sp.tint = l.tint; sp.alpha = l.alpha; if (t) t.visible = state[k]; };
    render();
    const toggle = () => { state[k] = !state[k]; render(); listeners.autoplaySettings?.({ ...state, spins: AUTOPLAY_STEPS[state.step] }); };
    press(p[`Checkboxes/${path}/Button`], toggle);
    press(boxSprite, toggle);
  }
  // number of spins
  const bar = p['NumberOfSpins/Slider/Bar'], fill = p['NumberOfSpins/Slider/ValueBar'];
  const thumbs = Object.entries(p).filter(([k]) => k.startsWith('NumberOfSpins/Slider/ThumbVisual/')).map(([, v]) => v);
  const value = p['NumberOfSpins/Slider/ValueDisplayer'];
  // the button's label is one line here, centred on the button
  for (const k of ['SubmitButton/MLA/Brace_0', 'SubmitButton/MLA/Brace_1', 'SubmitButton/MLA/NumberOfSpins']) if (p[k]) p[k].visible = false;
  const label = p['SubmitButton/MLA/StartAutoplayLabel'], button = p['SubmitButton/StartAutoplayButton'];
  if (label && button) label.position.x = button.bounds.x + button.bounds.w / 2, label.children.forEach(t => t.anchor.x = 0.5);
  const thumbX0 = thumbs.map(t => t.x), fillB = fill?.bounds;
  const setStep = i => {
    state.step = i;
    const f = i / (AUTOPLAY_STEPS.length - 1), n = AUTOPLAY_STEPS[i];
    if (fill && fillB && bar) { const w = bar.bounds.w * f; fill.children[0].width = Math.max(1, w); fill.children[0].x = fillB.x + w / 2; }
    if (bar && fillB) thumbs.forEach((t, j) => { t.x = thumbX0[j] + (bar.bounds.x + bar.bounds.w * f) - (fillB.x + fillB.w); });
    value?.setText(String(n));
    label?.setText(`START AUTOPLAY (${n})`);
  };
  slider(bar, f => setStep(Math.round(f * (AUTOPLAY_STEPS.length - 1))));
  setStep(state.step);
  press(button, () => { hideOverlay('autoplay'); listeners.startAutoplay?.({ ...state, spins: AUTOPLAY_STEPS[state.step] }); });
  press(label, () => { hideOverlay('autoplay'); listeners.startAutoplay?.({ ...state, spins: AUTOPLAY_STEPS[state.step] }); });
  box.getSettings = () => ({ ...state, spins: AUTOPLAY_STEPS[state.step] });
}

// ---- volume popover ----
async function setupVolume(box) {
  const p = box.parts;
  const bar = p['Content/Bar'] || p.Bar, fill = p['Content/Muted/Volume'] || p['Muted/Volume'], thumb = p['Content/Thumb/Thumb_Muted'] || p['Thumb/Thumb_Muted'];
  const label = p['Content/Label'] || p.Label;
  const iconOff = p['Content/Muted/Icon/Sprite_0'] || p['Muted/Icon/Sprite_0'], iconOn = p['Content/Muted/Icon/Sprite_1'] || p['Muted/Icon/Sprite_1'];
  const fillB = fill?.bounds, thumbX0 = thumb?.x;
  box.showVolume = ({ volume, muted }) => {
    const f = muted ? 0 : volume;
    if (fill && bar) { const w = bar.bounds.w * volume; fill.children[0].width = Math.max(1, w); fill.children[0].x = fillB.x + w / 2; fill.children[0].tint = muted ? 0xc30a0a : 0xffffff; }
    if (thumb && bar) { thumb.x = thumbX0 + bar.bounds.w * volume - (fillB.w); thumb.children[0].tint = muted ? 0xc30a0a : 0xffffff; }
    label?.setText(String(Math.round(volume * 100)));
    if (iconOff) iconOff.visible = !!muted;
    if (iconOn) iconOn.visible = !muted;
    return f;
  };
  slider(bar, f => listeners.volume?.({ volume: f, muted: false }));
  press(iconOff, () => listeners.volume?.({ muted: false }));
  press(iconOn, () => listeners.volume?.({ muted: true }));
}

async function ensureOverlays() {
  for (const name of Object.keys(OVERLAYS)) {
    if (overlays[name]) continue;
    overlays[name] = await buildOverlay(name);
    if (name === 'autoplay') await setupAutoplay(overlays[name]);
    if (name === 'volume') await setupVolume(overlays[name]);
  }
  for (const o of Object.values(overlays)) app.stage.addChild(o);
}

function placeOverlays() {
  const sw = app.screen.width, sh = app.screen.height;
  for (const o of Object.values(overlays)) {
    const [cw, ch] = o.canvas;
    if (current === 'landscape') {
      const k = Math.min(sw / cw, sh / ch);
      o.scale.set(k); o.position.set((sw - cw * k) / 2, (sh - ch * k) / 2);
    } else {
      // centred over the game, as wide as the screen allows
      const a = o.area, k = Math.min((sw * 0.94) / a.width, (sh * 0.8) / a.height, (sw / 1920) * 3);
      o.scale.set(k); o.position.set(sw / 2 - (a.x + a.width / 2) * k, sh / 2 - (a.y + a.height / 2) * k);
    }
  }
}

export function showOverlay(name) {
  for (const [n, o] of Object.entries(overlays)) o.visible = n === name;
  listeners.overlay?.(name);
}
export function hideOverlay(name) { if (overlays[name]) overlays[name].visible = false; listeners.overlay?.(null); }
export const overlayOpen = name => !!overlays[name]?.visible;
export function renderVolume(s) { overlays.volume?.showVolume?.(s); }
export async function setSoundIcon(on) {
  const o = ui.sound;
  if (!o || !o.item || o.item.atlas !== 'GUI') return;
  o.children[0].texture = await spriteTexture('GUI', on ? 'Sound' : 'SoundMute');
}
