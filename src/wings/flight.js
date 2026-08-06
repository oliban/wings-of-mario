import {
  CEILING_Y, DECK_X0, DECK_X1, DECK_Y, DECK_SURFACE_Y, PLANE_W, PLANE_H, restY, clamp,
} from './geo.js';

// Everything here is pixels PER FRAME at the fixed 60.0988Hz timestep, and
// radians per frame for rotation. Nothing reads a clock or an RNG.
//
// These are chosen together, not independently. THRUST against DRAG sets level
// cruise at 5.39 px/frame. GRAVITY against THRUST is why a climb stalls and a
// dive runs away: at full throttle a vertical climb is 0.09 - 0.12, net
// negative. TURN_RATE sets the loop at 105 ticks. ROLL_THRUST against
// ROLL_DRAG puts rotation at tick 133, 180px down a 320px deck — half the
// deck, so running out of it is a real mistake a player can make.
//
// THE AEROPLANE WAS DOUBLED IN SPEED, and MAX_SPEED alone could not do it.
// MAX_SPEED is a clamp, and the clamp was never what the aeroplane was
// actually hitting: DRAG is. sqrt(THRUST/DRAG) is level cruise and
// sqrt((THRUST+GRAVITY)/DRAG) is a vertical dive, and at the old 4.5 those
// were 2.69 and 4.08 — the aeroplane could not reach its own top speed by
// 0.4 px/f, so raising the clamp on its own would have changed precisely
// nothing. Doubling the aeroplane means doubling every ACCELERATION and
// halving DRAG (drag goes as v-squared, so 2a = D'(2v)^2 gives D' = D/2),
// which doubles every speed and — this is the point — leaves every DURATION
// exactly where it was. Braking from cruise to zero is still ~48 ticks; a
// vertical climb still bleeds out in ~180. The aeroplane covers twice the
// ground in the same time rather than taking twice as long to do anything.
export const FLIGHT = {
  // Doubled, as asked. It is still the clamp rather than the limit — a
  // vertical dive settles at 8.37 — but it sits the same 1.08x above the
  // dive terminal that 4.5 sat above 4.08, so it goes on doing the job it
  // was doing: catching the extreme, not defining the cruise.
  MAX_SPEED: 9.0,
  THRUST: 0.09,
  // Deceleration from holding the arrow AGAINST the direction of travel —
  // real thrust the other way, not a lever released. Matched to THRUST: the
  // same engine, run backwards, decelerates a cruising aeroplane (5.39 px/f)
  // to zero in about 60 ticks (~1s) — "for a while" to build speed up,
  // roughly the same "for a while" to bring it back down. Doubled with
  // THRUST so that stays true at the new cruise.
  BRAKE: 0.09,
  DRAG: 0.003,
  GRAVITY: 0.12,
  TURN_RATE: 0.06,
  // NOT doubled, for the same reason STALL_SPEED below is not. It reads like
  // a cruise-relative number — "authority saturates at some fraction of top
  // speed" — and it was briefly doubled to 3.2 on exactly that reasoning.
  // That was wrong, and it broke recovery: authority is speed/REF, so
  // doubling REF HALVES the pitch authority available at every low speed,
  // which is precisely the regime where authority matters. An aeroplane that
  // has fallen out of a climb at 0.9 px/f went from 0.56 of its turn rate to
  // 0.28 — not enough to get the nose up before it hit something. The
  // scripted pilot flew into the carrier on departure and it took a bisect to
  // see why.
  //
  // Low-speed handling is anchored to the LANDING envelope, which is absolute
  // (see STALL_SPEED). These two are a matched pair and both stay put.
  TURN_SPEED_REF: 1.6,
  // NOT doubled either, and for the same reason.
  // STALL_SPEED is referenced to the LANDING envelope, not to cruise, and
  // that envelope is absolute px/f in carrier.js (0.6 to 1.8) with no
  // knowledge of anything here. Doubling this to 1.6 puts the stall speed
  // INSIDE the legal landing window — every legal approach would be a
  // stalling approach, with the nose dropping the moment you came off the
  // brake. It stays at 0.8, below the window, where it has to be. The cost
  // is that an accidental stall now needs 15% of cruise rather than 30%, so
  // running out of airspeed by mistake is rarer than it was.
  STALL_SPEED: 0.8,
  STALL_PULL: 0.02,
  ROLL_THRUST: 0.03,
  // How hard the arrestor wire pulls you up, in speed lost per tick. A trap at
  // the top of the window (1.8) is stopped in about 24 ticks and 20-odd pixels
  // of deck: long enough to SEE the wire take the load, short enough that it
  // still reads as being caught rather than as braking.
  ARREST_DECEL: 0.075,
  // Wheel brakes, held against the direction of roll. Stronger than rolling
  // friction and weaker than an arrestor wire: it stops a landing rollout in
  // about a third of the distance coasting would take, and still leaves the
  // wire the fastest way to stop.
  ROLL_BRAKE: 0.045,
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

// ---------------------------------------------------------------------------
// DEBUG ONLY — live speed tuning, keys 1 and 2 on the pilot page.
// ---------------------------------------------------------------------------
// This is a playtesting knob, not a game feature. Nothing in the match, the
// network or the bot reads it; the default is FLIGHT.MAX_SPEED and at the
// default this file behaves EXACTLY as it did before it existed (see
// tunedFlight: at scale 1 it hands back the FLIGHT object itself, not a copy
// with the same numbers, so not one arithmetic operation changes and the
// exact-tick-count tests are untouched).
//
// WHAT THE KEYS ACTUALLY CHANGE, and why it is not MAX_SPEED alone.
// MAX_SPEED is a clamp and the aeroplane does not reach it: level cruise is
// sqrt(THRUST/DRAG) = 5.48 and a vertical dive sqrt((THRUST+GRAVITY)/DRAG) =
// 8.37, both under the 9.0 clamp. Moving the clamp on its own would do
// visibly nothing until it dropped below 8.37, and then it would only chop
// the top off a dive. So the keys move the WHOLE speed scale, exactly the way
// the aeroplane was doubled: MAX_SPEED is the number the pilot sets and reads,
// and the accelerations and drag are re-derived from it so that real cruise
// tracks it.
//
// The derivation, with s = maxSpeed / 9.0. Scaling every velocity by s while
// leaving every DURATION alone means scaling every acceleration by s too, and
// since drag goes as v-squared, D'(sv)^2 = s*Dv^2 gives D' = D/s. ROLL_DRAG is
// LINEAR in speed, so it stays put. TAKEOFF_SPEED and STALL_TURN_DRIFT are
// speeds and scale.
//
// What deliberately does NOT scale: STALL_SPEED and TURN_SPEED_REF, for the
// reasons written against them above — they are anchored to the absolute
// landing envelope in carrier.js, not to cruise, and scaling TURN_SPEED_REF
// once already flew the scripted pilot into the carrier. TURN_RATE,
// STALL_PULL and STALL_TURN_TICKS are rotations and durations, and durations
// are the thing this scaling exists to preserve. The consequence is real and
// wanted: a faster aeroplane turns in the same time, so it turns through more
// sky, and a slower one is nimbler. That IS what changing the speed of an
// aeroplane feels like.
export const SPEED_TUNE = {
  DEFAULT: 9.0,
  // 4.5 is the aeroplane as it was before it was doubled — a known-good floor
  // that is still comfortably above the 1.8 px/f top of the landing window and
  // well clear of STALL_SPEED. 27 is three times the current aeroplane: fast
  // enough to be silly, not so fast that it crosses a whole island between two
  // ticks and can no longer be flown at all.
  MIN: 4.5,
  MAX: 27.0,
  // A sixth of the default, so 9.0 sits exactly on the grid and every step is
  // an exact binary fraction — the tuned value never picks up rounding fuzz.
  STEP: 1.5,
};

let debugMaxSpeed = SPEED_TUNE.DEFAULT;

export function getMaxSpeed() {
  return debugMaxSpeed;
}

// Snaps to the step grid and clamps to the bounds, so no caller can put the
// aeroplane outside the flyable range whatever it passes in. Returns the value
// actually adopted. New planes (respawn, sail, a fresh sim) pick this up in
// createPlane, which is what makes a tuned setting survive a crash — but it is
// NOT persisted anywhere, so a reload gives back a standard 9.0 aeroplane.
export function setMaxSpeed(v) {
  const stepped = Math.round(v / SPEED_TUNE.STEP) * SPEED_TUNE.STEP;
  debugMaxSpeed = clamp(stepped, SPEED_TUNE.MIN, SPEED_TUNE.MAX);
  return debugMaxSpeed;
}

export function resetMaxSpeed() {
  debugMaxSpeed = SPEED_TUNE.DEFAULT;
  return debugMaxSpeed;
}

// The constants this particular aeroplane flies by. A pure function of the
// plane's own state — nothing here reads a clock, the DOM or the tuning
// variable above during a step, only p.maxSpeed, which is part of the plane
// and therefore part of anything that snapshots or replays it.
//
// Memoised on the one value it depends on purely to keep a tuned aeroplane
// from allocating a fresh table sixty times a second; the result is decided by
// nothing but the argument.
let tunedCache = null;
export function tunedFlight(p) {
  const target = p && p.maxSpeed != null ? p.maxSpeed : FLIGHT.MAX_SPEED;
  // The default aeroplane gets the original object, not an equal one.
  if (target === FLIGHT.MAX_SPEED) return FLIGHT;
  if (tunedCache && tunedCache.MAX_SPEED === target) return tunedCache;
  const s = target / FLIGHT.MAX_SPEED;
  tunedCache = {
    ...FLIGHT,
    MAX_SPEED: target,
    THRUST: FLIGHT.THRUST * s,
    BRAKE: FLIGHT.BRAKE * s,
    GRAVITY: FLIGHT.GRAVITY * s,
    DRAG: FLIGHT.DRAG / s,
    ROLL_THRUST: FLIGHT.ROLL_THRUST * s,
    TAKEOFF_SPEED: FLIGHT.TAKEOFF_SPEED * s,
    STALL_TURN_DRIFT: FLIGHT.STALL_TURN_DRIFT * s,
  };
  return tunedCache;
}

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
    // Which way a ground roll runs, and the x it ends at. Set on touchdown;
    // a takeoff is always eastbound to the bow, which is these defaults.
    rollDir: opts.rollDir === -1 ? -1 : 1,
    rollEnd: opts.rollEnd != null ? opts.rollEnd : DECK_X1,
    x: opts.x != null ? opts.x : DECK_X0 + 16,
    y: opts.y != null ? opts.y : restY(DECK_SURFACE_Y),
    angle: opts.angle != null ? opts.angle : 0,
    speed: opts.speed || 0,
    vx: 0,
    vy: 0,
    throttle: 0,
    gear: opts.gear != null ? !!opts.gear : true,
    fuel: opts.fuel != null ? opts.fuel : FLIGHT.FUEL_MAX,
    // DEBUG tuning, see SPEED_TUNE. Part of the plane's state rather than a
    // global the step reads, so the model stays a pure function of state and
    // tick. Defaults to whatever the pilot has dialled in, which is how a
    // tuned setting survives a respawn or a sail.
    maxSpeed: opts.maxSpeed != null ? opts.maxSpeed : debugMaxSpeed,
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

  // The constants for THIS aeroplane. At the default max speed this is the
  // FLIGHT object itself.
  const F = tunedFlight(p);
  if (p.mode === MODE.DECK || p.mode === MODE.ROLL) stepRoll(p, pitch, thrust, F);
  else if (p.turnTicks != null) stepTurn(p, F);
  else stepAir(p, pitch, thrust, F);

  // PARKED IS ENGINE OFF. An aeroplane standing still on the ground with the
  // throttle shut is not burning anything, and the user asked for exactly that:
  // "it would not refuel but it would save me fuel by standing still a bit."
  // It is the only thing an island landing is worth — you cannot rearm and you
  // cannot refuel, but you can stop the clock and think.
  //
  // Stopped and on a surface, which on the carrier is the deck and on an island
  // is the strip. Idling with the throttle open still burns: shutting down is
  // the deliberate act.
  const shutDown = p.mode === MODE.DECK && p.speed === 0 && power <= 0;
  if (!shutDown) {
    p.fuel = Math.max(0, p.fuel - (FLIGHT.FUEL_IDLE + FLIGHT.FUEL_THROTTLE * power));
  }
  p.ticks++;
  return p;
}

