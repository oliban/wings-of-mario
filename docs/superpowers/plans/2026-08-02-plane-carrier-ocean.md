# Plane, Carrier and Ocean Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-player flight sim you can fly offline. Roll down the carrier deck, lift off, loop, climb to the ceiling, fly out to an island, crater an unmodified Super Mario Bros. level with a bomb, and come back and take the wire with the tailhook. No Mario, no networking — those are Plans 3–5.

**Architecture:** The entire simulation — flight model, carrier, ordnance ballistics, terrain, camera — lives in browser-free modules under `src/wings/` and is exercised by plain-Node unit tests. Rendering and the `window.__WINGS` control API live behind a *second page*, `pilot.html`, so `index.html` and `src/main.js` are not touched. **This plan modifies zero engine files and adds no `MODS.md` entries.**

**Tech Stack:** Vanilla ES modules, no build step, no new npm dependencies. Node's built-in `node:test` for tier-1 unit tests. Playwright (already an upstream devDependency) for the tier-3 browser test.

**Ordering rule that governs this plan:** Task 1 ends with an aircraft the user can fly in a browser — roll, take off, loop, land, crash. Every later task adds to something that already flies. Nothing is scaffolding.

## Global Constraints

Copied from the spec and from `ARCHITECTURE.md`, which remains binding. Every task's requirements implicitly include this section.

- **No build step. No npm dependencies in `src/`. No TypeScript.** Every file is a `.js` ES module loaded natively by the browser.
- **Coordinate system:** origin top-left, +X right, **+Y down**. `TILE = 16`. Positions are floating-point pixels; **velocities are pixels per frame, not per second.** Accelerations are pixels per frame squared.
- **Fixed timestep:** `FPS = 60.0988`, `DT = 1 / FPS`. Simulation code must never read wall-clock time (`Date.now`, `performance.now`) or unseeded randomness. Determinism is a hard requirement of the test strategy.
- **Angles are radians from +X, clockwise on screen** because +Y is down: `0` = flying right and level, `-PI/2` = straight up, `+PI/2` = straight down, `PI` = flying left.
- **Tile keys** are `` `${tx},${ty}` `` with no spaces — Plan 1's format, and the wire format in Plan 3. Island-**local** tile coordinates, never world coordinates.
- **The air tile record is `{ name: 'air' }` with no explicit `solid` key.** A cleared tile's `.solid` is `undefined`, never `false`. Assert truthiness (`assert.ok(!rec.solid)`), never `assert.equal(rec.solid, false)`.
- **In level 1-1, rows 13–14 are ground, row 12 is decor, rows 11 and above are air.**
- **Never use port 8123.** A stale server from an unrelated project squats it and silently serves a different repo. This rules out `npm start`, whose script is `npx http-server -p 8123 -c-1 .` — serve by hand with `npx http-server -p 8199 -c-1 --silent .`, and do not change the `start` script. Plan 1's browser helper already uses 8199.
- **Engine edits are confined to declared hook points** and every one gets a `MODS.md` entry. **This plan needs none.** If you find yourself editing anything under `src/core`, `src/game`, `src/render`, `src/data`, `src/ui`, `src/audio`, `src/main.js` or `index.html`, stop and reconsider.
- **`window.__GAME` must not be removed or have existing members changed** — `tools/shot.mjs` drives it. `window.__WINGS` is a separate API on a separate page.
- **Original assets only.** No Nintendo ROM art or audio. Anti-aliasing is forbidden; hard pixel edges only. Light comes from the upper-left.
- **Commit after every task.** Do not push to any remote; the user pushes.

---

## Already built by Plan 1 — consume, do not rebuild

- `src/wings/blast.js` — `blastTiles(cx, cy, radiusTiles) -> string[]`, `tileKey(tx, ty)`, `parseTileKey(key)`. `parseTileKey` now **rejects** anything that is not a string matching `/^-?\d+,-?\d+$/`, and `blastTiles` clamps its radius. Both are stricter than when this plan was drafted; nothing here feeds them a malformed key, but do not paper over a throw from `parseTileKey` — it means a key was built wrong somewhere upstream of it.
- `src/wings/damage.js` — `class DamageMap` (`add`/`has`/`keys`/`hash`/`toJSON`/`fromJSON`), `hashKeys(keys)`.
- On `World`: `world.damage` (a `Set`), `world.destroyTiles(keys)`, `world.applyDamage(keys)`, `world.blast(cx, cy, radiusTiles)`. Damage travels in through `loadLevel`'s options bag — `game.loadLevel(id, areaId, { damage })`.
- `src/wings/debug-panel.js` — a bomb-test panel loaded from `index.html`. It drives the game **only** through `window.__GAME`, which does not exist on `pilot.html`, so it cannot be dropped into the pilot page as-is. Do not fork it: the pilot's equivalent dev surface is `window.__WINGS` plus the on-screen HUD in `scene.js`. If the pilot later wants real panel controls, the right move is to generalise `debug-panel.js` to take an API object rather than reaching for the `__GAME` global.
- `tests/browser/helpers.mjs` — `boot()` and `shutdown(ctx)` on port 8199. **Reuse it. Do not write a second boot helper.**
- npm scripts: `test:unit` → `node --test "tests/unit/*.test.js"`, `test:browser` → `node --test "tests/browser/*.test.mjs"`, `test` → both.
- Baseline before this plan starts: **20 unit tests and 14 browser tests, all green.** Every `Expected: PASS` below is on top of those.

**The one behaviour of Plan 1 this plan must mirror exactly.** `world.destroyTiles()` decides what a blast removes with `rec.name !== 'air'` — *every* non-air tile, including coins, decor, hidden blocks, water, lava and unknown tiles, not just solid ones. And it records **only** the keys it actually removed: recording a key that was already air would make `applyDamage` clear it unconditionally on the next load, which is how lava pools and hidden blocks vanish on reload after a blast that never touched them. `Island.blast()` in Task 2 is a copy of that predicate, and the two must stay identical or the pilot's crater and Mario's crater diverge and Plan 3's desync hash fires.

**`world.blast()` and `Island.blast()` are not the same call, and this plan uses only the second.** On the engine side `world.blast()` is the *live detonation* entry point: it kills entities in the radius and rebuilds the decor and flagpole/castle snapshots, which are compiled once from the tile map and go stale after a crater. `world.destroyTiles()` does neither. The pilot has no `World` and no entities and no decor snapshot, so `Island.blast()` mirrors only the tile bookkeeping — deliberately, not by omission. When Plan 3 gives Mario's client the `detonate` event, **that** client calls `world.blast(cx, cy, radiusTiles)` so the kills and the snapshot rebuild happen where the entities actually live.

---

## Recorded decision: the pilot viewport does not get the WebGL post/CRT chain

Mario renders through `src/render/post.js`, which gives the game its bloom, scanlines and vignette. The pilot does not, and this is a deliberate trade rather than an oversight.

**Why it cannot simply be reused.** `post.js` allocates its source texture at exactly `SCREEN_W x SCREEN_H` and hard-codes those same dimensions into three shader uniform sites — `uSrcSize`, `uTexel`, and the `outW / SCREEN_W` scale factor. Uploading a 512-wide frame into it is a GL error, not a stretched picture. There is no configuration that makes the existing chain take the pilot's frame.

**Why we are not fixing that here.** Widening it means either parameterising `post.js` — an upstream-owned file — or performing a mechanical `SCREEN_W`→`this.width` substitution through all of `Renderer` plus a matching culling change in `world.js`. Merge surface is the governing constraint on this fork: Plan 1's entire engine footprint is 59 added lines across two files. A wide mechanical diff through the renderer turns every upstream refactor into a conflict, and — this is the decisive part — **it would still not deliver the post chain**, because `post.js` would remain 256 wide. The engine edits buy reuse of the layer queue and nothing else, at permanent merge cost.

**What we do instead.** `src/wings/pilot-renderer.js` is a standalone 512x240 Canvas2D surface that reimplements the engine renderer's `draw(layer, fn)` queue — about 90 lines — and presents with `imageSmoothingEnabled = false` at an integer scale. Identical pixel fidelity, identical art scale, no filter. This also happens to fit Plan 3: in the networked game the two players genuinely are two clients, and Mario opening `/` while the pilot opens `/pilot.html` is the shape the netcode wants anyway.

**What it would cost to add later.** Make `PostChain` take its source size as a constructor argument, replacing the three hard-coded uniform sites and the texture allocation — perhaps 20 lines in `post.js`. That is a genuine improvement worth contributing to `mario-game` upstream and merging down, at which point `PilotRenderer.present()` grows a post path and nothing else in this plan changes.

---

## Verified reference implementation

Every simulation module in this plan was built and run against this repo's real level data before the plan was written. The working copies are at:

```
.superpowers/plan2-verified-wings/
```

containing `geo.js`, `flight.js`, `carrier.js`, `island.js`, `ordnance.js`, `sim.js`, `bot.js`, and the two art scratch files `art.mjs` / `art2.mjs`.

**That directory is unversioned reference material, not a source of truth.** It was built in a sibling copy of the repo and it predates some of the tuning in this plan — most importantly, its `island.js` still uses the old `solid || platform` blast predicate, which Task 2 replaces. **Implement from the code in this plan, not from those files.** They are there so you can watch something run before you trust it, and so the tick counts below are reproducible rather than asserted.

Measured behaviour the tasks below assert against, so you inherit it instead of rediscovering it:

| Measurement | Value |
|---|---|
| Takeoff roll: ticks to rotation at full throttle | 133 |
| Takeoff roll: deck used, of 320px available | 180px |
| A full loop at cruise, held pitch | 105 ticks (1.7s), returns to level |
| Level cruise speed, full throttle | 2.69 px/frame |
| Terminal dive speed | ~4.0 px/frame, capped at 4.5 |
| Vertical climb before stalling | ~93px, then the nose falls |
| Fuel: full-throttle endurance | 7143 ticks ≈ 119s |
| `predictImpact` vs. flying the bomb | agrees to 1e-6 px |
| Takeoff → circuit → trap, no island | tick 979 |
| Full sortie: takeoff → crater `20,13` of 1-1 → trap | ticks 133 → 1305 → 3486 |

---

## File Structure

| File | Responsibility |
|---|---|
| `src/wings/geo.js` (create, Task 1) | World geometry: sea level, ceiling, island band, deck box, viewport, island layout, camera. |
| `src/wings/flight.js` (create, Task 1) | Flight model: takeoff roll, loop-to-turn, stall, ceiling, fuel. |
| `src/wings/carrier.js` (create, Task 1) | Landing envelope predicate, hull, arresting, spotting. |
| `src/wings/sim.js` (create Task 1; extended Tasks 2, 3) | `WingsSim` — the match, canvas-free. Also `seek`/`distanceTo`. |
| `src/wings/art/plane.js` (create, Task 1) | Plane sprite, prop animation, tailhook. |
| `src/wings/art/carrier.js` (create, Task 1) | Deck, hull, waterline tiles and the superstructure. |
| `src/wings/art/ocean.js` (create, Task 1) | Sky/sea colours, wave frames, clouds, ordnance sprites, explosion puff. |
| `src/wings/pilot-renderer.js` (create, Task 1) | 512x240 Canvas2D surface with the engine's layer-queue API. |
| `src/wings/scene.js` (create Task 1; extended Tasks 2, 3) | Draws sim state. |
| `src/wings/pilot-main.js` (create Task 1; extended Tasks 2, 3, 4) | Boots the page, owns the keyboard, exposes `window.__WINGS`. |
| `pilot.html` (create Task 1; extended Task 3) | The pilot's page. `index.html` untouched. |
| `src/wings/island.js` (create, Task 2) | An upstream level in the ocean as bombable terrain. |
| `src/wings/ordnance.js` (create, Task 3) | Weapon specs, release, integration, impact prediction. |
| `src/wings/bot.js` (create, Task 4) | Deterministic autopilots: `takeoff`, `flyTo`, `bombTile`, `autoLand`. |
| `tests/unit/*.test.js` (create) | Tier-1, one file per module. |
| `tests/browser/helpers.mjs` (modify, Task 5) | `boot()` gains options so it can open `pilot.html`. |
| `tests/browser/pilot.test.mjs` (create, Task 5) | Tier-3: a real sortie in a real browser. |

## Task index

1. **A carrier, an ocean, and a plane you can fly** — geometry, flight model, landing envelope, all the art, the renderer, the page and `__WINGS`. **Ends flyable.**
2. **Islands you can crash into** — upstream levels placed in the ocean as terrain.
3. **Ordnance** — bombs, rockets, guns; craters; killing yourself with your own blast.
4. **Bot primitives and the full sortie** — `flyTo`, `bombTile`, `autoLand`, and a tier-1 test that flies deck-to-crater-to-deck.
5. **The tier-3 browser test** — the same sortie, in Chromium, through `__WINGS`.

---

## Task 1: A carrier, an ocean, and a plane you can fly

The big one, and deliberately so: at the end of it you open a page and fly. Wings of Fury fidelity throughout — a takeoff roll, turning by looping rather than flipping, an altitude ceiling, a tailhook landing that fails outside a legal speed and angle envelope, and a fuel gauge.

**Files:**
- Create: `src/wings/geo.js`, `src/wings/flight.js`, `src/wings/carrier.js`, `src/wings/sim.js`
- Create: `src/wings/art/plane.js`, `src/wings/art/carrier.js`, `src/wings/art/ocean.js`
- Create: `src/wings/pilot-renderer.js`, `src/wings/scene.js`, `src/wings/pilot-main.js`, `pilot.html`
- Create: `tests/unit/geo.test.js`, `tests/unit/flight.test.js`, `tests/unit/carrier.test.js`, `tests/unit/art.test.js`

**Interfaces produced:**
- `geo.js` — `VIEW_W`, `VIEW_H`, `CEILING_Y`, `SEA_Y`, `ISLAND_ROWS`, `ISLAND_H`, `ISLAND_TOP_Y`, `DECK_X0`, `DECK_X1`, `DECK_Y`, `HULL_BOTTOM`, `PLANE_W`, `PLANE_H`, `WORLD_LEFT`, `WORLD_MARGIN`, `FIRST_ISLAND_X`, `ISLAND_GAP`; `layoutIslands`, `worldToLocalTile`, `localTileToWorld`, `clamp`, `cameraFor`, `worldBounds`
- `flight.js` — `FLIGHT`, `MODE`, `normalizeAngle`, `turnToward`, `createPlane`, `stepPlane`, `nosePoint`
- `carrier.js` — `LANDING`, `inLandingBox`, `landingVerdict`, `hitsHull`, `arrest`, `spotOnDeck`
- `sim.js` — `SQUADRON`, `class WingsSim`, `seek`, `distanceTo`
- `pilot-renderer.js` — `class PilotRenderer`
- `scene.js` — `class Scene`, `drawRotated`
- `window.__WINGS` — `ready`, `sim`, `renderer`, `scene`, `hold`, `release`, `tick`, `state`, `events`, `respawn`, `reset`, `pause`, `resume`, `snapshot`, `fatal`

- [ ] **Step 1: Write the geometry test**

Create `tests/unit/geo.test.js`:

```js
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

test('clamp does what it says', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(50, 0, 10), 10);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/wings/geo.js'`

- [ ] **Step 3: Write the geometry**

Create `src/wings/geo.js`:

