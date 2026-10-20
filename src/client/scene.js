import * as PIXI from 'pixi.js';
import { Spine } from 'pixi-spine';
import { createPrincessV2 } from './character-v2.js';
import { skeleton } from './art.js';
import { motion, playAnimation } from './motion.js';
import { createAmbience } from './ambience.js';

// ================= SCENE =================
// Draws the game exactly as the original lays it out. layout/<name>.json is one captured frame of the original
// (scripts/capture-layout.js): every sprite, label and Spine skeleton it drew, in draw order, with the screen
// transform it had. This file draws that list with the original art, then puts our own grid of symbols where the
// original's reels were, built from the original symbol rigs (layout/symbols.json).
export const COLS = 6, ROWS = 5;
const ART = '/starlight';
// Wingrid's Japan theme (public/theme/japan/). The page paints the backdrop behind this canvas (#backdrop in
// style.css), so the captured background is left out. The reel frames are our own lacquer boards, drawn by
// scripts/japan-board.mjs to the original base frame's box, so their window is the symbol grid.
const BOARD = { BaseReels: '/theme/japan/board-base.webp', ReelWithFrameFS: '/theme/japan/board-free.webp' };

// engine symbol id → the original's symbol prefab
const PREFAB = {
  crown: 'S_3', chalice: 'S_4', hourglass: 'S_5', ring: 'S_6',
  amethyst: 'S_7', topaz: 'S_8', emerald: 'S_9', sapphire: 'S_10', ruby: 'S_11',
  scatter: 'S_1', mult: 'S_12',
};
// multipliers come in four colours by size, each with its own sprite and animations
const MULT = [[100, 'Yellow', 'yellow'], [25, 'Pink', 'purple'], [10, 'Blue', 'blue'], [0, 'Green', 'green']];
const multLook = v => MULT.find(([min]) => v >= min);
// how far (layout pixels) the landscape princess reaches over the reel frame's right edge
const CHARACTER_OVERLAP = 72;

let app, atlases, rigs, layouts, world, ambience, symbolLayer, effectsLayer, current;
const characters = new Set();
let freeMode = false;
const baseOnly = []; // drawn in the base game only: the blue reel back
// left off on a phone: the empty side panel the jackpots sit in elsewhere
const PHONE_HIDDEN = /TumbleHistory\//;
const phoneHidden = [];
let phone = false;
const shown = obj => !(phone && phoneHidden.includes(obj)) && !(freeMode && baseOnly.includes(obj));
const speedArrows = {};
let freeHud = null;  // the free-spins column that takes their place
const textures = new Map();
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
  // Wingrid's mascot stays outside the imported archive so asset refreshes and
  // CI restoration cannot bring the original SCATTER portrait back.
  if ((atlasName === 'S01' && name === 'S01') ||
      (atlasName === 'thumbs' && ['S01', 'S01M'].includes(name))) {
    const source = await PIXI.Assets.load('/characters/princess-v2/scatter.png');
    const base = source.baseTexture;
    const [pl, pt, pr, pb] = trimmed ? [0, 0, 0, 0] : s.pad;
    const [w, h] = s.rotate ? [s.h, s.w] : [s.w, s.h];
    const k = Math.min(w / base.width, h / base.height);
    const texture = new PIXI.Texture(base, new PIXI.Rectangle(0, 0, base.width, base.height),
      new PIXI.Rectangle(0, 0, (w + pl + pr) / k, (h + pt + pb) / k),
      new PIXI.Rectangle((pl + (w - base.width * k) / 2) / k,
        (pt + (h - base.height * k) / 2) / k, base.width, base.height));
    spriteTextures.set(key, texture);
    return texture;
  }
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
    characters.add(princess);
    const bounds = princess.getLocalBounds();
    const scale = Math.min(target.width / bounds.width, target.height / bounds.height);
    princess.scale.set(scale);
    princess.position.set(target.x + target.width/2 - (bounds.x + bounds.width/2)*scale,
      target.y + target.height - (bounds.y + bounds.height)*scale);
    const container = new PIXI.Container();
    container.label = 'Princess v2';
    container.addChild(princess);
    container.alpha = it.alpha ?? 1;
    hover(container, princess);
    return container;
  }
  s.alpha = it.alpha ?? 1;
  return s;
}

