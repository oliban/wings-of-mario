import { Rng } from '../core/rng.js';
import { getLevel, ORDER } from '../data/levels/index.js';
import { FIRST_ISLAND_X, layoutIslands } from './geo.js';
import { Island } from './island.js';

// The ocean holds ONE world at a time as a four-island archipelago plus the
// carrier (design spec 2.1). Every level upstream ships already exists, so
// content is cheap — but thirty-two islands in one sea would make flight times
// absurd and pre-bombing meaningless. Four keeps the hunt tense and keeps
// wrecking island 4 before Mario reaches it a real strategy.
//
// The SHAPE of the game is read from the level registry rather than written
// down. Upstream keeps adding levels; a hard-coded 32 would go stale the first
// time a world arrived, and the failure would be a missing island rather than
// an error. `ORDER` is the ordinary progression — Harry's painted levels are
// deliberately a sequence of their own and are not an SMB world, so they are
// not an archipelago either (they still lay out fine if passed explicitly).
const WORLD_IDS = (() => {
  const byWorld = new Map();
  for (const id of ORDER) {
    const w = Number(String(id).split('-')[0]);
    if (!Number.isFinite(w)) continue;
    if (!byWorld.has(w)) byWorld.set(w, []);
    byWorld.get(w).push(id);
  }
  return byWorld;
})();

export const ARCHIPELAGO = {
  WORLDS: WORLD_IDS.size,
  ISLANDS_PER_WORLD: WORLD_IDS.get(1) ? WORLD_IDS.get(1).length : 4,
  FIRST_X: FIRST_ISLAND_X,
  // The crossing has to be long enough that a torpedo has a window and short
  // enough that a sortie can reach the far island and get home on one tank.
  // Full-throttle endurance is about 7143 ticks at 2.69 px/frame, so the
  // widest possible world — four islands and three max gaps — is comfortably
  // inside one round trip.
  MIN_GAP: 900,
  MAX_GAP: 2200,
};

// The levels of one world, in play order, straight out of the registry.
// A world nobody has drawn is an empty list, not an invented one.
export function worldIds(world) {
  const ids = WORLD_IDS.get(Number(world));
  return ids ? [...ids] : [];
}

// A per-world seed derived from the match seed. Deriving rather than sharing
// means sailing to world 3 gives the same ocean whether you got there by
// playing or by joining a match already in progress — and means world 2's
// layout is not simply world 1's continued, which a single shared stream would
// make it.
export function seedFor(seed, world) {
  const s = ((seed >>> 0) ^ Math.imul(world >>> 0, 0x9e3779b1)) >>> 0;
  return s || 0x2545f491;
}

// Left to right, first island at FIRST_X, seeded ocean between them.
//
// Pure: the ONLY entropy is seedFor(seed, world), so both clients and the
// server compute an identical ocean without any of them sending it. No
// wall-clock, no shared RNG instance, no module-level state.
//
// The slots come out of geo.js's layoutIslands, which is what the pilot's sim
// and the renderer already read; this only supplies the gaps.
export function layoutArchipelago(world, seed, ids = null) {
  const list = ids || worldIds(world);
  if (!list.length) throw new Error(`archipelago: world ${world} has no levels`);
  const levels = list.map((id) => {
    const level = getLevel(id);
    if (!level) throw new Error(`archipelago: no level "${id}"`);
    return level;
  });
  const rng = new Rng(seedFor(seed, world));
  return layoutIslands(levels, ARCHIPELAGO.FIRST_X, () =>
    rng.int(ARCHIPELAGO.MIN_GAP, ARCHIPELAGO.MAX_GAP));
}

// The ocean, plus every crater in it.
//
// An island Mario is not standing on is never simulated (spec 4.3): it is a
// level definition plus a destroyed-set, which is what makes bombing island 4
// while Mario is on island 1 nearly free. This class is that pair, for four
// islands at a time, and it is the shape the server holds.
export class Archipelago {
  constructor(opts = {}) {
    this.seed = (opts.seed >>> 0) || 0x2545f491;
    this.world = opts.world || 1;
    this.ids = opts.ids || null;
    this.damage = opts.damage || {};
    this.slots = layoutArchipelago(this.world, this.seed, this.ids);
  }

  // Fresh Island objects with their craters already subtracted. Cheap enough
  // to call whenever the ocean changes; nothing caches them but the sim.
  islands() {
    return this.slots.map((s) => new Island(s.level, s.x, this.damageFor(s.id)));
  }

  damageFor(id) {
    const set = this.damage[id];
    return set ? [...set] : [];
  }

  // Record craters. Craters are permanent for the match (spec 4.1): nothing
  // in this class ever removes a key.
  record(id, keys) {
    if (!keys || !keys.length) return this.damageFor(id);
    const set = new Set(this.damage[id] || []);
    for (const k of keys) set.add(k);
    this.damage[id] = [...set].sort();
    return this.damage[id];
  }

  // The carrier group weighs anchor. Returns false at the end of the last
  // world — there is no ninth ocean, and arriving there means Mario has won;
  // the group does not move.
  //
  // `toWorld` is the DESTINATION, and it is named rather than assumed for two
  // reasons. A warp zone can put Mario on 4-1 straight out of 1-2, and a blind
  // increment would leave the pilot flying over world 2 while Mario stood in
  // world 4 — two different oceans, which the desync detector cannot catch
  // because it compares destroyed-tile sets and both would be empty. And a
  // resent worldCleared must be a no-op rather than a second sail: naming the
  // destination makes arriving there IDEMPOTENT, where counting is not.
  sail(toWorld = this.world + 1) {
    const to = Number(toWorld);
    if (!Number.isFinite(to) || to <= this.world || to > ARCHIPELAGO.WORLDS) return false;
    if (!worldIds(to).length) return false;
    this.world = to;
    // An explicit island list belongs to the world it was handed in for — it
    // is how the bots and the older tests pin world 1 to a fixed ocean. Sailing
    // past that world drops it and reads the registry, or every archipelago
    // from here on would be world 1's four levels with different gaps.
    this.ids = null;
    this.slots = layoutArchipelago(this.world, this.seed, this.ids);
    return true;
  }

  toJSON() {
    return { seed: this.seed, world: this.world, ids: this.ids, damage: this.damage };
  }

  static fromJSON(json) {
    return new Archipelago({
      seed: json.seed,
      world: json.world,
      ids: json.ids || null,
      damage: json.damage || {},
    });
  }
}

export default Archipelago;