```js
import { TILE } from '../core/constants.js';

// The pilot's window on the world: the same 1:1 pixel scale as Mario's
// 256x240, twice as wide, and it scrolls vertically as well as horizontally.
export const VIEW_W = 512;
export const VIEW_H = 240;

// Sea level, island tops and the altitude ceiling, in world pixels. +Y is
// DOWN, so the ceiling has the SMALLEST y and the keel the largest.
export const CEILING_Y = 0;
export const SEA_Y = 560;
export const ISLAND_ROWS = 15;
export const ISLAND_H = ISLAND_ROWS * TILE;
export const ISLAND_TOP_Y = SEA_Y - ISLAND_H;

// The carrier. Stern at low x, bow at high x, so the takeoff roll runs to the
// RIGHT, over the bow, toward the islands. Coming home therefore means
// overflying the ship, looping 180 degrees and running back in the other way —
// which is what makes the loop a mechanic rather than a flourish.
export const DECK_X0 = 96;
export const DECK_X1 = 416;
export const DECK_Y = 512;
export const HULL_BOTTOM = SEA_Y + 24;

// Plane hitbox. x,y is its top-left, per ARCHITECTURE.md section 1.
export const PLANE_W = 24;
export const PLANE_H = 12;

// How far the world runs past the last island, and left of the stern.
export const WORLD_LEFT = -256;
export const WORLD_MARGIN = 512;

// Islands are laid out left to right with open ocean between them. Fixed
// spacing, no RNG: the seeded archipelago belongs to a later plan.
export const FIRST_ISLAND_X = 3000;
export const ISLAND_GAP = 1600;

export function layoutIslands(levels, firstX = FIRST_ISLAND_X, gap = ISLAND_GAP) {
  const out = [];
  let x = firstX;
  for (const lvl of levels) {
    const width = lvl.width * TILE;
    out.push({ id: lvl.id, level: lvl, x, width });
    x += width + gap;
  }
  return out;
}

// World pixel -> tile coordinate inside an island whose left edge is originX.
// The island's top row is ty 0 and sits at ISLAND_TOP_Y.
export function worldToLocalTile(originX, px, py) {
  return {
    tx: Math.floor((px - originX) / TILE),
    ty: Math.floor((py - ISLAND_TOP_Y) / TILE),
  };
}

// Inverse: the world pixel of a local tile's top-left corner.
export function localTileToWorld(originX, tx, ty) {
  return { x: originX + tx * TILE, y: ISLAND_TOP_Y + ty * TILE };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Centre the viewport on a point, clamped to the world box, floored so the
// scroll never lands on a half pixel.
export function cameraFor(px, py, bounds) {
  const minX = bounds.minX;
  const maxX = Math.max(minX + VIEW_W, bounds.maxX);
  const minY = bounds.minY;
  const maxY = Math.max(minY + VIEW_H, bounds.maxY);
  return {
    x: Math.floor(clamp(px - VIEW_W / 2, minX, maxX - VIEW_W)),
    y: Math.floor(clamp(py - VIEW_H / 2, minY, maxY - VIEW_H)),
  };
}

export function worldBounds(islands) {
  let right = DECK_X1;
  for (const i of islands) right = Math.max(right, i.x1);
  return {
    minX: WORLD_LEFT,
    maxX: right + WORLD_MARGIN,
    minY: CEILING_Y - 32,
    maxY: HULL_BOTTOM + 32,
  };
}
```

Run: `npm run test:unit` — Expected: PASS, 10 geo tests.

- [ ] **Step 4: Write the flight-model test**

Create `tests/unit/flight.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { CEILING_Y, DECK_X0, DECK_X1, DECK_Y, PLANE_H } from '../../src/wings/geo.js';
import {
  FLIGHT, MODE, createPlane, stepPlane, normalizeAngle, turnToward, nosePoint,
} from '../../src/wings/flight.js';

const FULL = { throttle: 1, pitch: 0 };

// Hold full throttle, and pull back the moment there is flying speed.
function rotateOff(p) {
  let t = 0;
  while (p.mode !== MODE.AIR && t < 600) {
    stepPlane(p, { throttle: 1, pitch: p.speed >= FLIGHT.TAKEOFF_SPEED ? 1 : 0 });
    t++;
  }
  return t;
}

test('normalizeAngle folds into (-PI, PI]', () => {
  assert.equal(normalizeAngle(0), 0);
  assert.ok(Math.abs(normalizeAngle(Math.PI * 3) - Math.PI) < 1e-9);
  assert.ok(Math.abs(normalizeAngle(Math.PI * 2 + 0.5) - 0.5) < 1e-9);
});

test('turnToward snaps on arrival and crosses the seam the short way', () => {
  assert.ok(Math.abs(turnToward(0, 0.05, 0.1) - 0.05) < 1e-9, 'should snap');
  const stepped = turnToward(3.0, -3.0, 0.1);
  assert.ok(stepped > 3.0 || stepped < -3.0, 'must cross +/-PI, not go the long way');
});

test('a fresh plane is spotted on the deck with the hook down', () => {
  const p = createPlane();
  assert.equal(p.mode, MODE.DECK);
  assert.equal(p.speed, 0);
  assert.equal(p.angle, 0);
  assert.equal(p.gear, true);
  assert.equal(p.y, DECK_Y - PLANE_H);
  assert.ok(p.x >= DECK_X0 && p.x < DECK_X1);
  assert.equal(p.fuel, FLIGHT.FUEL_MAX);
});

// Verified: rotation at tick 133, having used 180px of the 320px deck.
test('the takeoff roll builds speed and uses real deck', () => {
  const p = createPlane();
  const startX = p.x;
  const ticks = rotateOff(p);
  assert.equal(p.mode, MODE.AIR, 'never got airborne');
  assert.ok(ticks > 60 && ticks < 300, `rotation at tick ${ticks} is not a roll`);
  assert.ok(p.x < DECK_X1, 'ran off the bow instead of rotating');
  assert.ok(p.x - startX > 80, 'used almost no deck');
  assert.ok(p.speed >= FLIGHT.TAKEOFF_SPEED);
  assert.equal(p.gear, false, 'the hook should come up on rotation');
});

test('pulling back below flying speed does not leave the deck', () => {
  const p = createPlane();
  for (let i = 0; i < 40; i++) stepPlane(p, { throttle: 1, pitch: 1 });
  assert.ok(p.speed < FLIGHT.TAKEOFF_SPEED, 'test premise: still below rotation speed');
  assert.notEqual(p.mode, MODE.AIR);
  assert.equal(p.y, DECK_Y - PLANE_H, 'the plane left the deck early');
});

// Verified: 105 ticks, back to level, net drift 36px.
test('turning is a loop: held pitch comes all the way back round', () => {
  const p = createPlane({ mode: MODE.AIR, x: 1000, y: 200, speed: 2.7, gear: false });
  let turned = 0;
  let prev = p.angle;
  let ticks = 0;
  while (Math.abs(turned) < Math.PI * 2 && ticks < 500) {
    stepPlane(p, { throttle: 1, pitch: 1 });
    turned += normalizeAngle(p.angle - prev);
    prev = p.angle;
    ticks++;
  }
  assert.ok(Math.abs(turned) >= Math.PI * 2, 'never completed a loop');
  assert.ok(ticks > 40 && ticks < 300, `a loop taking ${ticks} ticks is not Wings of Fury`);
  assert.ok(Math.abs(normalizeAngle(p.angle)) < 0.2, 'did not come back to level');
  assert.ok(Math.abs(p.x - 1000) < 400, 'the loop should be a loop, not a lap');
});

test('turn authority falls off with speed — you cannot loop when slow', () => {
  const fast = createPlane({ mode: MODE.AIR, x: 0, y: 200, speed: 3.0, gear: false });
  const slow = createPlane({ mode: MODE.AIR, x: 0, y: 200, speed: 0.9, gear: false });
  for (let i = 0; i < 10; i++) {
    stepPlane(fast, { throttle: 1, pitch: 1 });
    stepPlane(slow, { throttle: 1, pitch: 1 });
  }
  assert.ok(Math.abs(fast.angle) > Math.abs(slow.angle), 'speed must buy turn rate');
});

test('climbing bleeds speed and diving builds it', () => {
  const up = createPlane({ mode: MODE.AIR, x: 0, y: 400, speed: 2.7, angle: -Math.PI / 2, gear: false });
  const down = createPlane({ mode: MODE.AIR, x: 0, y: 100, speed: 2.7, angle: Math.PI / 2, gear: false });
  for (let i = 0; i < 60; i++) {
    stepPlane(up, FULL);
    stepPlane(down, FULL);
  }
  assert.ok(up.speed < 2.7, 'a vertical climb must cost speed');
  assert.ok(down.speed > 3.5, 'a vertical dive must build speed');
  assert.ok(down.speed <= FLIGHT.MAX_SPEED, 'speed must be capped');
});

test('a stall drops the nose whatever the stick says', () => {
  const p = createPlane({ mode: MODE.AIR, x: 0, y: 200, speed: 0.1, angle: -Math.PI / 2, gear: false });
  for (let i = 0; i < 120; i++) stepPlane(p, { throttle: 0, pitch: 1 });
  assert.ok(p.angle > 0, `a stalled nose should fall, angle is ${p.angle}`);
  assert.ok(p.y > 200, 'a stall must cost altitude');
});

test('the ceiling caps the climb and levels the nose', () => {
  const p = createPlane({ mode: MODE.AIR, x: 0, y: CEILING_Y + 4, speed: 2.7, angle: -0.5, gear: false });
  for (let i = 0; i < 200; i++) stepPlane(p, { throttle: 1, pitch: 1 });
  assert.ok(p.y >= CEILING_Y, 'the plane climbed through the ceiling');
  const a = Math.abs(normalizeAngle(p.angle));
  assert.ok(a < 0.2 || Math.abs(a - Math.PI) < 0.2, 'the nose should be level at the ceiling');
});

// Verified: 7143 ticks, about 119 seconds.
test('fuel burns down monotonically and cuts the throttle when dry', () => {
  const p = createPlane({ mode: MODE.AIR, x: 0, y: 200, speed: 2.7, gear: false });
  let prev = p.fuel;
  let ticks = 0;
  while (p.fuel > 0 && ticks < 40000) {
    stepPlane(p, FULL);
    assert.ok(p.fuel <= prev, 'fuel went up');
    prev = p.fuel;
    ticks++;
  }
  assert.equal(p.fuel, 0);
  assert.ok(ticks > 60 * 60, `a ${(ticks / 60.0988).toFixed(0)}s sortie is too short`);
  for (let i = 0; i < 30; i++) stepPlane(p, FULL);
  assert.equal(p.throttle, 0, 'a dry tank must ignore the throttle');
});

test('the nose leads the hitbox', () => {
  const p = createPlane({ mode: MODE.AIR, x: 100, y: 100, speed: 2, angle: 0, gear: false });
  assert.ok(nosePoint(p).x > p.x + 12, 'nose should be ahead when flying right');
  p.angle = Math.PI;
  assert.ok(nosePoint(p).x < p.x + 12, 'nose should be behind when flying left');
});

test('the model is deterministic', () => {
  const tape = [];
  for (let i = 0; i < 400; i++) tape.push({ throttle: i % 7 ? 1 : 0, pitch: ((i >> 4) % 3) - 1 });
  const run = () => {
    const p = createPlane();
    for (const step of tape) stepPlane(p, step);
    return JSON.stringify(p);
  };
  assert.equal(run(), run());
});
```

- [ ] **Step 5: Write the flight model**

Create `src/wings/flight.js`:

```js
import { CEILING_Y, DECK_X0, DECK_X1, DECK_Y, PLANE_W, PLANE_H, clamp } from './geo.js';

// Everything here is pixels PER FRAME at the fixed 60.0988Hz timestep, and
// radians per frame for rotation. Nothing reads a clock or an RNG.
//
// These are chosen together, not independently. THRUST against DRAG sets level
// cruise at 2.69 px/frame. GRAVITY against THRUST is why a climb stalls and a
// dive runs away: at full throttle a vertical climb is 0.045 - 0.06, net
// negative. TURN_RATE sets the loop at 105 ticks. ROLL_THRUST against
// ROLL_DRAG puts rotation at tick 133, 180px down a 320px deck — half the
// deck, so running out of it is a real mistake a player can make.
export const FLIGHT = {
  MAX_SPEED: 4.5,
  THRUST: 0.045,
  DRAG: 0.006,
  GRAVITY: 0.06,
  TURN_RATE: 0.06,
  TURN_SPEED_REF: 1.6,
  STALL_SPEED: 0.8,
  STALL_PULL: 0.02,
  ROLL_THRUST: 0.03,
  ROLL_DRAG: 0.01,
  TAKEOFF_SPEED: 2.2,
  FUEL_MAX: 100,
  FUEL_IDLE: 0.004,
  FUEL_THROTTLE: 0.01,
};

export const MODE = { DECK: 'deck', ROLL: 'roll', AIR: 'air', DOWN: 'down' };

// Angle is measured from +X, clockwise on screen because +Y is down:
//   0 = flying right and level, -PI/2 = straight up, PI/2 = straight down.
export function normalizeAngle(a) {
  const t = Math.PI * 2;
  let v = a % t;
  if (v > Math.PI) v -= t;
  if (v <= -Math.PI) v += t;
  return v;
}

export function turnToward(a, target, step) {
  const d = normalizeAngle(target - a);
  if (Math.abs(d) <= step) return normalizeAngle(target);
  return normalizeAngle(a + Math.sign(d) * step);
}

export function createPlane(opts = {}) {
  return {
    mode: opts.mode || MODE.DECK,
    x: opts.x != null ? opts.x : DECK_X0 + 16,
    y: opts.y != null ? opts.y : DECK_Y - PLANE_H,
    angle: opts.angle != null ? opts.angle : 0,
    speed: opts.speed || 0,
    vx: 0,
    vy: 0,
    throttle: 0,
    gear: opts.gear != null ? !!opts.gear : true,
    fuel: opts.fuel != null ? opts.fuel : FLIGHT.FUEL_MAX,
    ticks: 0,
  };
}

// input: { pitch: -1..1 (+1 pulls the nose UP), throttle: 0..1, gear: bool }
export function stepPlane(p, input = {}) {
  if (p.mode === MODE.DOWN) return p;

  const pitch = clamp(input.pitch || 0, -1, 1);
  let throttle = clamp(input.throttle == null ? 0 : input.throttle, 0, 1);
  if (p.fuel <= 0) throttle = 0;
  p.throttle = throttle;
  if (input.gear != null) p.gear = !!input.gear;

  if (p.mode === MODE.DECK || p.mode === MODE.ROLL) stepRoll(p, pitch, throttle);
  else stepAir(p, pitch, throttle);

  p.fuel = Math.max(0, p.fuel - (FLIGHT.FUEL_IDLE + FLIGHT.FUEL_THROTTLE * throttle));
  p.ticks++;
  return p;
}

// The takeoff roll. The plane is pinned to the deck, gains speed against
// rolling friction, and only rotates once there is air over the wings.
function stepRoll(p, pitch, throttle) {
  p.angle = 0;
  p.y = DECK_Y - PLANE_H;
  p.speed += FLIGHT.ROLL_THRUST * throttle - FLIGHT.ROLL_DRAG * p.speed;
  if (p.speed < 0) p.speed = 0;
  p.x += p.speed;
  p.vx = p.speed;
  p.vy = 0;
  p.mode = p.speed > 0 ? MODE.ROLL : MODE.DECK;

  if (pitch > 0 && p.speed >= FLIGHT.TAKEOFF_SPEED) {
    p.mode = MODE.AIR;
    p.gear = false;
    return;
  }
  // Ran out of deck. Airborne below flying speed is a stall, and a stall this
  // low is the sea. Nothing special-cases it; the physics does it.
  if (p.x >= DECK_X1) {
    p.mode = MODE.AIR;
    p.gear = false;
  }
}

function stepAir(p, pitch, throttle) {
  const authority = Math.min(1, p.speed / FLIGHT.TURN_SPEED_REF);
  p.angle = normalizeAngle(p.angle - pitch * FLIGHT.TURN_RATE * authority);

  // Below flying speed the nose falls toward straight down whatever the stick
  // is doing. This is what makes a botched climb cost altitude.
  if (p.speed < FLIGHT.STALL_SPEED) {
    p.angle = turnToward(p.angle, Math.PI / 2, FLIGHT.STALL_PULL);
  }

  p.speed += FLIGHT.THRUST * throttle;
  p.speed += FLIGHT.GRAVITY * Math.sin(p.angle);
  p.speed -= FLIGHT.DRAG * p.speed * p.speed;
  p.speed = clamp(p.speed, 0, FLIGHT.MAX_SPEED);

  p.vx = Math.cos(p.angle) * p.speed;
  p.vy = Math.sin(p.angle) * p.speed;
  p.x += p.vx;
  p.y += p.vy;

  // The ceiling. Climbing into it levels the nose rather than stopping the
  // plane dead, so it reads as a service ceiling and not as a wall.
  if (p.y < CEILING_Y) {
    p.y = CEILING_Y;
    if (p.vy < 0) {
      p.angle = Math.cos(p.angle) >= 0 ? 0 : Math.PI;
      p.vy = 0;
      p.vx = Math.cos(p.angle) * p.speed;
    }
  }
}

// Where the nose is, in world pixels — the muzzle, the bomb release point and
// the point that decides whether the plane flew into a hillside.
export function nosePoint(p) {
  const r = PLANE_W / 2;
  return {
    x: p.x + r + Math.cos(p.angle) * r,
    y: p.y + PLANE_H / 2 + Math.sin(p.angle) * r,
  };
}
```

Run: `npm run test:unit` — Expected: PASS, 13 flight tests.

- [ ] **Step 6: Write the landing-envelope test**

