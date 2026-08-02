import { DECK_X0, DECK_X1, DECK_Y, HULL_BOTTOM, PLANE_W, PLANE_H } from './geo.js';
import { MODE, normalizeAngle } from './flight.js';

// The envelope. Outside any one of these the hook does not catch and the
// aircraft is written off.
export const LANDING = {
  MAX_SPEED: 1.8,
  MIN_SPEED: 0.6,
  MAX_ANGLE: 0.22,
  Y_TOLERANCE: 10,
  X_MARGIN: 8,
};

// The box in which the tailhook can reach a wire at all.
export function inLandingBox(p) {
  const wheels = p.y + PLANE_H;
  return (
    p.x + PLANE_W > DECK_X0 + LANDING.X_MARGIN &&
    p.x < DECK_X1 &&
    wheels >= DECK_Y - LANDING.Y_TOLERANCE &&
    wheels <= DECK_Y + LANDING.Y_TOLERANCE
  );
}

// One verdict for one tick. `reason` names the first rule broken, so a crash
// can be explained rather than just announced.
export function landingVerdict(p) {
  if (!inLandingBox(p)) return { inBox: false, ok: false, reason: 'off-deck' };
  if (!p.gear) return { inBox: true, ok: false, reason: 'hook-up' };
  if (Math.cos(p.angle) <= 0) return { inBox: true, ok: false, reason: 'wrong-way' };
  if (Math.abs(normalizeAngle(p.angle)) > LANDING.MAX_ANGLE) {
    return { inBox: true, ok: false, reason: 'attitude' };
  }
  if (p.speed > LANDING.MAX_SPEED) return { inBox: true, ok: false, reason: 'too-fast' };
  if (p.speed < LANDING.MIN_SPEED) return { inBox: true, ok: false, reason: 'too-slow' };
  return { inBox: true, ok: true, reason: 'trap' };
}

// Everything solid about the ship. Hitting it anywhere but the deck is a crash.
export function hitsHull(p) {
  const wheels = p.y + PLANE_H;
  return (
    p.x + PLANE_W > DECK_X0 &&
    p.x < DECK_X1 &&
    wheels > DECK_Y + LANDING.Y_TOLERANCE &&
    p.y < HULL_BOTTOM
  );
}

// Caught a wire: stopped dead on the deck, ready to be rearmed.
export function arrest(p) {
  p.mode = MODE.DECK;
  p.speed = 0;
  p.vx = 0;
  p.vy = 0;
  p.angle = 0;
  p.gear = true;
  p.y = DECK_Y - PLANE_H;
  return p;
}

// Put a fresh aircraft at the stern, pointing down the deck.
export function spotOnDeck(p) {
  arrest(p);
  p.x = DECK_X0 + 16;
  return p;
}
