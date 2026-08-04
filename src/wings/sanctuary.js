// THE SANCTUARY: the ground Mario spawns on, which no bomb ever takes.
//
// Craters are permanent and the pilot can bomb an island hours before Mario
// walks onto it. Without this rule those two facts combine into the one
// unwinnable state the design has: pre-bomb the spawn, and Mario arrives,
// falls, dies, respawns into the same hole, forever. No skill, no counterplay,
// no telegraph he could possibly react to.
//
// THIS IS THE ONLY COPY OF THE PREDICATE. Three places decide what a bomb
// destroys and they must agree exactly, or the two players' craters diverge
// permanently and nothing detects it (the desync alarm compares each client's
// replica of the SERVER's set, so two clients that removed different tiles from
// their own maps still hash alike). So all three import this file:
//
//   * the server      — src/net/room.js, recordDetonate(): the authority
//   * the pilot       — src/wings/island.js, destructibleTile()
//   * Mario           — guardWorld() below, installed by src/net/mario-side.js
//
// No engine imports: the Node server runs this exact file, and blast.js and the
// level data are both plain data.

import { tileKey, parseTileKey } from './blast.js';
import { getLevel } from '../data/levels/index.js';

// THE BALANCE NUMBERS. A strip of columns around the spawn column, running
// from just above Mario's head all the way down to the bottom row of the map.
//
//   left/right  — 6 columns wide (2 + 3 + the spawn column itself). Mario
//                 spawns facing right and has to accelerate before he can jump
//                 anything, so the run-up is asymmetric on purpose: three
//                 columns of it, which is the shortest strip a crater can
//                 start beyond and still leave him a jump he can make. The two
//                 to the left are the standard 2-tile blast radius: a bomb
//                 dropped dead on the spawn must not be able to open a hole he
//                 can walk backwards into on the frame he lands.
//   above       — one row of headroom, so a bomb aimed at his head cannot take
//                 the row he is standing in.
//   (below)     — no constant: the strip runs to the last row of the map.
//                 Spawn floors are not at a fixed depth — 1-4 drops him from
//                 row 6 onto a staircase at row 7 and a floor at row 10, and
//                 2-2 spawns him swimming — so anything but "all the way down"
//                 would need a per-level number. Everything under the floor is
//                 solid rock or nothing at all, so the extra rows cost nothing.
//
// Retune here. The shape is a pure function of these three numbers, and both
// clients and the server read it from this one place, so changing them cannot
// desync a match that starts after the change.
export const SANCTUARY = { left: 2, right: 3, above: 1 };

// SIZE, DELIBERATELY SMALL. This protects the GROUND, not Mario. A bomb
// dropped on a sanctuary tile still detonates against it (blocksTile is
// untouched) and its blast still kills anything in the radius — so camping on
// the spawn is not safe, it is the single most predictable place on the island
// to be. The rule removes the un-counterable death loop and nothing else.

// Where a level can put Mario. `spawn` is the level's start (ARCHITECTURE.md
// §6); `checkpoint` is where world.js respawns him after a death once he has
// passed it, and a pre-bombed checkpoint traps him exactly as a pre-bombed
// spawn does. No shipped level defines one today — this is the rule, not a
// per-level list, so a level that gains one is covered without a code change.
export function spawnPoints(level) {
  if (!level) return [];
  const out = [];
  const add = (p) => {
    if (!p) return;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    out.push({ x, y });
  };
  add(level.spawn);
  add(level.checkpoint);
  return out;
}

// The rectangle each spawn point protects, clipped to the map. Exported so a
// test, or a renderer that wants to draw it, reads the shape from the same
// place the predicate does rather than re-deriving it.
export function sanctuaryRects(level) {
  if (!level || !Array.isArray(level.tiles)) return [];
  const h = level.tiles.length;
  const w = level.width | 0;
  const rects = [];
  for (const p of spawnPoints(level)) {
    const x0 = Math.max(0, p.x - SANCTUARY.left);
    const x1 = Math.min(w - 1, p.x + SANCTUARY.right);
    const y0 = Math.max(0, p.y - SANCTUARY.above);
    const y1 = h - 1;
    if (x1 < x0 || y1 < y0) continue;
    rects.push({ x0, x1, y0, y1 });
  }
  return rects;
}

