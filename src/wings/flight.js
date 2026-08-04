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
  // Deceleration from holding the arrow AGAINST the direction of travel —
  // real thrust the other way, not a lever released. Matched to THRUST: the
  // same engine, run backwards, decelerates a cruising aeroplane (2.69 px/f)
  // to zero in about 60 ticks (~1s) — "for a while" to build speed up,
  // roughly the same "for a while" to bring it back down.
  BRAKE: 0.045,
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
  // The stall turn: reaching zero airspeed with the stick still held against
  // you wings the aeroplane over onto the new heading rather than leaving it
  // dead in the air. 70 ticks (~1.16s) is long enough that the eye reads a
  // heavy aeroplane swinging its nose through the vertical and back out the
  // other side, rather than a sprite flipping. It was 26 (~0.43s), which
  // erred short on the grounds that a player does this constantly; at that
  // length the roll in scene.js could not keep up with the heading (33
  // degrees of bank lag at the midpoint) and the whole thing was over before
  // it registered as a manoeuvre at all.
  //
  // The sweep always passes through PI/2 (straight down in world terms) at
  // its midpoint regardless of which way it started, which is what makes
  // every reversal cost a bit of altitude rather than alternating between
  // diving and climbing depending on which way the player happened to be
  // facing. Because the sink is that dip integrated, and nothing else, a
  // longer turn costs proportionally more height: ~31px now against ~11px
  // before. That is deliberate and is not compensated for here: the lowest
  // you can reverse from over open sea and still fly away drops from y~537
  // to y~518, so the band of altitude where changing ends kills you roughly
  // doubles. Turning low is now a decision. It is still clear of the deck —
  // a reversal from flight-deck height comes out ~29px above the water.
  STALL_TURN_TICKS: 70,
  // A little airspeed is kept through the whole manoeuvre — a real wingover
  // carries forward drift, it does not pivot on the spot — and this is also
  // what the aeroplane exits the turn already flying at, so accelerating
  // away afterward is a continuation, not a second standing start. Left
  // alone when the turn was lengthened: trimming it to claw back the extra
  // sink would have paid for it out of the exit speed, which is the one
  // thing this constant exists to protect.
  STALL_TURN_DRIFT: 0.9,
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
    // The stall turn in progress, or null. See stepTurn. turnTicks counts up
    // from 0; turnStartAngle and turnDelta fix the arc for its whole
    // duration, decided once at the moment the turn is triggered.
    turnTicks: opts.turnTicks != null ? opts.turnTicks : null,
    turnStartAngle: opts.turnStartAngle != null ? opts.turnStartAngle : null,
    turnDelta: opts.turnDelta != null ? opts.turnDelta : null,
  };
}

// input: { pitch: -1..1 (+1 pulls the nose UP, -1 noses it DOWN — always
// body-relative, unaffected by which way the aeroplane is facing), thrust:
// -1..1 (+1 is "thrust East", -1 is "thrust West" — a world-frame direction,
// not a lever position: whether that accelerates or decelerates the
// aeroplane depends on which way it is currently travelling, see stepAir),
// gear: bool }
export function stepPlane(p, input = {}) {
  if (p.mode === MODE.DOWN) return p;

  const pitch = clamp(input.pitch || 0, -1, 1);
  const thrust = clamp(input.thrust || 0, -1, 1);
  // Fuel burns whenever the engine is doing work, in either direction — a
  // real prop makes just as much noise decelerating as accelerating.
  let power = Math.abs(thrust);
  if (p.fuel <= 0) power = 0;
  p.throttle = power;
  if (input.gear != null) p.gear = !!input.gear;

  if (p.mode === MODE.DECK || p.mode === MODE.ROLL) stepRoll(p, pitch, power);
  else if (p.turnTicks != null) stepTurn(p);
  else stepAir(p, pitch, thrust);

  p.fuel = Math.max(0, p.fuel - (FLIGHT.FUEL_IDLE + FLIGHT.FUEL_THROTTLE * power));
  p.ticks++;
  return p;
}

