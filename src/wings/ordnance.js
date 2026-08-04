import { nosePoint } from './flight.js';

// Wings of Fury's arsenal. `gravity` and `muzzle` are px/frame; `radius` is in
// TILES and feeds straight into blastTiles(). Torpedoes exist for the ferry,
// which is a later plan, so they carry no terrain damage yet.
export const ORDNANCE = {
  bomb: { muzzle: 0, gravity: 0.11, radius: 3, terrain: true, life: 900, load: 12 },
  rocket: { muzzle: 4.5, gravity: 0.006, radius: 4, terrain: true, life: 180, load: 4 },
  gun: { muzzle: 6, gravity: 0, radius: 0, terrain: false, life: 45, load: 300 },
  torpedo: { muzzle: 2, gravity: 0.11, radius: 0, terrain: false, life: 900, load: 4 },
};

export const ORDNANCE_KINDS = Object.keys(ORDNANCE);

// The machine gun's cyclic rate, in SIMULATION TICKS between rounds — never
// milliseconds. The sim runs at 60.0988Hz, so 6 ticks is ten rounds a second,
// or about 600rpm: a real carrier fighter's browning, and 30 seconds of
// continuous fire out of the 300-round magazine. Faster than this and the
// magazine is gone in under twenty seconds and the screen is a wall of tracer;
// slower and the thing reads as a pea-shooter rather than a machine gun.
//
// Ticks, not time, because the whole test strategy is that the same input tape
// produces the same match: a wall-clock timer here would desync two clients
// and make every replay a coin toss.
export const GUN_INTERVAL = 6;

// How long a round's RELEASE stays in the plane's 20Hz snapshot, in ticks.
//
// Gun rounds do not get a reliable event each. Ten a second, each alive for
// three quarters of a second, acked and resent until the peer confirms it,
// would be an order of magnitude more wire traffic than the whole rest of the
// match — for an object that is gone before the resend timer would even fire.
// So a round travels as its release state on the snapshot the plane is already
// sending, and Mario's client re-derives the round from it: a gun round has
// gravity 0, so position is an exact linear function of the release and the
// tick, and nothing has to be streamed after it leaves the muzzle.
//
// Twice GUN_INTERVAL, so a round rides FOUR consecutive snapshots (they go out
// every SNAPSHOT_INTERVAL_TICKS = 3). That is the redundancy that replaces the
// ack: three snapshots in a row have to be lost before a round goes missing,
// where an unreliable per-round event would lose one round per dropped packet.
// The receiver keys on the release tick, so the repeats cost nothing.
export const GUN_TRACE_TICKS = GUN_INTERVAL * 2;

// A fresh ammo rack: one counter per kind, seeded from ORDNANCE[kind].load.
// Plain data — the caller owns the object and can serialize/replace it freely.
export function createLoadout() {
  const out = {};
  for (const kind of ORDNANCE_KINDS) out[kind] = ORDNANCE[kind].load;
  return out;
}

// Fired from the plane's nose, inheriting the plane's velocity. Leading the
// target by eye is the whole Wings of Fury skill, so nothing here aims.
//
// `loadout`, if given, is checked and decremented: a kind at zero refuses the
// release by returning null rather than throwing, since running dry mid-dive
// is a normal thing to happen, not a bug. An unknown kind IS a bug (a typo'd
// key or a stale save), so that still throws regardless of loadout.
// `owner` is who fired it — a stable id, not an object reference, so it
// survives state(), a snapshot and a replay unchanged. See canDamage().
export function release(kind, p, loadout, owner = null) {
  const spec = ORDNANCE[kind];
  if (!spec) throw new Error(`ordnance: unknown kind "${kind}"`);
  if (loadout && !(loadout[kind] > 0)) return null;
  if (loadout) loadout[kind]--;
  const nose = nosePoint(p);
  return {
    kind,
    owner,
    x: nose.x,
    y: nose.y,
    vx: p.vx + Math.cos(p.angle) * spec.muzzle,
    vy: p.vy + Math.sin(p.angle) * spec.muzzle,
    age: 0,
    dead: false,
  };
}

// OWNERSHIP, asked before any geometry: may this round hurt `targetId` at all?
//
// The rule is one line — **a round never DIRECTLY hits whatever fired it** —
// and the word "directly" is the whole of it. An aeroplane cannot shoot itself
// down with its own forward-firing guns; a round leaves the muzzle at the nose,
// which is already inside the aeroplane's own box, so a hit test that did not
// ask this question would score a hit on the firer on the very tick of the
// shot. The gun is the case that matters today (`radius: 0` — it has nothing
// BUT a direct hit), and it is the case the pilot asked for.
//
// A BLAST is deliberately not covered. Spec 3.3 makes bombing too low one of
// the five ways to lose an aeroplane, and that rule survives this one intact:
// pass `blast` and ownership stops applying, because an expanding sphere of
// fire does not check whose bomb it was. So the pilot still dies to his own
// bomb, and still dies to his own rocket, while his own tracer sails past him.
//
// `owner` is an ID rather than a plane object on purpose. It goes through
// state() and will go across the wire in the next plan, where "mine" has to
// mean the same thing on both clients — an object reference would mean
// "mine" only ever resolved locally, which is exactly the corner not to be
// painted into. A null owner (neutral flak, an unattributed round) harms
// everyone, which is the safe default for a predicate that gates damage.
export function canDamage(shot, targetId, blast = false) {
  if (blast) return true;
  if (shot.owner == null || targetId == null) return true;
  return shot.owner !== targetId;
}

// Pure physics: gravity and motion only. This module has no idea what
// terrain or sea level look like — that is world/engine knowledge — so a
// shot only dies here of old age. The caller decides when a shot has hit
// something (island tile query, sea level, whatever) and calls detonate().
export function stepShot(s) {
  const spec = ORDNANCE[s.kind];
  s.vy += spec.gravity;
  s.x += s.vx;
  s.y += s.vy;
  s.age++;
  if (s.age >= spec.life) s.dead = true;
  return s;
}

// The caller has determined (by whatever means — tile collision, sea level,
// a hit-tested entity) that `s` has reached its target. This function does
// not touch a World or blast any tiles; it only marks the shot dead and
// reports what happened, so the pilot module can hand the event to whoever
// actually owns terrain/entities. See the plan header note this module was
// built against: world.blast() is a deliberately separate, later step.
export function detonate(s) {
  const spec = ORDNANCE[s.kind];
  s.dead = true;
  return { kind: s.kind, x: s.x, y: s.y, radius: spec.radius, terrain: spec.terrain };
}

// Run the exact same integrator forward on a copy until the shot crosses
// `groundY`. Plan 4's shadow marker needs the predicted impact tile to agree
// with the real one to the pixel, which is why this is not a closed form.
export function predictImpact(s, groundY, maxTicks = 900) {
  const spec = ORDNANCE[s.kind];
  const g = { x: s.x, y: s.y, vx: s.vx, vy: s.vy };
  for (let t = 1; t <= Math.min(maxTicks, spec.life - s.age); t++) {
    g.vy += spec.gravity;
    g.x += g.vx;
    g.y += g.vy;
    if (g.y >= groundY) return { x: g.x, y: g.y, ticks: t };
  }
  return null;
}
