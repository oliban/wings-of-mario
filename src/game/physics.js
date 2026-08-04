// Super Mario Bros. physics — the authoritative feel of the game lives in this file.
//
// The NES original stores position and velocity as 16.16-ish fixed point subpixels and runs
// its game logic at 60.0988 Hz. Every number below is that hardware value converted to
// PIXELS PER FRAME (or pixels per frame squared). Nothing here is ever scaled by dt: one
// call == one 1/60.0988 s tick. Multiplying by dt anywhere downstream breaks the feel.
//
// This module is PURE: no DOM, no globals, no randomness, no imports beyond constants.js.
// It is unit-testable directly under node.

import { TILE } from '../core/constants.js';

function deepFreeze(o) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object') deepFreeze(v);
  }
  return Object.freeze(o);
}

// ---------------------------------------------------------------------------
// Jump table.
//
// The initial velocity AND both gravities are selected from the horizontal speed at the
// instant of takeoff. This is the reason a running jump in Mario goes *higher* and not
// merely further, and it is the single most-often-missed detail in Mario clones.
//
//   gHold  applies while ASCENDING and the jump button is still held.
//   gFall  applies the moment the button is released, or the moment vy turns positive.
//
// `at` is the inclusive lower bound of |vx| for that row.
//
// The original indexes ONE table set by Player_XSpeedAbsolute against four
// thresholds (smbdis.asm:6095-6107) — `cmp #$09 / #$10 / #$19 / #$1c`, each
// `bcc` skipping the `iny` — giving five rows, read out of JumpMForceData,
// FallMForceData and PlayerYSpdData at asm:6014-6021:
//
//   Y   speed >=        vy0        gHold        gFall
//   0   $00  0.0        $fc  -4    $20  0.125   $70  0.4375
//   1   $09  0.5625     $fc  -4    $20  0.125   $70  0.4375
//   2   $10  1.0        $fc  -4    $1e  0.1171875  $60  0.375
//   3   $19  1.5625     $fb  -5    $28  0.15625 $90  0.5625
//   4   $1c  1.75       $fb  -5    $28  0.15625 $90  0.5625
//
// Rows 0/1 and 3/4 carry identical data, so three rows reproduce all five
// exactly. Speeds are the ROM's byte over 16, the same scaling maxWalkSpeed
// ($19) and maxRunSpeed ($29) already use.
//
// The third threshold is $19 = 1.5625, NOT the 2.3125 this table carried for
// most of the project's life. $19 is exactly maxWalkSpeed, so in the original
// the taller -5 jump is available from full WALKING speed upward; ours withheld
// it until 2.3125, which is only reachable with the run button held and near
// top speed. The whole band from a full walk to 2.3125 was taking off on the
// short row. Neither calibrated jump moves: a standing jump is row 0 at vx 0,
// and a full-speed run jump is 2.5625, already above both thresholds.
const JUMP_ROWS = [
  { at: 0.0, vy0: -4.0, gHold: 0.125, gFall: 0.4375 },
  { at: 1.0, vy0: -4.0, gHold: 0.1171875, gFall: 0.375 },
  { at: 1.5625, vy0: -5.0, gHold: 0.15625, gFall: 0.5625 },
];

export const JUMP_TABLE = deepFreeze(JUMP_ROWS.map((r) => ({ ...r })));

