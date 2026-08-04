import { parseTileKey } from './blast.js';

// A level, reduced to something a pilot can read at twenty pixels wide.
//
// THE CONSTRAINT. The radar cell is 124px of the 512px panel and it plots the
// whole operating area: four islands of ~3400 world pixels each, plus the
// ocean between them and the carrier. That works out at fifteen to twenty
// pixels per island — about ten TILES per pixel. Anything per-tile is a smear
// at that reduction, so the only real question is what to throw away.
//
// WHAT IS KEPT, and why each one earns its pixel:
//
//   ground  the height of the terrain, which is the single most level-shaped
//           number there is. 1-1's low rolling floor, 1-4's dense stepped
//           masonry and 1-3's near-total void are already three different
//           silhouettes before anything else is drawn.
//   gap     columns with no floor at all. Holes are what kill Mario and holes
//           are what a bomb MAKES, so they are the one feature that is both
//           tactical and legible: a break in a coastline survives any
//           reduction, where a two-tile pipe does not.
//   shelf   how high the floating platforms sit ABOVE a hole. Without this
//           1-3 — which is almost entirely void with the level suspended over
//           it — draws as two stubs of rock and open sea, which is both
//           unrecognisable and a lie: there is plenty to stand on there, none
//           of it touching the bottom.
//   roof    whether the column is enclosed overhead. This is what separates
//           1-2 from 1-1 at a glance — underground versus open sky — and it
//           costs one thin line.
//   damage  how much of the column has been blown away, so the pilot can see
//           the stretch he has already worked over.
//
// WHAT IS THROWN AWAY. Landmarks (pipes, the staircase, the flagpole) were the
// tempting option and are the wrong one: a pipe is two tiles, a fifth of one
// radar pixel, so drawing it means drawing a marker BIGGER than the island
// feature it stands for, and four or five of those per island turns the strip
// into a row of indistinguishable dots. A coarse occupancy strip — "how full
// is this column" — is cheaper still but throws away the shape, which is
// exactly the thing that tells two islands apart. And a faithful per-tile
// render is the smear this module exists to avoid.
//
// Everything here is a pure function of the island's tiles and its destroyed
// set. No canvas, no tick, no wall clock — see radar-terrain.test.js.

// A column counts as roofed if its topmost solid tile is within this many rows
// of the island's top. 1-2 and 1-4 both hang their ceiling on row 2, and the
// floating block rows of an overworld level sit at row 9 or below, so three
// rows separates "underground" from "there is a row of ? blocks up there"
// without either bleeding into the other.
export const ROOF_ROWS = 3;

// Below this the strip stops being a profile and starts being noise; above it
// there is no more detail in a 3400px island to give.
export const MIN_COLUMNS = 4;
export const MAX_COLUMNS = 64;

// One tile column, in tiles: the contiguous solid stack standing on the
// bottom row, and the row of the highest solid tile anywhere in the column.
//
// `ground` is deliberately the stack from the BOTTOM rather than the highest
// solid tile: a lone ? block floating six rows up is not terrain, and reading
// it as terrain would give every overworld level the same jagged profile. A
// column whose bottom row is air has ground 0 — it is a hole, and holes are
// the point.
function columnShape(island, tx) {
  const h = island.h;
  let ground = 0;
  for (let ty = h - 1; ty >= 0; ty--) {
    if (!island.blocksTile(tx, ty)) break;
    ground++;
  }
  let top = -1;
  for (let ty = 0; ty < h; ty++) {
    if (island.blocksTile(tx, ty)) { top = ty; break; }
  }
  // The highest solid tile that is NOT part of a ceiling. 1-2's bottomless
  // pits are still roofed over, and reporting the roof as something to stand
  // on would draw a walkway across every hole in the level.
  let shelfTop = -1;
  for (let ty = ROOF_ROWS; ty < h; ty++) {
    if (island.blocksTile(tx, ty)) { shelfTop = ty; break; }
  }
  return { ground, top, shelfTop };
}

