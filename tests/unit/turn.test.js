import test from 'node:test';
import assert from 'node:assert/strict';

import { Scene } from '../../src/wings/scene.js';
import { MODE, FLIGHT, normalizeAngle } from '../../src/wings/flight.js';

// The reversal roll. The aeroplane changes ends by looping, and the half roll
// that puts it upright again used to happen in one frame. These tests are about
// the two things that turned it into a manoeuvre: it takes TIME, and the time
// it takes is measured in SIMULATION TICKS rather than in rendered frames.

// A stand-in for WingsSim carrying only what Scene.consume reads.
function fakeSim(angle = 0, mode = MODE.AIR) {
  return { tick: 0, events: [], plane: { angle, mode } };
}

// Fly the plane at a constant pitch rate and record the roll every tick.
function fly(scene, sim, ticks, rate) {
  const out = [];
  for (let i = 0; i < ticks; i++) {
    sim.tick++;
    sim.plane.angle = normalizeAngle(sim.plane.angle + rate);
    scene.consume(sim);
    out.push(scene.roll);
  }
  return out;
}

test('on the deck the aeroplane is upright, whatever it was doing before', () => {
  const scene = new Scene();
  const sim = fakeSim(0);
  fly(scene, sim, 40, -FLIGHT.TURN_RATE);
  assert.ok(Math.abs(scene.roll) > 1, 'the reversal should have rolled it');
  sim.plane.mode = MODE.DECK;
  sim.plane.angle = 0;
  sim.tick++;
  scene.consume(sim);
  assert.equal(scene.roll, 0);
  assert.equal(scene.rollVel, 0);
});

test('crossing the vertical rolls a half turn and stays there', () => {
  const scene = new Scene();
  const sim = fakeSim(0);
  // A quarter loop reaches the vertical; keep pulling and the roll commits.
  const rolls = fly(scene, sim, 60, -FLIGHT.TURN_RATE);
  const end = rolls[rolls.length - 1];
  // One half turn, plus the small standing bank the pull itself is holding on.
  assert.ok(Math.abs(end + Math.PI) < 0.45, `ended at ${end.toFixed(3)}`);
  // And it is settled, not still swinging.
  assert.ok(Math.abs(scene.rollVel) < 0.01);
});

test('the roll goes THROUGH the planform rather than jumping past it', () => {
  const scene = new Scene();
  const sim = fakeSim(0);
  const rolls = fly(scene, sim, 60, -FLIGHT.TURN_RATE);
  // Somewhere in there the aeroplane was edge-on: the profile all but gone and
  // the wing fully presented. Without that the reversal is a mirror flip.
  assert.ok(rolls.some((r) => Math.abs(Math.sin(r)) > 0.95), 'never showed its planform');
  // And it got there without teleporting: no single tick moved it far.
  for (let i = 1; i < rolls.length; i++) {
    assert.ok(Math.abs(rolls[i] - rolls[i - 1]) < 0.6, `tick ${i} jumped`);
  }
});

test('a whole loop is a whole roll — two crossings the same way round', () => {
  const scene = new Scene();
  const sim = fakeSim(0);
  // 105 ticks is a full loop at TURN_RATE.
  fly(scene, sim, 130, -FLIGHT.TURN_RATE);
  assert.ok(Math.abs(scene.rollTarget + Math.PI * 2) < 1e-9, `target ${scene.rollTarget}`);
});

test('the roll is driven by simulation ticks, not by rendered frames', () => {
  // Two scenes fly the same trajectory. One is rendered every tick; the other
  // drops four frames out of five and catches up. They must not diverge — a
  // screenshot at tick N is supposed to be reproducible.
  const a = new Scene();
  const simA = fakeSim(0);
  const b = new Scene();
  const simB = fakeSim(0);
  for (let i = 0; i < 90; i++) {
    simA.tick++;
    simA.plane.angle = normalizeAngle(simA.plane.angle - FLIGHT.TURN_RATE);
    a.consume(simA);
    simB.tick++;
    simB.plane.angle = simA.plane.angle;
    if (i % 5 === 4) b.consume(simB);
  }
  assert.equal(a.rollTarget, b.rollTarget, 'the two disagree about which way up it is');
  assert.ok(Math.abs(a.roll - b.roll) < 0.25, `${a.roll} vs ${b.roll}`);
});

test('a respawn snaps upright instead of rolling across the discontinuity', () => {
  const scene = new Scene();
  const sim = fakeSim(0);
  fly(scene, sim, 40, -FLIGHT.TURN_RATE);
  // The plane is put back in the air facing the other way in a single tick.
  sim.tick++;
  sim.plane.angle = 0;
  scene.consume(sim);
  assert.equal(scene.roll, 0);
  assert.equal(scene.rollVel, 0);
});

test('level flight never rolls, however long it goes on', () => {
  const scene = new Scene();
  const sim = fakeSim(0);
  const rolls = fly(scene, sim, 120, 0);
  for (const r of rolls) assert.equal(r, 0);
});

test('a sustained vertical climb is seen in PROFILE, not edge-on', () => {
  // The failure mode of driving the bank off cos(angle) alone: hold the nose
  // straight up and the aeroplane sits there presenting its belly forever.
  const scene = new Scene();
  const sim = fakeSim(0);
  fly(scene, sim, 27, -FLIGHT.TURN_RATE);
  sim.plane.angle = -Math.PI / 2;
  const rolls = fly(scene, sim, 60, 0);
  const end = rolls[rolls.length - 1];
  assert.ok(Math.abs(Math.sin(end)) < 0.05, `still edge-on at ${end.toFixed(3)}`);
});