// The princess drifts up and down and sways a little, with stars twinkling round her, so she reads as
// floating over the board rather than standing beside it. Measured in her own height, so it suits both layouts.
function hover(container, princess) {
  const sparkles = new PIXI.Graphics();
  sparkles.blendMode = PIXI.BLEND_MODES.ADD;
  container.addChildAt(sparkles, 0);
  if (motion.reduced) return;
  const box = princess.getLocalBounds();
  const height = box.height * princess.scale.y, width = box.width * princess.scale.x;
  const x0 = princess.x + (box.x + box.width / 2) * princess.scale.x, y0 = princess.y + (box.y + box.height / 2) * princess.scale.y;
  const baseY = princess.y, baseRotation = princess.rotation;
  // fixed spots round her silhouette, each twinkling on its own phase
  const stars = Array.from({ length: 14 }, (_, i) => ({
    x: x0 + Math.cos(i * 2.4) * width * (.32 + (i % 3) * .07), y: y0 + Math.sin(i * 2.4) * height * (.38 + (i % 4) * .04),
    phase: i * .73, size: height * (.007 + (i % 3) * .004),
  }));
  let t = 0;
  const tick = () => {
    if (princess.destroyed) { PIXI.Ticker.shared.remove(tick); return; }
    t += PIXI.Ticker.shared.deltaMS / 1000 * motion.speed;
    const drift = Math.sin(t * Math.PI * 2 / 3.4);
    princess.y = baseY + drift * height * .018;
    princess.rotation = baseRotation + Math.sin(t * Math.PI * 2 / 5.2) * .012;
    sparkles.clear();
    for (const s of stars) {
      const glow = Math.max(0, Math.sin(t * 1.7 + s.phase));
      if (glow < .05) continue;
      const r = s.size * (.6 + glow * .7), y = s.y + drift * height * .012;
      sparkles.beginFill(s.phase % 1.5 > .75 ? 0xbfefff : 0xffe7a8, glow * .9)
        .drawPolygon([s.x, y - r * 2, s.x + r * .35, y - r * .35, s.x + r * 2, y, s.x + r * .35, y + r * .35,
          s.x, y + r * 2, s.x - r * .35, y + r * .35, s.x - r * 2, y, s.x - r * .35, y - r * .35]).endFill();
    }
  };
  PIXI.Ticker.shared.add(tick);
}

// the star on the end of her wand: the highest point of the wand mesh as it is posed right now
function wandTip(princess) {
  const slot = princess.skeleton.findSlot('wand'), mesh = slot?.getAttachment();
  if (!mesh?.computeWorldVertices) return { x: 0, y: 0 };
  const points = new Float32Array(mesh.worldVerticesLength);
  mesh.computeWorldVertices(slot, 0, mesh.worldVerticesLength, points, 0, 2);
  let tip = { x: points[0], y: points[1] };
  for (let i = 2; i < points.length; i += 2) if (points[i + 1] < tip.y) tip = { x: points[i], y: points[i + 1] };
  return tip;
}

// A multiplier orb lands and the princess strikes it, as in the original: she flashes and raises her wand
// (react('spell') plays the white burst round her), a twinkle leaves her wand tip, and lightning comes down
// from above the board onto the orb, which pops in a burst of stars.
async function castAt(box) {
  const princess = [...characters].find(p => !p.destroyed);
  if (!princess || !effectsLayer || effectsLayer.destroyed) return;
  react('spell');
  const tip = wandTip(princess);
  const from = world.toLocal(princess.toGlobal(new PIXI.Point(tip.x, tip.y)));
  const to = { x: box.x, y: box.y };
  const top = Math.min(...grid.ys) - grid.dy * 1.4;
  const fx = new PIXI.Graphics();
  fx.blendMode = PIXI.BLEND_MODES.ADD;
  effectsLayer.addChild(fx);
  const star = (g, x, y, r, color, alpha) => g.beginFill(color, alpha).drawPolygon([x, y - r, x + r * .3, y - r * .3, x + r, y,
    x + r * .3, y + r * .3, x, y + r, x - r * .3, y + r * .3, x - r, y, x - r * .3, y - r * .3]).endFill();
  // the wand twinkles as she casts
  await motion.animate(220, p => {
    if (fx.destroyed) return;
    fx.clear();
    star(fx, from.x, from.y, grid.dy * (.12 + Math.sin(p * Math.PI) * .22), 0xffffff, Math.sin(p * Math.PI));
  });
  if (box.destroyed || fx.destroyed) { fx.destroy(); return; }
  // a jagged bolt, re-forked every few frames so it crackles, fading as the orb takes the charge
  const jag = grid.dy * .22;
  const fork = () => {
    const steps = 9, points = [];
    for (let i = 0; i <= steps; i++) {
      const q = i / steps, wobble = i && i < steps ? (Math.random() - .5) * jag * 2 : 0;
      points.push(to.x + wobble, top + (to.y - top) * q);
    }
    return points;
  };
  const line = (points, width, color, alpha) => {
    fx.lineStyle(width, color, alpha).moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) fx.lineTo(points[i], points[i + 1]);
  };
  const scale = box.scale.x;
  let points = fork(), frame = 0;
  await motion.animate(520, p => {
    if (fx.destroyed) return;
    if (++frame % 3 === 0) points = fork();
    const strength = p < .15 ? p / .15 : 1 - (p - .15) / .85;
    fx.clear();
    line(points, grid.dy * .28, 0xb46cff, .25 * strength);
    line(points, grid.dy * .12, 0xffc8f4, .55 * strength);
    line(points, grid.dy * .035, 0xffffff, strength);
    fx.lineStyle(0);
    fx.beginFill(0xffffff, .5 * strength).drawCircle(to.x, to.y, grid.dy * (.25 + p * .25)).endFill();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + p, r = grid.dy * (.15 + p * .45);
      star(fx, to.x + Math.cos(a) * r, to.y + Math.sin(a) * r, grid.dy * .09 * (1 - p), i % 2 ? 0xbfefff : 0xffe7a8, 1 - p);
    }
    if (!box.destroyed) box.scale.set(scale * (1 + Math.sin(p * Math.PI) * .14));
  });
  fx.destroy();
  if (!box.destroyed) box.scale.set(scale);
}

