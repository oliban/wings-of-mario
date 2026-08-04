import { SEA_Y } from './geo.js';

// The ferry (design spec section 6). It answers "how does Mario travel",
// "what are torpedoes for" and "when do both players share a screen" in one
// mechanic, and it is the only time in the match Mario is somewhere with no
// terrain to hide behind.
//
// WORLD pixels, unlike telegraph.js and match.js: the boat is on the ocean
// between two islands, which is the pilot's coordinate space by definition.
export const FERRY = {
  // Slow enough that the pilot has time to see the crossing start, turn, and
  // set up a torpedo run; fast enough that a 2200px gap is under a minute.
  SPEED: 0.6,
  // How far the planking sits above sea level.
  FREEBOARD: 10,
  // Hull half-length and depth, for the torpedo hit box.
  HALF_W: 96,
  HULL_H: 22,
  // She lies alongside while Mario walks aboard. This is also the window in
  // which the pilot learns a crossing is starting at all.
  BOARD_TICKS: 45,
};

export class Ferry {
  constructor(opts = {}) {
    this.fromX = opts.fromX;
    this.toX = opts.toX;
    this.speed = opts.speed == null ? FERRY.SPEED : opts.speed;
    this.dir = Math.sign(this.toX - this.fromX) || 1;
    this.x = this.fromX;
    this.y = (opts.seaY == null ? SEA_Y : opts.seaY) - FERRY.FREEBOARD;
    this.ticks = 0;
    this.phase = 'boarding';
    // Whole ticks, so `total` is exact and a test can assert it rather than
    // bracket it.
    this.sailTicks = Math.ceil(Math.abs(this.toX - this.fromX) / this.speed);
  }

  get total() {
    return FERRY.BOARD_TICKS + this.sailTicks;
  }

  get progress() {
    if (this.ticks <= FERRY.BOARD_TICKS) return 0;
    const sailed = Math.min(this.sailTicks, this.ticks - FERRY.BOARD_TICKS);
    return this.sailTicks === 0 ? 1 : sailed / this.sailTicks;
  }

  step() {
    if (this.phase === 'arrived' || this.phase === 'sunk') return this;
    this.ticks++;
    if (this.ticks <= FERRY.BOARD_TICKS) {
      // Still alongside. `phase` flips on the LAST boarding tick so the tick
      // after it is the first tick under way, which is what makes `total`
      // land exactly on arrival.
      if (this.ticks === FERRY.BOARD_TICKS) this.phase = 'crossing';
      return this;
    }
    const sailed = Math.min(this.sailTicks, this.ticks - FERRY.BOARD_TICKS);
    // Interpolated from the tick count rather than accumulated, so floating
    // point cannot leave her a fraction of a pixel short of the jetty.
    this.x = this.fromX + (this.toX - this.fromX) * (sailed / this.sailTicks);
    if (sailed >= this.sailTicks) {
      this.x = this.toX;
      this.phase = 'arrived';
    }
    return this;
  }

  sink() {
    if (this.phase !== 'crossing') return false;
    this.phase = 'sunk';
    return true;
  }

  state() {
    return {
      x: this.x,
      y: this.y,
      dir: this.dir,
      ticks: this.ticks,
      phase: this.phase,
      progress: this.progress,
    };
  }
}

// Torpedoes are sea weapons and the ferry is the only sea target in the game.
// She can only be hit while she is actually under way: alongside the jetty she
// is inside the island's shadow, and once arrived Mario is already ashore.
//
// Hit resolution follows ownership (spec 7.3) — this runs on MARIO's client,
// against the torpedo's interpolated position. His boat, his hitbox.
export function torpedoHits(ferry, shot) {
  if (!ferry || ferry.phase !== 'crossing') return false;
  if (!shot || shot.kind !== 'torpedo') return false;
  return (
    shot.x >= ferry.x - FERRY.HALF_W &&
    shot.x <= ferry.x + FERRY.HALF_W &&
    shot.y >= ferry.y &&
    shot.y <= ferry.y + FERRY.HULL_H
  );
}

export default Ferry;
