import { SEA_Y, PLANE_W, PLANE_H, cameraFor, worldBounds } from './geo.js';
import { MODE, FLIGHT, createPlane, stepPlane, normalizeAngle } from './flight.js';
import { landingVerdict, hitsHull, arrest, spotOnDeck } from './carrier.js';

export const SQUADRON = 5;

// The whole flight sim, with no canvas anywhere in it: the renderer reads
// this, never the other way round. That keeps every rule in here reachable
// from a plain-Node test.
//
// Tasks 2 and 3 add islands and ordnance to this class. Nothing else changes.
export class WingsSim {
  constructor(opts = {}) {
    this.islands = [];
    this.bounds = worldBounds(this.islands);
    this.squadron = opts.squadron != null ? opts.squadron : SQUADRON;
    this.plane = spotOnDeck(createPlane());
    this.tick = 0;
    this.events = [];
    this.status = 'ready';
    this.lastVerdict = null;
    this.hookArmed = false;
    this.cam = cameraFor(this.plane.x, this.plane.y, this.bounds);
    this.rearm();
  }

  rearm() {
    this.plane.fuel = FLIGHT.FUEL_MAX;
  }

  emit(type, data) {
    this.events.push({ tick: this.tick, type, ...data });
  }

  // One fixed 60.0988Hz step. input: { pitch, throttle, gear }
  step(input = {}) {
    if (this.status === 'over') return this;
    const p = this.plane;
    if (p.mode !== MODE.DOWN) stepPlane(p, input);
    if (p.mode !== MODE.DOWN) this.checkPlane();
    this.cam = cameraFor(p.x + PLANE_W / 2, p.y + PLANE_H / 2, this.bounds);
    this.tick++;
    return this;
  }

  checkPlane() {
    const p = this.plane;
    if (p.mode !== MODE.AIR) return;
    if (p.y + PLANE_H >= SEA_Y) return this.lose('sea');

    const verdict = landingVerdict(p);
    this.lastVerdict = verdict;
    // The hook cannot catch a wire on the way OUT: the plane must have been
    // clear of the deck box once since it left the deck. Without this latch the
    // tick it rotates off the deck counts as a botched landing, because it is
    // still inside the box with the gear just retracted.
    if (!verdict.inBox) {
      this.hookArmed = true;
      if (hitsHull(p)) return this.lose('carrier');
      return;
    }
    if (!this.hookArmed) return;
    if (verdict.ok) return this.land();
    return this.lose(verdict.reason);
  }

  land() {
    arrest(this.plane);
    this.hookArmed = false;
    this.rearm();
    this.status = 'ready';
    this.emit('landed', {});
    return this;
  }

  lose(reason) {
    const p = this.plane;
    p.mode = MODE.DOWN;
    p.speed = 0;
    this.squadron--;
    this.emit('planeLost', { reason, x: p.x, y: p.y });
    this.status = this.squadron > 0 ? 'lost' : 'over';
    return this;
  }

  // Put the next aircraft on the deck. Returns false when the squadron is gone.
  respawn() {
    if (this.squadron <= 0) return false;
    this.plane = spotOnDeck(createPlane());
    this.hookArmed = false;
    this.rearm();
    this.status = 'ready';
    this.emit('sortieStart', { squadron: this.squadron });
    return true;
  }

  state() {
    const p = this.plane;
    return {
      tick: this.tick,
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      angle: p.angle,
      speed: p.speed,
      throttle: p.throttle,
      mode: p.mode,
      gear: p.gear,
      fuel: p.fuel,
      squadron: this.squadron,
      status: this.status,
      cam: { ...this.cam },
    };
  }
}

// ---------------------------------------------------------------------------
// Steering, used by the bots in Task 4 and by __WINGS.
// ---------------------------------------------------------------------------

// Steer toward a world point. Pitch is +1 for nose UP, and angle DECREASES as
// the nose comes up, so the sign flips on the way in.
export function seek(p, tx, ty, opts = {}) {
  const throttle = opts.throttle == null ? 1 : opts.throttle;
  let want = Math.atan2(ty - (p.y + PLANE_H / 2), tx - (p.x + PLANE_W / 2));
  // Never fly the autopilot into the sea while chasing a low target.
  const floor = opts.floor == null ? SEA_Y - 96 : opts.floor;
  if (p.y + PLANE_H > floor && Math.sin(want) > 0) want = 0;
  const d = normalizeAngle(want - p.angle);
  const dead = opts.dead == null ? 0.03 : opts.dead;
  return {
    pitch: d > dead ? -1 : d < -dead ? 1 : 0,
    throttle,
    gear: opts.gear == null ? false : opts.gear,
  };
}

export function distanceTo(p, tx, ty) {
  const dx = tx - (p.x + PLANE_W / 2);
  const dy = ty - (p.y + PLANE_H / 2);
  return Math.hypot(dx, dy);
}
