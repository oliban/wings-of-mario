import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../src/core/constants.js';
import { SEA_Y } from '../../src/wings/geo.js';
import { tileForChar } from '../../src/data/tiles.js';
import { FERRY, Ferry, torpedoHits } from '../../src/wings/ferry.js';
import {
  FERRY_LEVEL_ID, FERRY_W, FERRY_H, DECK_ROW, DECK_TX0, DECK_TX1, SEA_ROW,
  makeFerryLevel, deckKeys, registerFerryLevel, onDeck,
} from '../../src/wings/ferry-level.js';

const ride = () => new Ferry({ fromX: 4000, toX: 7000 });

test('a crossing starts at the departure island and ends at the arrival one', () => {
  const f = ride();
  assert.equal(f.x, 4000);
  assert.equal(f.dir, 1);
  assert.equal(f.phase, 'boarding');
  assert.equal(f.y, SEA_Y - FERRY.FREEBOARD);
});

test('boarding holds the boat still, then it gets under way', () => {
  const f = ride();
  for (let t = 0; t < FERRY.BOARD_TICKS; t++) f.step();
  assert.equal(f.x, 4000, 'the boat moved before Mario was aboard');
  assert.equal(f.phase, 'crossing');
  f.step();
  assert.ok(f.x > 4000);
});

test('it arrives, exactly, and stops', () => {
  const f = ride();
  let t = 0;
  while (f.phase !== 'arrived' && t < 20000) {
    f.step();
    t++;
  }
  assert.equal(f.phase, 'arrived');
  assert.equal(f.x, 7000, 'the boat must land on its destination, not past it');
  assert.equal(t, f.total, 'total must be the number of ticks it actually takes');
  const x = f.x;
  f.step();
  assert.equal(f.x, x, 'an arrived boat must not keep sailing');
});

test('a westbound crossing works the same way round', () => {
  const f = new Ferry({ fromX: 7000, toX: 4000 });
  assert.equal(f.dir, -1);
  while (f.phase !== 'arrived') f.step();
  assert.equal(f.x, 4000);
});

test('progress runs 0 to 1 and never overshoots', () => {
  const f = ride();
  assert.equal(f.progress, 0);
  let last = 0;
  while (f.phase !== 'arrived') {
    f.step();
    assert.ok(f.progress >= last, 'progress went backwards');
    assert.ok(f.progress <= 1, 'progress passed 1');
    last = f.progress;
  }
  assert.equal(f.progress, 1);
});

test('a torpedo has to be at the boat, at sea level, to hit it', () => {
  const f = ride();
  for (let t = 0; t < FERRY.BOARD_TICKS + 200; t++) f.step();
  const at = (dx, dy) => ({ kind: 'torpedo', x: f.x + dx, y: f.y + dy });
  assert.equal(torpedoHits(f, at(0, 4)), true, 'amidships');
  assert.equal(torpedoHits(f, at(FERRY.HALF_W - 2, 4)), true, 'the bow counts');
  assert.equal(torpedoHits(f, at(FERRY.HALF_W + 40, 4)), false, 'a clean miss ahead');
  assert.equal(torpedoHits(f, at(0, -80)), false, 'a torpedo does not fly');
  assert.equal(torpedoHits(f, at(0, FERRY.HULL_H + 40)), false, 'it ran under the keel');
});

test('a boat still boarding, or already alongside, cannot be torpedoed', () => {
  const f = ride();
  const amidships = { kind: 'torpedo', x: f.x, y: f.y + 4 };
  assert.equal(torpedoHits(f, amidships), false, 'not while she is still at the jetty');
  while (f.phase !== 'arrived') f.step();
  assert.equal(torpedoHits(f, { kind: 'torpedo', x: f.x, y: f.y + 4 }), false);
});

test('a sunk boat stops dead and stays sunk', () => {
  const f = ride();
  for (let t = 0; t < FERRY.BOARD_TICKS + 100; t++) f.step();
  const x = f.x;
  assert.equal(f.sink(), true);
  assert.equal(f.phase, 'sunk');
  f.step();
  assert.equal(f.x, x, 'a sunk boat does not complete its crossing');
  assert.equal(f.sink(), false, 'sinking twice is one sinking');
});