// ---- the captured layout ----
const DYNAMIC = /ReelsManager\//;
const SKIP = it => it.k === 'UISprite' && it.atlas === 'common' && /BlackBands|ClippingAnchors|\/Mask\/|GUIArranger/.test(it.path) // letterbox bands and clipping helpers
  || /^Game\/Background\//.test(it.path) // the backdrop is the page's, behind the canvas
  || /BuyBetFeatures\/|BuyButtons\//.test(it.path) // the buy and double-chance panels: Wingrid has neither
  || /Volatility\//.test(it.path) || /AggregatedInfoLabel$/.test(it.path) || it.k === 'UITexture';
// widgets the page drives, by a piece of their path
const NAMED = {
  credit: /Balance\/ValueParent\/CoinsValue$|Credits\/BalanceValue$/,
  bet: /TotalBet\/ValueParent\/TotalBetValue$|Credits\/TotalBetValue$/,
  message: /MsgResultTeaser\/MsgLabel$/,
  banner: /RA\/Messages\/M_\d\/L$/,
  spin: /StartSpin_Button\/Background\/Icon\/IconSpin$|StartSpin_Button\/Background\/icon\/icon$/,
  betUp: /BetUp_Button\/Background\/Sprite$|SmartBetPlus\/Button\/Background$/,
  betDown: /BetDown_Button\/Background\/Sprite$|SmartBetMinus\/Button\/Background$/,
  clock: /AggregatedInfoLabel$/,
  autoplay: /AutoplayOpen\/AutoplayOpenButton$|ButtonGroup\/AutoplayButton\/Buttons\/Open\/Background$/,
  autoplayLabel: /AutoplayOpen\/Text\/AutoplayOpenLabel$/,
  sound: /SoundButtons\/Sound(On|Off)\/Button\/Sprite$/,
  menu: /LeftContent\/Settings\/ButtonOpen\/ButtonOpen\/Sprite$|MenuOpenClose\/ButtonOpen\/ButtonOpen\/icon$/,
  speed: /ButtonGroup\/GameSpeed\/Normal\/Background$/,
  speedArrows: /ButtonGroup\/GameSpeed\/Normal\/(Left|Middle|Right)Arrow$/,
  betMenu: /ButtonGroup\/BetButtons\/Buttons\/Open\/Background$/,
  info: /Paytable\/Paytable_Button_Open\/Sprite$|PaytableButton\/PaytableButtonOpen$/,
};
// the buttons the player presses
const BUTTONS = ['spin', 'betUp', 'betDown', 'autoplay', 'sound', 'menu', 'info', 'speed', 'betMenu'];

async function makeItem(it) {
  const b = drawnBounds(it);
  let obj = null;
  if (it.k === 'SpineController') { obj = await makeSpine(it); if (obj) place(obj, it.wt); }
  else if (b && it.k === 'UISprite') obj = await layoutSprite(it, b);
  else if (b && it.k === 'UILabel') obj = layoutLabel(it, b);
  if (obj) { obj.item = it; obj.bounds = b; }
  return obj;
}

// Our board, where the original drew its base-game reel frame (the free-spins frame sat a little higher and
// larger, around the same reels; ours share one shape and change colour).
async function makeBoard(it, L) {
  const b = drawnBounds(L.items.find(x => x.atlas === 'BaseReels'));
  const sprite = new PIXI.Sprite(await PIXI.Assets.load(BOARD[it.atlas]));
  sprite.anchor.set(0.5);
  sprite.position.set(b.x + b.w / 2, b.y + b.h / 2);
  sprite.width = b.w; sprite.height = b.h;
  const box = new PIXI.Container();
  box.addChild(sprite);
  box.bounds = b;
  return box;
}

// The dark gradient behind the bottom controls stops at the captured canvas's edges, where the original had
// black bands. Our backdrop shows round the game instead, so carry the gradient out to the sides. In landscape
// it sits at the foot of the game: its darkest shade carries on down to the screen's bottom edge. In portrait
// the controls stand above the screen's foot: the shade fades out again below them.
const BAR = /TopBar\/Background\/Sprite$|BottomBar\/Background\/bg_gradient$/;
function extendBar(box, portrait) {
  const sprite = box.children[0], b = box.bounds, far = 6000;
  sprite.width = b.w + far * 2;
  if (!portrait) {
    box.addChild(new PIXI.Graphics().beginFill(0x000000, sprite.alpha).drawRect(b.x - far, b.y + b.h - 1, b.w + far * 2, far).endFill());
    return;
  }
  const below = new PIXI.Sprite(sprite.texture); // the same gradient, the right way up: dark at its top
  below.anchor.set(0.5);
  below.width = sprite.width; below.height = b.h;
  below.position.set(sprite.x, b.y + b.h * 1.5 - 1);
  below.alpha = sprite.alpha;
  box.addChild(below);
}

