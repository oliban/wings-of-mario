import { TILE } from '../core/constants.js';
import { DECK_X1, DECK_SURFACE_Y, ISLAND_TOP_Y, PLANE_W, PLANE_H } from './geo.js';
import { MODE, FLIGHT, stepPlane, normalizeAngle } from './flight.js';
import { LANDING, pitchOffLevel, landingDir } from './carrier.js';

// PUTTING IT DOWN ON AN ISLAND.
//
// The carrier is not the only flat thing in the ocean. Some of Mario's levels
// have a long enough run of unbroken ground that an aeroplane could land on it,
// and a pilot who finds one and gets the approach right should be allowed to.
//
// WHAT IT BUYS HIM: the airframe, and nothing else. No rearm, no refuel. The
// bombs and the fuel are on the ship and that has to stay the reason to fly
// home — an island that rearmed him would delete the return leg and with it the
// carrier. He is down, he is safe, and he can take off again along the same
// ground he stopped on.
//
// THE OUTCOMES are the carrier's, minus the one that needs a wire:
//
//   ROLLOUT  wheels down, decelerating on rolling friction. Exactly a bolter —
//            the same stepRoll, run in a different frame (see stepGroundRoll),
//            so it runs off the end of the strip and back into the air the same
//            way a bolter runs off the bow.
//   CRASH    nose-down, backwards, or belly-first. Fatal, as it is on the deck.
//
// There is deliberately NO speed rule. On the ship the speed window belongs to
// the arrestor wire, and an island has no wire to be too fast for: arriving
// quickly just means a longer rollout, and a rollout longer than the strip is
// the strip running out. That is the same mistake and the same consequence as
// the bow, which is the point.
//
// This file is pure — no canvas, no DOM, no clock, no RNG — for the reason
// carrier.js and stranded.js are: the decision is worth being testable on its
// own, and sim.js is the only thing that has to know an aeroplane is flying.

// ---------------------------------------------------------------------------
// How much ground it takes
// ---------------------------------------------------------------------------

// stepRoll's own stop floor, restated. flight.js keeps it module-private (it is
// an implementation detail of the roll, not a tuning knob), and duplicating one
// number is cheaper than widening that file's exports — but the two must agree,
// which the tests check by rolling a real aeroplane and comparing the distance
// against rolloutPx rather than by trusting the number.
const ROLL_STOP = 0.05;

// The rollout, in pixels, from a touchdown at `v0`. This is stepRoll's coasting
// arithmetic and not an approximation of it — speed decays proportionally, then
// the ROLL_STOP floor cuts the tail that proportional drag would otherwise creep
// through for ever. It is here rather than as a hand-measured constant so that
// tuning ROLL_DRAG moves the runway requirement with it instead of quietly
// leaving MIN_RUNWAY_TILES describing an aeroplane that no longer exists.
export function rolloutPx(v0, F = FLIGHT) {
  let v = v0;
  let x = 0;
  // A guard, not a rule: 1.8 px/f is stopped inside 1200 ticks.
  for (let i = 0; i < 20000 && v > 0; i++) {
    v -= F.ROLL_DRAG * v;
    if (v < ROLL_STOP) v = 0;
    x += v;
  }
  return x;
}

// SEVERAL TILES longer than the rollout needs, per the design call that landing
// out has to be genuinely hard to find. The anchor is the carrier's own wire
// window: a strip has to swallow an arrival at the top of the speed an arrestor
// would still have caught (LANDING.MAX_SPEED), the aeroplane's own length, and
// four tiles of "you did not have to be perfect". Anything faster than that is
// legal and simply may not fit — see the note above about running out of strip.
export const RUNWAY_MARGIN_TILES = 4;

export const MIN_RUNWAY_TILES =
  Math.ceil((rolloutPx(LANDING.MAX_SPEED) + PLANE_W) / TILE) + RUNWAY_MARGIN_TILES;