Create `tests/unit/carrier.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { DECK_X0, DECK_X1, DECK_Y, HULL_BOTTOM, PLANE_H } from '../../src/wings/geo.js';
import { MODE, createPlane } from '../../src/wings/flight.js';
import {
  LANDING, inLandingBox, landingVerdict, hitsHull, arrest, spotOnDeck,
} from '../../src/wings/carrier.js';

// A textbook approach: over the middle of the deck, wheels on the planking,
// level, hook down, in the middle of the legal speed band.
function onTheWire(over = {}) {
  return createPlane({
    mode: MODE.AIR,
    x: DECK_X0 + 120,
    y: DECK_Y - PLANE_H,
    angle: 0,
    speed: (LANDING.MIN_SPEED + LANDING.MAX_SPEED) / 2,
    gear: true,
    ...over,
  });
}

test('a textbook approach traps', () => {
  const v = landingVerdict(onTheWire());
  assert.equal(v.inBox, true);
  assert.equal(v.ok, true);
  assert.equal(v.reason, 'trap');
});

test('the hook has to be down', () => {
  assert.equal(landingVerdict(onTheWire({ gear: false })).reason, 'hook-up');
});

test('you have to be going the right way', () => {
  assert.equal(landingVerdict(onTheWire({ angle: Math.PI })).reason, 'wrong-way');
});

test('the attitude has to be near level', () => {
  assert.equal(landingVerdict(onTheWire({ angle: LANDING.MAX_ANGLE + 0.1 })).reason, 'attitude');
  assert.equal(landingVerdict(onTheWire({ angle: -LANDING.MAX_ANGLE - 0.1 })).reason, 'attitude');
  assert.equal(landingVerdict(onTheWire({ angle: LANDING.MAX_ANGLE - 0.01 })).ok, true);
});

test('too fast and too slow are both crashes, and the bounds are inclusive', () => {
  assert.equal(landingVerdict(onTheWire({ speed: LANDING.MAX_SPEED + 0.1 })).reason, 'too-fast');
  assert.equal(landingVerdict(onTheWire({ speed: LANDING.MIN_SPEED - 0.1 })).reason, 'too-slow');
  assert.equal(landingVerdict(onTheWire({ speed: LANDING.MAX_SPEED })).ok, true);
  assert.equal(landingVerdict(onTheWire({ speed: LANDING.MIN_SPEED })).ok, true);
});

test('altitude and position put you out of the box entirely', () => {
  assert.equal(landingVerdict(onTheWire({ y: DECK_Y - PLANE_H - 60 })).reason, 'off-deck');
  assert.equal(landingVerdict(onTheWire({ x: DECK_X0 - 200 })).reason, 'off-deck');
  assert.equal(landingVerdict(onTheWire({ x: DECK_X1 + 40 })).reason, 'off-deck');
  assert.equal(inLandingBox(onTheWire()), true);
});

test('the box is a narrow altitude slot, not the whole sky', () => {
  assert.equal(inLandingBox(onTheWire({ y: DECK_Y - PLANE_H - (LANDING.Y_TOLERANCE - 1) })), true);
  assert.equal(inLandingBox(onTheWire({ y: DECK_Y - PLANE_H - (LANDING.Y_TOLERANCE + 1) })), false);
});

test('the hull is solid below the deck', () => {
  assert.equal(hitsHull(onTheWire()), false, 'landing must not read as hitting the ship');
  assert.equal(hitsHull(onTheWire({ y: DECK_Y + 30 })), true);
  assert.equal(hitsHull(onTheWire({ x: DECK_X1 + 200, y: DECK_Y + 30 })), false);
  assert.equal(hitsHull(onTheWire({ y: HULL_BOTTOM + 40 })), false, 'below the keel is open water');
});

test('arresting stops the plane dead on the deck with the hook down', () => {
  const p = arrest(onTheWire({ speed: 1.4, angle: 0.1 }));
  assert.equal(p.mode, MODE.DECK);
  assert.equal(p.speed, 0);
  assert.equal(p.vx, 0);
  assert.equal(p.vy, 0);
  assert.equal(p.angle, 0);
  assert.equal(p.gear, true);
  assert.equal(p.y, DECK_Y - PLANE_H);
});

test('spotting puts the next aircraft at the stern', () => {
  const p = spotOnDeck(createPlane({ x: 9999, mode: MODE.AIR }));
  assert.equal(p.mode, MODE.DECK);
  assert.ok(p.x >= DECK_X0 && p.x < DECK_X0 + 64, 'must start at the stern end');
  assert.ok(DECK_X1 - p.x > 256, 'must have the whole deck ahead of it');
});
```

- [ ] **Step 7: Write the carrier**

Create `src/wings/carrier.js`:

```js
import { DECK_X0, DECK_X1, DECK_Y, HULL_BOTTOM, PLANE_W, PLANE_H } from './geo.js';
import { MODE, normalizeAngle } from './flight.js';

// The envelope. Outside any one of these the hook does not catch and the
// aircraft is written off.
export const LANDING = {
  MAX_SPEED: 1.8,
  MIN_SPEED: 0.6,
  MAX_ANGLE: 0.22,
  Y_TOLERANCE: 10,
  X_MARGIN: 8,
};

// The box in which the tailhook can reach a wire at all.
export function inLandingBox(p) {
  const wheels = p.y + PLANE_H;
  return (
    p.x + PLANE_W > DECK_X0 + LANDING.X_MARGIN &&
    p.x < DECK_X1 &&
    wheels >= DECK_Y - LANDING.Y_TOLERANCE &&
    wheels <= DECK_Y + LANDING.Y_TOLERANCE
  );
}

// One verdict for one tick. `reason` names the first rule broken, so a crash
// can be explained rather than just announced.
export function landingVerdict(p) {
  if (!inLandingBox(p)) return { inBox: false, ok: false, reason: 'off-deck' };
  if (!p.gear) return { inBox: true, ok: false, reason: 'hook-up' };
  if (Math.cos(p.angle) <= 0) return { inBox: true, ok: false, reason: 'wrong-way' };
  if (Math.abs(normalizeAngle(p.angle)) > LANDING.MAX_ANGLE) {
    return { inBox: true, ok: false, reason: 'attitude' };
  }
  if (p.speed > LANDING.MAX_SPEED) return { inBox: true, ok: false, reason: 'too-fast' };
  if (p.speed < LANDING.MIN_SPEED) return { inBox: true, ok: false, reason: 'too-slow' };
  return { inBox: true, ok: true, reason: 'trap' };
}

// Everything solid about the ship. Hitting it anywhere but the deck is a crash.
export function hitsHull(p) {
  const wheels = p.y + PLANE_H;
  return (
    p.x + PLANE_W > DECK_X0 &&
    p.x < DECK_X1 &&
    wheels > DECK_Y + LANDING.Y_TOLERANCE &&
    p.y < HULL_BOTTOM
  );
}

// Caught a wire: stopped dead on the deck, ready to be rearmed.
export function arrest(p) {
  p.mode = MODE.DECK;
  p.speed = 0;
  p.vx = 0;
  p.vy = 0;
  p.angle = 0;
  p.gear = true;
  p.y = DECK_Y - PLANE_H;
  return p;
}

// Put a fresh aircraft at the stern, pointing down the deck.
export function spotOnDeck(p) {
  arrest(p);
  p.x = DECK_X0 + 16;
  return p;
}
```

Run: `npm run test:unit` — Expected: PASS, 10 carrier tests.

- [ ] **Step 8: Write the sim**

No test file of its own yet — Tasks 2 and 3 extend it and test it there, and the browser test in Task 5 is its real gate. Create `src/wings/sim.js`:

```js
import { SEA_Y, PLANE_W, PLANE_H, cameraFor, worldBounds } from './geo.js';
import { MODE, FLIGHT, createPlane, stepPlane, normalizeAngle } from './flight.js';
import { landingVerdict, hitsHull, arrest, spotOnDeck } from './carrier.js';

export const SQUADRON = 5;

// The whole flight sim, with no canvas anywhere in it: the renderer reads
// this, never the other way round. That keeps every rule in here reachable
// from a plain-Node test.
//
// Tasks 2 and 3 add islands and ordnance to this class. Nothing else changes.
export class WingsSim {
  constructor(opts = {}) {
    this.islands = [];
    this.bounds = worldBounds(this.islands);
    this.squadron = opts.squadron != null ? opts.squadron : SQUADRON;
    this.plane = spotOnDeck(createPlane());
    this.tick = 0;
    this.events = [];
    this.status = 'ready';
    this.lastVerdict = null;
    this.hookArmed = false;
    this.cam = cameraFor(this.plane.x, this.plane.y, this.bounds);
    this.rearm();
  }

  rearm() {
    this.plane.fuel = FLIGHT.FUEL_MAX;
  }

  emit(type, data) {
    this.events.push({ tick: this.tick, type, ...data });
  }

  // One fixed 60.0988Hz step. input: { pitch, throttle, gear }
  step(input = {}) {
    if (this.status === 'over') return this;
    const p = this.plane;
    if (p.mode !== MODE.DOWN) stepPlane(p, input);
    if (p.mode !== MODE.DOWN) this.checkPlane();
    this.cam = cameraFor(p.x + PLANE_W / 2, p.y + PLANE_H / 2, this.bounds);
    this.tick++;
    return this;
  }

  checkPlane() {
    const p = this.plane;
    if (p.mode !== MODE.AIR) return;
    if (p.y + PLANE_H >= SEA_Y) return this.lose('sea');

    const verdict = landingVerdict(p);
    this.lastVerdict = verdict;
    // The hook cannot catch a wire on the way OUT: the plane must have been
    // clear of the deck box once since it left the deck. Without this latch the
    // tick it rotates off the deck counts as a botched landing, because it is
    // still inside the box with the gear just retracted.
    if (!verdict.inBox) {
      this.hookArmed = true;
      if (hitsHull(p)) return this.lose('carrier');
      return;
    }
    if (!this.hookArmed) return;
    if (verdict.ok) return this.land();
    return this.lose(verdict.reason);
  }

  land() {
    arrest(this.plane);
    this.hookArmed = false;
    this.rearm();
    this.status = 'ready';
    this.emit('landed', {});
    return this;
  }

  lose(reason) {
    const p = this.plane;
    p.mode = MODE.DOWN;
    p.speed = 0;
    this.squadron--;
    this.emit('planeLost', { reason, x: p.x, y: p.y });
    this.status = this.squadron > 0 ? 'lost' : 'over';
    return this;
  }

  // Put the next aircraft on the deck. Returns false when the squadron is gone.
  respawn() {
    if (this.squadron <= 0) return false;
    this.plane = spotOnDeck(createPlane());
    this.hookArmed = false;
    this.rearm();
    this.status = 'ready';
    this.emit('sortieStart', { squadron: this.squadron });
    return true;
  }

  state() {
    const p = this.plane;
    return {
      tick: this.tick,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      angle: p.angle,
      speed: p.speed,
      mode: p.mode,
      gear: p.gear,
      fuel: p.fuel,
      squadron: this.squadron,
      status: this.status,
      cam: { ...this.cam },
    };
  }
}

// ---------------------------------------------------------------------------
// Steering, used by the bots in Task 4 and by __WINGS.
// ---------------------------------------------------------------------------

// Steer toward a world point. Pitch is +1 for nose UP, and angle DECREASES as
// the nose comes up, so the sign flips on the way in.
export function seek(p, tx, ty, opts = {}) {
  const throttle = opts.throttle == null ? 1 : opts.throttle;
  let want = Math.atan2(ty - (p.y + PLANE_H / 2), tx - (p.x + PLANE_W / 2));
  // Never fly the autopilot into the sea while chasing a low target.
  const floor = opts.floor == null ? SEA_Y - 96 : opts.floor;
  if (p.y + PLANE_H > floor && Math.sin(want) > 0) want = 0;
  const d = normalizeAngle(want - p.angle);
  const dead = opts.dead == null ? 0.03 : opts.dead;
  return {
    pitch: d > dead ? -1 : d < -dead ? 1 : 0,
    throttle,
    gear: opts.gear == null ? false : opts.gear,
  };
}

export function distanceTo(p, tx, ty) {
  const dx = tx - (p.x + PLANE_W / 2);
  const dy = ty - (p.y + PLANE_H / 2);
  return Math.hypot(dx, dy);
}
```

- [ ] **Step 9: Write the art test**

Create `tests/unit/art.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANE_PAL, PLANE_ANIM, PLANE_FRAMES, HOOK } from '../../src/wings/art/plane.js';
import { CARRIER_PAL, C_DECK, C_HULL, C_WATERLINE, C_TOWER } from '../../src/wings/art/carrier.js';
import {
  SEA_PAL, WAVE_ANIM, CLOUD, BOMB, ROCKET, TRACER, PUFF,
  SKY_TOP, SKY_HAZE, SEA_DEEP, SEA_SHALLOW,
} from '../../src/wings/art/ocean.js';
import { PLANE_W, PLANE_H } from '../../src/wings/geo.js';

const ALL = [
  ['PLANE_FRAMES[0]', PLANE_FRAMES[0]], ['PLANE_FRAMES[1]', PLANE_FRAMES[1]], ['HOOK', HOOK],
  ['C_DECK', C_DECK], ['C_HULL', C_HULL], ['C_WATERLINE', C_WATERLINE], ['C_TOWER', C_TOWER],
  ['WAVE[0]', WAVE_ANIM.frames[0]], ['WAVE[1]', WAVE_ANIM.frames[1]], ['WAVE[2]', WAVE_ANIM.frames[2]],
  ['CLOUD', CLOUD], ['BOMB', BOMB], ['ROCKET', ROCKET], ['TRACER', TRACER], ['PUFF', PUFF],
];

test('every sprite has rectangular rows and legal pixel chars', () => {
  for (const [name, s] of ALL) {
    assert.ok(s && s.rows && s.rows.length, `${name} has no rows`);
    for (const row of s.rows) {
      assert.equal(row.length, s.w, `${name} has a ragged row`);
      assert.match(row, /^[0-9a-f.]+$/, `${name} uses an illegal pixel char`);
    }
  }
});

test('every pixel char has a palette entry', () => {
  for (const [name, sprite] of ALL) {
    for (const row of sprite.rows) {
      for (const ch of row) {
        if (ch === '.') continue;
        assert.ok(sprite.palette[parseInt(ch, 16)], `${name} uses slot ${ch} with no colour`);
      }
    }
  }
});

test('palettes have depth, not three flat colours', () => {
  for (const [name, pal] of [['PLANE_PAL', PLANE_PAL], ['CARRIER_PAL', CARRIER_PAL], ['SEA_PAL', SEA_PAL]]) {
    const used = pal.filter(Boolean);
    assert.ok(used.length >= 4, `${name} has only ${used.length} colours`);
    assert.ok(used.length <= 10, `${name} has ${used.length} colours, over the budget of 10`);
    assert.equal(new Set(used).size, used.length, `${name} repeats a colour`);
  }
});

test('the plane art matches the plane hitbox', () => {
  for (const f of PLANE_FRAMES) {
    assert.equal(f.w, PLANE_W);
    assert.equal(f.h, PLANE_H);
  }
});

test('the propeller actually animates', () => {
  assert.equal(PLANE_ANIM.frames.length, 2);
  assert.notDeepEqual(PLANE_ANIM.frames[0].rows, PLANE_ANIM.frames[1].rows);
  assert.ok(PLANE_ANIM.duration >= 2 && PLANE_ANIM.duration <= 16, 'a prop blur should be fast');
});

test('the sea undulates', () => {
  const [a, b, c] = WAVE_ANIM.frames;
  assert.equal(WAVE_ANIM.frames.length, 3);
  assert.notDeepEqual(a.rows, b.rows);
  assert.notDeepEqual(b.rows, c.rows);
});

test('the carrier is built from 16px tiles so it can be any length', () => {
  for (const [name, s] of [['C_DECK', C_DECK], ['C_HULL', C_HULL], ['C_WATERLINE', C_WATERLINE]]) {
    assert.equal(s.w, 16, `${name} must be one tile wide`);
    assert.equal(s.h, 16, `${name} must be one tile tall`);
  }
  assert.ok(C_TOWER.h > 16, 'the superstructure should stand above the deck');
});

test('the sky and sea gradient colours are hex', () => {
  for (const c of [SKY_TOP, SKY_HAZE, SEA_DEEP, SEA_SHALLOW]) assert.match(c, /^#[0-9a-f]{6}$/i);
});
```

Sprites construct fine under plain Node — `Sprite` only touches `document` when something reads `.canvas`, and nothing here does.

- [ ] **Step 10: Write the plane art**

Create `src/wings/art/plane.js`:

```js
import { makeSprite, Anim } from '../../core/gfx.js';

// A carrier fighter-bomber, right-facing and level. Sun from the upper-left:
// slot 3 is the lit spine, slot 1 the shaded belly. Slot 6 is the canopy glass
// and slot 4 the prop disc, the only two things on the aircraft that catch a
// specular highlight.
export const PLANE_PAL = [
  '#0a0d14', // 0 outline
  '#2e4155', // 1 shadow
  '#4a657f', // 2 mid
  '#7392b0', // 3 lit spine
  '#cfe2f7', // 4 highlight / prop disc
  '#12304e', // 5 canopy frame
  '#69c4ff', // 6 canopy glass
  '#c34a34', // 7 squadron flash
];
PLANE_PAL[12] = '#a9bdd2'; // c: prop blur, one step down from the highlight

const A = [
  '...0....................',
  '..0130..................',
  '..01230.................',
  '..012230................',
  '.0012223000000000000004.',
  '0111222333333336655500c4',
  '.0112222222222266655500c',
  '..01122222222222222110c4',
  '...0112222222221100004..',
  '.....01222222110....04..',
  '......01122110......04..',
  '.......000000........0..',
];

// Frame B moves the disc highlight down the arc, so the blade reads as turning
// rather than as a static smear.
const B = [
  '...0....................',
  '..0130..................',
  '..01230.............0...',
  '..012230............0c..',
  '.0012223000000000000004.',
  '0111222333333336655500c4',
  '.0112222222222266655500c',
  '..01122222222222222110c4',
  '...0112222222221100004..',
  '.....01222222110....0c..',
  '......01122110......0...',
  '.......000000...........',
];

export const PLANE_FRAMES = [
  makeSprite(A, PLANE_PAL, { name: 'wings.plane.a' }),
  makeSprite(B, PLANE_PAL, { name: 'wings.plane.b' }),
];

// Two ticks a frame: at 60Hz the disc strobes, which is what a propeller does.
export const PLANE_ANIM = new Anim(PLANE_FRAMES, 2);

// Drawn under the tail when the hook is down, so "gear" is visible on the
// aircraft and not just a word in the HUD.
export const HOOK = makeSprite(
  ['.000..', '.011..', '..01..', '..010.', '...01.', '...00.'],
  PLANE_PAL,
  { name: 'wings.hook' }
);
```

- [ ] **Step 11: Write the carrier art**

Create `src/wings/art/carrier.js`:

```js
import { makeSprite } from '../../core/gfx.js';

// Warship grey, lit from above: the deck plating is the brightest thing on the
// ship and every surface below it steps down. Slot 5 is the deck centreline,
// slot 6 the boot topping at the waterline, slot 7 the lit ports on the
// island — the only warm colours on an otherwise cold hull.
export const CARRIER_PAL = [
  '#0a0c12', // 0 outline / rivets
  '#39404f', // 1 hull shadow
  '#585f70', // 2 hull mid
  '#7d8698', // 3 upper works
  '#a8b2c4', // 4 deck plating
  '#d9a441', // 5 centreline
  '#8f2f24', // 6 boot topping
  '#ffe9a8', // 7 lit ports
];

// The deck surface. Tiled from DECK_X0 to DECK_X1 with its top row at DECK_Y.
export const C_DECK = makeSprite(
  [
    '4444444444444444', '3333333333333333', '3355335533553355', '2222222222222222',
    '1111011110111101', '1111111111111111', '1111111111111111', '1111011110111101',
    '1111111111111111', '1111111111111111', '1111011110111101', '1111111111111111',
    '1111111111111111', '1111011110111101', '1111111111111111', '1111111111111111',
  ],
  CARRIER_PAL,
  { name: 'wings.carrier.deck' }
);

export const C_HULL = makeSprite(
  [
    '1111111111111111', '1111011110111101', '1111111111111111', '1111111111111111',
    '1111011110111101', '1111111111111111', '1111111111111111', '1111011110111101',
    '1111111111111111', '1111111111111111', '1111011110111101', '1111111111111111',
    '1111111111111111', '1111011110111101', '1111111111111111', '1111111111111111',
  ],
  CARRIER_PAL,
  { name: 'wings.carrier.hull' }
);

// The tile straddling sea level: hull, boot topping, then nothing below.
export const C_WATERLINE = makeSprite(
  [
    '1111111111111111', '1111011110111101', '1111111111111111', '0000000000000000',
    '6666666666666666', '6666666666666666', '6666666666666666', '0000000000000000',
    '1111111111111111', '1111011110111101', '1111111111111111', '0000000000000000',
    '................', '................', '................', '................',
  ],
  CARRIER_PAL,
  { name: 'wings.carrier.waterline' }
);

// The island: mast, bridge and flight-control gallery. Its bottom row aligns
// with DECK_Y.
export const C_TOWER = makeSprite(
  [
    '............0...........',
    '...........040..........',
    '...........040..........',
    '...........040..........',
    '..........04440.........',
    '...........040..........',
    '...........040..........',
    '......000000000000......',
    '.....04444444444440.....',
    '.....03333333333330.....',
    '.....03277777772330.....',
    '.....03277777772330.....',
    '.....03222222222330.....',
    '...0003333333333300000..',
    '...0444444444444444440..',
    '...0333333333333333330..',
    '...0327777732777773330..',
    '...0327777732777773330..',
    '...0322222232222223330..',
    '...0333333333333333330..',
    '...0222222222222222220..',
    '...0222222222222222220..',
    '...0111111111111111110..',
    '...0111111111111111110..',
    '...0000000000000000000..',
  ],
  CARRIER_PAL,
  { name: 'wings.carrier.tower' }
);
```

- [ ] **Step 12: Write the ocean and ordnance art**

The ordnance sprites live here rather than waiting for Task 3, so all the art lands in one commit and one test file. Create `src/wings/art/ocean.js`:

```js
import { makeSprite, Anim } from '../../core/gfx.js';

// The sky and sea gradients are painted with fillRect, not sprites: a 512x240
// backdrop as pixel strings would be 240 rows of nothing. Only the surface
// itself, where the eye actually looks, is authored art.
export const SKY_TOP = '#1b3f88';
export const SKY_HAZE = '#8ec4e8';
export const SEA_SHALLOW = '#1c6ea8';
export const SEA_DEEP = '#06213f';

export const SEA_PAL = [
  '#04182f', // 0 trough outline
  '#0f4a7a', // 1 deep
  '#1c6ea8', // 2 body
  '#3fa0d4', // 3 lit face
  '#c8ecff', // 4 foam
];

// Three phases of the same swell, cycled by tick, so the horizon is never a
// straight line.
export const WAVE_ANIM = new Anim(
  [
    makeSprite(
      ['................', '..000...........', '.04440......000.',
       '.03330.....04440', '002220.....03330', '0022200000002220'],
      SEA_PAL, { name: 'wings.wave.a' }
    ),
    makeSprite(
      ['................', '.......000......', '000....04440....',
       '04440..03330....', '03330..02220..00', '0222000022200044'],
      SEA_PAL, { name: 'wings.wave.b' }
    ),
    makeSprite(
      ['................', '.....000........', '.....04440......',
       '000..03330......', '04440.02220.....', '0333000222000000'],
      SEA_PAL, { name: 'wings.wave.c' }
    ),
  ],
  10
);

export const CLOUD_PAL = ['#7f9dc4', '#c2d6ee', '#e9f2ff', '#ffffff'];

// Parallax cloud. Lit on top, shaded underneath — the same light as everything
// else in the game.
export const CLOUD = makeSprite(
  [
    '......000000....',
    '...000333333000.',
    '..0333333333330.',
    '.033322222222330',
    '.032222222222220',
    '..000000000000..',
  ],
  CLOUD_PAL,
  { name: 'wings.cloud' }
);

export const ORD_PAL = [
  '#0a0a10', // 0 outline
  '#4a4f5c', // 1 shadowed steel
  '#7d8492', // 2 steel
  '#c6ccd8', // 3 lit steel
  '#ffd66b', // 4 tracer core
];

export const BOMB = makeSprite(
  ['.00.', '0330', '0230', '0230', '0220', '0220', '0110', '0110', '.010', '0.0.'],
  ORD_PAL,
  { name: 'wings.bomb' }
);

export const ROCKET = makeSprite(
  ['..0000000000', '.03322222210', '032222222110', '.0111111110.'],
  ORD_PAL,
  { name: 'wings.rocket' }
);

export const TRACER = makeSprite(['0440', '0330'], ORD_PAL, { name: 'wings.tracer' });

export const PUFF_PAL = [
  '#1a0c06', '#5c2408', '#a4470f', '#e2842a', '#ffd06b', '#fff4c4',
];

// One puff. An explosion is several of these placed around the crater rim at
// deterministic angles, which reads bigger than any single sprite and costs one
// drawing instead of a sheet.
export const PUFF = makeSprite(
  [
    '...0000...',
    '.00544400.',
    '0544433300',
    '0544333220',
    '.054332200',
    '..00322000',
    '...00000..',
  ],
  PUFF_PAL,
  { name: 'wings.puff' }
);
```

Run: `npm run test:unit` — Expected: PASS, 8 art tests.

- [ ] **Step 13: Write the pilot renderer**

Create `src/wings/pilot-renderer.js`:

```js
import { LAYER } from '../core/constants.js';
import { VIEW_W, VIEW_H } from './geo.js';

const LAYER_COUNT = 16;
const MAX_SCALE = 4;

// The pilot's viewport: 512x240 at the same 1:1 art scale as Mario's 256x240,
// twice as wide, scrolling in both axes. Same layer-queue API as the engine
// renderer (ARCHITECTURE.md section 9) so a system written against one works
// against the other. Presented through Canvas2D rather than the WebGL post
// chain — see "Recorded decision" at the top of this plan.
export class PilotRenderer {
  constructor(canvas) {
    this.buffer = document.createElement('canvas');
    this.buffer.width = VIEW_W;
    this.buffer.height = VIEW_H;
    this.ctx = this.buffer.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;

    this.canvas = canvas;
    this.canvas.style.imageRendering = 'pixelated';
    this.dctx = canvas.getContext('2d', { alpha: false });
    this.dctx.imageSmoothingEnabled = false;

    this.scale = 1;
    this.frames = 0;
    this._layers = [];
    for (let i = 0; i < LAYER_COUNT; i++) this._layers.push([]);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
  }

  // Integer scale only. A half-pixel viewport is not a pixel game.
  resize() {
    const availW = Math.max(VIEW_W, (window.innerWidth || VIEW_W) - 48);
    const availH = Math.max(VIEW_H, (window.innerHeight || VIEW_H) - 96);
    const fit = Math.min(Math.floor(availW / VIEW_W), Math.floor(availH / VIEW_H));
    const s = Math.max(1, Math.min(MAX_SCALE, fit));
    this.scale = s;
    if (this.canvas.width !== VIEW_W * s || this.canvas.height !== VIEW_H * s) {
      this.canvas.width = VIEW_W * s;
      this.canvas.height = VIEW_H * s;
      this.dctx.imageSmoothingEnabled = false;
    }
    this.canvas.style.width = `${VIEW_W * s}px`;
    this.canvas.style.height = `${VIEW_H * s}px`;
    return this;
  }

  beginFrame() {
    for (const bucket of this._layers) bucket.length = 0;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.filter = 'none';
    return ctx;
  }

  // Queue fn(ctx, renderer) on a layer from constants.LAYER. Callbacks run in
  // layer order, submission order within a layer, each inside save()/restore().
  draw(layer, fn) {
    if (typeof fn !== 'function') return this;
    const idx = Math.max(0, Math.min(LAYER_COUNT - 1, layer | 0));
    this._layers[idx].push(fn);
    return this;
  }

  flush() {
    const ctx = this.ctx;
    for (const bucket of this._layers) {
      for (const fn of bucket) {
        ctx.save();
        try {
          fn(ctx, this);
        } finally {
          ctx.restore();
        }
      }
      bucket.length = 0;
    }
    return this;
  }

  present() {
    this.flush();
    const d = this.dctx;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalAlpha = 1;
    d.globalCompositeOperation = 'source-over';
    d.imageSmoothingEnabled = false;
    d.drawImage(this.buffer, 0, 0, this.canvas.width, this.canvas.height);
    this.frames++;
    return this;
  }

  snapshot(type = 'image/png') {
    return this.canvas.toDataURL(type);
  }
}

export { LAYER };
export default PilotRenderer;
```

- [ ] **Step 14: Write the scene**

Islands, shots and explosions are added in Tasks 2 and 3. Create `src/wings/scene.js`:

```js
import { LAYER, TILE } from '../core/constants.js';
import { text } from '../data/sprites/font.js';
import {
  VIEW_W, VIEW_H, SEA_Y, CEILING_Y, DECK_X0, DECK_X1, DECK_Y, PLANE_W, PLANE_H, clamp,
} from './geo.js';
import { MODE, FLIGHT } from './flight.js';
import { PLANE_ANIM, HOOK } from './art/plane.js';
import { C_DECK, C_HULL, C_WATERLINE, C_TOWER } from './art/carrier.js';
import { SKY_TOP, SKY_HAZE, SEA_SHALLOW, SEA_DEEP, WAVE_ANIM, CLOUD } from './art/ocean.js';

// Rotation is quantised to 1/32 of a turn. Free rotation of a pixel sprite
// shimmers as the sampling grid slides under it; 32 stops reads as smooth and
// stays stable enough to look drawn rather than filtered.
const ROT_STEPS = 32;
const ROT_STEP = (Math.PI * 2) / ROT_STEPS;

export function drawRotated(ctx, sprite, cx, cy, angle, flipX = false) {
  const a = Math.round(angle / ROT_STEP) * ROT_STEP;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.floor(cx), Math.floor(cy));
  ctx.rotate(a);
  ctx.drawImage(sprite.variant(flipX, false), -Math.floor(sprite.w / 2), -Math.floor(sprite.h / 2));
  ctx.restore();
}

// Clouds sit at fixed world positions and drift. The list is a literal, so the
// sky is identical on every run and in every screenshot.
const CLOUDS = [
  { x: 320, y: 60, m: 0.35 }, { x: 980, y: 128, m: 0.5 }, { x: 1500, y: 40, m: 0.25 },
  { x: 2100, y: 150, m: 0.55 }, { x: 2760, y: 80, m: 0.4 }, { x: 3400, y: 36, m: 0.3 },
  { x: 4100, y: 140, m: 0.5 }, { x: 4800, y: 96, m: 0.35 }, { x: 5600, y: 52, m: 0.28 },
];

export class Scene {
  constructor() {
    this.fx = [];
    this.consumed = 0;
    this.tick = 0;
  }

  // Turn sim events into visual effects. Called once per rendered frame; the
  // sim never knows this exists. Tasks 2 and 3 add cases here.
  consume(sim) {
    for (let i = this.consumed; i < sim.events.length; i++) {
      const e = sim.events[i];
      if (e.type === 'planeLost') this.fx.push({ kind: 'blast', x: e.x, y: e.y, r: 40, t: 0 });
    }
    this.consumed = sim.events.length;
    this.tick = sim.tick;
    for (const f of this.fx) f.t++;
    this.fx = this.fx.filter((f) => f.t < 24);
    return this;
  }

  submit(r, sim) {
    const cam = sim.cam;
    this.drawSky(r, cam);
    this.drawClouds(r, cam);
    this.drawCarrier(r, cam);
    this.drawSea(r, cam);
    this.drawPlane(r, sim, cam);
    this.drawHud(r, sim);
    return this;
  }

  // Deep blue at the ceiling fading to haze at the horizon, so altitude is
  // legible from the backdrop alone with the HUD covered up.
  drawSky(r, cam) {
    r.draw(LAYER.SKY, (ctx) => {
      const g = ctx.createLinearGradient(0, CEILING_Y - cam.y, 0, SEA_Y - cam.y);
      g.addColorStop(0, SKY_TOP);
      g.addColorStop(1, SKY_HAZE);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    });
  }

  drawClouds(r, cam) {
    r.draw(LAYER.PARALLAX_FAR, (ctx) => {
      for (const c of CLOUDS) {
        const drift = (this.tick * 0.02 * c.m) % 4096;
        const sx = Math.floor(c.x - drift - cam.x * c.m);
        const sy = Math.floor(c.y - cam.y * c.m * 0.6);
        if (sx > VIEW_W || sx + CLOUD.w * 3 < 0) continue;
        // Three overlapping stamps make one bigger, less repetitive cloud.
        CLOUD.draw(ctx, sx, sy);
        CLOUD.draw(ctx, sx + 12, sy + 2);
        CLOUD.draw(ctx, sx + 24, sy - 1);
      }
    });
  }

  drawCarrier(r, cam) {
    r.draw(LAYER.BG_TILES, (ctx) => {
      if (DECK_X1 - cam.x < 0 || DECK_X0 - cam.x > VIEW_W) return;
      for (let x = DECK_X0; x < DECK_X1; x += TILE) {
        const sx = x - cam.x;
        C_DECK.draw(ctx, sx, DECK_Y - cam.y);
        for (let y = DECK_Y + TILE; y < SEA_Y - TILE; y += TILE) C_HULL.draw(ctx, sx, y - cam.y);
        C_WATERLINE.draw(ctx, sx, SEA_Y - TILE - cam.y);
      }
      C_TOWER.draw(ctx, DECK_X1 - 64 - cam.x, DECK_Y - C_TOWER.h - cam.y);
    });
  }

  // Painted on the OVERLAY layer so the plane and the hull are visibly IN the
  // water when they go under, rather than floating on a flat blue band.
  drawSea(r, cam) {
    r.draw(LAYER.OVERLAY, (ctx) => {
      const top = SEA_Y - cam.y;
      if (top > VIEW_H) return;
      const g = ctx.createLinearGradient(0, top, 0, VIEW_H);
      g.addColorStop(0, SEA_SHALLOW);
      g.addColorStop(1, SEA_DEEP);
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = g;
      ctx.fillRect(0, Math.max(0, top), VIEW_W, VIEW_H - Math.max(0, top));
      ctx.globalAlpha = 1;

      const w = WAVE_ANIM.frames[0].w;
      const first = Math.floor(cam.x / w) * w;
      for (let x = first; x < cam.x + VIEW_W + w; x += w) {
        // De-phase alternate columns so the swell is not a stamped ribbon.
        WAVE_ANIM.frame(this.tick + (x / w) * 5).draw(ctx, x - cam.x, top - 2);
      }
    });
  }

  drawPlane(r, sim, cam) {
    r.draw(LAYER.PLAYER, (ctx) => {
      const p = sim.plane;
      if (p.mode === MODE.DOWN) ctx.globalAlpha = 0.6;
      const cx = p.x + PLANE_W / 2 - cam.x;
      const cy = p.y + PLANE_H / 2 - cam.y;
      // Mirroring maps a rotation of theta onto -theta, so a left-facing plane
      // is drawn flipped and rotated by PI - angle.
      const flip = Math.cos(p.angle) < 0;
      const rot = flip ? Math.PI - p.angle : p.angle;
      if (p.gear) drawRotated(ctx, HOOK, cx - (flip ? -10 : 10), cy + 4, rot, flip);
      drawRotated(ctx, PLANE_ANIM.frame(p.throttle > 0 ? this.tick : 0), cx, cy, rot, flip);
      ctx.globalAlpha = 1;
    });
  }

  drawHud(r, sim) {
    r.draw(LAYER.HUD, (ctx) => {
      const p = sim.plane;
      ctx.fillStyle = 'rgba(6,10,18,0.72)';
      ctx.fillRect(0, 0, VIEW_W, 26);
      ctx.fillStyle = 'rgba(120,160,255,0.4)';
      ctx.fillRect(0, 26, VIEW_W, 1);

      label(ctx, 'FUEL', 8, 4);
      bar(ctx, 44, 6, 72, 8, p.fuel / FLIGHT.FUEL_MAX, '#4ad06a', '#c33a2c');
      label(ctx, `PLANES ${sim.squadron}`, 132, 4);
      label(ctx, `ALT ${Math.max(0, Math.round(SEA_Y - (p.y + PLANE_H)))}`, 8, 14);
      label(ctx, `SPD ${p.speed.toFixed(1)}`, 92, 14);
      label(ctx, p.gear ? 'HOOK DOWN' : 'HOOK UP', 168, 14);
      // The approach gate, so the pilot can see WHY the last one was a crash.
      const v = sim.lastVerdict;
      if (v && v.inBox) label(ctx, v.reason.toUpperCase(), 268, 14);
      if (sim.status === 'lost') label(ctx, 'PLANE LOST - R', 380, 4);
      if (sim.status === 'over') label(ctx, 'SQUADRON GONE', 380, 4);
    });
  }
}

function label(ctx, str, x, y) {
  let cx = x;
  for (const glyph of text(String(str))) {
    glyph.draw(ctx, cx, y);
    cx += glyph.w;
  }
  return cx - x;
}

function bar(ctx, x, y, w, h, fraction, full, empty) {
  const k = clamp(fraction, 0, 1);
  ctx.fillStyle = '#0a0d14';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#1d2430';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = k > 0.25 ? full : empty;
  ctx.fillRect(x, y, Math.round(w * k), h);
}

export default Scene;
```

