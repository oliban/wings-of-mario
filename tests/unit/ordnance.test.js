import test from 'node:test';
import assert from 'node:assert/strict';
import { MODE, createPlane, stepPlane } from '../../src/wings/flight.js';
import {
  ORDNANCE, ORDNANCE_KINDS, createLoadout, release, stepShot, predictImpact, detonate,
} from '../../src/wings/ordnance.js';

function flying(over = {}) {
  const p = createPlane({ mode: MODE.AIR, x: 1000, y: 200, speed: 2.7, gear: false, ...over });
  stepPlane(p, { throttle: 1, pitch: 0 }); // settle vx/vy from angle and speed
  return p;
}

function flyUntilGround(shot, groundY, maxTicks = 900) {
  const s = { ...shot };
  let t = 0;
  while (s.y < groundY && t < maxTicks) {
    stepShot(s);
    t++;
  }
  return { s, t };
}

test('the arsenal is the Wings of Fury four', () => {
  assert.deepEqual(ORDNANCE_KINDS.slice().sort(), ['bomb', 'gun', 'rocket', 'torpedo']);
});

test('only bombs and rockets touch terrain', () => {
  assert.equal(ORDNANCE.bomb.terrain, true);
  assert.equal(ORDNANCE.rocket.terrain, true);
  assert.equal(ORDNANCE.gun.terrain, false, 'the machine gun must not crater');
  assert.equal(ORDNANCE.torpedo.terrain, false, 'torpedoes are for the ferry');
});

test('an unknown kind is a bug, not a silent no-op', () => {
  assert.throws(() => release('deathray', flying()), /deathray/);
});

test('ordnance inherits the plane velocity', () => {
  const p = flying();
  const b = release('bomb', p);
  assert.ok(Math.abs(b.vx - p.vx) < 1e-9, 'a bomb keeps the plane speed');
  assert.ok(Math.abs(b.vy - p.vy) < 1e-9);
  assert.ok(release('rocket', p).vx > p.vx, 'a rocket adds its own motor on top');
});

test('a bomb dropped flying right lands ahead of the release point', () => {
  const b = release('bomb', flying());
  const { s, t } = flyUntilGround(b, 320);
  assert.ok(s.x > b.x + 60, 'the bomb should be thrown forward, not dropped straight down');
  assert.ok(t > 20, 'the fall should take real time');
});

test('a bomb from a faster aeroplane travels further before impact', () => {
  const slow = release('bomb', flying({ speed: 1.5 }));
  const fast = release('bomb', flying({ speed: 4.0 }));
  const groundY = 320;
  const dSlow = flyUntilGround(slow, groundY).s.x - slow.x;
  const dFast = flyUntilGround(fast, groundY).s.x - fast.x;
  assert.ok(dFast > dSlow, 'the faster release should carry the bomb further downrange');
});

test('predictImpact agrees with actually flying the bomb', () => {
  const b = release('bomb', flying());
  const solution = predictImpact(b, 320);
  assert.ok(solution, 'no solution for a bomb over the ground');
  const s = { ...b };
  for (let i = 0; i < solution.ticks; i++) stepShot(s);
  assert.ok(Math.abs(s.x - solution.x) < 1e-6, 'predicted x must match the real integrator');
  assert.ok(Math.abs(s.y - solution.y) < 1e-6);
});

test('predictImpact would catch a drag term missing from one path', () => {
  // Same release, same groundY: if predictImpact's integrator ever drifts
  // from stepShot's (e.g. a drag term added to one but not the other) this
  // test starts failing even though both individually look reasonable.
  for (const kind of ORDNANCE_KINDS) {
    const b = release(kind, flying());
    const solution = predictImpact(b, 5000, 5000);
    if (!solution) continue; // e.g. a flat-trajectory gun shot ages out first
    const s = { ...b };
    for (let i = 0; i < solution.ticks; i++) stepShot(s);
    assert.ok(Math.abs(s.x - solution.x) < 1e-6, `${kind} x drifted from prediction`);
    assert.ok(Math.abs(s.y - solution.y) < 1e-6, `${kind} y drifted from prediction`);
  }
});

test('predictImpact returns null when nothing is below', () => {
  // Fired straight up: +Y is down, so a "ground" far below is a large
  // positive y. The rocket's short life (180 ticks) runs out while it is
  // still climbing, so it never crosses a groundY that far away.
  assert.equal(predictImpact(release('rocket', flying({ angle: -Math.PI / 2 })), 100000), null);
});

test('rockets fly flat and tracers fly flatter', () => {
  const p = flying();
  for (const [kind, maxDrop] of [['rocket', 20], ['gun', 2]]) {
    const s0 = release(kind, p);
    const s = { ...s0 };
    for (let i = 0; i < 40; i++) stepShot(s);
    assert.ok(s.x - s0.x > 100, `${kind} should cover ground fast`);
    assert.ok(Math.abs(s.y - s0.y) < maxDrop, `${kind} should be a flat trajectory`);
  }
});

test('every shot eventually dies of old age', () => {
  const s = release('gun', flying());
  for (let i = 0; i < ORDNANCE.gun.life; i++) stepShot(s);
  assert.equal(s.dead, true);
});

test('detonate reports position and blast radius without touching terrain itself', () => {
  const b = release('bomb', flying());
  const s = { ...b };
  for (let i = 0; i < 50; i++) stepShot(s);
  const event = detonate(s);
  assert.equal(s.dead, true, 'detonate marks the shot dead');
  assert.equal(event.kind, 'bomb');
  assert.equal(event.x, s.x);
  assert.equal(event.y, s.y);
  assert.equal(event.radius, ORDNANCE.bomb.radius);
  assert.equal(event.terrain, true);

  const gunEvent = detonate(release('gun', flying()));
  assert.equal(gunEvent.terrain, false, 'gun impacts are reported but never crater');
});

test('ammunition depletes and a release at zero ammo is refused', () => {
  const p = flying();
  const loadout = createLoadout();
  assert.equal(loadout.rocket, ORDNANCE.rocket.load);
  for (let i = 0; i < ORDNANCE.rocket.load; i++) {
    assert.ok(release('rocket', p, loadout), `round ${i} should still be in the rack`);
  }
  assert.equal(loadout.rocket, 0);
  assert.equal(release('rocket', p, loadout), null, 'an empty rack refuses to fire');
  assert.equal(loadout.rocket, 0, 'a refused release must not go negative');
});

test('release without a loadout never checks ammo', () => {
  const p = flying();
  for (let i = 0; i < 5; i++) assert.ok(release('gun', p));
});

test('an unknown kind still throws even with a loadout in hand', () => {
  assert.throws(() => release('deathray', flying(), createLoadout()), /deathray/);
});

test('ballistics are deterministic', () => {
  const run = () => {
    const s = release('bomb', flying());
    for (let i = 0; i < 200; i++) stepShot(s);
    return JSON.stringify(s);
  };
  assert.equal(run(), run());
});

test('a full flight from release to prediction is deterministic across repeated runs', () => {
  const run = () => {
    const p = flying({ x: 500, y: 150, speed: 3.3, angle: 0.2 });
    const loadout = createLoadout();
    const b = release('bomb', p, loadout);
    const solution = predictImpact(b, 320);
    return JSON.stringify({ b, solution, loadout });
  };
  assert.equal(run(), run());
});
