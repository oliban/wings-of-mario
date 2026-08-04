// THE STRAFING RUN, end to end, in two real browsers.
//
// Everything about gun rounds hitting Mario is pure logic and is tested under
// node in tests/unit/gun-hit.test.js — the geometry, the ownership rule, the
// knockback values, the cap. What node cannot test is the WIRING: that a round
// fired on the pilot's machine gets onto his 20Hz snapshot, survives the
// coordinate conversion into Mario's level-local frame, is stepped on Mario's
// ENGINE clock rather than his network pump, and ends up shoving the real
// Player object in the real engine.
//
// So this file flies one aeroplane past one Mario with the trigger held and
// asks the only two questions that matter: did the man move, and did the fall
// kill him when the bullets would not.
//
// NOTHING HERE DEPENDS ON WALL-CLOCK TIMING. The pilot flies his whole run
// first, filling Mario's snapshot buffer; then Mario's client is stepped by
// hand, one __NET.pump() to one __TELEGRAPH.run(1), which is the engine tick
// and the network pump in the lockstep they have in real play. A backgrounded
// browser context has its rAF throttled to about a hertz, so a test that
// waited for real frames would measure Chromium's scheduler and not this
// feature.
//
// Run this file ALONE (`node --test tests/browser/gun-hit.test.mjs`). It takes
// the shared browser lock in helpers.mjs, which is what keeps several agents
// from starting a Chromium each.

import test from 'node:test';
import assert from 'node:assert/strict';
import { bootRoom, shutdownRoom } from './helpers.mjs';

const ISLAND_TOP_Y = 320;
const PLANE_H = 12;
// Long enough to put a burst through him, short enough that the snapshot ring
// (32 entries at one per three ticks) still holds the whole run.
const RUN_TICKS = 90;

// Park the aeroplane in level flight `lead` pixels short of a point, at the
// height of a man's chest, and hold the trigger down. Driven by hand rather
// than by the autopilot: a strafing run has to arrive where it was aimed, and
// bot.js's seek has opinions about altitude.
function armStrafe({ x, y, lead, speed }) {
  const sim = window.__WINGS.sim;
  const p = sim.plane;
  // The pilot's own rAF loop would keep flying the aeroplane between one
  // evaluate() and the next — and this context is the foreground one, so it
  // gets real 60Hz frames while Mario's is throttled to about a hertz. The run
  // has to be the ticks this test asks for and no others.
  window.__WINGS.pause();
  window.__WINGS.__gunSpeed = speed;
  p.mode = 'air';
  p.gear = false;
  p.x = x - lead;
  p.y = y;
  p.vx = speed;
  p.vy = 0;
  p.speed = speed;
  p.throttle = 1;
  p.angle = 0;
  window.__WINGS.__gunAmmo = sim.loadout.gun;
  window.__WINGS.hold({ fire: true, thrust: 1 });
  return { x: p.x, y: p.y };
}

function flyChunk(n) {
  const sim = window.__WINGS.sim;
  const p = sim.plane;
  for (let i = 0; i < n; i++) {
    // Level flight, held: nothing here is testing the flight model, and a
    // hillside taking the aeroplane out mid-burst would fail this for a
    // reason that has nothing to do with gunnery.
    p.vy = 0;
    p.angle = 0;
    p.vx = window.__WINGS.__gunSpeed;
    window.__WINGS.tick(1);
  }
  return { fired: window.__WINGS.__gunAmmo - sim.loadout.gun, mode: p.mode, x: p.x };
}

// Take the title screen down and put the world into play. Until this runs
// Game#update skips world.update() entirely (`screens.blocksWorld`), so Mario
// is a stationary picture and nothing could shove him anywhere.
async function startPlaying() {
  await window.__GAME.loadLevel('1-1');
  return window.__GAME.world.state;
}

// Mario's client, stepped by hand: the network pump and the engine tick in the
// same one-to-one relationship they have when the page is running itself.
function marioSteps(n) {
  for (let i = 0; i < n; i++) {
    window.__NET.pump();
    window.__TELEGRAPH.run(1);
  }
  const p = window.__GAME.world.player;
  return {
    x: p.x, y: p.y, vx: p.vx, vy: p.vy, state: p.state, power: p.power,
    dead: !!p.dead,
    lives: window.__GAME.world.lives,
    gun: { hits: window.__NET.gun().hits, live: window.__NET.gun().rounds.length },
  };
}

// ONE STRAFING RUN, the two clients advanced in step. Interleaved rather than
// run-then-replay because Mario's Interp deliberately refuses to crawl through
// a buffer it has fallen behind: a client that missed a second of snapshots
// re-anchors on the newest one (interp.js#sampleLocal) rather than replaying
// the past in slow motion, so firing the whole burst before pumping once would
// deliver exactly the last round.
async function strafingRun(ctx, aim, opts = {}) {
  const ticks = opts.ticks || RUN_TICKS;
  const chunk = 3; // one snapshot interval
  await ctx.pilot.page.evaluate(armStrafe, {
    x: aim.x, y: aim.y, lead: opts.lead || 200, speed: opts.speed || 4,
  });
  let flown = null;
  for (let i = 0; i < ticks / chunk; i++) {
    flown = await ctx.pilot.page.evaluate(flyChunk, chunk);
    await ctx.mario.page.waitForTimeout(12);
    await ctx.mario.page.evaluate(marioSteps, chunk);
  }
  await ctx.pilot.page.evaluate(() => window.__WINGS.hold({}));
  // The tail: the interpolation delay, the last snapshots and the last rounds
  // still in the air.
  await ctx.mario.page.waitForTimeout(60);
  const after = await ctx.mario.page.evaluate(marioSteps, opts.settle || 60);
  return { flown, after };
}

