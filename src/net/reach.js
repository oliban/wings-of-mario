import { ISLAND_TOP_Y, assertLocalY } from '../wings/geo.js';

// WHERE THE PLANE CANNOT FOLLOW.
//
// Mario's engine loads bonus rooms, pipe interiors, coin heaven and warp zones
// as SUB-AREAS of a level: the same level id, an entirely different tile map,
// and island-local coordinates that mean something else. The coordinate
// contract in pilot-side.js — world.x = originX + mario.x, world.y =
// ISLAND_TOP_Y + mario.y — is a statement about the island's own tile map, so
// running a warp-zone position through it yields a coordinate that is
// arithmetically fine and physically nowhere: Mario drawn floating in mid-air
// over an island he is not standing on, and a radar blip the pilot can chase
// and bomb while the man himself is underground.
//
// THE SIGNAL is world.areaId. src/game/world.js#loadLevel sets it to the area
// id when a sub-area is loaded and to null for the main level, and the engine
// reads it exactly this way itself — src/game/blocks.js bails out of its
// per-level seeding `if (w.areaId)`, and src/main.js reloads the current place
// with `game.loadLevel(game.levelId, game.world.areaId)`. Note what does NOT
// work: game.levelId (and so __GAME.stats().level, and so the `island` on the
// wire) stays '1-1' the whole time Mario is down the pipe, which is precisely
// why the pilot's side could not see this coming.
//
// THE DECISION IS MADE HERE, on Mario's side of the wire, and travels as a
// flag in the snapshot. Mario's client owns Mario (spec 7.3): it is the only
// one that knows which of his level's maps he is standing on. The pilot's
// client must never try to infer this from a position that looks wrong — a y
// that reads as mid-air over 1-1 is a legitimate y for a jumping Mario, and a
// guess that is right most of the time is a guess.

// `reach` is a number on the wire and discrete in meaning, so it must never be
// interpolated: halfway between reachable and not is 0.5, which is not a place.
// Callers building an Interp for Mario's snapshots pass this.
export const REACH_SNAP = ['reach'];

export function isReachable(world) {
  if (!world) return false;
  // Non-null areaId = a sub-area = a map the aeroplane has no way to fly to.
  return !world.areaId;
}

// The body of Mario's 20Hz snapshot. Out of reach, it carries NO POSITION AT
// ALL rather than a position with a flag beside it, and that is deliberate
// twice over. It is honest — this side has no opinion about where he is in the
// pilot's world, and none of the numbers it could send would be one. And it
// makes the re-emergence correct for free: interp.js only blends a field when
// BOTH samples hold a number, so the first sample back after a stretch of
// absent positions snaps to where he actually came up instead of sliding him
// across the sky from wherever he went down.
export function marioSnapshot(world, island) {
  const p = world && world.player;
  if (!p) return null;
  const reach = isReachable(world) ? 1 : 0;
  // What the match needs whether or not he can be seen: which island he will
  // come back up on, and his own numbers.
  const s = {
    island,
    reach,
    power: p.power,
    state: p.state,
    lives: world.lives,
  };
  if (!reach) return s;
  return {
    ...s,
    x: p.x, y: p.y, vx: p.vx, vy: p.vy,
    facing: p.facing,
    grounded: p.grounded ? 1 : 0,
  };
}

// The pilot's end: one sampled snapshot and the origin of the island it names,
// into a world-space contact — or null, which means draw nothing anywhere. The
// null is the whole feature: scene.js#drawContact returns early on it and the
// radar is handed {present: false}.
export function contactFrom(s, originX) {
  if (!s || !s.reach) return null;
  // An island this pilot has not laid out; nothing to draw.
  if (originX == null) return null;
  if (typeof s.x !== 'number' || typeof s.y !== 'number') return null;
  // The seam the guard exists for: everything above this line is island-local
  // and everything below it is world space.
  assertLocalY(s.y, 'mario snapshot y');
  return {
    x: originX + s.x,
    y: ISLAND_TOP_Y + s.y,
    facing: s.facing,
    island: s.island,
  };
}
