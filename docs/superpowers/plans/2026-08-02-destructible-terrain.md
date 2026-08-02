# Destructible Terrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blowing a crater in any Super Mario Bros. level permanently clears every tile in the blast radius, and that damage survives a level reload.

**Architecture:** All blast geometry and damage bookkeeping live in new, browser-free modules under `src/wings/` so they are unit-testable in plain Node with no canvas. The engine gains exactly two methods on `World` — `destroyTiles()` (loud: clears tiles, throws debris, shakes) and `applyDamage()` (silent: used when loading a level that was already bombed) — plus one line in `loadLevel`. Every engine edit is recorded in `MODS.md` so `git merge upstream/main` conflicts stay diagnosable.

**Tech Stack:** Vanilla ES modules, no build step, no new npm dependencies. Node's built-in `node:test` runner for unit tests. Playwright (already an upstream devDependency) for browser tests.

## Global Constraints

Copied verbatim from the spec and from the upstream `ARCHITECTURE.md`, which remains binding. Every task's requirements implicitly include this section.

- **No build step. No npm dependencies in `src/`. No TypeScript.** Every file is a `.js` ES module loaded natively by the browser.
- **Coordinate system:** origin top-left, +X right, **+Y down**. `TILE = 16`. Positions are floating-point pixels; velocities are pixels *per frame*, not per second.
- **Fixed timestep:** `FPS = 60.0988`, `DT = 1 / FPS`. Simulation code must never read wall-clock time or unseeded randomness — determinism is required by the test strategy.
- **Tile coordinates are integers.** A tile key is the string `` `${tx},${ty}` `` with no spaces. This exact format is the wire format in later plans; do not change it.
- **Engine edits are confined to declared hook points** and every one gets an entry in `MODS.md` stating what changed and why.
- **`window.__GAME` must not be removed or have existing members changed** — `tools/shot.mjs` drives it.
- **Original assets only.** No Nintendo ROM art or audio.
- **Commit after every task.** Do not push to any remote; the user pushes.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/wings/blast.js` (create) | Pure geometry: a detonation point and radius → the set of tile keys it covers. No engine imports beyond `constants.js`. |
| `src/wings/damage.js` (create) | `DamageMap`: which tiles are destroyed, per island. Serialisation and hashing for later netcode. No engine imports at all. |
| `src/game/world.js` (modify) | Hook point. Gains `this.damage`, `destroyTiles()`, `applyDamage()`, and damage re-application inside `loadLevel`. |
| `src/main.js` (modify) | Hook point. Exposes `destroyTiles` / `blast` on `window.__GAME` for scripted tests. |
| `MODS.md` (create) | The ledger of every engine touch. |
| `tests/unit/blast.test.js` (create) | Tier-1 tests for blast geometry. |
| `tests/unit/damage.test.js` (create) | Tier-1 tests for the damage map. |
| `tests/browser/crater.test.mjs` (create) | Tier-3 test: a real crater in a real browser. |
| `tests/browser/helpers.mjs` (create) | Shared Playwright boot helper. |
| `package.json` (modify) | `test`, `test:unit`, `test:browser` scripts. |

---

## Task 1: Blast geometry

Pure functions with no state and no engine coupling. This is the module every later plan calls to answer "what did that bomb hit".

**Files:**
- Create: `src/wings/blast.js`
- Create: `tests/unit/blast.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `TILE` from `src/core/constants.js`.
- Produces:
  - `tileKey(tx, ty) -> string` — `"3,11"`. The canonical key format.
  - `parseTileKey(key) -> {tx: number, ty: number}`
  - `blastTiles(cx, cy, radiusTiles) -> string[]` — `cx`/`cy` are **pixel** coordinates of the detonation centre, `radiusTiles` is in **tiles**. Returns tile keys whose tile *centre* lies within the radius, sorted ascending as strings. Deterministic; never returns duplicates.

- [ ] **Step 1: Add the test scripts to `package.json`**

