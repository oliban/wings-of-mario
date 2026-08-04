import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../src/core/constants.js';
import { getLevel } from '../../src/data/levels/index.js';
import { tileForChar } from '../../src/data/tiles.js';
import { release, stepShot, predictImpact } from '../../src/wings/ordnance.js';
import { createPlane, MODE } from '../../src/wings/flight.js';
import {
  TELEGRAPH, DEFAULT_FLOOR_Y, refineImpact, reticleRadius, panFor, edgeArrow, Telegraph,
} from '../../src/wings/telegraph.js';

const LVL = getLevel('1-1');
const FLOOR_Y = LVL.height * TILE; // 240: the bottom of the band, which is sea level

// The first blocking surface in a column, in island-LOCAL pixels. Exactly the
// predicate Island.blocksTile uses — solid or platform — because that is what
// a bomb stops on. Decor ('h' hills, 'c' clouds) is neither.
function surfaceFor(level) {
  return (px) => {
    const tx = Math.floor(px / TILE);
    if (tx < 0 || tx >= level.width) return FLOOR_Y;
    for (let ty = 0; ty < level.height; ty++) {
      const rec = tileForChar(level.tiles[ty][tx]);
      if (rec.solid || rec.platform) return ty * TILE;
    }
    return FLOOR_Y;
  };
}

const surfaceAt = surfaceFor(LVL);

// A bomb let go from straight and level flight at a chosen height and column.
function dropAt(px, py, vx = 0) {
  const p = createPlane({ mode: MODE.AIR, x: px - 18, y: py, speed: Math.abs(vx), gear: false });
  p.vx = vx;
  p.vy = 0;
  p.angle = vx < 0 ? Math.PI : 0;
  return release('bomb', p);
}

// Fly it for real, with the same integrator, until it is at or below the
// surface of whatever column it is over.
function flyIt(shot) {
  const s = { ...shot };
  for (let t = 1; t < 900; t++) {
    stepShot(s);
    if (s.y >= Math.min(surfaceAt(s.x), FLOOR_Y)) return { x: s.x, y: s.y, ticks: t };
  }
  return null;
}

test('1-1 is the level this file thinks it is', () => {
  assert.equal(LVL.height, 15);
  assert.equal(FLOOR_Y, 240);
  // Measured, not assumed: column 30 is open sky down to the ground row, and
  // column 20 is NOT — it is under the first brick run, at row 9.
  assert.equal(surfaceAt(30 * TILE + 8), 13 * TILE, 'column 30 should be open ground');
  assert.equal(surfaceAt(20 * TILE + 8), 9 * TILE, 'column 20 is under a brick run');
  assert.ok(surfaceAt(69 * TILE + 8) >= FLOOR_Y, 'column 69 is the first pit and has no floor');
});

test('a vertical drop is predicted onto the tile it actually hits', () => {
  const shot = dropAt(30 * TILE + 8, 40);
  const mark = refineImpact(shot, surfaceAt, FLOOR_Y);
  const flown = flyIt(shot);
  assert.ok(mark, 'no prediction at all');
  assert.ok(flown, 'the bomb never landed');
  assert.equal(mark.tx, 30, 'predicted the wrong column');
  assert.equal(mark.ty, 13, 'the surface of column 30 is row 13');
  assert.equal(mark.ticks, 54, 'measured: 54 ticks from y=46 to the ground row');
  assert.ok(Math.abs(mark.x - flown.x) < 1e-6, 'prediction and flight must agree to the pixel');
  assert.equal(mark.ticks, flown.ticks);
});

test('a bomb thrown forward is predicted down-range, not under the plane', () => {
  // Columns 3-10 are flat open ground, so a shallow arc across them cannot
  // straddle a step and make the exact-column assertion a coin toss.
  const shot = dropAt(3 * TILE, 20, 1.2);
  const mark = refineImpact(shot, surfaceAt, FLOOR_Y);
  const flown = flyIt(shot);
  assert.ok(mark && flown);
  assert.ok(mark.x > 3 * TILE + 40, 'the bomb inherits the aircraft velocity');
  assert.equal(mark.tx, 7, 'measured: released over column 3, lands on column 7');
  assert.equal(mark.ty, 13);
  assert.equal(mark.tx, Math.floor(flown.x / TILE));
});

