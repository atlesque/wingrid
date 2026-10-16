// Rebuilds a Spine .atlas for a skeleton straight from the archived desktop scene data.
// The game keeps each atlas as a UIAtlas component: a page texture (textureContent.guid) and a spriteList of
// s_<region> → { x, y, width, height, rotate, padding* } in page pixels from the top left, where a rotated
// sprite is stored turned a quarter and padding is the transparent border trimmed off it. A SpineController
// names its skeleton (spineData.guid) and the atlases it draws from.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FRAG = /^(.*?)(\d{3})\.json$/;

// every scene document of the desktop build, with its numbered fragments joined back together
function loadDocs(archive, variant = 'desktop') {
  const base = join(archive, 'site/gs2c/common/v3/games-html5/games/vs/vs20starlight', variant);
  const docs = [];
  for (const dir of ['game', 'client']) {
    const d = join(base, dir);
    if (!existsSync(d)) continue;
    const groups = {};
    for (const f of readdirSync(d).filter(f => f.endsWith('.json')).sort()) {
      const m = FRAG.exec(f);
      (groups[m ? m[1] : f] ||= []).push(join(d, f));
    }
    for (const files of Object.values(groups)) {
      try { docs.push(JSON.parse(files.map(f => readFileSync(f, 'utf8')).join(''))); } catch (e) { /* sound packs etc. */ }
    }
  }
  return docs;
}

function* components(doc) {
  for (const r of doc.resources || []) {
    if (r.type !== 'GameObject') continue;
    for (const obj of r.data?.root || []) for (const c of obj.components || []) yield [r.id, c.componentType, c.serializableData || {}];
  }
}

export function sceneAtlases(archive) {
  const atlases = {}, links = {};
  for (const doc of loadDocs(archive)) {
    for (const [id, type, sd] of components(doc)) {
      if (type === 'UIAtlas') atlases[id] = { page: sd.textureContent?.guid, sprites: sd.spriteList || {} };
      if (type === 'SpineController' && sd.spineData?.guid) {
        const set = (links[sd.spineData.guid] ||= new Set());
        for (const g of sd.spineAtlases || []) for (const a of g.serializableData?.atlases || []) if (a.guid) set.add(a.guid);
      }
    }
  }
  return { atlases, links };
}

const pngSize = file => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

// `pages` maps a page guid to its image file (relative to the atlas) on disk
export function atlasText(atlasList, pages) {
  const out = [];
  for (const at of atlasList) {
    const page = pages[at.page];
    if (!page) continue;
    const [pw, ph] = pngSize(page.file);
    if (out.length) out.push('');
    out.push(page.rel, `size: ${pw},${ph}`, 'format: RGBA8888', 'filter: Linear,Linear', 'repeat: none');
    for (const [key, s] of Object.entries(at.sprites)) {
      const x = s.x || 0, y = s.y || 0, w = s.width || 0, h = s.height || 0, rot = !!s.rotate;
      const pl = s.paddingLeft || 0, pr = s.paddingRight || 0, pt = s.paddingTop || 0, pb = s.paddingBottom || 0;
      // the sprite list's width and height are the rect on the page; a rotated sprite is h x w upright, which is
      // what Spine's `size` wants (checked against the skeletons' attachment sizes). Padding counts upright.
      const [uw, uh] = rot ? [h, w] : [w, h];
      out.push(key.replace(/^s_/, ''),
        `  rotate: ${rot}`,
        `  xy: ${x}, ${y}`,
        `  size: ${uw}, ${uh}`,
        `  orig: ${uw + pl + pr}, ${uh + pt + pb}`,
        `  offset: ${pl}, ${pb}`,
        '  index: -1');
    }
  }
  return out.join('\n') + '\n';
}

// Every NGUI atlas (UIAtlas) by name, as { page: <texture guid>, sprites: { name: rect } }. Desktop scene data
// first; atlases only the mobile build has come from there. Rects are in page pixels from the top left; a
// rotated sprite's width and height are its upright size, padding is the trimmed border and border the
// 9-slice insets.
export function uiAtlases(archive) {
  const out = {};
  for (const variant of ['desktop', 'mobile']) {
    for (const doc of loadDocs(archive, variant)) {
      for (const r of doc.resources || []) {
        if (r.type !== 'GameObject') continue;
        for (const o of r.data?.root || []) for (const c of o.components || []) {
          if (c.componentType !== 'UIAtlas' || out[o.name]) continue;
          const sd = c.serializableData || {};
          const sprites = {};
          for (const [k, s] of Object.entries(sd.spriteList || {})) sprites[k.replace(/^s_/, '')] = {
            x: s.x || 0, y: s.y || 0, w: s.width || 0, h: s.height || 0, rotate: !!s.rotate,
            pad: [s.paddingLeft || 0, s.paddingTop || 0, s.paddingRight || 0, s.paddingBottom || 0],
            border: [s.borderLeft || 0, s.borderTop || 0, s.borderRight || 0, s.borderBottom || 0],
          };
          out[o.name] = { page: sd.textureContent?.guid, sprites };
        }
      }
    }
  }
  return out;
}

// Every Spine skeleton of the desktop build, by name: { id, skeleton }. (The decoded archive kept whichever
// build's copy it met last, which for some skeletons is the mobile or mini one with other animations.)
export function uhtSpines(archive) {
  const out = {};
  for (const variant of ['desktop', 'mobile']) {
    for (const doc of loadDocs(archive, variant)) {
      for (const r of doc.resources || []) {
        if (r.type !== 'UHTSpine' || !r.data?.spineJSON) continue;
        const name = (r.data.name || r.id).replace(/_SkeletonData$/, '');
        if (out[name]) continue;
        out[name] = { id: r.id, skeleton: JSON.parse(Buffer.from(r.data.spineJSON, 'base64').toString('utf8')) };
      }
    }
  }
  return out;
}