// Below this the aeroplane is stationary. Proportional drag never reaches zero
// on its own; see the note in stepRoll. A twentieth of a pixel a tick is three
// pixels a minute — stopped, by any honest reading.
const ROLL_STOP = 0.05;

// The takeoff roll. The plane is pinned to the deck, gains speed against
// rolling friction, and only rotates once there is air over the wings.
function stepRoll(p, pitch, thrust, F) {
  // WHICH WAY THE ROLL RUNS. A takeoff is always eastbound — the aeroplane is
  // spotted at the stern pointing down the deck — but a LANDING can now arrive
  // from either direction, and a westbound arrival has to roll west. `rollDir`
  // is set on touchdown and defaults to east for everything else.
  const dir = p.rollDir === -1 ? -1 : 1;
  // Upright, pointing the way it is rolling. No stall turn survives a landing
  // or a respawn either.
  p.angle = dir === -1 ? Math.PI : 0;
  p.turnTicks = null;
  p.turnStartAngle = null;
  p.turnDelta = null;
  p.y = restY(DECK_SURFACE_Y);
  // IN THE WIRE. The throttle is ignored and the arrestor does the work: a
  // constant, hard pull-up rather than proportional drag, because a wire takes
  // the same load whatever speed you hit it at — and because proportional drag
  // never actually reaches zero (see the floor below).
  // THE STICK IS SIGNED ON THE GROUND TOO. `thrust` is a world-frame
  // direction, +1 east and -1 west, and stepRoll used to be handed only its
  // MAGNITUDE — so holding the key against the way you were rolling accelerated
  // you exactly as holding it with you did, and there was no way to slow down:
  // "when landed on ground, I need to be able to decellerate by pressing the
  // key in opposite direction of planes direction."
  //
  // With the roll: engine. Against it: brakes, which bite harder than rolling
  // friction and are what stop you in a sensible distance. Neither does
  // anything in the wire — you do not brake out of an arrestor cable.
  const along = thrust === 0 ? 0 : (thrust > 0 ? 1 : -1) * dir;
  const throttle = along > 0 ? Math.abs(thrust) : 0;
  const braking = along < 0 ? Math.abs(thrust) : 0;
  if (p.arrested) {
    p.speed = Math.max(0, p.speed - F.ARREST_DECEL);
  } else {
    p.speed += F.ROLL_THRUST * throttle - F.ROLL_DRAG * p.speed - F.ROLL_BRAKE * braking;
    if (p.speed < 0) p.speed = 0;
  }
  // ROLLING DRAG IS PROPORTIONAL, so speed decays towards zero and never
  // reaches it: 0.99 of something is never nothing. That was invisible while
  // the only roll was a takeoff, where the throttle is open and the aeroplane
  // leaves the deck long before it matters. A bolter has no throttle and has to
  // actually STOP — without this floor it creeps up the deck for ever at a
  // hundredth of a pixel a tick and never comes to rest.
  // COASTING ONLY. Applied unconditionally it snapped the first 0.03 of a
  // takeoff roll straight back to zero and the aeroplane never left the deck:
  // with the throttle open, every speed below the floor is on its way UP
  // through it.
  if (!p.arrested && throttle <= 0 && p.speed < ROLL_STOP) p.speed = 0;
  p.x += p.speed * dir;
  p.vx = p.speed * dir;
  p.vy = 0;
  p.mode = p.speed > 0 ? MODE.ROLL : MODE.DECK;

  if (!p.arrested && pitch > 0 && p.speed >= F.TAKEOFF_SPEED) {
    p.mode = MODE.AIR;
    p.gear = false;
    return;
  }
  // Ran out of deck. Airborne below flying speed is a stall, and a stall this
  // low is the sea. Nothing special-cases it; the physics does it.
  // A wire holds you on the ship. An arrested run that reaches the bow is still
  // caught — the cable does not let go because the deck ran out — so it stops
  // there rather than tipping a landing that WORKED into a ditching the player
  // could not have seen coming.
  // The end of the run is whichever end he is rolling towards: the bow going
  // east, the stern going west.
  const past = dir === 1 ? p.x >= p.rollEnd : p.x <= p.rollEnd;
  if (past) {
    if (p.arrested) {
      p.x = p.rollEnd;
      p.speed = 0;
      return;
    }
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
function stepAir(p, pitch, thrust, F) {
  const authority = Math.min(1, p.speed / F.TURN_SPEED_REF);
  p.angle = normalizeAngle(p.angle - pitch * F.TURN_RATE * authority);

  const facing = Math.cos(p.angle) >= 0 ? 1 : -1;
  const braking = thrust === -facing;

  // Below flying speed the nose falls toward straight down whatever the
  // stick is doing — UNLESS the low speed is a deliberate brake toward a
  // stall turn rather than an accidental one (an overcooked climb bleeding
  // off airspeed nobody meant to lose). A turn already commits its own
  // attitude in stepTurn; this stall-recovery drop would otherwise leave the
  // reversal starting, and so ending, a good 20-30 degrees off level.
  if (p.speed < F.STALL_SPEED && !braking) {
    p.angle = turnToward(p.angle, Math.PI / 2, F.STALL_PULL);
  }

  if (thrust === facing) p.speed += F.THRUST;
  else if (braking) p.speed -= F.BRAKE;
  p.speed += F.GRAVITY * Math.sin(p.angle);
  p.speed -= F.DRAG * p.speed * p.speed;
  p.speed = clamp(p.speed, 0, F.MAX_SPEED);

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
function stepTurn(p, F) {
  // Incremented before use, so the LAST tick of the manoeuvre lands at u=1
  // exactly (angle === turnStartAngle + turnDelta, precisely the reversed
  // heading) rather than one tick short of it.
  p.turnTicks++;
  const u = clamp(p.turnTicks / F.STALL_TURN_TICKS, 0, 1);
  const eased = u * u * (3 - 2 * u); // smoothstep: symmetric, so the PI/2 dip still lands at u=0.5
  p.angle = normalizeAngle(p.turnStartAngle + p.turnDelta * eased);
  p.speed = F.STALL_TURN_DRIFT;
  p.vx = Math.cos(p.angle) * p.speed;
  p.vy = Math.sin(p.angle) * p.speed;
  p.x += p.vx;
  p.y += p.vy;
  stepCeiling(p);

  if (p.turnTicks >= F.STALL_TURN_TICKS) {
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
