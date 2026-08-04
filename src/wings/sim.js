import { TILE } from '../core/constants.js';
import { SEA_Y, PLANE_W, PLANE_H, cameraFor, worldBounds } from './geo.js';
import { MODE, FLIGHT, createPlane, stepPlane, nosePoint } from './flight.js';
import { landingVerdict, hitsHull, arrest, spotOnDeck } from './carrier.js';
import { createLoadout, release, stepShot, detonate } from './ordnance.js';
import { Archipelago } from './archipelago.js';
import { Radar } from './radar.js';

export const SQUADRON = 5;

// The two-island ocean the bot tests fly in. The real default is now a seeded
// four-island archipelago (see archipelago.js); this is what you pass as
// `opts.islands` when you want a small fixed ocean instead.
export const ISLAND_LEVELS = ['1-1', '2-1'];

// The whole flight sim, with no canvas anywhere in it: the renderer reads
// this, never the other way round. That keeps every rule in here reachable
// from a plain-Node test.
//
// Tasks 2 and 3 add islands and ordnance to this class. Nothing else changes.
export class WingsSim {
  constructor(opts = {}) {
    // The ocean. `opts.archipelago` shares one with the match; `opts.islands`
    // is the explicit list the bots and the older tests use; otherwise the
    // seed lays out the world.
    this.archipelago = opts.archipelago
      || new Archipelago({ seed: opts.seed, world: opts.world, ids: opts.islands });
    this.islands = this.archipelago.islands();
    this.bounds = worldBounds(this.islands);
    // The hunt. `_fix` is the true contact, which the network fills in from
    // Mario's snapshot (Plan 3); until then setFix() is the only writer and
    // the tube stays dark if nobody calls it.
    this.radar = new Radar({ seed: opts.seed });
    this._fix = { present: false };
    this.squadron = opts.squadron != null ? opts.squadron : SQUADRON;
    this.plane = spotOnDeck(createPlane());
    this.tick = 0;
    this.events = [];
    this.status = 'ready';
    this.lastVerdict = null;
    this.hookArmed = false;
    // Ordnance in the air. The AMMUNITION is `loadout` and lives in
    // ordnance.js's own object — there is deliberately no second counter here
    // for the HUD to read, only the getters below onto that one object.
    this.shots = [];
    this.dropHeld = false;
    this.fireHeld = false;
    this.cam = cameraFor(this.plane.x, this.plane.y, this.bounds);
    this.rearm();
  }

  rearm() {
    this.plane.fuel = FLIGHT.FUEL_MAX;
    this.loadout = createLoadout();
  }

  // The HUD's ordnance counters, as views onto the one loadout.
  get bombs() {
    return this.loadout.bomb;
  }

  get rockets() {
    return this.loadout.rocket;
  }

  emit(type, data) {
    this.events.push({ tick: this.tick, type, ...data });
  }

  // One fixed 60.0988Hz step. input: { pitch, thrust, gear, drop, fire }
  step(input = {}) {
    if (this.status === 'over') return this;
    const p = this.plane;
    if (p.mode !== MODE.DOWN) stepPlane(p, input);
    this.triggers(input);
    this.stepShots();
    if (p.mode !== MODE.DOWN) this.checkPlane();
    this.cam = cameraFor(p.x + PLANE_W / 2, p.y + PLANE_H / 2, this.bounds);
    this.radar.step(this._fix);
    this.tick++;
    return this;
  }

  // -------------------------------------------------------------------------
  // Ordnance
  // -------------------------------------------------------------------------

  // Edge-triggered, on the rising edge of each input flag: holding the key
  // down drops ONE bomb, not one per tick. The keyboard latch in
  // pilot-main.js means a press and release that both land between two ticks
  // still arrives here as one tick of `drop`, so a quick tap is never eaten.
  triggers(input) {
    const drop = !!input.drop;
    const fire = !!input.fire;
    const armed = this.plane.mode === MODE.AIR;
    if (armed && drop && !this.dropHeld) this.launch('bomb');
    if (armed && fire && !this.fireHeld) this.launch('gun');
    this.dropHeld = drop;
    this.fireHeld = fire;
  }

  // Spend one round and put it in the air. Running dry is normal, not a bug:
  // release() returns null and spends nothing, and the pilot hears a click.
  launch(kind) {
    const shot = release(kind, this.plane, this.loadout);
    if (!shot) {
      this.emit('dryFire', { kind });
      return null;
    }
    this.shots.push(shot);
    this.emit('released', { kind, x: shot.x, y: shot.y, left: this.loadout[kind] });
    return shot;
  }

  stepShots() {
    if (!this.shots.length) return;
    for (const s of this.shots) {
      if (s.dead) continue;
      // Where it was before this tick. stepShot mutates in place, so the
      // segment has to be captured first — and the segment is the whole point:
      // see impact().
      const fromX = s.x;
      const fromY = s.y;
      stepShot(s);
      // Old age, out over open water somewhere: no bang, it just stops being
      // simulated. Only a shot that reached SOMETHING detonates.
      if (s.dead) continue;
      this.impact(s, fromX, fromY);
    }
    this.shots = this.shots.filter((s) => !s.dead);
  }

