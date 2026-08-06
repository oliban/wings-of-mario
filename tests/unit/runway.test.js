import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../src/core/constants.js';
import { getLevel, LEVELS } from '../../src/data/levels/index.js';
import {
  ISLAND_TOP_Y, PLANE_W, PLANE_H, restY, WHEEL_DROP, WHEEL_SINK, SEA_Y,
} from '../../src/wings/geo.js';
import { MODE, FLIGHT, createPlane, stepPlane } from '../../src/wings/flight.js';
import { LANDING } from '../../src/wings/carrier.js';
import { Island } from '../../src/wings/island.js';
import {
  MIN_RUNWAY_TILES, RUNWAY, ISLAND_OUTCOME,
  rolloutPx, surfaceRow, groundRow, runwayAt, runways, runwayUnder,
  inRunwayBox, islandVerdict, touchdown, stepGroundRoll,
} from '../../src/wings/runway.js';
import { WingsSim } from '../../src/wings/sim.js';
import { autoLandIsland, takeoff } from '../../src/wings/bot.js';

const ORIGIN = 3000;

// A hand-built island: `rows` are tile-character strings, padded to 15 rows so
// the geometry matches a real level's band.
function fakeIsland(rows, originX = ORIGIN) {
  const width = Math.max(...rows.map((r) => r.length));
  const tiles = rows.map((r) => r.padEnd(width, '.'));
  while (tiles.length < 15) tiles.push('.'.repeat(width));
  return new Island({ id: 'fake', width, tiles }, originX);
}

// A strip of `n` ground tiles (two rows deep) on row 13, starting at column 2.
function stripIsland(n, { gapAt = null, bumpAt = null } = {}) {
  const width = n + 6;
  let row13 = '';
  let row14 = '';
  let row12 = '';
  for (let tx = 0; tx < width; tx++) {
    const on = tx >= 2 && tx < 2 + n && tx !== gapAt;
    row13 += on ? '#' : '.';
    row14 += on ? '#' : '.';
    row12 += tx === bumpAt ? '#' : '.';
  }
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push('.'.repeat(width));
  rows.push(row12, row13, row14);
  return fakeIsland(rows);
}

// ---------------------------------------------------------------------------
// How much ground it takes
// ---------------------------------------------------------------------------

test('rolloutPx is stepRoll\'s own arithmetic, not an approximation of it', () => {
  // Roll a REAL aeroplane with the throttle shut and measure how far it goes.
  // This is what keeps the private ROLL_STOP copy in runway.js honest.
  const p = createPlane({ mode: MODE.ROLL, x: 0, speed: LANDING.MAX_SPEED });
  const x0 = p.x;
  for (let i = 0; i < 5000 && p.mode !== MODE.DECK; i++) stepPlane(p, { thrust: 0 });
  assert.equal(p.mode, MODE.DECK, 'it should come to a stop');
  assert.ok(
    Math.abs((p.x - x0) - rolloutPx(LANDING.MAX_SPEED)) < 0.5,
    `measured ${p.x - x0}, predicted ${rolloutPx(LANDING.MAX_SPEED)}`,
  );
});

test('the minimum strip is the wire-window rollout plus the aeroplane plus margin', () => {
  const needed = rolloutPx(LANDING.MAX_SPEED) + PLANE_W;
  assert.ok(MIN_RUNWAY_TILES * TILE > needed, 'a strip must swallow the rollout');
  assert.ok(
    MIN_RUNWAY_TILES * TILE - needed >= 4 * TILE,
    'and have several tiles of slack on top of it',
  );
  // Guard the headline number itself: if it moves, the level survey below and
  // the design call it encodes both need re-reading.
  assert.equal(MIN_RUNWAY_TILES, 17);
});

// ---------------------------------------------------------------------------
// Finding a strip
// ---------------------------------------------------------------------------

test('the surface of a column is the topmost tile that would stop an aeroplane', () => {
  const isle = stripIsland(20, { bumpAt: 4 });
  assert.equal(surfaceRow(isle, 3), 13);
  assert.equal(surfaceRow(isle, 4), 12, 'a floating block is the surface of its own column');
  assert.equal(surfaceRow(isle, 0), null, 'open sky');
  assert.equal(surfaceRow(isle, -1), null);
  assert.equal(surfaceRow(isle, isle.w), null);
});

