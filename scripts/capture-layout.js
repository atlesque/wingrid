// Run inside the archived original game's page (starlight-princess-archive on 127.0.0.1:8788) once it is idle
// in the base game. It records one frame's draw list: every sprite, label and Spine skeleton that is drawn, in
// draw order, with its screen transform and what it shows. `scripts/capture-server.mjs` saves the result into
// layout/<name>.json, which the page uses to lay itself out exactly like the original.
//   await captureLayout('landscape')
window.captureLayout = async function captureLayout(name, receiver = 'http://127.0.0.1:8796/') {
  // find the scene root from any live GameObject
  let root = null;
  const visited = new WeakSet();
  (function scan(o, d) {
    if (root || !o || typeof o !== 'object' || visited.has(o) || d > 4) return;
    visited.add(o);
    if (o instanceof GameObject) { let t = o.transform; while (t.parent) t = t.parent; root = t; return; }
    let keys; try { keys = Object.keys(o); } catch (e) { return; }
    for (const k of keys.slice(0, 400)) { let v; try { v = o[k]; } catch (e) { continue; } if (v && typeof v === 'object') scan(v, d + 1); }
  })(window, 0);
  if (!root) throw new Error('No scene found');

  const KINDS = new Set(['UISprite', 'UILabel', 'SpineController', 'UITexture']);
  const owner = new Map();
  (function walk(t) {
    if (!t.gameObject.activeInHierarchy) return;
    for (const c of t.gameObject.components) {
      if (KINDS.has(c.constructor.name) && c.pixiObject) { owner.set(c.pixiObject, c); if (c.pixiObjectContent) owner.set(c.pixiObjectContent, c); }
    }
    for (const ch of t.children || []) walk(ch);
  })(root);

  // draw order: hook the Pixi draw calls for a few frames and note whose object each one belongs to. The
  // original's Pixi skips transforms of clean subtrees, so the only trustworthy geometry is what is actually
  // drawn: for each draw, the drawn object's on-screen bounds and transform at that moment.
  const order = [], seen = new Set(), drawn = new Map();
  const hooks = [[PIXI.Sprite.prototype, '_renderWebGL'], [PIXI.mesh && PIXI.mesh.Mesh.prototype, '_renderWebGL']].filter(h => h[0] && h[0][h[1]]);
  const orig = hooks.map(([p, m]) => p[m]);
  hooks.forEach(([p, m], i) => {
    p[m] = function (r) {
      let o = this;
      while (o && !owner.has(o)) o = o.parent;
      if (o) {
        const c = owner.get(o);
        if (!seen.has(c)) { seen.add(c); order.push(c); drawn.set(c, { leaves: [], owner: null }); }
        const d = drawn.get(c);
        if (!d.owner) { const w = c.pixiObject.worldTransform; d.owner = [w.a, w.b, w.c, w.d, w.tx, w.ty]; }
        if (d.leaves.length < 12 && this instanceof PIXI.Sprite) {
          const b = this.getBounds(), w = this.worldTransform;
          d.leaves.push({ b: [b.x, b.y, b.width, b.height], wt: [w.a, w.b, w.c, w.d, w.tx, w.ty], tex: [this.texture.width, this.texture.height], anchor: [this.anchor.x, this.anchor.y], alpha: this.worldAlpha });
        }
      }
      return orig[i].call(this, r);
    };
  });
  await new Promise(r => setTimeout(r, 400));
  hooks.forEach(([p, m], i) => { p[m] = orig[i]; });

  const path = t => { const a = []; while (t) { a.unshift(t.gameObject.name); t = t.parent; } return a.slice(4).join('/'); };
  const num = v => +(+v).toFixed(4);
  const color = c => c && [c.r, c.g, c.b, c.a].map(num);
  // a plain copy of engine data, minus links back into the scene
  const plain = v => { try { const s = JSON.stringify(v, (key, x) => (x && typeof x === 'object' && (x.gameObject || x.transform)) ? undefined : x); return s === undefined ? null : JSON.parse(s); } catch (e) { return null; } };
  // LabelMultipleLayers draws a label as stacked layers: gradient or flat fill, outline and blurred shadow
  const rgba = c => c && [c._r ?? c.r, c._g ?? c.g, c._b ?? c.b, c.a].map(num);
  const grad = g => g && { colors: (g.colorKeys || []).map(k => [...rgba(k.color), num(k.time)]), alphas: (g.alphaKeys || []).map(k => [num(k.alpha), num(k.time)]) };
  const labelLayers = c => {
    const m = c.gameObject.components.find(x => x.constructor.name === 'LabelMultipleLayers');
    if (!m || !m.layers) return null;
    return m.layers.map(l => ({
      fill: l.FillCenter, fillColor: rgba(l.FillColor), fillGradient: l.FillUseGradient ? grad(l.FillGradient) : null, fillAngle: l.FillGradientAngle,
      outline: l.Outline, outlineThickness: l.OutlineThickness, outlineColor: rgba(l.OutlineColor),
      outlineGradient: l.OutlineUseGradient ? grad(l.OutlineGradient) : null, outlineAngle: l.OutlineGradientAngle,
      shadow: l.BlurShadow, shadowSize: l.BlurShadowSize, shadowOffset: l.BlurShadowOffset && [num(l.BlurShadowOffset.x), num(l.BlurShadowOffset.y)], shadowColor: rgba(l.BlurShadowColor),
      offset: l.Offset && [num(l.Offset.x), num(l.Offset.y)],
    }));
  };
  const items = order.map(c => {
    const k = c.constructor.name, p = c.pixiObject, wt = p.worldTransform;
    const d = drawn.get(c);
    const o = { k, path: path(c.transform), wt: (d.owner || [wt.a, wt.b, wt.c, wt.d, wt.tx, wt.ty]).map(num), alpha: num(p.worldAlpha || 0),
      leaves: d.leaves.map(l => ({ b: l.b.map(num), wt: l.wt.map(num), tex: l.tex.map(num), anchor: l.anchor, alpha: num(l.alpha) })) };
    if (k === 'UISprite' || k === 'UITexture') Object.assign(o, {
      atlas: c.atlas && c.atlas.gameObject && c.atlas.gameObject.name, sprite: c.spriteName, type: c.spriteType, fillCenter: c.fillCenter,
      w: c.width, h: c.height, ax: c.anchorX, ay: c.anchorY, color: color(c.color), depth: c.depth,
      fill: c.fillAmount, fillDir: c.fillDirection, invert: c.invert,
    });
    if (k === 'UILabel') Object.assign(o, {
      text: c._text, font: c.fontName, size: c.fontSize, w: c.width, h: c.height, ax: c.anchorX, ay: c.anchorY, align: c.alignment,
      overflow: c.overflow, spacingY: c.spacingY, maxLines: c.maxLines, color: color(c.color), effect: c.effectStyle,
      effectColor: color(c.effectColor), effectW: c.effectWidth, effectH: c.effectHeight, shadow: c.dropShadowDistance,
      outline: c.mOutline, outlineThickness: c.mOutlineThickness, outlineColor: color(c.mOutlineColor),
      blur: c.mBlurShadow, blurSize: c.mBlurShadowSize, blurX: c.mBlurShadowOffsetX, blurY: c.mBlurShadowOffsetY, blurColor: color(c.mBlurShadowColor),
      gradient: c.mFillUseGradient ? plain(c.mFillGradient) : null,
      layers: labelLayers(c),
    });
    if (k === 'SpineController') Object.assign(o, {
      skeleton: c.spineData && c.spineData.name, anim: c.animationName, mode: c.animationMode, color: color(c.color),
    });
    return o;
  });
  const r = PIXI.WebGLRenderer.prototype; // the size every transform above is in
  const canvas = document.querySelector('canvas');
  const out = { name, canvas: [canvas.width, canvas.height], css: [innerWidth, innerHeight], items };
  await fetch(receiver + encodeURIComponent(name), { method: 'POST', mode: 'no-cors', body: JSON.stringify(out) });
  return { items: items.length, canvas: out.canvas };
};
