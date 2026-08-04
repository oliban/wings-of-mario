import { drawPlane, PLANE_LEN } from '../wings/art/plane.js';
import { PLANE_W, PLANE_H } from '../wings/geo.js';
import { SCREEN_W, SCREEN_H } from '../core/constants.js';

// The remote aeroplane, drawn on a canvas of our own laid over the game's.
// The engine's renderer is upstream-owned and its entity list is Mario's
// simulation; pushing a network ghost into either would be an engine edit for
// a picture. A sibling canvas costs one element and zero merge surface — the
// same trade src/wings/debug-panel.js already makes.
//
// Named for what it is rather than where it lives: src/wings/mario-overlay.js
// is a different thing entirely (the bomb telegraph) and the two must not be
// confused. This one draws exactly one sprite.
export class NetOverlay {
  constructor(doc = document) {
    this.doc = doc;
    this.canvas = null;
    this.ctx = null;
    this.remote = null;
    // Frames drawn. Drives the propeller disc, and nothing in the match.
    this.frame = 0;
  }

  attach() {
    const screen = this.doc.getElementById('screen');
    if (!screen) return null;
    if (this.canvas) return this.canvas;
    const c = this.doc.createElement('canvas');
    c.id = 'net-overlay';
    // The framebuffer is the GAME's logical resolution, not the canvas's
    // backing size: #screen is 1024x960 for sharpness, and drawing a 24px
    // aeroplane into that would put it at a quarter of its proper size.
    c.width = SCREEN_W;
    c.height = SCREEN_H;
    c.style.cssText = 'position:absolute;pointer-events:none;z-index:4;image-rendering:pixelated;';
    screen.parentElement.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this._place();
    // Match the game canvas's on-screen box exactly, so one logical pixel here
    // is one logical pixel there whatever the display scale happens to be.
    const view = this.doc.defaultView;
    if (view) view.addEventListener('resize', () => this._place());
    return c;
  }

  _place() {
    if (!this.canvas) return;
    const screen = this.doc.getElementById('screen');
    if (!screen || !screen.parentElement) return;
    const box = screen.getBoundingClientRect();
    const host = screen.parentElement.getBoundingClientRect();
    this.canvas.style.left = `${box.left - host.left}px`;
    this.canvas.style.top = `${box.top - host.top}px`;
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${box.height}px`;
  }

  // `remote` is in LEVEL-LOCAL pixels already — mario-side.js does the world
  // conversion — plus the camera to subtract.
  set(remote) {
    this.remote = remote;
  }

  draw() {
    this.frame++;
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
    const r = this.remote;
    if (!r) return;
    // The snapshot carries the plane's TOP-LEFT, per ARCHITECTURE.md section 1;
    // drawPlane wants its centre.
    const sx = Math.floor(r.x - r.camX) + PLANE_W / 2;
    const sy = Math.floor(r.y - r.camY) + PLANE_H / 2;
    // Culled generously rather than exactly: a wing hanging off the edge of
    // the screen is the correct picture of an aeroplane on its way in.
    const m = PLANE_LEN;
    if (sx < -m || sx > SCREEN_W + m || sy < -m || sy > SCREEN_H + m) return;
    // The same vector aeroplane the pilot flies, at the same 1:1 pixel scale
    // the two coordinate spaces share, so it is recognisably HIS aircraft and
    // recognisably the size it should be from Mario's feet. `roll` is left to
    // drawPlane's default — the stall-turn animation is the pilot's own
    // feedback and the snapshot deliberately does not carry a bank angle.
    drawPlane(this.ctx, sx, sy, r.angle || 0, { tick: this.frame });
  }

  detach() {
    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
  }
}

export { NetOverlay as MarioOverlay };
export default NetOverlay;
