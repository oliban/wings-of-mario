import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../src/core/constants.js';
import { ISLAND_TOP_Y } from '../../src/wings/geo.js';
import { MAX_CATCHUP, MarioOverlay } from '../../src/wings/mario-overlay.js';

// A world with flat ground at row 13 and a camera at the origin.
function fakeWorld(over = {}) {
  return {
    level: { id: '1-1' },
    w: 210,
    h: 15,
    rcam: { x: 0, y: 0, w: 256, h: 240 },
    player: { x: 30 * TILE, y: 12 * TILE, w: 16 },
    recAt: (tx, ty) => (ty >= 13 ? { name: 'ground', solid: true } : { name: 'air' }),
    ...over,
  };
}

function fakeApi(world) {
  return {
    world,
    game: { loop: { tick: 0 } },
    renderer: { canvas: null },
  };
}

// The overlay must never touch `document` when it cannot find one.
function headless(opts = {}) {
  const world = fakeWorld();
  const api = fakeApi(world);
  const played = [];
  const o = new MarioOverlay({ sink: (x) => played.push(x), ...opts });
  o.attach(api);
  return { o, api, world, played };
}

test('with no document there is no canvas, and nothing throws', () => {
  const { o } = headless();
  assert.equal(o.canvas, null, 'a canvas appeared out of nowhere');
  o.pump();
  o.draw();
});

test('pump advances by the engine tick delta, not by wall clock', () => {
  const { o, api } = headless();
  o.add({ id: 'a', kind: 'bomb', x: 30 * TILE, y: 20, vx: 0, vy: 0 });
  const before = o.telegraph.shots.get('a').y;
  api.game.loop.tick = 10;
  assert.equal(o.pump(), 10);
  const after = o.telegraph.shots.get('a').y;
  assert.ok(after > before, 'ten engine ticks moved the bomb nowhere');
  assert.equal(o.pump(), 0, 'a pump with no new engine ticks must do nothing');
});

test('a long stall is capped rather than run in one frame', () => {
  const { o, api } = headless();
  api.game.loop.tick = 100000;
  assert.equal(o.pump(), MAX_CATCHUP, 'a backgrounded tab must not run 100000 steps');
});

test('a rewound tick counter is treated as zero, not as a negative', () => {
  const { o, api } = headless();
  api.game.loop.tick = 50;
  o.pump();
  api.game.loop.tick = 0; // __GAME.reset() or a fresh loop
  assert.equal(o.pump(), 0);
});

test('the surface probe reads the LIVE tile map, craters included', () => {
  const world = fakeWorld();
  const api = fakeApi(world);
  const o = new MarioOverlay({ sink: () => {} });
  o.attach(api);
  assert.equal(o.surfaceAt(30 * TILE), 13 * TILE);
  // Blow the column away.
  world.recAt = () => ({ name: 'air' });
  assert.equal(o.surfaceAt(30 * TILE), 15 * TILE, 'the probe must fall through a crater');
});

test('a bomb produces a mark and a whistle on the same pump', () => {
  const { o, api, played } = headless();
  o.add({ id: 'a', kind: 'bomb', x: 30 * TILE, y: 20, vx: 0, vy: 0 });
  api.game.loop.tick = 1;
  o.pump();
  assert.equal(o.marks.length, 1);
  assert.equal(o.marks[0].impact.ty, 13);
  assert.equal(played.length, 1);
  assert.equal(played[0].tag, 'whistle:a');
});

test('hooks run once per step, in order, with the world', () => {
  const { o, api, world } = headless();
  const seen = [];
  o.hooks.push((w) => seen.push(['a', w === world]));
  o.hooks.push(() => seen.push(['b', true]));
  api.game.loop.tick = 3;
  o.pump();
  assert.equal(seen.length, 6, 'two hooks over three steps');
  assert.deepEqual(seen[0], ['a', true]);
  assert.deepEqual(seen[1], ['b', true]);
});

test('losing the level resets rather than predicting into nothing', () => {
  const { o, api, world } = headless();
  o.add({ id: 'a', kind: 'bomb', x: 30 * TILE, y: 20, vx: 0, vy: 0 });
  api.game.loop.tick = 1;
  o.pump();
  assert.equal(o.marks.length, 1);
  world.level = null;
  api.game.loop.tick = 2;
  o.pump();
  assert.equal(o.marks.length, 0);
  assert.equal(o.telegraph.shots.size, 0, 'a level change must not carry bombs into it');
});

test('add() rejects a world-space y instead of silently drawing off-screen', () => {
  const { o } = headless();
  assert.throws(
    () => o.add({ id: 'x', kind: 'bomb', x: 30 * TILE, y: ISLAND_TOP_Y + 13 * TILE, vx: 0, vy: 0 }),
    /looks like a WORLD-space y/,
  );
});

test('sync() rejects the same mistake', () => {
  const { o } = headless();
  o.add({ id: 'x', kind: 'bomb', x: 30 * TILE, y: 20, vx: 0, vy: 0 });
  assert.throws(() => o.sync('x', { x: 30 * TILE, y: ISLAND_TOP_Y + 20, vx: 0, vy: 1 }));
});
