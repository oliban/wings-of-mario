import { LAYER, TILE } from '../core/constants.js';
import { text } from '../data/sprites/font.js';
import {
  VIEW_W, VIEW_H, SEA_Y, CEILING_Y, DECK_X0, DECK_X1, DECK_Y, PLANE_W, PLANE_H, clamp,
} from './geo.js';
import { MODE, FLIGHT } from './flight.js';
import { PLANE_ANIM, HOOK } from './art/plane.js';
import { C_DECK, C_HULL, C_WATERLINE, C_TOWER } from './art/carrier.js';
import { SKY_TOP, SKY_HAZE, SEA_SHALLOW, SEA_DEEP, WAVE_ANIM, CLOUD } from './art/ocean.js';

// Rotation is quantised to 1/32 of a turn. Free rotation of a pixel sprite
// shimmers as the sampling grid slides under it; 32 stops reads as smooth and
// stays stable enough to look drawn rather than filtered.
const ROT_STEPS = 32;
const ROT_STEP = (Math.PI * 2) / ROT_STEPS;

export function drawRotated(ctx, sprite, cx, cy, angle, flipX = false) {
  const a = Math.round(angle / ROT_STEP) * ROT_STEP;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.floor(cx), Math.floor(cy));
  ctx.rotate(a);
  ctx.drawImage(sprite.variant(flipX, false), -Math.floor(sprite.w / 2), -Math.floor(sprite.h / 2));
  ctx.restore();
}

// Clouds sit at fixed world positions and drift. The list is a literal, so the
// sky is identical on every run and in every screenshot.
const CLOUDS = [
  { x: 320, y: 60, m: 0.35 }, { x: 980, y: 128, m: 0.5 }, { x: 1500, y: 40, m: 0.25 },
  { x: 2100, y: 150, m: 0.55 }, { x: 2760, y: 80, m: 0.4 }, { x: 3400, y: 36, m: 0.3 },
  { x: 4100, y: 140, m: 0.5 }, { x: 4800, y: 96, m: 0.35 }, { x: 5600, y: 52, m: 0.28 },
];

export class Scene {
  constructor() {
    this.fx = [];
    this.consumed = 0;
    this.tick = 0;
  }

  // Turn sim events into visual effects. Called once per rendered frame; the
  // sim never knows this exists. Tasks 2 and 3 add cases here.
  consume(sim) {
    for (let i = this.consumed; i < sim.events.length; i++) {
      const e = sim.events[i];
      if (e.type === 'planeLost') this.fx.push({ kind: 'blast', x: e.x, y: e.y, r: 40, t: 0 });
    }
    this.consumed = sim.events.length;
    this.tick = sim.tick;
    for (const f of this.fx) f.t++;
    this.fx = this.fx.filter((f) => f.t < 24);
    return this;
  }

  submit(r, sim) {
    const cam = sim.cam;
    this.drawSky(r, cam);
    this.drawClouds(r, cam);
    this.drawCarrier(r, cam);
    this.drawSea(r, cam);
    this.drawPlane(r, sim, cam);
    this.drawHud(r, sim);
    return this;
  }

  // Deep blue at the ceiling fading to haze at the horizon, so altitude is
  // legible from the backdrop alone with the HUD covered up.
  drawSky(r, cam) {
    r.draw(LAYER.SKY, (ctx) => {
      const g = ctx.createLinearGradient(0, CEILING_Y - cam.y, 0, SEA_Y - cam.y);
      g.addColorStop(0, SKY_TOP);
      g.addColorStop(1, SKY_HAZE);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    });
  }

  drawClouds(r, cam) {
    r.draw(LAYER.PARALLAX_FAR, (ctx) => {
      for (const c of CLOUDS) {
        const drift = (this.tick * 0.02 * c.m) % 4096;
        const sx = Math.floor(c.x - drift - cam.x * c.m);
        const sy = Math.floor(c.y - cam.y * c.m * 0.6);
        if (sx > VIEW_W || sx + CLOUD.w * 3 < 0) continue;
        // Three overlapping stamps make one bigger, less repetitive cloud.
        CLOUD.draw(ctx, sx, sy);
        CLOUD.draw(ctx, sx + 12, sy + 2);
        CLOUD.draw(ctx, sx + 24, sy - 1);
      }
    });
  }