test('the refinement lands on the roof, not on the ground under it', () => {
  // Found rather than hard-coded, so a level edit upstream cannot silently
  // turn this into a test of flat ground. In 1-1 today it picks column 22,
  // whose first blocking surface is row 5.
  let col = -1;
  for (let tx = 0; tx < LVL.width && col < 0; tx++) {
    if (surfaceAt(tx * TILE + 8) <= 6 * TILE) col = tx;
  }
  assert.ok(col > 0, 'test premise: 1-1 has something built up above row 6');
  const roof = surfaceAt(col * TILE + 8);
  const mark = refineImpact(dropAt(col * TILE + 8, 20), surfaceAt, FLOOR_Y);
  assert.equal(mark.ty, roof / TILE, 'the reticle must sit on the roof it will hit');
  assert.equal(mark.tx, col, 'a vertical drop must not drift columns');
});

test('over a pit the prediction runs all the way to the sea', () => {
  const mark = refineImpact(dropAt(69 * TILE + 8, 40), surfaceAt, FLOOR_Y);
  assert.ok(mark);
  assert.ok(mark.y >= FLOOR_Y, 'nothing stops a bomb dropped down a hole');
});

test('a shot that never reaches the ground has no mark', () => {
  // A gun round is flat and short-lived: fired level it expires in the air.
  const p = createPlane({ mode: MODE.AIR, x: 0, y: 20, speed: 2.7, gear: false });
  p.vx = 2.7;
  p.vy = 0;
  const round = release('gun', p);
  assert.equal(refineImpact(round, () => 13 * TILE, FLOOR_Y), null);
});

test('refineImpact never calls a second integrator', () => {
  // Same shot, same flat ground: refineImpact must reproduce predictImpact
  // exactly when the first guess is already right.
  const shot = dropAt(30 * TILE + 8, 40);
  const raw = predictImpact(shot, 13 * TILE);
  const mark = refineImpact(shot, () => 13 * TILE, FLOOR_Y);
  assert.equal(mark.x, raw.x);
  assert.equal(mark.y, raw.y);
  assert.equal(mark.ticks, raw.ticks);
});

test('the reticle tightens as the bomb closes', () => {
  const far = reticleRadius(TELEGRAPH.TIGHTEN_TICKS * 2);
  const mid = reticleRadius(TELEGRAPH.TIGHTEN_TICKS / 2);
  const now = reticleRadius(0);
  assert.equal(far, TELEGRAPH.MAX_R, 'anything beyond the tighten window sits at full spread');
  assert.ok(mid < far && mid > now, 'the middle of the window must be in the middle');
  assert.equal(now, TELEGRAPH.MIN_R);
});

test('the whistle pans by the offset from Mario, and saturates', () => {
  assert.equal(panFor(100, 100), 0);
  assert.equal(panFor(100 + TELEGRAPH.PAN_RANGE, 100), 1);
  assert.equal(panFor(100 - TELEGRAPH.PAN_RANGE, 100), -1);
  assert.equal(panFor(100 + TELEGRAPH.PAN_RANGE * 4, 100), 1, 'must clamp, not wrap');
  assert.ok(Math.abs(panFor(100 + TELEGRAPH.PAN_RANGE / 2, 100) - 0.5) < 1e-9);
});

test('a bomb on screen has no edge arrow, one off screen does', () => {
  const cam = { x: 400, y: 0, w: 256, h: 240 };
  assert.equal(edgeArrow(500, 100, cam), null, 'it is right there, in shot');
  const left = edgeArrow(100, 100, cam);
  assert.ok(left);
  assert.equal(left.x, TELEGRAPH.EDGE_MARGIN, 'pinned to the left edge');
  assert.ok(Math.abs(left.angle - Math.PI) < 1e-9, 'pointing left');
  const above = edgeArrow(500, -400, cam);
  assert.equal(above.y, TELEGRAPH.EDGE_MARGIN);
  assert.ok(Math.abs(above.angle + Math.PI / 2) < 1e-9, 'pointing up');
});

