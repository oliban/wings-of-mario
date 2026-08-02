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
export function release(kind, p, loadout) {
  const spec = ORDNANCE[kind];
  if (!spec) throw new Error(`ordnance: unknown kind "${kind}"`);
  if (loadout && !(loadout[kind] > 0)) return null;
  if (loadout) loadout[kind]--;
  const nose = nosePoint(p);
  return {
    kind,
    x: nose.x,
    y: nose.y,
    vx: p.vx + Math.cos(p.angle) * spec.muzzle,
    vy: p.vy + Math.sin(p.angle) * spec.muzzle,
    age: 0,
    dead: false,
  };
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
