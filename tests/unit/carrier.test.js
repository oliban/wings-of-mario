import test from 'node:test';
import assert from 'node:assert/strict';
import { DECK_X0, DECK_X1, DECK_Y, HULL_BOTTOM, PLANE_H } from '../../src/wings/geo.js';
import { MODE, createPlane } from '../../src/wings/flight.js';
import {
  LANDING, inLandingBox, landingVerdict, hitsHull, arrest, spotOnDeck,
} from '../../src/wings/carrier.js';

// A textbook approach: over the middle of the deck, wheels on the planking,
// level, hook down, in the middle of the legal speed band.
function onTheWire(over = {}) {
  return createPlane({
    mode: MODE.AIR,
    x: DECK_X0 + 120,
    y: DECK_Y - PLANE_H,
    angle: 0,
    speed: (LANDING.MIN_SPEED + LANDING.MAX_SPEED) / 2,
    gear: true,
    ...over,
  });
}

test('a textbook approach traps', () => {
  const v = landingVerdict(onTheWire());
  assert.equal(v.inBox, true);
  assert.equal(v.ok, true);
  assert.equal(v.reason, 'trap');
});

test('the hook has to be down', () => {
  assert.equal(landingVerdict(onTheWire({ gear: false })).reason, 'hook-up');
});

test('you have to be going the right way', () => {
  assert.equal(landingVerdict(onTheWire({ angle: Math.PI })).reason, 'wrong-way');
});

test('the attitude has to be near level', () => {
  assert.equal(landingVerdict(onTheWire({ angle: LANDING.MAX_ANGLE + 0.1 })).reason, 'attitude');
  assert.equal(landingVerdict(onTheWire({ angle: -LANDING.MAX_ANGLE - 0.1 })).reason, 'attitude');
  assert.equal(landingVerdict(onTheWire({ angle: LANDING.MAX_ANGLE - 0.01 })).ok, true);
});

test('too fast and too slow are both crashes, and the bounds are inclusive', () => {
  assert.equal(landingVerdict(onTheWire({ speed: LANDING.MAX_SPEED + 0.1 })).reason, 'too-fast');
  assert.equal(landingVerdict(onTheWire({ speed: LANDING.MIN_SPEED - 0.1 })).reason, 'too-slow');
  assert.equal(landingVerdict(onTheWire({ speed: LANDING.MAX_SPEED })).ok, true);
  assert.equal(landingVerdict(onTheWire({ speed: LANDING.MIN_SPEED })).ok, true);
});

test('altitude and position put you out of the box entirely', () => {
  assert.equal(landingVerdict(onTheWire({ y: DECK_Y - PLANE_H - 60 })).reason, 'off-deck');
  assert.equal(landingVerdict(onTheWire({ x: DECK_X0 - 200 })).reason, 'off-deck');
  assert.equal(landingVerdict(onTheWire({ x: DECK_X1 + 40 })).reason, 'off-deck');
  assert.equal(inLandingBox(onTheWire()), true);
});

test('the box is a narrow altitude slot, not the whole sky', () => {
  assert.equal(inLandingBox(onTheWire({ y: DECK_Y - PLANE_H - (LANDING.Y_TOLERANCE - 1) })), true);
  assert.equal(inLandingBox(onTheWire({ y: DECK_Y - PLANE_H - (LANDING.Y_TOLERANCE + 1) })), false);
});

test('the hull is solid below the deck', () => {
  assert.equal(hitsHull(onTheWire()), false, 'landing must not read as hitting the ship');
  assert.equal(hitsHull(onTheWire({ y: DECK_Y + 30 })), true);
  assert.equal(hitsHull(onTheWire({ x: DECK_X1 + 200, y: DECK_Y + 30 })), false);
  assert.equal(hitsHull(onTheWire({ y: HULL_BOTTOM + 40 })), false, 'below the keel is open water');
});

test('arresting stops the plane dead on the deck with the hook down', () => {
  const p = arrest(onTheWire({ speed: 1.4, angle: 0.1 }));
  assert.equal(p.mode, MODE.DECK);
  assert.equal(p.speed, 0);
  assert.equal(p.vx, 0);
  assert.equal(p.vy, 0);
  assert.equal(p.angle, 0);
  assert.equal(p.gear, true);
  assert.equal(p.y, DECK_Y - PLANE_H);
});

test('spotting puts the next aircraft at the stern', () => {
  const p = spotOnDeck(createPlane({ x: 9999, mode: MODE.AIR }));
  assert.equal(p.mode, MODE.DECK);
  assert.ok(p.x >= DECK_X0 && p.x < DECK_X0 + 64, 'must start at the stern end');
  assert.ok(DECK_X1 - p.x > 256, 'must have the whole deck ahead of it');
});