// The takeoff roll. The plane is pinned to the deck, gains speed against
// rolling friction, and only rotates once there is air over the wings.
function stepRoll(p, pitch, throttle) {
  p.angle = 0;
  // On the deck the aeroplane is upright, facing right, by definition — no
  // stall turn survives a landing or a respawn either.
  p.turnTicks = null;
  p.turnStartAngle = null;
  p.turnDelta = null;
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

// The ceiling. Climbing into it levels the nose rather than stopping the
// plane dead, so it reads as a service ceiling and not as a wall.
function stepCeiling(p) {
  if (p.y < CEILING_Y) {
    p.y = CEILING_Y;
    if (p.vy < 0) {
      p.angle = Math.cos(p.angle) >= 0 ? 0 : Math.PI;
      p.vy = 0;
      p.vx = Math.cos(p.angle) * p.speed;
    }
  }
}

// input: pitch is body-relative (+1 nose up, -1 nose down, unaffected by
// which way the aeroplane is facing — a real elevator does not care). thrust
// is a WORLD-frame direction: +1 always means "thrust East", -1 "thrust
// West". Whether that is the accelerator or the brake depends on which way
// the nose is currently pointing — `facing` below — which is the whole
// mechanic: holding the arrow that agrees with your heading builds speed
// toward MAX_SPEED, holding the one that disagrees bleeds it off, and running
// it to zero while still disagreeing is what triggers stepTurn.
function stepAir(p, pitch, thrust) {
  const authority = Math.min(1, p.speed / FLIGHT.TURN_SPEED_REF);
  p.angle = normalizeAngle(p.angle - pitch * FLIGHT.TURN_RATE * authority);

  const facing = Math.cos(p.angle) >= 0 ? 1 : -1;
  const braking = thrust === -facing;

  // Below flying speed the nose falls toward straight down whatever the
  // stick is doing — UNLESS the low speed is a deliberate brake toward a
  // stall turn rather than an accidental one (an overcooked climb bleeding
  // off airspeed nobody meant to lose). A turn already commits its own
  // attitude in stepTurn; this stall-recovery drop would otherwise leave the
  // reversal starting, and so ending, a good 20-30 degrees off level.
  if (p.speed < FLIGHT.STALL_SPEED && !braking) {
    p.angle = turnToward(p.angle, Math.PI / 2, FLIGHT.STALL_PULL);
  }

  if (thrust === facing) p.speed += FLIGHT.THRUST;
  else if (braking) p.speed -= FLIGHT.BRAKE;
  p.speed += FLIGHT.GRAVITY * Math.sin(p.angle);
  p.speed -= FLIGHT.DRAG * p.speed * p.speed;
  p.speed = clamp(p.speed, 0, FLIGHT.MAX_SPEED);

  // Ran the airspeed to zero fighting it the whole way: arm the stall turn.
  // Speed is already 0 this tick (nothing left to move it with), so the
  // ordinary tail below is a no-op; stepPlane routes to stepTurn from the
  // next tick on. See stepTurn for why the arc always dips through PI/2
  // rather than always adding the same sign.
  if (p.speed <= 0 && braking) {
    p.turnTicks = 0;
    p.turnStartAngle = p.angle;
    p.turnDelta = facing >= 0 ? Math.PI : -Math.PI;
  }

  p.vx = Math.cos(p.angle) * p.speed;
  p.vy = Math.sin(p.angle) * p.speed;
  p.x += p.vx;
  p.y += p.vy;
  stepCeiling(p);
}

// The stall turn: a wingover, not a pivot. `turnDelta` is always +/-PI —
// chosen once, in stepAir, so that a linear (then eased) sweep from
// turnStartAngle to turnStartAngle + turnDelta passes through PI/2 (straight
// down in world terms) exactly at its midpoint, whichever way the aeroplane
// was originally facing. That is what makes every reversal cost a bit of
// altitude and a bit of forward drift — not alternately a climb or a dive
// depending on which heading it started from — since the sink is not a
// separate constant, it falls straight out of integrating
// sin(angle) * STALL_TURN_DRIFT through that dip.
//
// The manoeuvre commits once triggered: pitch and thrust input are ignored
// for its whole duration, exactly like a real stall turn — a player already
// mid-manoeuvre cannot un-commit from it by letting go.
function stepTurn(p) {
  // Incremented before use, so the LAST tick of the manoeuvre lands at u=1
  // exactly (angle === turnStartAngle + turnDelta, precisely the reversed
  // heading) rather than one tick short of it.
  p.turnTicks++;
  const u = clamp(p.turnTicks / FLIGHT.STALL_TURN_TICKS, 0, 1);
  const eased = u * u * (3 - 2 * u); // smoothstep: symmetric, so the PI/2 dip still lands at u=0.5
  p.angle = normalizeAngle(p.turnStartAngle + p.turnDelta * eased);
  p.speed = FLIGHT.STALL_TURN_DRIFT;
  p.vx = Math.cos(p.angle) * p.speed;
  p.vy = Math.sin(p.angle) * p.speed;
  p.x += p.vx;
  p.y += p.vy;
  stepCeiling(p);

  if (p.turnTicks >= FLIGHT.STALL_TURN_TICKS) {
    p.turnTicks = null;
    p.turnStartAngle = null;
    p.turnDelta = null;
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