async function build(name, onProgress = () => {}) {
  const L = layouts[name];
  const root = new PIXI.Container();
  for (const k of Object.keys(ui)) delete ui[k];
  baseOnly.length = 0;
  phoneHidden.length = 0;
  for (const k of Object.keys(speedArrows)) delete speedArrows[k];
  characters.clear();
  let symbolsAt = -1;
  for (const [index, it] of L.items.entries()) {
    onProgress(75 + index / L.items.length * 19, 'Preparing the artwork and princess…');
    if (DYNAMIC.test(it.path)) { if (symbolsAt < 0) symbolsAt = root.children.length; continue; }
    if (SKIP(it)) continue;
    const obj = BOARD[it.atlas] ? await makeBoard(it, L) : await makeItem(it);
    if (!obj) continue;
    if (BAR.test(it.path)) extendBar(obj, L.canvas[1] > L.canvas[0]);
    if (/^stpr_character_01(?:_SkeletonData)?$/.test(it.skeleton || '') && L.canvas[0] > L.canvas[1]) {
      // As in the original, she hovers over the board's right edge: her wing crosses the reel frame,
      // her head tucks under the logo and her feet stay clear of the bottom bar.
      const silhouette = obj.children.at(-1); // the princess, without the stars round her
      const bounds = silhouette.getBounds();
      const anchor = L.items.find(item => item.path.endsWith('Reels/ClippingAnchors/DownRight'))?.leaves?.[0]?.b;
      const reelsRight = anchor ? anchor[0] + anchor[2]/2 : L.canvas[0]*.85;
      const left = reelsRight - CHARACTER_OVERLAP;
      const logo = L.items.find(item => /Logo\/Land\/S$/.test(item.path));
      const logoBounds = logo && drawnBounds(logo);
      const top = logoBounds ? logoBounds.y + logoBounds.h - 14 : L.canvas[1]*.26;
      const bar = L.items.find(item => item.path.endsWith('TopBar/Background/Sprite'));
      const bottom = (bar ? drawnBounds(bar).y : L.canvas[1]*.87) - 36;
      const fit = Math.min((L.canvas[0] + 30 - left)/bounds.width, (bottom - top)/bounds.height);
      obj.scale.set(obj.scale.x*fit, obj.scale.y*fit);
      const fitted = silhouette.getBounds();
      obj.x += left - fitted.x;
      obj.y += top - fitted.y;
    }
    if (BASE_ONLY.test(it.path)) { baseOnly.push(obj); obj.visible = !freeMode; }
    obj.item = it;
    root.addChild(obj);
    for (const [key, re] of Object.entries(NAMED)) if (!ui[key] && re.test(it.path)) ui[key] = obj;
    if (NAMED.speedArrows.test(it.path)) (speedArrows[it.path.match(/(Left|Middle|Right)Arrow$/)[1]] = obj);
    if (PHONE_HIDDEN.test(it.path)) phoneHidden.push(obj);
  }
  symbolLayer = new PIXI.Container();
  // MBP (scatter) symbols always draw in front of the rest, even while they drop, tumble and animate
  symbolLayer.sortableChildren = true;
  root.addChildAt(symbolLayer, symbolsAt < 0 ? root.children.length : symbolsAt);
  // symbols are clipped to the reels, between the two clipping anchors the original keeps for that
  const anchor = n => { const it = L.items.find(x => x.path.endsWith(`Reels/ClippingAnchors/${n}`)); const l = it?.leaves?.[0]; return l && [l.b[0] + l.b[2] / 2, l.b[1] + l.b[3] / 2]; };
  const tl = anchor('TopLeft'), br = anchor('DownRight');
  if (tl && br) {
    const mask = new PIXI.Graphics().beginFill(0xffffff).drawRect(tl[0], tl[1], br[0] - tl[0], br[1] - tl[1]).endFill();
    root.addChild(mask);
    symbolLayer.mask = mask;
  }
  freeHud = await buildFreeHud(L);
  if (freeHud) { freeHud.visible = freeMode; root.addChild(freeHud); }
  effectsLayer = new PIXI.Container();
  root.addChild(effectsLayer);
  return root;
}

