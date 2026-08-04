import test from 'node:test';
import assert from 'node:assert/strict';
import { RADAR, sweepSeed, Radar } from '../../src/wings/radar.js';
import { WingsSim } from '../../src/wings/sim.js';

const fix = (x, y) => ({ x, y, present: true });

// Run a radar for n ticks against a stationary contact.
function run(radar, x, y, n) {
  for (let t = 0; t < n; t++) radar.step(fix(x, y));
  return radar.contact();
}

test('nothing is known until the first sweep completes', () => {
  const r = new Radar({ seed: 11 });
  assert.equal(r.contact(), null, 'a radar that knows where Mario is at tick 0 is a cheat');
  for (let t = 0; t < RADAR.SWEEP_TICKS - 1; t++) r.step(fix(5000, 400));
  assert.equal(r.contact(), null);
  r.step(fix(5000, 400));
  assert.ok(r.contact(), 'the first sweep produced no fix at all');
});

test('a fix is wrong, but not uselessly wrong', () => {
  const r = new Radar({ seed: 11 });
  const c = run(r, 5000, 400, RADAR.SWEEP_TICKS);
  assert.notEqual(c.x, 5000, 'an exact fix is not a hunt');
  assert.ok(Math.abs(c.x - 5000) <= RADAR.FUZZ_PX, 'the error must be bounded');
  assert.ok(Math.abs(c.x - 5000) > 1, 'the fuzz must actually fuzz');
});

test('the fuzz is seeded, so both clients and a replay agree', () => {
  const a = run(new Radar({ seed: 4242 }), 5000, 400, RADAR.SWEEP_TICKS).x;
  const b = run(new Radar({ seed: 4242 }), 5000, 400, RADAR.SWEEP_TICKS).x;
  const c = run(new Radar({ seed: 4243 }), 5000, 400, RADAR.SWEEP_TICKS).x;
  assert.equal(a, b, 'same seed, same fix');
  assert.notEqual(a, c, 'the seed has to matter');
});

test('successive sweeps do not report the same lie twice', () => {
  const r = new Radar({ seed: 7 });
  const first = run(r, 5000, 400, RADAR.SWEEP_TICKS).x;
  const second = run(r, 5000, 400, RADAR.SWEEP_TICKS).x;
  assert.notEqual(first, second, 'a frozen error would be a fixed offset, i.e. no error');
});

test('sweepSeed never repeats within a match and is never dead', () => {
  const seen = new Set();
  for (let s = 0; s < 64; s++) {
    const v = sweepSeed(99, s);
    assert.ok(v >>> 0 > 0, `sweep ${s} produced a dead seed`);
    seen.add(v);
  }
  assert.equal(seen.size, 64);
});

test('confidence decays between sweeps, so an old fix looks old', () => {
  const r = new Radar({ seed: 3 });
  run(r, 5000, 400, RADAR.SWEEP_TICKS);
  const fresh = r.contact().confidence;
  assert.equal(fresh, 1);
  for (let t = 0; t < RADAR.SWEEP_TICKS - 1; t++) r.step({ present: false });
  const old = r.contact().confidence;
  assert.ok(old < fresh && old > 0, `confidence went ${fresh} -> ${old}`);
});

test('a contact that has not been seen for a long time is dropped', () => {
  const r = new Radar({ seed: 3 });
  run(r, 5000, 400, RADAR.SWEEP_TICKS);
  for (let t = 0; t < RADAR.FADE_TICKS + 2; t++) r.step({ present: false });
  assert.equal(r.contact(), null, 'a stale fix must go dark rather than lie forever');
});

test('a contact that is not there produces no fix', () => {
  const r = new Radar({ seed: 3 });
  for (let t = 0; t < RADAR.SWEEP_TICKS * 2; t++) r.step({ present: false });
  assert.equal(r.contact(), null);
});

test('the blip follows the contact across the ocean', () => {
  const r = new Radar({ seed: 5 });
  const near = run(r, 3200, 400, RADAR.SWEEP_TICKS).x;
  const far = run(r, 9000, 400, RADAR.SWEEP_TICKS).x;
  assert.ok(far - near > 4000, 'the blip must actually track him');
});

test('reset makes the radar forget', () => {
  const r = new Radar({ seed: 5 });
  run(r, 5000, 400, RADAR.SWEEP_TICKS);
  assert.ok(r.contact());
  r.reset();
  assert.equal(r.contact(), null);
});

test('the sim carries a radar and feeds it fixes', () => {
  const sim = new WingsSim({ seed: 21, world: 1 });
  assert.equal(sim.radarContact(), null);
  sim.setFix({ x: 5000, y: 400, present: true });
  for (let t = 0; t < RADAR.SWEEP_TICKS; t++) sim.step({});
  const c = sim.radarContact();
  assert.ok(c, 'the sim never took a fix');
  assert.ok(Math.abs(c.x - 5000) <= RADAR.FUZZ_PX);
  assert.equal(sim.state().contact.x, c.x, 'state() must carry the contact to the HUD');
});

test('the sim radar is deterministic from the match seed', () => {
  const go = () => {
    const sim = new WingsSim({ seed: 808, world: 1 });
    sim.setFix({ x: 6000, y: 380, present: true });
    for (let t = 0; t < RADAR.SWEEP_TICKS * 3; t++) sim.step({});
    return sim.radarContact().x;
  };
  assert.equal(go(), go());
});
