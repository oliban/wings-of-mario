import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SupplyDrop, dropSpot, fallProgress,
  FALL_TICKS, REST_TICKS, FADE_TICKS, FALL_HEIGHT_PX, SIDE_TILES, PHASE,
} from '../../src/wings/supply-drop.js';
import { TILE } from '../../src/core/constants.js';

// THE USER'S COMPLAINT: "the parcel drops on the character so I can't even see
// it". Everything here is about the two halves of the fix — that there is
// something on screen for long enough to read, and that it comes down BESIDE
// him rather than behind his own sprite.
//
// The art is looked at with tools/sheet.mjs, which is the only way to judge
// pixels. This is the half that can be judged in numbers: where the crate is on
// every tick of the fall, and when the goods change hands.

const SEC = 60.0988;

test('the fall is about a second, which is what makes it readable', () => {
  // Not a flash. Under about forty ticks and a drop reads as a pop-in; this is
  // the number the whole feature turns on, so it is pinned rather than trusted.
  assert.ok(FALL_TICKS / SEC > 0.85 && FALL_TICKS / SEC < 1.3, `${FALL_TICKS} ticks`);
  // And it is on screen a while longer, so the player can look at what landed.
  assert.ok((FALL_TICKS + REST_TICKS + FADE_TICKS) / SEC > 2);
});

test('it starts above the top of the screen and ends exactly on the ground', () => {
  // 240 is the whole screen. A crate that appeared inside the view would be a
  // pop-in with a fall bolted on, which is the thing being replaced.
  assert.ok(FALL_HEIGHT_PX > 240, `${FALL_HEIGHT_PX}px is not a full screen`);
  assert.equal(fallProgress(0), 0);
  assert.equal(fallProgress(FALL_TICKS), 1);
  assert.equal(fallProgress(FALL_TICKS + 50), 1, 'it does not keep going after it lands');
});

test('it falls, then the canopy takes the load and it decelerates', () => {
  // The shape of the curve is the whole reading of "parachute": free weight
  // first, then a snap, then a slowing descent onto the ground.
  const at = (t) => fallProgress(t);
  const step = (t) => at(t + 1) - at(t);

  for (let t = 1; t < FALL_TICKS - 1; t++) {
    assert.ok(at(t) > at(t - 1), `the crate stalled at tick ${t}`);
  }
  // Fastest somewhere in the first third — the free fall before the bloom.
  const early = step(8);
  const late = step(FALL_TICKS - 4);
  assert.ok(early > late * 3, `no deceleration: ${early} then ${late}`);
  // And it arrives gently rather than slamming into the last frame.
  assert.ok(late < 2, `${late} px per tick at the landing is not a parachute`);
});

test('the landing is announced exactly once, on the tick it touches down', () => {
  const drop = new SupplyDrop();
  drop.begin(100, 200);
  let landings = 0;
  let landedAt = null;
  for (let t = 1; t <= FALL_TICKS + REST_TICKS + FADE_TICKS + 30; t++) {
    if (drop.step() === 'landed') {
      landings++;
      landedAt = t;
    }
  }
  assert.equal(landings, 1, 'the goods would change hands more than once');
  assert.equal(landedAt, FALL_TICKS);
});

test('the crate comes down where it was aimed, and nowhere near where it started', () => {
  const drop = new SupplyDrop();
  drop.begin(100, 200);
  const first = drop.state();
  assert.equal(first.x, 100);
  assert.equal(first.y, 200 - FALL_HEIGHT_PX, 'it did not start above the screen');

  for (let t = 0; t < FALL_TICKS; t++) drop.step();
  const down = drop.state();
  assert.equal(down.phase, PHASE.REST);
  assert.equal(down.x, 100, 'the sway did not damp out and it landed off target');
  assert.equal(down.y, 200);
});

test('it sways under the canopy, because a crate on a string is not a lift', () => {
  const drop = new SupplyDrop();
  drop.begin(100, 200);
  const off = [];
  for (let t = 1; t < FALL_TICKS; t++) {
    drop.step();
    off.push(drop.state().x - 100);
  }
  const worst = (from, to) => Math.max(...off.slice(from, to).map(Math.abs));

  assert.ok(new Set(off).size > 2, 'the crate came straight down like a lift');
  assert.ok(worst(0, off.length) <= 4, 'it swung further out than it was ever meant to');

  // AND THE SWAY DAMPS OUT. The last frame of the fall and the first frame on
  // the ground are consecutive frames of one animation, and the ground frame is
  // drawn at the landing point exactly: a crate still swinging on the tick
  // before it lands jumps sideways on the tick it touches down, which reads as
  // a glitch rather than as a landing.
  const early = worst(2, 20);
  const late = worst(off.length - 16, off.length);
  assert.ok(early >= 2, `it barely swayed at all: ${early}px`);
  assert.ok(late < early, `the swing never damped: ${early}px early, ${late}px at the landing`);
  assert.ok(Math.abs(off[off.length - 1]) <= 1, 'it touched down off its own aim point');
});

