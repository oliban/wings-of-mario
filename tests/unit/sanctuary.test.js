// The spawn sanctuary: the one place on an island a bomb cannot crater.
//
// Craters are permanent and the pilot can bomb an island before Mario ever
// reaches it, so an unprotected spawn is an unwinnable death loop rather than
// a hard level. These tests pin the shape, the fact that the predicate is a
// pure function of level data (the ONLY reason three separate code paths can
// be trusted to agree), and that every shipped level actually resolves one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../src/core/constants.js';
import { LEVELS, getLevel } from '../../src/data/levels/index.js';
import { ISLAND_TOP_Y, localTileToWorld } from '../../src/wings/geo.js';
import { Island } from '../../src/wings/island.js';
import { blastTiles } from '../../src/wings/blast.js';
import {
  SANCTUARY, spawnPoints, sanctuaryRects, protectedKeys, isProtected,
  isProtectedKey, filterProtected, filterProtectedForIsland, guardWorld,
} from '../../src/wings/sanctuary.js';

const ORIGIN = 3000;

function centreOf(tx, ty) {
  const { x, y } = localTileToWorld(ORIGIN, tx, ty);
  return { x: x + TILE / 2, y: y + TILE / 2 };
}

test('the sanctuary is a strip around the spawn column, running to the map floor', () => {
  const lvl = getLevel('1-1');
  const rects = sanctuaryRects(lvl);
  assert.equal(rects.length, 1, '1-1 has one spawn and no checkpoint');
  assert.deepEqual(rects[0], {
    x0: lvl.spawn.x - SANCTUARY.left,
    x1: lvl.spawn.x + SANCTUARY.right,
    y0: lvl.spawn.y - SANCTUARY.above,
    y1: lvl.tiles.length - 1,
  });
  // Five columns wide: run-up to the right, one tile of margin to the left.
  assert.equal(rects[0].x1 - rects[0].x0 + 1, SANCTUARY.left + SANCTUARY.right + 1);
});

test('the tile Mario spawns on, and the ground under it, are protected', () => {
  const lvl = getLevel('1-1');
  const { x, y } = lvl.spawn;
  assert.ok(isProtected(lvl, x, y), 'the spawn tile itself');
  assert.ok(isProtected(lvl, x, y + 1), 'the ground under his feet');
  assert.ok(isProtected(lvl, x, lvl.tiles.length - 1), 'the bottom row of the map');
  assert.ok(isProtected(lvl, x - SANCTUARY.left, y), 'the left margin');
  assert.ok(isProtected(lvl, x + SANCTUARY.right, y), 'the far end of the run-up');
  assert.ok(!isProtected(lvl, x + SANCTUARY.right + 1, y), 'one column too far');
  assert.ok(!isProtected(lvl, x, y - SANCTUARY.above - 1), 'one row too high');
  assert.ok(!isProtected(lvl, 100, 13), 'the middle of the level is fair game');
});

test('the strip is clipped to the map, so a spawn near an edge protects no phantom tiles', () => {
  const lvl = { id: 'edge', width: 6, tiles: ['......', '......', '######'], spawn: { x: 0, y: 0 } };
  const [r] = sanctuaryRects(lvl);
  assert.deepEqual(r, { x0: 0, x1: SANCTUARY.right, y0: 0, y1: 2 });
  for (const key of protectedKeys(lvl)) {
    const [tx, ty] = key.split(',').map(Number);
    assert.ok(tx >= 0 && ty >= 0 && tx < lvl.width && ty < lvl.tiles.length, key);
  }
});

test('a level with no usable spawn protects nothing rather than throwing', () => {
  assert.equal(protectedKeys({ id: 'x', width: 4, tiles: ['....'] }).size, 0);
  assert.equal(protectedKeys(null).size, 0);
  assert.equal(spawnPoints({ id: 'x', spawn: { x: 'left', y: 3 } }).length, 0);
  assert.deepEqual(filterProtected(null, ['1,1']), ['1,1']);
});

test('a midway checkpoint is a spawn too, and gets its own strip', () => {
  const lvl = {
    id: 'cp', width: 40, tiles: Array.from({ length: 15 }, () => '.'.repeat(40)),
    spawn: { x: 2, y: 12 }, checkpoint: { x: 20, y: 12 },
  };
  assert.equal(sanctuaryRects(lvl).length, 2);
  assert.ok(isProtected(lvl, 20, 13), 'the ground under the checkpoint');
  assert.ok(!isProtected(lvl, 12, 13), 'and nothing in between');
});

// -----------------------------------------------------------------------
// The pilot's side
// -----------------------------------------------------------------------

test('a blast centred on the spawn destroys nothing, and the same blast one crater over still works', () => {
  const lvl = getLevel('1-1');
  const isl = new Island(lvl, ORIGIN);
  const c = centreOf(lvl.spawn.x, lvl.spawn.y + 1);
  assert.deepEqual(isl.blast(c.x, c.y, 2), [], 'the spawn floor cratered');
  assert.equal(isl.keys().length, 0, 'a protected key was recorded as destroyed');
  // Still solid, still lethal to fly into: only the CRATER is refused.
  assert.ok(isl.blocksTile(lvl.spawn.x, lvl.spawn.y + 1));

  const far = centreOf(40, 13);
  assert.ok(isl.blast(far.x, far.y, 2).length > 0, 'ordinary ground must still go');
});

