import { SCREEN_W, TILE } from '../core/constants.js';
import { Telegraph, edgeArrow } from './telegraph.js';
import { WhistleVoice } from './whistle.js';
import { WhistleSynth } from './whistle-audio.js';
import { assertLocalY } from './geo.js';
import { drawReticle, drawEdgeArrow } from './art/telegraph.js';
import { BombSight } from './bomb-sight.js';

// Mario's side of the telegraph.
//
// It owns its own canvas, stacked over the game's, and it advances off the
// ENGINE's fixed-step counter (window.__GAME.game.loop.tick) rather than off a
// clock. That is what lets it be deterministic without an engine seam: the
// same number ticks whether the game is running at 60Hz, being stepped by
// tools/shot.mjs, or being driven by a Playwright test.
export const OVERLAY_ID = 'wings-overlay';

// A backgrounded tab comes back with a tick delta of thousands. Running them
// all in one frame would freeze the page; the cap drops them instead, which
// for a bomb in the air means it lands slightly early.
//
// A third of a second: ordinary hitches — a level load, a GC pause, a slow
// first frame after boot — routinely deliver more than a handful of ticks at
// once, and clamping those would leave the telegraph permanently behind the
// engine it is supposed to be predicting. Only a genuinely backgrounded tab
// exceeds this.
export const MAX_CATCHUP = 20;

export class MarioOverlay {
  constructor(opts = {}) {
    this.api = null; // window.__GAME
    this.canvas = null;
    this.ctx = null;
    this.lastTick = null;
    this.frame = 0;
    this.marks = [];
    // Extra per-step consumers. The ferry (Task 5) and the match (Task 7) push
    // themselves in here rather than each growing their own rAF loop.
    this.hooks = [];
    // Extra per-FRAME painters, called with (ctx, cam, frame) in GAME pixels
    // with the camera already available to subtract — the same contract the
    // reticle drawing below works to. The supply drop uses this
    // (src/wings/mario-main.js), and it exists for the same reason `hooks`
    // does: this canvas is the wings layer's only seam onto Mario's screen, and
    // anything that needs to draw over the game should share it rather than
    // grow a second stacked canvas of its own.
    this.painters = [];
    this.telegraph = new Telegraph({ surfaceAt: (px) => this.surfaceAt(px) });
    this.sight = new BombSight(); // the falling bomb itself; owns no physics
    this.synth = opts.synth || new WhistleSynth();
    this.whistle = new WhistleVoice(opts.sink || ((o) => this.synth.play(o)));
  }

  get world() {
    return this.api ? this.api.world : null;
  }

  attach(api) {
    this.api = api;
    // Take the engine's tick reading NOW rather than on the first pump(). The
    // game may already have been running for thousands of ticks when this
    // module finishes polling for __GAME, and a first pump() that discovered
    // its own baseline would either lose the first frames after a release or,
    // worse, hand MAX_CATCHUP a delta that has nothing to do with elapsed time.
    const loop = api && api.game && api.game.loop;
    if (loop) this.lastTick = loop.tick;
    this.mount();
    return this;
  }

  // WHY THIS IS NOT #overlay. Game.render() calls drawHarryOverlay() every
  // frame, whose second statement is an UNCONDITIONAL
  // clearRect(0, 0, cv.width, cv.height) — before its own early return. Any
  // pixel we put in that buffer is erased by the next engine frame, and which
  // of the two rAF callbacks runs last is not ours to decide. So we stack our
  // own canvas beside it, with the same geometry and one z-index higher. Same
  // surface, same technique, same one-line footprint in index.html.
  mount() {
    if (this.canvas) return this.canvas;
    if (typeof document === 'undefined') return null;
    const stage = document.getElementById('stage');
    if (!stage) return null;
    const cv = document.createElement('canvas');
    cv.id = OVERLAY_ID;
    cv.style.position = 'absolute';
    cv.style.pointerEvents = 'none';
    cv.style.borderRadius = '4px';
    cv.style.zIndex = '3'; // #overlay is 2
    stage.appendChild(cv);
    this.canvas = cv;
    this.ctx = cv.getContext('2d');
    return cv;
  }

  // Match the game canvas exactly and return the display scale: one game pixel
  // is `k` device pixels. Read every frame because a window resize changes it.
  // Position is copied from #screen's own offset inside #stage rather than
  // from the stylesheet, so the stage's padding — 18px normally, 0 in headless
  // mode — is never duplicated as a constant here.
  resize() {
    const src = this.api && this.api.renderer && this.api.renderer.canvas;
    if (!src) return 1;
    const k = src.width / SCREEN_W;
    if (!this.canvas) return k;
    if (this.canvas.width !== src.width || this.canvas.height !== src.height) {
      this.canvas.width = src.width;
      this.canvas.height = src.height;
    }
    this.canvas.style.width = src.style.width;
    this.canvas.style.height = src.style.height;
    this.canvas.style.left = `${src.offsetLeft}px`;
    this.canvas.style.top = `${src.offsetTop}px`;
    return k;
  }

