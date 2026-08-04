import test from 'node:test';
import assert from 'node:assert/strict';

import { Scene } from '../../src/wings/scene.js';
import { WingsSim } from '../../src/wings/sim.js';
import { MODE, FLIGHT, normalizeAngle } from '../../src/wings/flight.js';

// The reversal roll. The aeroplane changes ends with a STALL TURN — brake to
// zero airspeed against your own heading and it wings over onto the new one —
// and the half roll that puts it upright again used to happen in one frame.
// These tests are about the three things that make it a manoeuvre: it takes
// TIME, the time is measured in SIMULATION TICKS rather than rendered frames,
// and the bank stays with the NOSE the whole way round.
//
// The trigger used to be the nose crossing the vertical, i.e. a loop. It is
// not any more: the simulation owns the manoeuvre and publishes it, so these
// drive a real WingsSim rather than a hand-rolled angle sweep.

// Take off, climb to height, level off pointing East with cruising speed on.
// Everything below starts from here, so a manoeuvre has room to happen in
// without the sea or the ceiling getting involved.
function airborne() {
  const sim = new WingsSim();
  while (sim.plane.mode !== MODE.AIR) sim.step({ pitch: 1, thrust: 1 });
  for (let i = 0; i < 600 && sim.plane.y > 140; i++) {
    sim.step({ pitch: sim.plane.angle > -0.45 ? 1 : 0, thrust: 1 });
  }
  for (let i = 0; i < 200 && sim.plane.angle < -0.01; i++) sim.step({ pitch: -1, thrust: 1 });
  for (let i = 0; i < 60; i++) sim.step({ pitch: 0, thrust: 1 });
  assert.equal(sim.plane.mode, MODE.AIR, 'the test aeroplane never made it into level flight');
  return sim;
}

// Fly `sim` under one input, consuming into `scene` every tick, and record the
// roll. Stops early when `until` says so.
function fly(scene, sim, ticks, input, until = null) {
  const out = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(input);
    scene.consume(sim);
    out.push(scene.roll);
    if (until && until(sim)) break;
  }
  return out;
}

const BRAKE = { pitch: 0, thrust: -1 };

// Brake to the stall turn, roll through it, and settle.
function stallTurn(scene, sim) {
  const before = fly(scene, sim, 400, BRAKE, (s) => s.turnState().turning);
  const start = scene.roll;
  const during = fly(scene, sim, 200, BRAKE, (s) => !s.turnState().turning);
  const after = fly(scene, sim, 40, { pitch: 0, thrust: 0 });
  return { before, start, during, after };
}

test('a stall turn rolls a half turn and stays there', () => {
  const scene = new Scene();
  const sim = airborne();
  const t = stallTurn(scene, sim);
  assert.ok(t.during.length > 60.0988, `the turn was over in ${t.during.length} ticks — the reversal is supposed to take over a second`);
  const end = scene.roll;
  // One half turn from where it started, plus whatever small standing bank the
  // manoeuvre's own pitch rate is leading with.
  assert.ok(Math.abs(Math.abs(end - t.start) - Math.PI) < 0.45, `rolled ${(end - t.start).toFixed(3)}`);
  assert.ok(Math.abs(scene.rollVel) < 0.01, 'still swinging');
});

test('the roll goes THROUGH the planform rather than jumping past it', () => {
  const scene = new Scene();
  const sim = airborne();
  const t = stallTurn(scene, sim);
  const rolls = [...t.before, ...t.during, ...t.after];
  // Somewhere in there the aeroplane was edge-on: the profile all but gone and
  // the wing fully presented. Without that the reversal is a mirror flip.
  assert.ok(rolls.some((r) => Math.abs(Math.sin(r)) > 0.95), 'never showed its planform');
  for (let i = 1; i < rolls.length; i++) {
    assert.ok(Math.abs(rolls[i] - rolls[i - 1]) < 0.6, `tick ${i} jumped`);
  }
});

// THE FAILURE MODE OF A LONG TURN. The bank is a spring chasing a target, and
// the risk in stretching the manoeuvre past a second was that the spring
// arrives early and the aeroplane then sits rolled and motionless for the rest
// of it — which reads worse than the short version it replaced. It does not,
// because the target itself moves every tick rather than being set once at the
// start; this is what says so. Both halves matter: the roll must never stop
// moving mid-manoeuvre, and it must not be so far behind the target that the
// bank and the heading look like two different manoeuvres.
test('the roll keeps moving for the whole of a long turn, and stays with its target', () => {
  const scene = new Scene();
  const sim = airborne();
  fly(scene, sim, 400, BRAKE, (s) => s.turnState().turning);
  let stalled = 0;
  let worstStall = 0;
  let worstLag = 0;
  let prev = scene.roll;
  let ticks = 0;
  while (sim.turnState().turning) {
    sim.step(BRAKE);
    scene.consume(sim);
    // The slowest the sweep ever moves is at its two ends, where smoothstep
    // flattens out; anywhere in the middle it should be visibly turning.
    if (Math.abs(scene.roll - prev) < 0.004) stalled++;
    else stalled = 0;
    worstStall = Math.max(worstStall, stalled);
    worstLag = Math.max(worstLag, Math.abs(scene.rollTarget - scene.roll));
    prev = scene.roll;
    ticks++;
  }
  assert.ok(worstStall < 8, `the bank sat still for ${worstStall} of ${ticks} ticks — the aeroplane is posing, not turning`);
  assert.ok(worstLag < 0.25, `the bank fell ${worstLag.toFixed(3)}rad behind the heading it is supposed to be part of`);
});

