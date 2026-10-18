import * as PIXI from 'pixi.js';
import { Spine } from 'pixi-spine';
import { motion, playAnimation } from './motion.js';

const cache = new Map();
export function skeleton(name) {
  name = name.replace(/_SkeletonData$/, '');
  if (!cache.has(name)) cache.set(name, PIXI.Assets.load(`/starlight/spines/${name}/${name}.json`).then(r => r.spineData));
  return cache.get(name);
}

// A single transparent canvas per dialog, with artwork fitted to its actual content boxes.
export function createArt(host) {
  const app = new PIXI.Application({ backgroundAlpha: 0, antialias: true,
    resolution: Math.min(devicePixelRatio, 2), autoDensity: true });
  host.appendChild(app.view);
  const entries = new Set();
  function place(entry) {
    const r = entry.rect();
    const b = entry.bounds;
    const k = Math.min(r.width / Math.max(1, b.width), r.height / Math.max(1, b.height));
    entry.spine.scale.set(k);
    entry.spine.position.set(r.x + r.width / 2 - (b.x + b.width / 2) * k,
      r.y + r.height / 2 - (b.y + b.height / 2) * k);
  }
  const resize = () => {
    app.renderer.resize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
    for (const e of entries) place(e);
  };
  new ResizeObserver(resize).observe(host);
  resize();
  return {
    async add(name, animation, rect, loop = false) {
      const s = new Spine(await skeleton(name));
      // Measure a visible frame; entrance animations often start with every attachment hidden.
      const entry = s.state.setAnimation(0, animation, false);
      s.update(Math.min(.5, entry.animation.duration * .65));
      const bounds = s.getLocalBounds().clone();
      s.state.setAnimation(0, animation, loop); s.update(0);
      motion.track(s);
      const item = { spine: s, bounds, rect };
      entries.add(item); app.stage.addChild(s); place(item);
      return {
        spine: s,
        hideSlots(pattern) {
          const original = s.update.bind(s);
          s.update = dt => {
            original(dt);
            for (const slot of s.skeleton.slots) if (pattern.test(slot.data.name)) s.slotContainers[slot.data.index].visible = false;
          };
          s.update(0);
        },
        play: (anim, repeats = false) => playAnimation(s, anim, repeats).finished,
        remove() { entries.delete(item); if (!s.destroyed) s.destroy({ children: true }); },
      };
    },
    clear() { for (const e of entries) e.spine.destroy({ children: true }); entries.clear(); },
    rect(element, expand = 1) {
      return () => {
        const h = host.getBoundingClientRect(), r = element.getBoundingClientRect();
        return { x: r.left - h.left - r.width * (expand - 1) / 2, y: r.top - h.top - r.height * (expand - 1) / 2,
          width: r.width * expand, height: r.height * expand };
      };
    },
  };
}