test('the tracker follows a bomb from release to impact', () => {
  const tg = new Telegraph({ floorY: FLOOR_Y, surfaceAt });
  const shot = dropAt(30 * TILE + 8, 40);
  tg.add({ id: 'b1', ...shot });
  const flown = flyIt(shot);

  let sawReticle = 0;
  let shrank = true;
  let prevR = Infinity;
  for (let t = 0; t < flown.ticks; t++) {
    tg.step();
    const marks = tg.marks(30 * TILE, { x: 0, y: 0, w: 256, h: 240 });
    if (!marks.length) break;
    const m = marks[0];
    if (m.impact) {
      sawReticle++;
      if (m.radius > prevR + 1e-9) shrank = false;
      prevR = m.radius;
      assert.equal(m.impact.ty, 13, 'the mark must not wander mid-flight');
    }
  }
  assert.ok(sawReticle > 40, `only ${sawReticle} ticks of warning is not a telegraph`);
  assert.ok(shrank, 'the reticle must never grow while the bomb falls');
});

test('the tracker drops a bomb once it has landed, and says so', () => {
  const tg = new Telegraph({ floorY: FLOOR_Y, surfaceAt });
  tg.add({ id: 'b1', ...dropAt(30 * TILE + 8, 40) });
  for (let t = 0; t < 400 && tg.shots.size; t++) tg.step();
  assert.equal(tg.shots.size, 0, 'the bomb is still in the air 400 ticks later');
  const impacts = tg.drain().filter((e) => e.type === 'impact');
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].id, 'b1');
  assert.equal(tg.drain().length, 0, 'drain must empty the queue');
});

test('two bombs are tracked independently', () => {
  const tg = new Telegraph({ floorY: FLOOR_Y, surfaceAt });
  tg.add({ id: 'a', ...dropAt(30 * TILE + 8, 40) });
  tg.add({ id: 'b', ...dropAt(52 * TILE + 8, 120) });
  tg.step();
  const marks = tg.marks(41 * TILE, { x: 0, y: 0, w: 256, h: 240 });
  assert.equal(marks.length, 2);
  assert.ok(marks[0].pan < 0 && marks[1].pan > 0, 'they are on opposite sides of Mario');
  assert.notEqual(marks[0].impact.tx, marks[1].impact.tx);
});

test('sync accepts a correction from the wire without restarting the arc', () => {
  const tg = new Telegraph({ floorY: FLOOR_Y, surfaceAt });
  tg.add({ id: 'a', ...dropAt(30 * TILE + 8, 40) });
  tg.step();
  assert.equal(tg.sync('a', { x: 60 * TILE, y: 60, vx: 0, vy: 1 }), true);
  tg.step();
  const m = tg.marks(0, null)[0];
  assert.equal(m.impact.tx, 60, 'the corrected shot must be predicted from where it now is');
  assert.equal(tg.sync('nope', { x: 0, y: 0, vx: 0, vy: 0 }), false);
});

test('the tracker is deterministic and reads no clock', () => {
  const run = () => {
    const tg = new Telegraph({ floorY: FLOOR_Y, surfaceAt });
    tg.add({ id: 'a', ...dropAt(30 * TILE + 8, 40) });
    tg.add({ id: 'b', ...dropAt(52 * TILE + 8, 30, 1.9) });
    const log = [];
    for (let t = 0; t < 120; t++) {
      tg.step();
      log.push(tg.marks(30 * TILE, { x: 0, y: 0, w: 256, h: 240 }));
    }
    return JSON.stringify(log);
  };
  assert.equal(run(), run());
});

test('the default floor is one island band tall', () => {
  assert.equal(DEFAULT_FLOOR_Y, 15 * TILE);
});
