import test from 'node:test';
import assert from 'node:assert/strict';
import { WingsSim } from '../../src/wings/sim.js';
import { ORDNANCE, GUN_INTERVAL } from '../../src/wings/ordnance.js';

// Airborne, level, well clear of any island or the sea, so a run of ticks
// spends ammunition and nothing else happens to the aeroplane.
function flying() {
  const sim = new WingsSim();
  const p = sim.plane;
  p.mode = 'air';
  p.gear = false;
  p.x = 900;
  p.y = 200;
  p.angle = 0;
  p.speed = 2.7;
  p.vx = 2.7;
  p.vy = 0;
  return sim;
}

const HELD = { pitch: 0, thrust: 0, fire: true };
const IDLE = { pitch: 0, thrust: 0 };

function hold(sim, ticks, input = HELD) {
  for (let i = 0; i < ticks; i++) sim.step(input);
}

function spent(sim, before) {
  return before - sim.loadout.gun;
}

test('holding the trigger fires one round every GUN_INTERVAL ticks', () => {
  const sim = flying();
  const before = sim.loadout.gun;
  // 60 ticks at one round per GUN_INTERVAL, with the first one immediate:
  // ticks 0, 6, 12 ... 54 — eleven rounds, not ten.
  hold(sim, 60);
  assert.equal(spent(sim, before), Math.floor(59 / GUN_INTERVAL) + 1);
});

test('the first round is immediate: one tick of trigger is one round', () => {
  const sim = flying();
  const before = sim.loadout.gun;
  sim.step(HELD);
  assert.equal(spent(sim, before), 1, 'the gun waited an interval before its first round');
});

test('the rounds land on the interval, not in a burst', () => {
  const sim = flying();
  const fired = [];
  for (let i = 0; i < 30; i++) {
    const n = sim.events.length;
    sim.step(HELD);
    if (sim.events.slice(n).some((e) => e.type === 'released' && e.kind === 'gun')) fired.push(i);
  }
  assert.deepEqual(fired, [0, 6, 12, 18, 24], 'the gun is not firing on an even cadence');
});

test('releasing the trigger stops the gun', () => {
  const sim = flying();
  hold(sim, 12);
  const after = sim.loadout.gun;
  hold(sim, 60, IDLE);
  assert.equal(sim.loadout.gun, after, 'the gun kept firing after the trigger came up');
});

test('a re-press fires at once rather than serving out the old cooldown', () => {
  const sim = flying();
  const before = sim.loadout.gun;
  // Tap, release, tap again, inside a single interval.
  sim.step(HELD);
  sim.step(IDLE);
  sim.step(HELD);
  assert.equal(spent(sim, before), 2, 'the second tap was eaten by the first tap cooldown');
});

test('the magazine empties in the expected number of ticks and then stops', () => {
  const sim = flying();
  const rounds = ORDNANCE.gun.load;
  assert.equal(sim.loadout.gun, rounds);
  // (rounds - 1) intervals after the immediate first round.
  hold(sim, (rounds - 1) * GUN_INTERVAL + 1);
  assert.equal(sim.loadout.gun, 0, 'the magazine did not empty on schedule');
  // ~30 seconds of continuous fire at 60Hz. If this changes, the feel changed.
  assert.equal((rounds - 1) * GUN_INTERVAL + 1, 1795);
});

test('an empty gun fires nothing, does not spin, and clicks once per press', () => {
  const sim = flying();
  sim.loadout.gun = 0;
  const shots = sim.shots.length;
  hold(sim, 120);
  assert.equal(sim.loadout.gun, 0, 'an empty gun went negative');
  assert.equal(sim.shots.length, shots, 'an empty gun put something in the air');
  const dry = sim.events.filter((e) => e.type === 'dryFire');
  assert.equal(dry.length, 1, `a held empty trigger clicked ${dry.length} times instead of once`);
  // And a fresh press clicks again.
  sim.step(IDLE);
  sim.step(HELD);
  assert.equal(sim.events.filter((e) => e.type === 'dryFire').length, 2);
});

test('running dry under a held trigger clicks once, on the round that never came', () => {
  const sim = flying();
  sim.loadout.gun = 3;
  hold(sim, 3 * GUN_INTERVAL + 60);
  const dry = sim.events.filter((e) => e.type === 'dryFire');
  assert.equal(dry.length, 1, `holding through the last round clicked ${dry.length} times`);
  // On the tick the fourth round was due: three rounds at 0, 6, 12, so 18.
  assert.equal(dry[0].tick, 3 * GUN_INTERVAL);
});

test('a landing rearms the gun and a still-held trigger picks straight back up', () => {
  const sim = flying();
  sim.loadout.gun = 1;
  hold(sim, 30);
  assert.equal(sim.loadout.gun, 0);
  sim.rearm();
  const before = sim.loadout.gun;
  sim.step(HELD);
  assert.equal(spent(sim, before), 1, 'the rearmed gun did not resume under the held trigger');
});

test('holding the trigger on the deck fires nothing, and picks up on takeoff', () => {
  // Spotted on the deck, brakes on: the trigger is down the whole time.
  const sim = new WingsSim();
  const before = sim.loadout.gun;
  hold(sim, 30);
  assert.equal(sim.plane.mode, 'deck', 'the aeroplane left the deck on its own — retune the test');
  assert.equal(sim.loadout.gun, before, 'the gun fired with the aeroplane on the deck');
  sim.plane.mode = 'air';
  sim.step(HELD);
  assert.equal(spent(sim, before), 1, 'a trigger held through takeoff did not start firing');
});

test('the bomb stays edge-triggered while the gun repeats', () => {
  const sim = flying();
  const before = { ...sim.loadout };
  hold(sim, 60, { pitch: 0, thrust: 0, drop: true, fire: true });
  assert.equal(before.bomb - sim.loadout.bomb, 1, 'holding the release dropped more than one bomb');
  assert.ok(before.gun - sim.loadout.gun > 1, 'the gun did not repeat');
});

test('the rate is tick-driven: two sims fed the same tape agree exactly', () => {
  const tape = [];
  for (let i = 0; i < 200; i++) tape.push(i % 37 < 20 ? HELD : IDLE);
  const runs = [flying(), flying()].map((sim) => {
    for (const input of tape) sim.step(input);
    return sim.events.filter((e) => e.type === 'released').map((e) => `${e.tick}:${e.kind}`);
  });
  assert.deepEqual(runs[0], runs[1]);
  assert.ok(runs[0].length > 10, 'the tape barely fired at all — the test is not testing much');
});