// Destroyed tiles per bucket, bucketed in one pass over the set rather than
// asked per tile. The denominator is the bucket's total tile count, NOT its
// count of originally-destructible tiles: computing the latter would mean a
// second copy of island.js's `destructibleTile` predicate living out here,
// and that file says in as many words that a divergent copy of that predicate
// is how the two players' craters — and then the desync hash — come apart.
// A share of all tiles is monotone, needs no predicate, and answers the only
// question being asked of it: has this stretch been worked over.
function damageByBucket(island, columns, bucketOf) {
  const counts = new Array(columns).fill(0);
  for (const key of island.destroyed) {
    const parsed = parseTileKey(key);
    if (!parsed) continue;
    const { tx, ty } = parsed;
    if (!island.inRange(tx, ty)) continue;
    const b = bucketOf(tx);
    if (b >= 0 && b < columns) counts[b]++;
  }
  return counts;
}

// The island reduced to `columns` buckets, left to right. Every field is a
// 0..1 fraction, so the instrument can scale them however it likes without
// knowing how tall a level is:
//
//   ground  mean solid stack height, as a fraction of the island's height
//   gap     share of the bucket's tile columns with no floor at all
//   shelf   mean height of the highest solid tile over the FLOORLESS columns,
//           0 when a hole here really is empty all the way up
//   roof    share of the bucket's tile columns enclosed overhead
//   damage  share of the bucket's tiles that have been destroyed
//
// Buckets tile the level exactly and never overlap; the last one absorbs the
// remainder, so a 210-tile level over 20 columns loses no ground to rounding.
export function terrainProfile(island, columns) {
  const n = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, Math.round(columns) || MIN_COLUMNS));
  const w = island.w;
  const h = island.h;
  const edge = (i) => Math.min(w, Math.floor((i * w) / n));
  const bucketOf = (tx) => Math.min(n - 1, Math.floor((tx * n) / w));
  const damage = damageByBucket(island, n, bucketOf);

  const out = [];
  for (let i = 0; i < n; i++) {
    const a = edge(i);
    const b = Math.max(a + 1, edge(i + 1));
    let ground = 0;
    let pits = 0;
    let roofed = 0;
    // Averaged over the floorless columns only. A hole with a walkway over it
    // and a hole with nothing over it are different places, and mixing the
    // solid columns into this average would just restate `ground`.
    let shelf = 0;
    let shelved = 0;
    for (let tx = a; tx < b; tx++) {
      const c = columnShape(island, tx);
      ground += c.ground;
      if (c.ground === 0) {
        pits++;
        if (c.shelfTop >= 0) { shelf += h - c.shelfTop; shelved++; }
      }
      if (c.top >= 0 && c.top < ROOF_ROWS) roofed++;
    }
    const m = b - a;
    out.push({
      ground: ground / m / h,
      gap: pits / m,
      shelf: shelved ? shelf / shelved / h : 0,
      roof: roofed / m,
      damage: Math.min(1, damage[i] / (m * h)),
    });
  }
  return out;
}

// The instrument redraws every frame and an island is ~3000 blocksTile calls,
// so the profile is memoised against the one thing that changes it. The
// destroyed set only ever GROWS — blast() and applyDamage() both add and
// nothing removes — so its size is a sound version counter, and a WeakMap
// keeps this cache out of Island itself, which has no business knowing that a
// radar exists.
const cache = new WeakMap();

export function profileFor(island, columns) {
  const n = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, Math.round(columns) || MIN_COLUMNS));
  const hit = cache.get(island);
  if (hit && hit.columns === n && hit.version === island.destroyed.size) return hit.profile;
  const profile = terrainProfile(island, n);
  cache.set(island, { columns: n, version: island.destroyed.size, profile });
  return profile;
}

export default terrainProfile;