export const RUNWAY = {
  // GROUND, NOT A ROOF. The surface tile has to have solid material under it.
  //
  // Without this every underground and castle level is an aerodrome: their
  // ceilings are one unbroken row of '#' running the whole width of the map —
  // 8-4's is 317 tiles — with nothing but open sky above, so a "flat, solid,
  // unbroken, clear above" test alone hands the pilot a perfect runway on the
  // x-4 of every single archipelago. Landing on the lid of a hollow level is
  // also just wrong: an aeroplane needs ground.
  //
  // Two tiles is enough to tell the two apart. The rock mass at the west end of
  // 1-4 is twelve rows deep and still qualifies; 8-4's one-tile roof does not.
  DEPTH_TILES: 2,
  // Rows of air the aeroplane needs over the strip to fly in at all. Two tiles
  // is 32px against a 12px aeroplane: it can pass under 1-1's brick rows, which
  // sit four rows up, and cannot squeeze under a pipe.
  CLEAR_TILES: 2,
  // How far either way a strip is walked before we stop caring. Nothing is this
  // long (the widest flat run in the shipped levels is 122 tiles) and it bounds
  // the one loop that runs on a touchdown.
  SCAN_TILES: 128,
};

export const ISLAND_OUTCOME = {
  NONE: 'none',
  ROLLOUT: 'rollout',
  CRASH: 'crash',
};

// ---------------------------------------------------------------------------
// Finding a strip
// ---------------------------------------------------------------------------

// The topmost tile in a column an aeroplane would hit, or null for open sky.
// `blocksTile` is the predicate deliberately: it is the same one that decides a
// plane has flown into a hillside (sim.checkPlane), so the surface you land on
// is by construction the surface that kills you. A coin, a bush or a cloud is
// scenery and is not ground.
//
// Because it is the TOPMOST blocking tile, "clear air above" needs no rule of
// its own — there is nothing above it by definition, all the way up through the
// island's own rows and out into open sky. A floating brick row does not shade a
// runway; it becomes the surface of its own columns and breaks the run, which is
// exactly right, because the wheels would find the bricks first.
// THE GROUND, not the topmost thing in the column.
//
// This used to return the first blocking tile from the sky down, which meant a
// single question block or brick row four rows overhead became "the surface" of
// its column and broke the strip. 1-1 is littered with them, and the result was
// that eighteen levels — all of world 1 bar 1-4 — had no runway at all and the
// user's aeroplane simply flew into the ground: "Landing on a level makes plane
// crash. I want to be able to."
//
// A pilot lands on the road, under the overhead signs. So the surface is the
// LOWEST blocking tile the column has (the floor), and anything above it is an
// obstacle to be cleared, not a new surface — see clearAbove().
export function surfaceRow(island, tx) {
  if (tx < 0 || tx >= island.w) return null;
  for (let ty = island.h - 1; ty >= 0; ty--) {
    if (island.blocksTile(tx, ty)) {
      // The floor's own TOP: walk up through the solid mass to its first row.
      let top = ty;
      while (top > 0 && island.blocksTile(tx, top - 1)) top--;
      return top;
    }
  }
  return null;
}

// Is there room to fly in over this column at the strip's height? The
// aeroplane is PLANE_H tall and arrives shallow, so it needs a couple of tiles
// of air above the wheels — enough to pass under a brick row, not enough to
// squeeze under a pipe.
export function clearAbove(island, tx, ty) {
  for (let d = 1; d <= RUNWAY.CLEAR_TILES; d++) {
    if (ty - d < 0) break;
    if (island.blocksTile(tx, ty - d)) return false;
  }
  return true;
}

// The same column, but only if what is under the surface is ground rather than
// a lid. See RUNWAY.DEPTH_TILES.
export function groundRow(island, tx) {
  const ty = surfaceRow(island, tx);
  if (ty == null) return null;
  for (let d = 1; d < RUNWAY.DEPTH_TILES; d++) {
    if (!island.blocksTile(tx, ty + d)) return null;
  }
  // Headroom, or it is not a runway however flat it is: a column with a pipe
  // or a low ledge over it is somewhere the aeroplane cannot get down to.
  if (!clearAbove(island, tx, ty)) return null;
  return ty;
}

