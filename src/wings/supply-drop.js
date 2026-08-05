// THE SUPPLY DROP — a crate under a parachute, falling out of the sky.
//
// The user's complaint was exactly this: "the parcel drops on the character so
// I can't even see it". The parcel (src/wings/parcel.js) was arriving as the
// grant itself — five coins and the toolbelt, in one frame, with no object
// anywhere on screen. This is the object.
//
// WHAT THIS FILE IS NOT: it is not the decision to send a parcel (that is
// src/wings/stranded.js) and it is not the handing over of the goods (that is
// Parcel#deliver). It is a position and a phase, counted in TICKS, and nothing
// else. Pure — no DOM, no engine, no art — so the whole flight can be pinned in
// plain Node, which is the only way an animation nobody can screenshot in a
// unit test gets tested at all. The pixels live in src/wings/art/parcel.js and
// are looked at with tools/sheet.mjs; src/wings/mario-main.js is where the two
// meet.
//
// THE CLOCK IS THE ENGINE'S, always: every number below is in fixed 60.0988Hz
// ticks, never milliseconds and never rAF frames. Same rule as the sail fade in
// src/wings/sail.js and for the same reason — the same tick has to produce the
// same frame whether the game is running live, being stepped by a browser test
// or being driven by tools/shot.mjs.
//
// THE GRANT IS COMMITTED BEFORE THE CRATE IS: the parcel decides, records the
// chasm as paid and starts this; the coins and the belt are handed over on the
// LANDING tick. That order is deliberate. An item lying on the ground can be
// walked past, or dropped into the very hole it was sent for, and the ledger
// has already marked that chasm paid — so the crate is a presentation of a
// decision already made, never a pickup that can be missed. See the note on
// cancel(): the only thing that can stop a landing is the level being rebuilt
// underneath it, which also clears the ledger, so the parcel comes again.

import { TILE } from '../core/constants.js';

// How long the fall takes. A shade over a second at 60.0988Hz — the user has to
// SEE it arrive, and anything under about forty ticks reads as a flash rather
// than as a delivery.
export const FALL_TICKS = 62;

// How long the crate then sits there before it fades, and how long the fade
// takes. Long enough to look at, short enough that it is not litter: it has
// already given him everything it holds by then.
export const REST_TICKS = 54;
export const FADE_TICKS = 16;

// How far above the landing point it starts. A full screen and a bit, so it
// enters from ABOVE THE TOP OF THE VIEW however the camera happens to be
// sitting — a crate that pops into existence in mid-air is not a drop.
export const FALL_HEIGHT_PX = 248;

// The share of that height covered before the canopy blooms. A real drop is
// dead weight for a beat and then snaps into a slow descent; that snap is the
// moment the object reads as a parachute rather than as a falling rock.
export const SNAP_AT = 0.18;
export const OPEN_TICKS = 10;

// How far the crate sways under the canopy, in pixels either side. Damped to
// nothing by the landing, or it would touch down somewhere other than where the
// caller was promised.
export const SWAY_PX = 3;

// Where it lands, relative to Mario: this many tiles to the side. Beside him
// rather than on his head — a crate drawn over the sprite is a crate the player
// cannot see, which is the whole bug — and on the side AWAY from the chasm, so
// the one thing it can never do is fall into the hole it was sent to answer.
export const SIDE_TILES = 2;

export const PHASE = {
  FALL: 'fall',
  REST: 'rest',
  FADE: 'fade',
  DONE: 'done',
};

/**
 * How far down the fall is at tick `t`, as 0..1 of FALL_HEIGHT_PX.
 *
 * Two arcs joined at the bloom, and continuous across it by construction: a
 * quadratic accelerating free-fall to SNAP_AT, then a quadratic DECELERATING to
 * a standstill exactly at the landing. The velocity discontinuity at the join
 * is the point — that is the canopy taking the load.
 */
export function fallProgress(t, fall = FALL_TICKS, open = OPEN_TICKS) {
  if (!(t > 0)) return 0;
  if (t >= fall) return 1;
  const u = t / fall;
  const o = Math.min(0.9, Math.max(0.01, open / fall));
  if (u < o) {
    const v = u / o;
    return SNAP_AT * v * v;
  }
  const v = (u - o) / (1 - o);
  return SNAP_AT + (1 - SNAP_AT) * (1 - (1 - v) * (1 - v));
}

/**
 * WHERE TO PUT IT DOWN. `grid` is the `{ w, h, solid(tx, ty) }` shape
 * src/wings/stranded.js works in — the live tile map, so a column a bomb opened
 * a second ago is not a landing site.
 *
 * `tx`/`ty` are Mario's column and the row he is standing ON; `dir` is the way
 * to look, which the caller sets AWAY from the chasm. Prefers SIDE_TILES away
 * and walks back in towards him, so a crate never lands further out than it has
 * to. Falls back to his own column, which is the one place that is certainly
 * solid: on his head is a poor drop, and into the hole is a broken one.
 */