// In free spins the original swaps its buy and bet panels (which Wingrid leaves out) for a total-multiplier panel and a spins-left
// panel, with the winged cat perched on top. Built from the captured panels' places and the bet label's lettering.
const BASE_ONLY = /Reels\/Reels\/Base\/Back\//;
async function buildFreeHud(L) {
  const find = re => L.items.find(it => re.test(it.path));
  const buyIt = find(/BuyButtons\/AT\/Option_0\/Content\/Buy\/(Land|Port)\/Back\/S_0$/);
  const betIt = find(/BetLevel\/RA\/Levels\/Content\/(Land|Port)\/Back\/S_0$/);
  const titleIt = find(/BetLevel\/.*\/Texts\/Bet$/), valueIt = find(/BetLevel\/.*\/Texts\/Value$/);
  const buy = buyIt && drawnBounds(buyIt), bet = betIt && drawnBounds(betIt);
  if (!buy || !bet || !titleIt || !valueIt || !atlases.FSLeft) return null;
  const hud = new PIXI.Container();
  hud.label = 'Free spins column';
  const k = titleIt.wt[0];
  async function panel(cx, top, width, title) {
    const back = new PIXI.Sprite(await spriteTexture('FSLeft', 'free_spin_left'));
    back.anchor.set(.5, 0); back.scale.set(width / back.texture.width); back.position.set(cx, top);
    const h = back.height;
    const heading = makeLabel({ ...titleIt, text: title, size: titleIt.size * .56, w: 300, maxLines: 2, ax: .5, ay: .5 });
    heading.scale.set(k); heading.position.set(cx, top + h * .36);
    const value = makeLabel({ ...valueIt, text: '0', w: 200, ax: .5, ay: .5 });
    value.scale.set(k); value.position.set(cx, top + h * .7);
    hud.addChild(back, heading, value);
    return { value, center: { x: cx, y: top + h * .55 } };
  }
  const cx = buy.x + buy.w / 2, width = buy.w * .96;
  const mult = await panel(cx, buy.y + buy.h * .22, width, 'TOTAL\nMULTIPLIER');
  const left = await panel(bet.x + bet.w / 2, bet.y + bet.h * .12, width, 'FREE SPINS\nLEFT');
  // the cat perches on the multiplier panel; she cheers when it grows
  const cat = new Spine(await skeleton('stpr_cat_3'));
  cat.state.setAnimation(0, 'idle', true); cat.update(0);
  const cb = cat.getLocalBounds(), ck = width * .8 / cb.width;
  cat.scale.set(ck);
  cat.position.set(cx - (cb.x + cb.width / 2) * ck, buy.y + buy.h * .5 - (cb.y + cb.height) * ck);
  motion.track(cat);
  hud.addChildAt(cat, 0);
  hud.multiplier = mult; hud.left = left; hud.cat = cat;
  return hud;
}

// what the free-spins column shows; leave a value out to keep it
export function setFreeHud({ left, mult } = {}) {
  if (!freeHud || freeHud.destroyed) return;
  if (left != null) freeHud.left.value.setText(String(left));
  if (mult != null) {
    const grew = mult > (freeHud.mult ?? mult);
    freeHud.mult = mult;
    freeHud.multiplier.value.setText(`${mult}x`);
    if (grew && !motion.reduced) {
      freeHud.cat.state.setAnimation(0, 'happy', false);
      freeHud.cat.state.addAnimation(0, 'idle', true, 0);
    }
  }
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
    if (chain.some(p => /PossibleWin|Excited|Frame|RemoveFX/.test(p.n)) && it.k !== 'SpineController') continue;
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
  // transparent: the backdrop behind the canvas shows through wherever the game draws nothing
  app = new PIXI.Application({ resizeTo: el, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(devicePixelRatio, 2) });
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

// The part of the portrait layout the player needs: the princess and logo down to the credit line, with the
// bottom bar's buttons that the original anchored to the screen's edges (measured from layout/portrait.json).
const PORTRAIT_CONTENT = { x: -10, y: 150, w: 770, h: 1325 };
const ACCOUNT_LINE = 44; // room the page keeps over the portrait game for the account line
// the empty tumble-history panel by the bet controls, where the page puts its bonus panel
const SIDE_PANEL = /TumbleHistory\/RA\/Content\/Back\/S$/;

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
    // cherry petals drift over the backdrop, behind the game
    ambience ||= createAmbience({ free: freeMode });
    app.stage.addChild(ambience.layer, world);
    hookButtons();
    sprites.clear();
    if (lastGrid) await show(lastGrid, { instant: true });
    listeners.rebuilt?.();
  }
  phone = Math.min(sw, sh) < 600;
  for (const obj of phoneHidden) obj.visible = shown(obj);
  let k;
  if (name === 'landscape') {
    k = Math.min(sw / cw, sh / ch);
    world.position.set((sw - cw * k) / 2, (sh - ch * k) / 2);
  } else {
    // every control on screen, the buttons at the bar's ends included
    const c = PORTRAIT_CONTENT, room = sh - ACCOUNT_LINE;
    k = Math.min(sw / c.w, room / c.h);
    world.position.set((sw - c.w * k) / 2 - c.x * k, ACCOUNT_LINE + (room - c.h * k) / 2 - c.y * k);
  }
  world.scale.set(k);
  touchTargets();
  ambience.resize(sw, sh);
  let panel = world.children.find(o => SIDE_PANEL.test(o.item?.path || ''))?.bounds;
  // in portrait the bet + button overlaps the panel's left edge: keep clear of it
  const plus = ui.betUp?.bounds, clear = plus && plus.x + plus.w + 4 - panel?.x;
  if (panel && name === 'portrait' && clear > 0) panel = { ...panel, x: panel.x + clear, w: panel.w - clear };
  listeners.layout?.({ name, k, phone, world: { x: world.x, y: world.y }, panel: panel && { x: world.x + panel.x * k, y: world.y + panel.y * k, w: panel.w * k, h: panel.h * k } });
}

