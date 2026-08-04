import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../src/core/constants.js';
import { getLevel, ORDER } from '../../src/data/levels/index.js';
import {
  ARCHIPELAGO, worldIds, seedFor, layoutArchipelago, Archipelago,
} from '../../src/wings/archipelago.js';
import { WingsSim, SQUADRON } from '../../src/wings/sim.js';

test('a world is its four levels, in order', () => {
  assert.deepEqual(worldIds(1), ['1-1', '1-2', '1-3', '1-4']);
  assert.deepEqual(worldIds(8), ['8-1', '8-2', '8-3', '8-4']);
  assert.equal(ARCHIPELAGO.ISLANDS_PER_WORLD, 4);
  assert.equal(ARCHIPELAGO.WORLDS, 8);
});

// The shape of the game is READ from the level registry, not written down here:
// upstream keeps adding levels (h-1 landed on 2026-08-04) and a hard-coded 32
// would either miss a new world or invent one that has no levels behind it.
test('the size of the game is read from the level registry', () => {
  const worlds = new Set(ORDER.map((id) => id.split('-')[0]));
  assert.equal(ARCHIPELAGO.WORLDS, worlds.size);
  assert.deepEqual(
    worldIds(1).concat(...[2, 3, 4, 5, 6, 7, 8].map(worldIds)),
    ORDER.slice(0, 4).concat(ORDER.slice(4)),
  );
});

test('a world nobody has drawn yet is not an ocean', () => {
  assert.deepEqual(worldIds(9), []);
  assert.throws(() => layoutArchipelago(9, 1), /world 9/);
});

test('every world in the game lays out', () => {
  for (let w = 1; w <= ARCHIPELAGO.WORLDS; w++) {
    const slots = layoutArchipelago(w, 12345);
    assert.equal(slots.length, 4, `world ${w} is short of islands`);
    for (const s of slots) assert.ok(getLevel(s.id), `${s.id} is not a real level`);
  }
});

// A world that did not exist when this was written must lay out with no change
// here: the only thing archipelago.js knows about a level is its id and width.
test('a world that arrives from upstream later still lays out', () => {
  const slots = layoutArchipelago(1, 5150, ['h-1', '1-2', 'h-1', '1-4']);
  assert.deepEqual(slots.map((s) => s.id), ['h-1', '1-2', 'h-1', '1-4']);
  assert.equal(slots[0].width, getLevel('h-1').width * TILE);
  for (let i = 1; i < slots.length; i++) {
    const gap = slots[i].x - slots[i - 1].x1;
    assert.ok(gap >= ARCHIPELAGO.MIN_GAP && gap <= ARCHIPELAGO.MAX_GAP);
  }
});

test('islands run left to right with real ocean between them', () => {
  const slots = layoutArchipelago(3, 0xbeef);
  assert.equal(slots[0].x, ARCHIPELAGO.FIRST_X);
  for (let i = 1; i < slots.length; i++) {
    const gap = slots[i].x - slots[i - 1].x1;
    assert.ok(gap >= ARCHIPELAGO.MIN_GAP, `gap ${gap} is too short to be a crossing`);
    assert.ok(gap <= ARCHIPELAGO.MAX_GAP, `gap ${gap} is a boring flight`);
  }
  assert.equal(slots[1].width, getLevel('3-2').width * TILE);
});

test('the layout is a pure function of seed and world', () => {
  const a = layoutArchipelago(2, 777).map((s) => s.x);
  const b = layoutArchipelago(2, 777).map((s) => s.x);
  assert.deepEqual(a, b, 'same seed, same ocean');
  assert.notDeepEqual(a, layoutArchipelago(2, 778).map((s) => s.x), 'the seed must matter');
  assert.notDeepEqual(a, layoutArchipelago(3, 777).map((s) => s.x), 'the world must matter');
});

test('seedFor never returns a dead seed', () => {
  for (let w = 1; w <= 8; w++) assert.ok(seedFor(0, w) >>> 0 > 0, `world ${w} got seed 0`);
  assert.equal(seedFor(5, 2), seedFor(5, 2));
});

test('an archipelago hands out real islands', () => {
  const arch = new Archipelago({ seed: 99, world: 1 });
  const isles = arch.islands();
  assert.deepEqual(isles.map((i) => i.id), ['1-1', '1-2', '1-3', '1-4']);
  assert.equal(isles[0].x0, ARCHIPELAGO.FIRST_X);
  assert.ok(isles[0].blocksTile(30, 13), 'island 1-1 should still have its ground');
});

