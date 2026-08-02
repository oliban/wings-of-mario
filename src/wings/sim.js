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
      // The stall turn, for the renderer to drive its roll from directly
      // rather than inferring a manoeuvre from angle changes on its own.
      // turning: is one in progress. turnProgress: 0..1 through it (0 outside
      // one). turnDir: +1/-1, the sign of the angle sweep (matches turnDelta
      // in flight.js) while turning, 0 otherwise.
      turning: p.turnTicks != null,
      turnProgress: p.turnTicks != null ? p.turnTicks / FLIGHT.STALL_TURN_TICKS : 0,
      turnDir: p.turnTicks != null ? Math.sign(p.turnDelta) : 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Steering, used by __WINGS and (eventually) the bots.
//
// There was a `seek()` here for a bot autopilot to steer toward a point. It
// is deleted rather than kept patched: nothing calls it, it had no test of
// its own, and it has now silently gone stale across two unrelated control
// reworks (the pull-back/upright pass, then this one) without anyone
// noticing until asked directly — an unwired helper encoding a convention
// nobody is checking is exactly the trap it turned into. Whoever wires up
// bot steering should write it fresh, against whatever flight.js actually
// does at that point, with a test that catches the NEXT rework too.
// ---------------------------------------------------------------------------

export function distanceTo(p, tx, ty) {
  const dx = tx - (p.x + PLANE_W / 2);
  const dy = ty - (p.y + PLANE_H / 2);
  return Math.hypot(dx, dy);
}
