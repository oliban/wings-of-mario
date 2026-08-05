// IS MARIO WALKING INTO A CHASM HE CANNOT JUMP — and is it a chasm the bomber
// dug, or one the level shipped with?
//
// Pure, and in its own file, for the reason src/net/presence.js and
// src/net/match-events.js are: it decides something the game behaves on, and
// everything that can answer it in the running game (the world, the tile map,
// the player) drags in the DOM and cannot be loaded outside a browser. The rule
// is worth being able to test for what it is. src/wings/parcel.js is the half
// that knows about a World; this half knows about geometry and physics.
//
// THE ONLY THING IT IMPORTS is src/game/physics.js, and that is the point. The
// question "can he jump that" has exactly one correct answer and the engine
// already holds it: the jump table, the two gravities, the run acceleration and
// the top speed. A tile count guessed here would be a second, wrong copy of the
// game's feel that drifts the first time anybody tunes the real one. physics.js
// is pure by its own contract — no DOM, no globals, no randomness, nothing but
// core/constants.js — so importing it costs the tests nothing.
//
// A GRID, here, is `{ w, h, solid(tx, ty) }`. Both maps Mario is measured
// against have that shape: the live one the bombs have been chewing on, and the
// pristine one the level shipped with. Nothing below cares which is which.

import { TILE } from '../core/constants.js';
import { PHYS, jumpVelocityFor, jumpGravityFor } from '../game/physics.js';

// What the parcel holds. Five coins is five brick bombs at
// BRICKBOMB_COST — see src/game/entities/brickbomb.js — so the toolbelt
// arrives with enough in the wallet to lay five five-brick rows, which is the
// only reason the number is five and not any other number.
export const PARCEL_COINS = 5;

// How far ahead of him a chasm has to be before it is his problem. The screen
// is sixteen tiles wide, so ten is comfortably in view and walking toward:
// beyond that he is somewhere else on the map and the drop would arrive with
// no visible cause.
export const APPROACH_TILES = 10;

// Guard rails on the two scans. Nothing legitimate is this large — the widest
// level is ~212 tiles — and both loops are walked every time the check runs.
export const MAX_GAP_TILES = 64;

// How much run-up is worth measuring. A standstill reaches full running speed
// inside four tiles (see runupSpeed), so anything past eight tells us nothing
// new and only costs another eight column scans.
export const RUNUP_CAP_TILES = 8;

// How far above his takeoff row a surface can still be landed on. A full-speed
// jump apexes 77.5px — see simulateJump in physics.js — so four tiles is the
// highest ledge that is a landing at all. It is also what makes a plateau on
// the far side of a pit read as the far side rather than as more pit.
export const MAX_RISE_TILES = 4;

// ---------------------------------------------------------------------------
// Physics, borrowed rather than restated
// ---------------------------------------------------------------------------

/**
 * The horizontal speed a standing start reaches over `runwayPx` of floor, with
 * the run button held. This is the engine's own integration — velocity first,
 * then position, `runAccel` per tick, capped at `maxRunSpeed` — because the
 * length of the shelf he is left standing on decides how hard he can throw
 * himself off it. Bomb away all but one tile of his ground and he does not get
 * a running jump, however much reach the table says a running jump has.
 */
export function runupSpeed(runwayPx) {
  let v = PHYS.minWalkSpeed;
  let x = 0;
  // A guard, not a rule: v reaches the cap in about 45 ticks.
  for (let f = 0; f < 600 && x < runwayPx && v < PHYS.maxRunSpeed; f++) {
    v = Math.min(PHYS.maxRunSpeed, v + PHYS.runAccel);
    x += v;
  }
  return v;
}

/**
 * How far, in pixels, a jump taken at horizontal `speed` carries him before he
 * is back down to `dropPx` below the height he took off from. Negative dropPx
 * is a landing ABOVE the takeoff row; zero is the flat case.
 *
 * The button is held for the whole ascent, which is the most generous jump the
 * table can produce — this number decides whether we hand him a rescue, and the
 * benefit of the doubt has to go to the man doing the jumping. Momentum is
 * preserved for the whole arc (physics.js applies no friction in the air), so
 * one speed times the frame count is the honest distance.
 *
 * Returns 0 when the arc never gets high enough to reach a raised landing at
 * all, which is not a short jump but an impossible one.
 */
export function jumpReachPx(speed, dropPx = 0) {
  const j = jumpVelocityFor(speed);
  let vy = j.vy0;
  let y = 0;
  let last = -1;
  for (let f = 1; f <= 600; f++) {
    vy += jumpGravityFor(vy, true, j);
    if (vy > PHYS.maxFallSpeed) vy = PHYS.maxFallSpeed;
    y += vy;
    if (y <= dropPx) last = f;
    // Past the landing height and still falling: the arc is over, and every
    // frame after this one is spent below the far side's floor.
    else if (vy > 0) break;
  }
  return last < 0 ? 0 : last * speed;
}

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

// The topmost tile in a column that he could put his feet on, searching from
// MAX_RISE_TILES above his own floor row all the way to the bottom of the map.
// null means the column is bottomless: there is nothing in it to land on and
// walking in is a death.
//
// The search starts ABOVE his row on purpose. A pit with a plateau on the far
// side has no floor at his height anywhere along the plateau, and a search that
// began at his own row would read the whole far side as more pit and report a
// chasm that stops at the map edge.
export function landingRow(grid, tx, fromTy) {
  if (tx < 0 || tx >= grid.w) return null;
  const top = Math.max(0, fromTy - MAX_RISE_TILES);
  for (let ty = top; ty < grid.h; ty++) {
    if (grid.solid(tx, ty)) return ty;
  }
  return null;
}

