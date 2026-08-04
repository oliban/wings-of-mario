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
import { drawLandmass } from './art/land.js';
import { drawBomb, drawTracer, drawRocket, drawFireball } from './art/ordnance.js';
import { MARIO_CONTACT } from './art/contact.js';
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
//
// This is now the SEA-LEVEL scale specifically — the widest the world is ever
// drawn, and the one the ship and the aeroplane were proportioned against.
// Climbing scales the world down from here; see ZOOM below.
export const WORLD_SCALE = 1.15;

// The play area is what the world is framed in; the panel sits below it.
export const PLAY_H = VIEW_H - HUD_H;

// The widest band of sea allowed on screen. Zooming out reveals more below the
// horizon, and the original keeps the water to a thin strip, so the vertical
// framing is clamped here rather than by widening the simulation's world box.
const SEA_BAND = 13;

// ALTITUDE ZOOM, AND THE FRAMING THAT MAKES IT WORTH ANYTHING.
//
// The user's reference is the original seen from height: the aeroplane a speck
// near the top, the island a thin strip of palms along the bottom, sky filling
// everything between. The first pass at this scaled the world down with
// altitude and left the camera centred on the aeroplane, and the user's answer
// was exact: "it zooms out but I need to be able to see the island when high
// above it". Scaling alone cannot do it. Centring puts half the play area
// above an aeroplane that has nothing above it, and the ground falls out of
// the bottom no matter how small the world is drawn.
//
// THE RULE, therefore, is a composition rather than a curve:
//
//   the SEA LINE sits SEA_BAND above the bottom of the play area,
//   the AEROPLANE rides at PLANE_ROW down from the top of it,
//   and the SCALE is whatever makes both true at once.
//
// Which is one division: the world distance from the aeroplane down to the sea
// has to fit the device distance between those two rows. Everything the pilot
// needs is between those rows by construction — the aeroplane, the water, the
// island standing in it — at every altitude, rather than at the altitudes a
// hand-tuned curve happened to keep them both.
//
// Two consequences worth stating plainly:
//
//   THE DEAD BAND IS FREE. At the attack altitude the existing framing ALREADY
//   pinned the sea to the bottom of the play area (that is what SEA_BAND did),
//   so PLANE_ROW is not a new number — it is measured from that framing, and
//   the rule reproduces it exactly at FROM_Y and is clamped to WORLD_SCALE
//   below it. Nothing changes where the bombing happens.
//
//   THE SCALE FALLS AS 1/HEIGHT, not as a gentle ease, because pinning two
//   points on a fixed screen while their separation grows is exactly what
//   perspective is. Climbing 60px from the attack altitude takes a third off
//   the scale. That is the cost of the requirement, and it is why the earlier
//   smoothstep — pleasant, gradual, and useless — was the wrong shape.
//
// It remains a pure function of the aeroplane's position: no clock, no state,
// no history, so a screenshot at tick N frames identically however many frames
// were drawn getting there.
export const ZOOM = {
  MAX: WORLD_SCALE,
  // The floor is not a taste decision, it is the smallest scale the geometry
  // needs: at the service ceiling the aeroplane is 554 world px above the sea,
  // and fitting that into the play area with the aeroplane clear of the top
  // edge takes 0.32. Anything larger and the water leaves the screen at the
  // top of the climb, which is the bug this pass exists to fix. It costs: the
  // aeroplane is 13 screen pixels up there, close to the reference's own
  // speck. Anything SMALLER would only shrink it for nothing.
  MIN: 0.32,
  // The top of the dead band: the attack altitude, below which the framing is
  // exactly what it was before any zoom existed.
  FROM_Y: 440,
  // How close to the top edge the aeroplane may be pushed once the scale has
  // bottomed out and the sea can no longer be pinned as well.
  TOP_MIN: 14,
};

// Where the sea line sits: SEA_BAND device pixels above the bottom of the play
// area. The original keeps the water to a thin strip and so does this.
const SEA_ROW = PLAY_H - SEA_BAND;

// Where the aeroplane rides, in device pixels down from the top of the play
// area. DERIVED from the old framing at the top of the dead band, so the rule
// below is continuous with it: at FROM_Y it produces the identical picture.
const PLANE_ROW = SEA_ROW - ZOOM.MAX * (SEA_Y - ZOOM.FROM_Y - PLANE_H / 2);

// The device distance between those two rows — the window everything has to
// fit into.
const FIT = SEA_ROW - PLANE_ROW;

// The scale for an aeroplane whose top-left is at world y. One division, then
// clamped: full scale wherever the aeroplane is low enough that the picture
// already fits, and never below the floor.
export function zoomFor(planeY) {
  const drop = SEA_Y - (planeY + PLANE_H / 2);
  if (drop <= 0) return ZOOM.MAX;
  return clamp(FIT / drop, ZOOM.MIN, ZOOM.MAX);
}

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

