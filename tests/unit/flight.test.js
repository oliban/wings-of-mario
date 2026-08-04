import test from 'node:test';
import assert from 'node:assert/strict';
import { CEILING_Y, DECK_X0, DECK_X1, DECK_Y, PLANE_H } from '../../src/wings/geo.js';
import {
  FLIGHT, MODE, createPlane, stepPlane, normalizeAngle, turnToward, nosePoint,
} from '../../src/wings/flight.js';

const FULL = { thrust: 1, pitch: 0 };

// Hold full thrust East (the plane starts facing East, so this accelerates),
// and pull back the moment there is flying speed.
function rotateOff(p) {
  let t = 0;
  while (p.mode !== MODE.AIR && t < 600) {
    stepPlane(p, { thrust: 1, pitch: p.speed >= FLIGHT.TAKEOFF_SPEED ? 1 : 0 });
    t++;
  }
  return t;
}

// Thrust against the current heading, until the stall turn arms. Capped, not
// an unbounded while loop, so a regression that stops it triggering at all is
// a clear assertion failure instead of a hung test.
function brakeToTurn(p, thrust, maxTicks = 300) {
  let t = 0;
  while (p.turnTicks == null && t < maxTicks) {
    stepPlane(p, { thrust, pitch: 0 });
    t++;
  }
  assert.ok(p.turnTicks != null, `never triggered a stall turn within ${maxTicks} ticks`);
  return t;
}

// Ride an already-armed turn out to completion. Capped for the same reason.
function rideTurnOut(p, thrust, maxTicks = 200) {
  let t = 0;
  while (p.turnTicks != null && t < maxTicks) {
    stepPlane(p, { thrust, pitch: 0 });
    t++;
  }
  assert.equal(p.turnTicks, null, `the turn never finished within ${maxTicks} ticks`);
  return t;
}

test('normalizeAngle folds into (-PI, PI]', () => {
  assert.equal(normalizeAngle(0), 0);
  assert.ok(Math.abs(normalizeAngle(Math.PI * 3) - Math.PI) < 1e-9);
  assert.ok(Math.abs(normalizeAngle(Math.PI * 2 + 0.5) - 0.5) < 1e-9);
});

test('turnToward snaps on arrival and crosses the seam the short way', () => {
  assert.ok(Math.abs(turnToward(0, 0.05, 0.1) - 0.05) < 1e-9, 'should snap');
  const stepped = turnToward(3.0, -3.0, 0.1);
  assert.ok(stepped > 3.0 || stepped < -3.0, 'must cross +/-PI, not go the long way');
});

test('a fresh plane is spotted on the deck with the hook down', () => {
  const p = createPlane();
  assert.equal(p.mode, MODE.DECK);
  assert.equal(p.speed, 0);
  assert.equal(p.angle, 0);
  assert.equal(p.gear, true);
  assert.equal(p.y, DECK_Y - PLANE_H);
  assert.ok(p.x >= DECK_X0 && p.x < DECK_X1);
  assert.equal(p.fuel, FLIGHT.FUEL_MAX);
  assert.equal(p.turnTicks, null, 'a fresh plane should not be mid-turn');
});

// Verified: rotation at tick 133, having used 180px of the 320px deck.
test('the takeoff roll builds speed and uses real deck', () => {
  const p = createPlane();
  const startX = p.x;
  const ticks = rotateOff(p);
  assert.equal(p.mode, MODE.AIR, 'never got airborne');
  assert.ok(ticks > 60 && ticks < 300, `rotation at tick ${ticks} is not a roll`);
  assert.ok(p.x < DECK_X1, 'ran off the bow instead of rotating');
  assert.ok(p.x - startX > 80, 'used almost no deck');
  assert.ok(p.speed >= FLIGHT.TAKEOFF_SPEED);
  assert.equal(p.gear, false, 'the hook should come up on rotation');
});

test('pulling back below flying speed does not leave the deck', () => {
  const p = createPlane();
  for (let i = 0; i < 40; i++) stepPlane(p, { thrust: 1, pitch: 1 });
  assert.ok(p.speed < FLIGHT.TAKEOFF_SPEED, 'test premise: still below rotation speed');
  assert.notEqual(p.mode, MODE.AIR);
  assert.equal(p.y, DECK_Y - PLANE_H, 'the plane left the deck early');
});

