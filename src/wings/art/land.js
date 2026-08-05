import { TILE } from '../../core/constants.js';
import { LAND } from './palette.js';
import {
  COMPOSITE, VSTACK, drawTileChar, isInvisible, lodFor, themeFor, castleKeep, flag, LOD,
  armour,
} from './mario-tiles.js';

// An island, seen from an aeroplane. It is drawn straight off the level's own
// characters — the same rows Mario walks on — and now with the ORIGINAL'S OWN
// tiles, redrawn as vector art in mario-tiles.js.
//
// This file used to own the art as well, and what it drew was a flat coloured
// rectangle per character with a lit top edge on whichever ones had air above
// them. That reads as terrain with the sun on it, which is a perfectly good
// thing for an island to be and is not what a Super Mario Bros. level looks
// like from any distance. The lit edge in particular was actively wrong: in
// the original every ground block is IDENTICAL, including the ones buried in
// the middle of the ground, and the unbroken repeating grid is most of the
// look. So the per-tile jitter and the sunlit cap are both gone; what this
// file does now is decide WHERE marks go, and mario-tiles.js decides what they
// are.
//
// Two jobs are left here that a per-tile painter cannot do:
//
//   RUNS. Bushes, hills, clouds and trees are multi-tile objects in the
//   original — a three-tile bush is one drawing with three humps, not three
//   drawings of one hump. The level stores them as runs of the same character,
//   so a connected run is found here and handed to the painter as ONE shape.
//   This is the single biggest change in how an island reads: the row of
//   identical green domes along the ground is gone.
//
//   DEPTH. Scenery is behind the blocks in the original. Two passes, scenery
//   first, so a bush never lands on top of the pipe it grows beside.
//
// Craters need no code here. A destroyed tile reports as '.' from charAt, so
// a bombed island is drawn with the hole already in it.

const AIR = new Set(['.', ' ']);

// A connected run of the same scenery character, and the tile within it that
// gets to draw the whole thing. The anchor is the topmost tile, and the
// leftmost of those — for a hill, whose bounding box has empty corners, that
// is the apex rather than the corner, so it is a tile that actually exists.
//
// Bounded: a level with a pathological field of one character must not turn
// one frame into a flood fill of ten thousand cells.
const RUN_LIMIT = 64;

function runBox(isle, tx, ty, ch) {
  const seen = new Set();
  const stack = [[tx, ty]];
  let x0 = tx;
  let x1 = tx;
  let y0 = ty;
  let y1 = ty;
  let ax = tx;
  let ay = ty;
  let n = 0;
  while (stack.length && n < RUN_LIMIT) {
    const [a, b] = stack.pop();
    const key = `${a},${b}`;
    if (seen.has(key)) continue;
    if (isle.charAt(a, b) !== ch) continue;
    seen.add(key);
    n++;
    if (a < x0) x0 = a;
    if (a > x1) x1 = a;
    if (b < y0) y0 = b;
    if (b > y1) y1 = b;
    if (b < ay || (b === ay && a < ax)) {
      ax = a;
      ay = b;
    }
    stack.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
  }
  return { x0, x1, y0, y1, ax, ay };
}

// ---------------------------------------------------------------------------
// The two landmarks that are not tiles
// ---------------------------------------------------------------------------

// The castle is five tiles wide with its doorway centred on `castle.x`, which
// is how the Mario side plants it (`world._drawCastle`); the tall variant is
// the same building with a longer body. Its base is found by walking UP the
// column from the bottom to the first gap — scanning down instead lands on the
// first brick or platform in the way and leaves the castle hanging.
const CASTLE_TILES = 5;

function groundRow(isle, tx) {
  for (let ty = isle.h - 1; ty >= 0; ty--) {
    if (!isle.blocksTile(tx, ty)) return ty + 1;
  }
  return 0;
}

function drawCastle(ctx, isle, arg, tx0, tx1) {
  const lvl = isle.level;
  const cs = lvl && lvl.castle;
  if (!cs || cs.x == null) return;
  const tx = Math.floor(cs.x);
  if (tx < tx0 - CASTLE_TILES || tx > tx1 + CASTLE_TILES) return;
  const tall = !!cs.tall;
  const w = CASTLE_TILES * TILE;
  const h = (tall ? 11 : 5) * TILE;
  const x = cs.x * TILE + TILE / 2 - w / 2;
  const y = groundRow(isle, tx) * TILE - h;
  castleKeep(ctx, x, y, w, h, arg.lod);
}

// The flag hangs from the ball at the top of the pole, so it is found from the
// tile map rather than from the level metadata: bomb the top of the pole and
// the flag goes with it, which is the honest thing to draw.
function drawFlag(ctx, isle, arg, tx0, tx1) {
  const fp = isle.level && isle.level.flagpole;
  if (!fp || fp.x == null) return;
  const tx = Math.floor(fp.x);
  if (tx < tx0 - 2 || tx > tx1 + 2) return;
  for (let ty = 0; ty < isle.h; ty++) {
    if (isle.charAt(tx, ty) === '^') {
      flag(ctx, tx * TILE, ty * TILE + TILE, arg.lod);
      return;
    }
  }
}

