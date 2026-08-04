import { TILE } from '../core/constants.js';
import { PHYS, clampSpeed } from '../game/physics.js';
import { canDamage, stepShot } from './ordnance.js';

// THE PILOT'S GUNFIRE, ON MARIO'S MACHINE.
//
// Spec 7.3: hit resolution follows ownership. A bomb hits Mario on Mario's
// client, against Mario's hitbox; so does a gun round, and for the stronger
// reason. The pilot's client owns the aeroplane and its ordnance; it does not
// own the man on the ground and must never push him around remotely. What
// crosses the wire is the round's RELEASE — see WingsSim#gunTrace — and every
// question after that ("did it reach him", "how hard did it shove him") is
// asked and answered here.
//
// A gun round has gravity 0 and a life of 45 ticks, so re-deriving it from the
// release is exact rather than approximate: the same integrator (stepShot) run
// on the same numbers. The one thing that CANNOT be re-derived is whether the
// round hit something, because the two clients have different pictures — this
// side has Mario, the other side does not — which is exactly why the answer is
// only ever computed on the side that has the target.
//
// This module reads nothing global and holds no canvas: it is handed a player
// and a solidity probe, and is unit-testable straight under node.

// Who Mario is, for ordnance.js#canDamage. A stable id and not an object, the
// same discipline as WingsSim#planeId — so a round the pilot fired is hostile
// to him and a round he somehow fired himself never would be. It matches the
// protocol's side name deliberately: there is one vocabulary for "whose".
export const MARIO_ID = 'mario';

// THE SHOVE. Every number here is px/frame at the fixed 60.0988Hz step, the
// same units as src/game/physics.js, and every one of them is a constant — no
// clock, no RNG, no scaling by dt.
//
// PUSH is 0.5, which is about a third of a full walking pace (maxWalkSpeed is
// 1.5625). One round is a stumble: on the ground the engine's own friction
// (releaseDecel, 0.0498/tick) eats it in ten ticks and moves him some two and
// a half pixels. In the air, where there is no friction, that same round rides
// for the rest of the arc — a five-round burst across a jump is worth about two
// tiles of drift, which is the difference between landing on the ledge and not.
// That asymmetry is the mechanic: gunfire barely budges a man standing still
// and thoroughly ruins a man in mid-air.
//
// Sustained fire is 0.5 every GUN_INTERVAL ticks = 0.083/tick against 0.0498 of
// friction, so a hosed-down Mario slides at a walk and then a run and no
// faster. He is never uncontrollable — walking into the fire still beats it,
// because walkAccel over six ticks (0.222) is most of a round.
//
// DROP is the downward half, and it is DOWNWARD ONLY (see strike). An aeroplane
// shooting from above presses you into the ground; it does not lift you off it,
// and a round that lobbed Mario upward would be a favour, not a weapon.
export const KNOCKBACK = {
  PUSH: 0.5,
  DROP: 0.35,
  // THE CAP, and the answer to "sustained fire must not launch him across the
  // level". Knockback may accelerate Mario up to a dead run and not one pixel
  // per frame past it — the engine's own ceiling for a man on foot, so being
  // shot never moves him faster than he can move himself. Taken from PHYS
  // rather than written out, so it follows the physics if the physics change.
  //
  // On the ground the engine would enforce something close to this anyway
  // (Player#_groundAirHorizontal clamps to maxRun), but AIRBORNE its cap is
  // whatever speed was carried into the frame — it ratchets — so without this
  // a long burst at a jumping Mario would have no bound at all.
  MAX_VX: PHYS.maxRunSpeed,
  MAX_VY: PHYS.maxFallSpeed,
};

// Sub-tile resolution of the swept hit test, matching WingsSim#impact. A round
// covers up to about 11.5px in a tick and Mario's box is 12 wide, so a point
// test at the tick boundary would miss him outright at the wrong closing speed.
const STEP_PX = TILE / 4;

// Sparks live this many ticks. Feedback only; nothing reads it but the drawing.
export const SPARK_TICKS = 12;

// States in which the ENGINE owns Mario's velocity outright and a shove would
// be writing over a scripted animation — a death arc, the flagpole slide, a
// pipe transit, a vine. He is not dodging bullets in any of them.
const NO_PUSH = new Set([
  'dying', 'done', 'pipe', 'pipeexit', 'flagpole', 'flagflip', 'flagwalk', 'walkoff', 'climb',
]);

export function canPush(p) {
  return !!p && !p.dead && !NO_PUSH.has(p.state);
}

// Is (x, y) inside a body's box? Half-open on the far edges, so two boxes that
// merely share an edge do not count as touching.
export function inBox(x, y, b) {
  return x >= b.x && x < b.x + (b.w || 0) && y >= b.y && y < b.y + (b.h || 0);
}

// Apply one round's worth of knockback to `p`, in place. Exported because it is
// the whole rule and deserves a test that does not have to fly an aeroplane.
//
// The direction is the ROUND'S OWN travel, normalised — so strafing left to
// right shoves him left to right, and a diving pass drives him down as well as
// along. Nothing here aims: the shove is wherever the round was already going.
export function knockback(p, vx, vy) {
  const len = Math.hypot(vx, vy);
  if (!(len > 0)) return p;
  const ux = vx / len;
  const uy = vy / len;
  // A man already moving faster than the cap (kicked off a springboard, say) is
  // not slowed down by being shot: the cap bounds what the GUN can add, not
  // what Mario is allowed to be doing.
  p.vx = clampSpeed(p.vx + KNOCKBACK.PUSH * ux, Math.max(KNOCKBACK.MAX_VX, Math.abs(p.vx)));
  if (uy > 0) {
    p.vy = Math.min(p.vy + KNOCKBACK.DROP * uy, Math.max(KNOCKBACK.MAX_VY, p.vy));
  }
  return p;
}

