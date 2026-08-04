// ---------------------------------------------------------------------------
// World 1 level registry.
//
//   LEVELS        — id -> level object, in the format of ARCHITECTURE.md §6
//   ORDER         — play order
//   getLevel(id)  — tolerant lookup: '1-1', '1_1', 'w1-1', 1, '1' all resolve
//   getArea(id, areaId) — a level's sub-area (pipe rooms, warp exits)
//   nextLevel(id) — the id that follows, or null after the last one
//
// A level object never mutates at runtime: World copies the tile rows into its
// own typed array on load, so the same object can be replayed as often as the
// player loses a life.
// ---------------------------------------------------------------------------

import L11 from './1-1.js';
import L12 from './1-2.js';
import L13 from './1-3.js';
import L14 from './1-4.js';
import L21 from './2-1.js';
import L22 from './2-2.js';
import L23 from './2-3.js';
import L24 from './2-4.js';
import L31 from './3-1.js';
import L32 from './3-2.js';
import L33 from './3-3.js';
import L34 from './3-4.js';
import L41 from './4-1.js';
import L42 from './4-2.js';
import L43 from './4-3.js';
import L44 from './4-4.js';
import L51 from './5-1.js';
import L52 from './5-2.js';
import L53 from './5-3.js';
import L54 from './5-4.js';
import L61 from './6-1.js';
import L62 from './6-2.js';
import L63 from './6-3.js';
import L64 from './6-4.js';
import L71 from './7-1.js';
import L72 from './7-2.js';
import L73 from './7-3.js';
import L74 from './7-4.js';
import L81 from './8-1.js';
import L82 from './8-2.js';
import L83 from './8-3.js';
import L84 from './8-4.js';
import H1 from './h-1.js';

export const LEVELS = {
  '1-1': L11,
  '1-2': L12,
  '1-3': L13,
  '1-4': L14,
  '2-1': L21,
  '2-2': L22,
  '2-3': L23,
  '2-4': L24,
  '3-1': L31,
  '3-2': L32,
  '3-3': L33,
  '3-4': L34,
  '4-1': L41,
  '4-2': L42,
  '4-3': L43,
  '4-4': L44,
  '5-1': L51,
  '5-2': L52,
  '5-3': L53,
  '5-4': L54,
  '6-1': L61,
  '6-2': L62,
  '6-3': L63,
  '6-4': L64,
  '7-1': L71,
  '7-2': L72,
  '7-3': L73,
  '7-4': L74,
  '8-1': L81,
  '8-2': L82,
  '8-3': L83,
  '8-4': L84,
  'h-1': H1,
};

export { ORDER, HARRY } from './roster.js';
import { ORDER, HARRY } from './roster.js';

function normalize(id) {
  if (id == null) return null;
  if (typeof id === 'number') return ORDER[id] || ORDER[id - 1] || null;
  const s = String(id).trim().toLowerCase();
  if (LEVELS[s]) return s;
  const m = s.match(/(\d+)\s*[-_. ]\s*(\d+)/);
  if (m) {
    const key = `${parseInt(m[1], 10)}-${parseInt(m[2], 10)}`;
    if (LEVELS[key]) return key;
  }
  const n = s.match(/^\d+$/) ? parseInt(s, 10) : NaN;
  if (!Number.isNaN(n)) return ORDER[n] || ORDER[n - 1] || null;
  return null;
}

export function getLevel(id) {
  const key = normalize(id);
  return key ? LEVELS[key] : null;
}

export function hasLevel(id) {
  return normalize(id) != null;
}

export function levelId(id) {
  return normalize(id);
}

// Sub-areas are addressed by their own id ('1-1b'); 'main' / null returns the
// level itself, which is what World does when a warp comes back out.
export function getArea(id, areaId) {
  const lvl = getLevel(id);
  if (!lvl) return null;
  if (!areaId || areaId === 'main') return lvl;
  return (lvl.areas && lvl.areas[areaId]) || null;
}

// Harry's levels are their own sequence, so finishing one leads to the next of
// HIS and not back into world 1. Past the last of either sequence there is no
// next level, which is the signal main.js reads as "the run is over".
export function nextLevel(id) {
  const key = normalize(id);
  if (!key) return null;
  const seq = ORDER.includes(key) ? ORDER : HARRY.includes(key) ? HARRY : null;
  if (!seq) return null;
  const i = seq.indexOf(key);
  return i >= 0 && i + 1 < seq.length ? seq[i + 1] : null;
}

export function firstLevel() {
  return ORDER[0];
}

export default LEVELS;
