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
import { tileForChar } from '../data/tiles.js';

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

// THE WARP-ZONE PIPES, which no bomb takes either.
//
// A pipe into a warp zone is not scenery and it is not a bonus: it is the one
// route in the game that skips whole worlds. Blow its mouth off and that route
// is gone for the rest of the match, because craters are permanent — and unlike
// a cratered floor there is nothing Mario can do about it. That is a piece of
// the game quietly deleted rather than the pilot stranding him, which is a
// legitimate win with counterplay and is untouched.
//
// ONLY THE WARP ZONE, by the user's call: "only the pipe on 1-1 to warp zone
// indestructible, not other pipes". 1-1 has three pipes that go somewhere and
// they are not equal — 1-1b is a coin room, 1-1h is Harry's painted level, and
// 1-1w is the warp zone with a warp to all thirty-two levels. The first two are
// fair game; bombing them costs Mario some coins and a detour. So the test is
// not "does this pipe warp" but "does it lead somewhere that skips levels":
//
//   * a warp straight to another level — 1-2's three pipes to 2-1, 3-1 and 4-1,
//     which ARE the warp zone at the end of that level;
//   * a warp into an area that itself holds two or more level warps — 1-1w,
//     reached from the pipe at tile 28.
//
// Two or more, not one: 1-1h warps to h-1 and is a single painted level, not a
// choice of destinations. That threshold is what separates a warp zone from a
// door.
//
// FOUND BY FLOOD FILL from the warp's own `from` tile, not by guessing a
// rectangle. Every warp names the tile that triggers it and that tile is the
// pipe's mouth; a pipe is a contiguous run of tiles whose record carries a
// `pipe` face (data/tiles.js ids 10-16). So the shape comes out of the level
// data exactly, whichever way the pipe points and however long it is, and a
// level that gains a warp zone is covered with no code change.
const PIPE_FILL_LIMIT = 256;

// How many level destinations an area needs before it counts as a warp zone
// rather than a door to one particular place.
const WARP_ZONE_EXITS = 2;

// Does this warp lead somewhere that skips levels? `level` is the whole level
// object, because an area destination has to be looked up in it.
function leadsToWarpZone(level, warp) {
  const to = warp && warp.to;
  if (!to) return false;
  // Straight to another level: this pipe IS a warp zone exit.
  if (to.level) return true;
  if (!to.area || !level.areas) return false;
  const area = level.areas[to.area];
  if (!area || !Array.isArray(area.warps)) return false;
  return area.warps.filter((w) => w && w.to && w.to.level).length >= WARP_ZONE_EXITS;
}

const isPipeChar = (ch) => {
  if (typeof ch !== 'string' || !ch) return false;
  const t = tileForChar(ch);
  return !!(t && t.pipe);
};

export function warpPipeKeys(level) {
  const out = new Set();
  if (!level || !Array.isArray(level.tiles) || !Array.isArray(level.warps)) return out;
  const rows = level.tiles;
  const h = rows.length;
  const w = level.width | 0;
  const at = (tx, ty) => (ty < 0 || ty >= h || tx < 0 || tx >= w ? null : (rows[ty] || '')[tx]);

  for (const warp of level.warps) {
    const from = warp && warp.from;
    if (!from) continue;
    // A coin room, a bonus, one of Harry's levels: bombing the way in costs
    // Mario a detour and some coins, which is exactly the sort of damage the
    // pilot is supposed to be able to do.
    if (!leadsToWarpZone(level, warp)) continue;
    const sx = Math.floor(from.x);
    const sy = Math.floor(from.y);
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
    // A warp whose mouth is not a pipe at all — a door, a vine, a lip Mario
    // walks into. There is nothing to protect and nothing to guess at.
    if (!isPipeChar(at(sx, sy))) continue;
    // Four-connected, and bounded: a malformed level must not spin here.
    const stack = [[sx, sy]];
    const seen = new Set([tileKey(sx, sy)]);
    while (stack.length && seen.size <= PIPE_FILL_LIMIT) {
      const [tx, ty] = stack.pop();
      out.add(tileKey(tx, ty));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx;
        const ny = ty + dy;
        const k = tileKey(nx, ny);
        if (seen.has(k) || !isPipeChar(at(nx, ny))) continue;
        seen.add(k);
        stack.push([nx, ny]);
      }
    }
  }
  return out;
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
  // The same set the server filters with and the same set both clients refuse
  // to destroy, so a warp pipe cannot come apart between the three of them.
  for (const k of warpPipeKeys(level)) keys.add(k);
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