export const PHYS = deepFreeze({
  // ---- horizontal, on the ground -----------------------------------------
  minWalkSpeed: 0.07421875, // 0x13 subpixels (19/256): a fresh walk input snaps off 0 to here
  maxWalkSpeed: 1.5625,
  maxRunSpeed: 2.5625,
  maxUnderwaterSpeed: 1.125,
  walkAccel: 0.0369873046875,
  runAccel: 0.0555419921875,
  releaseDecel: 0.0498046875, // friction, no direction held, on ground
  skidDecel: 0.1015625, // holding the opposite direction, on ground
  skidTurnaround: 0.5625, // |vx| below this while skidding flips the facing

  // ---- vertical ------------------------------------------------------------
  jumpTable: JUMP_ROWS.map((r) => ({ ...r })),
  maxFallSpeed: 4.5,
  // Gravity for a body that left the ground without jumping (walked off a ledge) and for
  // anything that just needs "the normal falling rate". Matches the slow-speed gFall row.
  fallGravity: 0.4375,
  gravity: 0.4375,

  // ---- underwater ----------------------------------------------------------
  strokeVelocity: -1.5, // each swim-button press
  strokeVelocityAtTop: -1.0, // weaker when already near the surface
  waterGravity: 0.09375,
  waterMaxFallSpeed: 2.0,
  waterSurfaceBand: 16, // px below the surface plane that counts as "at the top"
  water: {
    strokeVelocity: -1.5,
    strokeVelocityAtTop: -1.0,
    gravity: 0.09375,
    maxFallSpeed: 2.0,
    maxSpeed: 1.125,
    surfaceBand: 16,
  },

  // ---- entities ------------------------------------------------------------
  enemyWalkSpeed: 0.5, // goomba, koopa
  enemyGravity: 0.1875,
  enemyMaxFall: 3.0,
  shellSpeed: 3.0,
  stompBounce: -4.0, // jump button held during the stomp
  stompBounceWeak: -2.5, // jump button not held
  fireballSpeed: 3.0,
  fireballGravity: 0.28125,
  fireballBounce: -2.5,
  playerDeathRise: -4.5, // then normal gravity, collision disabled

  enemy: {
    walkSpeed: 0.5,
    gravity: 0.1875,
    maxFall: 3.0,
    shellSpeed: 3.0,
  },
  fireball: {
    speed: 3.0,
    gravity: 0.28125,
    bounce: -2.5,
    maxFall: 4.5,
  },
});

export default PHYS;

// ---------------------------------------------------------------------------
// Scalar utilities
// ---------------------------------------------------------------------------

