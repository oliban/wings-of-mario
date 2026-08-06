import {
  DECK_X0, DECK_X1, DECK_Y, DECK_SURFACE_Y, HULL_BOTTOM, PLANE_W, PLANE_H,
} from './geo.js';
import { MODE, normalizeAngle } from './flight.js';

// LANDING, and what happens when you get it wrong.
//
// This used to be one envelope with one failure: break any rule — a knot too
// fast, a knot too slow, the hook still up — and the aeroplane was written off
// on the spot. That is not how the original plays and it is why landing here
// was miserable. In Wings of Fury you can come over the round-down far too fast
// and nothing explodes: you simply do not catch a wire, you float up the deck,
// and you go off the bow to try again or into the sea. The wire is what stops
// you, and missing it costs you the approach, not the aircraft.
//
// So there are three outcomes now, not two:
//
//   TRAP    the hook takes a wire. Stopped dead, rearmed, refuelled.
//   BOLTER  wheels on the deck, no wire. You roll — see stepRoll in flight.js,
//           which already runs out of deck and puts you back in the air with
//           the gear up, because that is the same thing a takeoff does. Get
//           flying speed and go round again; do not, and it is the sea.
//   CRASH   you flew into the ship. Still fatal, and it should be.
//
// The speed window is the WIRE's, not survival's. Inside it the hook catches;
// above it you are going too fast for the arrestor and you bolt.
export const LANDING = {
  // Kept as the speed the deck is COMFORTABLE at — the arrested run from here
  // is about twenty pixels — but it is no longer a rule and nothing is refused
  // for exceeding it. See landingVerdict.
  MAX_SPEED: 1.8,
  // What to AIM for on the approach: comfortably inside the wire's window with
  // room either side for a gust of stick. Not a rule — nothing is checked
  // against it — but the bots fly it and it is the number to quote a player.
  // It replaces a MIN_SPEED that used to be enforced, and killed you.
  APPROACH_SPEED: 1.2,
  // HOW LEVEL IS LEVEL ENOUGH. 0.22 rad is 12.6 degrees, and it was too fine
  // to fly by eye — the aeroplane pitches continuously and a shallow approach
  // that LOOKS level is routinely a degree or two out. 0.40 is 23 degrees:
  // still obviously an approach rather than a dive, and forgiving enough that
  // getting the height and the line right is the skill, not holding the nose
  // inside a band you cannot see. The island uses this same number.
  MAX_ANGLE: 0.40,
  Y_TOLERANCE: 10,
  X_MARGIN: 8,
};

export const OUTCOME = {
  NONE: 'none',
  TRAP: 'trap',
  BOLTER: 'bolter',
  CRASH: 'crash',
};

// The box in which the tailhook can reach a wire at all.
// HOW FAR OFF LEVEL, whichever way he is pointing. Level east is 0 and level
// west is +/-PI, and both are level: what matters for putting wheels down is
// the angle between the nose and the deck, not which end of it he came from.
export function pitchOffLevel(angle) {
  const a = normalizeAngle(angle);
  return Math.abs(a) <= Math.PI / 2 ? a : normalizeAngle(a - Math.PI);
}

// Which way he is travelling over the deck: +1 east, -1 west.
export function landingDir(p) {
  return Math.cos(p.angle) >= 0 ? 1 : -1;
}

export function inLandingBox(p) {
  const wheels = p.y + PLANE_H;
  return (
    p.x + PLANE_W > DECK_X0 + LANDING.X_MARGIN &&
    p.x < DECK_X1 &&
    wheels >= DECK_SURFACE_Y - LANDING.Y_TOLERANCE &&
    wheels <= DECK_SURFACE_Y + LANDING.Y_TOLERANCE
  );
}