test('scenery is not a surface', () => {
  // 'o' is a coin: drawn, destructible, and not something a plane hits.
  const isle = fakeIsland([
    '..........',
    'oooooooooo',
    ...Array.from({ length: 11 }, () => '..........'),
    '##########',
    '##########',
  ]);
  assert.equal(surfaceRow(isle, 3), 13, 'the coin row is passed straight through');
});

test('a one-tile lid over a hollow level is not ground', () => {
  const isle = fakeIsland(['..........', '..........', '##########']);
  assert.equal(surfaceRow(isle, 3), 2);
  assert.equal(groundRow(isle, 3), null, 'nothing underneath it');
  assert.equal(runwayAt(isle, 3), null);
});

test('a strip has to be long enough, unbroken and flat', () => {
  const long = stripIsland(MIN_RUNWAY_TILES);
  const r = runwayAt(long, 5);
  assert.ok(r, 'exactly the minimum is a runway');
  assert.equal(r.tiles, MIN_RUNWAY_TILES);
  assert.equal(r.ty, 13);
  assert.equal(r.tx0, 2);
  assert.equal(r.y, ISLAND_TOP_Y + 13 * TILE);
  assert.equal(r.x0, ORIGIN + 2 * TILE);
  assert.equal(r.x1, ORIGIN + (r.tx1 + 1) * TILE);

  assert.equal(runwayAt(stripIsland(MIN_RUNWAY_TILES - 1), 5), null, 'one tile short');

  // A hole in the middle leaves two runs, each too short.
  const holed = stripIsland(MIN_RUNWAY_TILES + 4, { gapAt: 10 });
  assert.equal(runwayAt(holed, 5), null);
  assert.equal(runwayAt(holed, 12), null);

  // A single block standing on it does the same, because that column's surface
  // is the block and not the ground.
  const bumped = stripIsland(MIN_RUNWAY_TILES + 4, { bumpAt: 10 });
  assert.equal(runwayAt(bumped, 5), null);
});

test('runwayUnder only answers for wheels near the surface', () => {
  const isle = stripIsland(30);
  const r = runwayAt(isle, 5);
  const px = r.x0 + 100;
  assert.ok(runwayUnder(isle, px, r.y), 'right on it');
  assert.ok(runwayUnder(isle, px, r.y - LANDING.Y_TOLERANCE), 'top of the band');
  assert.equal(runwayUnder(isle, px, r.y - LANDING.Y_TOLERANCE - 1), null, 'still flying');
  assert.equal(runwayUnder(isle, px, r.y + LANDING.Y_TOLERANCE + 1), null, 'already through it');
  assert.equal(runwayUnder(isle, r.x0 - 200, r.y), null, 'off the west end, over water');
});

// ---------------------------------------------------------------------------
// Which levels actually have one
// ---------------------------------------------------------------------------

test('a level with a long flat floor can be landed on, and one without cannot', () => {
  // THIS ASSERTED THE OPPOSITE — that most levels have no strip and world 1 has
  // exactly one, on 1-4. That fell out of taking the TOPMOST blocking tile as
  // the surface, so a single question block or brick row four rows overhead
  // broke the run beneath it. Eighteen levels had no runway at all and the
  // aeroplane simply flew into the ground. A pilot lands on the road, under the
  // overhead signs: the surface is the floor, and what is above it is an
  // obstacle to clear.
  const landable = Object.keys(LEVELS)
    .filter((id) => runways(new Island(getLevel(id), ORIGIN)).length > 0);

  // 1-1 is the case the user hit. Its floor is long and flat and it is now
  // landable, brick rows and all.
  assert.ok(landable.includes('1-1'), '1-1 still has nowhere to put an aeroplane down');

  // Still not everywhere: it is meant to be somewhere you look for, and a
  // level of pits and stairs has no run long enough.
  assert.ok(landable.length < Object.keys(LEVELS).length,
    'every level is landable, which makes the strip meaningless');
  for (const id of ['1-3', '5-3', '8-2']) {
    assert.ok(!landable.includes(id), `${id} should have no strip long enough`);
  }
});