// Small buttons get a fingertip-sized hit area, trimmed where it would reach into a neighbour's.
// The landscape bar's settings and sound icons are drawn very small; on a phone they also grow, about their centres.
const TOUCH = 44, SMALLEST = 20;
function touchTargets() {
  for (const key of ['menu', 'sound']) {
    const o = ui[key];
    if (!o) continue;
    o.home ||= { x: o.x, y: o.y, sx: o.scale.x, sy: o.scale.y };
    const h = o.home, lb = o.getLocalBounds(), cx = lb.x + lb.width / 2, cy = lb.y + lb.height / 2;
    o.pivot.set(0, 0); o.position.set(h.x, h.y); o.scale.set(h.sx, h.sy);
    const b = o.getBounds(), grow = Math.min(1.8, Math.max(1, SMALLEST / Math.min(b.width, b.height)));
    o.pivot.set(cx, cy); o.position.set(h.x + cx * h.sx, h.y + cy * h.sy); o.scale.set(h.sx * grow, h.sy * grow);
  }
  const hits = BUTTONS.filter(key => ui[key]?.worldVisible).map(key => {
    const o = ui[key]; o.hitArea = null;
    const b = o.getBounds(), px = Math.max(0, (TOUCH - b.width) / 2), py = Math.max(0, (TOUCH - b.height) / 2);
    return { o, b, r: { x0: b.left - px, y0: b.top - py, x1: b.right + px, y1: b.bottom + py } };
  });
  for (const [i, p] of hits.entries()) for (const q of hits.slice(i + 1)) {
    const ox = Math.min(p.r.x1, q.r.x1) - Math.max(p.r.x0, q.r.x0), oy = Math.min(p.r.y1, q.r.y1) - Math.max(p.r.y0, q.r.y0);
    if (ox <= 0 || oy <= 0) continue;
    const [a, b, lo, hi] = ox < oy ? ['x0', 'x1', 'left', 'right'] : ['y0', 'y1', 'top', 'bottom'];
    const [first, second] = p.b[lo] + p.b[hi] < q.b[lo] + q.b[hi] ? [p, q] : [q, p];
    const mid = (first.b[hi] + second.b[lo]) / 2;
    first.r[b] = Math.max(first.b[hi], Math.min(first.r[b], mid));
    second.r[a] = Math.min(second.b[lo], Math.max(second.r[a], mid));
  }
  for (const { o, r } of hits) {
    const p0 = o.toLocal(new PIXI.Point(r.x0, r.y0)), p1 = o.toLocal(new PIXI.Point(r.x1, r.y1));
    o.hitArea = new PIXI.Rectangle(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
  }
}

function hookButtons() {
  for (const key of BUTTONS) {
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
    box.valueLabel = t;
  }
  box.cell = cell;
  return box;
}

// a one-off Spine animation from the symbol's rig, drawn over the idle sprite
async function playRig(box, match, { hideIdle = true, loop = false } = {}) {
  const rig = rigs[PREFAB[box.cell.s]];
  let a = rig.anims.find(x => match.test(x.anim) && (box.cell.s !== 'mult' || !/multiplier/.test(x.anim) || x.anim.includes(multLook(box.cell.v)[2])));
  // The captured prefab lists only its active win pose. Other poses live in that same skeleton.
  if (!a && box.cell.s !== 'scatter') {
    const primary = rig.anims[0];
    const data = await skeleton(primary.skeleton);
    const animation = data.animations.find(x => match.test(x.name));
    if (animation) a = { ...primary, anim: animation.name };
  }
  if (!a || box.destroyed) return 0;
  if (box.cell.s === 'scatter' && /stpr_scatter/.test(a.anim)) {
    const anticipating = /anticipate/.test(a.anim);
    const ms = /_land$/.test(a.anim) ? 350 : anticipating ? 1200 : 1600;
    scatterEffect(box, ms, anticipating);
    return ms;
  }
  const s = new Spine(await skeleton(a.skeleton));
  if (hideIdle && box.activeRig && !box.activeRig.destroyed) box.activeRig.destroy({ children: true });
  if (hideIdle) box.activeRig = s;
  motion.track(s);
  s.position.set(a.x, a.y);
  s.scale.set(a.scale, a.scaleY);
  const { duration: ms, finished } = playAnimation(s, a.anim, loop);
  box.addChild(s);
  // Orb art animates in a new Spine child; keep its numeric value above that
  // child throughout landing/collection rather than hiding it behind the heart.
  if (box.valueLabel) box.setChildIndex(box.valueLabel, box.children.length - 1);
  if (hideIdle) box.idle.visible = false;
  if (!loop) finished.then(() => { if (!s.destroyed) { s.destroy(); if (!box.destroyed && hideIdle && !box.removing && box.activeRig === s) box.idle.visible = true; } });
  return ms;
}

const cellPos = (c, r) => ({ x: grid.xs[c], y: grid.ys[r] });

// ---- tweens on the Pixi ticker ----
export let speed = 1;
// the speed button lights one, two or three of its arrows for normal, quick and turbo
export function showSpeed(level) {
  ['Left', 'Middle', 'Right'].forEach((k, i) => {
    const sprite = speedArrows[k]?.children[0];
    if (!sprite) return;
    sprite.drawn ??= { tint: sprite.tint, alpha: sprite.alpha }; // as captured: only the first arrow lit
    Object.assign(sprite, i <= level ? { tint: 0xffffff, alpha: 1 } : sprite.drawn);
  });
}
export function setSpeed(s) { motion.setSpeed(s); speed = motion.speed; document.documentElement.style.setProperty('--motion-speed', speed); }
export const wait = (ms, options) => motion.wait(ms, options);
function tween(obj, to, ms, ease = t => 1 - (1 - t) ** 3) {
  const from = Object.fromEntries(Object.keys(to).map(k => [k, obj[k]]));
  return motion.animate(ms, p => { if (!obj.destroyed) for (const k in to) obj[k] = from[k] + (to[k] - from[k]) * p; }, { ease });
}

// Everything on the board falls away (start of a spin).
export async function clear() {
  const all = [...sprites.values()];
  sprites.clear();
  await Promise.all(all.map(b => wait(b.cell.c * 40).then(() =>
    tween(b, { y: b.y + grid.dy * (ROWS + 1) }, 380, t => t * t)).then(() => b.destroy({ children: true }))));
}

// Puts the grid on the board: cells already there slide to their new place, new ones drop in from the top.
export async function show(g, { instant = false, first = false, scatterTarget = 4 } = {}) {
  lastGrid = g;
  const moves = [];
  let anticipationAt = -1, count = 0;
  const anticipation = new AbortController();
  if (first && !instant) for (let c = 0; c < COLS - 1; c++) {
    count += g[c].filter(cell => cell.s === 'scatter').length;
    if (count >= scatterTarget - 1) { anticipationAt = c + 1; break; }
  }
  const landed = new Array(COLS).fill(0), dropping = new Array(COLS).fill(0);
  // Columns finish at different times; announce the final drop, not whichever
  // callback first observes a partially built column.
  for (let c = 0; c < COLS; c++) dropping[c] = g[c].filter(cell => !sprites.has(cell.id)).length;
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
        b.zIndex = cell.s === 'scatter' ? 1 : 0;
        b.position.set(p.x, instant ? p.y : p.y - fresh * grid.dy - grid.dy);
        symbolLayer.addChild(b);
        sprites.set(cell.id, b);
        if (!instant) {
          const suspense = anticipationAt >= 0 && c >= anticipationAt ? (c - anticipationAt + 1) * 650 : 0;
          moves.push(wait(c * 70 + (ROWS - r) * 25 + suspense).then(() => tween(b, { y: p.y }, 360, t => t * t)).then(() => {
            // a column is down when its last new symbol lands: the reel stop on a spin, a fill on a tumble
            if (++landed[c] === dropping[c]) {
              listeners.columnLanded?.({ col: c, first });
              if (c === anticipationAt - 1) {
                react('anticipation', true);
                listeners.anticipation?.();
                for (const box of sprites.values()) if (box.cell.s === 'scatter' && box.cell.c <= c) scatterEffect(box, 1200, true, anticipation.signal);
              }
            }
            if (b.cell.s === 'scatter') listeners.scatterLanded?.();
            return Promise.all([land(b), b.cell.s === 'mult' && castAt(b)]);
          }));
        }
      } else if (b.y !== p.y) {
        b.cell.c = c;
        moves.push(wait(c * 40).then(() => tween(b, { y: p.y }, 300, t => t * t)));
      }
    }
  }
  await Promise.all(moves);
  anticipation.abort();
  if (anticipationAt >= 0) react('idle');
}

