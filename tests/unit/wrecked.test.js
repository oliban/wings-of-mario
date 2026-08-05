import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cannonStanding, silenceCannons, pipeGone, clearOrphanPlants, Wrecked,
} from '../../src/wings/wrecked.js';

// WHAT A BOMBED TILE TAKES WITH IT.
//
// "cannons destroyed should not shoot bullets still, pipes destroyed should not
// have snakes coming out of them any longer."
//
// Neither emitter is the engine's fault: both read the tile map ONCE, because
// upstream's terrain never changes under them. Cannons#reset scans every column
// at level load; a piranha plant looks for its pipe lip the first time it needs
// one and caches it. Ours is a game where the ground goes away.

const CANNON = { cannon: true, solid: true };
const GROUND = { solid: true };
const AIR = {};

// A world with the two things this file reaches into: a tile map that can be
// bombed, and an entity list. Small enough to read, real enough to be wrong
// against — the same shapes src/game/entities/cannons.js and piranha.js use.
const fakeWorld = (over = {}) => {
  const w = 20;
  const h = 10;
  const world = {
    w,
    h,
    level: { id: '1-1' },
    map: new Uint8Array(w * h),
    recByCode: { 0: AIR, 1: GROUND, 2: CANNON },
    entities: [],
    cannons: { all: [], table: new Array(8).fill(null) },
    solidAt(px, py) {
      const tx = Math.floor(px / 16);
      const ty = Math.floor(py / 16);
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
      const rec = this.recByCode[this.map[ty * w + tx]];
      return !!(rec && rec.solid);
    },
    ...over,
  };
  return world;
};

const putCannon = (world, tx, ty) => {
  world.map[ty * world.w + tx] = 2;
  const c = { tx, ty, x: tx * 16, y: ty * 16, timer: 0 };
  world.cannons.all.push(c);
  return c;
};

const bomb = (world, tx, ty) => { world.map[ty * world.w + tx] = 0; };

// ---- cannons --------------------------------------------------------------

test('a cannon still standing is left alone', () => {
  const w = fakeWorld();
  const c = putCannon(w, 5, 4);
  w.cannons.table[0] = c;
  assert.equal(cannonStanding(w, c), true);
  assert.equal(silenceCannons(w), 0);
  assert.equal(c.timer, 0, 'a standing cannon was silenced');
  assert.equal(w.cannons.table[0], c, 'a standing cannon was taken out of the ring');
});

test('a cannon whose tile has been bombed can never fire again', () => {
  const w = fakeWorld();
  const c = putCannon(w, 5, 4);
  w.cannons.table[0] = c;
  bomb(w, 5, 4);

  assert.equal(cannonStanding(w, c), false);
  assert.equal(silenceCannons(w), 1);
  // The ring is what FireCannon rolls against, and an empty slot is the
  // engine's own idea of a cannon that is not there.
  assert.equal(w.cannons.table[0], null, 'the wrecked cannon is still in the ring');
  // And the timer can never reach a shot: `if (c.timer > 0) { c.timer--; }`.
  assert.equal(c.timer, Infinity);
  assert.ok(c.timer - 1 > 0, 'the countdown can be finished');
});

test('walking back past a wreck does not revive it', () => {
  // THE BUG A RING SWEEP ALONE WOULD LEAVE. Cannons#_register copies an entry
  // out of `all` and resets its timer as the camera scrolls onto it, so
  // clearing the ring would silence a wrecked cannon only until the player
  // walked back and forth.
  const w = fakeWorld();
  const c = putCannon(w, 5, 4);
  bomb(w, 5, 4);
  silenceCannons(w);

  // What _register does, verbatim.
  c.timer = 0;
  w.cannons.table[3] = c;

  silenceCannons(w);
  assert.equal(w.cannons.table[3], null, 'a re-registered wreck stayed in the ring');
  assert.equal(c.timer, Infinity);
});

test('bombing one cannon leaves the others firing', () => {
  const w = fakeWorld();
  const a = putCannon(w, 3, 4);
  const b = putCannon(w, 9, 4);
  w.cannons.table[0] = a;
  w.cannons.table[1] = b;
  bomb(w, 3, 4);

  assert.equal(silenceCannons(w), 1);
  assert.equal(w.cannons.table[0], null);
  assert.equal(w.cannons.table[1], b, 'an untouched cannon was silenced too');
  assert.equal(b.timer, 0);
});

