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
    return fresh;
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

export default DamageMap;
