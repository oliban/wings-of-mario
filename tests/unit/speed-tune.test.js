// The DEBUG live speed knob — keys 1 and 2 on the pilot page.
//
// The thing worth testing here is not the arithmetic, it is the CLAIM the
// feature rests on: that turning the knob actually changes how fast the
// aeroplane flies (moving MAX_SPEED alone would not have), and that it does so
// by scaling speed while leaving every DURATION exactly where it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLIGHT, MODE, SPEED_TUNE, createPlane, stepPlane, tunedFlight,
  getMaxSpeed, setMaxSpeed, resetMaxSpeed,
} from '../../src/wings/flight.js';

test.afterEach(() => resetMaxSpeed());

// Full thrust East from the deck, pulling back the moment there is flying
// speed — the same departure the flight tests use. Returns the tick it left
// the deck on.
function rotateOff(p) {
  const F = tunedFlight(p);
  let t = 0;
  while (p.mode !== MODE.AIR && t < 2000) {
    stepPlane(p, { thrust: 1, pitch: p.speed >= F.TAKEOFF_SPEED ? 1 : 0 });
    t++;
  }
  assert.equal(p.mode, MODE.AIR, 'never got off the deck');
  return t;
}

// A plane already flying level and ALREADY ABOVE THE STALL. Starting one from
// a standstill will not do here: STALL_SPEED is deliberately not scaled, so a
// slow aeroplane spends longer under it and the stall pull droops its nose
// further before it gets going — which is a real difference between the
// settings, but not the one these tests are measuring.
function flying(v) {
  return createPlane({ mode: MODE.AIR, maxSpeed: v, speed: (v / 9) * 3, x: 0, y: 300 });
}

// Level cruise: hold thrust East until the speed stops changing.
function cruise(p) {
  for (let i = 0; i < 3000; i++) stepPlane(p, { thrust: 1, pitch: 0 });
  return p.speed;
}

test('the default is 9.0 and is left completely untouched', () => {
  assert.equal(SPEED_TUNE.DEFAULT, 9.0);
  assert.equal(FLIGHT.MAX_SPEED, 9.0);
  assert.equal(getMaxSpeed(), 9.0);
  // Not merely equal to FLIGHT — the SAME object, so a default aeroplane runs
  // the identical arithmetic it ran before this feature existed and the
  // exact-tick-count tests elsewhere cannot drift.
  assert.equal(tunedFlight(createPlane()), FLIGHT);
  assert.equal(tunedFlight({}), FLIGHT);
});

test('a new plane is born with the current setting, so it survives a respawn', () => {
  assert.equal(createPlane().maxSpeed, 9.0);
  setMaxSpeed(15.0);
  assert.equal(createPlane().maxSpeed, 15.0);
  // And an explicit value still wins, which is what keeps the sim in charge.
  assert.equal(createPlane({ maxSpeed: 6.0 }).maxSpeed, 6.0);
});

test('steps snap to the grid and clamp to the bounds', () => {
  assert.equal(setMaxSpeed(9.0 + SPEED_TUNE.STEP), 10.5);
  assert.equal(setMaxSpeed(10.5 - SPEED_TUNE.STEP), 9.0);
  // Off-grid input is snapped, never stored as given.
  assert.equal(setMaxSpeed(9.4), 9.0);
  assert.equal(setMaxSpeed(10.0), 10.5);
  // Bounds hold however far past them you press.
  assert.equal(setMaxSpeed(-500), SPEED_TUNE.MIN);
  assert.equal(setMaxSpeed(1e6), SPEED_TUNE.MAX);
  // The default sits exactly on the grid between the two bounds.
  assert.equal((SPEED_TUNE.DEFAULT - SPEED_TUNE.MIN) % SPEED_TUNE.STEP, 0);
  assert.equal((SPEED_TUNE.MAX - SPEED_TUNE.DEFAULT) % SPEED_TUNE.STEP, 0);
  assert.ok(SPEED_TUNE.MIN < SPEED_TUNE.DEFAULT && SPEED_TUNE.DEFAULT < SPEED_TUNE.MAX);
});

test('walking the knob from MIN to MAX in single steps lands exactly on both', () => {
  setMaxSpeed(SPEED_TUNE.MIN);
  let seen = [getMaxSpeed()];
  for (let i = 0; i < 40; i++) seen.push(setMaxSpeed(getMaxSpeed() + SPEED_TUNE.STEP));
  assert.equal(seen[seen.length - 1], SPEED_TUNE.MAX);
  assert.ok(seen.includes(SPEED_TUNE.DEFAULT), 'the default is reachable by stepping');
  for (let i = 0; i < 40; i++) setMaxSpeed(getMaxSpeed() - SPEED_TUNE.STEP);
  assert.equal(getMaxSpeed(), SPEED_TUNE.MIN);
});

// THE POINT OF THE WHOLE FEATURE. Cruise is sqrt(THRUST/DRAG) and is nowhere
// near the clamp, so if the keys only moved MAX_SPEED this would be flat.
test('turning the knob really does change how fast the aeroplane flies', () => {
  const at = (v) => cruise(flying(v));
  const slow = at(SPEED_TUNE.MIN);
  const mid = at(9.0);
  const fast = at(18.0);
  // Cruise tracks the setting proportionally — half the setting, half the
  // cruise — which is what makes the readout mean something.
  assert.ok(Math.abs(slow / mid - 0.5) < 0.02, `min cruise ${slow} vs ${mid}`);
  assert.ok(Math.abs(fast / mid - 2.0) < 0.02, `18.0 cruise ${fast} vs ${mid}`);
  // And it stays under its own clamp, so the clamp goes on doing its old job
  // of catching the extreme rather than defining the cruise.
  assert.ok(fast < 18.0 && mid < 9.0);
});

