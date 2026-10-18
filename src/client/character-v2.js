import * as PIXI from 'pixi.js';
import { TextureAtlas } from '@pixi-spine/base';
import { Spine, SkeletonJson, AtlasAttachmentLoader } from '@pixi-spine/runtime-3.7';
import { motion } from './motion.js';

// Reactions use the approved mesh and its existing joints, so no old character artwork can reappear.
const rotation = (peak, duration = 1.4) => [
  { time: 0, angle: 0 }, { time: duration * .3, angle: peak },
  { time: duration * .65, angle: peak * .65 }, { time: duration, angle: 0 },
];
function reaction({ tilt, lift, wand, wings, duration = 1.4 }) {
  return { bones: {
    body: { translate: [{ time: 0, x: 0, y: 0 }, { time: duration * .35, x: 0, y: lift }, { time: duration, x: 0, y: 0 }] },
    chest: { rotate: rotation(tilt, duration) }, head: { rotate: rotation(-tilt * 1.5, duration) },
    arm_left: { rotate: rotation(wand, duration) }, wand: { rotate: rotation(-wand * .6, duration) },
    arm_right: { rotate: rotation(-wand * .5, duration) },
    wing_left: { rotate: rotation(wings, duration) }, wing_right: { rotate: rotation(-wings, duration) },
    hair_left_tip: { rotate: rotation(tilt * 2, duration) }, hair_right_tip: { rotate: rotation(-tilt * 2, duration) },
    ribbon_left: { rotate: rotation(wings * .6, duration) }, ribbon_right: { rotate: rotation(-wings * .6, duration) },
  } };
}

// Exact-source mesh rig, independent motion, and original-pixel eyelid blinking.
const BASE = '/characters/princess-v2';
async function loadJson(name) {
  const response = await fetch(`${BASE}/${name}`);
  if (!response.ok) throw new Error(`Character asset ${name}: ${response.status}`);
  return response.json();
}
export async function createPrincessV2() {
  const [rig, atlasInfo] = await Promise.all([
    loadJson('character-v2-rig.json'), loadJson('character-v2-atlas.json')
  ]);
  const texture = await PIXI.Assets.load(`${BASE}/${atlasInfo.image}`);
  const image = { naturalWidth: texture.width, naturalHeight: texture.height };
  const atlas = new TextureAtlas();
  for (const name of Object.keys(atlasInfo.sprites)) atlas.addTexture(name, texture);
  Object.assign(rig.animations, {
    v2_anticipation: reaction({ tilt: -3, lift: 10, wand: 12, wings: 7 }),
    v2_win: reaction({ tilt: 4, lift: 26, wand: 22, wings: 13, duration: 1.8 }),
    v2_spell: reaction({ tilt: -5, lift: 18, wand: 36, wings: 9, duration: 1.6 }),
    v2_bonus: reaction({ tilt: 5, lift: 38, wand: 28, wings: 17, duration: 2.2 }),
  });
  const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(rig);
  const character = new Spine(data);
  character.autoUpdate = false;
  character.state.setAnimation(0, 'v2_idle', true);
  character.update(0);
  motion.track(character);
  // Deform only the refined eyelid vertices. Each bone influence receives the
  // same source-space offset, so the blink follows the face and shared edges.
  const smooth = (a, b, value) => {
    const t = Math.max(0, Math.min(1, (value-a)/(b-a)));
    return t*t*(3-2*t);
  };
  const eyelids = character.skeleton.slots.map(slot => {
    const source = rig.skins.default[slot.data.name][slot.data.name];
    const offsets = [];
    let cursor = 0, affected = false;
    for (let i=0; i<source.uvs.length; i+=2) {
      const x=source.uvs[i]*image.naturalWidth, y=source.uvs[i+1]*image.naturalHeight;
      let dx=0, dy=0;
      for (const eye of atlasInfo.eyes) {
        const radians=eye.angle*Math.PI/180, tx=Math.cos(radians), ty=Math.sin(radians);
        const u=(x-eye.x)*tx+(y-eye.y)*ty;
        const v=-(x-eye.x)*ty+(y-eye.y)*tx;
        const across=1-smooth(eye.halfWidth*.78, eye.halfWidth+3, Math.abs(u));
        const line=eye.closure-1.5*Math.pow(u/eye.halfWidth,2);
        const normal=v-line;
        const surrounding=1-smooth(eye.halfHeight,eye.reach,Math.abs(normal));
        const shift=-.96*across*surrounding*Math.max(-eye.halfHeight,Math.min(eye.halfHeight,normal));
        dx-=ty*shift; dy+=tx*shift;
      }
      const count=source.vertices[cursor++];
      for (let j=0;j<count;j++) { offsets.push(dx,-dy); cursor+=4; }
      affected=affected || Math.abs(dx)+Math.abs(dy)>1e-8;
    }
    return affected ? {slot,offsets} : null;
  }).filter(Boolean);
  const spineUpdate=character.update.bind(character);
  const intervals=[3.1,4.7,3.8,5.2,3.6,.28,4.4];
  let referencePose=false, clock=0, started=-Infinity, next=intervals[0], interval=1, amount=0;
  function applyBlink(value) {
    amount=value;
    for (const {slot,offsets} of eyelids) {
      const deform=slot.attachmentVertices;
      deform.length=value ? offsets.length : 0;
      if (value) for (let i=0;i<offsets.length;i++) deform[i]=offsets[i]*value;
    }
  }
  Object.defineProperty(character,'blinkAmount',{get:()=>amount});
  character.blink=()=>{
    if (referencePose) return;
    started=clock;
    next=clock+intervals[interval++%intervals.length];
  };
  character.update=dt=>{
    dt=Math.min(Math.max(dt,0),.05);
    if (!referencePose) {
      clock+=dt;
      while (clock>=next) {
        started=next;
        next+=intervals[interval++%intervals.length];
      }
      const elapsed=clock-started;
      const closure=elapsed<.07 ? smooth(0,.07,elapsed)
        : elapsed<.095 ? 1 : 1-smooth(.095,.205,elapsed);
      applyBlink(Math.max(0,Math.min(1,closure)));
    }
    spineUpdate(dt);
  };
  character.setReferencePose = reference => {
    referencePose=reference;
    clock=0; started=-Infinity; next=intervals[0]; interval=1;
    applyBlink(0);
    character.state.clearTracks();
    character.skeleton.setToSetupPose();
    if (!reference) character.state.setAnimation(0, 'v2_idle', true);
    spineUpdate(0);
  };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) character.setReferencePose(true);
  character.autoUpdate = !reducedMotion;
  character.react = (name, loop = false) => {
    if (referencePose) return;
    character.state.setEmptyAnimation(1, .15);
    if (name === 'idle') return;
    character.state.setAnimation(1, `v2_${name}`, loop);
    if (!loop) character.state.addEmptyAnimation(1, .2, 0);
    character.blink();
  };
  return character;
}