  // ordnance.js deliberately knows nothing about terrain, so the decision that
  // a shot has hit something is made here. Land first, then the sea: a bomb
  // dropped on a beach is on the beach.
  //
  // SWEPT, not sampled at the tick boundary. A bomb off the ceiling arrives at
  // about eleven pixels a tick, so a point test at the new position finds it
  // already up to eleven pixels INSIDE the hillside, and a blast disc centred
  // a few pixels deeper covers a different set of tiles — measured, that was
  // worth up to three tiles of crater, varying with impact speed and therefore
  // with the height it was dropped from. A weapon's crater should be a
  // property of the weapon.
  //
  // So the segment from where it was to where it now is gets walked in
  // sub-tile steps and the shot detonates at the first blocking point on it —
  // the SURFACE. That also makes tunnelling impossible by construction rather
  // than by luck: nothing today moves fast enough to skip a 16px tile (the
  // fastest round in the game manages 11.5px a tick), but nothing about that
  // is guaranteed by anything except the current constants.
  impact(s, fromX, fromY) {
    const dx = s.x - fromX;
    const dy = s.y - fromY;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (TILE / 4)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = fromX + dx * t;
      const y = fromY + dy * t;
      const isle = this.islandAt(x, y);
      if (isle && isle.blocksAt(x, y)) {
        // Detonate where it made contact, not where the tick happened to end.
        s.x = x;
        s.y = y;
        return this.burst(s, isle, false);
      }
      if (y >= SEA_Y) {
        s.x = x;
        s.y = SEA_Y;
        return this.burst(s, null, true);
      }
    }
    return null;
  }

  // The pilot never constructs a World: terrain damage is the island's own
  // destroyed-set, and killing whatever was standing on it is Mario's client's
  // job in a later plan. That split is why this calls island.blast() and not
  // world.blast().
  burst(s, isle, water) {
    const hit = detonate(s);
    const keys = isle && hit.terrain && hit.radius > 0 ? isle.blast(hit.x, hit.y, hit.radius) : [];
    // Into the permanent record, so the crater outlives this Island object —
    // the islands are rebuilt from the archipelago on every sail.
    if (isle && keys.length) this.archipelago.record(isle.id, keys);
    this.emit('detonation', {
      kind: hit.kind,
      x: hit.x,
      y: water ? SEA_Y : hit.y,
      radius: hit.radius,
      water: !!water,
      island: isle ? isle.id : null,
      keys,
    });
    return keys;
  }

  islandAt(px, py) {
    for (const isle of this.islands) if (isle.contains(px, py)) return isle;
    return null;
  }

  // Bots aim at an island by the id they were told to bomb, not by pixel —
  // the one lookup bot.js needs that nothing else here provided.
  islandById(id) {
    return this.islands.find((isle) => isle.id === id) || null;
  }

  // The true position of the contact. Called once per snapshot, not per tick:
  // the radar does its own timing.
  setFix(fix) {
    this._fix = fix || { present: false };
    return this._fix;
  }

  radarContact() {
    return this.radar.contact();
  }

  // -------------------------------------------------------------------------

  checkPlane() {
    const p = this.plane;
    if (p.mode !== MODE.AIR) return;
    if (p.y + PLANE_H >= SEA_Y) return this.lose('sea');

    // Flown into a hillside. The nose is the point that decides it, and
    // blocksTile — solid or platform — is the predicate: a coin, a bush or a
    // cloud is scenery an aeroplane passes straight through.
    const nose = nosePoint(p);
    const isle = this.islandAt(nose.x, nose.y);
    if (isle && isle.blocksAt(nose.x, nose.y)) return this.lose('island');

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

  // Mario cleared x-4: the carrier group weighs anchor. The squadron is
  // replenished (spec 3.4), the aeroplane is respotted, and anything still in
  // the air is left behind with the old ocean.
  sail() {
    if (!this.archipelago.sail()) return false;
    this.islands = this.archipelago.islands();
    this.bounds = worldBounds(this.islands);
    this.shots.length = 0;
    this.squadron = SQUADRON;
    this.plane = spotOnDeck(createPlane());
    this.hookArmed = false;
    this.rearm();
    this.status = 'ready';
    this.cam = cameraFor(this.plane.x, this.plane.y, this.bounds);
    this.emit('worldCleared', { world: this.archipelago.world });
    return true;
  }

  // The stall turn, for the renderer to drive its roll from directly rather
  // than inferring a manoeuvre from angle changes on its own. state() embeds
  // this; the scene calls it once a frame instead of building a whole state
  // object to read three numbers out of it.
  //
  // turning: is one in progress. turnProgress: 0..1 through it, LINEAR IN
  // TICKS — the heading itself is eased, so anything animating alongside the
  // manoeuvre has to ease this to match (see Scene.reversalTarget). turnDir:
  // +1/-1, the sign of the angle sweep (matches turnDelta in flight.js) while
  // turning, 0 otherwise.
  turnState() {
    const p = this.plane;
    const turning = p.turnTicks != null;
    return {
      turning,
      turnProgress: turning ? p.turnTicks / FLIGHT.STALL_TURN_TICKS : 0,
      turnDir: turning ? Math.sign(p.turnDelta) : 0,
    };
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
      // Stores and what is in the air. `loadout` is a copy of the one counter
      // in ordnance.js, never a second one.
      loadout: { ...this.loadout },
      shots: this.shots.map((s) => ({ kind: s.kind, x: s.x, y: s.y, vx: s.vx, vy: s.vy, age: s.age })),
      contact: this.radarContact(),
      ...this.turnState(),
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
