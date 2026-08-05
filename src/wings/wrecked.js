// WHAT A BOMBED TILE TAKES WITH IT.
//
// Craters are permanent, and the engine's emitters were never told. Blow the
// top off a cannon and it goes on firing bullet bills out of the hole where it
// used to be; blow a pipe apart and a piranha plant still rises out of the
// empty air above the rubble. The user's words: "cannons destroyed should not
// shoot bullets still, pipes destroyed should not have snakes coming out of
// them any longer."
//
// Neither is the engine's fault. Both read the tile map ONCE — cannons at level
// load (Cannons#reset scans every column for the top tile of a cannon run) and
// the plant when it first looks for its pipe lip — because upstream's terrain
// never changes under them. Ours does.
//
// NO ENGINE EDIT. src/game/entities/ is upstream and the diff against it is
// exactly 150 lines across three files, none of them there. So this runs on
// Mario's own timestep and takes the emitters out from the outside, the same
// way guardWorld() in src/wings/sanctuary.js takes destroyTiles.
//
// MARIO'S CLIENT ONLY, and no wire event. The pilot does not simulate a single
// enemy — he has no cannons and no plants to silence — so there is nothing here
// for the two clients to disagree about. Both derive it from the tile map they
// already agree on.

import { TILE } from '../core/constants.js';

// Is the tile this cannon was built from still a cannon?
//
// Read off the LIVE map (`world.map` through `recByCode`), which is the same
// pair Cannons#reset scanned to find it in the first place — so this asks
// exactly the question that put the cannon in the list, one bombing run later.
export function cannonStanding(world, c) {
  if (!world || !c) return false;
  const { tx, ty } = c;
  if (tx == null || ty == null) return false;
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return false;
  const rec = world.recByCode && world.recByCode[world.map[ty * world.w + tx]];
  return !!(rec && rec.cannon);
}

// A cannon that is no longer there must never fire again — including one the
// camera has not reached yet, which is why both the ring and the master list
// are swept.
//
// TWO THINGS, because there are two ways a shot can still come out:
//
//   the ring (`table`) is what FireCannon actually rolls against. Emptying the
//   slot is the engine's own idea of a cannon that is not there: "an entry
//   never filled in is page zero and is skipped".
//
//   the timer is what stops a re-registration reviving it. _register() copies
//   an entry out of `all` and resets its timer as the camera scrolls onto it,
//   so clearing the ring alone would silence a wrecked cannon only until the
//   player walked back and forth past it.
export function silenceCannons(world) {
  const cannons = world && world.cannons;
  if (!cannons || !Array.isArray(cannons.all)) return 0;
  let hushed = 0;
  for (const c of cannons.all) {
    if (!c || cannonStanding(world, c)) continue;
    // Counting down for ever: `if (c.timer > 0) { c.timer--; continue; }` can
    // never reach the shot, whatever the ring does with it afterwards.
    c.timer = Infinity;
    c.wrecked = true;
    hushed++;
  }
  const table = cannons.table;
  if (Array.isArray(table)) {
    for (let i = 0; i < table.length; i++) {
      if (table[i] && table[i].wrecked) table[i] = null;
    }
  }
  return hushed;
}

// Has the pipe this plant lives in been blown away?
//
// The plant caches its lip the first time it looks (`_anchor`), so it keeps
// rising out of a position that no longer has anything under it. The test is
// the one the plant itself used: is there something solid at the mouth.
export function pipeGone(world, e) {
  if (!world || !e || typeof world.solidAt !== 'function') return false;
  // Never looked for its lip yet — it will find one or not on its own, and a
  // plant with no anchor is not yet a plant with a missing one.
  if (e.mouthY == null) return false;
  return !world.solidAt(e.x + TILE * 0.5, e.mouthY + TILE * 0.5);
}

// Every plant whose pipe has gone, removed. `remove()` is the engine's own
// method and is what everything else in there uses to take an entity out.
export function clearOrphanPlants(world) {
  const list = (world && world.entities) || null;
  if (!Array.isArray(list)) return 0;
  let pulled = 0;
  for (const e of list) {
    if (!e || e.removed || e.type !== 'piranha') continue;
    if (!pipeGone(world, e)) continue;
    if (typeof e.remove === 'function') e.remove();
    else e.removed = true;
    pulled++;
  }
  return pulled;
}

// One fixed timestep, from the hook list in src/wings/mario-main.js.
//
// Swept every tick rather than driven off a damage event, for the same reason
// the toolbelt seeder is: an edge can be missed — a crater can arrive from the
// wire, from a local blast, from a replayed set on a level load — and "this
// cannon is not there any more" is a state that cannot be. It is a walk over a
// handful of cannons and the entity list, which the engine already walks twice
// a frame.
export class Wrecked {
  constructor() {
    this.hushed = 0;
    this.pulled = 0;
  }

  step(world) {
    if (!world || !world.level) return false;
    const h = silenceCannons(world);
    const p = clearOrphanPlants(world);
    // Counters are cumulative-ish for the debug surface: `hushed` is how many
    // are silenced RIGHT NOW, which is the useful number, and `pulled` counts
    // plants taken out over the life of the level.
    this.hushed = h;
    this.pulled += p;
    return h > 0 || p > 0;
  }
}

export default Wrecked;
