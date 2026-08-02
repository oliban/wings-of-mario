import test from 'node:test';
import assert from 'node:assert/strict';
import { tileKey, parseTileKey, blastTiles } from '../../src/wings/blast.js';

test('tileKey round-trips through parseTileKey', () => {
  assert.equal(tileKey(3, 11), '3,11');
  assert.deepEqual(parseTileKey('3,11'), { tx: 3, ty: 11 });
  assert.deepEqual(parseTileKey('-2,0'), { tx: -2, ty: 0 });
});

test('a one-tile blast centred in a tile clears a plus shape', () => {
  // Centre of tile (0,0) is pixel (8,8). Radius 1 tile = 16px.
  // Orthogonal neighbours sit exactly 16px away (included);
  // diagonals sit 22.6px away (excluded).
  const keys = blastTiles(8, 8, 1);
  assert.deepEqual(keys.sort(), ['-1,0', '0,-1', '0,0', '0,1', '1,0'].sort());
});

test('blast radius scales with tiles', () => {
  const small = blastTiles(8, 8, 1);
  const large = blastTiles(8, 8, 3);
  assert.ok(large.length > small.length);
  for (const k of small) assert.ok(large.includes(k), `${k} missing from larger blast`);
});

test('blast is deterministic and duplicate-free', () => {
  const a = blastTiles(137, 92, 2.5);
  const b = blastTiles(137, 92, 2.5);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});

test('a zero radius clears nothing but the centre tile is not assumed', () => {
  // Detonating exactly on a tile corner with zero radius touches no tile centre.
  assert.deepEqual(blastTiles(0, 0, 0), []);
});