// The strip through column `tx`, or null when there isn't one. Walks out in both
// directions for as long as the ground stays at the same row; a single tile at a
// different height ends it, which is why bombing a runway destroys it and why
// almost every overworld level has none.
//
// The returned geometry is in WORLD pixels: `y` is the top of the surface tile —
// where the wheels rest — and `x1` is the right edge of the last tile.
export function runwayAt(island, tx) {
  const ty = groundRow(island, tx);
  if (ty == null) return null;
  let tx0 = tx;
  let tx1 = tx;
  while (tx0 > 0 && tx - tx0 < RUNWAY.SCAN_TILES && groundRow(island, tx0 - 1) === ty) tx0--;
  while (
    tx1 + 1 < island.w
    && tx1 - tx < RUNWAY.SCAN_TILES
    && groundRow(island, tx1 + 1) === ty
  ) tx1++;
  const tiles = tx1 - tx0 + 1;
  if (tiles < MIN_RUNWAY_TILES) return null;
  return {
    island: island.id,
    ty,
    tx0,
    tx1,
    tiles,
    y: ISLAND_TOP_Y + ty * TILE,
    x0: island.originX + tx0 * TILE,
    x1: island.originX + (tx1 + 1) * TILE,
  };
}

// Every strip on an island, left to right. Used by the scripted pilot and by
// the tests that ask which levels are landable at all; the sim itself never
// needs the whole list, only the one under the wheels.
export function runways(island) {
  const out = [];
  let tx = 0;
  while (tx < island.w) {
    const r = runwayAt(island, tx);
    if (r) {
      out.push(r);
      tx = r.tx1 + 1;
    } else tx++;
  }
  return out;
}