In the `"scripts"` block, add these three entries alongside the existing ones:

```json
    "test": "npm run test:unit && npm run test:browser",
    "test:unit": "node --test tests/unit/",
    "test:browser": "node --test tests/browser/",
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/blast.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { tileKey, parseTileKey, blastTiles } from '../../src/wings/blast.js';

test('tileKey round-trips through parseTileKey', () => {
  assert.equal(tileKey(3, 11), '3,11');
  assert.deepEqual(parseTileKey('3,11'), { tx: 3, ty: 11 });
  assert.deepEqual(parseTileKey('-2,0'), { tx: -2, ty: 0 });
});

test('a one-tile blast centred in a tile clears a plus shape', () => {
  // Centre of tile (0,0) is pixel (8,8). Radius 1 tile = 16px.
  // Orthogonal neighbours sit exactly 16px away (included);
  // diagonals sit 22.6px away (excluded).
  const keys = blastTiles(8, 8, 1);
  assert.deepEqual(keys.sort(), ['-1,0', '0,-1', '0,0', '0,1', '1,0'].sort());
});

test('blast radius scales with tiles', () => {
  const small = blastTiles(8, 8, 1);
  const large = blastTiles(8, 8, 3);
  assert.ok(large.length > small.length);
  for (const k of small) assert.ok(large.includes(k), `${k} missing from larger blast`);
});

test('blast is deterministic and duplicate-free', () => {
  const a = blastTiles(137, 92, 2.5);
  const b = blastTiles(137, 92, 2.5);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});

test('a zero radius clears nothing but the centre tile is not assumed', () => {
  // Detonating exactly on a tile corner with zero radius touches no tile centre.
  assert.deepEqual(blastTiles(0, 0, 0), []);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/wings/blast.js'`

- [ ] **Step 4: Write the implementation**

Create `src/wings/blast.js`:

```js
import { TILE } from '../core/constants.js';

export function tileKey(tx, ty) {
  return `${tx},${ty}`;
}

export function parseTileKey(key) {
  const c = key.indexOf(',');
  return { tx: Number(key.slice(0, c)), ty: Number(key.slice(c + 1)) };
}

// A detonation at pixel (cx, cy) clears every tile whose centre lies within
// `radiusTiles` of it. Testing the centre rather than the corner keeps the
// crater visually round and keeps the result independent of which side of a
// tile boundary the bomb happened to land on.
export function blastTiles(cx, cy, radiusTiles) {
  const r = radiusTiles * TILE;
  const r2 = r * r;
  const tx0 = Math.floor((cx - r) / TILE);
  const tx1 = Math.floor((cx + r) / TILE);
  const ty0 = Math.floor((cy - r) / TILE);
  const ty1 = Math.floor((cy + r) / TILE);

  const out = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const dx = tx * TILE + TILE / 2 - cx;
      const dy = ty * TILE + TILE / 2 - cy;
      if (dx * dx + dy * dy <= r2) out.push(tileKey(tx, ty));
    }
  }
  return out.sort();
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/wings/blast.js tests/unit/blast.test.js package.json
git commit -m "Blast geometry: a detonation point becomes a set of tile keys"
```

---

## Task 2: The damage map

Which tiles are destroyed, on which island. Deliberately free of any engine import so it can later run inside the Node server unchanged.

**Files:**
- Create: `src/wings/damage.js`
- Create: `tests/unit/damage.test.js`

**Interfaces:**
- Consumes: nothing. This module imports no other file.
- Produces:
  - `class DamageMap`
    - `add(islandId: string, keys: string[]) -> string[]` — records keys, returns only those **newly** added.
    - `has(islandId: string, key: string) -> boolean`
    - `keys(islandId: string) -> string[]` — sorted ascending. Empty array for an unknown island.
    - `toJSON() -> {[islandId: string]: string[]}` — island ids sorted, keys sorted.
    - `static fromJSON(obj) -> DamageMap`
    - `hash(islandId: string) -> string` — 8-char hex, order-independent.
  - `hashKeys(keys: string[]) -> string` — standalone FNV-1a over a sorted copy.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/damage.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { DamageMap, hashKeys } from '../../src/wings/damage.js';

