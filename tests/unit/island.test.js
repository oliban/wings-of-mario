import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../src/core/constants.js';
import { getLevel } from '../../src/data/levels/index.js';
import { ISLAND_TOP_Y, localTileToWorld } from '../../src/wings/geo.js';
import { Island } from '../../src/wings/island.js';
import { protectedKeys } from '../../src/wings/sanctuary.js';

const ORIGIN = 3000;
// Rows 13-14 of 1-1 are the solid ground shelf; row 12 is open air/decor.
const GROUND_TX = 20;
const GROUND_TY = 13;

function centreOf(tx, ty) {
  const { x, y } = localTileToWorld(ORIGIN, tx, ty);
  return { x: x + TILE / 2, y: y + TILE / 2 };
}

test('an island reports the upstream level geometry', () => {
  const lvl = getLevel('1-1');
  const isl = new Island(lvl, ORIGIN);
  assert.equal(isl.id, '1-1');
  assert.equal(isl.w, lvl.width);
  assert.equal(isl.h, 15);
  assert.equal(isl.x0, ORIGIN);
  assert.equal(isl.x1, ORIGIN + lvl.width * TILE);
  assert.equal(isl.y0, ISLAND_TOP_Y);
});

test('world-pixel <-> tile mapping round-trips, including at island edges', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  for (const [tx, ty] of [
    [0, 0],
    [1, 1],
    [GROUND_TX, GROUND_TY],
    [isl.w - 1, isl.h - 1],
  ]) {
    const { x, y } = centreOf(tx, ty);
    assert.ok(isl.contains(x, y), `${tx},${ty} should be inside the island band`);
    assert.equal(isl.charAt(tx, ty), isl.rows[ty][tx]);
  }
});

test('solid ground blocks flight and open sky does not', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  const g = centreOf(GROUND_TX, GROUND_TY);
  assert.ok(isl.blocksAt(g.x, g.y));
  const sky = centreOf(GROUND_TX, 4);
  assert.ok(!isl.blocksAt(sky.x, sky.y));
});

test('blocksTile is true for ground, pipes and question blocks, false for decor', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  assert.equal(isl.rows[GROUND_TY][GROUND_TX], '#');
  assert.ok(isl.blocksTile(GROUND_TX, GROUND_TY), 'ground should block');
  assert.equal(isl.rows[9][47], ']');
  assert.ok(isl.blocksTile(47, 9), 'pipe should block');
  assert.equal(isl.rows[9][16], '?');
  assert.ok(isl.blocksTile(16, 9), 'a question block is solid');
  // Decor characters like 'b' (bush) do not block.
  assert.equal(isl.rows[12][11], 'b');
  assert.ok(!isl.blocksTile(11, 12), 'bush should not block');
});

test('a bomb clears ground permanently', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  const g = centreOf(GROUND_TX, GROUND_TY);
  const changed = isl.blast(g.x, g.y, 2);
  assert.ok(changed.length > 0, 'the blast destroyed nothing');
  assert.ok(changed.includes(`${GROUND_TX},${GROUND_TY}`));
  assert.ok(!isl.blocksAt(g.x, g.y));
  assert.equal(isl.charAt(GROUND_TX, GROUND_TY), '.');
});

// This mirrors world.destroyTiles() exactly. If it ever stops matching, the
// pilot's crater and Mario's crater diverge and Plan 3's desync hash fires.
test('a blast records exactly what it destroyed, and air is never recorded', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  const g = centreOf(GROUND_TX, GROUND_TY);
  const changed = isl.blast(g.x, g.y, 3);
  assert.equal(isl.keys().length, changed.length, 'recorded a key it did not destroy');
  for (const key of changed) {
    const [tx, ty] = key.split(',').map(Number);
    assert.ok(!isl.blocksTile(tx, ty), `${key} was reported destroyed but still blocks`);
  }
  // Bombing the same crater again removes nothing new.
  assert.deepEqual(isl.blast(g.x, g.y, 3), []);
});

