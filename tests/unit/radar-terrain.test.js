import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../src/core/constants.js';
import { getLevel } from '../../src/data/levels/index.js';
import { MARIO, luma } from '../../src/wings/art/palette.js';
import { themeFor } from '../../src/wings/art/mario-tiles.js';
import { RADAR_SKY, RADAR_SEA, RADAR_SCORCH } from '../../src/wings/art/hud.js';
import { ISLAND_TOP_Y } from '../../src/wings/geo.js';
import { Island } from '../../src/wings/island.js';
import {
  terrainProfile, profileFor, ROOF_ROWS, MIN_COLUMNS, MAX_COLUMNS,
} from '../../src/wings/radar-terrain.js';

const ORIGIN = 3000;

// The number the instrument actually asks for: the radar cell is 124px of the
// panel plotting a ~20,800px operating area, so a 3400px island lands on about
// twenty columns. Every legibility claim below is made at that width, because a
// profile that only reads at 200 columns is not the profile being shipped.
const COLS = 20;

const isle = (id, damage = []) => new Island(getLevel(id), ORIGIN, damage);
const prof = (id, n = COLS) => terrainProfile(isle(id), n);

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('a profile has one bucket per requested column, all in 0..1', () => {
  for (const n of [4, 8, 15, 20, 64]) {
    const p = prof('1-1', n);
    assert.equal(p.length, n, `asked for ${n} columns`);
    for (const c of p) {
      for (const k of ['ground', 'gap', 'shelf', 'roof', 'damage']) {
        assert.ok(c[k] >= 0 && c[k] <= 1, `${k}=${c[k]} is not a 0..1 fraction`);
      }
    }
  }
});

test('the column count is clamped, so a degenerate span cannot make a smear or a crash', () => {
  assert.equal(prof('1-1', 0).length, MIN_COLUMNS);
  assert.equal(prof('1-1', -7).length, MIN_COLUMNS);
  assert.equal(prof('1-1', NaN).length, MIN_COLUMNS);
  assert.equal(prof('1-1', 5000).length, MAX_COLUMNS);
});

test('the buckets tile the level exactly — no tile counted twice, none dropped', () => {
  // A level with a single solid tile per column would give ground = 1/h in
  // every bucket; the real check is that the mean of the profile matches the
  // mean computed tile by tile, which can only hold if the buckets partition.
  const island = isle('1-1');
  let total = 0;
  for (let tx = 0; tx < island.w; tx++) {
    let g = 0;
    for (let ty = island.h - 1; ty >= 0; ty--) {
      if (!island.blocksTile(tx, ty)) break;
      g++;
    }
    total += g / island.h;
  }
  // Buckets are equal to within one tile column, so the bucket-mean of
  // bucket-means is the tile mean to within that rounding.
  const p = terrainProfile(island, COLS);
  assert.ok(Math.abs(mean(p.map((c) => c.ground)) - total / island.w) < 0.02,
    'the buckets do not partition the level');
});

test('the profile is a pure function — same island, same numbers', () => {
  assert.deepEqual(prof('1-3'), prof('1-3'));
  assert.deepEqual(prof('1-4', 15), prof('1-4', 15));
});

// ---------------------------------------------------------------------------
// The point of the whole exercise: can a pilot tell world 1's four islands
// apart? These assert the FEATURES that make each silhouette distinct, at the
// width the radar actually draws.
// ---------------------------------------------------------------------------

test('1-3 reads as a level made mostly of holes', () => {
  const p = prof('1-3');
  const holey = p.filter((c) => c.gap >= 0.5).length;
  assert.ok(holey > p.length * 0.5,
    `1-3 shows ${holey}/${p.length} floorless columns — it is the pit level, it should be most of them`);
  // ...and it still has land at both ends to stand on, or it would read as
  // open ocean rather than as an island.
  assert.ok(p[0].gap < 0.5 && p[p.length - 1].gap < 0.5, '1-3 lost its shores');
  // ...and the void is not empty: the level is suspended over it. Without
  // this, 1-3 draws as two stubs of rock in open water — unrecognisable, and
  // wrong about where Mario can walk.
  const walkable = p.filter((c) => c.gap >= 0.5 && c.shelf > 0).length;
  assert.ok(walkable > p.length * 0.4,
    `only ${walkable}/${p.length} of 1-3's holes show a platform over them`);
});

test('a bottomless pit under a ceiling is not reported as a walkway', () => {
  // 1-2 is roofed end to end AND has real holes in its floor. If `shelf` read
  // the ceiling as something to stand on, every one of those holes would draw
  // a walkway across it.
  const p = prof('1-2');
  for (const c of p) {
    if (c.gap >= 0.5 && c.roof >= 0.5) {
      assert.ok(c.shelf < (15 - ROOF_ROWS) / 15,
        'a roofed hole is reporting its own ceiling as a floor');
    }
  }
});