test('add returns only newly destroyed tiles', () => {
  const d = new DamageMap();
  assert.deepEqual(d.add('1-1', ['5,10', '6,10']).sort(), ['5,10', '6,10']);
  assert.deepEqual(d.add('1-1', ['6,10', '7,10']), ['7,10']);
  assert.deepEqual(d.add('1-1', ['6,10']), []);
});

test('islands are independent', () => {
  const d = new DamageMap();
  d.add('1-1', ['5,10']);
  assert.ok(d.has('1-1', '5,10'));
  assert.ok(!d.has('1-2', '5,10'));
  assert.deepEqual(d.keys('1-2'), []);
});

test('keys come back sorted regardless of insertion order', () => {
  const d = new DamageMap();
  d.add('1-1', ['9,3', '1,2', '4,7']);
  assert.deepEqual(d.keys('1-1'), ['1,2', '4,7', '9,3']);
});

test('round-trips through JSON', () => {
  const d = new DamageMap();
  d.add('1-1', ['5,10', '6,10']);
  d.add('1-4', ['2,2']);
  const back = DamageMap.fromJSON(JSON.parse(JSON.stringify(d.toJSON())));
  assert.deepEqual(back.toJSON(), d.toJSON());
  assert.ok(back.has('1-4', '2,2'));
});

test('hash is order-independent and change-sensitive', () => {
  const a = new DamageMap();
  const b = new DamageMap();
  a.add('1-1', ['5,10', '6,10', '7,10']);
  b.add('1-1', ['7,10', '5,10', '6,10']);
  assert.equal(a.hash('1-1'), b.hash('1-1'));

  b.add('1-1', ['8,10']);
  assert.notEqual(a.hash('1-1'), b.hash('1-1'));
});

test('hashKeys distinguishes tile sets that share characters', () => {
  // '1,23' and '12,3' must not collide — the separator has to matter.
  assert.notEqual(hashKeys(['1,23']), hashKeys(['12,3']));
});

