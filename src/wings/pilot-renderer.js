import { LAYER } from '../core/constants.js';
import { VIEW_W, VIEW_H } from './geo.js';

const LAYER_COUNT = 16;
const MAX_SCALE = 4;

// The pilot's viewport: 512x240 at the same 1:1 art scale as Mario's 256x240,
// twice as wide, scrolling in both axes. Same layer-queue API as the engine
// renderer (ARCHITECTURE.md section 9) so a system written against one works
// against the other. Presented through Canvas2D rather than the WebGL post
// chain — see "Recorded decision" at the top of this plan.
export class PilotRenderer {
  constructor(canvas) {
    this.buffer = document.createElement('canvas');
    this.buffer.width = VIEW_W;
    this.buffer.height = VIEW_H;
    this.ctx = this.buffer.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;

    this.canvas = canvas;
    this.canvas.style.imageRendering = 'pixelated';
    this.dctx = canvas.getContext('2d', { alpha: false });
    this.dctx.imageSmoothingEnabled = false;

    this.scale = 1;
    this.frames = 0;
    this._layers = [];
    for (let i = 0; i < LAYER_COUNT; i++) this._layers.push([]);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
  }

  // Integer scale only. A half-pixel viewport is not a pixel game.
  resize() {
    const availW = Math.max(VIEW_W, (window.innerWidth || VIEW_W) - 48);
    const availH = Math.max(VIEW_H, (window.innerHeight || VIEW_H) - 96);
    const fit = Math.min(Math.floor(availW / VIEW_W), Math.floor(availH / VIEW_H));
    const s = Math.max(1, Math.min(MAX_SCALE, fit));
    this.scale = s;
    if (this.canvas.width !== VIEW_W * s || this.canvas.height !== VIEW_H * s) {
      this.canvas.width = VIEW_W * s;
      this.canvas.height = VIEW_H * s;
      this.dctx.imageSmoothingEnabled = false;
    }
    this.canvas.style.width = `${VIEW_W * s}px`;
    this.canvas.style.height = `${VIEW_H * s}px`;
    return this;
  }

  beginFrame() {
    for (const bucket of this._layers) bucket.length = 0;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.filter = 'none';
    return ctx;
  }

  // Queue fn(ctx, renderer) on a layer from constants.LAYER. Callbacks run in
  // layer order, submission order within a layer, each inside save()/restore().
  draw(layer, fn) {
    if (typeof fn !== 'function') return this;
    const idx = Math.max(0, Math.min(LAYER_COUNT - 1, layer | 0));
    this._layers[idx].push(fn);
    return this;
  }

  flush() {
    const ctx = this.ctx;
    for (const bucket of this._layers) {
      for (const fn of bucket) {
        ctx.save();
        try {
          fn(ctx, this);
        } finally {
          ctx.restore();
        }
      }
      bucket.length = 0;
    }
    return this;
  }

  present() {
    this.flush();
    const d = this.dctx;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalAlpha = 1;
    d.globalCompositeOperation = 'source-over';
    d.imageSmoothingEnabled = false;
    d.drawImage(this.buffer, 0, 0, this.canvas.width, this.canvas.height);
    this.frames++;
    return this;
  }

  snapshot(type = 'image/png') {
    return this.canvas.toDataURL(type);
  }
}

export { LAYER };
export default PilotRenderer;
