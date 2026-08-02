import { LAYER } from '../core/constants.js';
import {
  VIEW_W, VIEW_H, SEA_Y, CEILING_Y, DECK_X0, DECK_X1, DECK_Y, PLANE_W, PLANE_H, clamp,
} from './geo.js';
import { MODE, FLIGHT } from './flight.js';
import { drawSky, drawStars, drawClouds } from './art/sky.js';
import { drawSea, drawWake, drawBowWave, drawSplash, surfaceAt } from './art/sea.js';
import {
  drawHull, drawDeck, drawIsland, drawCrew, drawDeckPark, ISLAND_W, ISLAND_H, DECK_THICK,
} from './art/carrier.js';
import { drawPlane } from './art/plane.js';
import { drawFireball } from './art/ordnance.js';
import { drawPanel, HUD_H } from './art/hud.js';

// Composition only. Every mark on screen is made by a function in art/; this
// file decides where those marks go and in what order.
//
// The panel is anchored to the BOTTOM, as in the original, which has a second
// effect worth stating: it covers the lowest 42 rows of the viewport, so the
// bright band of sea between the horizon and the panel comes out at roughly a
// tenth of the play area — the proportion the original uses — without touching
// the simulation's camera or its world bounds.
// How much of a world pixel a screen pixel is worth. Below 1 the pilot sees
// MORE of the world at once, and everything in it — aircraft, ship, ordnance —
// gets smaller together, so every proportion fought for so far survives intact.
//
// The user's own reference draws the whole world small and fine: a wide field of
// open sky with modest ground features in it, the aeroplane about 14% of the
// frame. Ours was drawn at 1:1 with the simulation and came out zoomed in — the
// aeroplane at 16% and a carrier filling two thirds of the width. This is the
// one knob that fixes both, and it is a pure render transform: the simulation
// still works in world pixels at TILE 16, and nothing downstream of `submit`
// knows the difference.
//
// There is a gameplay reason too. Plan 3 has the pilot hunting Mario across an
// archipelago, and seeing a third more world at a glance is worth having.
export const WORLD_SCALE = 0.76;

// The play area is what the world is framed in; the panel sits below it.
export const PLAY_H = VIEW_H - HUD_H;

// The widest band of sea allowed on screen. Zooming out reveals more below the
// horizon, and the original keeps the water to a thin strip, so the vertical
// framing is clamped here rather than by widening the simulation's world box.
const SEA_BAND = 32;

export const ISLAND_X = DECK_X1 - 150;
const PARK_X = DECK_X1 - 74;
const CREW_X = DECK_X0 + 132;

export class Scene {
  constructor() {
    this.fx = [];
    this.consumed = 0;
    this.tick = 0;
  }

  // Turn sim events into visual effects. Called once per rendered frame; the
  // sim never knows this exists.
  consume(sim) {
    for (let i = this.consumed; i < sim.events.length; i++) {
      const e = sim.events[i];
      if (e.type !== 'planeLost') continue;
      const x = e.x + PLANE_W / 2;
      const y = e.y + PLANE_H / 2;
      this.fx.push(e.reason === 'sea'
        ? { kind: 'splash', x, y: SEA_Y, t: 0, life: 42 }
        : { kind: 'fire', x, y, t: 0, life: 46 });
    }
    this.consumed = sim.events.length;
    this.tick = sim.tick;
    for (const f of this.fx) f.t++;
    this.fx = this.fx.filter((f) => f.t < f.life);
    return this;
  }

  // The world viewport, in world pixels, once WORLD_SCALE has been applied. The
  // drawing functions take these instead of VIEW_W/VIEW_H and are otherwise
  // unaware that any zoom happened.
  frame(sim) {
    const vw = VIEW_W / WORLD_SCALE;
    const vh = VIEW_H / WORLD_SCALE;
    // Re-centre: the simulation frames the aeroplane in the middle of a 512x240
    // window, but the bottom of that window is under the panel, so the world is
    // centred on the middle of the PLAY area instead.
    const x = sim.cam.x + VIEW_W / 2 - vw / 2;
    let y = sim.cam.y + VIEW_H / 2 - PLAY_H / 2 / WORLD_SCALE;
    // Keep the sea a thin strip at the bottom however low the aeroplane goes.
    y = Math.min(y, SEA_Y - (PLAY_H - SEA_BAND) / WORLD_SCALE);
    return { vw, vh, cam: { x, y } };
  }

