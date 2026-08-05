// NOTICING THAT MARIO BUILT SOMETHING.
//
// The toolbelt's brick bomb lays a row of five bricks by calling
// `world.setTile(tx, ty, '=')` (src/game/entities/brickbomb.js). Mario's client
// has to announce those tiles, because the pilot's island is static level data
// plus two key sets and has no idea a brick bomb exists — and because ownership
// (spec 7.3) puts anything about Mario's level on Mario's client.
//
// So: wrap `setTile` on the WORLD INSTANCE. The same technique guardWorld()
// uses on destroyTiles and src/net/mario-side.js uses on game.loadLevel, and
// for the same reason — the upstream diff is 150 lines across three files and
// this is not worth a 151st.
//
// WHAT COUNTS AS A BUILD: a tile that was not solid before the call and is
// solid after it. Read back off the engine's own tile records rather than
// judged from the character, which is what keeps this file free of
// src/data/tiles.js (it builds every sprite in the game at module load and
// needs a canvas) and what makes it honest — the engine's opinion of what it
// just wrote is the only one that matters.
//
// In practice that predicate is the brick bomb and nothing else. Every other
// setTile in the engine either writes air over something solid (a shattered
// brick, world.js's pipe and vine carving, blocks.js's block removal) or writes
// the spent-block character over a question block, which was solid already:
//
//   src/game/blocks.js:474,496,558   '?' -> 'U'   solid before, solid after
//   src/game/blocks.js:635,686       -> '.'       air after
//   src/game/world.js:1593,1622,2198,2208,2344 -> '.'
//   src/game/entities/brickbomb.js:538 -> '='     THE ONE
//
// The reverse direction — solid becoming air, which is Mario shattering a brick
// with his head — is deliberately NOT reported. Destruction is the pilot's to
// own on the wire (`detonate` is his event), a bumped block is not terrain the
// aeroplane cares about, and inventing a second, mario-owned destroy path is a
// whole design decision rather than a side effect of this one.

import { tileKey } from './blast.js';

// Solid enough to stand on, including one-way platforms — the same question
// Island#blocksTile asks, so both ends agree about what a "build" is.
function solidRec(rec) {
  return !!(rec && (rec.solid || rec.platform));
}

/**
 * Wrap `world.setTile` so every tile that turns solid is reported to `onBuild`
 * as a `"tx,ty"` key. Returns true if it installed, false if the world is
 * unusable or already watched — idempotent, like guardWorld, because the
 * callers that keep it installed across a level load call it every frame.
 *
 * The wrap is permanent for the life of the world object and cannot be undone;
 * a caller that needs to stop listening changes what its callback does.
 */
export function watchBuilds(world, onBuild) {
  if (!world || typeof world.setTile !== 'function' || typeof world.recAt !== 'function') {
    return false;
  }
  if (world.__brickWatched) return false;
  const prev = world.setTile.bind(world);
  world.setTile = (tx, ty, ch) => {
    const before = solidRec(world.recAt(tx, ty));
    const out = prev(tx, ty, ch);
    // Read AFTER the call, never predicted from `ch`: setTile refuses anything
    // off the map, and a refusal that this file counted as a build would put a
    // key on the wire that no client can place.
    if (!before && solidRec(world.recAt(tx, ty))) {
      const cb = world.__brickWatch;
      if (cb) cb(tileKey(tx, ty), tx, ty);
    }
    return out;
  };
  // The callback lives on the world rather than in the closure so that a second
  // watchBuilds() call — a reconnect, a re-install after a level load — can
  // REPLACE it without stacking a second wrapper on top of the first. Two
  // wrappers would report every brick twice.
  Object.defineProperty(world, '__brickWatch', {
    value: onBuild,
    writable: true,
    enumerable: false,
  });
  Object.defineProperty(world, '__brickWatched', { value: true, enumerable: false });
  return true;
}

// Point an already-watched world at a different callback. Returns false if it
// was never watched, so a caller can tell "re-pointed" from "needs installing".
export function repointBuilds(world, onBuild) {
  if (!world || !world.__brickWatched) return false;
  world.__brickWatch = onBuild;
  return true;
}

// Install or re-point, whichever this world needs. This is what a caller that
// runs every frame wants: it costs one property read once the wrap is in.
export function keepWatchingBuilds(world, onBuild) {
  return watchBuilds(world, onBuild) || repointBuilds(world, onBuild);
}

export default watchBuilds;