test('1-2 reads as enclosed and 1-1 does not — the one line that separates them', () => {
  const roofed = (id) => prof(id).filter((c) => c.roof >= 0.5).length;
  assert.ok(roofed('1-2') > COLS * 0.7, `1-2 is underground; only ${roofed('1-2')}/${COLS} columns read as roofed`);
  assert.equal(roofed('1-1'), 0, '1-1 is open sky and must not grow a lid');
  // The block rows of an overworld level sit well below the roof band, which
  // is what lets one threshold serve both.
  assert.ok(ROOF_ROWS >= 2 && ROOF_ROWS <= 4);
});

test('1-4 stands taller and denser than the overworld it sits next to', () => {
  const g = (id) => mean(prof(id).map((c) => c.ground));
  // 0.28 against 0.17: about two pixels of extra height on the drawn strip,
  // which on its own is thin. What actually carries the castle is that the
  // height is JAGGED where 1-1's is a flat shelf — see the spread below.
  assert.ok(g('1-4') > g('1-1') * 1.5,
    `the castle averages ${g('1-4').toFixed(3)} against 1-1's ${g('1-1').toFixed(3)} — it should tower`);
  const spread = (id) => {
    const gs = prof(id).map((c) => c.ground);
    return Math.max(...gs) - Math.min(...gs);
  };
  assert.ok(spread('1-4') > spread('1-1'), 'the castle silhouette should be the rougher of the two');
  assert.ok(g('1-4') > g('1-2'), 'the castle should out-mass the underground');
});

test('no two of world 1 draw the same strip', () => {
  const ids = ['1-1', '1-2', '1-3', '1-4'];
  const sig = (id) => prof(id).map((c) => [c.ground, c.gap, c.roof]);
  // A pilot separates them on ground height, holes and roof; the distance
  // between any two islands on those three has to be big enough to see.
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = sig(ids[i]);
      const b = sig(ids[j]);
      let d = 0;
      for (let k = 0; k < a.length; k++) {
        for (let f = 0; f < 3; f++) d += Math.abs(a[k][f] - b[k][f]);
      }
      assert.ok(d / a.length > 0.25,
        `${ids[i]} and ${ids[j]} differ by only ${(d / a.length).toFixed(3)} per column — they will look the same`);
    }
  }
});

// ---------------------------------------------------------------------------
// Craters
// ---------------------------------------------------------------------------

test('bombing a stretch shows up as damage in that column and nowhere else', () => {
  const island = isle('1-1');
  const before = terrainProfile(island, COLS);
  assert.deepEqual(before.map((c) => c.damage), new Array(COLS).fill(0));

  // Blast on the ground shelf a quarter of the way along.
  const tx = Math.floor(island.w * 0.25);
  island.blast(ORIGIN + tx * TILE, ISLAND_TOP_Y + 13.5 * TILE, 4);
  const after = terrainProfile(island, COLS);
  const hit = Math.floor((tx * COLS) / island.w);
  assert.ok(after[hit].damage > 0, 'the bombed column shows no damage');
  for (let i = 0; i < COLS; i++) {
    if (Math.abs(i - hit) > 1) {
      assert.equal(after[i].damage, 0, `column ${i} is nowhere near the blast and still reads damaged`);
    }
  }
});

test('a crater eats the silhouette and opens a hole, the way a real one does', () => {
  const island = isle('1-1');
  const tx = 30; // solid two-row shelf, no pit nearby
  const before = terrainProfile(island, COLS);
  const bucket = Math.floor((tx * COLS) / island.w);
  assert.ok(before[bucket].gap < 0.1, 'this stretch is supposed to start solid');

  // Work the same stretch over properly: several bombs across the bucket.
  for (let d = -4; d <= 4; d += 2) {
    island.blast(ORIGIN + (tx + d) * TILE, ISLAND_TOP_Y + 13.5 * TILE, 3);
  }
  const after = terrainProfile(island, COLS);
  assert.ok(after[bucket].ground < before[bucket].ground,
    'the ground did not sink where it was blown away');
  assert.ok(after[bucket].gap > before[bucket].gap,
    'blowing the shelf out did not open a hole in the coastline');
  assert.ok(after[bucket].damage > 0.02, 'nine bombs should read as more than a scratch');
});

