import { TILE } from '../core/constants.js';
import { DECK_X0, DECK_Y, SEA_Y, PLANE_W, PLANE_H, localTileToWorld } from './geo.js';
import { MODE, FLIGHT, normalizeAngle } from './flight.js';
import { LANDING } from './carrier.js';
import { release, predictImpact } from './ordnance.js';
import { distanceTo } from './sim.js';

// Scripted pilots. Every one is a pure function of sim state, so a test that
// flies a whole sortie produces the same tick counts every run. Each takes a
// tick budget and returns whether it achieved the thing — never throwing,
// never looping forever, never claiming success it did not have.
//
// There is no throttle lever and no bank-and-turn: `stepPlane`'s input is
// `{ pitch, thrust, gear }` where `pitch` is body-relative rotation (rotating
// the nose, exactly as a loop does — this game turns by looping, not
// banking) and `thrust` is a WORLD-frame direction, +1 always "thrust East".
// Whether that speeds the aeroplane up or brakes it toward a stall turn
// depends on which way it is currently facing. `seek` below never asks for
// the brake: it always thrusts the way the nose is already pointing (or
// coasts), and steers entirely by rotating toward the target — a turn that
// needs to reverse heading is flown as a half-loop, exactly like the "a loop
// is still a loop" browser test already exercises. That sidesteps the stall
// turn entirely, which is the right call for an autopilot: the manoeuvre
// exists for a human reversing under a held key, not for a scripted pilot
// that is free to choose whichever heading change costs the least altitude.

// Steer one tick's input toward a point. Not exported as sim's problem to
// solve — this is bot.js's own primitive, written fresh against flight.js as
// it stands today (see sim.js's note on why the old seek() was deleted
// rather than patched a third time).
//
//   opts.near   — unused here, read by callers (flyTo) to decide "arrived"
//   opts.floor  — a y below which the target heading is overridden with
//                 "climb", so a carrot beyond the sea (or a deck circuit
//                 that dips low) never flies the aeroplane into the water
//   opts.speed  — hold near this speed: thrust follows facing while under
//                 it, coasts (no thrust either way) once over it. Omitted
//                 means "as fast as you can get there."
//   opts.dead   — heading deadzone in radians; inside it pitch goes to 0 so
//                 the aeroplane does not chatter once it is basically
//                 pointed the right way
//   opts.gear   — passed straight through
function seek(p, tx, ty, opts = {}) {
  const dead = opts.dead != null ? opts.dead : 0.04;
  const floor = opts.floor != null ? opts.floor : Infinity;

  // Too close to the floor to trust the carrot: the only heading that
  // matters is straight up, whatever the target says.
  const target =
    p.y + PLANE_H > floor - 48
      ? -Math.PI / 2
      : Math.atan2(ty - (p.y + PLANE_H / 2), tx - (p.x + PLANE_W / 2));

  // p.angle advances by -pitch * rate each tick (see flight.js's stepAir), so
  // closing a positive diff (target is further clockwise) needs pitch < 0.
  const diff = normalizeAngle(target - p.angle);
  const pitch = Math.abs(diff) <= dead ? 0 : diff > 0 ? -1 : 1;

  const facing = Math.cos(p.angle) >= 0 ? 1 : -1;
  const wantSpeed = opts.speed != null ? opts.speed : Infinity;
  const thrust = p.speed > wantSpeed ? 0 : facing;

  return { pitch, thrust, gear: opts.gear };
}

// Full throttle down the deck, rotating the instant there is flying speed —
// exactly what a human does, holding the stick back the whole roll.
export function takeoff(sim, budget = 600) {
  const p = sim.plane;
  for (let i = 0; i < budget; i++) {
    if (p.mode === MODE.AIR) return true;
    sim.step({ thrust: 1, pitch: p.speed >= FLIGHT.TAKEOFF_SPEED ? 1 : 0 });
  }
  return p.mode === MODE.AIR;
}

export function flyTo(sim, x, y, budget = 6000, opts = {}) {
  const p = sim.plane;
  const near = opts.near == null ? 32 : opts.near;
  for (let i = 0; i < budget; i++) {
    if (p.mode === MODE.DOWN) return false;
    if (distanceTo(p, x, y) <= near) return true;
    sim.step(seek(p, x, y, opts));
  }
  return distanceTo(p, x, y) <= near;
}

// Line up west of the target, run in level toward it, and pickle the moment
// ordnance.js's own integrator says the bomb will land on the tile. Nothing
// nudges the bomb after release — the lead is solved before the bay opens,
// exactly as a human has to solve it by eye. `release('bomb', p)` here is
// never given the sim's loadout, so it costs no ammo: it is only ever used
// to ask "if I dropped now, where would it land," and the real round is
// dropped by handing `drop: true` to `sim.step`, which is what actually
// spends one from `sim.loadout`.
export function bombTile(sim, islandId, tx, ty, budget = 8000) {
  const island = sim.islandById(islandId);
  if (!island) return false;
  const corner = localTileToWorld(island.originX, tx, ty);
  const target = { x: corner.x + TILE / 2, y: corner.y + TILE / 2 };
  const cruiseY = Math.max(120, target.y - 220);

  if (!flyTo(sim, target.x - 900, cruiseY, budget, { near: 64, floor: SEA_Y })) return false;

  const p = sim.plane;
  for (let i = 0; i < budget; i++) {
    if (p.mode === MODE.DOWN) return false;
    const solution = predictImpact(release('bomb', p), target.y);
    if (solution && solution.x >= target.x - TILE / 2 && Math.cos(p.angle) > 0) {
      sim.step({ ...seek(p, target.x + 4000, cruiseY, { floor: SEA_Y }), drop: true });
      return true;
    }
    sim.step(seek(p, target.x + 4000, cruiseY, { floor: SEA_Y }));
  }
  return false;
}

// Overfly the carrier, loop back, and come in over the stern low and slow
// with the hook down. Returns true once a wire is caught.
export function autoLand(sim, budget = 8000) {
  const p = sim.plane;
  const glideY = DECK_Y - PLANE_H / 2 - 1;

  // 1. Fly the pattern: get well west of the stern, above the deck. This is
  //    what forces the reversal, since the deck only accepts an eastbound
  //    arrival — the aeroplane has to turn all the way around to line up.
  if (!flyTo(sim, DECK_X0 - 620, DECK_Y - 200, budget, { near: 56, floor: SEA_Y })) return false;

  // 2. Settle onto the glideslope. Chasing a carrot 120px directly ahead at
  //    deck height turns the aeroplane east, levels it and converges on the
  //    deck altitude, holding speed near the middle of the legal band.
  const band = (LANDING.MAX_SPEED + LANDING.MIN_SPEED) / 2;
  for (let i = 0; i < budget; i++) {
    if (p.mode === MODE.DECK) return true;
    if (p.mode === MODE.DOWN) return false;
    sim.step(seek(p, p.x + 120, glideY, { speed: band, gear: true, floor: SEA_Y, dead: 0.02 }));
  }
  return p.mode === MODE.DECK;
}
