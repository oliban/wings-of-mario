import { bombOnScreen } from './telegraph.js';
import { drawFallingBomb, drawImpactFlash } from './art/telegraph.js';

// Layer 4 of Mario's telegraph: the bomb, drawn on his screen for every frame
// it is actually in view.
//
// The first three layers tell him a bomb exists (the whistle), where it will
// land (the reticle) and which way it is coming from (the edge arrow). None of
// them draw the object itself, and the object is what a player tracks with his
// eyes while deciding which way to run — without it he gets a warning, then a
// crater, and nothing in between.
//
// This module owns NO physics and NO prediction. It is handed the overlay's
// `marks` — the render-ready output of Telegraph, which integrates the shot
// with the pilot's own integrator — and its whole job is to project them
// through the camera and stamp pixels. That is what makes the bomb and the
// reticle agree: there is one arc, and both are read off it.
//
// Everything in and out is ISLAND-LOCAL pixels (level top-left is 0,0), the
// same space `marks` is in.
export const FLASH_TICKS = 8;

// How close to its own predicted impact a bomb must have been, the last frame
// it existed, for its disappearance to count as an arrival. A shot also leaves
// `marks` when it expires of old age in mid-air or when the level is reset,
// and neither of those leaves a crater to flash over.
export const IMPACT_SLOP = 20;

export class BombSight {
  constructor() {
    // id -> last known {x, y, impact} while the shot was still in the air.
    this.tracked = new Map();
    this.flashes = [];
  }

  // True while there is something to paint even though no bomb is left in the
  // air. The overlay's draw path can otherwise skip a frame with no marks in
  // it, which is exactly the frame the arrival flash lives on.
  get busy() {
    return this.flashes.length > 0;
  }

  clear() {
    this.tracked.clear();
    this.flashes.length = 0;
  }

  // `frame` is the overlay's fixed-step counter, never a clock: the flash is
  // as reproducible as the arc that caused it.
  draw(ctx, marks, cam, frame) {
    this._reconcile(marks, frame);
    if (!cam) return;

    for (const f of this.flashes) {
      const p = bombOnScreen(f.x, f.y, cam, 24);
      if (p) drawImpactFlash(ctx, p.x, p.y, (frame - f.start) / FLASH_TICKS);
    }

    for (const m of marks) {
      const p = bombOnScreen(m.x, m.y, cam);
      if (!p) continue; // still off camera: the edge arrow has this one
      drawFallingBomb(ctx, p.x, p.y, m.angle, { speed: Math.hypot(m.vx, m.vy) });
    }
  }

  // A bomb that was in the air last frame and is gone this frame has either
  // landed or expired. There is no event to read here — `marks` is the whole
  // interface the overlay exposes — so the arrival is inferred from where the
  // shot was when it vanished, which is a fact about the same arc.
  _reconcile(marks, frame) {
    const live = new Set();
    for (const m of marks) live.add(m.id);
    for (const [id, last] of this.tracked) {
      if (live.has(id)) continue;
      this.tracked.delete(id);
      if (!last.impact) continue;
      const gap = Math.hypot(last.x - last.impact.x, last.y - last.impact.y);
      if (gap <= IMPACT_SLOP) {
        // The flash goes on the PREDICTED impact point, not on the last drawn
        // position: that point is where the crater will open, so the two land
        // on the same pixel even though the crater is a network hop behind.
        this.flashes.push({ x: last.impact.x, y: last.impact.y, start: frame });
      }
    }
    for (const m of marks) {
      this.tracked.set(m.id, {
        x: m.x,
        y: m.y,
        impact: m.impact ? { x: m.impact.x, y: m.impact.y } : null,
      });
    }
    this.flashes = this.flashes.filter((f) => frame - f.start < FLASH_TICKS);
  }
}

export default BombSight;