test('headroom is required, so a pipe is not a runway', () => {
  // The other half of "the floor is the surface": without a clearance rule the
  // ground under a pipe or a low ledge would count, and the aeroplane could
  // never get down to it.
  const isle = new Island(getLevel('1-1'), ORIGIN);
  for (const r of runways(isle)) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      for (let d = 1; d <= RUNWAY.CLEAR_TILES; d++) {
        assert.equal(isle.blocksTile(tx, r.ty - d), false,
          `${tx},${r.ty - d} is over the strip and solid`);
      }
    }
  }
});

test('bombing a strip destroys it', () => {
  const isle = new Island(getLevel('1-4'), ORIGIN);
  const before = runways(isle);
  assert.ok(before.length >= 1);
  const r = before[0];
  // One bomb in the middle of it.
  const cx = (r.x0 + r.x1) / 2;
  const keys = isle.blast(cx, r.y + TILE / 2, 2);
  assert.ok(keys.length, 'the blast took tiles');
  const after = runways(isle);
  assert.ok(
    !after.some((s) => s.tx0 === r.tx0 && s.tiles === r.tiles),
    'the strip he was going to land on is not there any more',
  );
});

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

function planeOn(r, over = {}) {
  return createPlane({
    mode: MODE.AIR,
    x: r.x0 + 64,
    y: restY(r.y),
    angle: 0,
    speed: LANDING.APPROACH_SPEED,
    gear: true,
    ...over,
  });
}

test('off the strip is no verdict at all', () => {
  const isle = stripIsland(30);
  const r = runwayAt(isle, 5);
  const high = planeOn(r, { y: restY(r.y) - 100 });
  const v = islandVerdict(high, r);
  assert.equal(v.inBox, false);
  assert.equal(v.outcome, ISLAND_OUTCOME.NONE);
  assert.equal(v.reason, 'off-strip');
  assert.equal(islandVerdict(planeOn(r), null).inBox, false, 'no strip, no box');
  assert.equal(inRunwayBox(planeOn(r), null), false);
});

test('wheels on the strip, level and the right way round, is a roll-out', () => {
  const isle = stripIsland(30);
  const r = runwayAt(isle, 5);
  for (const speed of [0.9, LANDING.APPROACH_SPEED, LANDING.MAX_SPEED, 4.0]) {
    const v = islandVerdict(planeOn(r, { speed }), r);
    assert.equal(v.outcome, ISLAND_OUTCOME.ROLLOUT, `speed ${speed}`);
    assert.equal(v.ok, true);
  }
});

test('the two ways to crash on a strip, in the order they are decided', () => {
  const isle = stripIsland(30);
  const r = runwayAt(isle, 5);
  // ARRIVING WESTBOUND IS NO LONGER ONE OF THEM. A strip of flat ground has no
  // opinion about which way you roll along it, the same as the carrier's wire —
  // so what is left is the nose being too far off level, either way up and
  // either way round.
  const cases = [
    [{ angle: LANDING.MAX_ANGLE + 0.01 }, 'attitude'],
    [{ angle: -LANDING.MAX_ANGLE - 0.01 }, 'attitude'],
    [{ angle: Math.PI - LANDING.MAX_ANGLE - 0.01 }, 'attitude'],
  ];
  for (const [over, reason] of cases) {
    const v = islandVerdict(planeOn(r, over), r);
    assert.equal(v.outcome, ISLAND_OUTCOME.CRASH, reason);
    assert.equal(v.reason, reason);
    assert.equal(v.ok, false);
  }

  // WHEELS UP IS NOT A CRASH, and this asserted that it was. A low strafing
  // pass over a beach wrote the aeroplane off for flying low. The gear switch
  // says "I mean to put it down here"; without it this is simply not a landing
  // and he flies on — and meets the terrain check a tick later if he really is
  // too low.
  const up = islandVerdict(planeOn(r, { gear: false }), r);
  assert.equal(up.outcome, ISLAND_OUTCOME.NONE);
  assert.equal(up.reason, 'gear-up');
  // IN the box, though — and this asserted otherwise. Saying "not in the box"
  // re-armed the latch that stops him landing twice, so a takeoff went: rotate,
  // gear up, latch re-arms, the player's HELD gear toggle lowers the wheels
  // again on the very next tick, and the strip lands him a second time. Every
  // tick. He never climbed away: "it just keeps going straight without taking
  // off."
  assert.equal(up.inBox, true, 'a gear-up pass over a strip must not re-arm the latch');
  // ORDERING: a nose-down arrival is fatal whatever the gear is doing, and must
  // not be reported as a raised undercarriage. (Backwards is no longer fatal at
  // all — it is a landing like any other.)
  assert.equal(
    islandVerdict(planeOn(r, { angle: LANDING.MAX_ANGLE + 0.3, gear: false }), r).reason,
    'attitude',
  );
});

