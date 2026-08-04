import { Rng } from '../core/rng.js';

// A fuzzy blip: enough to hunt by, not enough to remove the hunt (spec 1).
//
// The pilot is told roughly where Mario is roughly a second and a half ago.
// Everything about that sentence is deliberate: an exact position turns the
// hunt into a taxi ride, and no position at all turns a 20,000-pixel ocean
// into a shrug.
//
// Positions in here are the PILOT's world space (ISLAND_TOP_Y..SEA_Y in
// geo.js), never Mario's island-local space: whoever feeds step() is the one
// that has to convert, because a forgotten conversion is 320px of silent error.
export const RADAR = {
  // One fix per sweep of the antenna. The instrument's existing sweep line is
  // decorative; this is the real one.
  SWEEP_TICKS: 90,
  // Lateral error of a fix, in world pixels. About four Mario screens: enough
  // that the pilot arrives in the right neighbourhood and still has to look.
  FUZZ_PX: 260,
  // Vertical error is much smaller — an island band is only 240px tall, so a
  // fuzzed altitude would put Mario in the sea or in the sky.
  FUZZ_Y_PX: 40,
  // How long a fix stays on the tube before the contact goes dark.
  FADE_TICKS: 300,
};

// A distinct, live seed per sweep. Mixing the sweep index in is what stops the
// error being a constant offset the pilot could simply learn and subtract.
export function sweepSeed(seed, sweep) {
  const s = (Math.imul((seed >>> 0) ^ 0x85ebca6b, 0x27d4eb2d) ^ Math.imul(sweep + 1, 0x9e3779b1)) >>> 0;
  return s || 0x2545f491;
}

export class Radar {
  constructor(opts = {}) {
    this.seed = (opts.seed >>> 0) || 0x2545f491;
    this.ticks = 0;
    this.sweep = 0;
    this.fix = null; // {x, y, at}
  }

  // One fixed step. `fix` is the TRUE contact — {x, y, present} in world
  // pixels — which in the match comes off Mario's 20Hz snapshot. A radar with
  // nothing to see is handed `{present: false}`.
  step(fix) {
    this.ticks++;
    if (this.ticks % RADAR.SWEEP_TICKS === 0) {
      this.sweep++;
      if (fix && fix.present) {
        const rng = new Rng(sweepSeed(this.seed, this.sweep));
        this.fix = {
          x: fix.x + rng.range(-RADAR.FUZZ_PX, RADAR.FUZZ_PX),
          y: fix.y + rng.range(-RADAR.FUZZ_Y_PX, RADAR.FUZZ_Y_PX),
          at: this.ticks,
        };
      }
    }
    if (this.fix && this.ticks - this.fix.at > RADAR.FADE_TICKS) this.fix = null;
    return this;
  }

  // What the instrument draws, or null for a dark tube. `confidence` runs 1
  // at the moment of the fix down to 0 as it ages, and is what makes an old
  // contact visibly old rather than silently wrong.
  contact() {
    if (!this.fix) return null;
    const age = this.ticks - this.fix.at;
    return {
      x: this.fix.x,
      y: this.fix.y,
      age,
      confidence: Math.max(0, 1 - age / RADAR.FADE_TICKS),
    };
  }

  reset() {
    this.fix = null;
    this.sweep = 0;
    this.ticks = 0;
  }
}

export default Radar;
