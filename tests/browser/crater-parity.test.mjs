// Crater parity: World.destroyTiles() vs Island.destructibleTile()/blast().
//
// Two independent pieces of code decide what a bomb removes. Mario's side is
// `World.destroyTiles` in src/game/world.js, whose predicate is
// `rec.name !== 'air' || rec.unknown` over the LEGEND table world.js owns. The
// pilot's side is `Island.destructibleTile` in src/wings/island.js, a
// hand-mirrored reimplementation over `CHAR_TO_TILE`/`tileForChar` from
// src/data/tiles.js — deliberately engine-free, because importing world.js
// would drag Camera, BlockSystem and the whole entity registry into the
// pilot's tests.
//
// They were written to match. Nothing proved they still do, and the desync
// detector structurally cannot: it compares each client's REPLICA of the
// server's destroyed-key set, so if the two implementations disagree about
// what a blast removes, both replicas stay identical and the alarm never
// fires. The players simply see different craters.
//
// WHY A BROWSER TEST. world.js imports the renderer, particles, audio and the
// entity registry, so it cannot be loaded in plain Node. The alternative —
// lifting the engine's predicate into a shared module — means editing engine
// files purely for testability, and the engine's small footprint is what keeps
// the upstream merges clean. So the comparison runs in the page: the real
// `World` (via window.__GAME.world) and a real `Island` (dynamically imported
// into the same page) are handed the same blasts, and their destroyed key sets
// are compared as SETS, per blast and cumulatively.
//
// The Island side is driven through its full public path — `island.blast()`
// with world-pixel coordinates offset by a non-zero island origin and
// ISLAND_TOP_Y — so the coordinate conversion is compared too, not just the
// predicate.
//
// THE SPAWN SANCTUARY is the third implementation this has to keep honest.
// The tiles around a level's spawn are never destructible (src/wings/
// sanctuary.js): Mario's side gets that through guardWorld(), which wraps the
// world INSTANCE's destroyTiles(), and the pilot's through
// Island.destructibleTile(). Both call the same predicate, and this file
// installs the guard exactly as src/net/mario-side.js does — so every sweep
// below is also 4,128 blasts' worth of evidence that neither side craters a
// spawn and that they still agree tile for tile everywhere else.
//
// TWO KNOWN DIVERGENCES are marked `todo` at the bottom of this file. They are
// asserted, not excluded: they fail, they say exactly what disagrees, and they
// do not redden the suite while they are open. See
// .superpowers/sdd/2026-08-04-networking/crater-parity-report.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

// Level/area pairs chosen so that every tile character used anywhere in the
// shipped level data appears in at least one of them — enforced by the "every
// shipped tile character is covered" subtest, which fails if a level ever
// introduces a character none of these areas contain.
const AREAS = [
  ['1-1', null],    // ground, brick, question, invisible block, stair, pipes, stone, hill/bush/cloud decor, flagpole
  ['1-1', '1-1b'],  // free-standing coins, horizontal pipe run
  ['1-1', '1-1w'],  // one-way platforms
  ['1-3', null],    // trees, platforms over pits
  ['1-4', null],    // castle brick, lava, axe, used blocks, hidden coin blocks
  ['2-1', null],    // vine blocks
  ['2-1', '2-1c'],  // coin heaven's cloud-blocks
  ['2-2', null],    // water surface and water body
  ['5-1', null],    // cannon barrel / cannon base
];

// A synthetic level for characters no shipped level uses, plus characters the
// two implementations know from DIFFERENT tables — which is exactly where a
// hand-mirrored predicate drifts:
//   'O' 'U' 'V' 'Y' 'W' '1'   are in world.js's LEGEND but NOT in CHAR_TO_TILE
//   'l' 'T'                   are in CHAR_TO_TILE but NOT in world.js's LEGEND
//   'Z' '%' '/' '!' 'q'       are in neither: unknown characters
//   ' '                       is air to world.js and id 0 (air) to tiles.js
const BENCH_CHARS = ".#=?M1CoBOS[]{}<>L~_|^XatbhcgPvU-KklT Z%/!q";

// The anchor characters, held out of the bench above because they are the one
// class that genuinely disagrees today — see the `todo` subtest at the bottom.
const ANCHOR_CHARS = ".#@FVYW";