test('a strip can be rolled along in either direction', () => {
  // "same goes on islands." A westbound arrival lands, rolls west, and ends the
  // run at the far END of the strip rather than at the end the eastbound run
  // uses — which in deck space is a different x, because stepGroundRoll
  // translates the strip onto the deck.
  const isle = stripIsland(30);
  const r = runwayAt(isle, 5);

  const west = islandVerdict(planeOn(r, { angle: Math.PI }), r);
  assert.equal(west.outcome, ISLAND_OUTCOME.ROLLOUT, 'a westbound arrival was refused');
  assert.equal(west.ok, true);

  const p = planeOn(r, { angle: Math.PI, speed: LANDING.APPROACH_SPEED });
  touchdown(p, r);
  assert.equal(p.rollDir, -1, 'the roll runs the wrong way');
  assert.equal(p.angle, Math.PI, 'he was spun round to face east');

  const east = planeOn(r, { angle: 0, speed: LANDING.APPROACH_SPEED });
  touchdown(east, r);
  assert.equal(east.rollDir, 1);
  // Both ends of the strip are carried, in deck space, so a roll knows where it
  // runs out whichever way it is going — and so an aeroplane parked at one end
  // can turn round and find the other.
  assert.ok(p.rollMax > p.rollMin, 'the strip has no length in deck space');
  assert.equal(east.rollMin, p.rollMin);
  assert.equal(east.rollMax, p.rollMax);
});

// ---------------------------------------------------------------------------
// Rolling on it
// ---------------------------------------------------------------------------

test('touchdown puts the wheels on the strip and keeps the speed', () => {
  const isle = stripIsland(30);
  const r = runwayAt(isle, 5);
  const p = planeOn(r, { speed: 1.5, angle: 0.1 });
  touchdown(p, r);
  assert.equal(p.mode, MODE.ROLL);
  // THE WHEELS on the strip, not the collision box: the tyres hang 5.3px below
  // the box and used to be buried that deep in the ground. Two pixels in reads
  // as contact.
  assert.ok(Math.abs((p.y + PLANE_H + WHEEL_DROP) - (r.y + WHEEL_SINK)) < 0.01,
    'the wheels are not resting on the strip');
  assert.equal(p.angle, 0);
  assert.equal(p.speed, 1.5, 'nothing here is a wire');
  assert.equal(p.gear, true);
});

test('a ground roll is the deck roll: same distance, on the ground', () => {
  const isle = stripIsland(40);
  const r = runwayAt(isle, 5);
  const p = planeOn(r, { speed: LANDING.MAX_SPEED });
  touchdown(p, r);
  const x0 = p.x;
  for (let i = 0; i < 5000 && p.mode !== MODE.DECK; i++) stepGroundRoll(p, { thrust: 0 }, r);
  assert.equal(p.mode, MODE.DECK, 'it stops');
  assert.ok(Math.abs((p.y + PLANE_H + WHEEL_DROP) - (r.y + WHEEL_SINK)) < 0.01,
    'it stops at deck height rather than on the ground');
  assert.ok(Math.abs((p.x - x0) - rolloutPx(LANDING.MAX_SPEED)) < 0.5);
  assert.ok(p.x + PLANE_W < r.x1, 'inside the strip, which is what the minimum length buys');
});

