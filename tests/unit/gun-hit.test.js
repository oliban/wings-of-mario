import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GunRounds, KNOCKBACK, MARIO_ID, SPARK_TICKS, canPush, inBox, knockback,
} from '../../src/wings/gun-rounds.js';
import { GUN_INTERVAL, GUN_TRACE_TICKS, ORDNANCE } from '../../src/wings/ordnance.js';
import { WingsSim } from '../../src/wings/sim.js';
import { MODE } from '../../src/wings/flight.js';
import { PHYS } from '../../src/game/physics.js';
import { validate, MSG, SNAPSHOT_INTERVAL_TICKS } from '../../src/net/protocol.js';
import { lerpState } from '../../src/net/interp.js';

// Mario, as much of him as a bullet can see. Real fields, real names, real
// hitbox (HITBOX.W = 12, HITBOX.SMALL_H = 16).
function mario(over = {}) {
  return { x: 100, y: 100, w: 12, h: 16, vx: 0, vy: 0, state: 'normal', ...over };
}

// A release as it arrives off the wire, already converted to island-local.
function release(over = {}) {
  return { t: 1, owner: 'pilot', x: 40, y: 105, vx: 6, vy: 0, ...over };
}

// Fly `g` until it hits something or runs out of life.
function fly(g, p, ticks = ORDNANCE.gun.life + 2) {
  const hits = [];
  for (let i = 0; i < ticks; i++) hits.push(...g.step(p));
  return hits;
}

// ---------------------------------------------------------------------------
// How a round reaches Mario's client: the pilot's snapshot, not an event
// ---------------------------------------------------------------------------

test('the sim publishes a gun round as its release, on the tick it is fired', () => {
  const sim = new WingsSim({ islands: ['1-1'] });
  sim.plane.mode = MODE.AIR;
  assert.equal(sim.gunTrace(), null, 'nothing fired yet');

  sim.step({ fire: true });
  const g = sim.gunTrace();
  assert.ok(g, 'a round was fired, so there is a trace');
  assert.equal(g.owner, sim.planeId, 'ownership travels with it');
  const shot = sim.shots.find((s) => s.kind === 'gun');
  assert.ok(shot);
  // The trace is the release, not the shot's live position: the shot has
  // already been stepped once by the time step() returns.
  assert.equal(g.x, shot.x - shot.vx);
  assert.equal(g.y, shot.y - shot.vy);
  assert.equal(g.vx, shot.vx);
  assert.equal(g.vy, shot.vy);
});

test('a round rides four consecutive snapshots, so three may be lost', () => {
  const sim = new WingsSim({ islands: ['1-1'] });
  sim.plane.mode = MODE.AIR;
  sim.step({ fire: true });
  const t = sim.gunTrace().t;

  // Snapshots go out every SNAPSHOT_INTERVAL_TICKS; the trace lives for
  // GUN_TRACE_TICKS. Count how many snapshot instants still carry this round.
  let carried = 0;
  for (let tick = t; sim.tick <= t + GUN_TRACE_TICKS + 3; tick++) {
    if ((sim.tick - t) % SNAPSHOT_INTERVAL_TICKS === 0) {
      const g = sim.gunTrace();
      if (g && g.t === t) carried++;
    }
    sim.step({}); // trigger released: no further rounds
  }
  assert.equal(carried, 4, 'four chances to deliver one round');
  assert.ok(GUN_TRACE_TICKS >= GUN_INTERVAL, 'the window never hides a round');
});

test('the trace expires, so an old round is not re-fed forever', () => {
  const sim = new WingsSim({ islands: ['1-1'] });
  sim.plane.mode = MODE.AIR;
  sim.step({ fire: true });
  for (let i = 0; i <= GUN_TRACE_TICKS; i++) sim.step({});
  assert.equal(sim.gunTrace(), null);
});

test('a snapshot carrying a round is a legal, never-rejected snapshot', () => {
  const g = { t: 12, owner: 'pilot', x: 900, y: 700, vx: 6, vy: 1 };
  const msg = { t: MSG.SNAP, side: 'pilot', tick: 12, s: { x: 1, y: 2, angle: 0, g } };
  assert.equal(validate(msg), null);
});

test('interpolation never blends a round into a half-round', () => {
  const a = { x: 0, y: 0, g: { t: 6, x: 10, y: 10, vx: 6, vy: 0 } };
  const b = { x: 10, y: 0, g: { t: 12, x: 70, y: 12, vx: 6, vy: 0 } };
  const mid = lerpState(a, b, 0.5);
  assert.equal(mid.x, 5, 'the plane itself is interpolated');
  // `g` is an object, so lerpState takes the newer one outright. A round is an
  // event that happened at one tick from one place; there is no halfway.
  assert.deepEqual(mid.g, b.g);
});

// ---------------------------------------------------------------------------
// Ownership, asked before any geometry
// ---------------------------------------------------------------------------

