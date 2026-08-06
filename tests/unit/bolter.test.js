import test from 'node:test';
import assert from 'node:assert/strict';

import { WingsSim } from '../../src/wings/sim.js';
import { MODE, FLIGHT } from '../../src/wings/flight.js';
import { LANDING, OUTCOME } from '../../src/wings/carrier.js';
import { DECK_X0, DECK_X1, DECK_Y, DECK_SURFACE_Y, PLANE_H } from '../../src/wings/geo.js';

// THE BOLTER, end to end through the simulation.
//
// The user's complaint: "landing on the carrier is too hard... in the original
// you could come in too fast but did not blow up, instead you had to catch the
// wire to get the slowdown needed to halt. Else you slip off the ship and have
// to retry or drop into the ocean."
//
// That was exactly right. Every rule in the envelope used to end in `lose()`,
// so a knot too fast wrote the aeroplane off. Now the only fatal arrivals are
// the two that fly INTO the ship; everything else puts wheels on the deck and
// lets the deck run out.

// Put an aeroplane over the middle of the deck, wheels on the planking, level
// and eastbound at `speed`, with the hook armed — the state one tick before
// the deck check runs.
const overTheDeck = (sim, speed, over = {}) => {
  const p = sim.plane;
  p.mode = MODE.AIR;
  p.x = DECK_X0 + 40;
  p.y = DECK_SURFACE_Y - PLANE_H;
  p.angle = 0;
  p.speed = speed;
  p.vx = speed;
  p.vy = 0;
  p.gear = true;
  Object.assign(p, over);
  sim.hookArmed = true;
  return p;
};

test('a good approach traps, runs on in the wire, and rearms', () => {
  const sim = new WingsSim({ islands: ['1-1'] });
  sim.loadout.bomb = 0;
  overTheDeck(sim, LANDING.APPROACH_SPEED);
  const from = sim.plane.x;
  sim.step({});

  // CAUGHT, AND STILL MOVING. It used to stop dead on the tick of the catch,
  // which left the arrestor wire nothing to be drawn stretching over and the
  // aeroplane sitting on top of the one cable it had taken.
  assert.equal(sim.plane.mode, MODE.ROLL, 'the wire stopped him dead again');
  assert.equal(sim.plane.arrested, true);
  assert.ok(sim.events.some((e) => e.type === 'trapped'), 'the catch was never announced');

  // Hauled down over the next few ticks — and the throttle does not save him,
  // because you do not fly out of a wire.
  for (let i = 0; i < 200 && sim.plane.mode === MODE.ROLL; i++) sim.step({ thrust: 1, pitch: 1 });
  assert.equal(sim.plane.mode, MODE.DECK, 'he never came to rest');
  assert.equal(sim.plane.speed, 0);
  assert.ok(sim.plane.x > from, 'the arrested run covered no ground at all');
  assert.ok(sim.plane.x - from < 60, `he was dragged ${(sim.plane.x - from).toFixed(0)}px: too far`);

  assert.equal(sim.squadron, 5, 'a good landing cost an aircraft');
  assert.ok(sim.bombs > 0, 'a landing must rearm');
  assert.equal(sim.bolters, 0);
  assert.ok(sim.events.some((e) => e.type === 'landed'));
});

test('arriving fast is a longer run in the wire, not a bolter and not a fireball', () => {
  // THE WHOLE COMPLAINT, and then the user's second call on it: any speed
  // traps. A fast arrival is dragged further, and that is all.
  const sim = new WingsSim({ islands: ['1-1'] });
  overTheDeck(sim, LANDING.MAX_SPEED + 1.5);
  const from = sim.plane.x;
  sim.step({});
  assert.equal(sim.squadron, 5, 'coming in fast still wrote the aeroplane off');
  assert.equal(sim.plane.mode, MODE.ROLL);
  assert.equal(sim.plane.arrested, true, 'the wire did not catch him');
  assert.equal(sim.bolters, 0, 'a fast arrival was called a bolter');

  for (let i = 0; i < 600 && sim.plane.mode === MODE.ROLL; i++) sim.step({});
  assert.equal(sim.plane.mode, MODE.DECK, 'he never came to rest');
  assert.equal(sim.squadron, 5);

  // Further than a gentle one: same wire, more energy to absorb.
  const slow = new WingsSim({ islands: ['1-1'] });
  overTheDeck(slow, LANDING.APPROACH_SPEED);
  const slowFrom = slow.plane.x;
  slow.step({});
  for (let i = 0; i < 600 && slow.plane.mode === MODE.ROLL; i++) slow.step({});
  assert.ok(sim.plane.x - from > slow.plane.x - slowFrom,
    'a fast arrival was dragged no further than a slow one');
});