test('a strip that runs out puts him back in the air, exactly like the bow', () => {
  const isle = stripIsland(40);
  const r = runwayAt(isle, 5);
  // Touch down at the far end with far too much speed.
  const p = planeOn(r, { x: r.x1 - 80, speed: 5 });
  touchdown(p, r);
  for (let i = 0; i < 200 && p.mode !== MODE.AIR; i++) stepGroundRoll(p, { thrust: 0 }, r);
  assert.equal(p.mode, MODE.AIR);
  assert.equal(p.gear, false, 'wheels up, as off the deck');
  assert.ok(p.x >= r.x1);
});

test('he can take off again along the ground he stopped on', () => {
  const isle = stripIsland(60);
  const r = runwayAt(isle, 5);
  const p = planeOn(r, { speed: 1.0 });
  touchdown(p, r);
  for (let i = 0; i < 600 && p.mode !== MODE.DECK; i++) stepGroundRoll(p, { thrust: 0 }, r);
  assert.equal(p.mode, MODE.DECK, 'parked');
  const parkedAt = p.x;
  for (let i = 0; i < 900 && p.mode !== MODE.AIR; i++) {
    stepGroundRoll(p, { thrust: 1, pitch: p.speed >= FLIGHT.TAKEOFF_SPEED ? 1 : 0 }, r);
  }
  assert.equal(p.mode, MODE.AIR, 'off again');
  assert.ok(p.x > parkedAt);
  assert.ok(p.y + PLANE_H <= r.y, 'climbing away from the ground, not through it');
});

// ---------------------------------------------------------------------------
// In the sim
// ---------------------------------------------------------------------------

// The pilot's ocean, with one island whose strip we know.
function simOn(id) {
  const sim = new WingsSim({ islands: [id] });
  const isle = sim.islandById(id);
  const strips = runways(isle);
  return { sim, isle, r: strips.reduce((a, b) => (b.tiles > a.tiles ? b : a)) };
}

// Fly it in by hand: put the aeroplane one tick short of the strip, level, with
// the wheels down, and let the sim decide.
function arrive(sim, r, over = {}) {
  const p = sim.plane;
  p.mode = MODE.AIR;
  p.x = r.x0 + 64;
  p.y = restY(r.y);
  p.angle = 0;
  p.speed = LANDING.APPROACH_SPEED;
  p.gear = true;
  p.vx = p.speed;
  p.vy = 0;
  Object.assign(p, over);
  return sim;
}

test('the sim lands an aeroplane on an island and does NOT resupply it', () => {
  const { sim, r } = simOn('1-4');
  sim.loadout.bomb = 1;
  sim.plane.fuel = 30;
  const squadron = sim.squadron;
  arrive(sim, r);
  sim.step({ gear: true });

  assert.ok(sim.groundRoll, 'it is on the strip');
  assert.equal(sim.groundRoll.island, '1-4');
  assert.equal(sim.squadron, squadron, 'nothing was lost');
  assert.ok(sim.events.some((e) => e.type === 'islandLanding'));

  for (let i = 0; i < 3000 && !sim.grounded; i++) sim.step({ gear: true });
  assert.ok(sim.grounded, 'stopped');
  assert.equal(sim.plane.mode, MODE.DECK);
  assert.equal(sim.events.filter((e) => e.type === 'islandLanded').length, 1,
    'announced once, not once a tick');
  assert.ok(!sim.events.some((e) => e.type === 'landed'), 'it is not a carrier landing');
  assert.equal(sim.loadout.bomb, 1, 'no rearm: the bombs are on the ship');
  assert.ok(sim.plane.fuel < 30, 'no refuel either');
  assert.equal(sim.state().ground.parked, true);
});

test('an arrival at the bottom of the tolerance band is a landing, not a hillside', () => {
  // Wheels the full LANDING.Y_TOLERANCE into the surface puts the NOSE inside
  // the tile they are resting on. This is the whole reason the strip is asked
  // about before the hillside is: in the other order the aeroplane is written
  // off for a landing that is inside the envelope.
  const { sim, r } = simOn('1-4');
  arrive(sim, r, { y: r.y + LANDING.Y_TOLERANCE - PLANE_H });
  sim.step({ gear: true });
  assert.notEqual(sim.plane.mode, MODE.DOWN, 'it is a landing');
  assert.ok(sim.groundRoll);
  assert.equal(sim.plane.y, restY(r.y), 'and the wheels are put back on the surface');
});

