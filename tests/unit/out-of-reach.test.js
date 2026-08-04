import test from 'node:test';
import assert from 'node:assert/strict';
import { isReachable, marioSnapshot, contactFrom, REACH_SNAP } from '../../src/net/reach.js';
import { Interp } from '../../src/net/interp.js';
import { RADAR, Radar } from '../../src/wings/radar.js';
import { ISLAND_TOP_Y } from '../../src/wings/geo.js';

// Mario's engine loads bonus rooms, pipe interiors, coin heaven and warp zones
// as SUB-AREAS of a level: same level id, a completely different tile map, and
// island-local coordinates that mean something else entirely. The aeroplane
// cannot reach any of them, and projecting a warp-zone position through the
// coordinate contract puts Mario in mid-air over an island he is not standing
// on. So: while he is down there he is not on the pilot's screen at all.

// A stand-in for the engine's world. `areaId` is the engine's own signal —
// world.loadLevel sets it to the area id for a sub-area and null for the main
// level (src/game/world.js), and the engine itself reads it as "am I in a
// sub-area" in src/game/blocks.js.
const world = (over = {}) => ({
  areaId: null,
  lives: 3,
  player: { x: 100, y: 176, vx: 1, vy: 0, facing: 1, power: 0, state: 'run', grounded: true },
  ...over,
});

test('the main level is reachable and a sub-area is not', () => {
  assert.equal(isReachable(world()), true);
  assert.equal(isReachable(world({ areaId: '1-1w' })), false, 'the warp zone is not on the island');
  assert.equal(isReachable(world({ areaId: '1-1b' })), false, 'nor is a coin room');
  assert.equal(isReachable(null), false, 'no world is not a place the plane can reach');
});

test('a snapshot from the main level carries a position', () => {
  const s = marioSnapshot(world(), '1-1');
  assert.equal(s.reach, 1);
  assert.equal(s.x, 100);
  assert.equal(s.y, 176);
  assert.equal(s.island, '1-1');
  assert.equal(s.lives, 3);
});

test('a snapshot from a sub-area carries NO position at all', () => {
  const s = marioSnapshot(world({ areaId: '1-1w' }), '1-1');
  assert.equal(s.reach, 0);
  assert.equal('x' in s, false, 'a warp-zone x is not a place on the island; do not send one');
  assert.equal('y' in s, false);
  // The match still needs the rest of him: which island he will come back up
  // on, and how many lives he has left.
  assert.equal(s.island, '1-1');
  assert.equal(s.lives, 3);
});

test('no player, no snapshot', () => {
  assert.equal(marioSnapshot(world({ player: null }), '1-1'), null);
  assert.equal(marioSnapshot(null, '1-1'), null);
});

test('a reachable snapshot becomes a world-space contact', () => {
  const c = contactFrom({ reach: 1, x: 100, y: 176, facing: -1, island: '1-1' }, 3000);
  assert.deepEqual(c, { x: 3100, y: ISLAND_TOP_Y + 176, facing: -1, island: '1-1' });
});

test('an out-of-reach snapshot becomes no contact', () => {
  assert.equal(contactFrom({ reach: 0, island: '1-1' }, 3000), null);
  // Even if a position somehow rode along, reach is the decision and it is
  // Mario's client's to make.
  assert.equal(contactFrom({ reach: 0, x: 100, y: 176, island: '1-1' }, 3000), null);
});

test('a contact needs an island this pilot has laid out, and a real position', () => {
  assert.equal(contactFrom({ reach: 1, x: 100, y: 176, island: '9-9' }, null), null);
  assert.equal(contactFrom({ reach: 1, island: '1-1' }, 3000), null);
  assert.equal(contactFrom(null, 3000), null);
});

test('a world-space y sent where island-local was expected is caught at the seam', () => {
  assert.throws(
    () => contactFrom({ reach: 1, x: 100, y: ISLAND_TOP_Y + 176, island: '1-1' }, 3000),
    /looks like a WORLD-space y/
  );
});

// -- re-emergence ------------------------------------------------------------

test('coming back up does not slide the contact in from a stale position', () => {
  // He is at local x 100, goes down a pipe for a while, and comes back up at
  // 1800. If the gap were interpolated the pilot would watch him glide 1700px
  // across the island he was never on.
  const interp = new Interp({ snap: REACH_SNAP, delay: 0 });
  interp.push(0, marioSnapshot(world(), '1-1'));
  interp.push(3, marioSnapshot(world({ areaId: '1-1w' }), '1-1'));
  interp.push(6, marioSnapshot(world({ areaId: '1-1w' }), '1-1'));
  const back = world({ player: { ...world().player, x: 1800 } });
  interp.push(9, marioSnapshot(back, '1-1'));

  // Halfway between the last out-of-reach sample and the first one back.
  const mid = interp.sample(7);
  assert.equal(mid.reach, 1, 'reach is discrete: half-reachable is not a thing');
  assert.equal(mid.x, 1800, 'the position must SNAP to where he came up, not lerp to it');
  assert.equal(contactFrom(mid, 3000).x, 4800);

  // And while he is under, there is nothing to draw at any sample point.
  assert.equal(interp.sample(4).reach, 0);
  assert.equal(contactFrom(interp.sample(4), 3000), null);
});

// -- the tube ----------------------------------------------------------------

test('a contact that goes out of reach is gone by the next sweep', () => {
  const r = new Radar({ seed: 3 });
  for (let t = 0; t < RADAR.SWEEP_TICKS; t++) r.step({ x: 5000, y: 400, present: true });
  assert.ok(r.contact(), 'no fix to lose');

  // The antenna swept and found nothing. A fading ghost for the rest of a
  // sweep is honest — the tube is 1.5s stale by design — but once the sweep
  // that saw nothing completes, the tube goes dark rather than showing a
  // five-second-old lie about a man who is underground.
  for (let t = 0; t < RADAR.SWEEP_TICKS - 1; t++) r.step({ present: false });
  assert.ok(r.contact(), 'the ghost should last until the sweep completes');
  r.step({ present: false });
  assert.equal(r.contact(), null, 'a sweep that found nothing must dark the tube');
});

test('the blip comes back on the first sweep after he re-emerges', () => {
  const r = new Radar({ seed: 3 });
  for (let t = 0; t < RADAR.SWEEP_TICKS * 2; t++) r.step({ present: false });
  assert.equal(r.contact(), null);
  for (let t = 0; t < RADAR.SWEEP_TICKS; t++) r.step({ x: 7000, y: 400, present: true });
  const c = r.contact();
  assert.ok(c, 'the tube stayed dark after he came back up');
  assert.ok(Math.abs(c.x - 7000) <= RADAR.FUZZ_PX, 'and it is a fix on where he is NOW');
});
