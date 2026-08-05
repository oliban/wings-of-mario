import test from 'node:test';
import assert from 'node:assert/strict';

import { seedToolbeltBlocks, ToolbeltSeeder } from '../../src/wings/toolbelt-blocks.js';

// THE TOOLBELT IN THE QUESTION BLOCKS, outside Harry mode.
//
// Upstream gates its seeding on `world.harryMode`, and src/game/blocks.js is
// engine: the diff against upstream is exactly 150 lines across three files and
// none of them is that one. So this fork calls the engine's own seeding with
// the flag held true across the call and put back afterwards.
//
// The fake below is the shape that matters: a world with a block system whose
// seeding refuses unless harryMode is true, which is upstream's rule. There is
// a browser test that runs it against the real engine.
const fakeWorld = (opts = {}) => {
  const world = {
    areaId: opts.areaId || null,
    harryMode: opts.harryMode === true,
    levelId: opts.levelId || '1-1',
    level: { id: opts.levelId || '1-1' },
    tick: opts.tick == null ? 10 : opts.tick,
    blocks: {
      toolTiles: new Set(),
      calls: 0,
      sawHarry: [],
      _pickToolbeltTiles() {
        this.calls++;
        this.sawHarry.push(world.harryMode);
        this.toolTiles.clear();
        // Upstream's first line, reproduced: outside Harry mode it clears and
        // returns, which is what leaves an ordinary game with no toolbelt.
        if (world.harryMode !== true) return;
        if (world.areaId) return;
        this.toolTiles.add('10,9');
        this.toolTiles.add('20,9');
      },
    },
  };
  return world;
};

test('an ordinary game gets the toolbelt blocks Harry would have had', () => {
  const w = fakeWorld();
  assert.equal(w.harryMode, false);
  assert.equal(seedToolbeltBlocks(w), true);
  assert.deepEqual([...w.blocks.toolTiles], ['10,9', '20,9']);
});

test('the flag is true for the call and false again afterwards', () => {
  // The whole trick, and the thing that must not leak: harryMode also decides
  // the hero's name and whether 100 coins is a 1UP. It is on for exactly one
  // function call.
  const w = fakeWorld();
  seedToolbeltBlocks(w);
  assert.deepEqual(w.blocks.sawHarry, [true], 'the seeding did not see Harry mode');
  assert.equal(w.harryMode, false, 'the game was left in Harry mode');
});

test('a real Harry game is left exactly as it was', () => {
  const w = fakeWorld({ harryMode: true });
  seedToolbeltBlocks(w);
  assert.equal(w.harryMode, true, 'Harry stopped being Harry');
});

test('a throw in the engine cannot strand the game in Harry mode', () => {
  // The reason the restore is in a `finally`: leaving it on would quietly cost
  // the player his 1UPs at 100 coins for the rest of the run.
  const w = fakeWorld();
  w.blocks._pickToolbeltTiles = () => { throw new Error('upstream blew up'); };
  assert.throws(() => seedToolbeltBlocks(w), /upstream blew up/);
  assert.equal(w.harryMode, false, 'the game was left in Harry mode after a throw');
});

test('a sub-area keeps its coin blocks', () => {
  // The engine's own rule for the same seeding: a bonus room's coin blocks stay
  // coin blocks. Refused here rather than relying on upstream's check, so the
  // two agree even if the caller changes.
  const w = fakeWorld({ areaId: '1-1b' });
  assert.equal(seedToolbeltBlocks(w), false);
  assert.equal(w.blocks.calls, 0, 'the sub-area was seeded anyway');
});

test('seeding twice does not re-roll which blocks hold it', () => {
  // Idempotent, so a second hook or a stray call cannot move the toolbelt out
  // from under a player walking towards it.
  const w = fakeWorld();
  seedToolbeltBlocks(w);
  assert.equal(seedToolbeltBlocks(w), false);
  assert.equal(w.blocks.calls, 1);
});

test('nothing to seed without a block system', () => {
  assert.equal(seedToolbeltBlocks(null), false);
  assert.equal(seedToolbeltBlocks({}), false);
  assert.equal(seedToolbeltBlocks({ blocks: {} }), false);
});

// ---- the edge that says a new map is standing there ----------------------

test('a level load seeds, and standing still does not', () => {
  const s = new ToolbeltSeeder();
  const w = fakeWorld();
  assert.equal(s.step(w), true, 'the first level was not seeded');
  assert.equal(s.seeded, 1);
  w.tick += 1;
  assert.equal(s.step(w), false, 'seeded again without a new map');
  assert.equal(s.seeded, 1);
});

test('a new level seeds again', () => {
  const s = new ToolbeltSeeder();
  s.step(fakeWorld({ levelId: '1-1' }));
  const next = fakeWorld({ levelId: '1-2' });
  assert.equal(s.step(next), true, '1-2 got no toolbelt');
  assert.equal(s.seeded, 2);
});

test('a death seeds again, because the level was rebuilt under him', () => {
  // World.loadLevel puts the tick back to 0, which is the only in-band signal a
  // hook on the timestep gets — the same one src/wings/parcel.js reads.
  const s = new ToolbeltSeeder();
  const w = fakeWorld({ tick: 500 });
  s.step(w);
  w.tick = 0;
  w.blocks.toolTiles.clear(); // what the engine's own reset does
  assert.equal(s.step(w), true, 'the rebuilt level has no toolbelt in it');
});

test('going down a pipe and coming back does not lose the belt blocks', () => {
  const s = new ToolbeltSeeder();
  const w = fakeWorld();
  s.step(w);
  // Into the coin room: a different map, and one that gets nothing.
  w.areaId = '1-1b';
  w.blocks.toolTiles.clear();
  assert.equal(s.step(w), false);
  // Back out: the main map is rebuilt, so it is seeded again.
  w.areaId = null;
  assert.equal(s.step(w), true);
});
