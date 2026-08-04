// Tile collision: axis-separated swept AABB against the world tilemap.
//
// Everything here is in PIXELS and PIXELS PER FRAME. Never multiply by dt.
// +Y is DOWN. A box is any object with { x, y, w, h } where x,y is its TOP-LEFT.
//
// The only thing this module needs from the world is `world.tileAt(tx, ty)`
// returning a tile record (see ARCHITECTURE.md §5) or a falsy value for air.
//
// Face naming, used everywhere below and in the result object:
//   hitLeft   the box's LEFT edge hit something  (wall on the left)
//   hitRight  the box's RIGHT edge hit something (wall on the right)
//   hitTop    the box's TOP edge hit something   (ceiling bump)
//   hitBottom the box's BOTTOM edge hit something(landed on a floor)

import { TILE } from '../core/constants.js';

// One-way platforms accept a landing when the previous bottom was at or above
// the tile top; this much slack absorbs sub-pixel drift from other systems.
export const ONEWAY_SLACK = 0.0625;

// Sub-pixel downward probe used to keep `grounded` stable when a caller has
// already zeroed vy while resting on a floor.
export const GROUND_PROBE = 0.25;

// Longest distance resolved in one pass. Half a tile guarantees a box can never
// pass through a 16px tile without overlapping it at least once.
export const MAX_SUBSTEP = TILE * 0.5;

const NO_OPTS = {};

// ---------------------------------------------------------------------------
// Tile predicates
// ---------------------------------------------------------------------------

// `solid: false` is honoured explicitly so hidden/invisible blocks can opt out;
// breakable and question blocks are solid even if the table omits the flag.
export function tileSolid(t) {
  if (!t) return false;
  if (t.solid === true) return true;
  if (t.solid === false) return false;
  return !!(t.breakable || t.question);
}

// One-way: blocks a downward move only. `solid` always wins over `platform`.
export function tilePlatform(t) {
  return !!t && t.platform === true && t.solid !== true;
}

export function tileBreakable(t) {
  return !!t && t.breakable === true;
}

export function tileQuestion(t) {
  return !!t && t.question === true;
}

export function tileClimb(t) {
  return !!t && t.climb === true;
}

export function tileLiquid(t) {
  return !!t && t.liquid === true;
}

// 'lava' | 'pit' | null
export function tileHazard(t) {
  return t && t.harm ? t.harm : null;
}

export function tileBlocksAny(t) {
  return tileSolid(t) || tilePlatform(t);
}

// ---------------------------------------------------------------------------
// Tile lookups
// ---------------------------------------------------------------------------

export function tileAt(world, tx, ty) {
  if (!world || typeof world.tileAt !== 'function') return null;
  return world.tileAt(tx, ty) || null;
}

export function tileAtPoint(world, px, py) {
  return tileAt(world, Math.floor(px / TILE), Math.floor(py / TILE));
}

export function tileXOf(px) {
  return Math.floor(px / TILE);
}

export function tileYOf(py) {
  return Math.floor(py / TILE);
}

// Point query in pixel coordinates. This is what `world.solidAt` should delegate to.
export function solidAt(world, px, py) {
  return tileSolid(tileAtPoint(world, px, py));
}

export function platformAt(world, px, py) {
  return tilePlatform(tileAtPoint(world, px, py));
}

export function hazardAt(world, px, py) {
  return tileHazard(tileAtPoint(world, px, py));
}

export function liquidAt(world, px, py) {
  return tileLiquid(tileAtPoint(world, px, py));
}

export function climbAt(world, px, py) {
  return tileClimb(tileAtPoint(world, px, py));
}

// ---------------------------------------------------------------------------
// AABB -> tile range
// ---------------------------------------------------------------------------

function rangeEnd(a, size, start) {
  const e = Math.ceil((a + size) / TILE) - 1;
  return e < start ? start : e;
}

// Inclusive tile range covered by the AABB. A box touching a tile edge exactly
// does NOT count as overlapping it.
export function tileRange(x, y, w, h, out) {
  const r = out || { tx0: 0, ty0: 0, tx1: 0, ty1: 0 };
  r.tx0 = Math.floor(x / TILE);
  r.ty0 = Math.floor(y / TILE);
  r.tx1 = rangeEnd(x, w, r.tx0);
  r.ty1 = rangeEnd(y, h, r.ty0);
  return r;
}