  submit(r, sim) {
    const f = this.frame(sim);
    const cam = f.cam;
    // Every world layer draws through the same zoom; the panel does not.
    const world = (fn) => (ctx) => {
      ctx.save();
      ctx.scale(WORLD_SCALE, WORLD_SCALE);
      fn(ctx);
      ctx.restore();
    };

    r.draw(LAYER.SKY, world((ctx) => {
      drawSky(ctx, f.vw, f.vh, cam.y, CEILING_Y, SEA_Y);
      drawStars(ctx, f.vw, f.vh, cam, this.tick);
    }));
    r.draw(LAYER.PARALLAX_FAR, world((ctx) => drawClouds(ctx, f.vw, f.vh, cam, this.tick)));
    r.draw(LAYER.BG_TILES, world((ctx) => this.drawShip(ctx, cam, f)));
    r.draw(LAYER.PLAYER, world((ctx) => this.drawAircraft(ctx, sim, cam)));
    r.draw(LAYER.OVERLAY, world((ctx) => {
      drawSea(ctx, f.vw, f.vh, cam, SEA_Y, this.tick);
      this.drawShipWater(ctx, cam, f);
      this.drawFx(ctx, cam);
    }));
    r.draw(LAYER.HUD, (ctx) => this.drawHud(ctx, sim));
    return this;
  }

  // -------------------------------------------------------------------------

  drawShip(ctx, cam, f) {
    if (DECK_X1 + 60 - cam.x < 0 || DECK_X0 - 60 - cam.x > f.vw) return;
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    drawHull(ctx, DECK_X0, DECK_X1, DECK_Y, SEA_Y);
    drawDeck(ctx, DECK_X0, DECK_X1, DECK_Y, this.tick);
    drawIsland(ctx, ISLAND_X, DECK_Y, this.tick);
    drawDeckPark(ctx, PARK_X, DECK_Y);
    drawCrew(ctx, CREW_X, DECK_Y, this.tick);
    ctx.restore();
  }

  // The ship's own water, drawn over the sea so it is not washed out by it.
  drawShipWater(ctx, cam, f) {
    if (DECK_X1 + 80 - cam.x < 0 || DECK_X0 - 220 - cam.x > f.vw) return;
    drawWake(ctx, cam, DECK_X0 - 6, SEA_Y, this.tick);
    drawBowWave(ctx, cam, DECK_X1 + 8, SEA_Y, this.tick);
  }

  drawAircraft(ctx, sim, cam) {
    const p = sim.plane;
    if (p.mode === MODE.DOWN) return;
    drawPlane(ctx, p.x + PLANE_W / 2 - cam.x, p.y + PLANE_H / 2 - cam.y, p.angle, {
      tick: this.tick,
      throttle: p.throttle,
      gear: p.gear,
      hook: p.gear,
    });
  }

  drawFx(ctx, cam) {
    for (const f of this.fx) {
      const t = f.t / f.life;
      const x = f.x - cam.x;
      if (f.kind === 'splash') {
        drawSplash(ctx, x, f.y - cam.y + surfaceAt(f.x, this.tick), t);
      } else {
        drawFireball(ctx, x, f.y - cam.y, t, 22);
      }
    }
  }

  drawHud(ctx, sim) {
    const p = sim.plane;
    const v = sim.lastVerdict;
    drawPanel(ctx, VIEW_W, VIEW_H, sim, {
      minX: sim.bounds.minX,
      maxX: sim.bounds.maxX,
      deckX0: DECK_X0,
      deckX1: DECK_X1,
      seaY: SEA_Y,
      islands: sim.islands,
      fuel: clamp(p.fuel / FLIGHT.FUEL_MAX, 0, 1),
      verdict: v && v.inBox ? String(v.reason).toUpperCase() : '',
    }, this.tick);
  }
}

export { HUD_H, ISLAND_W, ISLAND_H, DECK_THICK };
export default Scene;
