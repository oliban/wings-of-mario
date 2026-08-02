import { CEILING_Y, DECK_X0, DECK_X1, DECK_Y, PLANE_W, PLANE_H, clamp } from './geo.js';

// Everything here is pixels PER FRAME at the fixed 60.0988Hz timestep, and
// radians per frame for rotation. Nothing reads a clock or an RNG.
//
// These are chosen together, not independently. THRUST against DRAG sets level
// cruise at 2.69 px/frame. GRAVITY against THRUST is why a climb stalls and a
// dive runs away: at full throttle a vertical climb is 0.045 - 0.06, net
// negative. TURN_RATE sets the loop at 105 ticks. ROLL_THRUST against
// ROLL_DRAG puts rotation at tick 133, 180px down a 320px deck — half the
// deck, so running out of it is a real mistake a player can make.
export const FLIGHT = {
  MAX_SPEED: 4.5,
  THRUST: 0.045,
  DRAG: 0.006,
  GRAVITY: 0.06,
  TURN_RATE: 0.06,
  TURN_SPEED_REF: 1.6,
  STALL_SPEED: 0.8,
  STALL_PULL: 0.02,
  ROLL_THRUST: 0.03,
  ROLL_DRAG: 0.01,
  TAKEOFF_SPEED: 2.2,
  FUEL_MAX: 100,
  FUEL_IDLE: 0.004,
  FUEL_THROTTLE: 0.01,
};

export const MODE = { DECK: 'deck', ROLL: 'roll', AIR: 'air', DOWN: 'down' };

// Angle is measured from +X, clockwise on screen because +Y is down:
//   0 = flying right and level, -PI/2 = straight up, PI/2 = straight down.
export function normalizeAngle(a) {
  const t = Math.PI * 2;
  let v = a % t;
  if (v > Math.PI) v -= t;
  if (v <= -Math.PI) v += t;
  return v;
}

export function turnToward(a, target, step) {
  const d = normalizeAngle(target - a);
  if (Math.abs(d) <= step) return normalizeAngle(target);
  return normalizeAngle(a + Math.sign(d) * step);
}

export function createPlane(opts = {}) {
  return {
    mode: opts.mode || MODE.DECK,
    x: opts.x != null ? opts.x : DECK_X0 + 16,
    y: opts.y != null ? opts.y : DECK_Y - PLANE_H,
    angle: opts.angle != null ? opts.angle : 0,
    speed: opts.speed || 0,
    vx: 0,
    vy: 0,
    throttle: 0,
    gear: opts.gear != null ? !!opts.gear : true,
    fuel: opts.fuel != null ? opts.fuel : FLIGHT.FUEL_MAX,
    ticks: 0,
  };
}

// input: { pitch: -1..1 (+1 pulls the nose UP), throttle: 0..1, gear: bool }
export function stepPlane(p, input = {}) {
  if (p.mode === MODE.DOWN) return p;

  const pitch = clamp(input.pitch || 0, -1, 1);
  let throttle = clamp(input.throttle == null ? 0 : input.throttle, 0, 1);
  if (p.fuel <= 0) throttle = 0;
  p.throttle = throttle;
  if (input.gear != null) p.gear = !!input.gear;

  if (p.mode === MODE.DECK || p.mode === MODE.ROLL) stepRoll(p, pitch, throttle);
  else stepAir(p, pitch, throttle);

  p.fuel = Math.max(0, p.fuel - (FLIGHT.FUEL_IDLE + FLIGHT.FUEL_THROTTLE * throttle));
  p.ticks++;
  return p;
}

// The takeoff roll. The plane is pinned to the deck, gains speed against
// rolling friction, and only rotates once there is air over the wings.
function stepRoll(p, pitch, throttle) {
  p.angle = 0;
  p.y = DECK_Y - PLANE_H;
  p.speed += FLIGHT.ROLL_THRUST * throttle - FLIGHT.ROLL_DRAG * p.speed;
  if (p.speed < 0) p.speed = 0;
  p.x += p.speed;
  p.vx = p.speed;
  p.vy = 0;
  p.mode = p.speed > 0 ? MODE.ROLL : MODE.DECK;

  if (pitch > 0 && p.speed >= FLIGHT.TAKEOFF_SPEED) {
    p.mode = MODE.AIR;
    p.gear = false;
    return;
  }
  // Ran out of deck. Airborne below flying speed is a stall, and a stall this
  // low is the sea. Nothing special-cases it; the physics does it.
  if (p.x >= DECK_X1) {
    p.mode = MODE.AIR;
    p.gear = false;
  }
}

function stepAir(p, pitch, throttle) {
  const authority = Math.min(1, p.speed / FLIGHT.TURN_SPEED_REF);
  p.angle = normalizeAngle(p.angle - pitch * FLIGHT.TURN_RATE * authority);

  // Below flying speed the nose falls toward straight down whatever the stick
  // is doing. This is what makes a botched climb cost altitude.
  if (p.speed < FLIGHT.STALL_SPEED) {
    p.angle = turnToward(p.angle, Math.PI / 2, FLIGHT.STALL_PULL);
  }

  p.speed += FLIGHT.THRUST * throttle;
  p.speed += FLIGHT.GRAVITY * Math.sin(p.angle);
  p.speed -= FLIGHT.DRAG * p.speed * p.speed;
  p.speed = clamp(p.speed, 0, FLIGHT.MAX_SPEED);

  p.vx = Math.cos(p.angle) * p.speed;
  p.vy = Math.sin(p.angle) * p.speed;
  p.x += p.vx;
  p.y += p.vy;

  // The ceiling. Climbing into it levels the nose rather than stopping the
  // plane dead, so it reads as a service ceiling and not as a wall.
  if (p.y < CEILING_Y) {
    p.y = CEILING_Y;
    if (p.vy < 0) {
      p.angle = Math.cos(p.angle) >= 0 ? 0 : Math.PI;
      p.vy = 0;
      p.vx = Math.cos(p.angle) * p.speed;
    }
  }
}

// Where the nose is, in world pixels — the muzzle, the bomb release point and
// the point that decides whether the plane flew into a hillside.
export function nosePoint(p) {
  const r = PLANE_W / 2;
  return {
    x: p.x + r + Math.cos(p.angle) * r,
    y: p.y + PLANE_H / 2 + Math.sin(p.angle) * r,
  };
}