function land(b) {
  playRig(b, /_land(ing)?$/);
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
  react('win');
  await wait(Math.max(longest, 900));
  listeners.vanish?.();
  let out = 450;
  for (const b of boxes) {
    b.removing = true;
    for (const ch of [...b.children]) ch.visible = false;
    out = Math.max(out, await playRig(b, /_out$|_disappear$/));
    out = Math.max(out, await playRig(b, /disappearance/, { hideIdle: false }));
  }
  await wait(out);
  for (const id of ids) { sprites.get(id)?.destroy({ children: true }); sprites.delete(id); }
}

// Wish stars or orbs that count play their win animation.
export async function highlight(kind) {
  const boxes = [...sprites.values()].filter(b => b.cell.s === kind);
  if (kind === 'scatter' && boxes.length) react('win');
  let ms = 0;
  for (const b of boxes) ms = Math.max(ms, await playRig(b, kind === 'mult' ? /multiplier_loop$/ : /_win$/));
  if (boxes.length) await wait(Math.max(ms, 800));
}

function scatterEffect(box, duration, anticipating = false, signal) {
  const glow = new PIXI.Graphics();
  box.addChildAt(glow, 0);
  const sprite = box.idle;
  const original = { x: sprite.scale.x, y: sprite.scale.y, angle: sprite.rotation };
  const radius = Math.max(sprite.width, sprite.height) * .48;
  async function run() {
    do {
      await motion.animate(duration, p => {
        if (box.destroyed || glow.destroyed) return;
        const wave = Math.sin(p * Math.PI);
        glow.clear();
        for (let i = 0; i < 10; i++) {
          const a = i * Math.PI / 5 + p * Math.PI * (anticipating ? .35 : 1);
          const r = radius * (1 + wave * .22);
          const x = Math.cos(a) * r, y = Math.sin(a) * r;
          const star = [];
          for (let j = 0; j < 8; j++) {
            const distance = j % 2 ? 3 : 9 + wave * 8, angle = j * Math.PI / 4;
            star.push(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance);
          }
          glow.beginFill(i % 2 ? 0x79e9ff : 0xffe28b, wave * .85).drawPolygon(star).endFill();
          glow.lineStyle(3, 0xffecac, wave * .4).moveTo(x * .72, y * .72).lineTo(x * 1.12, y * 1.12);
        }
        sprite.rotation = original.angle + Math.sin(p * Math.PI * 4) * .025 * wave;
        if (!anticipating) sprite.scale.set(original.x * (1 + .075 * wave), original.y * (1 + .075 * wave));
      }, { signal });
    } while (anticipating && signal && !signal.aborted && !box.destroyed);
    if (!box.destroyed) { sprite.scale.set(original.x, original.y); sprite.rotation = original.angle; }
    glow.destroy();
  }
  return run();
}