test('a blast straddling the sanctuary takes the unprotected half and only that', () => {
  const lvl = getLevel('1-1');
  const isl = new Island(lvl, ORIGIN);
  const edge = lvl.spawn.x + SANCTUARY.right; // last protected column
  const c = centreOf(edge, 13);
  const changed = isl.blast(c.x, c.y, 3);
  assert.ok(changed.length > 0, 'the blast should still have taken the far side');
  for (const key of changed) assert.ok(!isProtectedKey(lvl, key), `${key} was protected`);
  // Everything the raw blast reached that ISN'T protected did go.
  const raw = blastTiles(c.x - ORIGIN, c.y - ISLAND_TOP_Y, 3);
  const missed = raw.filter((k) => {
    const [tx, ty] = k.split(',').map(Number);
    return !isProtectedKey(lvl, k) && isl.inRange(tx, ty) && lvl.tiles[ty][tx] !== '.'
      && !changed.includes(k);
  });
  assert.deepEqual(missed, [], 'the sanctuary swallowed tiles outside itself');
});

test('every shipped level and sub-area resolves a spawn inside its own map', () => {
  const bad = [];
  const walk = (lvl, id, areaId) => {
    const name = areaId ? `${id}/${areaId}` : id;
    const pts = spawnPoints(lvl);
    if (!pts.length) bad.push(`${name}: no spawn`);
    for (const p of pts) {
      if (p.x < 0 || p.y < 0 || p.x >= lvl.width || p.y >= lvl.tiles.length) {
        bad.push(`${name}: spawn ${p.x},${p.y} is outside a ${lvl.width}x${lvl.tiles.length} map`);
      }
    }
    if (!protectedKeys(lvl).size) bad.push(`${name}: protects no tiles`);
    if (lvl.areas) for (const k of Object.keys(lvl.areas)) walk(lvl.areas[k], id, k);
  };
  for (const id of Object.keys(LEVELS)) walk(LEVELS[id], id, null);
  assert.deepEqual(bad, []);
});

test('every shipped island keeps something SOLID inside its sanctuary', () => {
  // A strip of pure air would satisfy the predicate and still drop Mario into
  // the sea, so this asserts the rule actually protects ground he can land on.
  const thin = [];
  for (const [id, lvl] of Object.entries(LEVELS)) {
    const isl = new Island(lvl, ORIGIN);
    let solid = 0;
    for (const key of protectedKeys(lvl)) {
      const [tx, ty] = key.split(',').map(Number);
      if (isl.blocksTile(tx, ty)) solid++;
    }
    // 2-2 and 7-2 spawn Mario swimming: water is not a solid tile and there is
    // nothing to stand on, so they are the documented exception.
    if (!solid && !['2-2', '7-2'].includes(id)) thin.push(`${id}: sanctuary is all air`);
  }
  assert.deepEqual(thin, []);
});

// -----------------------------------------------------------------------
// Mario's side: the guard around the engine's destroyTiles()
// -----------------------------------------------------------------------

// A stand-in for World: the engine cannot be imported outside a browser, and
// all the guard needs of it is `level` and `destroyTiles`.
function fakeWorld(level) {
  return {
    level,
    seen: [],
    destroyTiles(keys) {
      this.seen.push(...keys);
      return keys;
    },
  };
}

test('guardWorld filters protected keys out of every destroyTiles call, blast included', () => {
  const lvl = getLevel('1-1');
  const w = fakeWorld(lvl);
  assert.equal(guardWorld(w), true);
  assert.equal(guardWorld(w), false, 'installing twice would double-filter and confuse a reader');

  const spawnKey = `${lvl.spawn.x},${lvl.spawn.y + 1}`;
  const out = w.destroyTiles([spawnKey, '100,13']);
  assert.deepEqual(out, ['100,13']);
  assert.deepEqual(w.seen, ['100,13'], 'a protected key reached the engine');
});

test('the guard follows the world into the next level rather than the one it was installed on', () => {
  const w = fakeWorld(getLevel('1-1'));
  guardWorld(w);
  w.level = getLevel('4-1'); // spawn x=5, not x=2
  assert.deepEqual(w.destroyTiles(['5,13']), [], "4-1's own spawn column should be protected");
  assert.deepEqual(w.destroyTiles(['2,13']), ['2,13'], "1-1's column is nothing special here");
});

// -----------------------------------------------------------------------
// The server's entry point
// -----------------------------------------------------------------------

test('filterProtectedForIsland resolves the level from the island id', () => {
  const lvl = getLevel('1-1');
  const spawnKey = `${lvl.spawn.x},${lvl.spawn.y + 1}`;
  assert.deepEqual(filterProtectedForIsland('1-1', [spawnKey, '100,13']), ['100,13']);
  // An island id nobody knows protects nothing — the room still records the
  // keys, which is better than dropping a real crater on a level we mis-named.
  assert.deepEqual(filterProtectedForIsland('nope', [spawnKey]), [spawnKey]);
});