test('an empty island hashes consistently', () => {
  const d = new DamageMap();
  assert.equal(d.hash('nowhere'), hashKeys([]));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/wings/damage.js'`

- [ ] **Step 3: Write the implementation**

Create `src/wings/damage.js`:

```js
// The whole authoritative shared state of a match: which tiles are gone, per
// island. No engine imports — the Node server runs this exact file.

// FNV-1a, 32-bit. Sorted so two clients that destroyed the same tiles in a
// different order still agree, which is the point of the desync detector.
export function hashKeys(keys) {
  let h = 0x811c9dc5;
  for (const key of [...keys].sort()) {
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    // Separator, so ['1,23'] and ['12,3'] cannot hash alike.
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class DamageMap {
  constructor() {
    this.islands = new Map();
  }

  _set(islandId) {
    let s = this.islands.get(islandId);
    if (!s) {
      s = new Set();
      this.islands.set(islandId, s);
    }
    return s;
  }

  add(islandId, keys) {
    const s = this._set(islandId);
    const fresh = [];
    for (const key of keys) {
      if (s.has(key)) continue;
      s.add(key);
      fresh.push(key);
    }
    return fresh;
  }

  has(islandId, key) {
    const s = this.islands.get(islandId);
    return !!s && s.has(key);
  }

  keys(islandId) {
    const s = this.islands.get(islandId);
    return s ? [...s].sort() : [];
  }

  hash(islandId) {
    return hashKeys(this.keys(islandId));
  }

  toJSON() {
    const out = {};
    for (const id of [...this.islands.keys()].sort()) out[id] = this.keys(id);
    return out;
  }

  static fromJSON(obj) {
    const d = new DamageMap();
    for (const id of Object.keys(obj || {})) d.add(id, obj[id] || []);
    return d;
  }
}

export default DamageMap;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS, 12 tests total across both files.

- [ ] **Step 5: Commit**

```bash
git add src/wings/damage.js tests/unit/damage.test.js
git commit -m "Damage map: per-island destroyed tiles, hashable and serialisable"
```

---

## Task 3: The engine hook

The one task that edits upstream code. Keep the diff as small as it is written here — every extra line is a future merge conflict.

**Files:**
- Modify: `src/game/world.js`
- Create: `MODS.md`

**Interfaces:**
- Consumes: `blastTiles`, `tileKey` from `src/wings/blast.js`.
- Produces, on `World`:
  - `world.damage: Set<string>` — destroyed tile keys for the **currently loaded** level only.
  - `world.destroyTiles(keys: string[]) -> string[]` — clears tiles, spawns debris, plays a sound, shakes the screen. Returns the keys that actually changed a solid tile. Loud; use for live detonations.
  - `world.applyDamage(keys: string[]) -> void` — clears tiles with no sound, no debris, no shake. Silent; use when loading an already-bombed level.
  - `world.blast(cx: number, cy: number, radiusTiles: number) -> string[]` — convenience: `destroyTiles(blastTiles(cx, cy, radiusTiles))`.

- [ ] **Step 1: Write the failing test**

There is no headless harness for `World` — it needs the browser. This task's test is therefore the browser test in Task 5, and the gate for *this* task is that the engine still boots. Verify the current state first so a later failure is attributable:

Run: `npm start` in one terminal, then in another:
`node -e "import('playwright').then(async ({chromium}) => { const b = await chromium.launch(); const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.goto('http://localhost:8123/'); await p.waitForFunction(() => window.__GAME && window.__GAME.ready, null, {timeout: 15000}); await p.evaluate(() => window.__GAME.ready); console.log('boot ok, errors:', errs); await b.close(); })"`

Expected: `boot ok, errors: []`

- [ ] **Step 2: Add the import at the top of `src/game/world.js`**

Add alongside the other static imports at the top of the file:

```js
import { blastTiles, parseTileKey } from '../wings/blast.js';
```

- [ ] **Step 3: Add the damage set to the `World` constructor**

In `constructor(opts = {})`, immediately after the line `this.decor = [];`, add:

```js
    // Destroyed tile keys for the level currently loaded. Cleared by loadLevel
    // and re-seeded from opts.damage.
    this.damage = new Set();
```

- [ ] **Step 4: Re-apply damage on level load**

In `loadLevel(levelObj, areaId = null, opts = {})`, immediately after the existing line `this._buildTiles(lvl);`, add:

```js
    this.damage = new Set();
    if (opts.damage && opts.damage.length) this.applyDamage(opts.damage);
```

Ordering matters: `_buildTiles` rebuilds `this.map` from the level definition, so damage has to be subtracted after it and before `_buildDecor`, `_findLandmarks` and `_placePlayer` read the map.

- [ ] **Step 5: Add the three methods**

Insert immediately after the existing `breakBlock(tx, ty, by)` method, keeping the file's comment-banner style:

```js
  // -------------------------------------------------------------------------
  // Destructible terrain — see MODS.md
  // -------------------------------------------------------------------------
  // Clear tiles without any feedback. Used when loading a level that was
  // already bombed, where a hundred simultaneous explosions would be absurd.
  applyDamage(keys) {
    for (const key of keys) {
      const { tx, ty } = parseTileKey(key);
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
      this.damage.add(key);
      this.setTile(tx, ty, '.');
    }
  }

  // A live detonation. Everything in the radius goes: ground, brick, pipe,
  // castle stone, flagpole base. Returns only the keys that actually removed
  // something, so callers can tell a direct hit from a splash into open air.
  destroyTiles(keys) {
    const changed = [];
    for (const key of keys) {
      const { tx, ty } = parseTileKey(key);
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
      if (this.damage.has(key)) continue;
      const rec = this.recAt(tx, ty);
      const wasSomething = !!(rec.solid || rec.platform || rec.climb);
      this.damage.add(key);
      if (!wasSomething) continue;
      this.setTile(tx, ty, '.');
      this.contents.delete(`${tx},${ty}`);
      this.fx('brickShatter', tx * TILE + TILE / 2, ty * TILE + TILE / 2);
      changed.push(key);
    }
    if (changed.length) {
      this.sfx('break');
      this.shake(3, 10);
    }
    return changed;
  }

  blast(cx, cy, radiusTiles) {
    return this.destroyTiles(blastTiles(cx, cy, radiusTiles));
  }
```

- [ ] **Step 6: Verify `contents` uses the same key format**

The `destroyTiles` body deletes from `this.contents` so a destroyed question block cannot later cough up a mushroom from thin air.

Run: `grep -n "contents.set\|contents.get\|contents.has" src/game/world.js`
Expected: every call keys on a `` `${tx},${ty}` `` template string. **If it does not**, change the `this.contents.delete(...)` line in Step 5 to match the format actually used, and note the discrepancy in `MODS.md`.

- [ ] **Step 7: Create `MODS.md`**

```markdown
# Engine modifications

Wings of Mario is a fork of [mario-game](https://github.com/oliban/mario-game). The
engine is pulled forward with:

    git fetch upstream && git merge upstream/main

Every edit to an upstream file is listed here. Keep this list short — each entry
is a future merge conflict. New code belongs in `src/wings/`, `src/net/` or
`server/`, which upstream has never heard of and can never conflict with.

---

## `src/game/world.js` — destructible terrain

**Why:** Bombs must permanently clear level geometry. The blast maths lives in
`src/wings/blast.js`; only the mutation of the tile map has to happen in-engine.

**Changed:**
- Added `import { blastTiles, parseTileKey } from '../wings/blast.js';`
- Added `this.damage = new Set()` to the constructor.
- Added two lines to `loadLevel`, straight after `this._buildTiles(lvl)`, that
  reset the damage set and re-apply `opts.damage`.
- Added `applyDamage()`, `destroyTiles()` and `blast()` after `breakBlock()`.

**On conflict:** if upstream reworks `_buildTiles` or `loadLevel`, keep the
two-line damage block anchored immediately after the tile map is rebuilt and
before anything reads it.
```

- [ ] **Step 8: Verify the game still boots and a crater appears**

Run `npm start`, then in another terminal:

`node -e "import('playwright').then(async ({chromium}) => { const b = await chromium.launch(); const p = await b.newPage(); p.on('pageerror', e => console.log('ERR', e.message)); await p.goto('http://localhost:8123/'); await p.evaluate(() => window.__GAME.ready); await p.evaluate(() => window.__GAME.loadLevel('1-1')); const r = await p.evaluate(() => { const w = window.__GAME.world; const before = w.tileAt(20, 12).solid; const changed = w.blast(20 * 16 + 8, 12 * 16 + 8, 2); return { before, changed: changed.length, after: w.tileAt(20, 12).solid }; }); console.log(r); await b.close(); })"`

Expected: `{ before: true, changed: <a number greater than 0>, after: false }`

- [ ] **Step 9: Commit**

```bash
git add src/game/world.js MODS.md
git commit -m "Engine hook: World can permanently destroy tiles

Adds destroyTiles/applyDamage/blast and a damage set that loadLevel
re-applies, so a bombed island stays bombed across a reload. Recorded
in MODS.md to keep upstream merges diagnosable."
```

---

## Task 4: Expose destruction to scripted control

Tests and, later, the network layer both need to detonate from outside the engine.

**Files:**
- Modify: `src/main.js`
- Modify: `MODS.md`

**Interfaces:**
- Consumes: `world.blast`, `world.destroyTiles`, `world.applyDamage` from Task 3.
- Produces, on `window.__GAME`:
  - `blast(cx, cy, radiusTiles) -> string[]`
  - `destroyTiles(keys) -> string[]`
  - `damageKeys() -> string[]` — sorted destroyed keys for the loaded level.
  - `loadLevel(id, areaId = null, damage = [])` — **existing member, one added optional parameter.** The first two parameters keep their current meaning so `tools/shot.mjs` is unaffected.

- [ ] **Step 1: Extend `loadLevel` on the debug API**

In the `window.__GAME = {` block in `src/main.js`, replace the existing `loadLevel` member with:

```js
  async loadLevel(id, areaId = null, damage = []) {
    const ok = await game.loadLevel(id, areaId);
    if (damage && damage.length) game.world.applyDamage(damage);
    screens.hide();
    game.started = true;
    game.world.state = 'playing';
    // Settle the camera and one frame of entity activation before capture.
    game.loop.step(1);
    return ok;
  },
```

`game.loadLevel` is the app-level wrapper and does not take an options bag, so damage is applied immediately after it returns and before the settling tick — which means entities spawn onto the already-cratered map.

- [ ] **Step 2: Add the three new members**

Immediately after the `teleport` member in the same block:

```js
  blast(cx, cy, radiusTiles) {
    const w = game.world;
    return w ? w.blast(cx, cy, radiusTiles) : [];
  },

  destroyTiles(keys) {
    const w = game.world;
    return w ? w.destroyTiles(keys) : [];
  },

  damageKeys() {
    const w = game.world;
    return w ? [...w.damage].sort() : [];
  },
```

- [ ] **Step 3: Append to `MODS.md`**

```markdown

## `src/main.js` — scripted destruction

**Why:** Browser tests and the network layer detonate from outside the engine.

**Changed:**
- `window.__GAME.loadLevel(id, areaId)` gained an optional third parameter,
  `damage`, an array of tile keys applied right after the level loads. The first
  two parameters are unchanged, so `tools/shot.mjs` is unaffected.
- Added `blast()`, `destroyTiles()` and `damageKeys()` members.

**On conflict:** upstream owns this block per ARCHITECTURE.md section 10. Keep
their version of every pre-existing member and re-add ours.
```

- [ ] **Step 4: Verify the upstream screenshot harness still works**

The whole point of not breaking `__GAME` is that `tools/shot.mjs` keeps running.

Run: `npm run shots`
Expected: completes without error, exactly as it did before this plan started.

- [ ] **Step 5: Commit**

```bash
git add src/main.js MODS.md
git commit -m "Expose blast, destroyTiles and damageKeys on the debug API"
```

---

## Task 5: Browser test — a crater that survives a reload

The tier-3 gate. Everything above is only real if this passes.

**Files:**
- Create: `tests/browser/helpers.mjs`
- Create: `tests/browser/crater.test.mjs`

**Interfaces:**
- Consumes: `window.__GAME.loadLevel`, `.blast`, `.damageKeys`, `.world`, `.tick` from Tasks 3–4.
- Produces: `boot()` and `shutdown()` helpers reused by every later browser test.

- [ ] **Step 1: Write the boot helper**

Create `tests/browser/helpers.mjs`:

```js
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 8199;
export const BASE = `http://localhost:${PORT}`;

// One static server and one browser shared by a whole test file. The game has
// no build step, so `http-server` over the repo root is the entire deployment.
export async function boot() {
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
  await page.goto(BASE + '/');
  await page.evaluate(() => window.__GAME.ready);

  return { server, browser, page, errors };
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(BASE + '/index.html');
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('static server never came up');
}

export async function shutdown(ctx) {
  await ctx.browser.close();
  ctx.server.kill();
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/browser/crater.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

test('destructible terrain', { timeout: 120000 }, async (t) => {
  const ctx = await boot();
  const { page } = ctx;
  t.after(() => shutdown(ctx));

  await t.test('a bomb clears solid ground', async () => {
    await page.evaluate(() => window.__GAME.loadLevel('1-1'));
    const r = await page.evaluate(() => {
      const w = window.__GAME.world;
      const before = w.tileAt(20, 12).solid;
      const changed = window.__GAME.blast(20 * 16 + 8, 12 * 16 + 8, 2);
      return { before, changed, after: w.tileAt(20, 12).solid };
    });
    assert.equal(r.before, true, 'expected solid ground at tile 20,12 of 1-1');
    assert.ok(r.changed.length > 0, 'blast destroyed nothing');
    assert.equal(r.after, false, 'tile survived the blast');
  });

  await t.test('damage is reported back as sorted tile keys', async () => {
    const keys = await page.evaluate(() => window.__GAME.damageKeys());
    assert.ok(keys.includes('20,12'));
    assert.deepEqual(keys, [...keys].sort());
  });

  await t.test('the crater survives a reload of the same level', async () => {
    const keys = await page.evaluate(() => window.__GAME.damageKeys());
    const after = await page.evaluate(async (damage) => {
      await window.__GAME.loadLevel('1-1', null, damage);
      return {
        solid: window.__GAME.world.tileAt(20, 12).solid,
        keys: window.__GAME.damageKeys(),
      };
    }, keys);
    assert.equal(after.solid, false, 'reloading the level healed the crater');
    assert.deepEqual(after.keys, keys);
  });

  await t.test('a clean reload restores the ground', async () => {
    const solid = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      return window.__GAME.world.tileAt(20, 12).solid;
    });
    assert.equal(solid, true, 'damage leaked into an undamaged load');
  });

  await t.test('Mario falls into a crater blown out beneath him', async () => {
    const r = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(20, 11);
      window.__GAME.tick(10);
      const p = window.__GAME.world.player;
      const groundedBefore = p.grounded;
      // Clear a wide, deep hole directly under him.
      window.__GAME.blast(20 * 16 + 8, 13 * 16, 3);
      window.__GAME.tick(30);
      return { groundedBefore, groundedAfter: p.grounded, y: p.y };
    });
    assert.equal(r.groundedBefore, true, 'Mario was not standing on anything to begin with');
    assert.ok(
      r.groundedAfter === false || r.y > 11 * 16,
      `Mario ignored the hole (grounded=${r.groundedAfter}, y=${r.y})`
    );
  });

  await t.test('no uncaught page errors', () => {
    assert.deepEqual(ctx.errors, []);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npm run test:browser`
Expected: PASS, 6 subtests.

If `a bomb clears solid ground` fails on the `before` assertion, tile (20,12) is not solid ground in the current 1-1. Find one that is and use it consistently throughout the file:

`node -e "import('./src/data/levels/1-1.js').then(m => m.default.tiles.forEach((row, y) => console.log(String(y).padStart(2), row.slice(0, 60))))"`

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: unit tests pass, browser tests pass, no failures.

- [ ] **Step 5: Commit**

```bash
git add tests/browser/helpers.mjs tests/browser/crater.test.mjs
git commit -m "Browser test: craters appear, persist across reloads, and swallow Mario"
```

---

## Done when

- `npm test` is green from a clean checkout.
- `npm run shots` still produces the upstream screenshot set unchanged.
- `MODS.md` lists exactly two modified engine files, `src/game/world.js` and `src/main.js`.
- `git diff upstream/main --stat -- src/game src/main.js` shows a diff small enough to read in one screen.

## Deliberately not in this plan

Each belongs to a later plan and must not be started here:

- Bombs, the plane, or anything that *causes* a detonation (Plan 2).
- Telegraphing — whistle, shadow marker, edge indicator (Plan 4). Craters currently appear with no warning; that is expected at this stage.
- Persisting damage for islands that are not loaded, or across a match (Plan 3 — the server owns it; `DamageMap` from Task 2 is already the type it will use).
- Sending damage over a network, or the desync hash (Plan 3 — `DamageMap.hash()` is already built for it).
- Debris that falls, blocks that can be ridden, or any physics on destroyed matter. Destroyed tiles simply cease to exist.
