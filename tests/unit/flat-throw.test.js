import test from 'node:test';
import assert from 'node:assert/strict';

import {
  standstillLaunch, isStandingThrow, dropToFloor, fallAfter, guardThrow,
  REACH_TILES, MIN_FLIGHT_TICKS, STILL_EPS,
} from '../../src/wings/flat-throw.js';

// The climb the engine gives a standing throw (THROW_POWER_MIN, straight up).
// KEPT by the solver rather than replaced — see the note in flat-throw.js.
const VY0 = -5.2;

// THE STANDING THROW, solved rather than tuned by eye.
//
// Upstream's launch is a pure function of Mario's SPEED: straight up at a
// standstill, so the row of bricks forms over his head. That is the one throw a
// stranded man can make — he is on the lip of a chasm and cannot run at it
// without running into it — so this fork lobs it three tiles ahead at the level
// of the ground he is standing on.
//
// The bomb's gravity, taken from src/game/entities/brickbomb.js. Passed in
// rather than imported: that module builds its sprites at load and wants a
// canvas, and these tests are plain Node.
const G = 0.42;
const TILE = 16;

// The integrator the bomb actually uses, reproduced here so the assertions are
// against the engine's arithmetic and not against the solver's own idea of it.
// BrickBomb#step adds gravity to vy BEFORE moving, so the fall after F frames is
// F*vy0 + g*F*(F+1)/2 and NOT the textbook F*vy0 + g*F²/2.
const flyOut = (vx, vy0, frames) => {
  let x = 0;
  let y = 0;
  let vy = vy0;
  for (let i = 0; i < frames; i++) {
    vy += G;
    x += vx;
    y += vy;
  }
  return { x, y };
};

test('the fall matches the engine\'s own integrator, not the textbook one', () => {
  for (const vy0 of [-3, -2.88, 0, 1.5]) {
    for (const f of [1, 5, 18, 30]) {
      assert.ok(
        Math.abs(fallAfter(vy0, f, G) - flyOut(0, vy0, f).y) < 1e-9,
        `vy0 ${vy0}, ${f} frames`
      );
    }
  }
  // And it is NOT the textbook form — several pixels out over a real flight,
  // which at sixteen pixels to the tile is a whole row wrong about half the
  // time.
  const textbook = 27 * -2.88 + 0.5 * G * 27 * 27;
  assert.ok(Math.abs(fallAfter(-2.88, 27, G) - textbook) > 3);
});

test('the bomb lands three tiles ahead, at the floor, when the fuse ends', () => {
  const drop = 24;
  const l = standstillLaunch({ drop, vy0: VY0, facing: 1, gravity: G });
  const end = flyOut(l.vx, l.vy, l.fuse);
  assert.ok(Math.abs(end.x - REACH_TILES * TILE) < 0.5,
    `landed ${(end.x / TILE).toFixed(2)} tiles out, want ${REACH_TILES}`);
  // Within half a tile of the floor row: the fuse is a whole number of frames,
  // so the last one overshoots a little and that is the whole error budget.
  assert.ok(Math.abs(end.y - drop) < TILE * 0.5,
    `ended ${end.y.toFixed(1)}px below the hand, want ${drop}`);
});

test('the engine\'s own climb is kept, because it is what clears the lip', () => {
  // THE BUG THIS PINS. The first version solved for vy too and threw the bomb
  // at -2.99 instead of -5.2. A brick bomb detonates on touching ANYTHING, so
  // that one never got clear of the ground it was thrown beside: it struck a
  // solid on the very first frame and puffed, every time.
  for (const drop of [8, 24, 64]) {
    assert.equal(standstillLaunch({ drop, vy0: VY0, gravity: G }).vy, VY0);
  }
});

test('it is a lob: it rises well clear, then comes down', () => {
  const l = standstillLaunch({ drop: 24, vy0: VY0, gravity: G });
  assert.ok(l.vy < 0, 'the bomb was thrown downward');
  let peak = 0;
  for (let f = 1; f <= l.fuse; f++) peak = Math.min(peak, flyOut(l.vx, l.vy, f).y);
  assert.ok(peak < -TILE, `the arc only rose ${(-peak).toFixed(1)}px: it will clip the lip`);
});

test('facing left is the mirror of facing right', () => {
  const r = standstillLaunch({ drop: 24, vy0: VY0, facing: 1, gravity: G });
  const l = standstillLaunch({ drop: 24, vy0: VY0, facing: -1, gravity: G });
  assert.equal(l.vx, -r.vx);
  assert.equal(l.vy, r.vy);
  assert.equal(l.fuse, r.fuse);
});

test('a deeper drop stays three tiles out, it just takes longer', () => {
  // The reach is the reach: throwing down onto a lower floor must not fling the
  // row out past the gap it is meant to bridge.
  const shallow = standstillLaunch({ drop: 8, vy0: VY0, gravity: G });
  const deep = standstillLaunch({ drop: 64, vy0: VY0, gravity: G });
  assert.ok(deep.fuse > shallow.fuse, 'the longer fall did not burn a longer fuse');
  for (const l of [shallow, deep]) {
    const end = flyOut(l.vx, l.vy, l.fuse);
    assert.ok(Math.abs(end.x - REACH_TILES * TILE) < 0.5,
      `landed ${(end.x / TILE).toFixed(2)} tiles out`);
  }
});