// She mouths each of her voice lines (sound.onVoice says when one starts).
export function speak(line) {
  for (const princess of characters) if (!princess.destroyed) princess.speak(line);
}

export function react(name, loop = false) {
  for (const princess of characters) if (!princess.destroyed) princess.react(name, loop);
  if (name === 'spell' || name === 'bonus') for (const princess of characters) {
    if (princess.destroyed) continue;
    const bounds = princess.getBounds();
    const a = world.toLocal(new PIXI.Point(bounds.x, bounds.y));
    const b = world.toLocal(new PIXI.Point(bounds.x + bounds.width, bounds.y + bounds.height));
    sceneEffect('stpr_character_ol_fx', 'stpr_character_ol_fx', { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });
  }
}

async function sceneEffect(name, animation, rect) {
  const layer = effectsLayer;
  const s = new Spine(await skeleton(name));
  if (layer.destroyed) { s.destroy(); return; }
  s.state.setAnimation(0, animation, false); s.update(.15);
  const b = s.getLocalBounds();
  const scale = (name === 'stpr_transition' ? Math.max : Math.min)(rect.width / Math.max(1, b.width), rect.height / Math.max(1, b.height));
  s.scale.set(scale); s.position.set(rect.x + rect.width / 2 - (b.x + b.width / 2) * scale,
    rect.y + rect.height / 2 - (b.y + b.height / 2) * scale);
  layer.addChild(s); motion.track(s);
  await playAnimation(s, animation).finished;
  if (!s.destroyed) s.destroy({ children: true });
}

export async function collectMultipliers(onCollect) {
  const boxes = [...sprites.values()].filter(b => b.cell.s === 'mult');
  if (!boxes.length) return;
  react('spell');
  const meter = document.querySelector('.multiplier-meter').getBoundingClientRect();
  const canvas = app.view.getBoundingClientRect();
  // in free spins the orbs fly to the total-multiplier panel, as in the original
  const target = freeMode && freeHud ? freeHud.multiplier.center
    : world.toLocal(new PIXI.Point(meter.left + meter.width / 2 - canvas.left, meter.top + meter.height / 2 - canvas.top));
  for (const [i, b] of boxes.entries()) {
    if (b.destroyed) continue;
    const orb = await makeSymbol(b.cell);
    const trail = new PIXI.Graphics();
    effectsLayer.addChild(trail, orb);
    orb.scale.set(grid.k * .8); const start = { x: b.x, y: b.y };
    await motion.animate(620, p => {
      if (orb.destroyed) return;
      const x = start.x + (target.x - start.x) * p, y = start.y + (target.y - start.y) * p - Math.sin(p * Math.PI) * grid.dy * 1.5;
      orb.position.set(x, y); orb.alpha = 1 - p * .3;
      trail.clear().lineStyle(5, 0xffeab0, .8 * (1 - p)).moveTo(start.x, start.y)
        .quadraticCurveTo((start.x + target.x) / 2, Math.min(start.y, target.y) - grid.dy * 1.5, x, y);
    });
    orb.destroy({ children: true }); trail.destroy();
    onCollect(b.cell.v, i);
    const color = multLook(b.cell.v)[2] === 'purple' ? 'pink' : multLook(b.cell.v)[2];
    sceneEffect('stpr_multiplier_meter_fx', `stpr_multiplier_meter_${color}_fx`,
      { x: target.x - grid.dy * .65, y: target.y - grid.dy * .55, width: grid.dy * 1.3, height: grid.dy * 1.1 });
  }
}

export async function transition(change) {
  const [width, height] = layouts[current].canvas;
  const effect = sceneEffect('stpr_transition', 'stpr_transition', { x: -width * .1, y: 0, width: width * 1.2, height });
  await wait(560);
  await change();
  await effect;
}

export async function setFree(on) {
  const changed = freeMode !== !!on;
  freeMode = !!on;
  if (!changed) return;
  for (const obj of baseOnly) obj.visible = shown(obj);
  if (freeHud) freeHud.visible = freeMode;
  // the backdrop crossfades to the night festival (style.css), and fireflies join the petals
  document.documentElement.dataset.mode = freeMode ? 'free' : 'base';
  ambience?.setFree(freeMode);
}

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

export async function setSoundIcon(on) {
  const o = ui.sound;
  if (!o || !o.item || o.item.atlas !== 'GUI') return;
  o.children[0].texture = await spriteTexture('GUI', on ? 'Sound' : 'SoundMute');
}