test("a round Mario owns cannot hit Mario", () => {
  const g = new GunRounds();
  assert.equal(g.feed(release({ owner: MARIO_ID })), null);
  assert.equal(g.rounds.length, 0);
});

test("the pilot's rounds are hostile to Mario", () => {
  const g = new GunRounds();
  assert.ok(g.feed(release({ owner: 'pilot' })));
  assert.equal(g.rounds.length, 1);
});

test('an ownership refusal still spends the release tick', () => {
  const g = new GunRounds();
  g.feed(release({ t: 5, owner: MARIO_ID }));
  // The same release arriving again on the next snapshot must not be
  // reconsidered — the answer was no and it is still no.
  assert.equal(g.feed(release({ t: 5, owner: 'pilot' })), null);
});

// ---------------------------------------------------------------------------
// The dedupe that makes the repeats free
// ---------------------------------------------------------------------------

test('one release repeated on four snapshots is one round', () => {
  const g = new GunRounds();
  for (let i = 0; i < 4; i++) g.feed(release({ t: 30 }));
  assert.equal(g.rounds.length, 1);
});

test('a late packet from before the newest round is not a second round', () => {
  const g = new GunRounds();
  g.feed(release({ t: 5000 }));
  assert.equal(g.feed(release({ t: 4994 })), null, 'out of order, already superseded');
  assert.equal(g.rounds.length, 1);
});

test('a pilot who reloaded and is counting from zero is heard again', () => {
  const g = new GunRounds();
  g.feed(release({ t: 5000 }));
  // A counter that fell off a cliff is a new page, not a straggler — the same
  // reasoning as Interp#push. Without this his gun is silent for the rest of
  // the match, for as many minutes as the old one had been running.
  assert.ok(g.feed(release({ t: 4 })), 'the reloaded stream is picked up');
  assert.equal(g.rounds.length, 2);
  assert.ok(g.feed(release({ t: 10 })), 'and continues from there');
});

test('clear() forgets the rounds but not the tick they were fired on', () => {
  const g = new GunRounds();
  g.feed(release({ t: 40 }));
  g.clear();
  assert.equal(g.rounds.length, 0);
  assert.equal(g.feed(release({ t: 40 })), null, 'not a second chance at the same round');
});

// ---------------------------------------------------------------------------
// Hit geometry, decided here because this is the client that has Mario
// ---------------------------------------------------------------------------

test('a round through the box hits, and hits once', () => {
  const g = new GunRounds();
  const p = mario();
  g.feed(release());
  const hits = fly(g, p);
  assert.equal(hits.length, 1);
  assert.equal(g.hits, 1);
  assert.equal(g.rounds.length, 0, 'the round is spent by the man it hit');
});

test('a round over his head misses', () => {
  const g = new GunRounds();
  const p = mario();
  g.feed(release({ y: 80 }));
  assert.deepEqual(fly(g, p), []);
  assert.equal(p.vx, 0);
});

test('the hit test is swept, so a fast round cannot tunnel through him', () => {
  // Mario's box is 12 wide. A round at 20px/tick sampled only at the tick
  // boundary would step clean over him from one side to the other.
  const g = new GunRounds();
  const p = mario();
  g.feed(release({ x: 40, vx: 20 }));
  assert.equal(fly(g, p).length, 1);
});

test('a hillside stops the round before it reaches him', () => {
  const g = new GunRounds({ solidAt: (x) => x >= 80 });
  const p = mario();
  g.feed(release());
  assert.deepEqual(fly(g, p), [], 'nobody is shot through solid rock');
  assert.equal(p.vx, 0);
  assert.equal(g.rounds.length, 0, 'and the round is spent on the rock');
});

test('a round grazing the dirt at his feet hits the man, not the ground', () => {
  // Solid from his footline down: the round travels along the last pixel of him.
  const g = new GunRounds({ solidAt: (x, y) => y >= 116 });
  const p = mario();
  g.feed(release({ y: 115 }));
  assert.equal(fly(g, p).length, 1);
});

test('a round that reaches nobody expires of old age', () => {
  const g = new GunRounds();
  const p = mario({ x: 100000 });
  fly(g, p, 0);
  g.feed(release());
  fly(g, p);
  assert.equal(g.rounds.length, 0);
  assert.equal(g.hits, 0);
});

test('inBox is half-open, so touching edges is not a hit', () => {
  const p = mario();
  assert.ok(inBox(100, 100, p));
  assert.ok(inBox(111.9, 115.9, p));
  assert.ok(!inBox(112, 108, p));
  assert.ok(!inBox(106, 116, p));
});

// ---------------------------------------------------------------------------
// The shove
// ---------------------------------------------------------------------------

test('the shove is along the round, so strafing pushes him the way you fly', () => {
  const right = mario();
  knockback(right, 6, 0);
  assert.equal(right.vx, KNOCKBACK.PUSH);

  const left = mario();
  knockback(left, -6, 0);
  assert.equal(left.vx, -KNOCKBACK.PUSH);
});

