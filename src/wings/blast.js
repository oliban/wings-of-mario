import { TILE } from '../core/constants.js';

export function tileKey(tx, ty) {
  return `${tx},${ty}`;
}

const KEY_RE = /^-?\d+,-?\d+$/;

// Returns null for anything that is not `<int>,<int>` in plain decimal — no
// whitespace, no scientific/hex notation, no missing comma. ("03,11" still
// parses, as an alias for "3,11" — a leading zero doesn't change what
// integer it is.) Every caller (network payload or local damage set) must
// treat null as "skip this key" rather than let it fall through to
// Number()'s coercion, which happily turns "" into a real-looking tile.
export function parseTileKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) return null;
  const c = key.indexOf(',');
  return { tx: Number(key.slice(0, c)), ty: Number(key.slice(c + 1)) };
}

// Largest radius worth ever computing: the biggest level is ~212x15 tiles,
// so a 32-tile radius already covers more than a full screen in both axes.
// Anything past that is either a bug or a hostile payload — clamp rather
// than let the O(radius^2) loop below hang the tab.
const MAX_BLAST_RADIUS_TILES = 32;

// A detonation at pixel (cx, cy) clears every tile whose centre lies within
// `radiusTiles` of it. Testing the centre rather than the corner keeps the
// crater visually round and keeps the result independent of which side of a
// tile boundary the bomb happened to land on.
export function blastTiles(cx, cy, radiusTiles) {
  radiusTiles = Math.min(radiusTiles, MAX_BLAST_RADIUS_TILES);
  const r = radiusTiles * TILE;
  const r2 = r * r;
  const tx0 = Math.floor((cx - r) / TILE);
  const tx1 = Math.floor((cx + r) / TILE);
  const ty0 = Math.floor((cy - r) / TILE);
  const ty1 = Math.floor((cy + r) / TILE);

  const out = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const dx = tx * TILE + TILE / 2 - cx;
      const dy = ty * TILE + TILE / 2 - cy;
      if (dx * dx + dy * dy <= r2) out.push(tileKey(tx, ty));
    }
  }
  return out.sort();
}