- [ ] **Step 15: Write the page**

Create `pilot.html`. It is deliberately a sibling of `index.html`, not a variant of it — upstream owns `index.html`.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>WINGS OF MARIO — PILOT</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    height: 100%;
    background: #04050a;
    color: #cdd6f4;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow: hidden;
  }
  body {
    display: grid;
    place-items: center;
    background: radial-gradient(120% 90% at 50% 0%, #101a2e 0%, #06080f 55%, #04050a 100%);
  }
  #stage {
    position: relative;
    display: grid;
    place-items: center;
    padding: 18px;
    border-radius: 18px;
    background: linear-gradient(180deg, #121722 0%, #0a0c12 100%);
    box-shadow: 0 0 0 1px rgba(255,255,255,.05), 0 30px 80px -20px rgba(0,0,0,.9);
  }
  #screen {
    display: block;
    image-rendering: pixelated;
    border-radius: 4px;
    background: #000;
    box-shadow: 0 0 0 2px #000;
    touch-action: none;
  }
  #hint {
    position: fixed;
    bottom: 18px; left: 0; right: 0;
    text-align: center;
    font-size: 10px;
    letter-spacing: .2em;
    color: #46527a;
    pointer-events: none;
  }
  #hint b { color: #7f92c9; font-weight: 600; }
  body.headless { background: #000; }
  body.headless #stage { box-shadow: none; background: none; padding: 0; border-radius: 0; }
  body.headless #screen { box-shadow: none; border-radius: 0; }
  body.headless #hint { display: none; }
</style>
</head>
<body>
  <div id="stage"><canvas id="screen" width="1024" height="480"></canvas></div>
  <div id="hint">
    <b>&uarr;</b> NOSE UP &nbsp;·&nbsp; <b>&darr;</b> NOSE DOWN &nbsp;·&nbsp;
    <b>&larr;</b> THROTTLE OFF &nbsp;·&nbsp; <b>G</b> HOOK &nbsp;·&nbsp; <b>R</b> NEXT PLANE
  </div>
  <script type="module" src="./src/wings/pilot-main.js"></script>
</body>
</html>
```

- [ ] **Step 16: Write the entry point**

Bomb and gun keys are wired in Task 3, and the bot primitives in Task 4. Create `src/wings/pilot-main.js`:

```js
import { bakeAll } from '../core/gfx.js';
import { GameLoop } from '../core/loop.js';
import { PilotRenderer } from './pilot-renderer.js';
import { Scene } from './scene.js';
import { WingsSim } from './sim.js';

const HEADLESS = new URLSearchParams(location.search).has('headless');
if (HEADLESS) document.body.classList.add('headless');

// The pilot owns its own keyboard rather than borrowing core/input.js: that Pad
// is Mario's, its two maps are already spoken for, and a second consumer of the
// same key events is a bug waiting to happen.
const KEYMAP = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'slow',
  KeyG: 'gear',
  KeyR: 'respawn',
};

const keys = Object.create(null);
let scripted = null;
let gear = true;

function readKeys() {
  if (scripted) return scripted;
  return {
    pitch: (keys.up ? 1 : 0) + (keys.down ? -1 : 0),
    throttle: keys.slow ? 0 : 1,
    gear,
  };
}

class Pilot {
  constructor() {
    this.renderer = null;
    this.sim = null;
    this.scene = null;
    this.loop = null;
    this.fatal = null;
  }

  async boot() {
    bakeAll();
    this.renderer = new PilotRenderer(document.getElementById('screen'));
    this.reset();

    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => {
      for (const k of Object.keys(keys)) keys[k] = false;
    });

    this.loop = new GameLoop(() => this.update(), () => this.render());
    this.render();
    if (!HEADLESS) this.loop.start();
    return this;
  }

  reset(opts = {}) {
    this.sim = new WingsSim({ squadron: opts.squadron });
    this.scene = new Scene();
    gear = true;
    scripted = null;
    return this.sim;
  }

  key(e, down) {
    const name = KEYMAP[e.code];
    if (!name) return;
    e.preventDefault();
    if (down && !keys[name]) {
      if (name === 'gear') gear = !gear;
      if (name === 'respawn' && this.sim.plane.mode === 'down') this.sim.respawn();
    }
    keys[name] = down;
  }

  update() {
    if (this.fatal) return;
    try {
      this.sim.step(readKeys());
    } catch (e) {
      this.crash(e);
    }
  }

  render() {
    if (this.fatal) return;
    try {
      this.scene.consume(this.sim);
      this.renderer.beginFrame();
      this.scene.submit(this.renderer, this.sim);
      this.renderer.present();
    } catch (e) {
      this.crash(e);
    }
  }

  crash(e) {
    if (this.fatal) return;
    this.fatal = e;
    console.error('[pilot fatal]', e);
    if (this.loop) this.loop.stop();
  }
}

const pilot = new Pilot();
const ready = pilot.boot().catch((e) => {
  console.error('[pilot boot] failed:', e);
  pilot.crash(e);
  throw e;
});

// ---------------------------------------------------------------------------
// Scripted control API — design spec section 8.2. Mirrors window.__GAME, which
// lives on index.html and is not touched by any of this.
// ---------------------------------------------------------------------------
window.__WINGS = {
  ready,
  get sim() {
    return pilot.sim;
  },
  get renderer() {
    return pilot.renderer;
  },
  get scene() {
    return pilot.scene;
  },

  // Persists across ticks until release(). Unspecified fields default off, so
  // hold({pitch: 1}) also cuts the throttle — say what you mean.
  hold(map = {}) {
    scripted = {
      pitch: map.pitch || 0,
      throttle: map.throttle == null ? 0 : map.throttle,
      drop: !!map.drop,
      fire: !!map.fire,
      gear: map.gear == null ? pilot.sim.plane.gear : !!map.gear,
    };
    return true;
  },

  release() {
    scripted = null;
    return true;
  },

  // Advance n fixed steps and render once, ignoring rAF.
  tick(n = 1) {
    for (let i = 0; i < n; i++) {
      pilot.update();
      pilot.loop.tick++;
    }
    pilot.render();
    return pilot.sim.tick;
  },

  state() {
    return pilot.sim.state();
  },

  events() {
    return pilot.sim.events.map((e) => ({ ...e }));
  },

  respawn() {
    const ok = pilot.sim.respawn();
    pilot.render();
    return ok;
  },

  reset(opts) {
    pilot.reset(opts);
    pilot.render();
    return true;
  },

  pause() {
    pilot.loop.stop();
    return true;
  },

  resume() {
    pilot.loop.start();
    return true;
  },

  snapshot(type) {
    return pilot.renderer.snapshot(type);
  },

  fatal() {
    return pilot.fatal ? String(pilot.fatal.message || pilot.fatal) : null;
  },
};

export default pilot;
```

- [ ] **Step 17: Fly it**

Serve the repo — **not with `npm start`, which uses the squatted port 8123**:

```bash
npx http-server -p 8199 -c-1 --silent .
```

Then in another terminal, drive a takeoff headlessly and confirm the numbers match the verified reference:

```bash
node -e "import('playwright').then(async ({chromium}) => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8199/pilot.html?headless');
  await p.evaluate(() => window.__WINGS.ready);
  const r = await p.evaluate(() => {
    const W = window.__WINGS;
    const start = W.state().x;
    W.hold({throttle: 1, pitch: 0}); W.tick(120);
    const rolling = W.state();
    W.hold({throttle: 1, pitch: 1}); W.tick(40);
    const flying = W.state();
    return { used: rolling.x - start, speed: rolling.speed, mode: flying.mode,
             buffer: [W.renderer.buffer.width, W.renderer.buffer.height] };
  });
  console.log('deck used:', r.used.toFixed(0), 'speed:', r.speed.toFixed(2));
  console.log('mode after rotation:', r.mode, 'buffer:', r.buffer);
  console.log('errors:', errs);
  await b.close();
})"
```

Expected: roughly 150–190px of deck used, speed above 2.0, `mode after rotation: air`, `buffer: [ 512, 240 ]`, `errors: []`.

Then **open `http://localhost:8199/pilot.html` in a real browser and fly it.** Hold Up to rotate off the deck, keep holding to loop, press G to drop the hook, and put it back on the deck. This is the first thing in this project the user can actually play; if it is not fun to fly, say so now rather than after Task 5.

- [ ] **Step 18: Confirm the engine is untouched, then commit**

Run: `git status --porcelain -- src/core src/game src/render src/data src/ui src/audio src/main.js index.html`
Expected: **empty output.**

Run: `npm run test:unit` — Expected: PASS, 41 new tests on top of the 20 that were already green.

```bash
git add src/wings/geo.js src/wings/flight.js src/wings/carrier.js src/wings/sim.js \
        src/wings/art src/wings/pilot-renderer.js src/wings/scene.js \
        src/wings/pilot-main.js pilot.html \
        tests/unit/geo.test.js tests/unit/flight.test.js tests/unit/carrier.test.js tests/unit/art.test.js
git commit -m "A carrier, an ocean, and a plane you can fly

pilot.html is a second entry point beside index.html, so src/main.js and
window.__GAME are untouched and MODS.md gains nothing. Roll down the deck,
loop to turn, hit the ceiling, take the wire, or ditch in the sea."
```

---

## Task 2: Islands you can crash into

An island is an upstream level plus its destroyed-set. The pilot never constructs a `World` — he only needs to know which tiles are still there, which is what makes bombing an island nobody is standing on nearly free, and keeps every terrain rule in tier-1 Node tests.

**Files:**
- Create: `src/wings/island.js`, `tests/unit/island.test.js`
- Modify: `src/wings/sim.js`, `src/wings/scene.js`, `src/wings/pilot-main.js`

**Interfaces:**
- Consumes: `TILE`; `tileForChar` from `src/data/tiles.js`; `blastTiles`, `tileKey`, `parseTileKey` from `src/wings/blast.js`; `ISLAND_TOP_Y`, `worldToLocalTile` from geo.
- Produces `class Island`: `.id`, `.originX`, `.w`, `.h`, `.x0`, `.x1`, `.y0`, `.y1`, `charAt`, `blocksTile`, `destructibleTile`, `blocksAt`, `contains`, `applyDamage`, `blast`, `keys`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/island.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../src/core/constants.js';
import { getLevel } from '../../src/data/levels/index.js';
import { ISLAND_TOP_Y, localTileToWorld } from '../../src/wings/geo.js';
import { Island } from '../../src/wings/island.js';

const ORIGIN = 3000;
// Rows 13-14 of 1-1 are the solid ground shelf; row 12 is decor.
const GROUND_TX = 20;
const GROUND_TY = 13;

function centreOf(tx, ty) {
  const { x, y } = localTileToWorld(ORIGIN, tx, ty);
  return { x: x + TILE / 2, y: y + TILE / 2 };
}

test('an island reports the upstream level geometry', () => {
  const lvl = getLevel('1-1');
  const isl = new Island(lvl, ORIGIN);
  assert.equal(isl.id, '1-1');
  assert.equal(isl.w, lvl.width);
  assert.equal(isl.h, 15);
  assert.equal(isl.x0, ORIGIN);
  assert.equal(isl.x1, ORIGIN + lvl.width * TILE);
  assert.equal(isl.y0, ISLAND_TOP_Y);
});

test('solid ground blocks flight and open sky does not', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  const g = centreOf(GROUND_TX, GROUND_TY);
  assert.ok(isl.blocksAt(g.x, g.y));
  const sky = centreOf(GROUND_TX, 4);
  assert.ok(!isl.blocksAt(sky.x, sky.y));
});

test('a bomb clears ground permanently', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  const g = centreOf(GROUND_TX, GROUND_TY);
  const changed = isl.blast(g.x, g.y, 2);
  assert.ok(changed.length > 0, 'the blast destroyed nothing');
  assert.ok(changed.includes(`${GROUND_TX},${GROUND_TY}`));
  assert.ok(!isl.blocksAt(g.x, g.y));
  assert.equal(isl.charAt(GROUND_TX, GROUND_TY), '.');
});

// This mirrors world.destroyTiles() exactly. If it ever stops matching, the
// pilot's crater and Mario's crater diverge and Plan 3's desync hash fires.
test('a blast records exactly what it destroyed, and air is never recorded', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  const g = centreOf(GROUND_TX, GROUND_TY);
  const changed = isl.blast(g.x, g.y, 3);
  assert.equal(isl.keys().length, changed.length, 'recorded a key it did not destroy');
  for (const key of changed) {
    const [tx, ty] = key.split(',').map(Number);
    assert.ok(!isl.blocksTile(tx, ty), `${key} was reported destroyed but still blocks`);
  }
  // Bombing the same crater again removes nothing new.
  assert.deepEqual(isl.blast(g.x, g.y, 3), []);
});