// Verified: 106 ticks, back to level, net drift 38px. Pitch alone can still
// complete a full loop — reversing direction no longer NEEDS one, but nothing
// stops a player from still flying one, so this must keep working. Thrust
// tracks whichever way the nose currently points, the way a player actually
// flying the loop would hold it, rather than fighting itself on the far side.
test('a loop is still a loop: held pitch comes all the way back round', () => {
  const p = createPlane({ mode: MODE.AIR, x: 1000, y: 200, speed: 2.7, gear: false });
  let turned = 0;
  let prev = p.angle;
  let ticks = 0;
  while (Math.abs(turned) < Math.PI * 2 && ticks < 500) {
    const thrust = Math.cos(p.angle) >= 0 ? 1 : -1;
    stepPlane(p, { thrust, pitch: 1 });
    assert.equal(p.turnTicks, null, 'a powered loop must not trip the stall turn');
    turned += normalizeAngle(p.angle - prev);
    prev = p.angle;
    ticks++;
  }
  assert.ok(Math.abs(turned) >= Math.PI * 2, 'never completed a loop');
  assert.ok(ticks > 40 && ticks < 300, `a loop taking ${ticks} ticks is not Wings of Fury`);
  assert.ok(Math.abs(normalizeAngle(p.angle)) < 0.2, 'did not come back to level');
  assert.ok(Math.abs(p.x - 1000) < 400, 'the loop should be a loop, not a lap');
});

test('turn authority falls off with speed — you cannot loop when slow', () => {
  const fast = createPlane({ mode: MODE.AIR, x: 0, y: 200, speed: 3.0, gear: false });
  const slow = createPlane({ mode: MODE.AIR, x: 0, y: 200, speed: 0.9, gear: false });
  for (let i = 0; i < 10; i++) {
    stepPlane(fast, { thrust: 1, pitch: 1 });
    stepPlane(slow, { thrust: 1, pitch: 1 });
  }
  assert.ok(Math.abs(fast.angle) > Math.abs(slow.angle), 'speed must buy turn rate');
});

test('climbing bleeds speed and diving builds it', () => {
  // No thrust either way, so this isolates GRAVITY's effect on airspeed —
  // and neither plane is travelling against its own facing, so neither trips
  // the stall turn.
  const up = createPlane({ mode: MODE.AIR, x: 0, y: 400, speed: 2.7, angle: -Math.PI / 2, gear: false });
  const down = createPlane({ mode: MODE.AIR, x: 0, y: 100, speed: 2.7, angle: Math.PI / 2, gear: false });
  for (let i = 0; i < 60; i++) {
    stepPlane(up, { thrust: 0, pitch: 0 });
    stepPlane(down, { thrust: 0, pitch: 0 });
  }
  assert.ok(up.speed < 2.7, 'a vertical climb must cost speed');
  assert.ok(down.speed > 3.0, 'a vertical dive must build speed');
  assert.ok(down.speed <= FLIGHT.MAX_SPEED, 'speed must be capped');
});

test('a stall drops the nose whatever the stick says', () => {
  const p = createPlane({ mode: MODE.AIR, x: 0, y: 200, speed: 0.1, angle: -Math.PI / 2, gear: false });
  for (let i = 0; i < 120; i++) stepPlane(p, { thrust: 0, pitch: 1 });
  assert.ok(p.angle > 0, `a stalled nose should fall, angle is ${p.angle}`);
  assert.ok(p.y > 200, 'a stall must cost altitude');
});

test('a deliberate brake toward a stall turn does not also trigger the accidental-stall nose-drop', () => {
  // The two low-speed mechanics must not fight: braking toward zero on
  // purpose should hold the aeroplane level right up to the turn itself, not
  // have the stall-recovery pull already dragging the nose down first.
  const p = createPlane({ mode: MODE.AIR, x: 0, y: 300, speed: 2.69, angle: 0, gear: false });
  let t = 0;
  while (p.turnTicks == null && t < 300) {
    stepPlane(p, { thrust: -1, pitch: 0 });
    assert.equal(p.angle, 0, 'the nose should stay level while deliberately braking, not fall early');
    t++;
  }
  assert.ok(p.turnTicks != null, 'never triggered a stall turn within 300 ticks');
});

