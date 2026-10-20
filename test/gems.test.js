import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SYMBOLS } from '../src/shared/engine.js';
import { GEM_ART, gemAsset } from '../src/client/gems.js';

test('every paying symbol has a distinct shipped RGBA gem with a consistent canvas', () => {
  assert.deepEqual(Object.keys(GEM_ART).sort(), SYMBOLS.map(s => s.id).sort());
  assert.equal(new Set(Object.values(GEM_ART)).size, SYMBOLS.length);
  for (const name of Object.values(GEM_ART)) {
    const png = readFileSync(new URL(`../public/symbols/vlaanderen/${name}.png`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 384);
    assert.equal(png.readUInt32BE(20), 384);
    assert.equal(png[25], 6, `${name} must have an alpha channel`);
  }
});

test('board sprites and both thumbnail sizes resolve to the same replacement, leaving MBP and orbs alone', () => {
  for (let i = 3; i <= 11; i++) {
    const id = `S${String(i).padStart(2, '0')}`;
    const board = gemAsset(id, id);
    assert.ok(board);
    assert.equal(gemAsset('thumbs', id), board);
    assert.equal(gemAsset('thumbs', `${id}M`), board);
  }
  assert.equal(gemAsset('S11', 'S11Revised'), gemAsset('S11', 'S11'));
  for (const [atlas, sprite] of [['S01', 'S01'], ['thumbs', 'S01M'], ['MultGreen', 'MultGreen'], ['GUI', 'S03']]) {
    assert.equal(gemAsset(atlas, sprite), null);
  }
});