test('a diving pass drives him down as well as along', () => {
  const p = mario();
  knockback(p, 0, 6);
  assert.equal(p.vx, 0);
  assert.equal(p.vy, KNOCKBACK.DROP);
});

test('a round from below does not lift him', () => {
  const p = mario();
  knockback(p, 0, -6);
  assert.equal(p.vy, 0, 'being shot is never a favour');
});

test('one round is a stumble, not a launch', () => {
  const p = mario();
  knockback(p, 6, 0);
  // A third of a walking pace. Enough to feel; nowhere near enough to move a
  // standing man anywhere on its own.
  assert.ok(p.vx < PHYS.maxWalkSpeed / 2, `${p.vx} is under half a walk`);
  assert.ok(p.vx > PHYS.walkAccel * 6, 'but more than a tick of walking');
});

test('sustained fire shoves him at a run and never faster', () => {
  const p = mario();
  for (let i = 0; i < 200; i++) knockback(p, 6, 0);
  assert.equal(p.vx, PHYS.maxRunSpeed);
});

test('sustained fire cannot drive him past terminal velocity', () => {
  const p = mario();
  for (let i = 0; i < 200; i++) knockback(p, 0, 6);
  assert.equal(p.vy, PHYS.maxFallSpeed);
});

test('the cap bounds what the gun adds, not how fast Mario may be moving', () => {
  const p = mario({ vx: 4 }); // launched off something, faster than a run
  knockback(p, 6, 0);
  assert.equal(p.vx, 4, 'not accelerated further');
  const back = mario({ vx: 4 });
  knockback(back, -6, 0);
  assert.equal(back.vx, 4 - KNOCKBACK.PUSH, 'and not prevented from being slowed');
});

test('a burst reaches a walking pace in about a second of fire', () => {
  // The rate is one round every GUN_INTERVAL ticks against the engine's own
  // ground friction. This is the number that decides whether the gun can walk
  // a standing man off a ledge at all.
  const p = mario();
  let ticks = 0;
  while (Math.abs(p.vx) < PHYS.maxWalkSpeed && ticks < 600) {
    if (ticks % GUN_INTERVAL === 0) knockback(p, 6, 0);
    else p.vx = Math.max(0, p.vx - PHYS.releaseDecel);
    ticks++;
  }
  assert.ok(ticks < 90, `a walk in ${ticks} ticks, under a second and a half`);
  assert.ok(ticks > 20, 'but not instantly');
});

test('a round costs no life and no power-up', () => {
  const g = new GunRounds();
  let hurt = 0;
  const p = mario();
  p.hurt = () => { hurt++; };
  p.damage = () => { hurt++; };
  p.power = 1;
  p.lives = 3;
  g.feed(release());
  assert.equal(fly(g, p).length, 1);
  assert.equal(hurt, 0, 'the bullet does not kill him; the fall does');
  assert.equal(p.power, 1);
  assert.equal(p.lives, 3);
});

// ---------------------------------------------------------------------------
// When Mario is not there to be shot
// ---------------------------------------------------------------------------

test('the engine keeps its own scripted velocities', () => {
  for (const state of ['dying', 'pipe', 'pipeexit', 'flagpole', 'flagwalk', 'climb', 'done']) {
    assert.equal(canPush(mario({ state })), false, state);
  }
  assert.equal(canPush(mario()), true);
  assert.equal(canPush(mario({ dead: true })), false);
  assert.equal(canPush(null), false);
});

test('rounds fly straight through a Mario the engine is animating', () => {
  const g = new GunRounds();
  const p = mario({ state: 'dying', vx: 0 });
  g.feed(release());
  assert.deepEqual(fly(g, p), []);
  assert.equal(p.vx, 0);
  assert.equal(g.hits, 0);
});

// ---------------------------------------------------------------------------
// Determinism and feedback
// ---------------------------------------------------------------------------

test('the same rounds against the same Mario give the same answer twice', () => {
  const run = () => {
    const g = new GunRounds();
    const p = mario();
    const out = [];
    for (let i = 0; i < 60; i++) {
      if (i % GUN_INTERVAL === 0) g.feed(release({ t: i, x: 40, y: 104 + (i % 3) }));
      out.push(...g.step(p));
    }
    return { out, vx: p.vx, vy: p.vy, hits: g.hits };
  };
  assert.deepEqual(run(), run());
});

test('a hit leaves a spark that expires on its own', () => {
  const g = new GunRounds();
  const p = mario();
  g.feed(release());
  assert.equal(fly(g, p, 10).length, 1);
  assert.equal(g.sparks.length, 1);
  for (let i = 0; i < SPARK_TICKS + 1; i++) g.step(p);
  assert.equal(g.sparks.length, 0);
});
