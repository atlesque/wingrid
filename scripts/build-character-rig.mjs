// Re-skins the princess rig so every piece moves as one piece.
//
// The rig is a set of meshes cut from one painting (character-v2-reference.png) with identity UVs, so at the
// setup pose each vertex sits on its own source pixel. The old weights tied vertices to bones on the far side
// of the body (a shin vertex followed the chest, the lower glove followed the skirt), so a pose stretched and
// sheared pieces and left smeared copies behind. Here each vertex's weights come only from where it sits in
// the painting: the regions below are painted onto the image in order, each with a soft edge, and a vertex
// takes each bone in proportion to how much of that bone's region covers it (later regions sit on top).
// Because the weights depend on position alone, vertices that two meshes share always get the same weights
// and stay welded, and neighbouring pieces bend smoothly into each other instead of tearing.
//
// Usage: node scripts/build-character-rig.mjs   (rewrites public/characters/princess-v2/character-v2-rig.json)
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'public/characters/princess-v2/character-v2-rig.json';
const rig = JSON.parse(readFileSync(FILE, 'utf8'));
const { width: W, height: H } = rig.skeleton;

// Bone pivots in painting pixels (x right, y down), each under its parent.
const BONES = [
  ['root', null, 512, 768],
  ['body', 'root', 510, 730],
  ['chest', 'body', 515, 590], // waist
  ['wing_left', 'chest', 400, 300],
  ['wing_right', 'chest', 640, 330],
  ['skirt', 'body', 510, 640],
  ['ribbon_left', 'skirt', 150, 650],
  ['ribbon_right', 'skirt', 830, 740],
  ['leg_left', 'skirt', 400, 820], // the front leg's hip
  ['leg_right', 'skirt', 690, 800],
  ['arm_left', 'chest', 400, 440], // both hands, the wand and her right sleeve, turning about the middle of them
  ['arm_right', 'chest', 640, 420], // her left puffed sleeve, from the shoulder
  ['wand', 'arm_left', 310, 285], // the star end, from the upper hand
  ['head', 'chest', 515, 262], // neck
  ['hair', 'head', 515, 150],
  ['wing_left_tip', 'wing_left', 220, 230],
  ['wing_right_tip', 'wing_right', 840, 300],
  ['hair_left_tip', 'hair', 425, 170],
  ['hair_right_tip', 'hair', 625, 160],
  ['shin_left', 'leg_left', 630, 895], // knee
  ['shin_right', 'leg_right', 700, 990],
];

// [bone, soft edge in px, polygon], bottom to top. Whatever no region fully covers (mostly the empty canvas
// round her) follows the nearest region, so the space between two pieces never gets dragged by a third.
const REGIONS = [
  ['chest', 30, [[370, 240], [670, 240], [720, 420], [660, 610], [370, 610], [345, 400]]],
  ['skirt', 26, [[30, 600], [330, 588], [520, 598], [700, 610], [1000, 600], [1000, 1010], [30, 1010]]],
  ['ribbon_left', 24, [[0, 600], [115, 625], [110, 760], [140, 880], [255, 935], [260, 1015], [50, 1015], [0, 950]]],
  ['ribbon_right', 24, [[855, 560], [1024, 560], [1024, 1190], [870, 1190], [858, 900], [870, 700]]],
  ['wing_left', 14, [[20, 0], [300, 0], [395, 215], [395, 300], [330, 360], [220, 530], [70, 570], [0, 520], [0, 90]]],
  ['wing_left_tip', 50, [[0, 0], [215, 0], [215, 330], [120, 470], [0, 470]]],
  ['wing_right', 14, [[700, 140], [1024, 60], [1024, 610], [770, 590], [690, 470], [645, 330]]],
  ['wing_right_tip', 50, [[850, 40], [1024, 40], [1024, 560], [860, 540]]],
  ['leg_left', 12, [[300, 782], [520, 782], [640, 805], [662, 880], [640, 928], [560, 935], [450, 905], [305, 892]]],
  ['shin_left', 22, [[648, 858], [675, 900], [645, 938], [478, 1040], [440, 1130], [410, 1295], [262, 1295], [262, 1090], [360, 1030], [560, 925]]],
  ['leg_right', 12, [[640, 760], [745, 760], [765, 965], [722, 1012], [652, 938], [662, 880]]],
  ['shin_right', 22, [[700, 955], [745, 1000], [705, 1065], [565, 1205], [478, 1322], [418, 1490], [272, 1490], [282, 1300], [398, 1236], [458, 1148], [560, 1040], [652, 938]]],
  ['arm_right', 14, [[575, 395], [655, 375], [765, 415], [795, 520], [770, 645], [665, 695], [560, 650], [585, 520]]],
  ['arm_left', 12, [[265, 222], [350, 222], [400, 300], [455, 410], [528, 462], [598, 495], [606, 562], [548, 590], [470, 600], [400, 632], [300, 635], [200, 612], [100, 560], [150, 470], [210, 400], [250, 320]]],
  ['wand', 10, [[185, 105], [345, 105], [352, 238], [312, 262], [262, 262], [185, 205]]],
  ['hair', 14, [[355, 0], [725, 0], [745, 150], [725, 300], [620, 312], [470, 278], [372, 305], [345, 150]]],
  ['hair_left_tip', 40, [[340, 40], [445, 40], [445, 320], [340, 320]]],
  ['hair_right_tip', 40, [[618, 30], [750, 30], [750, 320], [618, 320]]],
  ['head', 10, [[442, 92], [500, 70], [565, 72], [612, 118], [618, 205], [612, 248], [560, 262], [495, 266], [452, 272], [440, 160]]],
];