/**
 * The first chasm ahead of a man standing at column `tx` on floor row `ty`,
 * looking the way the level runs — right. Returns null when there is no hole
 * within APPROACH_TILES, which is the usual answer.
 *
 * `land` is null when the hole runs off the end of the map or past
 * MAX_GAP_TILES; there is no far side to measure against and the caller may
 * treat it as unjumpable.
 */
export function gapAhead(grid, tx, ty) {
  if (!grid || typeof grid.solid !== 'function') return null;

  // Where it starts. Only a hole he can WALK to counts: the first bottomless
  // column, with floor all the way from under his feet to its edge.
  let start = -1;
  for (let c = tx + 1; c <= tx + APPROACH_TILES && c < grid.w; c++) {
    if (landingRow(grid, c, ty) == null) {
      start = c;
      break;
    }
  }
  if (start < 0) return null;

  const takeoffTy = landingRow(grid, start - 1, ty);
  // He is not standing on anything at the near lip either — he is already
  // falling, and a parcel is no longer the answer to anything.
  if (takeoffTy == null) return null;

  // Where it ends.
  let land = null;
  let landTy = null;
  for (let c = start; c < start + MAX_GAP_TILES && c < grid.w; c++) {
    const row = landingRow(grid, c, takeoffTy);
    if (row != null) {
      land = c;
      landTy = row;
      break;
    }
  }

  // How much floor he has behind him to build up speed on. Deliberately
  // generous — any column that is not itself a hole counts, walls and steps
  // included — because being generous here means declining to hand out a
  // parcel, and the user's rule is that stranding Mario stays a way to win.
  let runup = 0;
  for (let c = start - 1; c >= 0 && runup < RUNUP_CAP_TILES; c--) {
    if (landingRow(grid, c, takeoffTy) == null) break;
    runup++;
  }

  return {
    start,
    land,
    takeoffTy,
    landTy,
    width: land == null ? Infinity : land - start,
    runupPx: runup * TILE,
  };
}

/**
 * Can he clear it. He takes off from the right edge of the last solid column
 * and has to reach the left edge of the first one on the other side, so the
 * distance to beat is exactly the hole's width in tiles — his own body width is
 * left out of it, which costs him a few pixels he would really have.
 */
export function gapIsJumpable(gap) {
  if (!gap) return true;
  if (gap.land == null) return false;
  const dropPx = (gap.landTy - gap.takeoffTy) * TILE;
  return jumpReachPx(runupSpeed(gap.runupPx), dropPx) >= gap.width * TILE;
}

/**
 * THE DECISION. `current` is the map as the bombs have left it, `original` the
 * one the level shipped with; both are grids, and the second one is what keeps
 * 1-1's own holes from paying out. A hole that was always there and was always
 * too wide is the level being the level. A hole that is too wide TODAY and was
 * not yesterday is the pilot's doing, and that is the only case that earns a
 * parcel.
 *
 * Returns `{ parcel, gap, reason }` always — `reason` is what to put in a log
 * line when the answer is no.
 */
export function strandedBy({ current, original, tx, ty } = {}) {
  const gap = gapAhead(current, tx, ty);
  if (!gap) return { parcel: false, gap: null, reason: 'no-gap' };
  if (gapIsJumpable(gap)) return { parcel: false, gap, reason: 'jumpable' };
  const was = gapAhead(original, tx, ty);
  if (was && !gapIsJumpable(was)) {
    return { parcel: false, gap, reason: 'always-unjumpable' };
  }
  return { parcel: true, gap, reason: 'cratered' };
}

// ---------------------------------------------------------------------------
// Once per chasm
// ---------------------------------------------------------------------------

// A parcel per hole, not a parcel per frame — and not a second parcel when the
// next bomb widens the same hole, which is why this remembers RANGES rather
// than a start column. A blast on the near lip moves `start` a column left
// without making it a different chasm; anything that overlaps ground already
// paid for is the same chasm.
export class GapLedger {
  constructor() {
    this.byPlace = new Map();
  }

  _ranges(place) {
    let list = this.byPlace.get(place);
    if (!list) {
      list = [];
      this.byPlace.set(place, list);
    }
    return list;
  }

  // Has this chasm already been paid for. `end` is exclusive; a hole with no far
  // side is treated as running to the end of the scan.
  paid(place, start, end) {
    const stop = end == null || !Number.isFinite(end) ? start + MAX_GAP_TILES : end;
    for (const r of this._ranges(place)) {
      if (start < r.end && stop > r.start) return true;
    }
    return false;
  }

  // Record it, absorbing any range it touches so a chasm that grows in both
  // directions stays one entry rather than becoming a chain of them.
  record(place, start, end) {
    const stop = end == null || !Number.isFinite(end) ? start + MAX_GAP_TILES : end;
    const list = this._ranges(place);
    let lo = start;
    let hi = stop;
    const kept = [];
    for (const r of list) {
      if (start < r.end && stop > r.start) {
        lo = Math.min(lo, r.start);
        hi = Math.max(hi, r.end);
      } else kept.push(r);
    }
    kept.push({ start: lo, end: hi });
    this.byPlace.set(place, kept);
    return { start: lo, end: hi };
  }

  // A level reloaded is a level whose holes are back where the tile map says
  // they are. Debts against the old one mean nothing.
  forget(place) {
    this.byPlace.delete(place);
  }

  clear() {
    this.byPlace.clear();
  }
}

export default strandedBy;