// Iterate every tile an AABB overlaps, row by row, left to right.
// Yields { tx, ty, tile, px, py } where px,py is the tile's top-left in pixels.
export function* aabbTiles(world, x, y, w, h) {
  const tx0 = Math.floor(x / TILE);
  const ty0 = Math.floor(y / TILE);
  const tx1 = rangeEnd(x, w, tx0);
  const ty1 = rangeEnd(y, h, ty0);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      yield { tx, ty, tile: tileAt(world, tx, ty), px: tx * TILE, py: ty * TILE };
    }
  }
}

// Allocation-free variant. `fn(tx, ty, tile)` — return true to stop early.
export function forEachTile(world, x, y, w, h, fn) {
  const tx0 = Math.floor(x / TILE);
  const ty0 = Math.floor(y / TILE);
  const tx1 = rangeEnd(x, w, tx0);
  const ty1 = rangeEnd(y, h, ty0);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (fn(tx, ty, tileAt(world, tx, ty)) === true) return true;
    }
  }
  return false;
}

export function anySolidIn(world, x, y, w, h) {
  return forEachTile(world, x, y, w, h, (tx, ty, t) => tileSolid(t));
}

// ---------------------------------------------------------------------------
// Collision result (pooled — see `collide`)
// ---------------------------------------------------------------------------

function makeFace() {
  return { list: [], pool: [] };
}

export function newCollision() {
  return resetCollision({
    hitLeft: false,
    hitRight: false,
    hitTop: false,
    hitBottom: false,
    hitX: false,
    hitY: false,
    dx: 0,
    dy: 0,
    movedX: 0,
    movedY: 0,
    // Representative tile per face: the one nearest the box centre. Use these
    // for block bumps. `null` when that face was not hit.
    left: null,
    right: null,
    top: null,
    bottom: null,
    // Every blocking tile per face: arrays of { tx, ty, tile, px, py }.
    // These alias the pooled lists in `_f` — reset by resetCollision().
    tiles: { left: null, right: null, top: null, bottom: null },
    _f: { left: makeFace(), right: makeFace(), top: makeFace(), bottom: makeFace() },
  });
}

export function resetCollision(r) {
  r.hitLeft = r.hitRight = r.hitTop = r.hitBottom = false;
  r.hitX = r.hitY = false;
  r.dx = r.dy = r.movedX = r.movedY = 0;
  r.left = r.right = r.top = r.bottom = null;
  r._f.left.list.length = 0;
  r._f.right.list.length = 0;
  r._f.top.list.length = 0;
  r._f.bottom.list.length = 0;
  r.tiles.left = r._f.left.list;
  r.tiles.right = r._f.right.list;
  r.tiles.top = r._f.top.list;
  r.tiles.bottom = r._f.bottom.list;
  return r;
}

function record(res, face, tx, ty, tile) {
  const f = res._f[face];
  const n = f.list.length;
  let o = f.pool[n];
  if (!o) {
    o = { tx: 0, ty: 0, tile: null, px: 0, py: 0 };
    f.pool.push(o);
  }
  o.tx = tx;
  o.ty = ty;
  o.tile = tile;
  o.px = tx * TILE;
  o.py = ty * TILE;
  f.list.push(o);
}

// The tile the box centre sits inside wins — that is the block SMB bumps when
// Mario's head is under two of them. Otherwise the closest one.
function nearestByX(list, cx) {
  const own = Math.floor(cx / TILE);
  let best = null;
  let bd = Infinity;
  for (let i = 0; i < list.length; i++) {
    if (list[i].tx === own) return list[i];
    const d = Math.abs(list[i].px + TILE * 0.5 - cx);
    if (d < bd) {
      bd = d;
      best = list[i];
    }
  }
  return best;
}