export function sign(v) {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Clamp a signed velocity to +/- |max|. */
export function clampSpeed(vx, max) {
  const m = max < 0 ? -max : max;
  if (vx > m) return m;
  if (vx < -m) return -m;
  return vx;
}

/**
 * Move `current` toward `target` by at most `rate`, never overshooting.
 * The workhorse for every acceleration and friction step in the game.
 */
export function approach(current, target, rate) {
  const r = rate < 0 ? -rate : rate;
  if (current < target) {
    const n = current + r;
    return n > target ? target : n;
  }
  if (current > target) {
    const n = current - r;
    return n < target ? target : n;
  }
  return target;
}

// ---------------------------------------------------------------------------
// Vertical
// ---------------------------------------------------------------------------

/**
 * One tick of gravity on any body with a `vy` field. Mutates and returns the new vy.
 * Callers integrate position separately (velocity first, then position — semi-implicit).
 */
export function applyGravity(ent, gravity = PHYS.fallGravity, maxFall = PHYS.maxFallSpeed) {
  let vy = ent.vy + gravity;
  if (vy > maxFall) vy = maxFall;
  ent.vy = vy;
  return vy;
}

/**
 * Pick the launch velocity and the two gravities for a jump taken at horizontal `speed`.
 * Returns a fresh mutable object: { vy0, gHold, gFall }. Store it on the player for the
 * duration of the jump — the row must NOT be re-evaluated mid-air.
 */
export function jumpVelocityFor(speed) {
  const s = speed < 0 ? -speed : speed;
  let row = JUMP_ROWS[0];
  for (let i = JUMP_ROWS.length - 1; i >= 0; i--) {
    if (s >= JUMP_ROWS[i].at) {
      row = JUMP_ROWS[i];
      break;
    }
  }
  return { vy0: row.vy0, gHold: row.gHold, gFall: row.gFall };
}

/**
 * Which of the two jump gravities applies this tick.
 * `vy` is the velocity BEFORE this tick's gravity. `holdingJump` must be latched false by
 * the caller on the first release and never re-latched true for the same jump — in the
 * original, re-pressing mid-air does not restore the floaty ascent.
 */
export function jumpGravityFor(vy, holdingJump, jump) {
  return vy < 0 && holdingJump ? jump.gHold : jump.gFall;
}

/** Begin a jump: selects the table row from `speed`, sets vy, returns the row. */
export function beginJump(ent, speed = ent.vx) {
  const j = jumpVelocityFor(speed);
  ent.vy = j.vy0;
  ent.grounded = false;
  return j;
}

/** One airborne tick using a jump row from `jumpVelocityFor`. Mutates and returns vy. */
export function stepJump(ent, holdingJump, jump, maxFall = PHYS.maxFallSpeed) {
  return applyGravity(ent, jumpGravityFor(ent.vy, holdingJump, jump), maxFall);
}

/** Bounce velocity after stomping an enemy — held jump gives the big hop. */
export function stompBounceFor(holdingJump) {
  return holdingJump ? PHYS.stompBounce : PHYS.stompBounceWeak;
}

// ---------------------------------------------------------------------------
// Horizontal
// ---------------------------------------------------------------------------

/** Top horizontal speed for the current state. */
export function maxSpeedFor(running, underwater = false) {
  if (underwater) return PHYS.maxUnderwaterSpeed;
  return running ? PHYS.maxRunSpeed : PHYS.maxWalkSpeed;
}

/**
 * Horizontal acceleration for this tick.
 *
 * On the ground it is simply run-vs-walk from the run button.
 *
 * In the air it is the authentic quirk: the run acceleration applies whenever the body
 * reached the walk cap at any point during the jump, whether or not the run button is
 * still held. Pass the latched peak |vx| of the current airtime as `speed` (see
 * `stepHorizontal`, which maintains `ent.airSpeed` for you).
 */
export function horizontalAccelFor(speed, running, airborne) {
  const s = speed < 0 ? -speed : speed;
  if (airborne) return s >= PHYS.maxWalkSpeed ? PHYS.runAccel : PHYS.walkAccel;
  return running ? PHYS.runAccel : PHYS.walkAccel;
}

/** Ground friction rate for the current input: skid when opposing, release when neutral. */
export function groundDecelFor(vx, dir) {
  const s = sign(vx);
  if (dir !== 0 && s !== 0 && s !== sign(dir)) return PHYS.skidDecel;
  return PHYS.releaseDecel;
}

/** True when the body is on the ground moving one way with the other way held. */
export function isSkidding(vx, dir, grounded = true) {
  if (!grounded || dir === 0) return false;
  const s = sign(vx);
  return s !== 0 && s !== sign(dir) && Math.abs(vx) >= PHYS.skidTurnaround;
}

/**
 * Full authentic horizontal integration for one tick. Optional sugar over the primitives
 * above — player.js may use it or roll its own from `approach`/`horizontalAccelFor`.
 *
 * Reads and writes on `ent`:
 *   vx        (required)  signed horizontal velocity
 *   grounded  (read)      overridable via opts.grounded
 *   facing    (written)   1 | -1
 *   skidding  (written)   bool, for the skid animation and the dust puff
 *   airSpeed  (managed)   latched peak |vx| for the airborne acceleration rule
 *
 * `dir` is -1, 0 or 1 (the d-pad). `opts`: { running, underwater, grounded }.
 * Returns the new vx.
 */
export function stepHorizontal(ent, dir, opts = {}) {
  const running = !!opts.running;
  const underwater = !!opts.underwater;
  const grounded = opts.grounded === undefined ? !!ent.grounded : !!opts.grounded;

  let vx = ent.vx || 0;
  const d = sign(dir);
  const maxSpeed = maxSpeedFor(running, underwater);
  const absVx = vx < 0 ? -vx : vx;

  if (grounded) ent.airSpeed = absVx;
  else if (!(ent.airSpeed >= absVx)) ent.airSpeed = absVx;

  const accel = horizontalAccelFor(grounded ? vx : ent.airSpeed, running, !grounded);
  const s = sign(vx);

  if (d !== 0) {
    if (grounded && s !== 0 && s !== d) {
      // Skid: heavy ground friction, facing flips only once the body has nearly stopped
      // so the turnaround reads as a slide rather than a snap.
      vx = approach(vx, 0, PHYS.skidDecel);
      const skidding = (vx < 0 ? -vx : vx) >= PHYS.skidTurnaround;
      ent.skidding = skidding;
      if (!skidding) ent.facing = d;
    } else {
      ent.skidding = false;
      ent.facing = d;
      if (absVx > maxSpeed && s === d) {
        // Over the cap (run button just released, or entered water at speed):
        // bleed down with ground friction, but never in mid-air.
        if (grounded) vx = approach(vx, maxSpeed * d, PHYS.releaseDecel);
        else if (underwater) vx = approach(vx, maxSpeed * d, accel);
      } else {
        if (grounded && absVx < PHYS.minWalkSpeed) vx = PHYS.minWalkSpeed * d;
        vx = approach(vx, maxSpeed * d, accel);
      }
    }
  } else {
    ent.skidding = false;
    // No friction in the air — momentum is preserved for the whole jump arc.
    if (grounded) vx = approach(vx, 0, PHYS.releaseDecel);
    else if (underwater && absVx > maxSpeed) vx = approach(vx, maxSpeed * s, accel);
  }

  if (vx !== 0 && (vx < 0 ? -vx : vx) < 1e-6) vx = 0;
  ent.vx = vx;
  if (!grounded && !(ent.airSpeed >= (vx < 0 ? -vx : vx))) ent.airSpeed = vx < 0 ? -vx : vx;
  return vx;
}

// ---------------------------------------------------------------------------
// Underwater
// ---------------------------------------------------------------------------

/** Swim stroke impulse; weaker when already near the surface so Mario cannot breach. */
export function strokeVelocityFor(nearSurface) {
  return nearSurface ? PHYS.strokeVelocityAtTop : PHYS.strokeVelocity;
}

/** Apply one swim stroke. Sets (does not add to) vy, as the original does. */
export function swimStroke(ent, nearSurface = false) {
  ent.vy = strokeVelocityFor(nearSurface);
  ent.grounded = false;
  return ent.vy;
}

/** One tick of water gravity. */
export function applyWaterGravity(ent) {
  return applyGravity(ent, PHYS.waterGravity, PHYS.waterMaxFallSpeed);
}

/** True when `y` (hitbox top, world px) is inside the weak-stroke band under `surfaceY`. */
export function nearWaterSurface(y, surfaceY, band = PHYS.waterSurfaceBand) {
  return y - surfaceY < band;
}

// ---------------------------------------------------------------------------
// Entity convenience steps
// ---------------------------------------------------------------------------

/** One tick of gravity for a walking enemy (goomba, koopa, shell). */
export function applyEnemyGravity(ent) {
  return applyGravity(ent, PHYS.enemyGravity, PHYS.enemyMaxFall);
}

/** One tick of gravity for a fireball. */
export function applyFireballGravity(ent) {
  return applyGravity(ent, PHYS.fireballGravity, PHYS.fireball.maxFall);
}

// ---------------------------------------------------------------------------
// Pure diagnostics — used by tuning tools and the debug API. No side effects.
// ---------------------------------------------------------------------------

/**
 * Simulate a jump taken at horizontal `speed`, holding the button for `holdFrames` ticks
 * after takeoff, until the body returns to its takeoff height.
 * Returns { apexPx, apexTiles, riseFrames, airFrames, distancePx, distanceTiles }.
 */
export function simulateJump(speed, holdFrames = Infinity, maxFall = PHYS.maxFallSpeed) {
  const j = jumpVelocityFor(speed);
  const vx = speed < 0 ? -speed : speed;
  let y = 0;
  let vy = j.vy0;
  let apex = 0;
  let riseFrames = 0;
  let f = 0;
  while (f < 6000) {
    f++;
    vy += jumpGravityFor(vy, f <= holdFrames, j);
    if (vy > maxFall) vy = maxFall;
    y += vy;
    if (y < apex) {
      apex = y;
      riseFrames = f;
    }
    if (y >= 0) break;
  }
  return {
    apexPx: -apex,
    apexTiles: -apex / TILE,
    riseFrames,
    airFrames: f,
    distancePx: vx * f,
    distanceTiles: (vx * f) / TILE,
  };
}

/** Frames to go from `vy0` to terminal velocity under a constant gravity. */
export function framesToTerminal(gravity = PHYS.fallGravity, maxFall = PHYS.maxFallSpeed, vy0 = 0) {
  let vy = vy0;
  let f = 0;
  while (vy < maxFall && f < 6000) {
    vy += gravity;
    f++;
  }
  return f;
}