test('nonsense in, nothing out', () => {
  assert.equal(standstillLaunch({ drop: NaN, vy0: VY0, gravity: G }), null);
  assert.equal(standstillLaunch({ drop: 10, vy0: VY0, gravity: undefined }), null);
  assert.equal(standstillLaunch({ drop: 10, vy0: NaN, gravity: G }), null);
  assert.equal(standstillLaunch(), null);
});

// ---- who it applies to ----------------------------------------------------

test('standing still on his feet is a standing throw', () => {
  assert.equal(isStandingThrow({ grounded: true, vx: 0 }), true);
  assert.equal(isStandingThrow({ grounded: true, vx: STILL_EPS / 2 }), true);
  assert.equal(isStandingThrow({ grounded: true, vx: -STILL_EPS / 2 }), true);
});

test('a throw with a run behind it is upstream\'s and is left alone', () => {
  // The fifteen-tile flat throw is good and is not this rule's business.
  assert.equal(isStandingThrow({ grounded: true, vx: 2.5 }), false);
  assert.equal(isStandingThrow({ grounded: true, vx: -2.5 }), false);
  assert.equal(isStandingThrow({ grounded: true, vx: STILL_EPS }), false);
});

test('a throw in mid-air is left alone', () => {
  // Upstream already fixed the jumping throw by inheriting his vertical speed;
  // overriding it here would undo that.
  assert.equal(isStandingThrow({ grounded: false, vx: 0 }), false);
  assert.equal(isStandingThrow(null), false);
  assert.equal(isStandingThrow({}), false);
});

test('the drop is measured to the middle of the floor row', () => {
  // The bricks form on the bomb's OWN tile row, so it has to arrive inside the
  // row he is standing on — its middle, not its top edge, or a pixel of
  // rounding puts the row one place out.
  const owner = { y: 13 * TILE - 16, h: 16 }; // feet on row 13
  const bomb = { y: 13 * TILE - 16 - 10, h: 12 };
  const drop = dropToFloor(owner, bomb, TILE);
  const bombCentreAtEnd = bomb.y + bomb.h / 2 + drop;
  assert.equal(Math.floor(bombCentreAtEnd / TILE), 13, 'the bomb does not end on row 13');
});

// ---- the wrap -------------------------------------------------------------

const fakeWorld = () => {
  const world = {
    spawned: [],
    spawn(type, x, y, o) {
      // Upstream's standstill launch: straight up, fuse to the apex.
      const e = {
        isBrickBomb: type === 'brickbomb',
        owner: o && o.owner,
        facing: 1,
        x, y, h: 12,
        vx: 0,
        vy: -5.2,
        fuse: 12,
      };
      world.spawned.push(e);
      return e;
    },
  };
  return world;
};

test('the wrap redirects a standing throw and nothing else', () => {
  const w = fakeWorld();
  assert.equal(guardThrow(w, { gravity: G, tileSize: TILE }), true);

  const still = { grounded: true, vx: 0, y: 13 * TILE - 16, h: 16 };
  const bomb = w.spawn('brickbomb', 0, 0, { owner: still });
  assert.notEqual(bomb.vx, 0, 'a standing throw still goes straight up');
  assert.equal(bomb.vy, -5.2, 'the engine\'s climb was overwritten');
  assert.notEqual(bomb.fuse, 12, 'the fuse still ends at the apex');

  const running = { grounded: true, vx: 2.5, y: 13 * TILE - 16, h: 16 };
  const fast = w.spawn('brickbomb', 0, 0, { owner: running });
  assert.equal(fast.vx, 0, 'upstream\'s running throw was overwritten');
  assert.equal(fast.vy, -5.2);
  assert.equal(fast.fuse, 12);
});

test('anything that is not a brick bomb passes straight through', () => {
  const w = fakeWorld();
  guardThrow(w, { gravity: G, tileSize: TILE });
  const goomba = w.spawn('goomba', 0, 0, { owner: { grounded: true, vx: 0, y: 0, h: 16 } });
  assert.equal(goomba.vx, 0);
  assert.equal(goomba.vy, -5.2);
});

test('a bomb with no owner is left exactly as upstream made it', () => {
  // world.spawn('brickbomb') from a level or a probe: there is nobody to
  // measure, and guessing would be worse than doing nothing.
  const w = fakeWorld();
  guardThrow(w, { gravity: G, tileSize: TILE });
  const e = w.spawn('brickbomb', 0, 0, {});
  assert.equal(e.vx, 0);
  assert.equal(e.fuse, 12);
});

test('the wrap is installed once, however often it is asked for', () => {
  const w = fakeWorld();
  assert.equal(guardThrow(w, { gravity: G }), true);
  assert.equal(guardThrow(w, { gravity: G }), false);
  assert.equal(guardThrow(w, { gravity: G }), false);
});
