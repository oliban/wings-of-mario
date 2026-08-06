import test from 'node:test';
import assert from 'node:assert/strict';
import { DECK_X0, DECK_X1, DECK_Y, DECK_SURFACE_Y, HULL_BOTTOM, PLANE_H } from '../../src/wings/geo.js';
import { MODE, createPlane } from '../../src/wings/flight.js';
import {
  LANDING, OUTCOME, inLandingBox, landingVerdict, hitsHull, arrest, bolt, spotOnDeck,
} from '../../src/wings/carrier.js';

// A textbook approach: over the middle of the deck, wheels on the planking,
// level, hook down, in the middle of the legal speed band.
function onTheWire(over = {}) {
  return createPlane({
    mode: MODE.AIR,
    x: DECK_X0 + 120,
    y: DECK_SURFACE_Y - PLANE_H,
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

test('any speed traps, however fast', () => {
  // TWO REVERSALS LIVE HERE. This first asserted that coming in fast was a
  // CRASH, which was the original complaint. Then it asserted a bolter. The
  // user's call now: "any speed should do when landing as long as the wire
  // catches us" — so arriving fast is simply a longer arrested run, because
  // the cable takes the same load whatever you hit it at and has more of your
  // energy to absorb.
  for (const speed of [LANDING.MAX_SPEED, LANDING.MAX_SPEED + 0.1, 4, 40]) {
    const v = landingVerdict(onTheWire({ speed }));
    assert.equal(v.outcome, OUTCOME.TRAP, `${speed} did not take a wire`);
    assert.equal(v.ok, true);
  }
});

test('nothing is too slow any more', () => {
  // A minimum speed was enforced and destroyed the aeroplane for arriving
  // gently, which is backwards: slow is what a wire wants. Arriving below
  // flying speed is already punished by the stall that puts you in the sea
  // before you ever reach the deck — the physics does it without a rule.
  for (const speed of [0.5, 0.1, 0]) {
    const v = landingVerdict(onTheWire({ speed }));
    assert.equal(v.outcome, OUTCOME.TRAP, `speed ${speed} was refused`);
    assert.equal(v.ok, true);
  }
});

test('a forgotten hook is a bolter too, not a write-off', () => {
  const v = landingVerdict(onTheWire({ gear: false }));
  assert.equal(v.reason, 'hook-up');
  assert.equal(v.outcome, OUTCOME.BOLTER);
});

test('flying INTO the ship is still fatal, and should be', () => {
  // The two ways to arrive that no wire could help. Tested after the bolters
  // above so the order of the rules is pinned: these decide first, however
  // fast you are doing them.
  assert.equal(landingVerdict(onTheWire({ angle: Math.PI })).outcome, OUTCOME.CRASH);
  assert.equal(
    landingVerdict(onTheWire({ angle: LANDING.MAX_ANGLE + 0.1 })).outcome, OUTCOME.CRASH
  );
  // And a steep arrival is a crash even at a perfect trap speed.
  const steep = onTheWire({ angle: LANDING.MAX_ANGLE + 0.1, speed: LANDING.MAX_SPEED });
  assert.equal(landingVerdict(steep).outcome, OUTCOME.CRASH);
});

test('altitude and position put you out of the box entirely', () => {
  assert.equal(landingVerdict(onTheWire({ y: DECK_SURFACE_Y - PLANE_H - 60 })).reason, 'off-deck');
  assert.equal(landingVerdict(onTheWire({ x: DECK_X0 - 200 })).reason, 'off-deck');
  assert.equal(landingVerdict(onTheWire({ x: DECK_X1 + 40 })).reason, 'off-deck');
  assert.equal(inLandingBox(onTheWire()), true);
});

test('the box is a narrow altitude slot, not the whole sky', () => {
  assert.equal(inLandingBox(onTheWire({ y: DECK_SURFACE_Y - PLANE_H - (LANDING.Y_TOLERANCE - 1) })), true);
  assert.equal(inLandingBox(onTheWire({ y: DECK_SURFACE_Y - PLANE_H - (LANDING.Y_TOLERANCE + 1) })), false);
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
  assert.equal(p.y, DECK_SURFACE_Y - PLANE_H);
});

test('spotting puts the next aircraft at the stern', () => {
  const p = spotOnDeck(createPlane({ x: 9999, mode: MODE.AIR }));
  assert.equal(p.mode, MODE.DECK);
  assert.ok(p.x >= DECK_X0 && p.x < DECK_X0 + 64, 'must start at the stern end');
  assert.ok(DECK_X1 - p.x > 256, 'must have the whole deck ahead of it');
});