  drawCarrier(r, cam) {
    r.draw(LAYER.BG_TILES, (ctx) => {
      if (DECK_X1 - cam.x < 0 || DECK_X0 - cam.x > VIEW_W) return;
      for (let x = DECK_X0; x < DECK_X1; x += TILE) {
        const sx = x - cam.x;
        C_DECK.draw(ctx, sx, DECK_Y - cam.y);
        for (let y = DECK_Y + TILE; y < SEA_Y - TILE; y += TILE) C_HULL.draw(ctx, sx, y - cam.y);
        C_WATERLINE.draw(ctx, sx, SEA_Y - TILE - cam.y);
      }
      C_TOWER.draw(ctx, DECK_X1 - 64 - cam.x, DECK_Y - C_TOWER.h - cam.y);
    });
  }

  // Painted on the OVERLAY layer so the plane and the hull are visibly IN the
  // water when they go under, rather than floating on a flat blue band.
  drawSea(r, cam) {
    r.draw(LAYER.OVERLAY, (ctx) => {
      const top = SEA_Y - cam.y;
      if (top > VIEW_H) return;
      const g = ctx.createLinearGradient(0, top, 0, VIEW_H);
      g.addColorStop(0, SEA_SHALLOW);
      g.addColorStop(1, SEA_DEEP);
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = g;
      ctx.fillRect(0, Math.max(0, top), VIEW_W, VIEW_H - Math.max(0, top));
      ctx.globalAlpha = 1;

      const w = WAVE_ANIM.frames[0].w;
      const first = Math.floor(cam.x / w) * w;
      for (let x = first; x < cam.x + VIEW_W + w; x += w) {
        // De-phase alternate columns so the swell is not a stamped ribbon.
        WAVE_ANIM.frame(this.tick + (x / w) * 5).draw(ctx, x - cam.x, top - 2);
      }
    });
  }

  drawPlane(r, sim, cam) {
    r.draw(LAYER.PLAYER, (ctx) => {
      const p = sim.plane;
      if (p.mode === MODE.DOWN) ctx.globalAlpha = 0.6;
      const cx = p.x + PLANE_W / 2 - cam.x;
      const cy = p.y + PLANE_H / 2 - cam.y;
      // Mirroring maps a rotation of theta onto -theta, so a left-facing plane
      // is drawn flipped and rotated by PI - angle.
      const flip = Math.cos(p.angle) < 0;
      const rot = flip ? Math.PI - p.angle : p.angle;
      if (p.gear) drawRotated(ctx, HOOK, cx - (flip ? -10 : 10), cy + 4, rot, flip);
      drawRotated(ctx, PLANE_ANIM.frame(p.throttle > 0 ? this.tick : 0), cx, cy, rot, flip);
      ctx.globalAlpha = 1;
    });
  }

  drawHud(r, sim) {
    r.draw(LAYER.HUD, (ctx) => {
      const p = sim.plane;
      ctx.fillStyle = 'rgba(6,10,18,0.72)';
      ctx.fillRect(0, 0, VIEW_W, 26);
      ctx.fillStyle = 'rgba(120,160,255,0.4)';
      ctx.fillRect(0, 26, VIEW_W, 1);

      label(ctx, 'FUEL', 8, 4);
      bar(ctx, 44, 6, 72, 8, p.fuel / FLIGHT.FUEL_MAX, '#4ad06a', '#c33a2c');
      label(ctx, `PLANES ${sim.squadron}`, 132, 4);
      label(ctx, `ALT ${Math.max(0, Math.round(SEA_Y - (p.y + PLANE_H)))}`, 8, 14);
      label(ctx, `SPD ${p.speed.toFixed(1)}`, 92, 14);
      label(ctx, p.gear ? 'HOOK DOWN' : 'HOOK UP', 168, 14);
      // The approach gate, so the pilot can see WHY the last one was a crash.
      const v = sim.lastVerdict;
      if (v && v.inBox) label(ctx, v.reason.toUpperCase(), 268, 14);
      if (sim.status === 'lost') label(ctx, 'PLANE LOST - R', 380, 4);
      if (sim.status === 'over') label(ctx, 'SQUADRON GONE', 380, 4);
    });
  }
}

function label(ctx, str, x, y) {
  let cx = x;
  for (const glyph of text(String(str))) {
    glyph.draw(ctx, cx, y);
    cx += glyph.w;
  }
  return cx - x;
}

function bar(ctx, x, y, w, h, fraction, full, empty) {
  const k = clamp(fraction, 0, 1);
  ctx.fillStyle = '#0a0d14';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#1d2430';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = k > 0.25 ? full : empty;
  ctx.fillRect(x, y, Math.round(w * k), h);
}

export default Scene;