export function dropSpot(grid, { tx, ty, dir = -1, side = SIDE_TILES } = {}) {
  if (!grid || typeof grid.solid !== 'function') return { tx, ty, fallback: true };
  for (let n = side; n >= 1; n--) {
    const c = tx + dir * n;
    if (c < 0 || c >= grid.w) continue;
    // The same lip he is standing on, at his own height: a crate on a ledge one
    // row down is off the edge he is about to jump from, and reads as somewhere
    // else entirely.
    if (grid.solid(c, ty) && !grid.solid(c, ty - 1)) return { tx: c, ty, fallback: false };
  }
  return { tx, ty, fallback: true };
}

// The flight itself. One at a time — a second parcel while one is still in the
// air replaces it rather than stacking, because two crates on screen at once is
// two rescues and there has only ever been one.
export class SupplyDrop {
  constructor(opts = {}) {
    this.fallTicks = opts.fallTicks == null ? FALL_TICKS : opts.fallTicks;
    this.restTicks = opts.restTicks == null ? REST_TICKS : opts.restTicks;
    this.fadeTicks = opts.fadeTicks == null ? FADE_TICKS : opts.fadeTicks;
    this.height = opts.height == null ? FALL_HEIGHT_PX : opts.height;
    this.t = 0;
    this.landX = 0;
    this.landY = 0;
    this.active = false;
    this.landed = false;
  }

  // `landX` is where the crate's CENTRE comes down and `landY` the feet line it
  // comes down ON — both in island-local pixels, the frame Mario's camera works
  // in, so the only thing between here and the screen is the camera offset.
  begin(landX, landY) {
    this.t = 0;
    this.landX = landX;
    this.landY = landY;
    this.active = true;
    this.landed = false;
    return this;
  }

  // Straight from a tile: the top of that tile is the surface it lands on.
  beginAtTile(tx, ty) {
    return this.begin(tx * TILE + TILE / 2, ty * TILE);
  }

  // One fixed timestep. Returns 'landed' on the single tick the crate touches
  // down — edge-triggered, so the caller can hang the grant off it and be sure
  // it happens exactly once — and null on every other tick.
  step() {
    if (!this.active) return null;
    this.t++;
    if (this.t >= this.fallTicks && !this.landed) {
      this.landed = true;
      return 'landed';
    }
    if (this.t >= this.fallTicks + this.restTicks + this.fadeTicks) this.active = false;
    return null;
  }

  // The only way to stop a drop that has not landed. The level being rebuilt
  // underneath it is the one caller: the chasm it was sent for is back where
  // the tile map says it is, and the ledger has been cleared, so the parcel
  // will be decided again from scratch rather than landing into a level that
  // has moved on.
  cancel() {
    const wasFlying = this.active && !this.landed;
    this.active = false;
    this.landed = false;
    this.t = 0;
    return wasFlying;
  }

  // Everything a renderer needs and nothing it has to work out for itself:
  // where the crate's bottom centre is, how far through the canopy's opening we
  // are, and how visible it all should be. Null when there is nothing to draw,
  // which is the usual answer.
  state() {
    if (!this.active) return null;
    const t = this.t;
    const fall = this.fallTicks;
    if (t < fall) {
      const p = fallProgress(t, fall, OPEN_TICKS);
      // Damped to zero by the landing, so it touches down where it was aimed.
      const sway = Math.round(SWAY_PX * Math.sin(t / 9) * (1 - p));
      return {
        phase: PHASE.FALL,
        x: this.landX + sway,
        y: this.landY - this.height * (1 - p),
        // 0 while it is dead weight, 1 once the canopy has taken the load.
        open: Math.min(1, t / OPEN_TICKS),
        t,
        alpha: 1,
      };
    }
    const since = t - fall;
    if (since < this.restTicks) {
      return { phase: PHASE.REST, x: this.landX, y: this.landY, open: 1, t: since, alpha: 1 };
    }
    const fading = since - this.restTicks;
    if (fading < this.fadeTicks) {
      return {
        phase: PHASE.FADE,
        x: this.landX,
        y: this.landY,
        open: 1,
        t: fading,
        // Already fading on the FIRST tick of the fade — an alpha of exactly 1
        // there is a frame that is indistinguishable from the rest phase, and
        // the whole point of this phase is that the crate is visibly going.
        alpha: 1 - (fading + 1) / this.fadeTicks,
      };
    }
    return null;
  }
}

export default SupplyDrop;