test('destructibleTile is true for every non-air tile including coins, decor and unknown chars', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  assert.ok(isl.destructibleTile(GROUND_TX, GROUND_TY), 'ground must be destructible');
  assert.ok(!isl.destructibleTile(GROUND_TX, 4), 'air must not be destructible');
  assert.ok(isl.destructibleTile(11, 12), 'a bush is destructible even though it does not block');

  // Fabricate a level with an unrecognised character. World's `_makeRec`
  // tags an unknown char `{ name: 'air', unknown: true }`, and destroyTiles
  // still treats it as destructible, so island.js must too.
  const fake = { id: 'fake-1', width: 4, tiles: ['....', '.Z..', '....', '....'] };
  const isl2 = new Island(fake, ORIGIN);
  assert.ok(isl2.destructibleTile(1, 1), 'an unknown tile char must still be destructible');
  assert.ok(!isl2.blocksTile(1, 1), 'an unknown tile char must not block flight');
});

test('destructible is a wider set than blocking: every blocking tile is destructible', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  // Except the spawn sanctuary, which is the one place a tile both blocks and
  // survives — a bomb still detonates against it, it simply leaves no crater.
  // See src/wings/sanctuary.js.
  const safe = protectedKeys(getLevel('1-1'));
  let protectedBlockers = 0;
  for (let ty = 0; ty < isl.h; ty++) {
    for (let tx = 0; tx < isl.w; tx++) {
      if (!isl.blocksTile(tx, ty)) continue;
      if (safe.has(`${tx},${ty}`)) {
        protectedBlockers++;
        assert.ok(!isl.destructibleTile(tx, ty), `${tx},${ty} is in the sanctuary`);
      } else {
        assert.ok(isl.destructibleTile(tx, ty), `${tx},${ty}`);
      }
    }
  }
  assert.ok(protectedBlockers > 0, '1-1 has no solid ground inside its sanctuary at all');
});

test('damage survives rebuilding the island from its keys', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  const g = centreOf(GROUND_TX, GROUND_TY);
  isl.blast(g.x, g.y, 2);
  const again = new Island(getLevel('1-1'), ORIGIN, isl.keys());
  assert.ok(!again.blocksAt(g.x, g.y));
  assert.deepEqual(again.keys(), isl.keys());
});

test('a fresh island of the same level is undamaged', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  const g = centreOf(GROUND_TX, GROUND_TY);
  isl.blast(g.x, g.y, 2);
  assert.ok(new Island(getLevel('1-1'), ORIGIN).blocksAt(g.x, g.y), 'damage leaked between islands');
});

test('nothing outside the island band exists', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  const g = centreOf(GROUND_TX, GROUND_TY);
  assert.ok(!isl.blocksAt(100, g.y));
  assert.ok(!isl.contains(100, g.y));
  assert.ok(isl.contains(g.x, g.y));
  assert.equal(isl.charAt(-1, 0), '.');
  assert.equal(isl.charAt(0, 99), '.');
});

test('a blast that straddles the island edge only records in-bounds tiles', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  isl.blast(ORIGIN + TILE / 2, ISLAND_TOP_Y + 14 * TILE + TILE / 2, 4);
  for (const key of isl.keys()) {
    const [tx, ty] = key.split(',').map(Number);
    assert.ok(tx >= 0 && ty >= 0 && tx < isl.w && ty < isl.h, `${key} is off the island`);
  }
});

test('keys come back sorted and duplicate-free', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  const g = centreOf(GROUND_TX, GROUND_TY);
  isl.blast(g.x, g.y, 3);
  isl.blast(g.x + 64, g.y, 3);
  const keys = isl.keys();
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(new Set(keys).size, keys.length);
});

test('blasting the same tile twice is idempotent', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  const g = centreOf(GROUND_TX, GROUND_TY);
  isl.blast(g.x, g.y, 2);
  const before = isl.keys();
  isl.blast(g.x, g.y, 2);
  assert.deepEqual(isl.keys(), before);
});
