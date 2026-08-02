import { LAYER } from '../core/constants.js';
import {
  VIEW_W, VIEW_H, SEA_Y, CEILING_Y, DECK_X0, DECK_X1, DECK_Y, PLANE_W, PLANE_H, clamp,
} from './geo.js';
import { MODE, FLIGHT, normalizeAngle } from './flight.js';
import { drawSky, drawClouds } from './art/sky.js';
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
// The user's reference frames the ship LARGE — it spans the whole width, with the
// aeroplane a small dark shape on it at about an eighth of the frame. The fault
// was never the sprite on its own, it was the ratio: our aeroplane was a fifth of
// the flight deck where theirs is a ninth. So the aeroplane came down to 42 world
// pixels and the world is drawn slightly magnified, which puts the ship across
// three quarters of the frame and the aeroplane at 11% of it — their proportions,
// both terms at once.
//
// It is a pure render transform: the simulation still works in world pixels at
// TILE 16, and nothing downstream of `submit` knows the difference.
export const WORLD_SCALE = 1.15;

// The play area is what the world is framed in; the panel sits below it.
export const PLAY_H = VIEW_H - HUD_H;

// The widest band of sea allowed on screen. Zooming out reveals more below the
// horizon, and the original keeps the water to a thin strip, so the vertical
// framing is clamped here rather than by widening the simulation's world box.
const SEA_BAND = 13;

export const ISLAND_X = DECK_X1 - 150;
const PARK_X = DECK_X1 - 74;
const CREW_X = DECK_X0 + 132;

// THE REVERSAL.
//
// The aeroplane changes ends by looping, and at the top of that loop it is
// upside down and pointing the other way. The original resolves this the way
// every pilot does — it rolls upright — and the way a 1987 sprite engine could
// afford to: instantly, at the frame where the nose passes the vertical. The
// instant version is what reads as a sprite being flipped rather than an
// aeroplane being flown, so here that same half-roll is given a duration.
//
// It is a second-order system, not a curve lookup, because the two things that
// make a manoeuvre read as having weight are exactly what a spring gives for
// free: it does not arrive at the new attitude the instant the input says so,
// and it does not stop dead when it gets there.
//
//   STIFFNESS/DAMPING put the half-roll through the planform three ticks after
//   the nose passes the vertical and settled by tick twelve — a fifth of a
//   second of roll, with a wing-rock behind it. This happens every time the
//   player turns round, several times a minute, so it is deliberately at the
//   short end: anything statelier is charming twice and irritating thereafter.
//
//   LEAD is the anticipation. The bank is offset by the rate the nose is
//   moving, so pulling into the loop banks the aeroplane a few degrees BEFORE
//   the reversal commits, and relaxing the stick rolls it level again. It costs
//   nothing — the pitch rate is just the difference between two angles — and it
//   is most of why the roll looks like it was flown rather than triggered.
const ROLL = {
  STIFFNESS: 0.11,
  DAMPING: 0.4,
  LEAD: 5.2,
  LEAD_MAX: 0.3,
  // A jump bigger than any one tick of TURN_RATE can produce is a respawn or a
  // teleport, not flying. Snap rather than roll through it.
  TELEPORT: 0.5,
  // Never integrate more than this many ticks of catch-up in one frame.
  MAX_STEPS: 8,
};

export class Scene {
  constructor() {
    this.fx = [];
    this.consumed = 0;
    this.tick = 0;
    // Bank angle about the fuselage axis, its rate, and the attitude it is
    // heading for. `rollTarget` accumulates a half turn per crossing of the
    // vertical, in the direction the nose is already sweeping, so a full loop
    // rolls all the way round once and comes out where it started.
    this.roll = 0;
    this.rollVel = 0;
    this.rollTarget = 0;
    this.prevAngle = 0;
  }

  // THE TRIGGER, and the only part of the roll that knows WHY the aeroplane is
  // changing ends. Everything below it cares about one scalar — `rollTarget`,
  // the bank angle in radians the aeroplane is heading for — so replacing this
  // method replaces the manoeuvre without touching the animation.
  //
  // Today it is inferred: the nose crossing the vertical is what reverses the
  // heading, so each crossing adds a half turn, signed by the direction the
  // nose is already sweeping. That makes a whole loop a whole barrel roll
  // rather than a roll and an unroll.
  //
  // When the simulation owns the manoeuvre and publishes its progress, this
  // whole body becomes the one line that reads it. For a progress in 0..1 that
  // is `this.rollTarget = this.rollBase + Math.PI * progress * dir`, with
  // `rollBase` latched to the settled bank when the manoeuvre begins; for a
  // discrete began/ended pair it is the same `+= PI` this does now, just fired
  // by the event instead of by the angle. Neither needs the spring changed.
  reversalTarget(p, d) {
    if ((Math.cos(this.prevAngle) >= 0) !== (Math.cos(p.angle) >= 0)) {
      this.rollTarget += d < 0 ? -Math.PI : Math.PI;
    }
  }

  // One tick of the roll. Called once per elapsed SIMULATION tick — never once
  // per rendered frame and never against a clock — so the attitude at sim tick
  // N is the same attitude however many frames the browser managed to draw.
  stepRoll(p) {
    const a = p.angle;
    // On the deck the aeroplane is upright, facing right, by definition. This
    // is also what puts a respawn back the right way up without a special case.
    if (p.mode === MODE.DECK || p.mode === MODE.ROLL) {
      this.roll = 0;
      this.rollVel = 0;
      this.rollTarget = 0;
      this.prevAngle = a;
      return;
    }
    const d = normalizeAngle(a - this.prevAngle);
    if (Math.abs(d) > ROLL.TELEPORT) {
      this.rollTarget = Math.cos(a) < 0 ? Math.PI : 0;
      this.roll = this.rollTarget;
      this.rollVel = 0;
      this.prevAngle = a;
      // The jump is not a pitch rate, so it must not lead the bank either.
      return;
    }
    this.reversalTarget(p, d);
    this.prevAngle = a;

    // Anticipation, and the only other thing the bank reads: the rate the nose
    // is moving. It is manoeuvre-agnostic — a wingover swings the nose too — so
    // it survives the trigger being replaced.
    const lead = clamp(ROLL.LEAD * d, -ROLL.LEAD_MAX, ROLL.LEAD_MAX);
    this.rollVel += (this.rollTarget + lead - this.roll) * ROLL.STIFFNESS;
    this.rollVel *= 1 - ROLL.DAMPING;
    this.roll += this.rollVel;
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
    // Catch up the roll one simulation tick at a time. A dropped frame costs
    // the intermediate headings, not the tick count, so a long stall settles to
    // the same attitude instead of leaving the aeroplane banked.
    const steps = Math.min(Math.max(sim.tick - this.tick, 0), ROLL.MAX_STEPS);
    for (let i = 0; i < steps; i++) this.stepRoll(sim.plane);
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

    r.draw(LAYER.SKY, world((ctx) => drawSky(ctx, f.vw, f.vh, cam.y, CEILING_Y, SEA_Y)));
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
      roll: this.roll,
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
