import { TILE } from '../core/constants.js';
import { stepShot, predictImpact } from './ordnance.js';

// Mario's counterplay, in numbers. Craters are permanent and there is no
// rescue, so the only defence the design gives him is not being there — which
// makes this module gameplay, not polish.
//
// Everything here is ISLAND-LOCAL pixels: the level's top-left corner is
// (0, 0), exactly as Mario's engine sees it. This module never imports geo.js
// and never sees a world coordinate. mario-overlay.js does the conversion once,
// at the seam.
export const TELEGRAPH = {
  // Beyond this many ticks out, a shot is inbound but not yet aimed at
  // anywhere worth drawing. Without it a rocket fired from across the ocean
  // paints a reticle for ten seconds and the instrument means nothing.
  LEAD_TICKS: 240,
  // The reticle is at full spread this far out and a point at the moment of
  // impact. 96 ticks is 1.6 seconds — about a full-height Mario jump plus the
  // time to decide to make it.
  TIGHTEN_TICKS: 96,
  MAX_R: 26,
  MIN_R: 5,
  // How far off Mario's x a bomb has to be for the whistle to be hard over.
  // 320px is a screen and a quarter: a bomb you can hear hard left is a bomb
  // off the side of the screen, which is the point of the pan.
  PAN_RANGE: 320,
  EDGE_MARGIN: 10,
  // Bounded, because a pathological column profile must not spin. Four is one
  // more than any 1-1-shaped terrain has ever needed.
  REFINE_PASSES: 4,
};

// An island band is 15 rows; below its bottom row is the sea.
export const DEFAULT_FLOOR_Y = 15 * TILE;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function mark(hit) {
  return {
    x: hit.x,
    y: hit.y,
    ticks: hit.ticks,
    tx: Math.floor(hit.x / TILE),
    ty: Math.floor(hit.y / TILE),
  };
}

// Where this shot is going to land, refined against real terrain.
//
// `predictImpact` takes ONE ground height, and Mario's ground is not one
// height — a bomb aimed at open ground may in fact land on a staircase, and a
// reticle a tile and a half low is worse than no reticle. So: predict against
// the sea floor, ask the caller what the surface of THAT column is, predict
// again, and stop as soon as two passes agree about the column. The arc is
// integrated by `predictImpact` every time; there is deliberately no second
// integrator in this file, because a telegraph that disagrees with the bomb is
// a lie told with instruments.
//
// `surfaceAt(px)` returns the island-local y of the first blocking surface in
// the column containing `px`, or `floorY` for an open column.
export function refineImpact(shot, surfaceAt, floorY = DEFAULT_FLOOR_Y, maxTicks = 900) {
  let best = predictImpact(shot, floorY, maxTicks);
  if (!best) return null;
  for (let pass = 0; pass < TELEGRAPH.REFINE_PASSES; pass++) {
    const groundY = surfaceAt(best.x);
    // An open column: the sea-floor answer was already the right one.
    if (groundY == null || groundY >= floorY) break;
    const next = predictImpact(shot, groundY, maxTicks);
    // The arc expires before it reaches that surface. Keep the last answer
    // that was reachable rather than reporting nothing.
    if (!next) break;
    best = next;
    if (surfaceAt(next.x) === groundY) break; // converged: same column, same roof
  }
  return mark(best);
}

// Full spread far out, a point on arrival. Linear in ticks, so the shrink rate
// reads as constant and a player can learn to time off it.
export function reticleRadius(ticks) {
  const t = clamp(ticks / TELEGRAPH.TIGHTEN_TICKS, 0, 1);
  return TELEGRAPH.MIN_R + (TELEGRAPH.MAX_R - TELEGRAPH.MIN_R) * t;
}

// -1 hard left, +1 hard right, relative to Mario rather than to the camera:
// the sound is a fact about the world, not about where the view happens to be.
export function panFor(shotX, marioX) {
  return clamp((shotX - marioX) / TELEGRAPH.PAN_RANGE, -1, 1);
}

// A bomb inbound from off camera. `cam` is {x, y, w, h} in island-local
// pixels — Mario's `world.rcam` verbatim. Returns SCREEN coordinates plus the
// angle to point the arrow, or null when the shot is already in shot.
export function edgeArrow(shotX, shotY, cam) {
  if (!cam) return null;
  const inside =
    shotX >= cam.x && shotX < cam.x + cam.w && shotY >= cam.y && shotY < cam.y + cam.h;
  if (inside) return null;
  const m = TELEGRAPH.EDGE_MARGIN;
  const sx = clamp(shotX - cam.x, m, cam.w - m);
  const sy = clamp(shotY - cam.y, m, cam.h - m);
  return { x: sx, y: sy, angle: Math.atan2(shotY - cam.y - sy, shotX - cam.x - sx) };
}