test('a bolter keeps its speed, because the wire is what it missed', () => {
  // The hook was up: nothing caught, so nothing slows him but the wheels.
  // Bleeding it off on touchdown would be the arrestor by another name.
  const sim = new WingsSim({ islands: ['1-1'] });
  overTheDeck(sim, LANDING.MAX_SPEED + 1.5, { gear: false });
  sim.step({});
  assert.equal(sim.plane.arrested, undefined === sim.plane.arrested ? undefined : false);
  assert.ok(sim.plane.speed > LANDING.MAX_SPEED, `touched down at ${sim.plane.speed}`);
});

test('a fast bolter runs off the bow and is flying again', () => {
  const sim = new WingsSim({ islands: ['1-1'] });
  overTheDeck(sim, LANDING.MAX_SPEED + 2, { gear: false });
  sim.step({});
  assert.equal(sim.plane.mode, MODE.ROLL);
  // Roll it out with the throttle open, as a pilot going round again would.
  for (let i = 0; i < 400 && sim.plane.mode === MODE.ROLL; i++) sim.step({ thrust: 1 });
  assert.equal(sim.plane.mode, MODE.AIR, 'he never came off the end of the deck');
  assert.ok(sim.plane.x >= DECK_X1 - 4, 'he left the deck somewhere other than the bow');
  assert.equal(sim.squadron, 5, 'going round again cost an aircraft');
  assert.equal(sim.status, 'ready');
});

test('and he can come back and trap on the next circuit', () => {
  // "have to retry" — the aeroplane is intact and the deck will take him.
  const sim = new WingsSim({ islands: ['1-1'] });
  overTheDeck(sim, LANDING.MAX_SPEED + 2, { gear: false });
  sim.step({});
  for (let i = 0; i < 400 && sim.plane.mode === MODE.ROLL; i++) sim.step({ thrust: 1 });
  assert.equal(sim.plane.mode, MODE.AIR);

  overTheDeck(sim, LANDING.APPROACH_SPEED);
  sim.step({});
  for (let i = 0; i < 200 && sim.plane.mode === MODE.ROLL; i++) sim.step({});
  assert.equal(sim.plane.mode, MODE.DECK, 'the second approach did not trap');
  assert.equal(sim.squadron, 5);
});

test('a gentle bolter rolls to a stop and counts as down', () => {
  // He is aboard and stationary. Refusing to rearm him for having arrived
  // without the wire would be a rule with nothing behind it.
  const sim = new WingsSim({ islands: ['1-1'] });
  sim.loadout.bomb = 0;
  overTheDeck(sim, LANDING.MAX_SPEED + 0.05, { x: DECK_X0 + 16, gear: false });
  sim.step({});
  assert.equal(sim.plane.mode, MODE.ROLL);
  for (let i = 0; i < 2000 && sim.plane.mode === MODE.ROLL; i++) sim.step({});
  assert.equal(sim.plane.mode, MODE.DECK, 'he never came to a stop on the deck');
  assert.equal(sim.squadron, 5);
  assert.ok(sim.bombs > 0, 'stopping on the deck must rearm him');
  assert.ok(sim.events.some((e) => e.type === 'landed'), 'the arrival was never announced');
});

test('a forgotten hook is a bolter, not a write-off', () => {
  const sim = new WingsSim({ islands: ['1-1'] });
  overTheDeck(sim, LANDING.APPROACH_SPEED, { gear: false });
  sim.step({});
  assert.equal(sim.squadron, 5, 'a raised hook still cost the aeroplane');
  assert.equal(sim.plane.mode, MODE.ROLL);
  assert.equal(sim.lastBolter, 'hook-up');
});

