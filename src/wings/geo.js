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
    // x1 is the right edge. worldBounds reads it, so a slot without one puts a
    // NaN straight into the camera clamp.
    out.push({ id: lvl.id, level: lvl, x, width, x1: x + width });
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

// A guard for the ONE mistake that is both easy to make and invisible when
// made: passing a world-space y where island-local was expected. The
// conversion itself is simple enough that it is never wrong; the caller is.
// And because the arithmetic still runs on a swapped value, nothing throws on
// its own — the result is just a reticle, a shot, a probe ISLAND_TOP_Y (320)
// pixels away from where it belongs, which reads as "invisible" rather than
// "broken."
//
// This is only checkable in ONE direction. An island-local level is
// ISLAND_H (240) px tall, so a local y can never legitimately reach
// ISLAND_TOP_Y (320) — that band is reachable ONLY by a world-space y over an
// island. The reverse check does not exist: a world-space y can legitimately
// sit anywhere from CEILING_Y up through the local-looking 0..240 range (a
// plane at altitude has a small world y), so a "does this look local" guard
// on a WORLD value would false-positive on ordinary high-altitude flight and
// get disabled within a day. Assert only where the confidence is real.
const warnedLocalY = new Set();

export function assertLocalY(y, label = 'y') {
  if (y < ISLAND_TOP_Y) return;
  const msg =
    `[geo] ${label}=${y} looks like a WORLD-space y passed where island-local ` +
    `was expected (island-local levels are only ${ISLAND_H}px tall, so ` +
    `${ISLAND_TOP_Y}+ is reachable only in world space). Did you forget ` +
    'worldToLocalTile()?';
  // In tests and other headless/Node contexts, fail immediately and loudly —
  // there is no in-progress frame to protect and a thrown assertion is the
  // whole point. In the browser, a thrown error mid-render blanks the game,
  // which is a worse experience than a misplaced reticle, so warn once per
  // label and keep going.
  if (typeof window === 'undefined') {
    throw new Error(msg);
  }
  if (!warnedLocalY.has(label)) {
    warnedLocalY.add(label);
    console.error(msg);
  }
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
  // The camera clamps to this box, so the horizon is also how far the player
  // can fly and still see the aircraft. An empty ocean therefore reaches out to
  // where the first island will be rather than stopping at the bow — bounded at
  // DECK_X1 the view pins 96px past the ship and the plane slides off the right
  // of the screen on the outbound leg of every circuit.
  let right = Math.max(DECK_X1, FIRST_ISLAND_X);
  for (const i of islands) right = Math.max(right, i.x1);
  return {
    minX: WORLD_LEFT,
    maxX: right + WORLD_MARGIN,
    minY: CEILING_Y - 32,
    maxY: HULL_BOTTOM + 32,
  };
}