// Draw one island. `cam` is the world-pixel top-left of the viewport, `vw`/`vh`
// its size in world pixels — the same frame every other world layer draws in.
// `scale` is the zoom the world is being drawn at, and it is what the tile art
// uses to decide how much ornament it can afford; see lodFor().
export function drawLandmass(ctx, isle, cam, vw, vh, tick = 0, seaY = 560, scale = 1) {
  if (isle.x1 < cam.x - TILE || isle.x0 > cam.x + vw + TILE) return;

  const lod = lodFor(scale);
  // The area palette. The level knows whether it is overworld, underground,
  // castle or water, and in the original that is the ONLY thing that separates
  // an orange brick from a blue one.
  const theme = themeFor(isle.level && isle.level.theme);
  const arg = { lod, tick, theme, open: false, tx: 0, ty: 0, rows: 1 };

  // The window is widened by four tiles rather than one: a scenery run is
  // drawn by its anchor tile, and the anchor of a five-wide hill can be off
  // the edge of the screen while most of the hill is on it.
  const pad = 4;
  const tx0 = Math.max(0, Math.floor((cam.x - isle.x0) / TILE) - pad);
  const tx1 = Math.min(isle.w - 1, Math.ceil((cam.x + vw - isle.x0) / TILE) + pad);
  const ty0 = Math.max(0, Math.floor((cam.y - isle.y0) / TILE) - pad);
  const ty1 = Math.min(isle.h - 1, Math.ceil((cam.y + vh - isle.y0) / TILE) + pad);
  if (tx1 < tx0 || ty1 < ty0) return;

  ctx.save();
  ctx.translate(isle.x0 - cam.x, isle.y0 - cam.y);

  // Pass zero: the castle, which is BACKGROUND — the scenery and the blocks
  // both stand in front of it.
  drawCastle(ctx, isle, arg, tx0, tx1);

  // Pass one: scenery, as whole objects, behind everything.
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const ch = isle.charAt(tx, ty);
      const paint = COMPOSITE[ch];
      if (!paint) continue;
      const box = runBox(isle, tx, ty, ch);
      if (box.ax !== tx || box.ay !== ty) continue;
      paint(
        ctx,
        box.x0 * TILE,
        box.y0 * TILE,
        (box.x1 - box.x0 + 1) * TILE,
        (box.y1 - box.y0 + 1) * TILE,
        lod
      );
    }
  }

  // Pass two: the blocks themselves.
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const ch = isle.charAt(tx, ty);
      if (AIR.has(ch) || COMPOSITE[ch] || isInvisible(ch)) continue;
      const above = isle.charAt(tx, ty - 1);
      arg.rows = 1;
      if (VSTACK.has(ch)) {
        // One object per vertical run, drawn by the top tile of it. Skipping
        // the rest is what removes the seam across a pipe every 16 pixels.
        if (above === ch) continue;
        let n = 1;
        while (isle.charAt(tx, ty + n) === ch) n++;
        arg.rows = n;
      }
      arg.open = ty === 0 || AIR.has(above) || !!COMPOSITE[above];
      arg.tx = tx;
      arg.ty = ty;
      drawTileChar(ctx, tx * TILE, ty * TILE, ch, arg);
      // GROUND NO BOMB WILL TAKE, marked as such. Keyed off the ISLAND'S OWN
      // predicate — the very function destroyTiles consults — so the wash can
      // never promise something the ordnance disagrees with. A tile that
      // becomes bombable stops being painted this way in the same frame.
      // Asked of the island rather than recomputed, and asked politely: this
      // file is handed anything island-SHAPED — the tile tests pass a stub with
      // a charAt and little else — and a renderer must not be the reason a
      // harness has to grow a method. No predicate means no information, so
      // draw it plainly.
      if (typeof isle.destructibleTile === 'function' && !isle.destructibleTile(tx, ty)) {
        armour(ctx, tx * TILE, ty * TILE, lod, arg.rows);
      }
    }
  }

  drawFlag(ctx, isle, arg, tx0, tx1);

  ctx.restore();

  // Surf. Where the island meets the water there is a bright line, and it is
  // what tells the pilot the difference between a beach he can bomb and a
  // lagoon he would sink in. Nothing to do with Mario — this is the ocean the
  // level is standing in, and it is the pilot's own world.
  const bottom = isle.h - 1;
  const wy = seaY - cam.y;
  if (wy < -8 || wy > vh + 8) return;
  ctx.save();
  ctx.fillStyle = LAND.surf;
  for (let tx = tx0; tx <= tx1; tx++) {
    if (isle.charAt(tx, bottom) === '.') continue;
    const x = isle.x0 + tx * TILE - cam.x;
    const swell = Math.sin((tx * 0.9 + tick * 0.06)) * 1.4;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x, wy - 3 + swell, TILE, 2);
    ctx.globalAlpha = 0.25;
    ctx.fillRect(x, wy - 1 + swell, TILE, 3);
  }
  ctx.restore();
}

export { LOD, lodFor };
export default drawLandmass;