test('a parked aeroplane flies off the island again', () => {
  const { sim, r } = simOn('1-4');
  arrive(sim, r, { x: r.x0 + 32, speed: 1.0 });
  for (let i = 0; i < 3000 && !sim.grounded; i++) sim.step({ gear: true });
  assert.ok(sim.grounded);
  assert.ok(takeoff(sim, 2000), 'back in the air');
  assert.equal(sim.groundRoll, null, 'the strip is behind him');
  assert.equal(sim.state().ground, null);
});

test('the ways to arrive badly still cost an aeroplane', () => {
  for (const [over, reason] of [
    [{ angle: LANDING.MAX_ANGLE + 0.2 }, 'island-attitude'],
    [{ angle: -LANDING.MAX_ANGLE - 0.2 }, 'island-attitude'],
  ]) {
    const { sim, r } = simOn('1-4');
    const squadron = sim.squadron;
    arrive(sim, r, over);
    sim.step({ gear: over.gear !== false });
    assert.equal(sim.plane.mode, MODE.DOWN, reason);
    assert.equal(sim.squadron, squadron - 1);
    assert.equal(sim.events.at(-1).type, 'planeLost');
    assert.equal(sim.events.at(-1).reason, reason);
    assert.equal(sim.groundRoll, null);
  }
});

test('flying into ground that is not a strip is still a crash', () => {
  // 1-3 has no run long enough: pits and stairs the whole way.
  const sim = new WingsSim({ islands: ['1-3'] });
  const isle = sim.islandById('1-3');
  assert.deepEqual(runways(isle), [], '1-3 has nowhere to land');
  const p = sim.plane;
  p.mode = MODE.AIR;
  p.x = isle.originX + 10 * TILE;
  // Nose buried in the shelf. The nose is what decides a hillside, so an
  // aeroplane whose WHEELS are exactly on the surface is still flying — this
  // has to be a genuine impact, not a landing the strip rules declined.
  // Column 10 of 1-3 has its floor on row 14.
  p.y = ISLAND_TOP_Y + 14 * TILE - 2;
  p.angle = 0;
  p.speed = LANDING.APPROACH_SPEED;
  p.gear = true;
  sim.step({ gear: true });
  assert.equal(sim.plane.mode, MODE.DOWN);
  assert.equal(sim.events.at(-1).reason, 'island');
});

test('an island landing does not touch the carrier', () => {
  const { sim, r } = simOn('1-4');
  arrive(sim, r);
  for (let i = 0; i < 3000 && !sim.grounded; i++) sim.step({ gear: true });
  assert.ok(sim.grounded);
  assert.equal(sim.bolters, 0);
  assert.equal(sim.rolling, false);
  assert.equal(sim.hookArmed, false);
  assert.equal(sim.status, 'ready');
  assert.ok(sim.plane.x > 2000, 'still out at the island, not teleported to the deck');
  assert.ok(sim.plane.y + PLANE_H < SEA_Y);
});

// ---------------------------------------------------------------------------
// Flown, not placed
// ---------------------------------------------------------------------------

test('a scripted pilot can find a strip and put the aeroplane down on it', () => {
  const sim = new WingsSim({ islands: ['1-4'] });
  assert.ok(takeoff(sim), 'off the deck');
  assert.ok(autoLandIsland(sim, '1-4'), 'down on the island');
  assert.equal(sim.plane.mode, MODE.DECK);
  assert.ok(sim.groundRoll, 'and parked on a strip, not on the ship');
  assert.equal(sim.plane.y, restY(sim.groundRoll.y));
  assert.equal(sim.squadron, 5, 'no aeroplane was lost doing it');
});

test('the scripted pilot cannot land on an island that has no strip', () => {
  const sim = new WingsSim({ islands: ['1-1'] });
  assert.equal(autoLandIsland(sim, '1-1'), false);
});

test('the same aeroplane takes off from the island and lands back on the ship', () => {
  const sim = new WingsSim({ islands: ['1-4'] });
  assert.ok(takeoff(sim));
  assert.ok(autoLandIsland(sim, '1-4'));
  const fuelOnTheGround = sim.plane.fuel;
  assert.ok(takeoff(sim, 2000), 'off the island');
  assert.ok(sim.plane.fuel < fuelOnTheGround, 'he never got a drop of fuel out of it');
  assert.equal(sim.squadron, 5);
});