if (process.argv.includes('--regions')) { console.log(JSON.stringify({ BONES, REGIONS })); process.exit(0); }

const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
function signedDistance([x, y], poly) {
  let inside = false, best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    if ((by > y) !== (ay > y) && x < (ax - bx) * (y - by) / (ay - by) + bx) inside = !inside;
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return inside ? -best : best;
}
function weightsAt(point) {
  const weights = new Map();
  let remaining = 1, nearest = null, distance = Infinity;
  for (let i = REGIONS.length - 1; i >= 0 && remaining > 1e-4; i--) {
    const [bone, soft, poly] = REGIONS[i];
    const d = signedDistance(point, poly);
    if (d < distance) { distance = d; nearest = bone; }
    const cover = 1 - smooth(-soft, soft, d);
    if (cover <= 0) continue;
    weights.set(bone, (weights.get(bone) || 0) + remaining * cover);
    remaining *= 1 - cover;
  }
  if (remaining > 1e-4) weights.set(nearest, (weights.get(nearest) || 0) + remaining);
  // at most four bones a vertex, none under 2%
  const kept = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 4).filter(([, w]) => w >= .02);
  const total = kept.reduce((sum, [, w]) => sum + w, 0);
  return kept.map(([bone, w]) => [bone, w / total]);
}

const index = new Map(BONES.map(([name], i) => [name, i]));
const pivot = new Map(BONES.map(([name, , x, y]) => [name, [x, y]]));
const old = new Map(rig.bones.map(b => [b.name, b]));
if (BONES.length !== rig.bones.length || BONES.some(([name]) => !old.has(name))) throw new Error('bone list changed');
// Spine is y-up, so a bone's position under its parent is (dx, -dy) in painting pixels.
rig.bones = BONES.map(([name, parent, x, y]) => {
  const bone = { ...old.get(name), name };
  delete bone.parent; delete bone.x; delete bone.y;
  if (!parent) return { name };
  const [px, py] = pivot.get(parent);
  return { name, parent, ...bone, x: x - px, y: -(y - py) };
});
// Her lower face is its own piece (character-v2-jaw.png, cut by scripts/build-character-jaw.py) drawn over the head,
// so her jaw can drop as one when she speaks. Its mesh is a fine grid over the piece, weighted like the head below it.
const JAW = { box: [464, 192, 592, 258], step: 3 };
if (!rig.slots.some(slot => slot.name === 'jaw')) rig.slots.push({ name: 'jaw', bone: 'body', attachment: 'jaw' });
{
  const [x0, y0, x1, y1] = JAW.box, columns = Math.round((x1 - x0) / JAW.step), rows = Math.round((y1 - y0) / JAW.step);
  const uvs = [], triangles = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= columns; c++) {
    uvs.push(+((x0 + c * JAW.step) / W).toFixed(6), +((y0 + r * JAW.step) / H).toFixed(6));
    if (r < rows && c < columns) {
      const i = r * (columns + 1) + c, below = i + columns + 1;
      triangles.push(i, i + 1, below, i + 1, below + 1, below);
    }
  }
  rig.skins.default.jaw = { jaw: { type: 'mesh', path: 'jaw', width: W, height: H, uvs, triangles, vertices: [], hull: 0 } };
  const ATLAS = 'public/characters/princess-v2/character-v2-atlas.json', atlas = JSON.parse(readFileSync(ATLAS, 'utf8'));
  atlas.sprites.jaw = { image: 'character-v2-jaw.png', x: 0, y: 0, width: W, height: H, rotate: false };
  writeFileSync(ATLAS, JSON.stringify(atlas, null, 2) + '\n');
}
for (const [slot, attachments] of Object.entries(rig.skins.default)) {
  const mesh = attachments[slot];
  const vertices = [];
  for (let i = 0; i < mesh.uvs.length; i += 2) {
    const point = [mesh.uvs[i] * W, mesh.uvs[i + 1] * H];
    const weights = weightsAt(point);
    vertices.push(weights.length);
    for (const [bone, w] of weights) {
      const [bx, by] = pivot.get(bone);
      vertices.push(index.get(bone), +(point[0] - bx).toFixed(3), +(by - point[1]).toFixed(3), +w.toFixed(5));
    }
  }
  mesh.vertices = vertices;
}
writeFileSync(FILE, JSON.stringify(rig));
console.log(`Re-skinned ${Object.keys(rig.skins.default).length} meshes on ${BONES.length} bones.`);