test('the ceiling caps the climb and levels the nose', () => {
  const p = createPlane({ mode: MODE.AIR, x: 0, y: CEILING_Y + 4, speed: 2.7, angle: -0.5, gear: false });
  for (let i = 0; i < 200; i++) stepPlane(p, { thrust: 1, pitch: 1 });
  assert.ok(p.y >= CEILING_Y, 'the plane climbed through the ceiling');
  const a = Math.abs(normalizeAngle(p.angle));
  assert.ok(a < 0.2 || Math.abs(a - Math.PI) < 0.2, 'the nose should be level at the ceiling');
});

// Verified: 7143 ticks, about 119 seconds.
test('fuel burns down monotonically and cuts the engine when dry', () => {
  const p = createPlane({ mode: MODE.AIR, x: 0, y: 200, speed: 2.7, gear: false });
  let prev = p.fuel;
  let ticks = 0;
  while (p.fuel > 0 && ticks < 40000) {
    stepPlane(p, FULL);
    assert.ok(p.fuel <= prev, 'fuel went up');
    prev = p.fuel;
    ticks++;
  }
  assert.equal(p.fuel, 0);
  assert.ok(ticks > 60 * 60, `a ${(ticks / 60.0988).toFixed(0)}s sortie is too short`);
  for (let i = 0; i < 30; i++) stepPlane(p, FULL);
  assert.equal(p.throttle, 0, 'a dry tank must ignore thrust');
});

test('the nose leads the hitbox', () => {
  const p = createPlane({ mode: MODE.AIR, x: 100, y: 100, speed: 2, angle: 0, gear: false });
  assert.ok(nosePoint(p).x > p.x + 12, 'nose should be ahead when flying right');
  p.angle = Math.PI;
  assert.ok(nosePoint(p).x < p.x + 12, 'nose should be behind when flying left');
});

// ---------------------------------------------------------------------------
// Thrust is a world-frame direction, not a lever: holding the arrow that
// agrees with the current heading accelerates, holding the one that disagrees
// decelerates, and idle just coasts down under drag. These replace the old
// rampThrottle lever tests — there is no lever position left to test, thrust
// is applied directly every tick.
// ---------------------------------------------------------------------------

test('thrust that agrees with the heading accelerates toward level cruise', () => {
  // Level cruise (THRUST balancing DRAG, ~5.39 px/f) is the equilibrium in
  // level flight — MAX_SPEED is a clamp, NOT what level thrust settles at and
  // in fact not something the aeroplane can reach at all (a vertical dive
  // tops out at 8.16 against a clamp of 9.0), so that is what this checks
  // approach to. sqrt(THRUST/DRAG) rather than a bare number, because those
  // two constants are what the figure IS: hard-coding 5.39 here would let a
  // change to either of them silently redefine cruise without failing.
  const p = createPlane({ mode: MODE.AIR, x: 0, y: 200, speed: 1, angle: 0, gear: false });
  const before = p.speed;
  for (let i = 0; i < 30; i++) stepPlane(p, { thrust: 1, pitch: 0 });
  assert.ok(p.speed > before, 'facing East, thrusting East should build speed');
  for (let i = 0; i < 3000; i++) stepPlane(p, { thrust: 1, pitch: 0 });
  // Drag is applied to the speed AFTER thrust has gone in, so the fixed point
  // is sqrt(T/D) - T rather than sqrt(T/D): one tick of thrust always sits
  // above the equilibrium waiting to be dragged back off.
  const cruise = Math.sqrt(FLIGHT.THRUST / FLIGHT.DRAG) - FLIGHT.THRUST;
  assert.ok(Math.abs(p.speed - cruise) < 0.05, `should settle near level cruise ${cruise.toFixed(2)}, got ${p.speed}`);
  assert.ok(p.speed <= FLIGHT.MAX_SPEED, 'must not exceed MAX_SPEED');
});