// RUNWAY.DEPTH_TILES and RUNWAY.SCAN_TILES are read by the walk above; keep the
// object exported and non-empty so a rename cannot silently pass.
test('the strip rules are stated, not implied', () => {
  assert.equal(RUNWAY.DEPTH_TILES, 2);
  assert.ok(RUNWAY.SCAN_TILES > MIN_RUNWAY_TILES * 2);
});

// ---------------------------------------------------------------------------
// Scuttling: the way off a strip you cannot take off from
// ---------------------------------------------------------------------------

test('a pilot parked on an island with a dry tank can abandon the airframe', async (t) => {
  // THE DEAD END AN ISLAND LANDING CREATES. Landing on a strip deliberately
  // does not refuel — the carrier is where the fuel is — so a pilot who puts
  // down empty makes no power and can never take off again. Nothing wrote him
  // off, so he sat there for the rest of the match.
  const { WingsSim } = await import('../../src/wings/sim.js');
  const { takeoff } = await import('../../src/wings/bot.js');
  const { autoLandIsland } = await import('../../src/wings/bot.js');

  const sim = new WingsSim({ islands: ['1-4'] });
  assert.equal(takeoff(sim), true);
  assert.equal(autoLandIsland(sim, '1-4'), true, 'never got down on the island');
  assert.equal(sim.grounded, true);

  const before = sim.squadron;
  sim.plane.fuel = 0; // the case this exists for
  assert.equal(sim.canScuttle(), true, 'a parked aeroplane cannot be abandoned');
  assert.equal(sim.scuttle(), true);

  // It COSTS an aircraft, exactly as ditching does. Free would make it a
  // teleport home from any flat ground, and the return leg optional.
  assert.equal(sim.squadron, before - 1, 'scuttling was free');
  assert.equal(sim.plane.mode, MODE.DECK, 'the new aeroplane is not on the deck');
  assert.equal(sim.grounded, false, 'still marked as parked on an island');
  assert.ok(sim.plane.fuel > 0, 'the replacement came with a dry tank');
});

test('scuttling is refused anywhere it would be a free ride home', async () => {
  const { WingsSim } = await import('../../src/wings/sim.js');
  const sim = new WingsSim({ islands: ['1-4'] });
  // On the carrier: there is nothing to escape from.
  assert.equal(sim.canScuttle(), false, 'the deck is not a place to scuttle');
  // In the air: a free trip home from anywhere.
  sim.plane.mode = MODE.AIR;
  sim.grounded = true;
  assert.equal(sim.canScuttle(), false, 'scuttled in mid-air');
});

test('parked on an island, the engine is off and the fuel stops going down', () => {
  // "it would not refuel but it would save me fuel by standing still a bit."
  // It is the only thing an island landing is worth: no rearm, no refuel, but
  // you can stop the clock and think.
  const { sim, r } = simOn('1-4');
  arrive(sim, r);
  for (let i = 0; i < 400 && sim.plane.mode !== MODE.DECK; i++) sim.step({ gear: true });
  assert.equal(sim.plane.mode, MODE.DECK, 'never came to rest on the strip');
  assert.equal(sim.grounded, true);

  const parked = sim.plane.fuel;
  for (let i = 0; i < 600; i++) sim.step({ gear: true });
  assert.equal(sim.plane.fuel, parked, 'a parked aeroplane burned fuel');

  // But it is SHUT DOWN, not merely stopped: open the throttle and it drinks.
  for (let i = 0; i < 60; i++) sim.step({ thrust: 1, gear: true });
  assert.ok(sim.plane.fuel < parked, 'running the engine on the ground was free');
});

test('and it still does not refuel or rearm, which is the point', () => {
  const { sim, r } = simOn('1-4');
  sim.plane.fuel = 20;
  sim.loadout.bomb = 0;
  arrive(sim, r);
  for (let i = 0; i < 400 && sim.plane.mode !== MODE.DECK; i++) sim.step({ gear: true });
  assert.equal(sim.plane.mode, MODE.DECK);
  for (let i = 0; i < 200; i++) sim.step({ gear: true });
  assert.ok(sim.plane.fuel <= 20, 'the island refuelled him');
  assert.equal(sim.bombs, 0, 'the island rearmed him');
});