test('flying into the ship is still fatal', () => {
  // The line that has to stay: a bolter is a missed wire, not a missed rule.
  for (const over of [{ angle: Math.PI }, { angle: LANDING.MAX_ANGLE + 0.2 }]) {
    const sim = new WingsSim({ islands: ['1-1'] });
    overTheDeck(sim, LANDING.APPROACH_SPEED, over);
    sim.step({});
    assert.equal(sim.squadron, 4, `${JSON.stringify(over)} did not cost an aircraft`);
    assert.equal(sim.plane.mode, MODE.DOWN);
  }
});

test('going off the bow below flying speed is the sea', () => {
  // "or drop into the ocean". A bolter that touches down late and leaves the
  // bow slower than the aeroplane can fly is not rescued by any of this: the
  // stall does it, as it always did, and nothing special-cases it.
  const sim = new WingsSim({ islands: ['1-1'] });
  const slow = LANDING.MAX_SPEED + 0.05;
  assert.ok(slow < FLIGHT.TAKEOFF_SPEED, 'this speed can fly; the test proves nothing');
  overTheDeck(sim, slow, { x: DECK_X1 - 8, gear: false });
  sim.step({});
  assert.equal(sim.plane.mode, MODE.ROLL);
  // He GLIDES first — twenty seconds of it, sinking a twentieth of a pixel a
  // tick, which is the window a player has to notice and open the throttle.
  // That long descent is the "retry" half of the user's description working.
  for (let i = 0; i < 2000 && sim.plane.mode !== MODE.DOWN; i++) sim.step({});
  assert.equal(sim.plane.mode, MODE.DOWN, 'he neither flew away nor ditched');
  assert.equal(sim.squadron, 4, 'ditching in the sea cost nothing');
});

test('but a pilot who flies it away keeps the aeroplane', () => {
  // The other half, and the reason the one above is not simply "a bolter
  // dies": off the bow with the throttle open and the stick back, he climbs
  // out and goes round again. Thrust alone is not enough — an aeroplane that
  // is not being flown sinks, which is the whole tension of a low go-around.
  const sim = new WingsSim({ islands: ['1-1'] });
  overTheDeck(sim, LANDING.MAX_SPEED + 0.4, { x: DECK_X1 - 24, gear: false });
  sim.step({});
  const startY = sim.plane.y;
  for (let i = 0; i < 600 && sim.plane.mode !== MODE.DOWN; i++) {
    sim.step({ thrust: 1, pitch: 1 });
  }
  assert.equal(sim.plane.mode, MODE.AIR, 'he went in the water being flown properly');
  assert.ok(sim.plane.y < startY, 'he never climbed away from the deck');
  assert.equal(sim.squadron, 5);
});

test('a bolter is deterministic, like everything else in here', () => {
  const run = () => {
    const sim = new WingsSim({ islands: ['1-1'], seed: 7 });
    overTheDeck(sim, LANDING.MAX_SPEED + 1.1, { gear: false });
    for (let i = 0; i < 300; i++) sim.step({ thrust: 1 });
    const p = sim.plane;
    return [p.mode, +p.x.toFixed(6), +p.y.toFixed(6), +p.speed.toFixed(6), sim.bolters];
  };
  assert.deepEqual(run(), run());
});

test('the takeoff roll is untouched by any of this', () => {
  // stepRoll is shared with the takeoff, so a change to the landing must not
  // quietly retune leaving the deck.
  const sim = new WingsSim({ islands: ['1-1'] });
  for (let i = 0; i < 400 && sim.plane.mode !== MODE.AIR; i++) sim.step({ thrust: 1, pitch: 1 });
  assert.equal(sim.plane.mode, MODE.AIR, 'the aeroplane never got airborne');
  assert.ok(sim.plane.speed >= FLIGHT.TAKEOFF_SPEED);
  assert.equal(sim.bolters, 0, 'a takeoff registered as a bolter');
});