test('thrust that disagrees with the heading decelerates faster than idling does', () => {
  const braking = createPlane({ mode: MODE.AIR, x: 0, y: 200, speed: 2.69, angle: 0, gear: false });
  const idling = createPlane({ mode: MODE.AIR, x: 0, y: 200, speed: 2.69, angle: 0, gear: false });
  const before = braking.speed;
  for (let i = 0; i < 10; i++) {
    stepPlane(braking, { thrust: -1, pitch: 0 });
    stepPlane(idling, { thrust: 0, pitch: 0 });
  }
  assert.ok(braking.speed < before, 'facing East, thrusting West should bleed speed, not build it');
  assert.ok(braking.speed < idling.speed, 'thrusting against the heading is a brake, not the same as letting off');
});

test('idle thrust just coasts under drag — it is neither a lever holding position nor a brake', () => {
  const p = createPlane({ mode: MODE.AIR, x: 0, y: 200, speed: 1, angle: 0, gear: false });
  for (let i = 0; i < 100; i++) stepPlane(p, { thrust: 0, pitch: 0 });
  assert.ok(p.speed < 1, 'unlike the old lever, releasing both arrows should not hold speed steady');
  assert.ok(p.speed > 0, 'and unlike braking, idling alone at low speed should not run it to zero');
});

// ---------------------------------------------------------------------------
// The stall turn: the actual mechanic the user asked for. Hold the arrow
// against your direction of travel; when speed reaches zero still holding it,
// the aeroplane wings over onto the new heading, loses a bit of altitude, and
// is already flying — under the same held key — the new way.
// ---------------------------------------------------------------------------

test('braking against the heading to zero triggers a stall turn, not a dead stop', () => {
  const p = createPlane({ mode: MODE.AIR, x: 0, y: 300, speed: 2.69, angle: 0, gear: false });
  brakeToTurn(p, -1);
  assert.equal(p.turnTicks, 0, 'the turn should arm the tick it reaches zero');
  assert.equal(p.speed, 0, 'test premise: speed should be exactly zero at the trigger');
});

test('a stall turn ends level, facing the other way, and already accelerating under the same held key', () => {
  for (const [startAngle, thrust] of [[0, 1], [Math.PI, -1]]) {
    const p = createPlane({ mode: MODE.AIR, x: 500, y: 300, speed: 2.69, angle: startAngle, gear: false });
    brakeToTurn(p, -thrust);
    rideTurnOut(p, -thrust);
    assert.ok(Math.abs(normalizeAngle(p.angle - (startAngle + Math.PI))) < 0.05,
      `start ${startAngle}: should end facing the reverse heading, angle is ${p.angle}`);
    assert.ok(p.speed > 0, `start ${startAngle}: should exit the turn already moving, not dead in the air`);

    // Keep holding the SAME key: it should now be the accelerator.
    const before = p.speed;
    for (let i = 0; i < 30; i++) stepPlane(p, { thrust: -thrust, pitch: 0 });
    assert.ok(p.speed > before, `start ${startAngle}: the same held key should now accelerate the new way`);
  }
});

test('a stall turn costs a bit of altitude, felt but not fatal', () => {
  const p = createPlane({ mode: MODE.AIR, x: 0, y: 300, speed: 2.69, angle: 0, gear: false });
  const y0 = p.y;
  brakeToTurn(p, -1);
  rideTurnOut(p, -1);
  const sink = p.y - y0;
  // The cost is not a constant — it is the straight-down dip integrated over
  // the length of the manoeuvre, so lengthening the turn raised it from ~11px
  // to ~31px on purpose. The upper bound is what keeps that honest: a
  // reversal at flight-deck height (y 500) must still come out above the sea
  // at 560, or the manoeuvre stops being usable where it matters most.
  assert.ok(sink > 15, `a stall turn this slow should cost real height, not ${sink.toFixed(1)}px`);
  assert.ok(sink < 48, `a stall turn that costs ${sink.toFixed(1)}px cannot be flown off the deck`);
});

test('a stall turn drifts forward rather than pivoting on the spot', () => {
  // A half-turn that dips symmetrically through world-straight-down nets to
  // almost no HORIZONTAL displacement by the time it is done — that is just
  // the geometry of a wingover, real ones do it too — so "drifts, does not
  // pivot" has to be checked mid-manoeuvre, not by the finishing x position.
  const p = createPlane({ mode: MODE.AIR, x: 500, y: 300, speed: 2.69, angle: 0, gear: false });
  brakeToTurn(p, -1);
  const x0 = p.x;
  let maxExcursion = 0;
  while (p.turnTicks != null) {
    stepPlane(p, { thrust: -1, pitch: 0 });
    maxExcursion = Math.max(maxExcursion, Math.abs(p.x - x0));
  }
  assert.ok(maxExcursion > 5, `the aeroplane should carry real drift mid-manoeuvre (saw ${maxExcursion.toFixed(1)}px), not pivot in place`);
});