  // The first blocking surface in a column, in island-local pixels, read from
  // the LIVE tile map — so a crater the pilot already made is a hole the
  // reticle drops through, exactly like the bomb will.
  surfaceAt(px) {
    const w = this.world;
    if (!w || !w.level) return this.telegraph.floorY;
    const tx = Math.floor(px / TILE);
    if (tx < 0 || tx >= w.w) return this.telegraph.floorY;
    for (let ty = 0; ty < w.h; ty++) {
      const rec = w.recAt(tx, ty);
      if (rec.solid || rec.platform) return ty * TILE;
    }
    return this.telegraph.floorY;
  }

  // A release. `state` is {kind, x, y, vx, vy} in ISLAND-LOCAL pixels, plus an
  // id. Task 8 hands this the `bombRelease` event's payload, already converted
  // by net-bridge.js's toLocal(); until then window.__TELEGRAPH.drop() builds
  // one directly. assertLocalY guards exactly the mistake of that conversion
  // being skipped: a world-space y passed straight through does not crash
  // anything, it just puts the reticle ISLAND_TOP_Y px below a 240px screen.
  add(state) {
    assertLocalY(state.y, 'MarioOverlay.add(state.y)');
    return this.telegraph.add(state);
  }

  sync(id, state) {
    assertLocalY(state.y, 'MarioOverlay.sync(state.y)');
    return this.telegraph.sync(id, state);
  }

  reset() {
    this.telegraph.clear();
    this.sight.clear();
    this.whistle.reset();
    this.marks = [];
  }

  // Catch up with the engine and draw. Called from our own rAF in play, and
  // directly by window.__TELEGRAPH.pump() in tests.
  pump() {
    const loop = this.api && this.api.game && this.api.game.loop;
    if (!loop) return 0;
    const now = loop.tick;
    if (this.lastTick == null) this.lastTick = now;
    let steps = now - this.lastTick;
    this.lastTick = now;
    // A reset loop rewinds the counter. Resume from wherever it now is rather
    // than running a negative number of steps.
    if (steps < 0) steps = 0;
    if (steps > MAX_CATCHUP) steps = MAX_CATCHUP;
    for (let i = 0; i < steps; i++) this.step();
    this.draw();
    return steps;
  }

  // One fixed 60.0988Hz step, on Mario's clock.
  step() {
    const world = this.world;
    if (!world || !world.level) {
      if (this.marks.length || this.telegraph.shots.size) this.reset();
      return;
    }
    this.telegraph.floorY = world.h * TILE;
    this.telegraph.step();
    const p = world.player;
    const marioX = p ? p.x + (p.w || TILE) / 2 : 0;
    // The camera here is last frame's — the engine syncs its render camera
    // during submit(). The arrow is recomputed against the live camera in
    // draw() for exactly that reason; what marks() is needed for here is the
    // pan and the pitch, neither of which is a camera question.
    this.marks = this.telegraph.marks(marioX, world.rcam);
    this.whistle.update(this.marks);
    for (const e of this.telegraph.drain()) {
      if (e.type === 'impact' || e.type === 'expired') this.whistle.stop(e.id);
    }
    for (const hook of this.hooks) hook(world);
    this.frame++;
  }

  draw() {
    const k = this.resize();
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const world = this.world;
    // No `!this.marks.length` here: the frame a bomb ARRIVES is a frame with
    // no marks in it, and the sight has to be run on it to notice.
    if (!world || !world.level) return;
    const cam = world.rcam;
    // From here on the context is in GAME pixels: the art module draws whole
    // 256x240 pixels and the transform scales them to the display.
    ctx.setTransform(k, 0, 0, k, 0, 0);
    // FIRST, under the telegraph: a supply crate is an object in the world and
    // the reticle is an instrument reading. An instrument that a falling crate
    // could hide would be a worse trade than a crate with a reticle drawn over
    // it, and the two are hardly ever on screen together anyway.
    for (const paint of this.painters) paint(ctx, cam, this.frame);
    for (const m of this.marks) {
      if (m.impact) {
        const sx = m.impact.tx * TILE + TILE / 2 - cam.x;
        const sy = m.impact.ty * TILE - cam.y;
        if (sx > -40 && sx < cam.w + 40 && sy > -40 && sy < cam.h + 40) {
          drawReticle(ctx, sx, sy, m.radius, {
            urgent: m.impact.ticks < 30,
            frame: this.frame,
          });
        }
      }
      const arrow = edgeArrow(m.x, m.y, cam);
      if (arrow) drawEdgeArrow(ctx, arrow.x, arrow.y, arrow.angle);
    }
    // Last, over the reticle it is falling into.
    this.sight.draw(ctx, this.marks, cam, this.frame);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

export default MarioOverlay;
