// The whole authoritative shared state of a match: which tiles are gone, per
// island. No engine imports — the Node server runs this exact file.

// FNV-1a, 32-bit. Sorted so two clients that destroyed the same tiles in a
// different order still agree, which is the point of the desync detector.
export function hashKeys(keys) {
  let h = 0x811c9dc5;
  for (const key of [...keys].sort()) {
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    // Separator, so ['1,23'] and ['12,3'] cannot hash alike.
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class DamageMap {
  constructor() {
    this.islands = new Map();
    // Bumped by every add() and remove() that actually changed something.
    //
    // THE BUG THIS EXISTS FOR: DamageSync used to cache a hash per island
    // keyed on the SET'S SIZE, which was sound only while these sets were
    // append-only. They are not any more — a brick laid over a destroyed tile
    // takes that key back out (see buildKeys below) — so a remove followed by
    // an add lands on the same size with a different set, and the cache would
    // hand out the old island's hash forever. That reads as a permanent desync
    // on one client and nothing at all on the other.
    this.version = 0;
  }

  _set(islandId) {
    let s = this.islands.get(islandId);
    if (!s) {
      s = new Set();
      this.islands.set(islandId, s);
    }
    return s;
  }

  add(islandId, keys) {
    const s = this._set(islandId);
    const fresh = [];
    // Rejects non-arrays outright, a string included — `for...of` over a
    // string silently iterates its characters instead of its tile keys.
    if (!Array.isArray(keys)) return fresh;
    for (const key of keys) {
      if (s.has(key)) continue;
      s.add(key);
      fresh.push(key);
    }
    if (fresh.length) this.version++;
    return fresh;
  }

  // The other direction, and the only thing that ever calls it is the pair of
  // helpers below: a key leaves one of these sets exactly when it joins the
  // other one. Nothing may remove a key on its own initiative — see the note on
  // `keys` in DamageSync.record about why a client that quietly drops a key it
  // could not apply reports desync forever.
  remove(islandId, keys) {
    const s = this.islands.get(islandId);
    const gone = [];
    if (!s || !Array.isArray(keys)) return gone;
    for (const key of keys) {
      if (!s.delete(key)) continue;
      gone.push(key);
    }
    if (gone.length) this.version++;
    return gone;
  }

  has(islandId, key) {
    const s = this.islands.get(islandId);
    return !!s && s.has(key);
  }

  keys(islandId) {
    const s = this.islands.get(islandId);
    return s ? [...s].sort() : [];
  }

  hash(islandId) {
    return hashKeys(this.keys(islandId));
  }

  toJSON() {
    // Object.create(null), not {} — an island id of '__proto__' would
    // otherwise set the prototype instead of adding a key, and the entry
    // would vanish from the output with no error.
    const out = Object.create(null);
    for (const id of [...this.islands.keys()].sort()) out[id] = this.keys(id);
    return out;
  }

  static fromJSON(obj) {
    const d = new DamageMap();
    for (const id of Object.keys(obj || {})) d.add(id, obj[id] || []);
    return d;
  }
}

// ---------------------------------------------------------------------------
// TWO SETS, NEVER OVERLAPPING
//
// A tile can be taken out of the level (a bomb) or put into it that was never
// there (the toolbelt's brick bomb lays a row of five, see
// src/game/entities/brickbomb.js). That is two deltas against the same static
// level, and the same tile can be both in turn: bomb a hole, bridge it with
// bricks, bomb the bridge.
//
// THE INVARIANT, and the reason there is no timestamp anywhere near this: a key
// is in AT MOST ONE of the two sets, and the last action to touch it decides
// which. Laying a brick over a destroyed key takes it out of destroyed; bombing
// a built key takes it out of built. Both clients and the server run these two
// functions on the same authoritative broadcasts in the same order, and any
// order at all converges to "whatever happened last" without a clock, a
// sequence number or a merge rule. An overlap would need one, and would have to
// answer it identically in three places.
//
// Both take the two maps rather than owning them, so the server's Room and each
// client's DamageSync can keep the shape they already have.

// A blast. Returns the keys newly destroyed and the built keys it took back.
export function destroyKeys(destroyed, built, islandId, keys) {
  const unbuilt = built.remove(islandId, keys);
  return { destroyed: destroyed.add(islandId, keys), unbuilt };
}

// A brick row. Returns the keys newly built and the craters they filled in.
export function buildKeys(destroyed, built, islandId, keys) {
  const repaired = destroyed.remove(islandId, keys);
  return { built: built.add(islandId, keys), repaired };
}

export default DamageMap;