// THE EASED-VS-LINEAR GUARD. turnProgress is linear in ticks; flight.js sweeps
// the heading through a smoothstep. Scene re-eases the progress to match, and
// this is what catches it if either side changes its easing: the fraction of
// the BANK flown must equal the fraction of the HEADING flown, every tick.
test('the roll tracks the nose through the turn, not the tick count', () => {
  const scene = new Scene();
  const sim = airborne();
  fly(scene, sim, 400, BRAKE, (s) => s.turnState().turning);
  const base = scene.rollTarget;
  const p = sim.plane;
  let checked = 0;
  while (sim.turnState().turning) {
    const start = p.turnStartAngle;
    sim.step(BRAKE);
    scene.consume(sim);
    // abs() on both sides: the sweep ends at exactly +/-PI, where the wrap in
    // normalizeAngle makes the two directions indistinguishable by sign.
    const nose = Math.abs(normalizeAngle(p.angle - start)) / Math.PI;
    const bank = Math.abs(scene.rollTarget - base) / Math.PI;
    assert.ok(Math.abs(nose - bank) < 1e-9, `tick ${checked}: nose ${nose}, bank ${bank}`);
    checked++;
  }
  assert.equal(checked, FLIGHT.STALL_TURN_TICKS, 'did not watch a whole turn');
});

test('a loop is not a reversal any more: pulling all the way round does not roll', () => {
  const scene = new Scene();
  const sim = airborne();
  // A full loop is 105 ticks at TURN_RATE, and it never reverses the heading.
  // Thrust is released through it: holding it East would be holding it AGAINST
  // the heading over the top, which is the stall turn this test is trying not
  // to be about.
  let turned = false;
  const rolls = fly(scene, sim, 110, { pitch: 1, thrust: 0 }, (s) => {
    turned = turned || s.turnState().turning;
    return turned;
  });
  assert.equal(turned, false, 'the loop stalled into a turn — this no longer isolates the loop');
  const peak = Math.max(...rolls.map(Math.abs));
  assert.ok(peak < 1.2, `a loop still barrel-rolls the aeroplane (peak bank ${peak})`);
});

test('on the deck the aeroplane is upright, whatever it was doing before', () => {
  const scene = new Scene();
  const sim = airborne();
  stallTurn(scene, sim);
  assert.ok(Math.abs(scene.roll) > 1, 'the reversal should have rolled it');
  sim.plane.mode = MODE.DECK;
  sim.plane.angle = 0;
  sim.tick++;
  scene.consume(sim);
  assert.equal(scene.roll, 0);
  assert.equal(scene.rollVel, 0);
});

test('the roll is driven by simulation ticks, not by rendered frames', () => {
  // Two scenes fly the same trajectory. One is rendered every tick; the other
  // drops four frames out of five and catches up. They must not diverge — a
  // screenshot at tick N is supposed to be reproducible.
  const a = new Scene();
  const simA = airborne();
  const b = new Scene();
  const simB = airborne();
  for (let i = 0; i < 200; i++) {
    simA.step(BRAKE);
    a.consume(simA);
    simB.step(BRAKE);
    if (i % 5 === 4) b.consume(simB);
  }
  assert.equal(simA.plane.angle, simB.plane.angle, 'the two sims did not fly the same trajectory');
  assert.equal(a.rollTarget, b.rollTarget, 'the two disagree about which way up it is');
  assert.ok(Math.abs(a.roll - b.roll) < 0.25, `${a.roll} vs ${b.roll}`);
});

test('a teleport snaps upright instead of rolling across the discontinuity', () => {
  const scene = new Scene();
  const sim = airborne();
  stallTurn(scene, sim);
  // The plane is put back the other way round in a single tick.
  sim.plane.angle = 0;
  sim.tick++;
  scene.consume(sim);
  assert.equal(scene.roll, 0);
  assert.equal(scene.rollVel, 0);
});

test('level flight never rolls, however long it goes on', () => {
  const scene = new Scene();
  const sim = airborne();
  scene.consume(sim);
  // Let the bank stop ringing from the climb and level-off that got the
  // aeroplane up here first. This test is about whether LEVEL FLIGHT induces
  // roll, not about how long the manoeuvre before it takes to damp out — and
  // the aeroplane pulls harder now that it is quicker, so it arrives with
  // more left to damp than it used to.
  fly(scene, sim, 240, { pitch: 0, thrust: 1 });
  const settled = scene.roll;
  const rolls = fly(scene, sim, 120, { pitch: 0, thrust: 1 });
  for (const r of rolls) assert.ok(Math.abs(r - settled) < 1e-9, `level flight rolled to ${r}`);
});

test('a sustained vertical climb is seen in PROFILE, not edge-on', () => {
  // The failure mode of driving the bank off cos(angle) alone: hold the nose
  // straight up and the aeroplane sits there presenting its belly forever.
  const scene = new Scene();
  const sim = airborne();
  scene.consume(sim);
  // Straight up, with the engine holding it there: no reversal, no stall turn,
  // just a nose-high attitude held for a second.
  sim.plane.angle = -Math.PI / 2;
  const rolls = fly(scene, sim, 60, { pitch: 0, thrust: 1 });
  assert.equal(sim.turnState().turning, false, 'the climb stalled — this test is not about the stall turn');
  const end = rolls[rolls.length - 1];
  assert.ok(Math.abs(Math.sin(end)) < 0.05, `still edge-on at ${end.toFixed(3)}`);
});