// Level objects never mutate at runtime (see src/data/levels/index.js), so the
// key set is computed once per level and shared by every caller on this side.
const CACHE = new WeakMap();

export function protectedKeys(level) {
  if (!level || typeof level !== 'object') return new Set();
  const hit = CACHE.get(level);
  if (hit) return hit;
  const keys = new Set();
  for (const r of sanctuaryRects(level)) {
    for (let ty = r.y0; ty <= r.y1; ty++) {
      for (let tx = r.x0; tx <= r.x1; tx++) keys.add(tileKey(tx, ty));
    }
  }
  CACHE.set(level, keys);
  return keys;
}

// The predicate. A level with no usable spawn protects nothing — that is a
// broken level, and tests/unit/sanctuary.test.js fails loudly on one rather
// than letting it ship silently unprotected.
export function isProtected(level, tx, ty) {
  return protectedKeys(level).has(tileKey(tx, ty));
}

// PARSED, never string-compared. '03,11' is a legal alias for '3,11' — every
// consumer of a key runs it through parseTileKey, so a set membership test on
// the raw string would let a hostile client pad a leading zero onto the tile
// under Mario's feet and have both clients clear it anyway.
export function filterProtected(level, keys) {
  const prot = protectedKeys(level);
  if (!prot.size || !Array.isArray(keys)) return keys;
  return keys.filter((k) => {
    const p = parseTileKey(k);
    return !p || !prot.has(tileKey(p.tx, p.ty));
  });
}

// The server's entry point: it holds island IDs, not level objects. An island
// is always a top-level level, so this is getLevel and never getArea.
export function filterProtectedForIsland(islandId, keys) {
  return filterProtected(getLevel(islandId), keys);
}

// SUB-AREAS. A level map protects its own `spawn`, whatever map it is — a
// coin room's spawn included. That is deliberately the simplest possible rule:
// the predicate is a pure function of the map it is handed, so World and Island
// cannot disagree about which map's spawn applies. In practice it never fires
// in a sub-area, because craters are never applied to one (mario-side.js's
// level hook passes damage only when areaId is null) and the pilot cannot see,
// let alone reach, Mario while he is in one.

// MARIO'S SIDE. src/game/world.js is engine and is not edited: instead the
// world INSTANCE gets its destroyTiles() wrapped, the same technique
// mario-side.js already uses on game.loadLevel and match-host.js on
// world.onLevelComplete.
//
// destroyTiles() is the one door — world.blast() calls it, and blast() is what
// Mario's client runs for a live detonation, keys and all, so filtering the
// server's key list at the network layer alone would still let the local blast
// punch through the spawn floor and diverge from the pilot's map.
//
// applyDamage() is deliberately NOT wrapped: it clears whatever the server said
// is destroyed, and Island.applyDamage does the same, unfiltered, on the other
// side. Filtering one and not the other is how they would come apart.
//
// `world.level` is read at call time, not at install time: one World instance
// loads every level and every sub-area over its life.
export function guardWorld(world) {
  if (!world || typeof world.destroyTiles !== 'function') return false;
  if (world.__sanctuaryGuarded) return false;
  const prev = world.destroyTiles.bind(world);
  world.destroyTiles = (keys) => prev(filterProtected(world.level, keys));
  Object.defineProperty(world, '__sanctuaryGuarded', { value: true, enumerable: false });
  return true;
}

// Convenience for tests and tools: is this key inside the given level's
// sanctuary? Accepts the wire form.
export function isProtectedKey(level, key) {
  const parsed = parseTileKey(key);
  return parsed ? isProtected(level, parsed.tx, parsed.ty) : false;
}