// There was a landBias() here — the frame dropped 40px over an island so the
// terrain surface cleared the instrument panel. Pinning the sea line subsumes
// it completely: the water is at the bottom of the play area everywhere, over
// open ocean and over land alike, and an island stands in that water. A second
// bias on top would only move the horizon around depending on where you were,
// which is the opposite of what a horizon is for.

// A plane that is not mid-manoeuvre, in the shape state() publishes.
const NOT_TURNING = { turning: false, turnProgress: 0, turnDir: 0 };

// A detonation, as an effect. Size comes off the blast radius in TILES, so a
// bomb's crater and its fireball are the same event at the same scale, and a
// gun round (radius 0) is a spark rather than an explosion.
function detonationFx(e) {
  if (e.water) {
    return { kind: 'splash', x: e.x, y: SEA_Y, t: 0, life: e.radius > 0 ? 40 : 16, size: e.radius };
  }
  return {
    kind: 'fire',
    x: e.x,
    y: e.y,
    t: 0,
    life: e.radius > 0 ? 40 : 12,
    size: e.radius > 0 ? 10 + e.radius * 7 : 7,
  };
}

export class Scene {
  constructor() {
    this.fx = [];
    this.consumed = 0;
    this.tick = 0;
    // Bank angle about the fuselage axis, its rate, and the attitude it is
    // heading for. `rollTarget` accumulates a half turn per crossing of the
    // vertical, in the direction the nose is already sweeping, so a full loop
    // rolls all the way round once and comes out where it started.
    // The scale the world is currently drawn at, chasing zoomFor(altitude).
    this.zoom = ZOOM.MAX;
    this.roll = 0;
    this.rollVel = 0;
    this.rollTarget = 0;
    this.rollBase = 0;
    this.rollDir = 1;
    this.wasTurning = false;
    this.prevAngle = 0;
    // The networked peer, in WORLD pixels, or null when playing offline.
    // src/net/pilot-side.js writes it; nothing else touches it.
    this.remoteMario = null;
  }

  // THE TRIGGER, and the only part of the roll that knows WHY the aeroplane is
  // changing ends. Everything below it cares about one scalar — `rollTarget`,
  // the bank angle in radians the aeroplane is heading for — so replacing this
  // method replaces the manoeuvre without touching the animation.
  //
  // It used to be inferred from the nose crossing the vertical, which was the
  // loop. Players change ends with the STALL TURN now, and the simulation owns
  // that manoeuvre and publishes it (`turning`, `turnProgress`, `turnDir`), so
  // this reads it instead of guessing: half a turn of bank, laid over the
  // manoeuvre, from whatever bank the aeroplane was already settled at.
  //
  // EASED, NOT LINEAR. `turnProgress` is linear in ticks but flight.js sweeps
  // the heading through a smoothstep, so a roll driven off the raw progress
  // leads the aeroplane at the ends of the turn and lags it in the middle —
  // visibly, since the whole point of the animation is that the bank and the
  // heading are the same manoeuvre. The same smoothstep is applied here. The
  // alternative — deriving progress from `angle` itself, which is in sync by
  // construction — was rejected because the sweep ends at exactly +/-PI, where
  // angle wrapping makes the last tick of a westward turn indistinguishable
  // from the first of an eastward one. `rollTracksTheNose` in the browser
  // tests is what keeps this honest if flight.js ever changes its easing.
  reversalTarget(turn) {
    if (turn.turning) {
      // Latch the bank the manoeuvre starts from, so a turn entered already
      // banked (the lead below, or an unsettled previous turn) rolls a clean
      // half turn from there rather than snapping to level first.
      if (!this.wasTurning) this.rollBase = this.rollTarget;
      this.rollDir = turn.turnDir;
      const u = clamp(turn.turnProgress, 0, 1);
      const eased = u * u * (3 - 2 * u);
      this.rollTarget = this.rollBase + Math.PI * eased * turn.turnDir;
    } else if (this.wasTurning) {
      // The manoeuvre clears itself on the tick it completes, so the last
      // progress the scene ever sees is one tick short of 1. Land the half
      // turn exactly rather than a fraction of a degree short of it, or every
      // reversal leaves a slowly accumulating error in which way up it is.
      this.rollTarget = this.rollBase + Math.PI * this.rollDir;
      this.rollBase = this.rollTarget;
    }
    this.wasTurning = turn.turning;
  }

