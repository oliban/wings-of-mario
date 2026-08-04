import { LAYER } from '../core/constants.js';
import { VIEW_W, VIEW_H } from './geo.js';

const LAYER_COUNT = 16;
const MAX_SCALE = 4;

// How many device pixels the buffer holds per world pixel. The pilot's WORLD is
// still 512x240 world pixels at Mario's 1:1 scale — every drawing call is made
// in those coordinates and the simulation never sees anything else — but the
// buffer behind them is supersampled so curves, gradients and a freely rotated
// aircraft come out smooth instead of stepped. The transform lives here and
// nowhere else; nothing downstream of `beginFrame` knows about it.
const SUPERSAMPLE = 2;

// The pilot's viewport: 512x240 world pixels, twice as wide as Mario's, and
// scrolling in both axes. Same layer-queue API as the engine renderer
// (ARCHITECTURE.md section 9) so a system written against one works against the
// other. Unlike Mario, this view is NOT a pixel-art pipeline: it renders
// anti-aliased vector art at SUPERSAMPLE density and presents it smoothly.
export class PilotRenderer {
  constructor(canvas) {
    this.viewW = VIEW_W;
    this.viewH = VIEW_H;
    this.ss = SUPERSAMPLE;

    this.buffer = document.createElement('canvas');
    this.buffer.width = VIEW_W * SUPERSAMPLE;
    this.buffer.height = VIEW_H * SUPERSAMPLE;
    this.ctx = this.buffer.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';

    this.canvas = canvas;
    // Overrides pilot.html's `image-rendering: pixelated`, which belongs to the
    // Mario-scale look this view no longer has.
    this.canvas.style.imageRendering = 'auto';
    this.dctx = canvas.getContext('2d', { alpha: false });
    this.dctx.imageSmoothingEnabled = true;
    this.dctx.imageSmoothingQuality = 'high';

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

  // Integer scale only: the buffer is supersampled, so a whole-number
  // presentation scale keeps the sampling grid aligned and the picture crisp.
  resize() {
    const availW = Math.max(VIEW_W, (window.innerWidth || VIEW_W) - 48);
    const availH = Math.max(VIEW_H, (window.innerHeight || VIEW_H) - 96);
    const fit = Math.min(Math.floor(availW / VIEW_W), Math.floor(availH / VIEW_H));
    const s = Math.max(1, Math.min(MAX_SCALE, fit));
    this.scale = s;
    if (this.canvas.width !== VIEW_W * s || this.canvas.height !== VIEW_H * s) {
      this.canvas.width = VIEW_W * s;
      this.canvas.height = VIEW_H * s;
      this.dctx.imageSmoothingEnabled = true;
      this.dctx.imageSmoothingQuality = 'high';
    }
    this.canvas.style.width = `${VIEW_W * s}px`;
    this.canvas.style.height = `${VIEW_H * s}px`;
    return this;
  }

  beginFrame() {
    for (const bucket of this._layers) bucket.length = 0;
    const ctx = this.ctx;
    // Every drawing call downstream works in world pixels; this is the only
    // place the supersample factor appears.
    ctx.setTransform(SUPERSAMPLE, 0, 0, SUPERSAMPLE, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
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
        ctx.setTransform(SUPERSAMPLE, 0, 0, SUPERSAMPLE, 0, 0);
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
    d.imageSmoothingEnabled = true;
    d.imageSmoothingQuality = 'high';
    d.drawImage(this.buffer, 0, 0, this.canvas.width, this.canvas.height);
    this.frames++;
    return this;
  }

  snapshot(type = 'image/png') {
    return this.canvas.toDataURL(type);
  }
}

export { LAYER, SUPERSAMPLE };
export default PilotRenderer;