// One verdict for one tick. `reason` names the rule that decided it, so a
// bolter can be explained rather than just announced.
//
// ORDER MATTERS: the two ways to fly into the ship are tested first, because
// they are fatal however fast you are doing it. Everything after them is a
// landing — good or bad — and the worst it costs is the approach.
export function landingVerdict(p) {
  if (!inLandingBox(p)) {
    return { inBox: false, ok: false, outcome: OUTCOME.NONE, reason: 'off-deck' };
  }
  // EITHER DIRECTION LANDS. Arriving westbound used to be 'wrong-way' and
  // fatal, which is a rule about the ship's geometry that the ship does not
  // actually have: a flat-top has a wire across it and no opinion about which
  // way you cross it. The user asked for both, and the arrestor run and the
  // roll now follow whichever way the nose is pointing.
  //
  // So the attitude is measured against the heading he is ACTUALLY flying —
  // level east or level west — and only being nose-up or nose-down beyond the
  // limit is a crash.
  if (Math.abs(pitchOffLevel(p.angle)) > LANDING.MAX_ANGLE) {
    return { inBox: true, ok: false, outcome: OUTCOME.CRASH, reason: 'attitude' };
  }
  // THE HOOK IS UP. Wheels touch, nothing catches — the definition of a
  // bolter, and in the original exactly what a forgotten hook gives you.
  if (!p.gear) {
    return { inBox: true, ok: false, outcome: OUTCOME.BOLTER, reason: 'hook-up' };
  }
  // NO SPEED LIMIT ON THE WIRE, by the user's call: "any speed should do when
  // landing as long as the wire catches us." Arriving fast used to be a bolter
  // and before that a fireball; it is now simply a LONGER arrested run, because
  // the cable takes the same load whatever you hit it at and just has more of
  // your energy to absorb. Come over the round-down flat out and it will drag
  // you the length of the deck and hold you at the bow.
  //
  // What is left deciding a landing is what the pilot can actually see himself
  // doing wrong: the hook, and the attitude.
  // NOTHING IS TOO SLOW ANY MORE. A minimum was enforced and destroyed the
  // aeroplane for arriving gently, which is backwards — slow is what a wire
  // wants. Coming in below flying speed is already punished, by the stall that
  // puts you in the sea before you ever reach the deck; the physics does that
  // on its own and does not need a rule.
  return { inBox: true, ok: true, outcome: OUTCOME.TRAP, reason: 'trap' };
}

// Everything solid about the ship. Hitting it anywhere but the deck is a crash.
export function hitsHull(p) {
  const wheels = p.y + PLANE_H;
  return (
    p.x + PLANE_W > DECK_X0 &&
    p.x < DECK_X1 &&
    wheels > DECK_SURFACE_Y + LANDING.Y_TOLERANCE &&
    p.y < HULL_BOTTOM
  );
}

// A BOLTER: wheels down, no wire. The aeroplane is put on the deck at the
// speed it arrived with and left to roll — stepRoll in flight.js takes it from
// here, and it already knows what to do when the deck runs out, because that is
// the same thing it does on a takeoff that never rotates: back into the air
// with the gear up. Fly away and go round again, or stall into the sea.
//
// The speed is KEPT, deliberately. Bleeding it off here would be the wire by
// another name, and the wire is the thing you missed.
export function bolt(p) {
  const dir = landingDir(p);
  p.mode = MODE.ROLL;
  p.rollDir = dir;
  p.rollEnd = dir === 1 ? DECK_X1 : DECK_X0;
  p.angle = dir === 1 ? 0 : Math.PI;
  p.turnTicks = null;
  p.turnStartAngle = null;
  p.turnDelta = null;
  p.y = DECK_SURFACE_Y - PLANE_H;
  p.vx = p.speed;
  p.vy = 0;
  // Wheels are down whether or not the hook was: you are rolling on them.
  p.gear = true;
  return p;
}

// CAUGHT. The hook has a wire and the aeroplane is being pulled up — it is on
// the deck, it is not flying, and it is still moving. It used to stop dead on
// the tick of the catch, which is why an arrestor wire could not be drawn doing
// anything: there was no distance over which to draw it stretching, and the
// aeroplane covered the one cable it had taken.
//
// `arrested` is what tells stepRoll to haul it down rather than let it coast,
// and it is also what stops the throttle doing anything: you do not fly out of
// a wire.
export function trapOn(p) {
  const dir = landingDir(p);
  p.mode = MODE.ROLL;
  p.arrested = true;
  p.rollDir = dir;
  p.rollEnd = dir === 1 ? DECK_X1 : DECK_X0;
  p.angle = dir === 1 ? 0 : Math.PI;
  p.turnTicks = null;
  p.turnStartAngle = null;
  p.turnDelta = null;
  p.y = DECK_SURFACE_Y - PLANE_H;
  p.vx = p.speed;
  p.vy = 0;
  p.gear = true;
  return p;
}

// Stopped dead on the deck, ready to be rearmed. Still used for spotting a
// fresh aircraft at the stern and for the end of an arrested run.
export function arrest(p) {
  p.mode = MODE.DECK;
  p.arrested = false;
  p.speed = 0;
  p.vx = 0;
  p.vy = 0;
  // Left as he stopped: an aeroplane that trapped westbound is parked facing
  // west, and spinning it round on the spot would be a magic trick.
  p.angle = p.rollDir === -1 ? Math.PI : 0;
  p.gear = true;
  p.y = DECK_SURFACE_Y - PLANE_H;
  return p;
}

// Put a fresh aircraft at the stern, pointing down the deck.
export function spotOnDeck(p) {
  // A fresh aeroplane is always spotted at the stern pointing down the deck,
  // whatever the last one did — so the roll state goes back to east first.
  p.rollDir = 1;
  p.rollEnd = DECK_X1;
  arrest(p);
  p.x = DECK_X0 + 16;
  return p;
}
