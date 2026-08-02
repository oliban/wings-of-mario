import test from 'node:test';
import assert from 'node:assert/strict';
import { CEILING_Y, DECK_X0, DECK_X1, DECK_Y, PLANE_H } from '../../src/wings/geo.js';
import {
  FLIGHT, MODE, createPlane, stepPlane, normalizeAngle, turnToward, nosePoint, rampThrottle,
} from '../../src/wings/flight.js';

const FULL = { throttle: 1, pitch: 0 };

// Hold full throttle, and pull back the moment there is flying speed.
function rotateOff(p) {
  let t = 0;
  while (p.mode !== MODE.AIR && t < 600) {
    stepPlane(p, { throttle: 1, pitch: p.speed >= FLIGHT.TAKEOFF_SPEED ? 1 : 0 });
    t++;
  }
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
  for (let i = 0; i < 40; i++) stepPlane(p, { throttle: 1, pitch: 1 });
  assert.ok(p.speed < FLIGHT.TAKEOFF_SPEED, 'test premise: still below rotation speed');
  assert.notEqual(p.mode, MODE.AIR);
  assert.equal(p.y, DECK_Y - PLANE_H, 'the plane left the deck early');
});

// Verified: 105 ticks, back to level, net drift 36px.
test('turning is a loop: held pitch comes all the way back round', () => {
  const p = createPlane({ mode: MODE.AIR, x: 1000, y: 200, speed: 2.7, gear: false });
  let turned = 0;
  let prev = p.angle;
  let ticks = 0;
  while (Math.abs(turned) < Math.PI * 2 && ticks < 500) {
    stepPlane(p, { throttle: 1, pitch: 1 });
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
    stepPlane(fast, { throttle: 1, pitch: 1 });
    stepPlane(slow, { throttle: 1, pitch: 1 });
  }
  assert.ok(Math.abs(fast.angle) > Math.abs(slow.angle), 'speed must buy turn rate');
});

test('climbing bleeds speed and diving builds it', () => {
  const up = createPlane({ mode: MODE.AIR, x: 0, y: 400, speed: 2.7, angle: -Math.PI / 2, gear: false });
  const down = createPlane({ mode: MODE.AIR, x: 0, y: 100, speed: 2.7, angle: Math.PI / 2, gear: false });
  for (let i = 0; i < 60; i++) {
    stepPlane(up, FULL);
    stepPlane(down, FULL);
  }
  assert.ok(up.speed < 2.7, 'a vertical climb must cost speed');
  assert.ok(down.speed > 3.5, 'a vertical dive must build speed');
  assert.ok(down.speed <= FLIGHT.MAX_SPEED, 'speed must be capped');
});

test('a stall drops the nose whatever the stick says', () => {
  const p = createPlane({ mode: MODE.AIR, x: 0, y: 200, speed: 0.1, angle: -Math.PI / 2, gear: false });
  for (let i = 0; i < 120; i++) stepPlane(p, { throttle: 0, pitch: 1 });
  assert.ok(p.angle > 0, `a stalled nose should fall, angle is ${p.angle}`);
  assert.ok(p.y > 200, 'a stall must cost altitude');
});

test('the ceiling caps the climb and levels the nose', () => {
  const p = createPlane({ mode: MODE.AIR, x: 0, y: CEILING_Y + 4, speed: 2.7, angle: -0.5, gear: false });
  for (let i = 0; i < 200; i++) stepPlane(p, { throttle: 1, pitch: 1 });
  assert.ok(p.y >= CEILING_Y, 'the plane climbed through the ceiling');
  const a = Math.abs(normalizeAngle(p.angle));
  assert.ok(a < 0.2 || Math.abs(a - Math.PI) < 0.2, 'the nose should be level at the ceiling');
});

// Verified: 7143 ticks, about 119 seconds.
test('fuel burns down monotonically and cuts the throttle when dry', () => {
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
  assert.equal(p.throttle, 0, 'a dry tank must ignore the throttle');
});

test('the nose leads the hitbox', () => {
  const p = createPlane({ mode: MODE.AIR, x: 100, y: 100, speed: 2, angle: 0, gear: false });
  assert.ok(nosePoint(p).x > p.x + 12, 'nose should be ahead when flying right');
  p.angle = Math.PI;
  assert.ok(nosePoint(p).x < p.x + 12, 'nose should be behind when flying left');
});

test('the throttle lever advances and retards continuously, not as a switch', () => {
  let t = 0;
  for (let i = 0; i < 10; i++) t = rampThrottle(t, 1);
  assert.ok(t > 0 && t < 1, `10 ticks of Right should be a partial advance, got ${t}`);
  assert.ok(Math.abs(t - 10 * FLIGHT.THROTTLE_RAMP) < 1e-9, 'advance should be linear in ticks held');
});

test('the throttle lever retards symmetrically', () => {
  let t = 0.5;
  const before = t;
  t = rampThrottle(t, -1);
  assert.ok(t < before, 'Left should reduce throttle');
  assert.ok(Math.abs((before - t) - FLIGHT.THROTTLE_RAMP) < 1e-9, 'one tick of Left is one ramp step');
});

test('the throttle lever holds position with no key held — it is a lever, not a spring', () => {
  let t = 0.37;
  for (let i = 0; i < 50; i++) t = rampThrottle(t, 0);
  assert.equal(t, 0.37, 'throttle drifted with no input');
});

test('the throttle lever clamps at both ends', () => {
  let t = 0;
  for (let i = 0; i < 500; i++) t = rampThrottle(t, -1);
  assert.equal(t, 0, 'throttle went below idle');
  for (let i = 0; i < 500; i++) t = rampThrottle(t, 1);
  assert.equal(t, 1, 'throttle went past full');
});

test('a sustained pitch reverses heading from due east to due west, at more than one starting speed', () => {
  // Cruise (2.7, the level-flight equilibrium) and a slow approach speed
  // (1.2, inside the carrier's landing envelope) both must come around.
  for (const speed of [2.7, 1.2]) {
    const p = createPlane({ mode: MODE.AIR, x: 0, y: 200, speed, angle: 0, gear: false });
    let ticks = 0;
    let facedWest = -1;
    while (ticks < 300 && facedWest < 0) {
      stepPlane(p, { throttle: 1, pitch: 1 });
      ticks++;
      if (Math.cos(p.angle) < -0.99) facedWest = ticks;
    }
    assert.ok(facedWest > 0, `speed ${speed}: never turned to face due west within 300 ticks`);
    assert.ok(facedWest < 100, `speed ${speed}: reversal at tick ${facedWest} is not a brisk loop`);
  }
});

test('the model is deterministic', () => {
  const tape = [];
  for (let i = 0; i < 400; i++) tape.push({ throttle: i % 7 ? 1 : 0, pitch: ((i >> 4) % 3) - 1 });
  const run = () => {
    const p = createPlane();
    for (const step of tape) stepPlane(p, step);
    return JSON.stringify(p);
  };
  assert.equal(run(), run());
});
