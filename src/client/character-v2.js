import * as PIXI from 'pixi.js';
import { TextureAtlas } from '@pixi-spine/base';
import { Spine, SkeletonJson, AtlasAttachmentLoader } from '@pixi-spine/runtime-3.7';
import { motion } from './motion.js';

// Reactions use the approved mesh and its existing joints, so no old character artwork can reappear. The
// painting is one flat layer, so each piece only turns as far as its neighbours can bend after it: both hands
// hold the wand, so the arms and wand move as one piece, and the star end flicks on its own.
const rotation = (peak, duration = 1.4) => [
  { time: 0, angle: 0 }, { time: duration * .3, angle: peak },
  { time: duration * .65, angle: peak * .65 }, { time: duration, angle: 0 },
];
function reaction({ tilt, lift, wand, wings, duration = 1.4 }) {
  return { bones: {
    body: { translate: [{ time: 0, x: 0, y: 0 }, { time: duration * .35, x: 0, y: lift }, { time: duration, x: 0, y: 0 }] },
    chest: { rotate: rotation(tilt * .5, duration) }, head: { rotate: rotation(-tilt, duration) },
    arm_left: { rotate: rotation(wand * .1, duration) }, wand: { rotate: rotation(wand * .4, duration) },
    arm_right: { rotate: rotation(-wand * .08, duration) },
    wing_left: { rotate: rotation(wings * .3, duration) }, wing_right: { rotate: rotation(-wings * .45, duration) },
    wing_left_tip: { rotate: rotation(wings * .3, duration) }, wing_right_tip: { rotate: rotation(-wings * .45, duration) },
    hair_left_tip: { rotate: rotation(tilt * .8, duration) }, hair_right_tip: { rotate: rotation(-tilt * .8, duration) },
    ribbon_left: { rotate: rotation(wings * .3, duration) }, ribbon_right: { rotate: rotation(-wings * .3, duration) },
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
  const [rig, atlasInfo, face, lipsync] = await Promise.all([
    loadJson('character-v2-rig.json'), loadJson('character-v2-atlas.json'), loadJson('character-v2-face.json'),
    loadJson('character-v2-lipsync.json')
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
  // The face moves by nudging the painting's own pixels: each expression is a field of source-space offsets
  // on the face's vertices. Every bone influence of a vertex receives the same offset, so the face keeps
  // following the head and shared edges stay closed.
  const smooth = (a, b, value) => {
    const t = Math.max(0, Math.min(1, (value-a)/(b-a)));
    return t*t*(3-2*t);
  };
  function field(offset) {
    return character.skeleton.slots.map(slot => {
      const source = rig.skins.default[slot.data.name][slot.data.name];
      const offsets = [];
      let cursor = 0, affected = false;
      for (let i=0; i<source.uvs.length; i+=2) {
        const [dx, dy] = offset(source.uvs[i]*image.naturalWidth, source.uvs[i+1]*image.naturalHeight);
        const count=source.vertices[cursor++];
        for (let j=0;j<count;j++) { offsets.push(dx,-dy); cursor+=4; }
        affected=affected || Math.abs(dx)+Math.abs(dy)>1e-8;
      }
      return affected ? {slot,offsets} : null;
    }).filter(Boolean);
  }
  // Blinks deform only the refined eyelid vertices.
  const eyelids = field((x, y) => {
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
    return [dx, dy];
  });
  // Speaking shapes the mouth along the line between her lips. The lips part in an oval round the middle of
  // her mouth (narrower when they round into an O) that closes well before the corners, so the smile keeps its
  // shape: the lower lip and chin drop, the upper lip lifts a little, and a mouth drawn into the gap shows
  // behind them. The corners draw out for an "ee" and in for an "oo". Her brows lift as she talks.
  const { mouth, brows, visemes } = face;
  const seam = x => {
    const points = mouth.seam;
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) if (x <= points[i][0]) {
      const [x0, y0] = points[i-1], [x1, y1] = points[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    return points.at(-1)[1];
  };
  // how far the lips part at x for an oval of the given half width; it widens further down so the chin drops as one
  // (in a U, so the lower lip drops as a curve, not a point)
  const parting = (halfWidth, x, depth = 0) => {
    const u = Math.abs(x - mouth.centre) / (halfWidth + depth * .5);
    return u >= 1 ? 0 : Math.pow(1 - Math.pow(u, 3), .6);
  };
  const jawField = (halfWidth, drop) => field((x, y) => {
    const depth = y - seam(x);
    if (depth >= 0) return [0, drop * parting(halfWidth, x, depth) * (1 - smooth(mouth.jaw[0], mouth.jaw[1], depth))];
    return [0, -drop * mouth.lift * parting(halfWidth, x) * (1 - smooth(0, 9, -depth))];
  });
  const jaw = jawField(mouth.halfWidth, mouth.open), roundJaw = jawField(mouth.roundHalfWidth, mouth.roundOpen);
  const corners = field((x, y) => {
    const u = (x - mouth.centre) / (mouth.halfWidth * 1.6);
    const along = Math.sign(u) * smooth(0, 1, Math.abs(u)) * (1 - smooth(1.1, 1.7, Math.abs(u)));
    return [mouth.corner * along * (1 - smooth(3, 12, Math.abs(y - seam(x)))), 0];
  });
  const browLift = field((x, y) => {
    let dy = 0;
    for (const brow of brows) {
      const radians=brow.angle*Math.PI/180, tx=Math.cos(radians), ty=Math.sin(radians);
      const u=((x-brow.x)*tx+(y-brow.y)*ty)/brow.halfWidth, v=(-(x-brow.x)*ty+(y-brow.y)*tx)/brow.halfHeight;
      dy -= brow.raise * (1 - smooth(.7, 1.8, Math.hypot(u, v)));
    }
    return [0, dy];
  });
  const channels = [[eyelids, 0], [jaw, 0], [roundJaw, 0], [corners, 0], [browLift, 0]];
  function applyFace(blink, shape, brow) {
    channels[0][1] = blink; channels[1][1] = shape.open * (1 - shape.round); channels[2][1] = shape.open * shape.round;
    channels[3][1] = shape.spread - shape.round * .8; channels[4][1] = brow;
    const slots = new Map();
    for (const [parts, amount] of channels) {
      if (!amount) continue;
      for (const {slot, offsets} of parts) {
        let deform = slots.get(slot);
        if (!deform) { slots.set(slot, deform = slot.attachmentVertices); deform.length = offsets.length; deform.fill(0); }
        for (let i=0;i<offsets.length;i++) deform[i]+=offsets[i]*amount;
      }
    }
    for (const {slot} of channels.flatMap(([parts]) => parts)) if (!slots.has(slot)) slot.attachmentVertices.length = 0;
  }
  // The inside of her mouth, in painting pixels on the head, redrawn each frame where the lips have parted.
  const inside = new PIXI.Graphics();
  const head = character.skeleton.findBone('head');
  const bones = new Map(rig.bones.map(bone => [bone.name, bone]));
  const pivot = [image.naturalWidth/2, image.naturalHeight/2];
  for (let bone = bones.get('head'); bone; bone = bones.get(bone.parent)) {
    pivot[0] += bone.x || 0; pivot[1] -= bone.y || 0;
  }
  function drawInside(shape) {
    inside.clear();
    if (shape.open < .04) return;
    // painting pixels (y down) to the head bone's y-up space, then to the skeleton as the meshes are placed
    const m = head.matrix, place = (x, y) => {
      const lx = x - pivot[0], ly = pivot[1] - y;
      return [lx * m.a + ly * m.c + m.tx, lx * m.b + ly * m.d + m.ty];
    };
    const top = [], bottom = [], teeth = [], tongue = [];
    for (let i = 0; i <= 16; i++) {
      const x = mouth.centre + mouth.halfWidth * (i / 8 - 1), y = seam(x);
      const wide = parting(mouth.halfWidth, x), round = parting(mouth.roundHalfWidth, x);
      const gap = shape.open * (mouth.open * wide * (1 - shape.round) + mouth.roundOpen * round * shape.round);
      // the drawn lip line thins out where the lips barely part
      const edge = Math.min(1, gap / 1.5) * Math.max(wide * (1 - shape.round), round);
      const upper = y - .4 * edge - gap * mouth.lift, lower = y + 1.2 * edge + gap;
      top.push(place(x, upper));
      teeth.push(place(x, upper + gap * .45 * shape.teeth));
      tongue.push(place(x, lower - gap * .3));
      bottom.push(place(x, lower));
    }
    inside.beginFill(0x6e2230).drawPolygon([...top, ...[...bottom].reverse()].flat()).endFill();
    // the tongue's glow at the bottom, and a band of upper teeth just under the top lip
    inside.beginFill(0xb84a58, .85).drawPolygon([...tongue, ...[...bottom].reverse()].flat()).endFill();
    inside.beginFill(0xf6ece6, .9).drawPolygon([...top, ...teeth.reverse()].flat()).endFill();
  }
  const spineUpdate=character.update.bind(character);
  const intervals=[3.1,4.7,3.8,5.2,3.6,.28,4.4];
  let referencePose=false, clock=0, started=-Infinity, next=intervals[0], interval=1, amount=0;
  let line=null, said=0, browRaise=0;
  const shape={...visemes.X};
  Object.defineProperty(character,'blinkAmount',{get:()=>amount});
  Object.defineProperty(character,'mouthOpen',{get:()=>shape.open});
  character.blink=()=>{
    if (referencePose) return;
    started=clock;
    next=clock+intervals[interval++%intervals.length];
  };
  // Mouth a line: the sounds of its words, timed to the audio (character-v2-lipsync.json holds each line's
  // sounds, worked out from the recordings), on her own time when it can't be heard, or a few syllables for a
  // line with no sounds on record.
  character.speak=({clip, elapsed}={})=>{
    if (referencePose) return;
    line={keys:lipsync.lines[clip]?.keys, elapsed}; said=0;
  };
  // the mouth shape for this moment of the line
  function sound(dt) {
    if (!line) return visemes.X;
    said+=dt;
    if (!line.keys) {
      if (said>1.1) { line=null; return visemes.X; }
      return {...visemes.A, open:Math.max(0, Math.sin(said*Math.PI*2*4.6))*(1-smooth(.8,1.1,said))};
    }
    // the lips form a moment before the sound they make
    const at=(line.elapsed?.() ?? said)+.04, keys=line.keys;
    if (at>keys.at(-1)[0]+.1) { line=null; return visemes.X; }
    const key=keys.findLast(([time])=>time<=at);
    if (!key) return visemes.X;
    const [, name, weight=1]=key, viseme=visemes[name];
    return {...viseme, open:viseme.open*weight};
  }
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
      amount=Math.max(0,Math.min(1,closure));
      const target=sound(dt);
      for (const key in shape) {
        shape[key]+=(target[key]-shape[key])*Math.min(1,dt*(target[key]>shape[key] ? 32 : 24));
        if (Math.abs(shape[key])<.002) shape[key]=0;
      }
      browRaise+=((line ? 1 : 0)-browRaise)*Math.min(1,dt*(line ? 8 : 3));
      if (browRaise<.002) browRaise=0;
      applyFace(amount, shape, browRaise);
    }
    spineUpdate(dt);
    drawInside(shape);
  };
  character.setReferencePose = reference => {
    referencePose=reference;
    clock=0; started=-Infinity; next=intervals[0]; interval=1;
    line=null; amount=browRaise=0; Object.assign(shape, visemes.X);
    applyFace(0, shape, 0);
    character.state.clearTracks();
    character.skeleton.setToSetupPose();
    if (!reference) character.state.setAnimation(0, 'v2_idle', true);
    spineUpdate(0);
    drawInside(shape);
  };
  character.addChild(inside);
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
