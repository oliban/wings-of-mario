import { PLANE } from './palette.js';

// The aircraft. It is the subject of every frame, so it is drawn rather than
// stamped: live Canvas2D paths, rotated by the real flight angle, which means no
// resampling at any attitude and no per-angle sprite sheet to keep consistent.
//
// The silhouette is the whole job, and it is drawn to proportions measured off
// the 1987 original because those are aircraft draughtsmanship, not technique:
//
//   * 2.7 : 1 overall. Anything squarer reads as a bird.
//   * THE VERTICAL FIN IS THE TALLEST POINT OF THE SPRITE, at ~95% of the length
//     aft of the spinner. Mass belongs at the back. A shape whose highest point
//     is a hump a third of the way from the nose, tapering to a spike at the
//     tail, is a seagull — which is exactly what the previous version was.
//   * The canopy bubble sits at ~56% aft.
//   * AN UNBROKEN BRIGHT LINE RUNS THE FULL LENGTH OF THE UNDERSIDE, spinner to
//     tailwheel. In the original this was a one-pixel hardware trick; it is also
//     real rim-lighting craft, and it is what stops the aircraft merging into
//     whatever is behind it. Here it is a soft rim light, drawn last so nothing
//     can interrupt it.
//   * The wing is separated from the fuselage BY VALUE, not by an outline.
//   * Light airframe on a dark sky. Dark is reserved for shadow and contact
//     edges. The old version was a dark shape on a light sky, which is backwards
//     and is why it vanished into the water.

// Length in world pixels: 15% of the 512px viewport, matching the original's
// 43px on a 280px screen. That is the fraction the eye actually judges, and at
// this size the silhouette below has room to be a silhouette.
//
// It does mean the aeroplane is 24% of our 320px flight deck where the
// original's is 15% of its own — because the original's screen IS its carrier
// and ours is not. The clean resolution is to lengthen DECK_X0/DECK_X1 so the
// ship fills more of the window; that is a simulation change and lives in
// geo.js. Until then the screen fraction wins, because that is what a
// screenshot is compared on.
export const PLANE_LEN = 77;

// The body is drawn in a local frame 52 units nose-to-tail; changing PLANE_LEN
// scales the whole aeroplane, gear, hook, prop and all, from this one constant.
export const PLANE_SCALE = PLANE_LEN / 52;
export const PLANE_ASPECT = 2.7;
export const PLANE_HEIGHT = PLANE_LEN / PLANE_ASPECT;

// Local frame: origin at the centre of mass, +x toward the nose, +y down. The
// body is authored in a 52-unit frame and PLANE_SCALE stretches it to PLANE_LEN,
// so every landmark below stays a fixed fraction of the aeroplane.
const LOCAL_LEN = 52;
const NOSE = 29;
const TAIL = -23;

// Quoted as fractions aft of the spinner so the proportions survive a change of
// scale. The tests measure these.
export const LANDMARKS = {
  localLen: LOCAL_LEN,
  nose: NOSE,
  tail: TAIL,
  finTopX: -18.4,
  finTopY: -13.4,
  canopyPeakX: 0,
  canopyPeakY: -9.2,
  bellyY: 5.2,
  wingLowY: 6.9,
  spineY: -4.4,
};

// The outline of the fuselage, nose first, over the top, down the back and home
// along the belly. Quadratics rather than segments: the cowling of a radial
// engine is a barrel and the spine of a Hellcat is a curve.
function fuselagePath(ctx) {
  ctx.beginPath();
  ctx.moveTo(NOSE, -4.8);
  ctx.quadraticCurveTo(NOSE + 2, -3, NOSE + 2, 0);
  ctx.quadraticCurveTo(NOSE + 2, 3, NOSE, 4.9);
  ctx.lineTo(23, 5.2);
  ctx.lineTo(-9, 3.0);
  ctx.lineTo(TAIL + 1, 2.2);
  ctx.lineTo(TAIL, 1.0);
  ctx.lineTo(TAIL, -3.2);
  ctx.lineTo(-9, -4.2);
  ctx.lineTo(6, -4.4);
  ctx.quadraticCurveTo(14, -4.9, 17, -4.9);
  ctx.quadraticCurveTo(24, -5.1, NOSE, -4.8);
  ctx.closePath();
}