// The strip under a point, gated on the point being close enough to the ground
// to be a touchdown at all. The gate is first and cheap so that the walk above
// only runs on the handful of ticks where an aeroplane is actually near a
// surface, rather than sixty times a second for the whole sortie.
export function runwayUnder(island, px, py) {
  const tx = Math.floor((px - island.originX) / TILE);
  const ty = groundRow(island, tx);
  if (ty == null) return null;
  const y = ISLAND_TOP_Y + ty * TILE;
  if (Math.abs(py - y) > LANDING.Y_TOLERANCE) return null;
  return runwayAt(island, tx);
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

// The box in which the wheels can find the strip at all — the carrier's
// inLandingBox with the deck's numbers replaced by this strip's, and the same
// tolerances, because a landing should not be measured to a different standard
// depending on what it is landing on.
export function inRunwayBox(p, r) {
  if (!r) return false;
  const wheels = p.y + PLANE_H;
  return (
    p.x + PLANE_W > r.x0 + LANDING.X_MARGIN
    && p.x < r.x1
    && wheels >= r.y - LANDING.Y_TOLERANCE
    && wheels <= r.y + LANDING.Y_TOLERANCE
  );
}

// One verdict for one tick, in landingVerdict's shape and with its ordering
// discipline: the ways to fly INTO the ground are tested first, because they are
// fatal however fast or slow you were doing it, and everything after them is a
// landing.
//
// The gear is the last of the three and it is a CRASH here, where a raised hook
// on the deck is only a bolter. That is not a harsher rule, it is the same
// switch meaning a different thing: on the ship the wheels are down whatever the
// hook is doing and the worst a raised hook costs is the wire. On an island
// there is no wire, so the switch is the undercarriage, and arriving without it
// is not a landing at all — it is the belly hitting terrain, which is the third
// of the three ways to crash.
export function islandVerdict(p, r) {
  if (!inRunwayBox(p, r)) {
    return { inBox: false, ok: false, outcome: ISLAND_OUTCOME.NONE, reason: 'off-strip' };
  }
  // EITHER DIRECTION, exactly as on the carrier: a strip of flat ground has no
  // opinion about which way you roll along it. What is measured is how far off
  // LEVEL the nose is, whichever heading he is flying — see pitchOffLevel in
  // src/wings/carrier.js, which both sides share so the two can never drift.
  if (Math.abs(pitchOffLevel(p.angle)) > LANDING.MAX_ANGLE) {
    return { inBox: true, ok: false, outcome: ISLAND_OUTCOME.CRASH, reason: 'attitude' };
  }
  // WHEELS UP IS NOT A LANDING ATTEMPT AT ALL — and it is not a crash either.
  // It was a crash, which meant a low strafing pass over a beach wrote the
  // aeroplane off for the crime of flying low. The gear switch is what says "I
  // mean to put it down here", so without it this simply is not a landing and
  // the aeroplane flies on. If he is genuinely too low he will meet the terrain
  // check a tick later, exactly as he always did.
  if (!p.gear) {
    return { inBox: false, ok: false, outcome: ISLAND_OUTCOME.NONE, reason: 'gear-up' };
  }
  return { inBox: true, ok: true, outcome: ISLAND_OUTCOME.ROLLOUT, reason: 'rollout' };
}

// DOWN. The aeroplane is put on the strip at the speed it arrived with and left
// to roll — this is carrier.js's bolt() with the deck swapped for the ground,
// and the speed is KEPT for the same reason: nothing here is a wire, so nothing
// here is entitled to take the energy away.
export function touchdown(p, r) {
  const dir = landingDir(p);
  p.mode = MODE.ROLL;
  p.rollDir = dir;
  // The end of the strip he is rolling towards. In deck space stepRoll ends the
  // run at p.rollEnd; stepGroundRoll translates the strip onto the deck, so this
  // is the deck-space x of whichever end of the strip is ahead of him.
  p.rollEnd = dir === 1 ? DECK_X1 : DECK_X1 - (r.x1 - r.x0);
  p.angle = dir === 1 ? 0 : Math.PI;
  p.turnTicks = null;
  p.turnStartAngle = null;
  p.turnDelta = null;
  p.arrested = false;
  p.y = r.y - PLANE_H;
  p.vx = p.speed;
  p.vy = 0;
  p.gear = true;
  return p;
}

// ---------------------------------------------------------------------------
// Rolling on it
// ---------------------------------------------------------------------------

// THE GROUND ROLL IS THE DECK ROLL, RUN IN A SHIFTED FRAME.
//
// stepRoll in flight.js already does every part of this — rolling friction, the
// stop floor, rotating off at TAKEOFF_SPEED, and running out of surface back
// into the air with the gear up — but it names the carrier directly: it pins
// `p.y` to DECK_SURFACE_Y and ends the roll at DECK_X1. Writing a second copy with an
// island's numbers in it would be two roll models that agree today and drift the
// first time either is tuned, and the roll is precisely the thing the design
// asks to be shared with the bow.
//
// So the aeroplane is translated into deck space for the duration of the step
// and translated back out: the strip's right edge is put on the bow and its
// surface on the deck. Every term stepRoll uses is either a velocity or a
// difference, so a rigid translation cannot change the answer — the roll a
// bolter flies and the roll an island landing flies are, arithmetically, the
// same roll.
//
// Only ever called with the aeroplane already on the ground. A step that leaves
// MODE.ROLL/MODE.DECK sets the mode and returns without moving again (see
// stepRoll), so no airborne arithmetic ever happens in the shifted frame.
export function stepGroundRoll(p, input, r) {
  if (p.mode !== MODE.ROLL && p.mode !== MODE.DECK) return stepPlane(p, input);
  const dx = r.x1 - DECK_X1;
  const dy = r.y - DECK_SURFACE_Y;
  p.x -= dx;
  p.y -= dy;
  stepPlane(p, input);
  p.x += dx;
  p.y += dy;
  return p;
}

export default islandVerdict;