test('it is drawn, then it sits, then it fades, then there is nothing', () => {
  const drop = new SupplyDrop();
  drop.begin(0, 0);
  assert.equal(drop.state().phase, PHASE.FALL);
  for (let t = 0; t < FALL_TICKS; t++) drop.step();
  assert.equal(drop.state().phase, PHASE.REST);
  assert.equal(drop.state().alpha, 1);
  for (let t = 0; t < REST_TICKS; t++) drop.step();
  assert.equal(drop.state().phase, PHASE.FADE);
  assert.ok(drop.state().alpha < 1 && drop.state().alpha > 0);
  for (let t = 0; t < FADE_TICKS; t++) drop.step();
  assert.equal(drop.state(), null, 'the crate is litter now');
  assert.equal(drop.active, false);
});

test('nothing is drawn before one is sent', () => {
  const drop = new SupplyDrop();
  assert.equal(drop.state(), null);
  assert.equal(drop.step(), null, 'a drop nobody asked for cannot land');
});

test('cancelling in flight stops the landing; cancelling after it has landed is not a loss', () => {
  const flying = new SupplyDrop();
  flying.begin(0, 0);
  flying.step();
  assert.equal(flying.cancel(), true, 'a crate in the air was not reported as lost');
  assert.equal(flying.state(), null);

  const down = new SupplyDrop();
  down.begin(0, 0);
  for (let t = 0; t < FALL_TICKS; t++) down.step();
  assert.equal(down.cancel(), false, 'a crate that already handed over its goods is not a loss');
});

test('a crate lands beside him, on the side away from the chasm', () => {
  // The whole point of the fix: on his head it is behind his own sprite, which
  // is what the user could not see.
  const grid = { w: 40, h: 15, solid: (tx, ty) => ty >= 12 };
  const spot = dropSpot(grid, { tx: 20, ty: 12, dir: -1 });
  assert.equal(spot.tx, 20 - SIDE_TILES);
  assert.equal(spot.ty, 12);
  assert.equal(spot.fallback, false);
});

test('it never lands in the hole it was sent to answer', () => {
  // Ground everywhere except a chasm to his right and, awkwardly, a second one
  // immediately to his left: the crate must find the ground it can, and end up
  // on his own column rather than in either hole.
  const holed = (tx, ty) => ty >= 12 && !(tx >= 21 && tx <= 30) && !(tx >= 16 && tx <= 19);
  const grid = { w: 40, h: 15, solid: holed };
  const spot = dropSpot(grid, { tx: 20, ty: 12, dir: -1 });
  assert.equal(spot.tx, 20, 'the crate was dropped into a crater');
  assert.equal(spot.fallback, true);
});

test('a wall beside him is not a landing site either', () => {
  // Solid at his row AND at head height is a wall face, not a lip: a crate
  // dropped there would land on top of the wall, out of reach and out of sight.
  const grid = {
    w: 40,
    h: 15,
    solid: (tx, ty) => ty >= 12 || (tx === 18 && ty >= 9),
  };
  const spot = dropSpot(grid, { tx: 20, ty: 12, dir: -1 });
  assert.equal(spot.tx, 19, 'it should step in towards him rather than climb the wall');
});

test('the edge of the map is not a landing site', () => {
  const grid = { w: 40, h: 15, solid: (tx, ty) => ty >= 12 };
  const spot = dropSpot(grid, { tx: 1, ty: 12, dir: -1 });
  assert.equal(spot.tx >= 0, true, `off the map at ${spot.tx}`);
});

test('the flight is counted in ticks and nothing else', () => {
  // Two drops stepped the same number of times are in the same place, whatever
  // the wall clock did in between. This is the property src/wings/sail.js's
  // fade has and for the same reason: a screenshot at tick N is reproducible.
  const a = new SupplyDrop();
  const b = new SupplyDrop();
  a.begin(50, 100);
  b.begin(50, 100);
  for (let t = 0; t < 30; t++) a.step();
  for (let t = 0; t < 30; t++) b.step();
  assert.deepEqual(a.state(), b.state());
});

test('a crate lands on the top of the tile it was aimed at', () => {
  const drop = new SupplyDrop();
  drop.beginAtTile(10, 12);
  for (let t = 0; t < FALL_TICKS; t++) drop.step();
  const s = drop.state();
  assert.equal(s.y, 12 * TILE, 'the crate is buried in the ground or floating over it');
  assert.equal(s.x, 10 * TILE + TILE / 2, 'it is not centred on its column');
});