// How far outside the camera a bomb is still worth drawing: half a sprite, so
// it is already sliding into view while the edge arrow is still up. The two
// are otherwise exact complements — edgeArrow() returns null precisely when
// the bomb's centre is inside — and a hard swap on the same pixel makes the
// thing the player is tracking blink out for a frame.
export const BOMB_PAD = 6;

// The falling bomb's own position on Mario's screen, in game pixels, or null
// when it is not worth drawing. Same camera, same island-local input and the
// same clamp arithmetic as edgeArrow, because the bomb and the arrow are two
// halves of one indicator and must never both be missing.
export function bombOnScreen(shotX, shotY, cam, pad = BOMB_PAD) {
  if (!cam) return null;
  const x = shotX - cam.x;
  const y = shotY - cam.y;
  if (x < -pad || x > cam.w + pad || y < -pad || y > cam.h + pad) return null;
  return { x, y };
}

// Every bomb Mario knows about, integrated locally.
//
// He is TOLD a release — position, velocity, kind — and works out the rest
// himself with the pilot's own integrator. He is never told where it lands.
// That is not an optimisation: a client that is told the answer cannot show a
// reticle that tightens honestly, and the moment the arc is simulated locally
// the telegraph is exactly as accurate as the bomb.
export class Telegraph {
  constructor(opts = {}) {
    this.floorY = opts.floorY == null ? DEFAULT_FLOOR_Y : opts.floorY;
    this.surfaceAt = opts.surfaceAt || (() => this.floorY);
    this.shots = new Map();
    this.events = [];
    this._auto = 0;
  }

  // `state` is a release: {kind, x, y, vx, vy} plus an optional id and age.
  add(state) {
    const id = state.id != null ? state.id : `tg${++this._auto}`;
    const shot = {
      id,
      kind: state.kind,
      x: state.x,
      y: state.y,
      vx: state.vx,
      vy: state.vy,
      age: state.age || 0,
      dead: false,
      mark: null,
    };
    shot.mark = refineImpact(shot, this.surfaceAt, this.floorY);
    this.shots.set(id, shot);
    this.events.push({ type: 'inbound', id, kind: shot.kind, pan: null });
    return shot;
  }

  // A snapshot correction from the owner of the bomb. The arc continues from
  // the corrected state; nothing is re-released and no `inbound` is emitted,
  // so the whistle already playing keeps playing.
  sync(id, state) {
    const shot = this.shots.get(id);
    if (!shot) return false;
    shot.x = state.x;
    shot.y = state.y;
    shot.vx = state.vx;
    shot.vy = state.vy;
    if (state.age != null) shot.age = state.age;
    shot.mark = refineImpact(shot, this.surfaceAt, this.floorY);
    return true;
  }

  remove(id) {
    return this.shots.delete(id);
  }

  clear() {
    this.shots.clear();
    this.events.length = 0;
  }

  // One fixed 60.0988Hz step, on Mario's clock.
  step() {
    for (const shot of [...this.shots.values()]) {
      stepShot(shot);
      // Expired in mid-air: no bang, and nothing more to warn about.
      if (shot.dead) {
        this.shots.delete(shot.id);
        this.events.push({ type: 'expired', id: shot.id });
        continue;
      }
      const ground = this.surfaceAt(shot.x);
      const stop = Math.min(ground == null ? this.floorY : ground, this.floorY);
      if (shot.y >= stop) {
        this.shots.delete(shot.id);
        this.events.push({ type: 'impact', id: shot.id, x: shot.x, y: shot.y });
        continue;
      }
      shot.mark = refineImpact(shot, this.surfaceAt, this.floorY);
    }
  }

  // Render-ready, and the only thing the overlay is allowed to read.
  marks(marioX, cam) {
    const out = [];
    for (const shot of this.shots.values()) {
      const m = shot.mark && shot.mark.ticks <= TELEGRAPH.LEAD_TICKS ? shot.mark : null;
      out.push({
        id: shot.id,
        kind: shot.kind,
        x: shot.x,
        y: shot.y,
        vx: shot.vx,
        vy: shot.vy,
        // A falling bomb points along its velocity. Same convention as the
        // pilot's renderer, so the same object is drawn nose-down on both
        // screens at the same instant.
        angle: Math.atan2(shot.vy, shot.vx),
        pan: panFor(shot.x, marioX),
        impact: m,
        radius: m ? reticleRadius(m.ticks) : null,
        arrow: edgeArrow(shot.x, shot.y, cam),
      });
    }
    return out;
  }

  drain() {
    const out = this.events;
    this.events = [];
    return out;
  }
}

export default Telegraph;
