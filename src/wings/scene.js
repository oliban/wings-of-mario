import { LAYER, TILE } from '../core/constants.js';
import { text } from '../data/sprites/font.js';
import {
  VIEW_W, VIEW_H, SEA_Y, CEILING_Y, DECK_X0, DECK_X1, DECK_Y, HULL_BOTTOM,
  PLANE_W, PLANE_H, clamp,
} from './geo.js';
import { MODE, FLIGHT } from './flight.js';
import {
  PLANE_FRAMES, PLANE_PIVOT, PLANE_ANGLE_STEP, PROP_HOLD,
  GEAR, HOOK, GEAR_MOUNTS, HOOK_MOUNT,
} from './art/plane.js';
import {
  C_DECK, C_DECK_PLAIN, C_DECK_WIRE, C_DECK_STRIPE, C_CATWALK, C_CATWALK_LAMP,
  C_HULL, C_WATERLINE, C_BOW, C_STERN, C_ISLAND, C_RADAR, BOW_WAVE,
} from './art/carrier.js';
import { SKY_BANDS, SKY_SEAMS, SEAM_H, CLOUDS_BY_KEY, CLOUD_DECKS, SCUD, SCUD_BANK } from './art/sky.js';
import {
  SEA_BANDS, SEA_SEAMS, SEA_SEAM_H, SWELL_NEAR, SWELL_FAR, CREST, SPRAY, WAKE,
} from './art/sea.js';
import { FIREBALL } from './art/ordnance.js';
import { HUD_PAL, HUD_PLATE, FUEL_BEZEL, SQUADRON_PIP, HOOK_PIP_UP, HOOK_PIP_DOWN } from './art/hud.js';

// ---------------------------------------------------------------------------
// Layout constants for the ship, all derived from geo.js so the art and the
// flight model cannot drift apart.
// ---------------------------------------------------------------------------
const DECK_ROWS = 4; // the deck surface itself
const CATWALK_Y = DECK_Y + DECK_ROWS;
const HULL_TOP = CATWALK_Y + 4;
const BOW_X = DECK_X1 - 20; // C_BOW's deck run ends on its col 20
const STERN_X = DECK_X0 - 4; // C_STERN's deck run starts on its col 4
const ISLAND_X = DECK_X1 - 128;
const ISLAND_Y = DECK_Y - C_ISLAND.h;

const SKY_BAND_H = Math.ceil((SEA_Y - CEILING_Y) / SKY_BANDS.length);
const SEA_BAND_H = 9;

// The plane's attitude table is symmetric about level, so index 6 is level and
// the ends are the two verticals.
const LEVEL_INDEX = (PLANE_FRAMES.length - 1) / 2;
const HALF_PI = Math.PI / 2;