test('destructible is a wider set than blocking', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  assert.ok(isl.destructibleTile(GROUND_TX, GROUND_TY), 'ground must be destructible');
  assert.ok(!isl.destructibleTile(GROUND_TX, 4), 'air must not be destructible');
  // Every blocking tile is destructible; the reverse does not hold, because
  // coins, decor and water are removed by a blast but do not stop a plane.
  for (let ty = 0; ty < isl.h; ty++) {
    for (let tx = 0; tx < 40; tx++) {
      if (isl.blocksTile(tx, ty)) assert.ok(isl.destructibleTile(tx, ty), `${tx},${ty}`);
    }
  }
});

test('damage survives rebuilding the island from its keys', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  const g = centreOf(GROUND_TX, GROUND_TY);
  isl.blast(g.x, g.y, 2);
  const again = new Island(getLevel('1-1'), ORIGIN, isl.keys());
  assert.ok(!again.blocksAt(g.x, g.y));
  assert.deepEqual(again.keys(), isl.keys());
});

test('a fresh island of the same level is undamaged', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  const g = centreOf(GROUND_TX, GROUND_TY);
  isl.blast(g.x, g.y, 2);
  assert.ok(new Island(getLevel('1-1'), ORIGIN).blocksAt(g.x, g.y), 'damage leaked between islands');
});

test('nothing outside the island band exists', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  const g = centreOf(GROUND_TX, GROUND_TY);
  assert.ok(!isl.blocksAt(100, g.y));
  assert.ok(!isl.contains(100, g.y));
  assert.ok(isl.contains(g.x, g.y));
  assert.equal(isl.charAt(-1, 0), '.');
  assert.equal(isl.charAt(0, 99), '.');
});

test('a blast that straddles the island edge only records in-bounds tiles', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  isl.blast(ORIGIN + TILE / 2, ISLAND_TOP_Y + 14 * TILE + TILE / 2, 4);
  for (const key of isl.keys()) {
    const [tx, ty] = key.split(',').map(Number);
    assert.ok(tx >= 0 && ty >= 0 && tx < isl.w && ty < isl.h, `${key} is off the island`);
  }
});

test('keys come back sorted and duplicate-free', () => {
  const isl = new Island(getLevel('1-1'), ORIGIN);
  const g = centreOf(GROUND_TX, GROUND_TY);
  isl.blast(g.x, g.y, 3);
  isl.blast(g.x + 64, g.y, 3);
  const keys = isl.keys();
  assert.deepEqual(keys, [...keys].sort());
  assert.equal(new Set(keys).size, keys.length);
});
```

Run: `npm run test:unit` — Expected: FAIL, `Cannot find module '.../src/wings/island.js'`

- [ ] **Step 2: Write the island**

Create `src/wings/island.js`:

```js
import { TILE } from '../core/constants.js';
import { tileForChar } from '../data/tiles.js';
import { blastTiles, tileKey, parseTileKey } from './blast.js';
import { ISLAND_TOP_Y, worldToLocalTile } from './geo.js';

// An unmodified upstream level placed in the ocean as a 15-row band whose
// bottom row sits at sea level. The pilot never loads a Mario World: an island
// is the level definition plus its destroyed-set and nothing else.
export class Island {
  constructor(level, originX, damage = []) {
    this.id = level.id;
    this.level = level;
    this.originX = originX;
    this.rows = level.tiles;
    this.w = level.width;
    this.h = level.tiles.length;
    this.destroyed = new Set();
    if (damage.length) this.applyDamage(damage);
  }

  get x0() { return this.originX; }
  get x1() { return this.originX + this.w * TILE; }
  get y0() { return ISLAND_TOP_Y; }
  get y1() { return ISLAND_TOP_Y + this.h * TILE; }

  inRange(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }

  charAt(tx, ty) {
    if (!this.inRange(tx, ty)) return '.';
    if (this.destroyed.has(tileKey(tx, ty))) return '.';
    return this.rows[ty][tx];
  }

  // What stops an aeroplane: solid tiles and one-way platforms. You fly
  // through a bush and a coin; you do not fly through a pipe.
  blocksTile(tx, ty) {
    const rec = tileForChar(this.charAt(tx, ty));
    return !!rec && (!!rec.solid || !!rec.platform);
  }

  // What a blast removes, which is a WIDER set: any non-air tile, coins and
  // decor and lava included. This is a copy of the predicate in
  // world.destroyTiles(), and the two must stay identical or the pilot's
  // crater and Mario's crater diverge. Note the air record is { name: 'air' }
  // with no `solid` key, so testing `rec.name` is the only correct test.
  destructibleTile(tx, ty) {
    const rec = tileForChar(this.charAt(tx, ty));
    return !!rec && rec.name !== 'air';
  }

  blocksAt(px, py) {
    const { tx, ty } = worldToLocalTile(this.originX, px, py);
    return this.blocksTile(tx, ty);
  }

  contains(px, py) {
    return px >= this.x0 && px < this.x1 && py >= this.y0 && py < this.y1;
  }

  // Silent: used when rebuilding an island that was already bombed.
  applyDamage(keys) {
    for (const key of keys) {
      const { tx, ty } = parseTileKey(key);
      if (this.inRange(tx, ty)) this.destroyed.add(key);
    }
  }

  // A live detonation at world pixel (cx, cy). Only tiles that were NOT air
  // are recorded and returned. Recording a key that was already air would make
  // applyDamage clear it unconditionally on the next load, which is how lava
  // pools and hidden blocks vanish on reload after a blast that never touched
  // them — see world.destroyTiles().
  blast(cx, cy, radiusTiles) {
    const keys = blastTiles(cx - this.originX, cy - ISLAND_TOP_Y, radiusTiles);
    const changed = [];
    for (const key of keys) {
      const { tx, ty } = parseTileKey(key);
      if (!this.inRange(tx, ty)) continue;
      if (this.destroyed.has(key)) continue;
      if (!this.destructibleTile(tx, ty)) continue;
      this.destroyed.add(key);
      changed.push(key);
    }
    return changed;
  }

  keys() {
    return [...this.destroyed].sort();
  }
}

export default Island;
```

Run: `npm run test:unit` — Expected: PASS, 10 island tests.

If `solid ground blocks flight` fails, the shelf is not at row 13 in the current 1-1. Print it and pick a row that is, then use that tile consistently in every later task:

`node -e "import('./src/data/levels/index.js').then(m => m.getLevel('1-1').tiles.forEach((r, y) => console.log(String(y).padStart(2), r.slice(0, 60))))"`

- [ ] **Step 3: Give the sim islands**

Five edits to `src/wings/sim.js`.

**3a.** Add to the imports at the top:

```js
import { DamageMap } from './damage.js';
import { Island } from './island.js';
```

Change the geo import line to include `layoutIslands`, and the flight import to include `nosePoint`:

```js
import { SEA_Y, PLANE_W, PLANE_H, layoutIslands, cameraFor, worldBounds } from './geo.js';
import { MODE, FLIGHT, createPlane, stepPlane, nosePoint, normalizeAngle } from './flight.js';
```

**3b.** In the constructor, replace `this.islands = [];` with:

```js
    this.damage =
      opts.damage instanceof DamageMap ? opts.damage : DamageMap.fromJSON(opts.damage || {});
    this.islands = layoutIslands(opts.levels || []).map(
      (slot) => new Island(slot.level, slot.x, this.damage.keys(slot.id))
    );
```

**3c.** Add two lookups immediately after `rearm()`:

```js
  islandById(id) {
    return this.islands.find((i) => i.id === id) || null;
  }

  islandAt(px, py) {
    for (const i of this.islands) if (i.contains(px, py)) return i;
    return null;
  }
```

**3d.** In `checkPlane()`, insert the terrain check between the sea check and the landing verdict. Both the nose and the centre are tested, so a shallow pass into a cliff face registers on the nose rather than a frame later:

```js
    for (const pt of [nosePoint(p), { x: p.x + PLANE_W / 2, y: p.y + PLANE_H / 2 }]) {
      const island = this.islandAt(pt.x, pt.y);
      if (island && island.blocksAt(pt.x, pt.y)) return this.lose('terrain');
    }
```

**3e.** In `state()`, add the island the plane is over, immediately before `cam`:

```js
      island: (this.islandAt(p.x, p.y) || this.islandAt(p.x, SEA_Y - 8) || { id: null }).id,
```

- [ ] **Step 4: Draw the islands**

Two edits to `src/wings/scene.js`.

**4a.** Add the tile lookup import, and add `ISLAND_TOP_Y` to the existing geo import line:

```js
import { CHAR_TO_TILE, animatedSpriteFor } from '../data/tiles.js';
```

**4b.** Add the method, and call it from `submit()` between `drawClouds` and `drawCarrier`:

```js
  drawIslands(r, sim, cam) {
    r.draw(LAYER.TILES, (ctx) => {
      for (const island of sim.islands) {
        if (island.x1 - cam.x < 0 || island.x0 - cam.x > VIEW_W) continue;
        const theme = island.level.theme || 'overworld';
        const tx0 = Math.max(0, Math.floor((cam.x - island.originX) / TILE));
        const tx1 = Math.min(island.w - 1, Math.ceil((cam.x + VIEW_W - island.originX) / TILE));
        const ty0 = Math.max(0, Math.floor((cam.y - ISLAND_TOP_Y) / TILE));
        const ty1 = Math.min(island.h - 1, Math.ceil((cam.y + VIEW_H - ISLAND_TOP_Y) / TILE));
        for (let ty = ty0; ty <= ty1; ty++) {
          for (let tx = tx0; tx <= tx1; tx++) {
            const ch = island.charAt(tx, ty);
            if (ch === '.') continue;
            const id = CHAR_TO_TILE[ch];
            if (!id) continue;
            // The tile directly above decides the capping sprites: a waterline
            // on lava, a lit tread on a staircase.
            const above = ty === 0 ? null : CHAR_TO_TILE[island.charAt(tx, ty - 1)] || 0;
            const sprite = animatedSpriteFor(theme, id, tx, ty, this.tick, above);
            if (!sprite) continue;
            sprite.draw(ctx, island.originX + tx * TILE - cam.x, ISLAND_TOP_Y + ty * TILE - cam.y);
          }
        }
      }
    });
  }
```

- [ ] **Step 5: Put the archipelago in the water**

Three edits to `src/wings/pilot-main.js`.

**5a.** Add the import and the level list near the top:

```js
import { getLevel } from '../data/levels/index.js';

// The four islands of world 1. Which world is on the water is Plan 3's
// business; this page always flies world 1.
const LEVEL_IDS = ['1-1', '1-2', '1-3', '1-4'];
```

**5b.** Replace the body of `reset()`:

```js
  reset(opts = {}) {
    this.sim = new WingsSim({
      levels: LEVEL_IDS.map(getLevel).filter(Boolean),
      damage: opts.damage || {},
      squadron: opts.squadron,
    });
    this.scene = new Scene();
    gear = true;
    scripted = null;
    return this.sim;
  }
```

**5c.** Add a `damage()` member to `window.__WINGS`, next to `events()`:

```js
  damage() {
    return pilot.sim.damage.toJSON();
  },
```

- [ ] **Step 6: Fly into an island**

Serve on 8199 as in Task 1, then:

```bash
node -e "import('playwright').then(async ({chromium}) => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8199/pilot.html?headless');
  await p.evaluate(() => window.__WINGS.ready);
  const r = await p.evaluate(() => {
    const W = window.__WINGS;
    const isl = W.sim.islandById('1-1');
    W.hold({throttle: 1, pitch: 0}); W.tick(140);
    W.hold({throttle: 1, pitch: 1}); W.tick(30);
    // Put the plane straight into the ground shelf.
    W.sim.plane.x = isl.originX + 20 * 16;
    W.sim.plane.y = 320 + 13 * 16;
    W.tick(1);
    return { islands: W.sim.islands.map(i => i.id), state: W.state(), last: W.events().at(-1) };
  });
  console.log(r); console.log('errors:', errs);
  await b.close();
})"
```

Expected: `islands: [ '1-1', '1-2', '1-3', '1-4' ]`, `state.mode: 'down'`, `last.reason: 'terrain'`, `errors: []`.

Then open the page and fly east until an island comes over the horizon. It should be recognisably 1-1, sitting in the sea with its bottom row at the waterline.

- [ ] **Step 7: Commit**

```bash
git add src/wings/island.js src/wings/sim.js src/wings/scene.js src/wings/pilot-main.js \
        tests/unit/island.test.js
git commit -m "Islands: upstream levels in the ocean, and terrain that ends a sortie

An island is a level definition plus its destroyed-set, never a World, so
bombing one nobody is standing on costs nothing. Island.blast mirrors
world.destroyTiles exactly, including recording only non-air tiles."
```

---

## Task 3: Ordnance

The full Wings of Fury arsenal, the craters it makes, and the mistake of dropping from too low. `predictImpact` runs the *same* integrator as the live bomb, so the telegraph Plan 4 draws will agree with the crater to the pixel.

**Do not reach for `world.blast()` here.** It is the engine's live-detonation entry point — it kills entities and rebuilds the decor and flagpole snapshots — and it needs a `World`, which the pilot page does not have and must not construct. `sim.detonate()` calls `island.blast()`, which mirrors only the tile bookkeeping. The kills belong to whichever client owns the entities, and in Plan 3 that is Mario's.

**Files:**
- Create: `src/wings/ordnance.js`, `tests/unit/ordnance.test.js`
- Modify: `src/wings/sim.js`, `src/wings/scene.js`, `src/wings/pilot-main.js`, `pilot.html`

**Interfaces:**
- `ORDNANCE` — `{bomb, rocket, gun, torpedo}`, each `{muzzle, gravity, radius, terrain, life, load}`. `radius` is in **tiles** and feeds straight into `blastTiles`.
- `ORDNANCE_KINDS`, `release(kind, plane) -> shot`, `stepShot(shot) -> shot`, `predictImpact(shot, groundY, maxTicks?) -> {x, y, ticks} | null`
- New sim events: `release`, `detonate`, `impact`, `splash`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ordnance.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODE, createPlane, stepPlane } from '../../src/wings/flight.js';
import {
  ORDNANCE, ORDNANCE_KINDS, release, stepShot, predictImpact,
} from '../../src/wings/ordnance.js';

function flying(over = {}) {
  const p = createPlane({ mode: MODE.AIR, x: 1000, y: 200, speed: 2.7, gear: false, ...over });
  stepPlane(p, { throttle: 1, pitch: 0 }); // settle vx/vy from angle and speed
  return p;
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

test('rockets are the precision option: bigger crater, far fewer carried', () => {
  assert.ok(ORDNANCE.rocket.radius > ORDNANCE.bomb.radius);
  assert.ok(ORDNANCE.rocket.load < ORDNANCE.bomb.load);
  assert.ok(ORDNANCE.gun.load > ORDNANCE.bomb.load * 10);
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
  const s = { ...b };
  let t = 0;
  while (s.y < 320 && t < 900) {
    stepShot(s);
    t++;
  }
  assert.ok(s.x > b.x + 60, 'the bomb should be thrown forward, not dropped straight down');
  assert.ok(t > 20, 'the fall should take real time');
});

// Verified: agrees to 1e-6. Plan 4's shadow marker depends on this exactness.
test('predictImpact agrees with actually flying the bomb', () => {
  const b = release('bomb', flying());
  const solution = predictImpact(b, 320);
  assert.ok(solution, 'no solution for a bomb over the ground');
  const s = { ...b };
  for (let i = 0; i < solution.ticks; i++) stepShot(s);
  assert.ok(Math.abs(s.x - solution.x) < 1e-6, 'predicted x must match the real integrator');
  assert.ok(Math.abs(s.y - solution.y) < 1e-6);
});

test('predictImpact returns null when nothing is below', () => {
  assert.equal(predictImpact(release('rocket', flying({ angle: -Math.PI / 2 })), -10000), null);
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

test('ballistics are deterministic', () => {
  const run = () => {
    const s = release('bomb', flying());
    for (let i = 0; i < 200; i++) stepShot(s);
    return JSON.stringify(s);
  };
  assert.equal(run(), run());
});
```

Run: `npm run test:unit` — Expected: FAIL, module not found.

- [ ] **Step 2: Write the ordnance**

Create `src/wings/ordnance.js`:

```js
import { nosePoint } from './flight.js';

// Wings of Fury's arsenal. `gravity` and `muzzle` are px/frame; `radius` is in
// TILES and feeds straight into blastTiles(). Torpedoes exist for the ferry,
// which is a later plan, so they carry no terrain damage yet.
export const ORDNANCE = {
  bomb: { muzzle: 0, gravity: 0.11, radius: 3, terrain: true, life: 900, load: 12 },
  rocket: { muzzle: 4.5, gravity: 0.006, radius: 4, terrain: true, life: 180, load: 4 },
  gun: { muzzle: 6, gravity: 0, radius: 0, terrain: false, life: 45, load: 300 },
  torpedo: { muzzle: 2, gravity: 0.11, radius: 0, terrain: false, life: 900, load: 4 },
};

export const ORDNANCE_KINDS = Object.keys(ORDNANCE);

// Fired from the plane's nose, inheriting the plane's velocity. Leading the
// target by eye is the whole Wings of Fury skill, so nothing here aims.
export function release(kind, p) {
  const spec = ORDNANCE[kind];
  if (!spec) throw new Error(`ordnance: unknown kind "${kind}"`);
  const nose = nosePoint(p);
  return {
    kind,
    x: nose.x,
    y: nose.y,
    vx: p.vx + Math.cos(p.angle) * spec.muzzle,
    vy: p.vy + Math.sin(p.angle) * spec.muzzle,
    age: 0,
    dead: false,
  };
}

export function stepShot(s) {
  const spec = ORDNANCE[s.kind];
  s.vy += spec.gravity;
  s.x += s.vx;
  s.y += s.vy;
  s.age++;
  if (s.age >= spec.life) s.dead = true;
  return s;
}

// Run the exact same integrator forward on a copy until the shot crosses
// `groundY`. Plan 4's shadow marker needs the predicted impact tile to agree
// with the real one to the pixel, which is why this is not a closed form.
export function predictImpact(s, groundY, maxTicks = 900) {
  const spec = ORDNANCE[s.kind];
  const g = { x: s.x, y: s.y, vx: s.vx, vy: s.vy };
  for (let t = 1; t <= Math.min(maxTicks, spec.life - s.age); t++) {
    g.vy += spec.gravity;
    g.x += g.vx;
    g.y += g.vy;
    if (g.y >= groundY) return { x: g.x, y: g.y, ticks: t };
  }
  return null;
}
```

Run: `npm run test:unit` — Expected: PASS, 11 ordnance tests.

- [ ] **Step 3: Arm the sim**

Six edits to `src/wings/sim.js`.

**3a.** Add the imports:

```js
import { TILE } from '../core/constants.js';
import { ORDNANCE, release, stepShot } from './ordnance.js';
```

**3b.** In the constructor, after `this.plane = spotOnDeck(createPlane());`:

```js
    this.shots = [];
    this.ordnance = {};
    this._prev = { drop: false, fire: false };
```

**3c.** Replace `rearm()`:

```js
  rearm() {
    for (const kind of Object.keys(ORDNANCE)) this.ordnance[kind] = ORDNANCE[kind].load;
    this.plane.fuel = FLIGHT.FUEL_MAX;
  }
```

**3d.** In `step()`, replace the two plane lines with a block that also fires, and add the shot update. Firing is edge-triggered off the previous tick, so a held key drops exactly one bomb:

```js
    if (p.mode !== MODE.DOWN) {
      stepPlane(p, input);
      if (input.drop && !this._prev.drop) this.fire('bomb');
      if (input.fire && !this._prev.fire) this.fire('gun');
    }
    this._prev.drop = !!input.drop;
    this._prev.fire = !!input.fire;

    this.stepShots();
    if (p.mode !== MODE.DOWN) this.checkPlane();
```

**3e.** Add three methods after `islandAt()`:

```js
  fire(kind) {
    if (this.plane.mode !== MODE.AIR) return null;
    if (!this.ordnance[kind]) return null;
    this.ordnance[kind]--;
    const shot = release(kind, this.plane);
    this.shots.push(shot);
    this.emit('release', { kind, x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy });
    return shot;
  }

  stepShots() {
    for (const s of this.shots) {
      if (s.dead) continue;
      stepShot(s);
      const island = this.islandAt(s.x, s.y);
      if (island && island.blocksAt(s.x, s.y)) {
        this.detonate(s, island);
      } else if (s.y >= SEA_Y) {
        s.dead = true;
        this.emit('splash', { kind: s.kind, x: s.x, y: s.y });
      }
    }
    this.shots = this.shots.filter((s) => !s.dead);
  }

  detonate(shot, island) {
    shot.dead = true;
    const spec = ORDNANCE[shot.kind];
    if (!spec.terrain) {
      this.emit('impact', { kind: shot.kind, x: shot.x, y: shot.y });
      return [];
    }
    const changed = island.blast(shot.x, shot.y, spec.radius);
    this.damage.add(island.id, island.keys());
    this.emit('detonate', {
      island: island.id, x: shot.x, y: shot.y, radius: spec.radius, keys: changed,
    });
    // Bombing from inside your own blast radius kills you. Spec section 3.3.
    const p = this.plane;
    const dx = p.x + PLANE_W / 2 - shot.x;
    const dy = p.y + PLANE_H / 2 - shot.y;
    if (dx * dx + dy * dy <= (spec.radius * TILE) ** 2) this.lose('own-blast');
    return changed;
  }
```

**3f.** In `respawn()`, add `this.shots.length = 0;` and `this._prev = { drop: false, fire: false };`. In `state()`, add `ordnance: { ...this.ordnance },` and `shots: this.shots.length,`.

- [ ] **Step 4: Draw the ordnance**

Four edits to `src/wings/scene.js`.

**4a.** Fold `BOMB, ROCKET, TRACER, PUFF` into the existing `./art/ocean.js` import line.

**4b.** Add the constants beside `CLOUDS`:

```js
const PUFF_ANGLES = [0.4, 1.6, 2.5, 3.5, 4.4, 5.6];
const PUFF_LIFE = 24;
const SPLASH_LIFE = 18;
```

**4c.** Extend `consume()` with the three new event types, and change the filter so splashes use their own life:

```js
      if (e.type === 'detonate') this.fx.push({ kind: 'blast', x: e.x, y: e.y, r: e.radius * TILE, t: 0 });
      else if (e.type === 'impact') this.fx.push({ kind: 'blast', x: e.x, y: e.y, r: 8, t: 0 });
      else if (e.type === 'splash') this.fx.push({ kind: 'splash', x: e.x, y: SEA_Y, t: 0 });
```

```js
    this.fx = this.fx.filter((f) => f.t < (f.kind === 'splash' ? SPLASH_LIFE : PUFF_LIFE));
```

**4d.** Add the two draw methods, called from `submit()` after `drawPlane`:

```js
  drawShots(r, sim, cam) {
    r.draw(LAYER.ENTITIES, (ctx) => {
      for (const s of sim.shots) {
        const sprite = s.kind === 'rocket' ? ROCKET : s.kind === 'gun' ? TRACER : BOMB;
        // Ordnance points where it is going. A bomb tips nose-down as it falls,
        // which is most of its telegraph until Plan 4 adds a real one.
        const a = Math.atan2(s.vy, s.vx) - (s.kind === 'bomb' ? Math.PI / 2 : 0);
        drawRotated(ctx, sprite, s.x - cam.x, s.y - cam.y, a);
      }
    });
  }

  drawFx(r, cam) {
    r.draw(LAYER.PARTICLES, (ctx) => {
      for (const f of this.fx) {
        if (f.kind === 'splash') {
          const k = f.t / SPLASH_LIFE;
          ctx.globalAlpha = 1 - k;
          PUFF.draw(ctx, f.x - cam.x - 5, f.y - cam.y - 4 - k * 10);
          continue;
        }
        const k = f.t / PUFF_LIFE;
        ctx.globalAlpha = 1 - k * k;
        const spread = f.r * (0.35 + k * 0.9);
        PUFF.draw(ctx, Math.floor(f.x - cam.x - 5), Math.floor(f.y - cam.y - 4));
        for (const a of PUFF_ANGLES) {
          PUFF.draw(
            ctx,
            Math.floor(f.x + Math.cos(a) * spread - cam.x - 5),
            Math.floor(f.y + Math.sin(a) * spread - cam.y - 4)
          );
        }
      }
      ctx.globalAlpha = 1;
    });
  }
```

**4e.** Add the ordnance counters to `drawHud`, replacing the `PLANES` line:

```js
      let x = 132;
      for (const kind of ['bomb', 'rocket', 'gun']) {
        label(ctx, `${kind[0].toUpperCase()}${String(sim.ordnance[kind]).padStart(3, '0')}`, x, 4);
        x += 48;
      }
      label(ctx, `PLANES ${sim.squadron}`, x + 8, 4);
```

- [ ] **Step 5: Wire the trigger**

In `src/wings/pilot-main.js`, add to `KEYMAP`:

```js
  Space: 'drop',
  KeyK: 'drop',
  KeyX: 'fire',
  KeyJ: 'fire',
```

and add the two fields to the object `readKeys()` returns:

```js
    drop: !!keys.drop,
    fire: !!keys.fire,
```

In `pilot.html`, add the two keys to `#hint`:

```html
    <b>SPACE</b> BOMB &nbsp;·&nbsp; <b>X</b> GUNS &nbsp;·&nbsp;
```

- [ ] **Step 6: Blow a hole in 1-1**

Serve on 8199, then:

```bash
node -e "import('playwright').then(async ({chromium}) => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8199/pilot.html?headless');
  await p.evaluate(() => window.__WINGS.ready);
  const r = await p.evaluate(() => {
    const W = window.__WINGS, isl = W.sim.islandById('1-1');
    W.hold({throttle:1, pitch:0}); W.tick(140);
    W.hold({throttle:1, pitch:1}); W.tick(30);
    // Fly level well above the shelf and pickle.
    W.sim.plane.x = isl.originX + 10 * 16; W.sim.plane.y = 320 - 60;
    W.sim.plane.angle = 0; W.sim.plane.speed = 2.7;
    W.hold({throttle:1, pitch:0, drop:true}); W.tick(1);
    W.hold({throttle:1, pitch:0}); W.tick(400);
    return { det: W.events().find(e => e.type === 'detonate') || null, damage: W.damage() };
  });
  console.log('detonate:', r.det && {island: r.det.island, keys: r.det.keys.length});
  console.log('damage 1-1:', (r.damage['1-1'] || []).length, 'errors:', errs);
  await b.close();
})"
```

Expected: a `detonate` on `1-1` with a non-empty key list, a matching damage count, and `errors: []`.

Then open the page, fly out to 1-1 and bomb it by hand. The crater must be permanent — fly away and back and it is still there.

- [ ] **Step 7: Commit**

```bash
git add src/wings/ordnance.js src/wings/sim.js src/wings/scene.js src/wings/pilot-main.js \
        pilot.html tests/unit/ordnance.test.js
git commit -m "Ordnance: bombs, rockets, tracers, and craters that stay

Release inherits plane velocity and nothing aims for the pilot — leading
the target by eye is the Wings of Fury skill. predictImpact runs the same
integrator as the live bomb so Plan 4's telegraph can trust it."
```

---

## Task 4: Bot primitives and the full sortie

The autopilots behind `__WINGS.flyTo` and `__WINGS.bombTile`, and the tier-1 test that proves takeoff-to-trap works end to end without a browser.

**Files:**
- Create: `src/wings/bot.js`, `tests/unit/bot.test.js`
- Modify: `src/wings/pilot-main.js`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/bot.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getLevel } from '../../src/data/levels/index.js';
import { DECK_X0, DECK_X1, SEA_Y, ISLAND_TOP_Y } from '../../src/wings/geo.js';
import { MODE, FLIGHT } from '../../src/wings/flight.js';
import { ORDNANCE } from '../../src/wings/ordnance.js';
import { WingsSim } from '../../src/wings/sim.js';
import { takeoff, flyTo, bombTile, autoLand } from '../../src/wings/bot.js';

const LEVELS = () => [getLevel('1-1')];

// Verified: rotation at tick 133.
test('takeoff gets airborne off the deck, not off the bow', () => {
  const sim = new WingsSim({ levels: LEVELS() });
  assert.equal(takeoff(sim), true);
  assert.equal(sim.plane.mode, MODE.AIR);
  assert.ok(sim.plane.x > DECK_X0 && sim.plane.x < DECK_X1);
  assert.ok(sim.tick > 60, 'the roll should take a real second or two');
});

test('flyTo reaches a point over open water', () => {
  const sim = new WingsSim({ levels: LEVELS() });
  takeoff(sim);
  assert.equal(flyTo(sim, 1600, 180), true);
  assert.ok(Math.abs(sim.plane.x - 1600) < 64);
  assert.ok(Math.abs(sim.plane.y - 180) < 64);
  assert.equal(sim.plane.mode, MODE.AIR, 'the autopilot ditched');
});

// Verified: release at tick 1245, detonation at 1305.
test('bombTile puts a crater on the tile it was asked for', () => {
  const sim = new WingsSim({ levels: LEVELS() });
  takeoff(sim);
  assert.equal(bombTile(sim, '1-1', 20, 13), true);
  assert.equal(sim.ordnance.bomb, ORDNANCE.bomb.load - 1);

  while (sim.shots.length && sim.tick < 12000) sim.step({ throttle: 1, pitch: 0 });

  const detonate = sim.events.find((e) => e.type === 'detonate');
  assert.ok(detonate, 'the bomb never went off');
  assert.equal(detonate.island, '1-1');
  assert.ok(detonate.keys.includes('20,13'), `crater missed: ${detonate.keys.join(' ')}`);
  assert.ok(!sim.islandById('1-1').blocksTile(20, 13));
  assert.ok(sim.damage.keys('1-1').length > 0);
  assert.equal(sim.plane.mode, MODE.AIR, 'the bomb run killed the pilot');
});

// Verified: the whole thing completes at tick 3486.
test('a whole sortie: deck, island, crater, deck', () => {
  const sim = new WingsSim({ levels: LEVELS() });
  assert.equal(takeoff(sim), true);
  assert.equal(bombTile(sim, '1-1', 20, 13), true);
  for (let i = 0; i < 200; i++) sim.step({ throttle: 1, pitch: 0 });
  assert.equal(autoLand(sim), true, 'never got home');

  assert.equal(sim.plane.mode, MODE.DECK);
  assert.equal(sim.status, 'ready');
  assert.equal(sim.squadron, 5, 'lost an aircraft on a clean sortie');
  assert.equal(sim.plane.fuel, FLIGHT.FUEL_MAX, 'landing must refuel');
  assert.equal(sim.ordnance.bomb, ORDNANCE.bomb.load, 'landing must rearm');
  assert.ok(!sim.islandById('1-1').blocksTile(20, 13), 'the crater must survive the trip home');
  assert.deepEqual(sim.events.map((e) => e.type), ['release', 'detonate', 'landed']);
});

test('the sortie burns fuel and takes real time', () => {
  const sim = new WingsSim({ levels: LEVELS() });
  takeoff(sim);
  bombTile(sim, '1-1', 20, 13);
  assert.ok(sim.plane.fuel < FLIGHT.FUEL_MAX, 'the outbound leg burned nothing');
  assert.ok(sim.tick > 600, 'the island should be a real flight away');
});

test('the whole sortie is deterministic', () => {
  const run = () => {
    const sim = new WingsSim({ levels: LEVELS() });
    takeoff(sim);
    bombTile(sim, '1-1', 20, 13);
    for (let i = 0; i < 200; i++) sim.step({ throttle: 1, pitch: 0 });
    autoLand(sim);
    return JSON.stringify({ state: sim.state(), hash: sim.damage.hash('1-1'), events: sim.events });
  };
  assert.equal(run(), run());
});

test('bots give up rather than loop forever', () => {
  const sim = new WingsSim({ levels: LEVELS() });
  takeoff(sim);
  const before = sim.tick;
  assert.equal(flyTo(sim, 999999, 100, 200), false, 'an unreachable target must time out');
  assert.ok(sim.tick - before <= 200);
  assert.equal(bombTile(sim, 'nowhere', 1, 1), false, 'an unknown island must fail fast');
});

test('a bot that ditches reports failure instead of lying', () => {
  const sim = new WingsSim({ levels: LEVELS() });
  takeoff(sim);
  sim.plane.y = SEA_Y - 16;
  sim.plane.angle = Math.PI / 2;
  sim.plane.speed = 3;
  assert.equal(flyTo(sim, 4000, ISLAND_TOP_Y, 600, { floor: 99999 }), false);
  assert.equal(sim.plane.mode, MODE.DOWN);
});
```

Run: `npm run test:unit` — Expected: FAIL, module not found.

- [ ] **Step 2: Write the bots**

Create `src/wings/bot.js`:

```js
import { TILE } from '../core/constants.js';
import { DECK_X0, DECK_Y, SEA_Y, PLANE_H, localTileToWorld } from './geo.js';
import { MODE, FLIGHT } from './flight.js';
import { LANDING } from './carrier.js';
import { release, predictImpact } from './ordnance.js';
import { seek, distanceTo } from './sim.js';

