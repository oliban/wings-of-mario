import { TILE } from '../core/constants.js';

export function tileKey(tx, ty) {
  return `${tx},${ty}`;
}

export function parseTileKey(key) {
  const c = key.indexOf(',');
  return { tx: Number(key.slice(0, c)), ty: Number(key.slice(c + 1)) };
}

// A detonation at pixel (cx, cy) clears every tile whose centre lies within
// `radiusTiles` of it. Testing the centre rather than the corner keeps the
// crater visually round and keeps the result independent of which side of a
// tile boundary the bomb happened to land on.
export function blastTiles(cx, cy, radiusTiles) {
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