// The wing, seen almost edge-on and slightly foreshortened: a swept blade whose
// leading edge catches the light and whose underside falls into shadow. Its
// lower edge meets the belly line, which keeps the rim light one unbroken run.
function wingPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(17.5, 1.8);
  ctx.lineTo(8, 5.6);
  ctx.lineTo(-14.5, 6.9);
  ctx.lineTo(-11, 2.6);
  ctx.lineTo(2, 0.6);
  ctx.closePath();
}

function finPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(-10, -4.2);
  ctx.quadraticCurveTo(-13, -9.4, -15.4, -13.1);
  ctx.lineTo(-21.4, -13.4);
  ctx.quadraticCurveTo(TAIL - 0.6, -13.2, TAIL - 0.6, -11.4);
  ctx.lineTo(TAIL - 0.2, -2.8);
  ctx.lineTo(-12, -4.2);
  ctx.closePath();
}

function tailplanePath(ctx) {
  ctx.beginPath();
  ctx.moveTo(-13, 0.2);
  ctx.lineTo(TAIL - 2.6, -0.9);
  ctx.lineTo(TAIL - 2.6, 1.0);
  ctx.lineTo(-13, 2.0);
  ctx.closePath();
}

function canopyPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(8.5, -4.5);
  ctx.quadraticCurveTo(5.5, -9.0, 0, -9.2);
  ctx.quadraticCurveTo(-5.5, -9.2, -8.5, -4.3);
  ctx.closePath();
}

// Gradients are built against the local frame and cached: they are the same
// every frame, and rebuilding five of them sixty times a second is waste.
let grads = null;
function gradients(ctx) {
  if (grads) return grads;
  const body = ctx.createLinearGradient(0, -5, 0, 5.2);
  body.addColorStop(0, PLANE.light);
  body.addColorStop(0.34, PLANE.skin);
  body.addColorStop(0.72, PLANE.mid);
  body.addColorStop(1, PLANE.shade);

  const wing = ctx.createLinearGradient(0, 0.6, 0, 6.9);
  wing.addColorStop(0, PLANE.skin);
  wing.addColorStop(0.45, PLANE.mid);
  wing.addColorStop(1, PLANE.shade);

  const fin = ctx.createLinearGradient(-19, -13.2, -13, -4);
  fin.addColorStop(0, PLANE.light);
  fin.addColorStop(1, PLANE.mid);

  const cowl = ctx.createLinearGradient(20, -5.2, 31, 5.2);
  cowl.addColorStop(0, PLANE.light);
  cowl.addColorStop(0.4, PLANE.skin);
  cowl.addColorStop(1, PLANE.shade);

  const glass = ctx.createLinearGradient(0, -9.2, 0, -4.3);
  glass.addColorStop(0, PLANE.spec);
  glass.addColorStop(0.3, PLANE.canopy);
  glass.addColorStop(1, PLANE.canopyDark);

  grads = { body, wing, fin, cowl, glass };
  return grads;
}