test('damage rebuilt from the wire matches damage done live', () => {
  const live = isle('1-1');
  live.blast(ORIGIN + 40 * TILE, ISLAND_TOP_Y + 13.5 * TILE, 4);
  const rebuilt = isle('1-1', live.keys());
  assert.deepEqual(terrainProfile(rebuilt, COLS), terrainProfile(live, COLS),
    'a bombed island looks different depending on how it got that way');
});

// ---------------------------------------------------------------------------
// The palette
//
// The radar paints islands out of MARIO.EARTH, the same ramp the island
// renderer uses, so the map and the thing it is a map OF agree about what
// colour a level is. These guard the two things that can go wrong with that:
// a repaint on the Mario side turning this window to mud, and craters being
// swallowed by the new colours.
// ---------------------------------------------------------------------------

const SLOT = { shadow: 1, body: 2, lit: 3, bright: 4 };
const sky = luma(RADAR_SKY);
const sea = luma(RADAR_SEA);
const themes = Object.keys(MARIO.EARTH);

test('the landmass clears the sky it is drawn against', () => {
  for (const t of themes) {
    const body = luma(MARIO.EARTH[t][SLOT.body]);
    assert.ok(sky - body > 40,
      `${t} ground is luma ${body.toFixed(0)} against a sky of ${sky.toFixed(0)} — that is mud at three pixels tall`);
  }
});

test('the obvious slot really is the trap the palette comment says it is', () => {
  // If this ever stops holding, the radar should go back to `lit`, which is
  // the more faithful choice. Until then the comment in hud.js has to be
  // measurably true rather than merely plausible.
  for (const t of themes) {
    assert.ok(Math.abs(luma(MARIO.EARTH[t][SLOT.lit]) - sky) < 25,
      `${t}'s lit tone now separates from the sky; reconsider which slot the radar draws`);
  }
});

test('the crest reads above the sky and the waterline below the sea', () => {
  for (const t of themes) {
    assert.ok(luma(MARIO.EARTH[t][SLOT.bright]) - sky > 20, `${t} has no crest`);
    assert.ok(sea - luma(MARIO.EARTH[t][SLOT.shadow]) > 20, `${t}'s waterline vanishes into the water`);
  }
});

test('the four islands of world 1 are four different colours', () => {
  // World 1 is overworld / underground / athletic / castle, so colour alone
  // separates them before a silhouette is read. Compared on the body tone,
  // which is the one that fills the strip.
  const ids = ['1-1', '1-2', '1-3', '1-4'];
  const body = (id) => MARIO.EARTH[themeFor(getLevel(id).theme)][SLOT.body];
  const seen = new Set(ids.map(body));
  assert.equal(seen.size, 4, `world 1 paints ${seen.size} distinct island colours, not 4`);
  // Distinct hex is not distinct to an eye. Require a real channel spread too.
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [rgb(body(ids[i])), rgb(body(ids[j]))];
      const d = Math.max(...a.map((v, k) => Math.abs(v - b[k])));
      assert.ok(d >= 25,
        `${ids[i]} and ${ids[j]} differ by only ${d} in their strongest channel — same colour on the map`);
    }
  }
});

test('a crater still reads on every theme, not just the brown one', () => {
  const scorch = luma(RADAR_SCORCH);
  for (const t of themes) {
    const body = luma(MARIO.EARTH[t][SLOT.body]);
    assert.ok(body - scorch > 25,
      `scorched land is luma ${scorch.toFixed(0)} against ${t} ground at ${body.toFixed(0)} — the damage disappears`);
  }
  // And it must not read as sea either: a bombed-flat stretch keeps a scorched
  // waterline precisely so it does not turn into open water.
  assert.ok(Math.abs(scorch - sea) > 15, 'scorched ground is the same value as the sea');
});

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------

test('the memo returns the same profile until the island is bombed, then a new one', () => {
  const island = isle('1-1');
  const a = profileFor(island, COLS);
  assert.equal(profileFor(island, COLS), a, 'an unchanged island recomputed its profile');
  assert.notEqual(profileFor(island, COLS + 1), a, 'a different width must not reuse the cache');

  island.blast(ORIGIN + 40 * TILE, ISLAND_TOP_Y + 13.5 * TILE, 4);
  const b = profileFor(island, COLS);
  assert.notEqual(b, a, 'the cache went stale across a blast');
  assert.deepEqual(b, terrainProfile(island, COLS), 'the memo disagrees with the pure function');
});

test('two islands of the same level do not share a cache entry', () => {
  const clean = isle('1-1');
  const bombed = isle('1-1');
  for (let d = -4; d <= 4; d += 2) {
    bombed.blast(ORIGIN + (30 + d) * TILE, ISLAND_TOP_Y + 13.5 * TILE, 3);
  }
  assert.notDeepEqual(profileFor(bombed, COLS), profileFor(clean, COLS));
});