test('a stall turn reads as a manoeuvre, not a snap or a cutscene', () => {
  const p = createPlane({ mode: MODE.AIR, x: 0, y: 300, speed: 2.69, angle: 0, gear: false });
  brakeToTurn(p, -1);
  const ticks = rideTurnOut(p, -1);
  // A full second is the floor, asked for by name: below it the eye reads a
  // sprite flipping rather than an aeroplane swinging its nose through the
  // vertical. 60.0988 is the fixed timestep, so a tick count is a duration.
  assert.ok(ticks > 60.0988, `a ${ticks}-tick turn (${(ticks / 60.0988).toFixed(2)}s) is a snap, not a manoeuvre — this must take over a second`);
  assert.ok(ticks < 110, `a ${ticks}-tick turn is a cutscene, not something you can do constantly`);
});

test('a stall turn always dips through world-straight-down at its midpoint, whichever way it started', () => {
  // This is what makes every reversal cost altitude consistently, rather than
  // alternately diving or climbing depending on which way the player happened
  // to be facing when they triggered it.
  for (const [startAngle, thrust] of [[0, 1], [Math.PI, -1]]) {
    const p = createPlane({ mode: MODE.AIR, x: 0, y: 300, speed: 2.69, angle: startAngle, gear: false });
    brakeToTurn(p, -thrust);
    let sawDive = false;
    while (p.turnTicks != null) {
      stepPlane(p, { thrust: -thrust, pitch: 0 });
      if (Math.abs(normalizeAngle(p.angle - Math.PI / 2)) < 0.1) sawDive = true;
    }
    assert.ok(sawDive, `start ${startAngle}: never passed through straight down`);
  }
});

test('the manoeuvre commits once triggered — releasing or fighting the stick mid-turn changes nothing', () => {
  const p = createPlane({ mode: MODE.AIR, x: 0, y: 300, speed: 2.69, angle: 0, gear: false });
  brakeToTurn(p, -1);
  let ticks = 0;
  // Let go of thrust entirely and lean on pitch, as a player bailing out of
  // the manoeuvre halfway through might.
  while (p.turnTicks != null && ticks < 200) {
    stepPlane(p, { thrust: 0, pitch: 1 });
    ticks++;
  }
  assert.ok(ticks < 200, 'the turn never completed despite the interference');
  assert.ok(Math.abs(normalizeAngle(p.angle - Math.PI)) < 0.05, 'should still land exactly on the reverse heading');
});

test('a stall turn is exposed for the renderer to drive its roll from', () => {
  const p = createPlane({ mode: MODE.AIR, x: 0, y: 300, speed: 2.69, angle: 0, gear: false });
  assert.equal(p.turnTicks, null, 'not turning yet');
  brakeToTurn(p, -1);
  assert.equal(p.turnTicks, 0, 'should be at the very start of the turn');
  assert.equal(p.turnStartAngle, 0);
  assert.ok(Math.abs(p.turnDelta) === Math.PI, 'the sweep is always a half turn');
  let last = -1;
  let ticks = 0;
  while (p.turnTicks != null && ticks < 200) {
    stepPlane(p, { thrust: -1, pitch: 0 });
    if (p.turnTicks != null) {
      assert.ok(p.turnTicks > last, 'turnTicks should count up monotonically');
      last = p.turnTicks;
    }
    ticks++;
  }
  assert.equal(p.turnTicks, null, 'should clear once the manoeuvre ends');
});

test('the model is deterministic', () => {
  const tape = [];
  for (let i = 0; i < 400; i++) tape.push({ thrust: (i % 7 ? 1 : 0) * ((i >> 5) % 2 ? -1 : 1), pitch: ((i >> 4) % 3) - 1 });
  const run = () => {
    const p = createPlane();
    for (const step of tape) stepPlane(p, step);
    return JSON.stringify(p);
  };
  assert.equal(run(), run());
});
