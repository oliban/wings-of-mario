// THE STANDING THROW: a bomb lobbed a few tiles ahead at the level of the
// ground he is standing on, instead of straight up over his head.
//
// Upstream's launch is a pure function of how fast Mario is MOVING
// (launchState in src/game/entities/brickbomb.js): `t` is 0 at a standstill and
// 1 flat out, the angle from vertical is `t * 45°`, and the fuse burns to the
// apex plus a share of the way down that also grows with `t`. At a full run
// that is a fine flat throw about fifteen tiles long. At a standstill it is
// STRAIGHT UP — angle 0, so vx is 0 — and the fuse ends at the apex, which puts
// the row of bricks in the air directly above his head.
//
// That is the one throw a stranded man can actually make. He is standing on the
// near lip of a chasm looking at it: he cannot run at it, because running at it
// means running into it. The user's words: "standing still should throw the
// grenade so it creates a bridge a bit to the right of the player on ground
// level."
//
// SO THE STANDING THROW IS SOLVED, not tuned by eye. Given the bomb's own
// gravity and the row he is standing on, there is exactly one pair (vx, vy) and
// one fuse that puts the bomb `REACH_TILES` ahead and back down at floor level
// when it goes off. That is what this computes, and it is a pure function so
// the whole of it is testable in plain Node.
//
// NOTHING ELSE CHANGES. A throw with any run behind it is upstream's, untouched
// — that trajectory is good and is what the fifteen-tile range is for. This
// fires only when he is genuinely still and on his feet.

// How far ahead the row starts, in tiles. Three puts the near end of a
// five-brick row just past the lip he is standing on, so the row bridges from
// his own ground outward rather than starting under his feet — and it is short
// enough that he can see where it will land before he throws.
export const REACH_TILES = 3;

// A hard floor on the flight, so a throw made standing on a low ledge cannot
// come out as a flick. Nothing above it: the flight time is SOLVED from the
// engine's own launch, not chosen.
export const MIN_FLIGHT_TICKS = 8;

// He is "standing still" below this. The same epsilon upstream uses to decide
// which way a throw goes when he is not travelling (THROW_DIR_EPS), so the two
// agree about what standing still means and there is no speed at which both
// rules or neither apply.
export const STILL_EPS = 0.12;

// The bomb integrates semi-implicit Euler — gravity is added to vy BEFORE the
// position moves (BrickBomb#step) — so after F frames it has fallen
// F*vy0 + g*F*(F+1)/2, not the textbook F*vy0 + g*F²/2. Getting this wrong puts
// the row a few pixels out, which at sixteen pixels to the tile is a whole row
// wrong about half the time.
export function fallAfter(vy0, frames, gravity) {
  return frames * vy0 + gravity * frames * (frames + 1) * 0.5;
}

// The launch that lands the bomb `tiles` ahead, at floor level.
//
//   drop    how far the bomb must DESCEND from the hand to the floor row, in
//           pixels. Positive is downward, as y is.
//   vy0     THE ENGINE'S OWN LAUNCH SPEED, kept exactly. The first version
//           solved for this too and threw the bomb far too gently: it left the
//           hand at -2.99 instead of -5.2, never cleared the ground it was
//           standing beside, struck a solid on the very first frame and puffed.
//           A brick bomb detonates on touching anything, so the climb is not
//           cosmetic — it is what gets the bomb out of the lip it is thrown
//           from. Only the fuse and the horizontal are ours.
//   facing  +1 right, -1 left. The user asked for the right; the rule is
//           written for either, because he faces both ways.
export function standstillLaunch({
  drop, vy0, facing = 1, tiles = REACH_TILES, gravity, tileSize = 16,
} = {}) {
  const g = Number(gravity);
  if (!Number.isFinite(g) || g <= 0) return null;
  if (!Number.isFinite(drop) || !Number.isFinite(vy0)) return null;
  const dir = facing < 0 ? -1 : 1;

  // When does a bomb thrown at vy0 fall `drop` pixels? From the integrator
  // above, drop = F*vy0 + g*F*(F+1)/2, which is a quadratic in F:
  //
  //   (g/2)F² + (vy0 + g/2)F - drop = 0
  //
  // Positive root only — the other one is the bomb arriving before it was
  // thrown.
  const b = vy0 + g * 0.5;
  const disc = b * b + 2 * g * drop;
  if (disc < 0) return null;
  const frames = (-b + Math.sqrt(disc)) / g;
  if (!Number.isFinite(frames) || frames <= 0) return null;
  const f = Math.max(MIN_FLIGHT_TICKS, Math.round(frames));

  // Horizontal is trivial: no drag, so distance is speed times time. Solved
  // against the ROUNDED fuse, because the fuse is what the bomb actually burns.
  const vx = (dir * tiles * tileSize) / f;
  return { vx, vy: vy0, fuse: f };
}

// Is this a throw the rule applies to? On his feet, not travelling, and with an
// owner to measure — a bomb spawned by a level or a probe has none and is left
// exactly as upstream made it.
export function isStandingThrow(owner) {
  if (!owner) return false;
  if (owner.grounded !== true) return false;
  return Math.abs(Number(owner.vx) || 0) < STILL_EPS;
}

// Where the floor row's TOP edge is for a man standing on it: his feet. The
// bomb has to arrive with its own centre inside that row, so the drop is
// measured to the middle of it.
export function dropToFloor(owner, bomb, tileSize = 16) {
  const feet = Number(owner.y) + Number(owner.h || tileSize);
  const centre = feet + tileSize * 0.5;
  return centre - (Number(bomb.y) + Number(bomb.h || 0) * 0.5);
}

// THE WRAP. world.spawn is taken on the INSTANCE, the technique guardWorld()
// in src/wings/sanctuary.js and mario-side.js's wrap of game.loadLevel already
// use, so src/game/entities/brickbomb.js is not edited and the diff against
// upstream stays at 150 lines across three files.
//
// AFTER construction rather than through opts: the constructor honours
// `opts.fuse` but computes vx and vy itself from launchState, so the only way
// to redirect the throw without an engine edit is to overwrite them on the
// entity it just built. It has not stepped yet — spawn returns before the
// world's next update — so nothing has moved on the old trajectory.
export function guardThrow(world, opts = {}) {
  if (!world || typeof world.spawn !== 'function') return false;
  if (world.__flatThrowGuarded) return false;
  const gravity = opts.gravity;
  const tileSize = opts.tileSize || 16;
  const prev = world.spawn.bind(world);
  world.spawn = (type, x, y, o) => {
    const e = prev(type, x, y, o);
    if (!e || e.isBrickBomb !== true) return e;
    const owner = (o && o.owner) || e.owner;
    if (!isStandingThrow(owner)) return e;
    const launch = standstillLaunch({
      drop: dropToFloor(owner, e, tileSize),
      // The climb the engine already gave it, kept — see standstillLaunch.
      vy0: e.vy,
      facing: e.facing,
      gravity,
      tileSize,
    });
    if (!launch) return e;
    e.vx = launch.vx;
    e.vy = launch.vy;
    e.fuse = launch.fuse;
    return e;
  };
  Object.defineProperty(world, '__flatThrowGuarded', { value: true, enumerable: false });
  return true;
}

export default guardThrow;
