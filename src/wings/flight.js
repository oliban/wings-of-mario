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
  // A full 0..1 sweep of the lever takes 90 ticks (~1.5s): fast enough that a
  // cruise-to-idle deceleration reaches the landing envelope (carrier.js
  // LANDING, 0.6-1.8) well inside the length of the deck, slow enough that
  // there is no on/off snap — the pilot has to commit to a setting.
  THROTTLE_RAMP: 1 / 90,
  // How long after the nose sweeps through vertical the aeroplane reads as
  // rolled upright/inverted for CONTROL purposes — see the "upright" block
  // below stepAir. Chosen to land at or after the half-roll scene.js animates
  // for the same crossing: a damped spring, and driving it with the same
  // reversal a player flies (a brief pull past the crossing, then level)
  // measured its bank settling within 0.05 rad of its target about 17 ticks
  // after the crossing. This is deliberately a plain sim-owned number rather
  // than a re-derivation of scene.js's spring constants — the sim must not
  // depend on the renderer — so if that spring is retuned, this should be
  // retuned with it.
  ROLL_SETTLE_TICKS: 20,
  // A same-tick angle jump bigger than any one tick of TURN_RATE can produce
  // is a snap (the ceiling levelling the nose, a respawn), not a swept
  // crossing — mirrors scene.js's own ROLL.TELEPORT cutoff for the identical
  // reason: a snap has no meaningful "direction the nose is sweeping" to
  // roll through, so upright snaps to match instead of queueing a roll.
  ROLL_TELEPORT: 0.5,
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

// The throttle lever. dir is +1 (advancing), -1 (retarding) or 0 (hand off
// the lever — it stays wherever it was, this is not a spring). One tick's
// worth of movement at a time, so the ramp is exact and frame-rate independent.
export function rampThrottle(current, dir, rate = FLIGHT.THROTTLE_RAMP) {
  if (!dir) return clamp(current, 0, 1);
  const next = current + Math.sign(dir) * rate;
  // Snap within an epsilon rather than clamp the float sum: 90 additions of
  // 1/90 land a few ulps short of 1 (or 0), and a lever that can never quite
  // reach full throttle — or never quite let go of it — is a bug the player
  // would eventually feel even if no test ever printed the exact float.
  if (next >= 1 - 1e-9) return 1;
  if (next <= 1e-9) return 0;
  return next;
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
    // Upright/inverted, for CONTROL purposes: which way "pull back" needs to
    // rotate the nose to read as a climb to the pilot. Flips once per crossing
    // of the vertical, delayed to land with the visual roll — see stepAir.
    upright: opts.upright != null ? !!opts.upright : true,
    // Queued upright flips: sim ticks (p.ticks) at which a crossing that
    // already happened takes effect. A queue, not a single slot, because nothing
    // stops two crossings (a tight double reversal) from being in flight together.
    rollFlipQueue: [],
    // The sign actually applied to the current pull-back/push-forward hold,
    // latched the instant the stick leaves centre and held fixed until it
    // returns to centre. This is what lets a single held key ride out a
    // background upright flip without the loop it is mid-way through reversing
    // underneath it.
    controlSign: 1,
    pulling: false,
  };
}

// input: { pitch: -1..1 (+1 is pull-back — climbs when upright, dives when
// inverted; -1 is push-forward, the opposite), throttle: 0..1, gear: bool }
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
  // On the deck the aeroplane is upright, facing right, by definition — the
  // same rule scene.js uses for its own roll spring — which is also what
  // puts a respawn or a fresh landing back the right way up with no special
  // case beyond just being here every tick while grounded.
  p.upright = true;
  p.rollFlipQueue.length = 0;
  p.controlSign = 1;
  p.pulling = false;
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
  const prevAngle = p.angle;

  // Pull-back is pilot-relative, not screen-relative. `p.upright` already IS
  // the correctly-signed answer to "which raw rotation direction is pull-back
  // right now" — it starts at the old convention (+1, matching plain angle:0
  // takeoff) and flips once per crossing of vertical, lagged so it only takes
  // effect once the visual roll (scene.js) has had time to complete it. So the
  // mapping is just that flag, read once: latched the instant the stick
  // leaves centre and held for the whole time it stays away from centre —
  // never re-read while pitch stays nonzero — so a single continuous hold
  // rides out any upright flip that happens in the background mid-manoeuvre
  // instead of having its own rotation reverse direction under it (which is
  // exactly how the pre-existing full-loop behaviour keeps working: one hold,
  // one constant sign, start to finish). Letting the stick return to centre
  // and pulling again is what picks up a roll that has since completed.
  if (pitch !== 0) {
    if (!p.pulling) p.controlSign = p.upright ? 1 : -1;
    p.pulling = true;
  } else {
    p.pulling = false;
  }
  const rawPitch = pitch * p.controlSign;
  p.angle = normalizeAngle(p.angle - rawPitch * FLIGHT.TURN_RATE * authority);

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

  // The upright/inverted flip itself: queued the instant the nose sweeps
  // through vertical, same trigger as scene.js's rollTarget, but not READ
  // into the pull-back mapping above until FLIGHT.ROLL_SETTLE_TICKS later —
  // the time the visual half-roll takes to read as complete. A crossing that
  // lands mid-loop (still held through the reversal) sits in the queue and
  // does nothing until it is due; nothing here depends on whether pitch is
  // held. Compared against the FINAL angle for the tick (after the ceiling
  // above), so a ceiling level-off is judged as one whole move, not two.
  const swept = normalizeAngle(p.angle - prevAngle);
  const crossedVertical = (Math.cos(prevAngle) >= 0) !== (Math.cos(p.angle) >= 0);
  if (crossedVertical) {
    if (Math.abs(swept) > FLIGHT.ROLL_TELEPORT) {
      // A jump this big (the ceiling levelling the nose, a snap-back) is not a
      // manoeuvre with a direction to roll through — mirrors scene.js's own
      // TELEPORT handling: snap upright to match the landed heading instead of
      // queuing a roll that was never really flown.
      p.rollFlipQueue.length = 0;
      p.upright = Math.cos(p.angle) >= 0;
    } else {
      p.rollFlipQueue.push(p.ticks + FLIGHT.ROLL_SETTLE_TICKS);
    }
  }
  while (p.rollFlipQueue.length && p.rollFlipQueue[0] <= p.ticks) {
    p.rollFlipQueue.shift();
    p.upright = !p.upright;
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