  // One tick of the roll. Called once per elapsed SIMULATION tick — never once
  // per rendered frame and never against a clock — so the attitude at sim tick
  // N is the same attitude however many frames the browser managed to draw.
  // `turn` is the manoeuvre as the simulation published it in state().
  stepRoll(p, turn = NOT_TURNING) {
    const a = p.angle;
    // On the deck the aeroplane is upright, facing right, by definition. This
    // is also what puts a respawn back the right way up without a special case.
    if (p.mode === MODE.DECK || p.mode === MODE.ROLL) {
      this.roll = 0;
      this.rollVel = 0;
      this.rollTarget = 0;
      this.rollBase = 0;
      this.wasTurning = false;
      this.prevAngle = a;
      return;
    }
    const d = normalizeAngle(a - this.prevAngle);
    // A big jump in heading is a respawn or a teleport — UNLESS the simulation
    // says a stall turn is in progress, in which case it is simply the
    // manoeuvre, seen across dropped frames. Snapping there would abandon the
    // half turn half way through it and then complete it again on the falling
    // edge, so a stuttering frame rate would leave the aeroplane inverted.
    if (!turn.turning && Math.abs(d) > ROLL.TELEPORT) {
      this.rollTarget = Math.cos(a) < 0 ? Math.PI : 0;
      this.roll = this.rollTarget;
      this.rollBase = this.rollTarget;
      this.rollVel = 0;
      this.wasTurning = !!turn.turning;
      this.prevAngle = a;
      // The jump is not a pitch rate, so it must not lead the bank either.
      return;
    }
    this.reversalTarget(turn);
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
      if (e.type === 'planeLost') {
        const x = e.x + PLANE_W / 2;
        const y = e.y + PLANE_H / 2;
        this.fx.push(e.reason === 'sea'
          ? { kind: 'splash', x, y: SEA_Y, t: 0, life: 42 }
          : { kind: 'fire', x, y, t: 0, life: 46 });
        continue;
      }
      if (e.type === 'detonation') this.fx.push(detonationFx(e));
    }
    this.consumed = sim.events.length;
    // Catch up the roll one simulation tick at a time. A dropped frame costs
    // the intermediate headings, not the tick count, so a long stall settles to
    // the same attitude instead of leaving the aeroplane banked.
    const turn = sim.turnState();
    const steps = Math.min(Math.max(sim.tick - this.tick, 0), ROLL.MAX_STEPS);
    for (let i = 0; i < steps; i++) this.stepRoll(sim.plane, turn);
    // The zoom carries no state, so it is read straight off the aeroplane
    // rather than caught up a tick at a time: at simulation tick N it is
    // whatever the altitude at tick N says, dropped frames or not.
    this.zoom = zoomFor(sim.plane.y);
    this.tick = sim.tick;
    for (const f of this.fx) f.t++;
    this.fx = this.fx.filter((f) => f.t < f.life);
    return this;
  }

  // The world viewport, in world pixels, once the current zoom has been
  // applied. The drawing functions take these instead of VIEW_W/VIEW_H and are
  // otherwise unaware that any zoom happened.
  frame(sim) {
    const scale = this.zoom;
    const vw = VIEW_W / scale;
    const vh = VIEW_H / scale;
    // Horizontally: the simulation's own camera rule — centre the aeroplane,
    // clamped to the world box — but recomputed here CONTINUOUSLY and for the
    // frame's real width.
    //
    // `sim.cam.x` is floored to a whole world pixel, which was right when the
    // world was drawn at one fixed scale and is wrong now. Floored, the camera
    // holds still for several ticks and then steps a whole world pixel, and
    // that step lands on a FRACTION of a device pixel once a zoom is in the way
    // (a third of one at the ceiling) — so every edge on screen re-antialiases
    // in a lump, every few frames, forever. It is small, it is everywhere, and
    // it is the shimmer left over once the clouds stop boiling. Sub-pixel
    // motion is not a problem for this renderer — it is a supersampled vector
    // pipeline, not a pixel-art one — but QUANTISED sub-pixel motion is.
    //
    // The width matters too: cameraFor clamps against a 512-wide view, and the
    // view is 512/scale wide, so at the zoomed-out end the old clamp let the
    // frame run past the edge of the world box it was meant to hold.
    const centreX = sim.plane.x + PLANE_W / 2;
    const minX = sim.bounds.minX;
    const maxX = Math.max(minX + vw, sim.bounds.maxX);
    const x = clamp(centreX - vw / 2, minX, maxX - vw);

    // Pin the sea line to its row. At and below the dead band the scale is
    // clamped, so this is the same fixed horizon the framing always had; above
    // it the scale is exactly the one that also puts the aeroplane on its row,
    // so pinning one pins both.
    let y = SEA_Y - SEA_ROW / scale;
    // Once the scale has bottomed out the two can no longer both be honoured —
    // the aeroplane keeps climbing and the sea cannot come up to meet it — so
    // the aeroplane wins a minimum margin from the top edge and the sea slides
    // the last few pixels down toward the panel. ZOOM.MIN is chosen so that it
    // never slides off it.
    y = Math.min(y, sim.plane.y + PLANE_H / 2 - ZOOM.TOP_MIN / scale);
    return { vw, vh, scale, cam: { x, y } };
  }

  submit(r, sim) {
    const f = this.frame(sim);
    const cam = f.cam;
    // Every world layer draws through the same zoom; the panel does not — the
    // instrument panel is a fixed size at the bottom of the screen at every
    // altitude, as it is in the reference.
    const world = (fn) => (ctx) => {
      ctx.save();
      ctx.scale(f.scale, f.scale);
      fn(ctx);
      ctx.restore();
    };

    r.draw(LAYER.SKY, world((ctx) => drawSky(ctx, f.vw, f.vh, cam.y, CEILING_Y, SEA_Y)));
    r.draw(LAYER.PARALLAX_FAR, world((ctx) => drawClouds(ctx, f.vw, f.vh, cam, this.tick)));
    r.draw(LAYER.BG_TILES, world((ctx) => this.drawShip(ctx, cam, f)));
    r.draw(LAYER.TILES, world((ctx) => this.drawIslands(ctx, sim, cam, f)));
    r.draw(LAYER.ENTITIES, world((ctx) => this.drawShots(ctx, sim, cam, f)));
    // After the entities and before the aeroplane, so a contact on the ground
    // reads as being beneath the aircraft rather than pasted over it.
    r.draw(LAYER.ENTITIES, world((ctx) => this.drawContact(ctx, cam, f)));
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

  drawIslands(ctx, sim, cam, f) {
    for (const isle of sim.islands) drawLandmass(ctx, isle, cam, f.vw, f.vh, this.tick, SEA_Y);
  }

  // Ordnance in the air, each round pointed along its own velocity — which is
  // what makes a bomb visibly tip over onto its nose as it falls, and is the
  // pilot's only cue about where it is actually going.
  // The other player, drawn only when he is actually in the viewport. The
  // pilot does not automatically know where Mario is (spec 3): the long-range
  // picture is radar's job. Off-camera he is simply not drawn — no arrow, no
  // ghost at the screen edge.
  //
  // `f.vw`/`f.vh` are the ZOOMED viewport, which is the space every other draw
  // call here culls against; VIEW_W/VIEW_H are the unzoomed constants and would
  // clip the contact early at altitude, exactly when the pilot is looking for
  // it hardest.
  drawContact(ctx, cam, f) {
    const m = this.remoteMario;
    if (!m) return;
    const sx = Math.floor(m.x - cam.x);
    const sy = Math.floor(m.y - cam.y);
    if (sx < -MARIO_CONTACT.w || sy < -MARIO_CONTACT.h) return;
    if (sx > f.vw || sy > f.vh) return;
    MARIO_CONTACT.draw(ctx, sx, sy, m.facing < 0, false);
  }

  drawShots(ctx, sim, cam, f) {
    for (const s of sim.shots) {
      // The drawn position IS the simulated position, moved into view space
      // and nothing else. Nothing here recomputes where a bomb "should" be:
      // that is the difference between aiming being honest at every zoom and
      // aiming being a second physics model that disagrees with the first.
      const x = s.x - cam.x;
      const y = s.y - cam.y;
      if (x < -24 || x > f.vw + 24) continue;
      const a = Math.atan2(s.vy, s.vx);
      if (s.kind === 'gun') drawTracer(ctx, x, y, a);
      else if (s.kind === 'rocket') drawRocket(ctx, x, y, a, this.tick);
      // The bomb art stands on its tail at angle 0, so it is rotated a quarter
      // turn on top of the heading to point where it is going.
      else drawBomb(ctx, x, y, a + Math.PI / 2);
    }
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
        drawFireball(ctx, x, f.y - cam.y, t, f.size == null ? 22 : f.size);
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
      // The radar plots islands as {x, x1} spans; Island calls its left edge
      // x0, so the shape it wants is made here rather than teaching the
      // instrument about a class it should not know.
      islands: sim.islands.map((i) => ({ x: i.x0, x1: i.x1 })),
      // The hunt: a fuzzy fix, or null for a dark tube. The instrument decides
      // how to draw uncertainty; the sim only supplies it.
      contact: sim.radarContact(),
      fuel: clamp(p.fuel / FLIGHT.FUEL_MAX, 0, 1),
      verdict: v && v.inBox ? String(v.reason).toUpperCase() : '',
    }, this.tick);
  }
}

export { HUD_H, ISLAND_W, ISLAND_H, DECK_THICK };
export default Scene;
