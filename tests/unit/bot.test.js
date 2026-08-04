import test from 'node:test';
import assert from 'node:assert/strict';
import { getLevel } from '../../src/data/levels/index.js';
import { DECK_X0, DECK_X1, SEA_Y, ISLAND_TOP_Y } from '../../src/wings/geo.js';
import { MODE, FLIGHT } from '../../src/wings/flight.js';
import { ORDNANCE } from '../../src/wings/ordnance.js';
import { WingsSim } from '../../src/wings/sim.js';
import { takeoff, flyTo, bombTile, autoLand } from '../../src/wings/bot.js';

const LEVELS = () => [getLevel('1-1')];

test('takeoff gets airborne off the deck, not off the bow', () => {
  const sim = new WingsSim({ islands: LEVELS().map((l) => l.id) });
  assert.equal(takeoff(sim), true);
  assert.equal(sim.plane.mode, MODE.AIR);
  assert.ok(sim.plane.x > DECK_X0 && sim.plane.x < DECK_X1);
  assert.ok(sim.tick > 60, 'the roll should take a real second or two');
});

test('flyTo reaches a point over open water', () => {
  const sim = new WingsSim({ islands: LEVELS().map((l) => l.id) });
  takeoff(sim);
  assert.equal(flyTo(sim, 1600, 180), true);
  assert.ok(Math.abs(sim.plane.x - 1600) < 64);
  assert.ok(Math.abs(sim.plane.y - 180) < 64);
  assert.equal(sim.plane.mode, MODE.AIR, 'the autopilot ditched');
});

test('bombTile puts a crater on the tile it was asked for', () => {
  const sim = new WingsSim({ islands: LEVELS().map((l) => l.id) });
  takeoff(sim);
  assert.equal(bombTile(sim, '1-1', 20, 13), true);
  assert.equal(sim.bombs, ORDNANCE.bomb.load - 1);

  while (sim.shots.length && sim.tick < 12000) sim.step({ thrust: 1, pitch: 0 });

  const detonation = sim.events.find((e) => e.type === 'detonation');
  assert.ok(detonation, 'the bomb never went off');
  assert.equal(detonation.island, '1-1');
  assert.ok(detonation.keys.includes('20,13'), `crater missed: ${detonation.keys.join(' ')}`);
  assert.ok(!sim.islandById('1-1').blocksTile(20, 13));
  assert.ok(sim.islandById('1-1').keys().length > 0);
  assert.equal(sim.plane.mode, MODE.AIR, 'the bomb run killed the pilot');
});

test('a whole sortie: deck, island, crater, deck', () => {
  const sim = new WingsSim({ islands: LEVELS().map((l) => l.id) });
  assert.equal(takeoff(sim), true);
  assert.equal(bombTile(sim, '1-1', 20, 13), true);
  for (let i = 0; i < 200; i++) sim.step({ thrust: 1, pitch: 0 });
  assert.equal(autoLand(sim), true, 'never got home');

  assert.equal(sim.plane.mode, MODE.DECK);
  assert.equal(sim.status, 'ready');
  assert.equal(sim.squadron, 5, 'lost an aircraft on a clean sortie');
  assert.equal(sim.plane.fuel, FLIGHT.FUEL_MAX, 'landing must refuel');
  assert.equal(sim.bombs, ORDNANCE.bomb.load, 'landing must rearm');
  assert.ok(!sim.islandById('1-1').blocksTile(20, 13), 'the crater must survive the trip home');
  assert.deepEqual(
    sim.events.map((e) => e.type),
    ['released', 'detonation', 'landed']
  );
});

test('the sortie burns fuel and takes real time', () => {
  const sim = new WingsSim({ islands: LEVELS().map((l) => l.id) });
  takeoff(sim);
  bombTile(sim, '1-1', 20, 13);
  assert.ok(sim.plane.fuel < FLIGHT.FUEL_MAX, 'the outbound leg burned nothing');
  assert.ok(sim.tick > 600, 'the island should be a real flight away');
});

test('the whole sortie is deterministic', () => {
  const run = () => {
    const sim = new WingsSim({ islands: LEVELS().map((l) => l.id) });
    takeoff(sim);
    bombTile(sim, '1-1', 20, 13);
    for (let i = 0; i < 200; i++) sim.step({ thrust: 1, pitch: 0 });
    autoLand(sim);
    return JSON.stringify({
      state: sim.state(),
      keys: sim.islandById('1-1').keys(),
      events: sim.events,
    });
  };
  assert.equal(run(), run());
});

test('bots give up rather than loop forever', () => {
  const sim = new WingsSim({ islands: LEVELS().map((l) => l.id) });
  takeoff(sim);
  const before = sim.tick;
  assert.equal(flyTo(sim, 999999, 100, 200), false, 'an unreachable target must time out');
  assert.ok(sim.tick - before <= 200);
  assert.equal(bombTile(sim, 'nowhere', 1, 1), false, 'an unknown island must fail fast');
});

test('a bot that ditches reports failure instead of lying', () => {
  const sim = new WingsSim({ islands: LEVELS().map((l) => l.id) });
  takeoff(sim);
  sim.plane.y = SEA_Y - 16;
  sim.plane.angle = Math.PI / 2;
  sim.plane.speed = 3;
  assert.equal(flyTo(sim, 4000, ISLAND_TOP_Y, 600, { floor: 99999 }), false);
  assert.equal(sim.plane.mode, MODE.DOWN);
});
