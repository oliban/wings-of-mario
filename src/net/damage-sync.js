import { DamageMap, destroyKeys, buildKeys } from '../wings/damage.js';
import { parseTileKey } from '../wings/blast.js';

// The bridge between the three shapes damage comes in. THIS IS THE ONLY FILE
// ALLOWED TO KNOW MORE THAN ONE OF THEM (decision D3):
//
//   world.damage      Set<"tx,ty">                 one level, engine-owned
//   Island#destroyed  Set<"tx,ty">                 one island, pilot-owned
//   DamageMap         Map<islandId, Set<"tx,ty">>  the whole match, server-owned
//
// Neither the engine nor src/wings/ learns about DamageMap. Everything in
// src/net/ that needs damage goes through here.
//
// Nothing below imports the engine, so this file runs in plain Node and can be
// unit-tested and reasoned about server-side.

export class DamageSync {
  constructor(map, built) {
    this.map = map || new DamageMap();
    // The tiles Mario's brick bombs have ADDED. Kept beside the destroyed set
    // rather than inside it, and kept disjoint from it: see the note on
    // destroyKeys/buildKeys in src/wings/damage.js for why that is what lets
    // the two clients and the server converge with no ordering rule at all.
    this.built = built || new DamageMap();
    // islandId -> { version, hash }. The desync detector hashes every island
    // once a second for the whole match, and a set that has not changed cannot
    // have changed its hash.
    //
    // Keyed on the map's own version counter, NOT on the set's size, which is
    // what it used to be. That was sound only while these sets were
    // append-only, and a brick laid in a crater takes a key back out — so a
    // removal and an addition land on the same size with a different set, and
    // the cache would serve the stale hash for the rest of the match. The
    // counter is map-wide rather than per-island, so a crater on one island
    // costs one rehash of each other island the next time hashes() is asked
    // for — a few dozen FNV passes a second, once a second, against a class of
    // bug that is invisible until the alarm has been ignored for a week.
    this._hashCache = new Map();
  }

  // Decision D2: the newly-added keys this returns are the fact. Note there
  // is no bounds check and deliberately so (decision D1) — this set is a
  // replica of the server's, not a record of what this client managed to
  // draw, and a client that quietly dropped a key it could not apply would
  // hash a strict subset of the server's set and report desync forever.
  //
  // Malformed keys ARE dropped, because a key that cannot be parsed cannot be
  // applied by anybody and so cannot be part of any agreement. A socket is
  // exactly the untrusted source parseTileKey's hardening is for: without it
  // '', '0x3,2' and ' 3,11' all coerce onto a real-looking tile.
  record(islandId, keys) {
    if (!Array.isArray(keys)) return [];
    const clean = keys.filter((k) => parseTileKey(k) !== null);
    // A crater takes back any brick standing in it, here as on the server.
    return destroyKeys(this.map, this.built, islandId, clean).destroyed;
  }

  // The authoritative BUILT broadcast. Same rule the other way: a brick fills
  // in the crater it was laid in, so the key leaves the destroyed set.
  recordBuilt(islandId, keys) {
    if (!Array.isArray(keys)) return [];
    const clean = keys.filter((k) => parseTileKey(k) !== null);
    return buildKeys(this.map, this.built, islandId, clean).built;
  }

  has(islandId, key) {
    return this.map.has(islandId, key);
  }

  hasBuilt(islandId, key) {
    return this.built.has(islandId, key);
  }

  keys(islandId) {
    return this.map.keys(islandId);
  }

  builtKeys(islandId) {
    return this.built.keys(islandId);
  }

  // Every island either set has heard of. A bridge on an island nobody has
  // cratered still has to be applied when that island is built.
  builtIslands() {
    return [...this.built.islands.keys()].sort();
  }

  islands() {
    return [...this.map.islands.keys()].sort();
  }

  // One hash per island we have heard of, including islands with an empty set:
  // a client that invented damage the server never saw must still be caught.
  //
  // THIS IS THE SET THE DESYNC DETECTOR COMPARES, and it is deliberately this
  // one rather than anything read back out of a loaded World or Island. It is
  // the replica of the server's map (decision D1): it holds keys for islands
  // nobody has loaded, and keys no local tile map could place. A hash taken
  // off what this client managed to DRAW would differ from the server's for
  // reasons that are not desyncs, and the alarm would be ignored within a day.
  hashes() {
    const out = Object.create(null);
    for (const id of this.islands()) out[id] = this.hash(id);
    return out;
  }

  hash(islandId) {
    const version = this.map.version;
    const hit = this._hashCache.get(islandId);
    if (hit && hit.version === version) return hit.hash;
    const hash = this.map.hash(islandId);
    this._hashCache.set(islandId, { version, hash });
    return hash;
  }

  toJSON() {
    return this.map.toJSON();
  }

  static fromJSON(obj) {
    return new DamageSync(DamageMap.fromJSON(obj));
  }
}

// Lift a World's flat, single-level damage Set into the island map. Used on
// arrival at an island, so damage the engine applied locally on load is
// reflected in what this client hashes.
export function foldWorldDamage(sync, islandId, world) {
  if (!world || !world.damage) return [];
  return sync.record(islandId, [...world.damage]);
}

// Push the server's keys into a loaded World. With `opts.blast` this is a LIVE
// detonation on this client — craters, debris, shake, and anything standing in
// the radius dies. Without it, it is a silent catch-up (a level just loaded, a
// reconnect, a peer's crater on an island nobody is standing on).
//
// The silent path is `applyDamage`, never the loud one: replaying a peer's
// crater must not re-kill entities on this client. That split is the whole
// reason the engine has two entry points.
export function applyToWorld(world, keys, opts = {}) {
  if (!world || !Array.isArray(keys) || !keys.length) return;
  const b = opts.blast;
  // Feature-detected: an engine without the replay hook still gets the crater,
  // silently, rather than throwing and leaving this client's tile map behind
  // the set it hashes.
  if (b && typeof world.replayBlast === 'function') {
    world.replayBlast(b.cx, b.cy, b.radiusTiles, keys);
  } else {
    world.applyDamage(keys);
  }
}

// The pilot's terrain is an Island, not a World: no entities, no decor
// snapshot, nothing to kill. applyDamage is the whole of it.
export function applyToIsland(island, keys) {
  if (!island || !Array.isArray(keys) || !keys.length) return;
  island.applyDamage(keys);
}

// The brick rows, the same way. Feature-detected on the island rather than
// assumed: the tile tests hand the renderer island-SHAPED stubs, and this is
// the same politeness for the same reason.
export function applyBuiltToIsland(island, keys) {
  if (!island || !Array.isArray(keys) || !keys.length) return;
  if (typeof island.applyBuild === 'function') island.applyBuild(keys);
}

// And into a loaded World, which is how MARIO's client gets its bridge back
// after a level reload rebuilt the tile map from the level data. Silent by
// nature: setTile writes a character, it does not detonate anything.
//
// The keys go in through the engine's own setTile, which is also what the
// build WATCHER wraps (src/wings/bricks.js) — so a restored brick is noticed
// and, finding itself already in this client's built set, announced to nobody.
// That is the dedupe those two halves are built around.
export function applyBuiltToWorld(world, keys, ch = '=') {
  if (!world || typeof world.setTile !== 'function' || !Array.isArray(keys)) return 0;
  let n = 0;
  for (const key of keys) {
    const parsed = parseTileKey(key);
    if (!parsed) continue;
    const { tx, ty } = parsed;
    if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) continue;
    world.setTile(tx, ty, ch);
    n++;
  }
  return n;
}

export default DamageSync;
