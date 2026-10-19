import * as PIXI from 'pixi.js';
import { motion } from './motion.js';

// ================= AMBIENCE =================
// Cherry petals drifting down over the backdrop, behind the game, in screen space so they fill whatever shape the
// screen is. In free spins they turn a deeper pink and fireflies rise among them. Reduced motion shows none.
function petalTexture() {
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
  const g = c.getContext('2d');
  // a single petal, notched at its tip, pale at the base and pink at the edge
  const fill = g.createRadialGradient(32, 52, 4, 32, 34, 34);
  fill.addColorStop(0, '#fff6fb'); fill.addColorStop(0.55, '#ffc4dd'); fill.addColorStop(1, '#f58bb8');
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(32, 60);
  g.bezierCurveTo(10, 48, 8, 22, 22, 8);
  g.lineTo(32, 15);
  g.lineTo(42, 8);
  g.bezierCurveTo(56, 22, 54, 48, 32, 60);
  g.fill();
  g.strokeStyle = 'rgba(214, 90, 140, .45)'; g.lineWidth = 1.5; g.stroke();
  return PIXI.Texture.from(c);
}
function glowTexture() {
  const c = Object.assign(document.createElement('canvas'), { width: 32, height: 32 });
  const g = c.getContext('2d'), fill = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  fill.addColorStop(0, 'rgba(255,255,230,1)'); fill.addColorStop(0.25, 'rgba(255,226,140,.8)'); fill.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = fill; g.fillRect(0, 0, 32, 32);
  return PIXI.Texture.from(c);
}

export function createAmbience({ free = false } = {}) {
  const layer = new PIXI.Container();
  layer.label = 'Ambience';
  if (motion.reduced) return { layer, resize() {}, setFree() {} };
  const petals = new PIXI.Container(), flies = new PIXI.Container();
  flies.blendMode = PIXI.BLEND_MODES.ADD;
  layer.addChild(petals, flies);
  const petal = petalTexture(), glow = glowTexture();
  let w = 1, h = 1, unit = 1, night = free;
  const rand = (a, b) => a + Math.random() * (b - a);

  function spawn(p, anywhere) {
    p.x = rand(-0.05, 1.05) * w;
    p.y = anywhere ? rand(0, h) : -rand(0.02, 0.2) * h;
    p.size = rand(0.55, 1.1) * unit;
    p.fall = rand(0.6, 1.1) * unit * 2.4; // per second, in petal sizes
    p.drift = rand(0.2, 0.7) * unit * 1.6;
    p.sway = rand(0.6, 1.6) * unit;
    p.phase = rand(0, Math.PI * 2);
    p.spin = rand(-1.2, 1.2);
    p.flip = rand(1.5, 3.5);
    p.rotation = rand(0, Math.PI * 2);
  }
  function fly(f, anywhere) {
    f.x = rand(0, w); f.y = anywhere ? rand(0.3, 1) * h : h * rand(1, 1.05);
    f.rise = rand(0.15, 0.45) * unit * 2; f.phase = rand(0, Math.PI * 2); f.size = rand(0.35, 0.8) * unit;
  }
  function fill(container, count, make) {
    while (container.children.length < count) container.addChild(make());
    while (container.children.length > count) container.removeChildAt(container.children.length - 1).destroy();
  }
  function recolor() {
    for (const p of petals.children) p.tint = night ? 0xff9fd2 : 0xffffff;
    flies.visible = night;
  }

  let t = 0;
  const tick = () => {
    if (layer.destroyed) { PIXI.Ticker.shared.remove(tick); return; }
    const dt = Math.min(0.1, PIXI.Ticker.shared.deltaMS / 1000);
    t += dt;
    for (const p of petals.children) {
      p.y += p.fall * dt;
      p.x += (p.drift + Math.sin(t * 0.9 + p.phase) * p.sway) * dt;
      p.rotation += p.spin * dt;
      // turning over as it falls
      p.scale.set(p.size / 64 * Math.cos(t * p.flip + p.phase), p.size / 64);
      if (p.y > h + unit * 2 || p.x > w + unit * 3) spawn(p, false);
    }
    if (night) for (const f of flies.children) {
      f.y -= f.rise * dt;
      f.x += Math.sin(t * 0.7 + f.phase) * unit * 0.4 * dt;
      f.alpha = 0.35 + 0.65 * Math.max(0, Math.sin(t * 1.8 + f.phase));
      f.scale.set(f.size / 32 * (0.8 + f.alpha * 0.4));
      if (f.y < -unit) fly(f, false);
    }
  };
  PIXI.Ticker.shared.add(tick);

  return {
    layer,
    resize(sw, sh) {
      const first = w === 1;
      w = sw; h = sh; unit = Math.max(10, Math.min(sw, sh) * 0.028);
      // more petals on bigger screens, within reason
      fill(petals, Math.round(Math.min(42, Math.max(14, sw * sh / 32000))), () => { const p = new PIXI.Sprite(petal); p.anchor.set(0.5); p.alpha = 0.9; return p; });
      fill(flies, Math.round(Math.min(26, Math.max(10, sw * sh / 60000))), () => { const f = new PIXI.Sprite(glow); f.anchor.set(0.5); return f; });
      for (const p of petals.children) if (first || p.size === undefined) spawn(p, true); else { p.x = Math.min(p.x, w); p.y = Math.min(p.y, h); }
      for (const f of flies.children) if (first || f.size === undefined) fly(f, true);
      recolor();
    },
    setFree(on) { night = !!on; recolor(); },
  };
}