test('the state is plain data, fit for the wire', () => {
  const f = ride();
  f.step();
  const s = f.state();
  assert.deepEqual(Object.keys(s).sort(), ['dir', 'phase', 'progress', 'ticks', 'x', 'y']);
  assert.equal(JSON.parse(JSON.stringify(s)).x, s.x);
});

test('the ferry level is a boat on open water', () => {
  const lvl = makeFerryLevel();
  assert.equal(lvl.id, FERRY_LEVEL_ID);
  assert.equal(lvl.width, FERRY_W);
  assert.equal(lvl.height, FERRY_H);
  assert.equal(lvl.tiles.length, FERRY_H);
  for (const row of lvl.tiles) assert.equal(row.length, FERRY_W, 'ragged row');
  // Exactly one screen wide, so there is nowhere to run: the camera cannot
  // scroll and the whole boat is always in shot.
  assert.equal(FERRY_W * TILE, 256);
});

test('the deck is solid, the sea is not, and the gunwales box him in', () => {
  const lvl = makeFerryLevel();
  const rec = (tx, ty) => tileForChar(lvl.tiles[ty][tx]);
  for (let tx = DECK_TX0; tx <= DECK_TX1; tx++) {
    assert.ok(rec(tx, DECK_ROW).solid, `deck column ${tx} is not solid`);
  }
  assert.ok(!rec(DECK_TX0 - 1, DECK_ROW).solid, 'there must be water off the stern');
  assert.ok(rec(DECK_TX0, DECK_ROW - 1).solid, 'no gunwale at the stern');
  assert.ok(rec(DECK_TX1, DECK_ROW - 1).solid, 'no gunwale at the bow');
  assert.equal(rec(0, SEA_ROW).name, 'water-surface');
  assert.ok(!rec(0, SEA_ROW + 1).solid, 'the sea must not be walkable');
});

test('Mario is spawned standing on the planking', () => {
  const lvl = makeFerryLevel();
  assert.ok(lvl.spawn.x > DECK_TX0 && lvl.spawn.x < DECK_TX1);
  assert.equal(lvl.spawn.y, DECK_ROW - 1);
  assert.deepEqual(lvl.entities, [], 'a ferry carries no goombas');
});

test('deckKeys covers everything a torpedo takes away', () => {
  const keys = deckKeys();
  assert.equal(keys.length, DECK_TX1 - DECK_TX0 + 1 + 2, 'planking plus two gunwales');
  assert.ok(keys.includes(`${DECK_TX0},${DECK_ROW}`));
  assert.ok(keys.includes(`${DECK_TX1},${DECK_ROW - 1}`));
  for (const k of keys) assert.match(k, /^\d+,\d+$/, 'tile keys have no spaces');
});

test('onDeck knows the difference between the boat and the water', () => {
  assert.equal(onDeck((DECK_TX0 + 1) * TILE, (DECK_ROW - 1) * TILE), true);
  assert.equal(onDeck(0, (DECK_ROW - 1) * TILE), false, 'that is the sea');
  assert.equal(onDeck((DECK_TX0 + 1) * TILE, (SEA_ROW + 1) * TILE), false, 'that is overboard');
});

test('registering is idempotent and does not clobber a real level', () => {
  const registry = {};
  const a = registerFerryLevel(registry);
  const b = registerFerryLevel(registry);
  assert.equal(a, b, 'a second call must not rebuild the level');
  assert.equal(registry[FERRY_LEVEL_ID].id, FERRY_LEVEL_ID);
  assert.equal(Object.keys(registry).length, 1, 'it must touch nothing else');
});

test('the crossing is deterministic', () => {
  const run = () => {
    const f = new Ferry({ fromX: 3000, toX: 6200 });
    const log = [];
    while (f.phase !== 'arrived') {
      f.step();
      log.push(f.state());
    }
    return JSON.stringify(log);
  };
  assert.equal(run(), run());
});
