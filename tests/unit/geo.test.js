import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../src/core/constants.js';
import {
  VIEW_W, VIEW_H, CEILING_Y, SEA_Y, ISLAND_H, ISLAND_TOP_Y,
  DECK_X0, DECK_X1, DECK_Y,
  layoutIslands, worldToLocalTile, localTileToWorld, cameraFor, worldBounds, clamp,
} from '../../src/wings/geo.js';

test('the pilot viewport is 512x240 at 1:1', () => {
  assert.equal(VIEW_W, 512);
  assert.equal(VIEW_H, 240);
});

test('an island band is 15 tiles tall and its bottom row sits at sea level', () => {
  assert.equal(ISLAND_H, 15 * TILE);
  assert.equal(ISLAND_TOP_Y + ISLAND_H, SEA_Y);
});

test('the ceiling is above the island tops, which are above the sea', () => {
  // +Y is DOWN, so "above" means numerically smaller.
  assert.ok(CEILING_Y < ISLAND_TOP_Y, 'ceiling must be above the island tops');
  assert.ok(ISLAND_TOP_Y < SEA_Y, 'island tops must be above sea level');
});

test('the deck is a runway above the waterline', () => {
  assert.ok(DECK_X1 - DECK_X0 >= 256, 'deck too short for a takeoff roll');
  assert.ok(DECK_Y < SEA_Y, 'the deck must be above the sea');
});

test('islands are laid out left to right with ocean between them', () => {
  const levels = [{ id: 'a', width: 100 }, { id: 'b', width: 50 }, { id: 'c', width: 200 }];
  const slots = layoutIslands(levels, 1000, 500);
  assert.deepEqual(slots.map((s) => s.id), ['a', 'b', 'c']);
  assert.equal(slots[0].x, 1000);
  for (let i = 1; i < slots.length; i++) {
    const prevEnd = slots[i - 1].x + slots[i - 1].width;
    assert.equal(slots[i].x - prevEnd, 500, 'islands must not overlap or drift');
  }
});

test('world pixels round-trip through island-local tiles', () => {
  const originX = 3000;
  const { x, y } = localTileToWorld(originX, 20, 13);
  assert.deepEqual(worldToLocalTile(originX, x, y), { tx: 20, ty: 13 });
  assert.deepEqual(worldToLocalTile(originX, x + TILE - 1, y + TILE - 1), { tx: 20, ty: 13 });
  assert.deepEqual(worldToLocalTile(originX, x - 1, y - 1), { tx: 19, ty: 12 });
});

test('the camera centres on the plane and clamps to the world box', () => {
  const bounds = { minX: -256, maxX: 6000, minY: -32, maxY: 616 };
  const mid = cameraFor(2000, 300, bounds);
  assert.equal(mid.x, 2000 - VIEW_W / 2);
  assert.equal(mid.y, 300 - VIEW_H / 2);

  const corner = cameraFor(-9999, 9999, bounds);
  assert.equal(corner.x, bounds.minX);
  assert.equal(corner.y, bounds.maxY - VIEW_H);
  assert.ok(Number.isInteger(corner.x) && Number.isInteger(corner.y), 'camera must be whole pixels');
});

test('worldBounds reaches past the last island', () => {
  const b = worldBounds([{ x1: 5000 }, { x1: 9000 }]);
  assert.ok(b.maxX > 9000);
  assert.ok(b.minX < DECK_X0);
});

test('worldBounds copes with an empty ocean', () => {
  const b = worldBounds([]);
  assert.ok(b.maxX > DECK_X1);
  assert.ok(b.maxY > b.minY + VIEW_H, 'the world must be taller than the viewport');
});

// The camera clamps to the world box, so the horizon doubles as the limit of
// how far you can fly and still see your aircraft. Bounded at the bow, the
// plane slides off the right of the viewport on the outbound leg.
test('an empty ocean is wide enough to keep the plane on screen', () => {
  const b = worldBounds([]);
  const x = DECK_X1 + 2.7 * 60 * 10; // ten seconds out from the bow at cruise
  const cam = cameraFor(x, 300, b);
  assert.ok(x - cam.x < VIEW_W, 'the plane slid off the right of the viewport');
  assert.ok(x - cam.x >= 0, 'the plane slid off the left of the viewport');
});

test('clamp does what it says', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
});