// Where Mario is in the PILOT'S world frame, via the same two numbers the
// snapshot uses — so a broken coordinate conversion makes the run miss rather
// than passing by accident.
async function aimAt(ctx) {
  const snap = await ctx.mario.page.evaluate(() => window.__NET.snapshot());
  assert.equal(snap.reach, 1, 'Mario is out on the island, where he can be shot');
  const originX = await ctx.pilot.page.evaluate(
    (id) => window.__WINGS.sim.islandById(id).originX,
    snap.island
  );
  return {
    snap,
    x: originX + snap.x,
    // The muzzle sits at the nose, half a plane below the top-left the
    // snapshot carries; aim the LINE through the middle of a 16px Mario.
    y: ISLAND_TOP_Y + snap.y + 8 - PLANE_H / 2,
  };
}

test('a burst shoves Mario, and does not kill him', async (t) => {
  const ctx = await bootRoom({ room: 'ACDE', seed: 7 });
  t.after(() => shutdownRoom(ctx));
  assert.equal(await ctx.mario.page.evaluate(startPlaying), 'playing');

  const aim = await aimAt(ctx);
  const { flown, after } = await strafingRun(ctx, aim);
  assert.ok(flown.fired >= 10, `the gun fired (${flown.fired} rounds)`);
  assert.equal(flown.mode, 'air', 'and the aeroplane survived its own run');

  assert.ok(after.gun.hits >= 4, `rounds reached Mario (${after.gun.hits} hits)`);
  // THE MECHANIC: he was moved, in the direction of flight. Not killed — moved.
  const moved = after.x - aim.snap.x;
  assert.ok(moved > 8, `the burst shoved him ${moved.toFixed(1)}px downrange`);
  assert.equal(after.lives, 3, 'a round costs no life');
  assert.equal(after.power, aim.snap.power, 'and no power-up');
  assert.equal(after.dead, false);
  assert.notEqual(after.state, 'dying');

  assert.deepEqual(ctx.mario.errors, []);
  assert.deepEqual(ctx.pilot.errors, []);
  assert.deepEqual(ctx.server.serverErrors, []);
});

// THE WHOLE REASON THE GUN SHOVES INSTEAD OF HURTING: the bullet is not the
// weapon, the hole is. A crater and a burst together, which is the only thing
// either of them is really for.
//
// The crater goes five tiles downrange of the spawn — clear of the spawn
// sanctuary, which protects the spawn column plus two left and three right
// (src/wings/sanctuary.js) and would otherwise refuse the hole. The approach is
// from off the western edge of the island, over open water, which is also the
// only place in the suite that proves a round crossing the level boundary is
// not stopped by the engine's edge wall.
const CRATER_TX = 8.5;

test('the bullet does not kill him; the crater does', async (t) => {
  const ctx = await bootRoom({ room: 'ACDF', seed: 7 });
  t.after(() => shutdownRoom(ctx));
  assert.equal(await ctx.mario.page.evaluate(startPlaying), 'playing');

  const perch = await ctx.mario.page.evaluate((craterTx) => {
    const w = window.__GAME.world;
    const solid = (cx, cy) => {
      const r = w.recAt(cx, cy);
      return !!(r && (r.solid || r.platform));
    };
    // Centred on the BOTTOM row, so the disc takes the whole depth of the
    // floor out rather than scooping a dent in the top of it: a dent is not a
    // pit, and he would simply land in it and walk out again.
    const keys = window.__GAME.blast(craterTx * 16, (w.h - 0.5) * 16, 2);
    const holed = !solid(Math.round(craterTx), w.h - 1);
    const p = w.player;
    return { keys: keys.length, holed, x: p.x, y: p.y, lives: w.lives };
  }, CRATER_TX);
  assert.ok(perch.keys > 0, 'the bomb took the floor out');
  assert.ok(perch.holed, 'and took it out all the way down');

  const aim = await aimAt(ctx);
  // A long approach, because the shove accumulates only while the aeroplane is
  // still short of him: once it is past, its rounds are going away from him.
  const { flown, after } = await strafingRun(ctx, aim, {
    lead: 400, ticks: 165, settle: 240,
  });
  assert.ok(flown.fired >= 20, `the gun fired (${flown.fired} rounds)`);

  assert.ok(after.gun.hits > 0, `rounds reached him (${after.gun.hits} hits)`);
  // Shoved off solid ground into the hole the aeroplane made, and the FALL did
  // what the bullets deliberately will not.
  assert.ok(
    after.lives < perch.lives || after.state === 'dying' || after.y > perch.y + 32,
    `pushed into the crater: lives ${perch.lives}->${after.lives}, ` +
      `x ${perch.x}->${after.x.toFixed(1)}, y ${perch.y}->${after.y.toFixed(1)}, ` +
      `state ${after.state}, ${after.gun.hits} hits`
  );

  assert.deepEqual(ctx.mario.errors, []);
  assert.deepEqual(ctx.pilot.errors, []);
  assert.deepEqual(ctx.server.serverErrors, []);
});