// The propeller, as a translucent disc with a brighter blade arc sweeping round
// it. Driven off the simulation tick, never off wall-clock time.
function drawProp(ctx, tick, throttle) {
  const cx = NOSE + 1.8;
  if (throttle <= 0) {
    ctx.strokeStyle = PLANE.mid;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, -12.5);
    ctx.lineTo(cx, 12.5);
    ctx.stroke();
    return;
  }
  ctx.save();
  ctx.translate(cx, 0);
  ctx.scale(0.2, 1);
  const disc = ctx.createRadialGradient(0, 0, 1, 0, 0, 13);
  disc.addColorStop(0, 'rgba(226,238,252,0.55)');
  disc.addColorStop(0.55, 'rgba(210,228,248,0.30)');
  disc.addColorStop(1, 'rgba(190,214,240,0)');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.fill();
  // The bright half of the arc walks round the disc, four turns a second.
  const a0 = ((tick % 15) / 15) * Math.PI * 2;
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = PLANE.spec;
  for (const off of [0, Math.PI]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 13, a0 + off, a0 + off + 0.9);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawGear(ctx) {
  ctx.strokeStyle = PLANE.shade;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(12, 4.4);
  ctx.lineTo(10.2, 9.6);
  ctx.moveTo(5, 5.2);
  ctx.lineTo(8.4, 9.6);
  ctx.stroke();
  ctx.fillStyle = PLANE.dark;
  ctx.beginPath();
  ctx.ellipse(9.4, 10.4, 2.6, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PLANE.skin;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(9.4, 10.4, 1.2, 1.2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = PLANE.dark;
  ctx.beginPath();
  ctx.ellipse(TAIL + 2.5, 5.4, 1.6, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawHook(ctx) {
  ctx.strokeStyle = PLANE.dark;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(TAIL + 3, 2.4);
  ctx.lineTo(TAIL - 6, 7.4);
  ctx.stroke();
  ctx.strokeStyle = PLANE.contact;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.arc(TAIL - 6.6, 6.4, 1.7, 0.2, 2.6);
  ctx.stroke();
}

// Draw the aircraft in the local frame. The caller has already translated to the
// centre of mass and rotated; nothing in here knows about the world.
export function drawPlaneBody(ctx, opts = {}) {
  const { tick = 0, throttle = 1, gear = false, hook = false } = opts;
  const g = gradients(ctx);

  drawProp(ctx, tick, throttle);
  if (gear) drawGear(ctx);
  if (hook) drawHook(ctx);

  // Tailplane first: it sits behind the fin and below the spine.
  tailplanePath(ctx);
  ctx.fillStyle = PLANE.mid;
  ctx.fill();
  ctx.strokeStyle = PLANE.spec;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-13, 0.2);
  ctx.lineTo(TAIL - 2.6, -0.9);
  ctx.stroke();

  // Fin. The tallest thing on the aeroplane, and the reason the silhouette reads
  // as an aircraft rather than a fish.
  finPath(ctx);
  ctx.fillStyle = g.fin;
  ctx.fill();
  ctx.strokeStyle = PLANE.spec;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-10, -4.2);
  ctx.quadraticCurveTo(-13, -9.4, -15.4, -13.1);
  ctx.lineTo(-21.4, -13.4);
  ctx.stroke();

  // Wing. Separated from the fuselage by value only — a darker plane below a
  // lighter one, with a lit leading edge.
  wingPath(ctx);
  ctx.fillStyle = g.wing;
  ctx.fill();
  ctx.strokeStyle = PLANE.spec;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(17.5, 1.8);
  ctx.lineTo(8, 5.6);
  ctx.stroke();

  // Fuselage over the wing root, so the wing reads as passing behind it.
  fuselagePath(ctx);
  ctx.fillStyle = g.body;
  ctx.fill();

  ctx.save();
  fuselagePath(ctx);
  ctx.clip();

  // Cowling: a barrel of brighter metal, cut from the fuselage by a firewall
  // line rather than by an outline.
  ctx.beginPath();
  ctx.rect(17, -6, NOSE - 17 + 3, 12);
  ctx.fillStyle = g.cowl;
  ctx.fill();
  ctx.strokeStyle = PLANE.shade;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(17.2, -6);
  ctx.lineTo(17.2, 6);
  ctx.stroke();
  ctx.fillStyle = PLANE.dark;
  for (let i = 0; i < 3; i++) ctx.fillRect(18.6 + i * 2.4, 2.6, 1.2, 1.5);

  // Squadron flash: the one warm colour on the aeroplane, and what tells you
  // which way up it is at a glance when it is small.
  ctx.fillStyle = PLANE.flash;
  ctx.fillRect(-12.4, -5, 3.4, 9);
  ctx.fillStyle = PLANE.flashDark;
  ctx.fillRect(-12.4, 1.2, 3.4, 2.8);

  // The wing root's cast shadow on the fuselage side, which is what makes the
  // two read as separate surfaces without drawing a line between them.
  ctx.globalAlpha = 0.68;
  ctx.fillStyle = PLANE.contact;
  ctx.beginPath();
  ctx.moveTo(17.5, 1.8);
  ctx.lineTo(2, 0.6);
  ctx.lineTo(-11, 2.6);
  ctx.lineTo(-11, 4.2);
  ctx.lineTo(2, 2.1);
  ctx.lineTo(17.5, 3.0);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Spine specular: sun from above and ahead.
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = PLANE.spec;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-10.5, -4.1);
  ctx.lineTo(-8.2, -4.2);
  ctx.moveTo(9, -4.4);
  ctx.quadraticCurveTo(14, -4.8, 18, -4.7);
  ctx.stroke();
  ctx.restore();

  // Canopy and the pilot inside it.
  canopyPath(ctx);
  ctx.fillStyle = g.glass;
  ctx.fill();
  ctx.fillStyle = PLANE.pilot;
  ctx.beginPath();
  ctx.ellipse(-2.2, -6.4, 1.9, 1.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PLANE.canopyFrame;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(8.5, -4.5);
  ctx.quadraticCurveTo(5.5, -9.0, 0, -9.2);
  ctx.quadraticCurveTo(-5.5, -9.2, -8.5, -4.3);
  ctx.moveTo(2.6, -8.9);
  ctx.lineTo(2.6, -4.4);
  ctx.stroke();

  // Spinner boss: the brightest single point on the aeroplane, right at the hub,
  // which is what makes the nose read as blunt and forward-facing.
  ctx.fillStyle = PLANE.spec;
  ctx.beginPath();
  ctx.ellipse(NOSE + 1.4, -0.3, 1.5, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();

  // THE RIM LIGHT. Last, over everything, unbroken from the spinner to the
  // tailwheel. Nothing is allowed to interrupt this stroke.
  ctx.strokeStyle = PLANE.spec;
  ctx.lineWidth = 1.3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(NOSE + 1.8, 1.0);
  ctx.quadraticCurveTo(NOSE + 1.4, 4.8, 23, 5.3);
  ctx.lineTo(8, 5.7);
  ctx.lineTo(-14.5, 7.0);
  ctx.lineTo(TAIL + 0.6, 2.4);
  ctx.stroke();

  // A dark contact edge along the top, so a light airframe still has a
  // silhouette when it crosses a cloud.
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = PLANE.contact;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(17, -5.0);
  ctx.lineTo(8.6, -4.5);
  ctx.moveTo(-8.6, -4.3);
  ctx.lineTo(-10.5, -4.2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// World-space entry point. Handles the heading flip: the aeroplane is drawn
// right-facing and mirrored for the leftward half of a loop, which is the flip
// the original does as the nose passes through the vertical.
export function drawPlane(ctx, cx, cy, angle, opts = {}) {
  const flip = Math.cos(angle) < 0;
  ctx.save();
  ctx.translate(cx, cy);
  if (flip) {
    ctx.scale(-1, 1);
    ctx.rotate(Math.PI - angle);
  } else {
    ctx.rotate(angle);
  }
  if (PLANE_SCALE !== 1) ctx.scale(PLANE_SCALE, PLANE_SCALE);
  drawPlaneBody(ctx, opts);
  ctx.restore();
}

// A folded-wing aircraft parked on the deck, wings hinged straight up into a V.
// It is the single most carrier-looking object there is, and the original parks
// two of them at the bow.
export function drawParkedPlane(ctx, x, y, scale = PLANE_SCALE) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = PLANE.skin;
  ctx.beginPath();
  ctx.moveTo(11, -3);
  ctx.quadraticCurveTo(13, -1.6, 13, 0);
  ctx.lineTo(-9, 0.4);
  ctx.lineTo(-11, -4.6);
  ctx.lineTo(-8, -4);
  ctx.lineTo(-2, -4.6);
  ctx.quadraticCurveTo(6, -5, 11, -3);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = PLANE.light;
  ctx.lineWidth = 2.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(3, -3.6);
  ctx.lineTo(-2.5, -12.5);
  ctx.moveTo(4.4, -3.6);
  ctx.lineTo(10, -12);
  ctx.stroke();
  ctx.fillStyle = PLANE.canopy;
  ctx.beginPath();
  ctx.ellipse(-1, -4.6, 2.6, 1.7, 0, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = PLANE.dark;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(6, 2.6);
  ctx.moveTo(-6, 0.2);
  ctx.lineTo(-6, 2.2);
  ctx.stroke();
  ctx.strokeStyle = PLANE.spec;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12.6, 0);
  ctx.lineTo(-8.8, 0.4);
  ctx.stroke();
  ctx.restore();
}