// Scripted pilots. Every one is a pure function of sim state, so a test that
// flies a whole sortie produces the same tick counts every run. Each takes a
// tick budget and returns whether it achieved the thing — never throwing,
// never looping forever, never claiming success it did not have.

export function takeoff(sim, budget = 600) {
  const p = sim.plane;
  for (let i = 0; i < budget; i++) {
    if (p.mode === MODE.AIR) return true;
    sim.step({ throttle: 1, pitch: p.speed >= FLIGHT.TAKEOFF_SPEED ? 1 : 0 });
  }
  return p.mode === MODE.AIR;
}

export function flyTo(sim, x, y, budget = 6000, opts = {}) {
  const p = sim.plane;
  const near = opts.near == null ? 32 : opts.near;
  for (let i = 0; i < budget; i++) {
    if (p.mode === MODE.DOWN) return false;
    if (distanceTo(p, x, y) <= near) return true;
    sim.step(seek(p, x, y, opts));
  }
  return distanceTo(p, x, y) <= near;
}

// Line up west of the target, run in level, and pickle the moment the bomb's
// own integrator says it will land on the tile. Nothing nudges the bomb after
// release — the lead is solved before the bay opens, exactly as a human has to
// solve it by eye.
export function bombTile(sim, islandId, tx, ty, budget = 8000) {
  const island = sim.islandById(islandId);
  if (!island) return false;
  const corner = localTileToWorld(island.originX, tx, ty);
  const target = { x: corner.x + TILE / 2, y: corner.y + TILE / 2 };
  const cruiseY = Math.max(48, target.y - 220);

  if (!flyTo(sim, target.x - 900, cruiseY, budget, { near: 64 })) return false;

  const p = sim.plane;
  for (let i = 0; i < budget; i++) {
    if (p.mode === MODE.DOWN) return false;
    const solution = predictImpact(release('bomb', p), target.y);
    if (solution && solution.x >= target.x - TILE / 2 && Math.cos(p.angle) > 0) {
      sim.step({ ...seek(p, target.x + 4000, cruiseY), drop: true });
      return true;
    }
    sim.step(seek(p, target.x + 4000, cruiseY));
  }
  return false;
}

// Overfly the carrier, loop back, and come in over the stern low and slow with
// the hook down. Returns true once a wire is caught.
export function autoLand(sim, budget = 8000) {
  const p = sim.plane;
  const glideY = DECK_Y - PLANE_H / 2 - 1;

  // 1. Fly the pattern: get well west of the stern, above the deck. This is
  //    what forces the 180-degree loop, since the deck only accepts an
  //    eastbound arrival.
  if (!flyTo(sim, DECK_X0 - 620, DECK_Y - 200, budget, { near: 56, floor: SEA_Y })) return false;

  // 2. Settle onto the glideslope. Chasing a carrot 120px directly ahead at
  //    deck height turns the plane east, levels it and converges on the deck
  //    altitude. A carrot further out converges too slowly: at 400px the plane
  //    is still 20px high crossing the deck, sails over it, and makes landfall.
  const band = (LANDING.MAX_SPEED + LANDING.MIN_SPEED) / 2;
  for (let i = 0; i < budget; i++) {
    if (p.mode === MODE.DECK) return true;
    if (p.mode === MODE.DOWN) return false;
    sim.step(
      seek(p, p.x + 120, glideY, {
        throttle: p.speed > band ? 0 : 1,
        gear: true,
        floor: SEA_Y,
        dead: 0.02,
      })
    );
  }
  return p.mode === MODE.DECK;
}
```

Run: `npm run test:unit` — Expected: PASS, 8 bot tests. The full-sortie test runs about 3,500 simulated ticks with no rendering and should finish in well under a second.

- [ ] **Step 3: Expose the bots on `__WINGS`**

In `src/wings/pilot-main.js`, add the import:

```js
import { takeoff, flyTo, bombTile, autoLand } from './bot.js';
```

and the four members to `window.__WINGS`, next to `tick`:

```js
  takeoff(budget = 600) {
    const ok = takeoff(pilot.sim, budget);
    pilot.render();
    return ok;
  },

  flyTo(x, y, budget = 6000) {
    const ok = flyTo(pilot.sim, x, y, budget);
    pilot.render();
    return ok;
  },

  bombTile(island, tx, ty, budget = 8000) {
    const ok = bombTile(pilot.sim, island, tx, ty, budget);
    pilot.render();
    return ok;
  },

  land(budget = 8000) {
    const ok = autoLand(pilot.sim, budget);
    pilot.render();
    return ok;
  },
```

- [ ] **Step 4: Commit**

```bash
git add src/wings/bot.js src/wings/pilot-main.js tests/unit/bot.test.js
git commit -m "Bot primitives, and a Node test that flies deck-to-crater-to-deck

The whole sortie is 3,500 deterministic ticks with no browser, which is
why the flight maths lives in engine-free modules."
```

---

## Task 5: The tier-3 browser test

The gate. Everything above is only real if a real Chromium flies the sortie through `__WINGS`.

**Files:**
- Modify: `tests/browser/helpers.mjs`
- Create: `tests/browser/pilot.test.mjs`

- [ ] **Step 1: Teach the boot helper to open a second page**

`tests/browser/helpers.mjs` opens `/` and waits on `window.__GAME.ready`. Give `boot()` an options bag, keeping the no-argument behaviour identical so `crater.test.mjs` is unaffected. Replace only the `boot` function; leave `PORT`, `BASE`, `waitForServer` and `shutdown` exactly as they are:

```js
// One static server and one browser shared by a whole test file. The game has
// no build step, so `http-server` over the repo root is the entire deployment.
//   path  : which page to open ('/' for Mario, '/pilot.html' for the pilot)
//   ready : evaluated in the page; awaited before boot() returns
export async function boot(opts = {}) {
  const path = opts.path || '/';
  const ready = opts.ready || (() => window.__GAME.ready);

  const server = spawn(
    'npx',
    ['http-server', '-p', String(PORT), '-c-1', '--silent', '.'],
    { stdio: 'ignore' }
  );
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await waitForServer();
  await page.goto(BASE + path);
  await page.evaluate(ready);

  return { server, browser, page, errors };
}
```

- [ ] **Step 2: Write the test**

Create `tests/browser/pilot.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

const PILOT = { path: '/pilot.html?headless', ready: () => window.__WINGS.ready };

test('the pilot flies', { timeout: 180000 }, async (t) => {
  const ctx = await boot(PILOT);
  const { page } = ctx;
  t.after(() => shutdown(ctx));

  await t.test('the page boots onto the deck with a full squadron', async () => {
    const s = await page.evaluate(() => window.__WINGS.state());
    assert.equal(s.mode, 'deck');
    assert.equal(s.squadron, 5);
    assert.equal(s.fuel, 100);
    assert.equal(s.status, 'ready');
    assert.equal(await page.evaluate(() => window.__WINGS.fatal()), null);
  });

  await t.test('the frame is 512x240 at an integer scale', async () => {
    const r = await page.evaluate(() => ({
      bw: window.__WINGS.renderer.buffer.width,
      bh: window.__WINGS.renderer.buffer.height,
      scale: window.__WINGS.renderer.scale,
      cw: window.__WINGS.renderer.canvas.width,
    }));
    assert.equal(r.bw, 512);
    assert.equal(r.bh, 240);
    assert.ok(Number.isInteger(r.scale) && r.scale >= 1);
    assert.equal(r.cw, 512 * r.scale);
  });

  await t.test('holding the stick rolls down the deck and lifts off', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      const start = W.state().x;
      W.hold({ throttle: 1, pitch: 0 });
      W.tick(120);
      const rolling = W.state();
      W.hold({ throttle: 1, pitch: 1 });
      W.tick(120);
      const flying = W.state();
      W.release();
      return { start, rolling, flying };
    });
    assert.ok(r.rolling.x > r.start + 80, 'the plane never rolled');
    assert.ok(r.rolling.speed > 1.5, 'the roll built no speed');
    assert.equal(r.flying.mode, 'air', 'the plane never got airborne');
    assert.equal(r.flying.gear, false, 'the hook stayed down after rotation');
  });

  await t.test('the camera scrolls vertically as well as horizontally', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      const before = W.state().cam;
      W.hold({ throttle: 1, pitch: 1 });
      W.tick(40);
      W.hold({ throttle: 1, pitch: 0 });
      W.tick(200);
      const after = W.state().cam;
      W.release();
      return { before, after };
    });
    assert.notEqual(r.after.x, r.before.x, 'the camera did not scroll horizontally');
    assert.notEqual(r.after.y, r.before.y, 'the camera did not scroll vertically');
  });

  await t.test('a bomb craters the island it was aimed at', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      W.takeoff();
      const dropped = W.bombTile('1-1', 20, 13);
      for (let i = 0; i < 12000 && W.sim.shots.length; i++) W.tick(1);
      return {
        dropped,
        detonate: W.events().find((e) => e.type === 'detonate') || null,
        blocking: W.sim.islandById('1-1').blocksTile(20, 13),
        damage: W.damage(),
      };
    });
    assert.equal(r.dropped, true, 'the bomb run never released');
    assert.ok(r.detonate, 'the bomb never detonated');
    assert.equal(r.detonate.island, '1-1');
    assert.ok(r.detonate.keys.includes('20,13'), `crater missed: ${r.detonate.keys}`);
    assert.equal(r.blocking, false, 'the tile survived the bomb');
    assert.ok(r.damage['1-1'].length > 0, 'the damage map recorded nothing');
  });

  await t.test('a crater survives a reset that replays the damage', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      const damage = W.damage();
      W.reset({ damage });
      return {
        blocking: W.sim.islandById('1-1').blocksTile(20, 13),
        keys: W.damage()['1-1'],
        given: damage['1-1'],
      };
    });
    assert.equal(r.blocking, false, 'the reset healed the crater');
    assert.deepEqual(r.keys, r.given);
  });

  await t.test('a clean reset restores the ground', async () => {
    const blocking = await page.evaluate(() => {
      window.__WINGS.reset();
      return window.__WINGS.sim.islandById('1-1').blocksTile(20, 13);
    });
    assert.equal(blocking, true, 'damage leaked into a clean reset');
  });

  await t.test('a landing inside the envelope traps, refuels and rearms', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      W.takeoff();
      W.bombTile('1-1', 20, 13);
      W.tick(200);
      const landed = W.land();
      return { landed, state: W.state(), events: W.events().map((e) => e.type) };
    });
    assert.equal(r.landed, true, 'the plane never got home');
    assert.equal(r.state.mode, 'deck');
    assert.equal(r.state.squadron, 5, 'lost an aircraft on a clean sortie');
    assert.equal(r.state.fuel, 100, 'landing did not refuel');
    assert.equal(r.state.ordnance.bomb, 12, 'landing did not rearm');
    assert.ok(r.events.includes('landed'));
    assert.ok(!r.events.includes('planeLost'));
  });

  await t.test('a landing outside the envelope is a crash', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      W.takeoff();
      // A hot approach: over the deck, on the planking, hook down, well above
      // the legal speed. hookArmed is set because the plane has left the deck.
      const p = W.sim.plane;
      W.sim.hookArmed = true;
      p.mode = 'air';
      p.x = 200;
      p.y = 512 - 12;
      p.angle = 0;
      p.speed = 3.5;
      p.gear = true;
      W.tick(1);
      return { state: W.state(), last: W.events().at(-1) };
    });
    assert.equal(r.state.mode, 'down', 'a 3.5px/frame arrival should not trap');
    assert.equal(r.last.type, 'planeLost');
    assert.equal(r.last.reason, 'too-fast');
    assert.equal(r.state.squadron, 4);
  });

  await t.test('the next plane is spotted on the deck', async () => {
    const s = await page.evaluate(() => {
      window.__WINGS.respawn();
      return window.__WINGS.state();
    });
    assert.equal(s.mode, 'deck');
    assert.equal(s.status, 'ready');
    assert.equal(s.squadron, 4);
  });

  await t.test('the frame actually renders something', async () => {
    const painted = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      W.takeoff();
      W.tick(1);
      const c = W.renderer.buffer;
      const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const seen = new Set();
      for (let i = 0; i < px.length; i += 4) seen.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
      return seen.size;
    });
    assert.ok(painted > 8, `a frame with ${painted} distinct colours is a blank screen`);
  });

  await t.test('no uncaught page errors', async () => {
    assert.equal(await page.evaluate(() => window.__WINGS.fatal()), null);
    assert.deepEqual(ctx.errors, []);
  });
});
```

- [ ] **Step 3: Run the browser tests**

Run: `npm run test:browser`
Expected: PASS — Plan 1's `crater.test.mjs` and this file's 12 subtests.

If the two files race for port 8199, `node --test` is running them in parallel. Serialise it: change the `test:browser` script to `node --test --test-concurrency=1 "tests/browser/*.test.mjs"`.

- [ ] **Step 4: Run everything and confirm the engine is untouched**

Run: `npm test` — Expected: all unit and browser tests pass.

Run: `npm run shots` — Expected: completes exactly as before. `tools/shot.mjs` drives `window.__GAME` on `index.html`, neither of which this plan changed.

Run: `git status --porcelain -- src/core src/game src/render src/data src/ui src/audio src/main.js index.html`
Expected: **empty output.**

- [ ] **Step 5: Commit**

```bash
git add tests/browser/helpers.mjs tests/browser/pilot.test.mjs package.json
git commit -m "Browser test: a real Chromium flies deck to crater to deck

Asserts the 512x240 viewport, that the scene paints, that a crater lands
on the requested tile and survives a reload, and that the landing envelope
rejects a hot approach."
```

---

## Done when

- `npm test` is green from a clean checkout.
- `npm run shots` still produces the upstream screenshot set unchanged.
- `git status --porcelain -- src/core src/game src/render src/data src/ui src/audio src/main.js index.html` prints nothing: **this plan modified zero engine files** and added no `MODS.md` entries.
- Opening `http://localhost:8199/pilot.html` and using the arrow keys gets you off the deck, over the ocean, onto an island, and back onto the deck without touching a debug API. **The user has asked twice to test this game; after Task 1 the answer is a URL.**
- `window.__GAME` on `index.html` still has every member `tools/shot.mjs` uses.
- The tier-1 suite covers the flight integration, the landing envelope, ballistic arcs, terrain and the whole sortie without launching a browser. The tier-3 test only asserts things that genuinely need a canvas.
- `Island.blast()` and `world.destroyTiles()` still agree on which tiles a blast removes. If either changes, both change.

## Deliberately not in this plan

Each belongs to a later plan and must not be started here:

- **Networking, the server, `src/net/`, the room protocol, the desync hash** (Plan 3). `DamageMap` is already the type the server will hold, and `__WINGS` deliberately has no `net` member rather than a stub that lies about working.
- **Mario** — the player, his island simulation, his camera, his HUD (Plan 3). This plan never constructs a `World`.
- **The archipelago chain and island-to-island progression** (Plan 3). `layoutIslands` places a fixed list at fixed spacing; the seeded eight-world layout is Plan 3's.
- **Ferries, and torpedoes hitting them** (Plan 3). `ORDNANCE.torpedo` exists as data with `terrain: false` and nothing fires it.
- **Radar** (Plan 3). The pilot here can see every island because there is nobody to hunt.
- **Telegraphing — the falling whistle, the shadow marker, the screen-edge arrow** (Plan 4). All three are drawn on *Mario's* screen and there is no Mario yet. `predictImpact` is already the exact function the shadow marker will call.
- **Anti-aircraft fire, repurposed enemies, Mario fighting back, naval flak** (Plan 5). The only things that can kill the pilot here are the sea, terrain, the ship, his own blast and a botched trap.
- **Win conditions and match bookkeeping** (Plan 5). `squadron` counts down and the sim reports `status: 'over'`; nothing acts on it.
- **Audio.** The pilot page is silent. Engine noise, the bomb whistle and the explosion deserve doing properly against `src/audio/`, and doing them badly here would mean redoing them.
- **The WebGL post/CRT chain on the pilot viewport.** See the recorded decision at the top: it needs `src/render/post.js` to stop hard-coding `SCREEN_W`/`SCREEN_H`, which is an upstream change to make in `mario-game` and merge down.
- **Golden-image scenes for `tools/shot.mjs`** (spec section 8.5). `__WINGS.snapshot()` exists and the browser test asserts the frame is not blank; wiring the pilot into the scene-screenshot harness and diffing goldens is its own piece of work.