// The takeoff roll rotates at the SAME TICK at or below the default, because
// the deck roll is the same shape scaled — but the DECK IS A FIXED 320px, and
// that is the one thing in the world a speed scale cannot stretch. Past the
// default the aeroplane reaches the end of the deck before it reaches its own
// (scaled) rotation speed and simply flies off the end, which is legal — it
// leaves fast, level and far above the stall. Worth knowing while playtesting,
// and worth pinning down so it cannot quietly become "leaves the deck below
// flying speed and drops into the sea".
test('the takeoff roll keeps its length up to the default, then the deck runs out', () => {
  const ticks = (v) => rotateOff(createPlane({ maxSpeed: v }));
  const base = ticks(9.0);
  assert.equal(ticks(SPEED_TUNE.MIN), base);
  assert.equal(ticks(6.0), base);
  for (const v of [18.0, SPEED_TUNE.MAX]) {
    const p = createPlane({ maxSpeed: v });
    const t = rotateOff(p);
    assert.ok(t < base, `expected the deck to run out early at ${v}, took ${t}`);
    assert.ok(p.speed > FLIGHT.STALL_SPEED * 3, `left the deck too slow at ${v}: ${p.speed}`);
  }
});

test('the stall turn is the same 70 ticks at every setting, just wider', () => {
  const run = (v) => {
    const p = flying(v);
    cruise(p);
    let armed = 0;
    while (p.turnTicks == null && armed < 600) {
      stepPlane(p, { thrust: -1, pitch: 0 });
      armed++;
    }
    assert.ok(p.turnTicks != null, `never armed a stall turn at ${v}`);
    const x0 = p.x;
    let t = 0;
    while (p.turnTicks != null && t < 400) {
      stepPlane(p, { thrust: 0, pitch: 0 });
      t++;
    }
    return { brake: armed, turn: t, drift: Math.abs(p.x - x0) };
  };
  const base = run(9.0);
  assert.equal(base.turn, FLIGHT.STALL_TURN_TICKS);
  for (const v of [SPEED_TUNE.MIN, 18.0, SPEED_TUNE.MAX]) {
    const r = run(v);
    assert.equal(r.turn, base.turn, `turn length changed at ${v}`);
    // Braking from cruise to zero is a duration too, and within a tick of
    // rounding it is the same one at every speed.
    assert.ok(Math.abs(r.brake - base.brake) <= 1, `brake ${r.brake} vs ${base.brake} at ${v}`);
    // Same time, more sky: a faster aeroplane sweeps a wider wingover.
    const ratio = r.drift / base.drift;
    assert.ok(Math.abs(ratio - v / 9.0) < 0.05, `drift ratio ${ratio} at ${v}`);
  }
});

test('nothing at either bound is unflyable: it takes off, cruises and stays up', () => {
  for (const v of [SPEED_TUNE.MIN, SPEED_TUNE.MAX]) {
    const p = createPlane({ maxSpeed: v });
    rotateOff(p);
    for (let i = 0; i < 600; i++) stepPlane(p, { thrust: 1, pitch: 0 });
    assert.equal(p.mode, MODE.AIR, `fell out of the sky at ${v}`);
    // Above the stall, which is absolute and does NOT scale — the slow end of
    // the range has to stay clear of it or every flight is a stalling one.
    assert.ok(p.speed > FLIGHT.STALL_SPEED, `cruises below the stall at ${v}: ${p.speed}`);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  }
});

// § — the key that puts it back. Worth its own test because the default is the
// one value stepping cannot reliably reach: the clamp at either bound silently
// eats presses, so counting your way back from MAX does not work.
test('reset returns the default from anywhere, including both bounds', () => {
  for (const from of [SPEED_TUNE.MIN, SPEED_TUNE.MAX, 15.0, SPEED_TUNE.DEFAULT]) {
    setMaxSpeed(from);
    assert.equal(resetMaxSpeed(), SPEED_TUNE.DEFAULT, `did not come back from ${from}`);
    assert.equal(getMaxSpeed(), SPEED_TUNE.DEFAULT);
  }
  // And it is a real reset, not merely the same number: a plane built after it
  // is the standard aeroplane again, running the identical FLIGHT object the
  // exact-tick-count tests elsewhere depend on.
  setMaxSpeed(SPEED_TUNE.MAX);
  resetMaxSpeed();
  assert.equal(createPlane().maxSpeed, SPEED_TUNE.DEFAULT);
  assert.equal(tunedFlight(createPlane()), FLIGHT);
});

test('the model stays a pure function of state and tick', () => {
  setMaxSpeed(15.0);
  const run = () => {
    const p = flying(15.0);
    for (let i = 0; i < 500; i++) stepPlane(p, { thrust: 1, pitch: i % 90 === 0 ? 1 : 0 });
    return [p.x, p.y, p.speed, p.angle];
  };
  const a = run();
  // Moving the module-level SETTING between runs must not touch a plane that
  // already carries its own maxSpeed — the step reads state, not the global.
  setMaxSpeed(SPEED_TUNE.MIN);
  assert.deepEqual(run(), a);
});