// ---------------------------------------------------------------------------

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
      // Into the water it throws spray; into anything solid it burns.
      this.fx.push(e.reason === 'sea'
        ? { kind: 'spray', x, y: SEA_Y, t: 0, life: SPRAY.duration }
        : { kind: 'fire', x, y, t: 0, life: FIREBALL.duration });
    }
    this.consumed = sim.events.length;
    this.tick = sim.tick;
    for (const f of this.fx) f.t++;
    this.fx = this.fx.filter((f) => f.t < f.life);
    return this;
  }

  submit(r, sim) {
    const cam = sim.cam;
    this.drawSky(r, cam);
    this.drawClouds(r, cam);
    this.drawCarrier(r, cam);
    this.drawPlane(r, sim, cam);
    this.drawSea(r, cam);
    this.drawFx(r, cam);
    this.drawHud(r, sim);
    return this;
  }

  // -------------------------------------------------------------------------
  // Sky
  // -------------------------------------------------------------------------

  // Eight discrete bands from the ceiling down to the horizon haze, with a
  // four-row ordered-dither seam between each pair. Altitude is legible from
  // the backdrop alone, with the whole HUD covered up.
  drawSky(r, cam) {
    r.draw(LAYER.SKY, (ctx) => {
      for (let i = 0; i < SKY_BANDS.length; i++) {
        const top = CEILING_Y + i * SKY_BAND_H - cam.y;
        const bottom = i === SKY_BANDS.length - 1 ? SEA_Y - cam.y : top + SKY_BAND_H;
        if (bottom < 0 || top > VIEW_H) continue;
        ctx.fillStyle = SKY_BANDS[i];
        const y0 = Math.max(0, top);
        ctx.fillRect(0, y0, VIEW_W, Math.min(VIEW_H, bottom) - y0);
      }
      for (let i = 0; i < SKY_SEAMS.length; i++) {
        const y = CEILING_Y + (i + 1) * SKY_BAND_H - SEAM_H / 2 - cam.y;
        if (y < -SEAM_H || y > VIEW_H) continue;
        for (let x = -(cam.x % 16); x < VIEW_W; x += 16) SKY_SEAMS[i].draw(ctx, x, y);
      }
    });
  }

  // Three depths of cloud plus a fast low scud layer. Drift is tick-driven, so
  // a screenshot at tick N is reproducible; the deck lists are literals, so it
  // is the same sky on every run.
  drawClouds(r, cam) {
    r.draw(LAYER.PARALLAX_FAR, (ctx) => {
      for (const c of CLOUD_DECKS) {
        const s = CLOUDS_BY_KEY[c.s];
        const sx = Math.floor(c.x - this.tick * 0.05 * c.m - cam.x * c.m);
        const sy = Math.floor(c.y - cam.y * c.m * 0.7);
        const n = c.s === 'l' ? 3 : 2;
        if (sx > VIEW_W || sx + s.w * n < 0 || sy > VIEW_H || sy + s.h < 0) continue;
        for (let j = 0; j < n; j++) s.draw(ctx, sx + j * (s.w - 12), sy + (j & 1 ? 3 : 0));
      }
    });
    r.draw(LAYER.PARALLAX_NEAR, (ctx) => {
      const f = SCUD.frame(this.tick);
      for (const c of SCUD_BANK) {
        const sx = Math.floor(c.x - this.tick * 0.22 * c.m - cam.x * c.m);
        const sy = Math.floor(c.y - cam.y * c.m * 0.8);
        if (sx > VIEW_W || sx + f.w < 0 || sy > VIEW_H || sy + f.h < 0) continue;
        f.draw(ctx, sx, sy);
        f.draw(ctx, sx + f.w + 6, sy + 2);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Ship
  // -------------------------------------------------------------------------

  drawCarrier(r, cam) {
    r.draw(LAYER.BG_TILES, (ctx) => {
      if (DECK_X1 + 32 - cam.x < 0 || STERN_X - cam.x > VIEW_W) return;
      const oy = -cam.y;

      // Side shell, from under the catwalk down past sea level. The waterline
      // strip is drawn last so its boot topping sits on top of the plating.
      for (let x = DECK_X0; x < DECK_X1; x += TILE) {
        const sx = x - cam.x;
        for (let y = HULL_TOP; y < SEA_Y - 3; y += TILE) C_HULL.draw(ctx, sx, y + oy);
      }
      for (let x = DECK_X0; x < DECK_X1; x += TILE) {
        C_WATERLINE.draw(ctx, x - cam.x, SEA_Y - 3 + oy);
      }

      // The deck: touchdown stripes aft, then three arrestor wires, then the
      // marked landing area, then plain plating up forward.
      let i = 0;
      for (let x = DECK_X0; x < BOW_X; x += TILE, i++) {
        const sx = x - cam.x;
        const tile = i < 2 ? C_DECK_STRIPE
          : i === 3 || i === 5 || i === 7 ? C_DECK_WIRE
            : i > 14 ? C_DECK_PLAIN : C_DECK;
        tile.draw(ctx, sx, DECK_Y + oy);
        // Every other bay of the catwalk carries a lamp, and the lamps blink in
        // two alternating groups off the tick.
        const lit = (i & 1) === ((this.tick >> 5) & 1);
        (lit ? C_CATWALK_LAMP : C_CATWALK).draw(ctx, sx, CATWALK_Y + oy);
      }

      C_STERN.draw(ctx, STERN_X - cam.x, DECK_Y + oy);
      C_BOW.draw(ctx, BOW_X - cam.x, DECK_Y + oy);
      C_ISLAND.draw(ctx, ISLAND_X - cam.x, ISLAND_Y + oy);
      C_RADAR.frame(this.tick).draw(ctx, ISLAND_X + 11 - cam.x, ISLAND_Y - 4 + oy);
    });

  }

  // -------------------------------------------------------------------------
  // Sea
  // -------------------------------------------------------------------------

  // Painted on the OVERLAY layer at partial alpha so the plane and the hull are
  // visibly IN the water when they go under, rather than floating on a flat
  // blue band. Two swell layers scroll at different speeds and crests break on
  // top of them, all driven off the tick.
  drawSea(r, cam) {
    r.draw(LAYER.OVERLAY, (ctx) => {
      const top = SEA_Y - cam.y;
      if (top > VIEW_H) return;

      // Not quite opaque: a hull or an aircraft that goes under has to stay
      // visible through the water rather than simply vanish.
      ctx.globalAlpha = 0.88;
      for (let i = 0; i < SEA_BANDS.length; i++) {
        const y = top + i * SEA_BAND_H;
        const h = i === SEA_BANDS.length - 1 ? VIEW_H - y : SEA_BAND_H;
        if (y + h < 0 || y > VIEW_H) continue;
        ctx.fillStyle = SEA_BANDS[i];
        const y0 = Math.max(0, y);
        ctx.fillRect(0, y0, VIEW_W, Math.max(0, y + h - y0));
      }
      for (let i = 0; i < SEA_SEAMS.length; i++) {
        const y = top + (i + 1) * SEA_BAND_H - SEA_SEAM_H / 2;
        if (y < -SEA_SEAM_H || y > VIEW_H) continue;
        for (let x = -(cam.x % 16); x < VIEW_W; x += 16) SEA_SEAMS[i].draw(ctx, x, y);
      }
      ctx.globalAlpha = 1;

      // The far swell runs slower and shallower than the near one; without the
      // speed difference the surface is one stamped ribbon.
      this.swell(ctx, cam, SWELL_FAR, top - 8, 0.35);
      this.swell(ctx, cam, SWELL_NEAR, top - 5, 0.85);

      // Breaking crests. The pitch is 64px but every third one is nudged and
      // every crest is de-phased by its own index, so the surface reads as a
      // seaway rather than as a row of identical white blobs.
      const first = Math.floor(cam.x / 64) * 64;
      for (let x = first - 64; x < cam.x + VIEW_W + 64; x += 64) {
        const k = Math.floor(x / 64);
        if (((k * 7) & 3) === 0) continue;
        const jitter = ((k * 37) & 15) - 8;
        CREST.frame(this.tick + k * 13).draw(ctx, x + jitter - cam.x, top - 5);
      }

      // The ship's own water: churn boiling out from under the transom and a
      // bow wave curling off the stem. Both scroll off the tick, so the ship is
      // visibly under way even when nothing else on screen is moving.
      if (DECK_X1 + 32 - cam.x > 0 && STERN_X - 128 - cam.x < VIEW_W) {
        const w = WAKE.frame(this.tick);
        const scroll = Math.floor(this.tick * 0.9) % w.w;
        for (let x = STERN_X - 128; x < STERN_X + 12; x += w.w) {
          w.draw(ctx, x - scroll - cam.x, top - 2);
        }
        BOW_WAVE.frame(this.tick).draw(ctx, BOW_X + 4 - cam.x, top - 4);
      }
    });
  }

  swell(ctx, cam, sprite, y, speed) {
    const w = sprite.w;
    const scroll = Math.floor(this.tick * speed) % w;
    const first = Math.floor((cam.x + scroll) / w) * w - scroll;
    for (let x = first; x < cam.x + VIEW_W + w; x += w) sprite.draw(ctx, x - cam.x, y);
  }

  // -------------------------------------------------------------------------
  // Aircraft
  // -------------------------------------------------------------------------

  // Picks the hand-drawn attitude nearest the flight angle. All thirteen frames
  // face right; for the leftward half of a loop the whole aircraft is mirrored,
  // which is the flip an 8-bit carrier game does as the nose passes through the
  // vertical.
  drawPlane(r, sim, cam) {
    r.draw(LAYER.PLAYER, (ctx) => {
      const p = sim.plane;
      if (p.mode === MODE.DOWN) return;
      const cx = Math.floor(p.x + PLANE_W / 2 - cam.x);
      const cy = Math.floor(p.y + PLANE_H / 2 - cam.y);

      const flip = Math.cos(p.angle) < 0;
      // Mirroring maps a rotation of theta onto -theta, so a left-facing plane
      // is drawn flipped and at PI - angle.
      let a = flip ? Math.PI - p.angle : p.angle;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      a = clamp(a, -HALF_PI, HALF_PI);
      const idx = clamp(
        Math.round((a * 180) / Math.PI / PLANE_ANGLE_STEP) + LEVEL_INDEX,
        0, PLANE_FRAMES.length - 1
      );
      const phase = p.throttle > 0 ? Math.floor(this.tick / PROP_HOLD) & 1 : 0;
      const sprite = PLANE_FRAMES[idx][phase];

      // Gear and hook hang off mounts that rotate with the airframe, so they
      // stay on the wing and the tail at every attitude.
      if (p.gear) {
        const q = (idx - LEVEL_INDEX) * PLANE_ANGLE_STEP * Math.PI / 180;
        for (const m of GEAR_MOUNTS) this.hang(ctx, GEAR, cx, cy, m, q, flip, 0, -2);
        this.hang(ctx, HOOK, cx, cy, HOOK_MOUNT, q, flip, 0, 0);
      }

      const ox = flip ? sprite.w - PLANE_PIVOT.x - 1 : PLANE_PIVOT.x;
      ctx.drawImage(sprite.variant(flip, false), cx - ox, cy - PLANE_PIVOT.y);
    });
  }

  // Place a hanging part at a sprite-local mount rotated into world space.
  hang(ctx, sprite, cx, cy, mount, angle, flip, ax, ay) {
    const mx = flip ? -mount.x : mount.x;
    const c = Math.cos(flip ? -angle : angle);
    const s = Math.sin(flip ? -angle : angle);
    const x = cx + Math.round(mx * c - mount.y * s) + ax - (sprite.w >> 1);
    const y = cy + Math.round(mx * s + mount.y * c) + ay;
    ctx.drawImage(sprite.variant(flip, false), x, y);
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  drawFx(r, cam) {
    if (!this.fx.length) return;
    // Submitted to OVERLAY after the sea, so spray lands on top of the water
    // rather than under it.
    r.draw(LAYER.OVERLAY, (ctx) => {
      for (const f of this.fx) {
        const anim = f.kind === 'spray' ? SPRAY : FIREBALL;
        const s = anim.frame(f.t);
        const x = Math.floor(f.x - cam.x - s.w / 2);
        const y = Math.floor(f.y - cam.y - (f.kind === 'spray' ? s.h - 2 : s.h / 2));
        s.draw(ctx, x, y);
        if (f.kind !== 'spray') continue;
        // A crash throws water sideways as well as up.
        s.draw(ctx, x - 9, y + 3, true);
        s.draw(ctx, x + 9, y + 3);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Panel
  // -------------------------------------------------------------------------

  drawHud(r, sim) {
    r.draw(LAYER.HUD, (ctx) => {
      const p = sim.plane;
      for (let x = 0; x < VIEW_W; x += HUD_PLATE.w) HUD_PLATE.draw(ctx, x, 0);

      // Laid out by advancing through the returned glyph widths rather than by
      // hand-tuned pixel columns, so a longer reading can never sit on top of
      // the next label.
      let x = 6;
      x += label(ctx, 'FUEL', x, 4) + 4;
      const k = clamp(p.fuel / FLIGHT.FUEL_MAX, 0, 1);
      ctx.fillStyle = k > 0.5 ? HUD_PAL[6] : k > 0.2 ? HUD_PAL[8] : HUD_PAL[7];
      ctx.fillRect(x + 2, 5, Math.round(62 * k), 6);
      FUEL_BEZEL.draw(ctx, x, 2);
      x += FUEL_BEZEL.w + 10;

      x += label(ctx, 'SQDN', x, 4) + 6;
      for (let i = 0; i < sim.squadron; i++) SQUADRON_PIP.draw(ctx, x + i * 9, 5);

      if (sim.status === 'lost') label(ctx, 'PLANE LOST - PRESS R', 300, 4);
      else if (sim.status === 'over') label(ctx, 'SQUADRON GONE', 344, 4);

      let y = 6;
      y += label(ctx, 'ALT', y, 15) + 3;
      y += label(ctx, String(Math.max(0, Math.round(SEA_Y - (p.y + PLANE_H)))), y, 15) + 10;
      y += label(ctx, 'SPD', y, 15) + 3;
      y += label(ctx, p.speed.toFixed(1), y, 15) + 10;
      y += label(ctx, 'HOOK', y, 15) + 3;
      (p.gear ? HOOK_PIP_DOWN : HOOK_PIP_UP).draw(ctx, y, 15);

      // The approach gate, so the pilot can see WHY the last one was a crash.
      const v = sim.lastVerdict;
      if (v && v.inBox) label(ctx, v.reason.toUpperCase(), 300, 15);
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

export { HULL_BOTTOM };
export default Scene;