test('craters are remembered and re-applied to a rebuilt island', () => {
  const arch = new Archipelago({ seed: 99, world: 1 });
  const isle = arch.islands()[0];
  const keys = isle.blast(isle.x0 + 30 * TILE + 8, isle.y0 + 13 * TILE + 8, 2);
  assert.ok(keys.length > 0, 'the blast removed nothing');
  arch.record('1-1', keys);
  const rebuilt = arch.islands()[0];
  assert.ok(!rebuilt.blocksTile(30, 13), 'the crater did not survive the rebuild');
  assert.deepEqual(arch.damageFor('1-1'), [...keys].sort());
});

test('sailing lays out the next world and keeps the log', () => {
  const arch = new Archipelago({ seed: 99, world: 1 });
  arch.record('1-1', ['30,13']);
  assert.equal(arch.sail(), true);
  assert.equal(arch.world, 2);
  assert.deepEqual(arch.islands().map((i) => i.id), ['2-1', '2-2', '2-3', '2-4']);
  assert.deepEqual(arch.damageFor('1-1'), ['30,13'], 'a sunk world is still part of the record');
  assert.deepEqual(arch.damageFor('2-1'), [], 'the new world starts whole');
});

test('there is nothing past world 8', () => {
  const arch = new Archipelago({ seed: 1, world: 8 });
  assert.equal(arch.sail(), false, 'sailing past 8-4 is Mario winning, not a ninth ocean');
  assert.equal(arch.world, 8, 'a refused sail must not move the group');
});

test('an archipelago round-trips through JSON', () => {
  const arch = new Archipelago({ seed: 4242, world: 3 });
  arch.record('3-1', ['10,12', '11,12']);
  const clone = Archipelago.fromJSON(JSON.parse(JSON.stringify(arch.toJSON())));
  assert.equal(clone.world, 3);
  assert.equal(clone.seed, arch.seed);
  assert.deepEqual(clone.damageFor('3-1'), ['10,12', '11,12']);
  assert.deepEqual(clone.islands().map((i) => i.x0), arch.islands().map((i) => i.x0));
});

test('an explicit island list still works, for the bots and the old tests', () => {
  const arch = new Archipelago({ seed: 1, world: 1, ids: ['1-1', '2-1'] });
  assert.deepEqual(arch.islands().map((i) => i.id), ['1-1', '2-1']);
});

test('the sim builds its ocean from an archipelago', () => {
  const sim = new WingsSim({ seed: 7, world: 1 });
  assert.deepEqual(sim.islands.map((i) => i.id), ['1-1', '1-2', '1-3', '1-4']);
  assert.equal(sim.archipelago.world, 1);
  assert.ok(sim.bounds.maxX > sim.islands[3].x1, 'the world must run past the last island');
  assert.equal(sim.islandById('1-3').id, '1-3');
});

test('the sim sails, replenishes the squadron and spots a fresh aircraft', () => {
  const sim = new WingsSim({ seed: 7, world: 1 });
  sim.squadron = 2;
  assert.equal(sim.sail(), true);
  assert.deepEqual(sim.islands.map((i) => i.id), ['2-1', '2-2', '2-3', '2-4']);
  assert.equal(sim.squadron, SQUADRON, 'a new archipelago is a new squadron (spec 3.4)');
  assert.equal(sim.plane.mode, 'deck');
  assert.equal(sim.shots.length, 0, 'ordnance from the last world must not follow the group');
  assert.ok(sim.events.some((e) => e.type === 'worldCleared'));
});

test('the sim refuses to sail past world 8', () => {
  const sim = new WingsSim({ seed: 7, world: 8 });
  assert.equal(sim.sail(), false);
  assert.deepEqual(sim.islands.map((i) => i.id), ['8-1', '8-2', '8-3', '8-4']);
});

// Two clients build their own Archipelago from the same match seed and never
// exchange the layout. If these ever differ the two players are bombing
// different oceans, which no amount of state sync can repair.
test('two clients from the same match seed agree about every world', () => {
  for (let w = 1; w <= ARCHIPELAGO.WORLDS; w++) {
    const a = new Archipelago({ seed: 0xc0ffee, world: w });
    const b = new Archipelago({ seed: 0xc0ffee, world: w });
    assert.deepEqual(a.islands().map((i) => i.x0), b.islands().map((i) => i.x0));
  }
  // And sailing there is the same ocean as starting there.
  const sailed = new Archipelago({ seed: 0xc0ffee, world: 1 });
  sailed.sail();
  sailed.sail();
  const joined = new Archipelago({ seed: 0xc0ffee, world: 3 });
  assert.deepEqual(sailed.islands().map((i) => i.x0), joined.islands().map((i) => i.x0));
});