test('a textbook approach gets down on ordinary levels, not just the castle', () => {
  // THE USER'S REPORT: "Landing on a level makes plane crash. I want to be able
  // to." Every earlier test here flew 1-4, which was the ONE level in world 1
  // with a strip under the old surface rule — so the suite was green while the
  // levels a player actually flies over had nowhere to land at all.
  //
  // Hand-placed rather than flown: src/wings/bot.js#autoLandIsland still only
  // manages 1-4, because its approach path runs through the pipes and brick
  // rows of an overworld level. That is a limitation of the scripted pilot, not
  // of the landing, and it is why this test places the aeroplane itself.
  for (const id of ['1-1', '1-2', '2-1', '8-4']) {
    const sim = new WingsSim({ islands: [id] });
    const strips = runways(sim.islandById(id));
    assert.ok(strips.length > 0, `${id} has nowhere to put an aeroplane down`);
    const r = strips[0];
    const p = sim.plane;
    p.mode = MODE.AIR;
    p.x = r.x0 + 3 * TILE;
    p.y = restY(r.y);
    p.angle = 0;
    p.speed = LANDING.APPROACH_SPEED;
    p.vx = p.speed;
    p.vy = 0;
    p.gear = true;
    sim.groundArmed = true;

    sim.step({ gear: true });
    assert.notEqual(sim.plane.mode, MODE.DOWN, `${id}: a textbook approach crashed`);
    for (let i = 0; i < 900 && sim.plane.mode === MODE.ROLL; i++) sim.step({ gear: true });
    assert.equal(sim.plane.mode, MODE.DECK, `${id}: never came to rest`);
    assert.equal(sim.grounded, true, `${id}: not parked on the strip`);
    assert.equal(sim.squadron, 5, `${id}: landing cost an aircraft`);
  }
});

test('he can take off again from the strip he landed on', () => {
  // THE OSCILLATION THIS FIXES: rotate, gear up, latch re-arms, the player's
  // held gear toggle lowers the wheels, the strip lands him again — every tick,
  // for ever, going straight down the island.
  const { sim, r } = simOn('1-4');
  arrive(sim, r);
  sim.step({ gear: true });
  for (let i = 0; i < 900 && sim.plane.mode === MODE.ROLL; i++) sim.step({ gear: true });
  assert.equal(sim.plane.mode, MODE.DECK, 'never parked');

  const y0 = sim.plane.y;
  let modes = 0;
  let was = sim.plane.mode;
  // The gear toggle is HELD DOWN throughout, as a real pilot's is.
  for (let i = 0; i < 200 && sim.plane.mode !== MODE.DOWN; i++) {
    sim.step({ thrust: 1, pitch: 1, gear: true });
    if (sim.plane.mode !== was) { modes++; was = sim.plane.mode; }
    if (sim.plane.mode === MODE.AIR && sim.plane.y < y0 - 8) break;
  }
  assert.ok(sim.plane.y < y0 - 8, 'he never climbed away from the strip');
  assert.ok(modes <= 2, `he bounced between rolling and flying ${modes} times`);
});

test('a hidden block is not something an aeroplane can hit', () => {
  // "the plane explodes mid-air here... it is hitting the invisible brick that
  // yields an extra life." '1' and 'C' are drawn by nothing at all, and being
  // killed by something the screen does not show is a lie rather than a
  // difficulty. They stay solid for everything else.
  const level = getLevel('1-1');
  const isle = new Island(level, ORIGIN);
  let hidden = 0;
  for (let ty = 0; ty < isle.h; ty++) {
    for (let tx = 0; tx < isle.w; tx++) {
      if (!'1C'.includes(isle.charAt(tx, ty))) continue;
      hidden++;
      assert.equal(isle.blocksTile(tx, ty), true, 'a hidden block stopped being solid');
      assert.equal(isle.blocksAircraftTile(tx, ty), false,
        `the aeroplane can still die on the hidden block at ${tx},${ty}`);
    }
  }
  assert.ok(hidden > 0, '1-1 has no hidden blocks; this test proves nothing');
});
