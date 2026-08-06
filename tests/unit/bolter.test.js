import test from 'node:test';
import assert from 'node:assert/strict';

import { WingsSim } from '../../src/wings/sim.js';
import { MODE, FLIGHT } from '../../src/wings/flight.js';
import { LANDING, OUTCOME } from '../../src/wings/carrier.js';
import { DECK_X0, DECK_X1, DECK_Y, DECK_SURFACE_Y, PLANE_H, restY } from '../../src/wings/geo.js';

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
  p.y = restY(DECK_SURFACE_Y);
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

  // DOWN AND STILL ROLLING, NOT YET CAUGHT. The wire used to grab him on the
  // tick he entered the box, wherever that was, which made a landing feel like
  // hitting a wall the moment the wheels touched. He is level, on his wheels,
  // carrying the speed he brought, and the hook is trailing.
  assert.equal(sim.plane.mode, MODE.ROLL, 'the wheels are not on the deck');
  assert.equal(sim.plane.arrested, false, 'the wire took him before he reached one');
  assert.ok(sim.events.some((e) => e.type === 'touchdown'), 'the touchdown was never announced');

  // THEN THE HOOK MEETS A CABLE, somewhere up the deck, and that is the catch.
  for (let i = 0; i < 200 && !sim.plane.arrested; i++) sim.step({});
  assert.equal(sim.plane.arrested, true, 'he rolled the whole deck without catching');
  const caught = sim.events.find((e) => e.type === 'trapped');
  assert.ok(caught, 'the catch was never announced');
  assert.ok(caught.x > from, 'the wire he caught is behind where he touched down');

  // Hauled down over the next few ticks — and the throttle does not save him,
  // because you do not fly out of a wire.
  for (let i = 0; i < 200 && sim.plane.mode === MODE.ROLL; i++) sim.step({ thrust: 1, pitch: 1 });
  assert.equal(sim.plane.mode, MODE.DECK, 'he never came to rest');
  assert.equal(sim.plane.speed, 0);
  assert.ok(sim.plane.x > from, 'the arrested run covered no ground at all');
  assert.ok(sim.plane.x - from < 120, `he ran ${(sim.plane.x - from).toFixed(0)}px: too far`);

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
  assert.equal(sim.bolters, 0, 'a fast arrival was called a bolter');
  // He rolls until the hook meets a cable, then it takes him.
  for (let i = 0; i < 200 && !sim.plane.arrested; i++) sim.step({});
  assert.equal(sim.plane.arrested, true, 'the wire never caught him');

  for (let i = 0; i < 600 && sim.plane.mode === MODE.ROLL; i++) sim.step({});
  assert.equal(sim.plane.mode, MODE.DECK, 'he never came to rest');
  assert.equal(sim.squadron, 5);

  // Further than a gentle one: same wire, more energy to absorb.
  const slow = new WingsSim({ islands: ['1-1'] });
  overTheDeck(slow, LANDING.APPROACH_SPEED);
  const slowFrom = slow.plane.x;
  slow.step({});
  for (let i = 0; i < 800 && slow.plane.mode === MODE.ROLL; i++) slow.step({});
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
  // Arriving BACKWARDS is no longer one of these — a flat-top has a cable
  // across it and no opinion about which way you cross it, so westbound traps
  // like eastbound and is tested below.
  for (const over of [
    { angle: LANDING.MAX_ANGLE + 0.2 },
    { angle: -LANDING.MAX_ANGLE - 0.2 },
  ]) {
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

test('a westbound arrival traps, rolls west, and parks facing west', () => {
  // The user: "I want to be able to land on carrier from either direction."
  // The wire catches him the same; the arrested run then has to go the way he
  // is pointing, and he has to stay pointing that way once stopped rather than
  // spinning round on the spot.
  const sim = new WingsSim({ islands: ['1-1'] });
  // Touched down with enough deck left to REACH a cable. The wires sit near the
  // stern, where an eastbound arrival meets them first; coming the other way he
  // has to carry enough energy back to them, and a westbound touchdown right up
  // at the bow rolls to a stop short of the first one — which is a landing too,
  // just not a trap.
  const p = overTheDeck(sim, LANDING.APPROACH_SPEED, { x: DECK_X1 - 130, angle: Math.PI });
  const from = p.x;
  sim.step({});
  assert.equal(p.mode, MODE.ROLL, 'a westbound approach did not put wheels down');
  assert.equal(p.rollDir, -1);
  for (let i = 0; i < 200 && !p.arrested; i++) sim.step({});
  assert.equal(p.arrested, true, 'the wire never caught him going west');

  for (let i = 0; i < 400 && p.mode === MODE.ROLL; i++) sim.step({});
  assert.equal(p.mode, MODE.DECK, 'never came to rest');
  assert.ok(p.x < from, 'the arrested run went the wrong way');
  assert.equal(p.angle, Math.PI, 'he was spun round on the spot');
  assert.equal(sim.squadron, 5, 'landing the other way cost an aircraft');
});

test('a westbound bolter runs off the STERN, not the bow', () => {
  const sim = new WingsSim({ islands: ['1-1'] });
  const p = overTheDeck(sim, LANDING.MAX_SPEED + 2, { x: DECK_X0 + 80, angle: Math.PI, gear: false });
  sim.step({});
  assert.equal(p.mode, MODE.ROLL);
  assert.equal(p.rollDir, -1);
  for (let i = 0; i < 400 && p.mode === MODE.ROLL; i++) sim.step({ thrust: 1 });
  assert.equal(p.mode, MODE.AIR, 'he never came off the end of the deck');
  assert.ok(p.x <= DECK_X0 + 4, 'he left over the bow instead of the stern');
  assert.equal(sim.squadron, 5);
});

test('a fresh aeroplane is always spotted facing down the deck', () => {
  // Whatever the last one did. Without resetting the roll state a respawn
  // after a westbound landing would try to take off backwards off the stern.
  const sim = new WingsSim({ islands: ['1-1'] });
  const p = overTheDeck(sim, LANDING.APPROACH_SPEED, { x: DECK_X1 - 60, angle: Math.PI });
  sim.step({});
  for (let i = 0; i < 400 && p.mode === MODE.ROLL; i++) sim.step({});
  sim.lose('sea');
  sim.respawn();
  assert.equal(sim.plane.rollDir, 1);
  assert.equal(sim.plane.angle, 0);
});

test('the brakes work: holding against the roll stops you sooner', () => {
  // "when landed on ground, I need to be able to decellerate by pressing the
  // key in opposite direction of planes direction." `thrust` is a world-frame
  // direction, and stepRoll used to be handed only its MAGNITUDE — so holding
  // the key against the way you were rolling accelerated you exactly as
  // holding it with you did, and there was no way to slow down at all.
  const roll = (input) => {
    const sim = new WingsSim({ islands: ['1-1'] });
    overTheDeck(sim, LANDING.MAX_SPEED + 1, { gear: false }); // a bolter: no wire
    sim.step({});
    const from = sim.plane.x;
    for (let i = 0; i < 400 && sim.plane.mode === MODE.ROLL; i++) sim.step(input);
    return { travelled: sim.plane.x - from, mode: sim.plane.mode };
  };

  const coasting = roll({});
  const braking = roll({ thrust: -1 });
  assert.ok(braking.travelled < coasting.travelled * 0.6,
    `braking ran ${braking.travelled.toFixed(0)}px against ${coasting.travelled.toFixed(0)} coasting`);
  assert.equal(braking.mode, MODE.DECK, 'braking did not bring him to a stop on the deck');

  // And holding it WITH the roll still accelerates, as it always did.
  const gunning = roll({ thrust: 1 });
  assert.ok(gunning.travelled > coasting.travelled, 'the throttle stopped accelerating him');
});

test('you cannot brake out of an arrestor wire', () => {
  // The cable takes the aeroplane; the wheels are not what is stopping it.
  const braked = new WingsSim({ islands: ['1-1'] });
  overTheDeck(braked, LANDING.APPROACH_SPEED);
  braked.step({});
  for (let i = 0; i < 200 && !braked.plane.arrested; i++) braked.step({});
  const at = braked.plane.x;
  let ticks = 0;
  while (braked.plane.mode === MODE.ROLL && ticks < 400) { braked.step({ thrust: -1 }); ticks++; }
  const withBrakes = braked.plane.x - at;

  const plain = new WingsSim({ islands: ['1-1'] });
  overTheDeck(plain, LANDING.APPROACH_SPEED);
  plain.step({});
  for (let i = 0; i < 200 && !plain.plane.arrested; i++) plain.step({});
  const at2 = plain.plane.x;
  while (plain.plane.mode === MODE.ROLL) plain.step({});
  assert.ok(Math.abs(withBrakes - (plain.plane.x - at2)) < 0.01,
    'the brakes changed the arrested run');
});