export class GunRounds {
  // `solidAt(x, y)` reports whether island-local pixel (x, y) is blocking, and
  // is injected for the same reason MarioOverlay injects surfaceAt: the tile map
  // is the engine's and this file does not reach for globals.
  constructor(opts = {}) {
    this.solidAt = opts.solidAt || null;
    this.rounds = [];
    this.sparks = [];
    // The release tick of the newest round we have taken. THE DEDUPE: a round
    // rides four consecutive snapshots (GUN_TRACE_TICKS), so the same release
    // arrives up to four times and must become one round.
    this.lastFired = -Infinity;
    // Rounds that have hit Mario, ever. The counter the tests and the debug
    // panel read; nothing in the match is computed from it.
    this.hits = 0;
    this.max = opts.max || 24;
  }

  clear() {
    this.rounds.length = 0;
    this.sparks.length = 0;
    // NOT lastFired: he may be back on this island in a moment and the pilot's
    // tick counter will not have gone backwards. Forgetting it would let an
    // already-spent release through a second time.
    return this;
  }

  // A release off the wire, in ISLAND-LOCAL pixels: {t, owner, x, y, vx, vy}.
  // Returns the round it created, or null when there was nothing new in it.
  feed(g) {
    if (!g || typeof g.t !== 'number' || typeof g.x !== 'number' || typeof g.y !== 'number') {
      return null;
    }
    // The pilot reloaded and is counting from zero again. Same reasoning as
    // Interp#push: holding the old high-water mark would silence his gun for
    // however many minutes the old match had been running.
    if (g.t < this.lastFired - 600) this.lastFired = -Infinity;
    if (g.t <= this.lastFired) return null;
    this.lastFired = g.t;
    const s = {
      kind: 'gun',
      owner: g.owner == null ? null : g.owner,
      t: g.t,
      x: g.x, y: g.y, vx: g.vx || 0, vy: g.vy || 0,
      age: 0,
      dead: false,
    };
    // OWNERSHIP FIRST, before any geometry — the same question WingsSim#
    // canHitPlane asks, with Mario in the target's place. Today the answer is
    // always yes (the pilot's rounds are stamped with the plane's id); the
    // point is that the rule is applied rather than assumed.
    if (!canDamage(s, MARIO_ID)) return null;
    this.rounds.push(s);
    while (this.rounds.length > this.max) this.rounds.shift();
    return s;
  }

  // One fixed 60.0988Hz step, on MARIO'S clock — the engine's loop counter, via
  // MarioOverlay's hook list. Deliberately not the network pump's rAF: how far
  // a round travels between hit tests must not depend on the frame rate.
  //
  // Returns the hits this step, which is at most one per round and exactly one
  // per round EVER: a round that connects is spent. That is what bounds the
  // shove to the cyclic rate of the gun, ten a second, and stops a round that
  // happens to stop inside Mario's box from shoving him every tick it sits there.
  step(player) {
    for (const k of this.sparks) k.age++;
    if (this.sparks.length) this.sparks = this.sparks.filter((k) => k.age < SPARK_TICKS);
    if (!this.rounds.length) return [];
    const target = canPush(player) ? player : null;
    const out = [];
    for (const s of this.rounds) {
      if (s.dead) continue;
      const fromX = s.x;
      const fromY = s.y;
      stepShot(s);
      if (s.dead) continue; // old age, out over the sea somewhere
      const hit = this.sweep(s, fromX, fromY, target);
      if (hit) out.push(hit);
    }
    this.rounds = this.rounds.filter((s) => !s.dead);
    return out;
  }

  // The segment from where the round was to where it now is, walked in sub-tile
  // steps. Mario is tested BEFORE the terrain at each sample: a round grazing
  // the dirt at his feet hits the man, not the ground under him.
  //
  // Terrain stops a round here as it does on the pilot's machine, so nobody is
  // shot through a hillside. The two tile maps are the same map — the pilot's
  // Island is built from Mario's level and the craters are synchronised — but
  // if they ever disagreed, the disagreement would end at a round that exists
  // on one screen and not the other, which is a picture, not a divergence.
  sweep(s, fromX, fromY, player) {
    const dx = s.x - fromX;
    const dy = s.y - fromY;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / STEP_PX));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = fromX + dx * t;
      const y = fromY + dy * t;
      if (player && inBox(x, y, player)) {
        s.x = x;
        s.y = y;
        s.dead = true;
        return this.strike(s, player);
      }
      if (this.solidAt && this.solidAt(x, y)) {
        s.x = x;
        s.y = y;
        s.dead = true;
        return null;
      }
    }
    return null;
  }

  // Contact. The round is already spent and positioned at the point of impact.
  //
  // NOTE WHAT DOES NOT HAPPEN HERE: nothing calls player.hurt(). A gun round
  // costs Mario no life and no power-up, by design — the bullet does not kill
  // him, the FALL does. A round that took a life would make the gun a second,
  // faster bomb; a round that shoves him off the ledge he was standing on is a
  // different weapon entirely, and it is the one worth having.
  strike(s, p) {
    knockback(p, s.vx, s.vy);
    this.hits++;
    const hit = { x: s.x, y: s.y, vx: s.vx, vy: s.vy, t: s.t };
    this.sparks.push({ x: s.x, y: s.y, age: 0 });
    while (this.sparks.length > this.max) this.sparks.shift();
    return hit;
  }
}

export default GunRounds;