test('crater parity: World and Island destroy the same tiles', { timeout: 300000 }, async (t) => {
  const ctx = await boot();
  const { page } = ctx;
  t.after(() => shutdown(ctx));

  // ---------------------------------------------------------------------
  // The in-page harness. Installed once; every subtest below calls into it.
  // ---------------------------------------------------------------------
  await page.evaluate(async () => {
    const [islandMod, blastMod, levelsMod, geoMod, constMod, sanctMod] = await Promise.all([
      import('/src/wings/island.js'),
      import('/src/wings/blast.js'),
      import('/src/data/levels/index.js'),
      import('/src/wings/geo.js'),
      import('/src/core/constants.js'),
      import('/src/wings/sanctuary.js'),
    ]);
    const { Island } = islandMod;
    const { blastTiles } = blastMod;
    const { getLevel, getArea, LEVELS } = levelsMod;
    const { ISLAND_TOP_Y } = geoMod;
    const TILE = constMod.TILE;
    // THE SPAWN SANCTUARY. Mario's client protects the tiles around a level's
    // spawn by wrapping the world instance's destroyTiles() — src/game/world.js
    // is engine and is never edited — and src/net/mario-side.js installs
    // exactly this call on connect. Installing it here is what makes the
    // comparison below a comparison of the two REAL crater pipelines: without
    // it, this test would compare a World that has no sanctuary against an
    // Island that does, and report the rule itself as a divergence.
    const { guardWorld, protectedKeys } = sanctMod;
    guardWorld(window.__GAME.world);

    // A non-zero, non-round origin, so a dropped or mistaken offset in either
    // direction shows up as a divergence instead of cancelling out.
    const ORIGIN = 3000 + 7 * TILE;

    // Deterministic scatter of the blast order. A left-to-right, top-to-bottom
    // sweep would let each row destroyed mask everything under it in one
    // predictable pattern; scattering means a tile's first hit arrives from an
    // arbitrary direction, while staying identical on every run.
    function scatter(list) {
      const out = list.slice();
      let s = 0x2f6e2b1;
      for (let i = out.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const j = s % (i + 1);
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    }

    // A synthetic level tiled from `chars`, rotated per row so every character
    // lands in many different columns and beside many different neighbours.
    function benchLevel(name, chars) {
      const width = 48;
      const height = 15;
      const set = chars.split('');
      const tiles = [];
      for (let y = 0; y < height; y++) {
        let row = '';
        for (let x = 0; x < width; x++) row += set[(x + y * 5) % set.length];
        tiles.push(row);
      }
      return { id: name, width, height, tiles, spawn: { x: 2, y: 11 }, theme: 'overworld' };
    }

    // Load the same level definition into both implementations, pristine.
    // `desc` is either { id, area } for a shipped level or { bench, chars }.
    function load(desc) {
      const world = window.__GAME.world;
      let level;
      if (desc.bench) {
        level = benchLevel(desc.bench, desc.chars);
        world.loadLevel(level, null, { silent: true });
      } else {
        level = getArea(desc.id, desc.area);
        world.loadLevel(getLevel(desc.id), desc.area, { silent: true });
      }
      return { world, level, island: new Island(level, ORIGIN) };
    }

    const name = (desc) => (desc.bench ? desc.bench : desc.id + (desc.area ? '/' + desc.area : ''));

    // Stride grid over the whole level, always including the far edge so no
    // column or row is left unreachable, with the blast radius cycling so the
    // sweep is not one repeated stencil. The smallest radius here is 2 tiles,
    // which is what makes a stride of 3 cover every tile in the level.
    function axis(n, stride) {
      const out = [];
      for (let v = 0; v < n; v += stride) out.push(v);
      if (out[out.length - 1] !== n - 1) out.push(n - 1);
      return out;
    }
    function centres(level, strideX, strideY, radii) {
      const out = [];
      let i = 0;
      for (const ty of axis(level.tiles.length, strideY)) {
        for (const tx of axis(level.width, strideX)) out.push({ tx, ty, r: radii[i++ % radii.length] });
      }
      return out;
    }

    const sorted = (a) => a.slice().sort();
    const diff = (a, b) => {
      const B = new Set(b);
      return a.filter((k) => !B.has(k));
    };

    // What was at a key in the untouched level data — so a divergence report
    // names the tile CHARACTER that diverged, not just a coordinate.
    function charAt(level, key) {
      const c = key.indexOf(',');
      const tx = Number(key.slice(0, c));
      const ty = Number(key.slice(c + 1));
      const row = level.tiles[ty];
      return row == null ? '<oob-row>' : JSON.stringify(row[tx] == null ? '<oob-col>' : row[tx]);
    }

    function report(level, at, worldKeys, islandKeys) {
      return {
        at,
        worldOnly: diff(worldKeys, islandKeys).map((k) => `${k}=${charAt(level, k)}`),
        islandOnly: diff(islandKeys, worldKeys).map((k) => `${k}=${charAt(level, k)}`),
      };
    }

    window.__PARITY = {
      // -----------------------------------------------------------------
      // Cumulative sweep. Both sides start pristine and take the same blasts
      // in the same order; the `changed` list of every single blast is
      // compared as a set, and so is the running destroyed set after it.
      // Comparing per blast is what makes this catch the bookkeeping as well
      // as the predicate: a side that records a key it did not destroy, or
      // re-reports an already-destroyed key, diverges on that blast even
      // though the tile map ends up the same.
      // -----------------------------------------------------------------
      sweep(desc, opts = {}) {
        const strideX = opts.strideX || 3;
        const strideY = opts.strideY || 2;
        const radii = opts.radii || [2, 3];
        const { world, level, island } = load(desc);
        const points = scatter(centres(level, strideX, strideY, radii));
        const divergences = [];
        let blasts = 0;
        let changedTotal = 0;

        for (const p of points) {
          const cx = p.tx * TILE + TILE / 2;
          const cy = p.ty * TILE + TILE / 2;
          const worldChanged = sorted(world.destroyTiles(blastTiles(cx, cy, p.r)));
          const islandChanged = sorted(island.blast(cx + ORIGIN, cy + ISLAND_TOP_Y, p.r));
          blasts++;
          changedTotal += worldChanged.length;
          const at = `${name(desc)} blast(${p.tx},${p.ty},r=${p.r})`;
          if (String(worldChanged) !== String(islandChanged) && divergences.length < 25) {
            divergences.push({ kind: 'changed', ...report(level, at, worldChanged, islandChanged) });
          }
          const wAll = sorted([...world.damage]);
          const iAll = island.keys();
          if (String(wAll) !== String(iAll) && divergences.length < 25) {
            divergences.push({ kind: 'cumulative', ...report(level, at, wAll, iAll) });
          }
        }

        // Coverage: which tile characters did the sweep actually destroy, and
        // which non-air characters did it leave standing? A sweep that never
        // reaches the interesting tiles would pass while proving nothing, so
        // the caller asserts on these.
        const destroyed = new Set();
        const survived = new Set();
        // Tiles that survived BECAUSE they are in the spawn sanctuary, kept
        // apart from the ones that survived for no reason at all: the first is
        // the rule working, the second is the sweep failing to reach them.
        const sanctuaryChars = new Set();
        const safe = protectedKeys(level);
        let sanctuaryTiles = 0;
        let sanctuaryDestroyed = 0;
        for (let ty = 0; ty < level.tiles.length; ty++) {
          for (let tx = 0; tx < level.width; tx++) {
            const key = `${tx},${ty}`;
            const ch = level.tiles[ty][tx];
            const isSafe = safe.has(key);
            const gone = world.damage.has(key);
            if (isSafe) {
              sanctuaryTiles++;
              if (gone) sanctuaryDestroyed++;
            }
            if (ch === '.' || ch === ' ' || ch == null) continue;
            if (isSafe) sanctuaryChars.add(ch);
            else (gone ? destroyed : survived).add(ch);
          }
        }
        return {
          level: name(desc),
          blasts,
          changedTotal,
          divergences,
          worldKeys: world.damage.size,
          islandKeys: island.destroyed.size,
          destroyedChars: [...destroyed].sort().join(''),
          survivedChars: [...survived].sort().join(''),
          sanctuaryChars: [...sanctuaryChars].sort().join(''),
          sanctuaryTiles,
          sanctuaryDestroyed,
          islandSanctuaryDestroyed: island.keys().filter((k) => safe.has(k)).length,
        };
      },

      // -----------------------------------------------------------------
      // Pristine, independent comparison: reload BOTH sides from scratch and
      // fire exactly one blast. No accumulated state on either side, so a
      // divergence here cannot be an artefact of the two having drifted
      // earlier in a cumulative run.
      // -----------------------------------------------------------------
      pristine(desc, opts = {}) {
        const strideX = opts.strideX || 17;
        const strideY = opts.strideY || 4;
        const radii = opts.radii || [2, 3];
        const points = centres(load(desc).level, strideX, strideY, radii);
        const divergences = [];
        let blasts = 0;
        for (const p of points) {
          const { world, level, island } = load(desc);
          const cx = p.tx * TILE + TILE / 2;
          const cy = p.ty * TILE + TILE / 2;
          const w = sorted(world.destroyTiles(blastTiles(cx, cy, p.r)));
          const i = sorted(island.blast(cx + ORIGIN, cy + ISLAND_TOP_Y, p.r));
          blasts++;
          if (String(w) !== String(i) && divergences.length < 25) {
            divergences.push(report(level, `${name(desc)} pristine blast(${p.tx},${p.ty},r=${p.r})`, w, i));
          }
        }
        return { level: name(desc), blasts, divergences };
      },

      // -----------------------------------------------------------------
      // Tiles Mario himself removed before the bomb arrived: a brick he
      // smashed (blocks.js shatter -> setTile '.') and a coin he collected
      // (world.js _collectCoin -> setTile '.'). Neither is recorded in
      // `world.damage`, so the World has air where the Island still has the
      // level's original character.
      // -----------------------------------------------------------------
      afterMarioMutations() {
        const out = [];
        const probe = (desc, want, mutate) => {
          const { world, level, island } = load(desc);
          let tx = -1;
          let ty = -1;
          for (let y = 0; y < level.tiles.length && ty < 0; y++) {
            const x = level.tiles[y].indexOf(want);
            if (x >= 0) {
              tx = x;
              ty = y;
            }
          }
          if (tx < 0) return out.push({ at: `${name(desc)} '${want}'`, error: 'character not found' });
          const mutated = mutate(world, tx, ty);
          const cx = tx * TILE + TILE / 2;
          const cy = ty * TILE + TILE / 2;
          const w = sorted(world.destroyTiles(blastTiles(cx, cy, 1)));
          const i = sorted(island.blast(cx + ORIGIN, cy + ISLAND_TOP_Y, 1));
          out.push({
            mutated,
            recordedInDamage: world.damage.has(`${tx},${ty}`),
            ...report(level, `${name(desc)} '${want}' at ${tx},${ty} then blast(r=1)`, w, i),
          });
        };
        probe({ id: '1-1', area: null }, '=', (w, tx, ty) => {
          w.breakBlock(tx, ty);
          return w.tileAt(tx, ty).name;
        });
        probe({ id: '1-1', area: '1-1b' }, 'o', (w, tx, ty) => {
          w.setTile(tx, ty, '.'); // what _collectCoin does when Mario touches it
          return w.tileAt(tx, ty).name;
        });
        return out;
      },

      // Every character used by every shipped level and area, plus a check
      // that the level data really is rectangular and ASCII — the two
      // assumptions under which the implementations index rows identically.
      levelDataShape() {
        const chars = new Set();
        const ragged = [];
        const nonAscii = [];
        const walk = (lvl, id, areaId) => {
          const rows = lvl.tiles || [];
          if ((lvl.height | 0) !== rows.length) {
            ragged.push(`${id}${areaId ? '/' + areaId : ''}: height ${lvl.height} vs ${rows.length} rows`);
          }
          rows.forEach((row, y) => {
            if (row.length !== lvl.width) {
              ragged.push(`${id}${areaId ? '/' + areaId : ''}: row ${y} is ${row.length} of ${lvl.width}`);
            }
            for (const ch of row) {
              chars.add(ch);
              if (ch.charCodeAt(0) > 127) nonAscii.push(`${id}: ${JSON.stringify(ch)}`);
            }
          });
          if (lvl.areas) for (const k of Object.keys(lvl.areas)) walk(lvl.areas[k], id, k);
        };
        for (const id of Object.keys(LEVELS)) walk(LEVELS[id], id, null);
        return { chars: [...chars].sort().join(''), ragged, nonAscii };
      },
    };
  });

  const swept = [];
  const sweep = async (desc, extra = {}) => {
    const r = await page.evaluate((d) => window.__PARITY.sweep(d), desc);
    swept.push(r);
    assert.ok(r.blasts > 50, `only ${r.blasts} blast centres swept in ${r.level}`);
    assert.ok(r.changedTotal > 0, `the sweep of ${r.level} destroyed nothing at all`);
    // Nothing but air may be left standing: a tile kind the sweep never
    // reached is a tile kind this test proves nothing about.
    assert.equal(
      r.survivedChars,
      '',
      `${r.level}: the sweep never destroyed these tile kinds: ${r.survivedChars}`
    );
    if (extra.destroyedChars) {
      assert.equal(r.destroyedChars, extra.destroyedChars, `${r.level}: wrong characters exercised`);
    }
    assert.deepEqual(
      r.divergences,
      [],
      `World and Island disagree on ${r.level}:\n${JSON.stringify(r.divergences, null, 2)}`
    );
    assert.equal(r.worldKeys, r.islandKeys, `${r.level}: destroyed-key COUNTS differ`);
    // The sanctuary, swept over from every direction by every blast above.
    assert.ok(r.sanctuaryTiles > 0, `${r.level}: no sanctuary tiles at all`);
    assert.equal(r.sanctuaryDestroyed, 0, `${r.level}: Mario's World cratered its own spawn`);
    assert.equal(r.islandSanctuaryDestroyed, 0, `${r.level}: the pilot's Island cratered the spawn`);
    return r;
  };

  for (const [id, area] of AREAS) {
    await t.test(`sweep: ${id}${area ? '/' + area : ''}`, () => sweep({ id, area }));
  }

  await t.test('sweep: synthetic bench of every other legend, tiles.js and unknown character', () =>
    sweep(
      { bench: 'bench', chars: BENCH_CHARS },
      {
        destroyedChars: [...new Set(BENCH_CHARS.split(''))]
          .filter((c) => c !== '.' && c !== ' ')
          .sort()
          .join(''),
      }
    ));

  await t.test('pristine single-blast comparison, one fresh load per blast', async () => {
    // Each blast reloads the whole World, so this is the expensive form. Its
    // job is independence, not coverage — the sweeps above give the coverage.
    for (const desc of [
      { id: '1-1', area: null },
      { id: '1-4', area: null },
      { id: '2-2', area: null },
      { id: '2-1', area: '2-1c' },
      { bench: 'bench', chars: BENCH_CHARS },
    ]) {
      const r = await page.evaluate((d) => window.__PARITY.pristine(d), desc);
      assert.ok(r.blasts > 5, `only ${r.blasts} pristine blasts on ${r.level}`);
      assert.deepEqual(
        r.divergences,
        [],
        `pristine divergence on ${r.level}:\n${JSON.stringify(r.divergences, null, 2)}`
      );
    }
  });

  await t.test('every shipped tile character is covered by the swept areas', async () => {
    const shape = await page.evaluate(() => window.__PARITY.levelDataShape());
    const covered = new Set([
      ...swept.flatMap((r) => (r.destroyedChars + r.survivedChars + r.sanctuaryChars).split('')),
      '.', ' ',
    ]);
    const missed = shape.chars.split('').filter((c) => !covered.has(c));
    assert.deepEqual(
      missed,
      [],
      `these tile characters appear in shipped levels but in none of the swept areas: ${missed.join('')}`
    );
  });

  await t.test('shipped level data is rectangular and ASCII', async () => {
    // The two implementations index rows differently at the edges: World pads
    // a short row with air and masks each character to 7 bits (`_buildTiles`),
    // while Island reads `rows[ty][tx]` raw and treats `undefined` as an
    // unknown — hence destructible — character. Those are the same answer only
    // for rectangular, ASCII level data. Stating the assumption here means a
    // future level that breaks it fails HERE, naming the cause, instead of
    // surfacing as a mysterious crater divergence.
    const shape = await page.evaluate(() => window.__PARITY.levelDataShape());
    assert.deepEqual(shape.ragged, [], 'ragged level data');
    assert.deepEqual(shape.nonAscii, [], 'non-ASCII tile characters');
  });

  // =======================================================================
  // KNOWN DIVERGENCES. Both are asserted exactly as strictly as everything
  // above; `todo` marks them as open, not as acceptable. Delete the flag when
  // the underlying disagreement is fixed.
  // =======================================================================

  await t.test(
    'sweep: anchor tiles (@ F V Y W)',
    { todo: 'World clears anchor tiles at load (they become entities); Island still destroys them' },
    () => sweep({ bench: 'anchors', chars: ANCHOR_CHARS })
  );

  await t.test(
    'a tile Mario already removed himself',
    { todo: 'a smashed brick / collected coin is air to World but still terrain to Island' },
    async () => {
      const rows = await page.evaluate(() => window.__PARITY.afterMarioMutations());
      for (const r of rows) assert.equal(r.error, undefined, `probe failed: ${r.at}`);
      assert.deepEqual(
        rows.map((r) => ({ at: r.at, worldOnly: r.worldOnly, islandOnly: r.islandOnly })),
        rows.map((r) => ({ at: r.at, worldOnly: [], islandOnly: [] })),
        `World and Island disagree after Mario mutated the tile himself:\n${JSON.stringify(rows, null, 2)}`
      );
    }
  );

  await t.test('no uncaught page errors', () => {
    assert.deepEqual(ctx.errors, []);
  });
});
