import { TILE } from '../core/constants.js';
import { SEA_Y, PLANE_W, PLANE_H, cameraFor, worldBounds } from './geo.js';
import { MODE, FLIGHT, createPlane, stepPlane, nosePoint } from './flight.js';
import {
  landingVerdict, hitsHull, arrest, bolt, trapOn, spotOnDeck, OUTCOME,
} from './carrier.js';
import {
  createLoadout, release, stepShot, detonate, canDamage, GUN_INTERVAL, GUN_TRACE_TICKS,
} from './ordnance.js';
import { Archipelago } from './archipelago.js';
import { Radar } from './radar.js';

export const SQUADRON = 5;

// One archipelago is one SMB world: four islands (spec 2.1). This is the
// explicit, unseeded list you pass as `opts.islands` when you want a fixed
// ocean rather than the seeded layout archipelago.js builds by default — the
// default is already world 1's four levels, so this now says the same thing
// without the gaps depending on a seed.
export const ISLAND_LEVELS = ['1-1', '1-2', '1-3', '1-4'];

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
    // Who this aeroplane IS, for hit resolution. Every round it fires is
    // stamped with this id and can never directly hit it back (ordnance.js's
    // canDamage). A string rather than the plane object, and one that OUTLIVES
    // the airframe: `this.plane` is thrown away and rebuilt on every respawn
    // and sail, so an identity carried on it would make rounds still in the
    // air from the sortie you just died in hostile to the aeroplane that
    // replaces you. The squadron is one owner. It is also what goes on the
    // wire in the next plan, where "mine" has to mean the same thing on both
    // clients — hence an id and not a reference. Overridable so a match with
    // more than one aircraft in it does not have to re-derive the idea.
    this.planeId = opts.planeId || 'pilot';
    this.plane = spotOnDeck(createPlane());
    this.tick = 0;
    this.events = [];
    this.status = 'ready';
    this.lastVerdict = null;
    this.hookArmed = false;
    // A bolter is not a loss and is not a landing, so it gets its own counter
    // and its own last-reason for the HUD to read.
    this.bolters = 0;
    this.lastBolter = null;
    // A bolter still rolling. The deck check only runs on an aeroplane in the
    // AIR, so a roll has to be followed from here: it ends either stopped on
    // the deck — which is a landing, ugly but down — or off the bow and back
    // in the air, where it is an ordinary aeroplane again.
    this.rolling = false;
    // Ordnance in the air. The AMMUNITION is `loadout` and lives in
    // ordnance.js's own object — there is deliberately no second counter here
    // for the HUD to read, only the getters below onto that one object.
    this.shots = [];
    this.dropHeld = false;
    this.fireHeld = false;
    // Ticks still to wait before the gun will fire again. Zero means ready,
    // which is why a fresh press always shoots on the very tick it arrives.
    // `gunDry` is "the click has already sounded for this dry trigger".
    this.gunCooldown = 0;
    this.gunDry = false;
    // The most recent gun round's RELEASE — {t, owner, x, y, vx, vy} — kept so
    // gunTrace() can put it on the wire. It is not a second copy of the shot:
    // the shot itself is in `this.shots` and is stepped there. This is the seed
    // Mario's client needs to re-derive the same round on his own machine, and
    // it is written once, on the tick of the shot, and then never touched.
    this.lastGun = null;
    this.cam = cameraFor(this.plane.x, this.plane.y, this.bounds);
    this.rearm();
  }

  rearm() {
    this.plane.fuel = FLIGHT.FUEL_MAX;
    this.loadout = createLoadout();
    // A full belt can run dry again, and should click again when it does.
    this.gunDry = false;
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
    this.settleBolter();
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

  // The BOMB is edge-triggered, on the rising edge of `drop`: holding the key
  // down drops ONE bomb, not one per tick. The keyboard latch in
  // pilot-main.js means a press and release that both land between two ticks
  // still arrives here as one tick of `drop`, so a quick tap is never eaten.
  //
  // The GUN repeats — see stepGun. That is the one asymmetry, and it is the
  // right one: you aim a bomb, you hose with a gun.
  triggers(input) {
    const drop = !!input.drop;
    const fire = !!input.fire;
    const armed = this.plane.mode === MODE.AIR;
    if (armed && drop && !this.dropHeld) this.launch('bomb');
    this.stepGun(armed && fire, !this.fireHeld);
    this.dropHeld = drop;
    this.fireHeld = fire;
  }

  // Hold the trigger and the gun keeps firing: one round, then another every
  // GUN_INTERVAL ticks until the trigger comes up or the belt runs out.
  //
  // The first round is IMMEDIATE rather than one interval late, which is what
  // makes a snap shot at something crossing the nose feel like a trigger and
  // not like a request. `pressed` (the rising edge) also zeroes the cooldown,
  // so tapping deliberately is never slower than holding — a leftover cooldown
  // from a burst you just released must not eat the next press.
  //
  // Counted in TICKS. Nothing here reads a clock, so a replayed input tape
  // spends the magazine round for round, which is what the netplay desync
  // checks and the bot primitives rest on.
  stepGun(firing, pressed) {
    if (!firing) {
      this.gunCooldown = 0;
      this.gunDry = false;
      return;
    }
    if (pressed) {
      this.gunCooldown = 0;
      this.gunDry = false;
    }
    if (this.gunCooldown > 0) {
      this.gunCooldown--;
      return;
    }
    if (this.loadout.gun > 0) {
      this.launch('gun');
      this.gunCooldown = GUN_INTERVAL - 1;
      return;
    }
    // Empty. ONE click per dry trigger, on the tick the round should have gone
    // off — which is the tick the belt runs out, not the tick you pressed. The
    // usual way to run dry is leaning on the trigger, so a click that only
    // sounded on the rising edge would be silent in exactly the case that
    // matters and you would never learn why the gun stopped.
    //
    // And exactly one: a dead trigger held down must not click ten times a
    // second or fill the event log at the same rate the gun used to fire. The
    // cooldown stays at zero, so a landing that rearms the aeroplane has the
    // held trigger firing again on the very next tick.
    if (!this.gunDry) this.emit('dryFire', { kind: 'gun' });
    this.gunDry = true;
  }

  // Spend one round and put it in the air. Running dry is normal, not a bug:
  // release() returns null and spends nothing, and the pilot hears a click.
  launch(kind) {
    const shot = release(kind, this.plane, this.loadout, this.planeId);
    if (!shot) {
      this.emit('dryFire', { kind });
      return null;
    }
    this.shots.push(shot);
    if (kind === 'gun') {
      this.lastGun = {
        t: this.tick, owner: shot.owner,
        x: shot.x, y: shot.y, vx: shot.vx, vy: shot.vy,
      };
    }
    this.emit('released', { kind, x: shot.x, y: shot.y, left: this.loadout[kind] });
    return shot;
  }

  // The gun round for the snapshot, or null when there is nothing recent enough
  // to be worth carrying. See GUN_TRACE_TICKS for why this is a snapshot field
  // and not a reliable event, and why it repeats.
  //
  // `owner` travels with it for the same reason it travels on a shot: "mine"
  // has to mean the same thing on both clients, so the ownership rule in
  // ordnance.js#canDamage is one rule applied twice rather than an assumption
  // the receiving side makes about who must have fired.
  gunTrace() {
    const g = this.lastGun;
    if (!g || this.tick - g.t > GUN_TRACE_TICKS) return null;
    return { ...g };
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

  // Hit resolution's FIRST question, asked before any geometry: could this
  // round hurt the aeroplane at all? Whatever eventually runs the swept box
  // test against the plane — the flak battery in the threats plan, Mario's
  // fireballs after it — asks this first and skips the geometry entirely when
  // the answer is no. Own gun rounds and own rockets can never answer yes.
  //
  // `blast` is the one exception and it is the whole of spec 3.3: a
  // detonation's radius does not care whose bomb it was, so a low release
  // still kills the pilot who made it. Pass blast: true from a blast test and
  // ownership drops out.
  canHitPlane(shot, { blast = false } = {}) {
    return canDamage(shot, this.planeId, blast);
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
    if (verdict.outcome === OUTCOME.TRAP) return this.trap();
    // MISSED THE WIRE, and that is all it is. The aeroplane is on the deck
    // rolling; flight.js runs it off the bow if the deck runs out, and from
    // there it is an ordinary aircraft low and slow over the sea. See
    // src/wings/carrier.js for why this stopped being a fireball.
    if (verdict.outcome === OUTCOME.BOLTER) return this.bolter(verdict.reason);
    return this.lose(verdict.reason);
  }

  // A bolter, and the tick it becomes one. Announced so the HUD can say why
  // nothing caught — "TOO FAST" and "HOOK UP" are the two, and a player who is
  // told which one will fix it next circuit.
  bolter(reason) {
    bolt(this.plane);
    this.hookArmed = false;
    this.rolling = true;
    this.lastBolter = reason;
    this.bolters++;
    this.emit('bolter', { reason });
    return this;
  }

  // Where a bolter's roll ends. Stopping on the deck is a landing — he is down,
  // aboard and stationary, and refusing to rearm him for having done it without
  // the wire would be a rule with nothing behind it. Running off the bow is not
  // a landing and not a loss: he is flying again, low and slow, and what
  // happens next is up to him.
  settleBolter() {
    if (!this.rolling) return;
    const p = this.plane;
    if (p.mode === MODE.DECK) {
      this.rolling = false;
      return this.land();
    }
    if (p.mode === MODE.AIR) this.rolling = false;
    return undefined;
  }

  // THE HOOK HAS A WIRE. The aeroplane is caught but still moving: it is hauled
  // down over the next twenty-odd ticks, which is the distance the arrestor
  // wire is drawn stretching over (src/wings/art/carrier.js). The landing
  // COMPLETES when it stops — see settleBolter, which now settles both.
  //
  // The catch is announced here, on the tick it happens, because that is when
  // the wire takes the load.
  trap() {
    trapOn(this.plane);
    this.hookArmed = false;
    this.rolling = true;
    this.lastBolter = null;
    this.emit('trapped', { x: this.plane.x + PLANE_W / 2 });
    return this;
  }

  land() {
    // The bolter that ended in a landing is over; the panel should stop saying
    // why it happened.
    this.lastBolter = null;
    arrest(this.plane);
    this.hookArmed = false;
    this.rearm();
    this.status = 'ready';
    // WHERE the hook took it, so the wire can be drawn reacting to this
    // landing rather than sitting there as painted decor. Presentation only —
    // the sim does not know a wire is drawn — but the position is the sim's to
    // report, because only it knows where the aeroplane stopped.
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
  //
  // `toWorld` names the DESTINATION rather than assuming the next one along;
  // see Archipelago#sail for why (warp zones, and resent events). Whatever the
  // pilot was doing ends here: mid-sortie, mid-stall-turn, half way through a
  // landing, with bombs still falling. All of it, deliberately — a bomb from
  // the last ocean must not detonate into this one, and `shots` is the only
  // place ordnance in the air exists.
  sail(toWorld) {
    if (!this.archipelago.sail(toWorld)) return false;
    this.islands = this.archipelago.islands();
    this.bounds = worldBounds(this.islands);
    this.shots.length = 0;
    this.lastGun = null;
    this.squadron = SQUADRON;
    this.plane = spotOnDeck(createPlane());
    this.hookArmed = false;
    this.lastVerdict = null;
    // A dead pilot is not dead in the new world: `over` would refuse to step
    // and 'lost' would leave the HUD reading a loss he no longer has.
    this.rearm();
    this.status = 'ready';
    // The tube has no contact until Mario's next snapshot arrives, and holding
    // the last one would put a blip over the old world's coordinates.
    this._fix = { present: false };
    this.radar.fix = null;
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
      bolters: this.bolters,
      lastBolter: this.lastBolter,
      cam: { ...this.cam },
      // Stores and what is in the air. `loadout` is a copy of the one counter
      // in ordnance.js, never a second one.
      loadout: { ...this.loadout },
      // `owner` travels with the round, because who fired it is simulation
      // state and not a rendering detail: a client replaying this state has to
      // reach the same hit answers as the one that produced it.
      shots: this.shots.map((s) => ({
        kind: s.kind, owner: s.owner, x: s.x, y: s.y, vx: s.vx, vy: s.vy, age: s.age,
      })),
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