function nearestByY(list, cy) {
  let best = null;
  let bd = Infinity;
  for (let i = 0; i < list.length; i++) {
    const d = Math.abs(list[i].py + TILE * 0.5 - cy);
    if (d < bd) {
      bd = d;
      best = list[i];
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Axis resolution
// ---------------------------------------------------------------------------

function scanColumn(world, res, face, c, ty0, ty1) {
  let hit = false;
  for (let ty = ty0; ty <= ty1; ty++) {
    const t = tileAt(world, c, ty);
    if (tileSolid(t)) {
      record(res, face, c, ty, t);
      hit = true;
    }
  }
  return hit;
}

function scanRowUp(world, res, r, tx0, tx1) {
  let hit = false;
  for (let tx = tx0; tx <= tx1; tx++) {
    const t = tileAt(world, tx, r);
    if (tileSolid(t)) {
      record(res, 'top', tx, r, t);
      hit = true;
    }
  }
  return hit;
}

function scanRowDown(world, res, r, tx0, tx1, prevBottom, oneWay) {
  const top = r * TILE;
  let hit = false;
  for (let tx = tx0; tx <= tx1; tx++) {
    const t = tileAt(world, tx, r);
    if (tileSolid(t)) {
      record(res, 'bottom', tx, r, t);
      hit = true;
    } else if (oneWay && tilePlatform(t) && prevBottom <= top + ONEWAY_SLACK) {
      record(res, 'bottom', tx, r, t);
      hit = true;
    }
  }
  return hit;
}

// Moves `box.x` by dx and pushes it back out of the first blocking column.
function resolveX(world, box, dx, opts, res) {
  const x0 = box.x;
  const w = box.w;
  let x1 = x0 + dx;
  // SMB samples the player's sides 8px above the feet (BlockBuffer_Y_Adder $08/$18
  // against the $20 foot adder), so a body dipping a few pixels below a floor never
  // catches on the ledge face. opts.footSkip reproduces that: the bottom `footSkip`
  // pixels of the box take no part in horizontal collision.
  const skip = opts.footSkip > 0 && box.h > opts.footSkip ? opts.footSkip : 0;
  const ty0 = Math.floor(box.y / TILE);
  const ty1 = rangeEnd(box.y, box.h - skip, ty0);

  // SMB's ImpedePlayerMove (smbdis.asm:12318-12351) does not merely stop the
  // player on a side collision: it nullifies his X speed AND MOVES HIM ONE PIXEL
  // AWAY from the wall he is pressed into (`lda #$ff` for a wall on the right,
  // `lda #$01` for one on the left, then `adc Player_X_Position`). Repeated every
  // frame the collision persists, that continuously extrudes a body which has
  // ended up INSIDE a solid — grown to big inside a one-tile pocket, arrived from
  // a warp, pushed by a lift — back out of it. The clamps below deliberately
  // never yank an overlapping box backwards, so on their own they leave such a
  // body exactly where it is, forever: the wedge the user hit in 3-1b's pyramid.
  //
  // Only when the clamp could not separate the box: the clamp target `s` lies
  // BEHIND where the box already is, which happens only when it starts overlapping
  // the column. `s === x0` is an ordinary wall hit landing exactly flush and must
  // keep its exact stop, or every wall in the game turns spongy — so the test is
  // strict.
  //
  // ImpedePlayerMove's two early exits ("if the player's speed is already
  // directed AWAY from the wall, do nothing and let him leave") need no code
  // here: a rightward sweep only ever scans columns to the RIGHT, so hitRight
  // cannot be raised by a body moving left, and vice versa.
  //
  // Player-only, via opts.ejectX. ImpedePlayerMove is player-only in the ROM and
  // enemies must keep the plain clamp.
  const eject = opts.ejectX > 0 ? opts.ejectX : 0;

  if (dx > 0) {
    const c0 = Math.floor((x0 + w) / TILE);
    const c1 = rangeEnd(x1, w, c0);
    for (let c = c0; c <= c1; c++) {
      if (scanColumn(world, res, 'right', c, ty0, ty1)) {
        // max() so a box that starts overlapping is never yanked backwards.
        const s = c * TILE - w;
        x1 = s > x0 ? s : x0;
        if (eject && s < x0) x1 = x0 - eject;
        res.hitRight = true;
        break;
      }
    }
  } else {
    const c0 = Math.ceil(x0 / TILE) - 1;
    const c1 = Math.floor(x1 / TILE);
    for (let c = c0; c >= c1; c--) {
      if (scanColumn(world, res, 'left', c, ty0, ty1)) {
        const s = (c + 1) * TILE;
        x1 = s < x0 ? s : x0;
        if (eject && s > x0) x1 = x0 + eject;
        res.hitLeft = true;
        break;
      }
    }
  }
  box.x = x1;
}

// Moves `box.y` by dy and pushes it back out of the first blocking row.
// One-way platforms only block a downward move whose previous bottom was at or
// above the tile top.
function resolveY(world, box, dy, opts, res) {
  const y0 = box.y;
  const h = box.h;
  let y1 = y0 + dy;
  const tx0 = Math.floor(box.x / TILE);
  const tx1 = rangeEnd(box.x, box.w, tx0);

  if (dy > 0) {
    const oneWay = !opts.dropThrough && !opts.ignorePlatforms;
    const prevBottom = y0 + h;
    const r0 = Math.floor(prevBottom / TILE);
    const r1 = rangeEnd(y1, h, r0);
    for (let r = r0; r <= r1; r++) {
      if (scanRowDown(world, res, r, tx0, tx1, prevBottom, oneWay)) {
        const s = r * TILE - h;
        y1 = s > y0 ? s : y0;
        res.hitBottom = true;
        break;
      }
    }
  } else {
    const r0 = Math.ceil(y0 / TILE) - 1;
    const r1 = Math.floor(y1 / TILE);
    for (let r = r0; r >= r1; r--) {
      if (scanRowUp(world, res, r, tx0, tx1)) {
        const s = (r + 1) * TILE;
        y1 = s < y0 ? s : y0;
        res.hitTop = true;
        break;
      }
    }
  }
  box.y = y1;
}

function clampWalls(box, opts, res) {
  if (opts.minX != null && box.x < opts.minX) {
    box.x = opts.minX;
    res.hitLeft = true;
  }
  if (opts.maxX != null && box.x + box.w > opts.maxX) {
    box.x = opts.maxX - box.w;
    res.hitRight = true;
  }
}

// ---------------------------------------------------------------------------
// Public sweep
// ---------------------------------------------------------------------------

let SCRATCH = null;

// Row index of the first floor within `dist` px below the box, or -1.
// Honours one-way platforms. Floor tiles are recorded on `res.bottom`.
export function probeGround(world, box, dist = GROUND_PROBE, opts = NO_OPTS, res = null) {
  const bottom = box.y + box.h;
  const tx0 = Math.floor(box.x / TILE);
  const tx1 = rangeEnd(box.x, box.w, tx0);
  const r0 = Math.floor(bottom / TILE);
  const r1 = Math.floor((bottom + dist) / TILE);
  const oneWay = !opts.dropThrough && !opts.ignorePlatforms;
  let sink = res;
  if (!sink) sink = SCRATCH ? resetCollision(SCRATCH) : (SCRATCH = newCollision());
  for (let r = r0; r <= r1; r++) {
    if (scanRowDown(world, sink, r, tx0, tx1, bottom, oneWay)) return r;
  }
  return -1;
}

// Is there floor within `dist` px below the box? Honours one-way platforms.
export function isOnGround(world, box, opts = NO_OPTS, dist = GROUND_PROBE, res = null) {
  return probeGround(world, box, dist, opts, res) >= 0;
}

// Floor tile directly under the box's centre, or null.
export function groundTile(world, box, dist = 1) {
  return tileAtPoint(world, box.x + box.w * 0.5, box.y + box.h + dist);
}

// True when there is floor just past the leading edge — red Koopas and any
// enemy that must turn at a ledge use this.
export function hasGroundAhead(world, box, dir, look = 2, depth = 1) {
  const px = dir >= 0 ? box.x + box.w + look : box.x - look;
  const t = tileAtPoint(world, px, box.y + box.h + depth);
  return tileSolid(t) || tilePlatform(t);
}

// True when a solid tile is immediately in front of the box.
export function wallAhead(world, box, dir, look = 1) {
  const px = dir >= 0 ? box.x + box.w + look : box.x - look;
  const ty0 = Math.floor(box.y / TILE);
  const ty1 = rangeEnd(box.y, box.h, ty0);
  const tx = Math.floor(px / TILE);
  for (let ty = ty0; ty <= ty1; ty++) {
    if (tileSolid(tileAt(world, tx, ty))) return true;
  }
  return false;
}

// Sweep `box` by (dx, dy) against the tilemap and resolve penetration.
// X is moved and resolved first, then Y — SMB's ordering. Long moves are split
// into <= half-tile sub-steps so nothing ever tunnels.
//
// opts:
//   dropThrough      : bool   ignore one-way platforms this frame (press-down)
//   ignorePlatforms  : bool   same, permanently for this entity
//   noclip           : bool   integrate position, no tile tests
//   groundProbe      : number probe distance for `hitBottom` when already resting
//                             (0 disables)
//   minX, maxX       : number hard pixel walls (camera-left wall, level edges)
//   maxStep          : number sub-step length override
//   footSkip         : number bottom pixels of the box excluded from the X sweep
//   ejectX           : number pixels to push the box out of a solid it is ALREADY
//                             inside when a side collision cannot separate it
//                             (SMB's ImpedePlayerMove — player only, see resolveX)
//
// `out` lets callers recycle a result object. The returned object is the same
// one — copy anything you need to keep past the next call.
export function collide(world, box, dx, dy, opts = NO_OPTS, out = null) {
  const res = out ? resetCollision(out) : newCollision();
  res.dx = dx;
  res.dy = dy;
  const x0 = box.x;
  const y0 = box.y;

  if (opts.noclip) {
    box.x = x0 + dx;
    box.y = y0 + dy;
    res.movedX = dx;
    res.movedY = dy;
    return res;
  }

  const far = Math.max(Math.abs(dx), Math.abs(dy));
  const step = opts.maxStep || MAX_SUBSTEP;
  const n = far > step ? Math.ceil(far / step) : 1;
  let rx = dx / n;
  let ry = dy / n;

  for (let i = 0; i < n; i++) {
    if (rx !== 0) resolveX(world, box, rx, opts, res);
    clampWalls(box, opts, res);
    if (res.hitLeft || res.hitRight) rx = 0;
    if (ry !== 0) resolveY(world, box, ry, opts, res);
    if (res.hitTop || res.hitBottom) ry = 0;
    if (rx === 0 && ry === 0) break;
  }

  // Resting contact: a caller that already zeroed vy would otherwise lose
  // `grounded` every other frame. Snap the last sub-pixel down onto the floor
  // so the box never hovers.
  if (!res.hitBottom && dy >= 0) {
    const probe = opts.groundProbe == null ? GROUND_PROBE : opts.groundProbe;
    if (probe > 0) {
      const r = probeGround(world, box, probe, opts, res);
      if (r >= 0) {
        res.hitBottom = true;
        const snap = r * TILE - box.h;
        if (snap > box.y) box.y = snap;
      }
    }
  }

  res.hitX = res.hitLeft || res.hitRight;
  res.hitY = res.hitTop || res.hitBottom;
  res.movedX = box.x - x0;
  res.movedY = box.y - y0;

  const cx = box.x + box.w * 0.5;
  const cy = box.y + box.h * 0.5;
  if (res.hitLeft) res.left = nearestByY(res.tiles.left, cy);
  if (res.hitRight) res.right = nearestByY(res.tiles.right, cy);
  if (res.hitTop) res.top = nearestByX(res.tiles.top, cx);
  if (res.hitBottom) res.bottom = nearestByX(res.tiles.bottom, cx);

  return res;
}

// Non-mutating variant: returns { x, y, col } without touching the caller's box.
export function sweep(world, box, dx, dy, opts = NO_OPTS) {
  const tmp = { x: box.x, y: box.y, w: box.w, h: box.h };
  const col = collide(world, tmp, dx, dy, opts, null);
  return { x: tmp.x, y: tmp.y, col };
}

// AABB overlap between two boxes.
export function boxesOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export default collide;
