// Refresh the exact-source character assets without changing the game's adapter.
import { cpSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
const source = resolve(process.argv[2] || '../starlight-princess-archive/character-demo');
const target = resolve('public/characters/princess-v2');
mkdirSync(target, { recursive: true });
for (const name of ['character-v2-reference.png', 'character-v2-rig.json', 'character-v2-atlas.json', 'character-v2-source.json']) {
  cpSync(join(source, name), join(target, name));
}
console.log('Imported Princess v2 source, rig, atlas and provenance.');
// the imported rig carries the old weights; give it the ones that keep each piece in one piece
await import('./build-character-rig.mjs');