test('a level with no cannons is not a crash', () => {
  assert.equal(silenceCannons(fakeWorld()), 0);
  assert.equal(silenceCannons({}), 0);
  assert.equal(silenceCannons(null), 0);
  assert.equal(cannonStanding(null, null), false);
  assert.equal(cannonStanding(fakeWorld(), { tx: 999, ty: 999 }), false, 'off the map is not a cannon');
});

// ---- piranha plants -------------------------------------------------------

const plant = (world, tx, ty) => {
  const e = { type: 'piranha', x: tx * 16, mouthY: ty * 16, removed: false,
    remove() { this.removed = true; } };
  world.entities.push(e);
  return e;
};

test('a plant in a pipe that is still there keeps going', () => {
  const w = fakeWorld();
  w.map[4 * w.w + 6] = 1; // the pipe lip
  const p = plant(w, 6, 4);
  assert.equal(pipeGone(w, p), false);
  assert.equal(clearOrphanPlants(w), 0);
  assert.equal(p.removed, false);
});

test('a plant whose pipe has been bombed is taken out', () => {
  const w = fakeWorld();
  w.map[4 * w.w + 6] = 1;
  const p = plant(w, 6, 4);
  bomb(w, 6, 4);

  assert.equal(pipeGone(w, p), true);
  assert.equal(clearOrphanPlants(w), 1);
  assert.equal(p.removed, true, 'the plant is still rising out of thin air');
});

test('a plant that has not found its lip yet is left to find it', () => {
  // mouthY is null until _anchor runs. A plant with no anchor is not yet a
  // plant with a missing one, and removing it here would delete every plant on
  // the frame the level loads.
  const w = fakeWorld();
  const p = plant(w, 6, 4);
  p.mouthY = null;
  assert.equal(pipeGone(w, p), false);
  assert.equal(clearOrphanPlants(w), 0);
  assert.equal(p.removed, false);
});

test('only plants are touched', () => {
  const w = fakeWorld();
  const goomba = { type: 'goomba', x: 96, mouthY: 64, removed: false, remove() { this.removed = true; } };
  w.entities.push(goomba);
  bomb(w, 6, 4);
  assert.equal(clearOrphanPlants(w), 0);
  assert.equal(goomba.removed, false, 'a goomba was removed as an orphaned plant');
});

test('an already-removed plant is not removed twice', () => {
  const w = fakeWorld();
  const p = plant(w, 6, 4);
  p.removed = true;
  assert.equal(clearOrphanPlants(w), 0);
});

// ---- the sweep ------------------------------------------------------------

test('the sweep does both, every tick, off state and not an edge', () => {
  // Driven off state rather than a damage event because an edge can be missed:
  // a crater arrives from a local blast, from the wire, or from a whole set
  // replayed on a level load. "This cannon is not there any more" cannot be
  // missed.
  const w = fakeWorld();
  const c = putCannon(w, 5, 4);
  w.cannons.table[0] = c;
  w.map[4 * w.w + 6] = 1;
  const p = plant(w, 6, 4);

  const sweep = new Wrecked();
  assert.equal(sweep.step(w), false, 'an undamaged level reported wreckage');

  bomb(w, 5, 4);
  bomb(w, 6, 4);
  assert.equal(sweep.step(w), true);
  assert.equal(w.cannons.table[0], null);
  assert.equal(p.removed, true);
  assert.equal(sweep.hushed, 1);
  assert.equal(sweep.pulled, 1);

  // And it stays silenced on every later tick, without counting the plant
  // twice.
  assert.equal(sweep.step(w), true);
  assert.equal(sweep.pulled, 1, 'the same plant was pulled twice');
});

test('the sweep survives a world with nothing in it', () => {
  const sweep = new Wrecked();
  assert.equal(sweep.step(null), false);
  assert.equal(sweep.step({}), false);
  assert.equal(sweep.step({ level: { id: '1-1' } }), false);
});
