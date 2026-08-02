import { PLANE } from './palette.js';

// The aircraft. Drawn as live Canvas2D paths and rotated by the real flight
// angle, so there is no per-angle sheet and no resampling at any attitude.
//
// What makes this read as a WWII carrier fighter rather than as a trainer is not
// detail — it is four structural decisions, in this order of importance:
//
//   MASS FORWARD, TAPER HARD AFT. A Hellcat in profile is brutally front-heavy:
//   a barrel of radial engine, a deep fuselage behind it, and then a hard taper
//   to a slim tail boom. Here the cowl is 12.6 units deep and the tail is 3.6 —
//   a 3.5:1 taper. An even-diameter tube, which is what this used to be, reads
//   as a light aircraft no matter what is painted on it.
//
//   THE FIN IS THE TALLEST POINT, at 94% of the length aft. It only *reads* as
//   the tallest once the fuselage under it has tapered away; the previous
//   version had the fin geometrically highest and it still did not show, because
//   the tail boom was as deep as the nose.
//
//   THE COWLING IS A CYLINDER. Blunt, flat-fronted, no taper, deeper than the
//   fuselage behind it, shaded across its height so it turns like a barrel, and
//   finished with a hard bright lip at the front rim.
//
//   PANELLED METAL, NOT AIRBRUSH. A hard demarcation between the sea blue upper
//   surface and the gull grey underside, a hard specular band along the spine,
//   crisp panel lines, and a hard shadow where the wing meets the fuselage. Soft
//   pastel gradients read as plastic.
//
// Colour follows the user's reference: a DARK blue-grey warplane against a bright
// blue sky, with white national markings. Every airframe tone sits below the
// sky's luma of 143, so the aeroplane reads as the darkest, most saturated thing
// in frame — the exact inverse of the light-on-black arrangement a night sky
// calls for. The bright underside rim light that scheme needed is gone with it:
// against a bright sky a dark shape needs a DARK contact edge and hard white
// markings, not a highlight. The silhouette work is untouched.

// Length in world pixels. The number that matters is the aeroplane against the
// SHIP, not against the window: in the reference the aircraft is about an eighth
// of the flight deck and the deck fills the frame. Ours is 42 against a 320px
// deck — 13%, against their 11% — and the render zoom in scene.js then makes the
// ship large enough for that ratio to be what the player sees.
export const PLANE_LEN = 42;

// The body is authored in a 52-unit frame; PLANE_SCALE stretches the whole
// aeroplane — gear, hook, propeller, parked aircraft — from that one constant.
const LOCAL_LEN = 52;
export const PLANE_SCALE = PLANE_LEN / LOCAL_LEN;
export const PLANE_ASPECT = 2.64;
export const PLANE_HEIGHT = PLANE_LEN / PLANE_ASPECT;

// Local frame: origin at the centre of mass, +x toward the nose, +y down.
const NOSE = 29;
const TAIL = -23;

// Quoted so the proportions survive a change of scale. The tests measure these.
export const LANDMARKS = {
  localLen: LOCAL_LEN,
  nose: NOSE,
  tail: TAIL,
  finTopX: -20,
  finTopY: -13.2,
  canopyPeakX: -1,
  canopyPeakY: -10.4,
  spineY: -5.6,
  bellyY: 6.2,
  wingLowY: 7.2,
  cowlDepth: 12.6,
  tailDepth: 3.6,
};

// ---------------------------------------------------------------------------
// Outlines
// ---------------------------------------------------------------------------

// Deep at the firewall, slim at the tail. The taper is the whole point.
function fuselagePath(ctx) {
  ctx.beginPath();
  ctx.moveTo(20, -6.4);
  ctx.lineTo(13, -6.2);
  ctx.lineTo(6, -5.6);
  ctx.lineTo(-8, -4.6);
  ctx.lineTo(TAIL, -3.0);
  ctx.lineTo(TAIL, 0.6);
  ctx.lineTo(TAIL + 1, 1.8);
  ctx.lineTo(-8, 3.0);
  ctx.lineTo(13, 5.8);
  ctx.lineTo(20, 6.2);
  ctx.closePath();
}

// A blunt cylinder. No taper along its length, a flat rounded face, and it is
// deeper than the fuselage it is bolted to.
function cowlPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(13, -6.2);
  ctx.lineTo(27.4, -6.5);
  ctx.quadraticCurveTo(NOSE + 1.6, -6.2, NOSE + 1.8, -4.2);
  ctx.lineTo(NOSE + 1.8, 4.4);
  ctx.quadraticCurveTo(NOSE + 1.6, 6.2, 27.4, 6.4);
  ctx.lineTo(13, 5.8);
  ctx.closePath();
}

function finPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(-7, -4.5);
  ctx.quadraticCurveTo(-12, -9, -17.5, -13.2);
  ctx.lineTo(-22.4, -13.2);
  ctx.quadraticCurveTo(TAIL - 0.8, -13.0, TAIL - 0.8, -11.4);
  ctx.lineTo(TAIL - 0.4, -2.8);
  ctx.lineTo(-9, -4.5);
  ctx.closePath();
}

function tailplanePath(ctx) {
  ctx.beginPath();
  ctx.moveTo(-12, -0.2);
  ctx.lineTo(TAIL - 3.5, -1.7);
  ctx.lineTo(TAIL - 3.5, 0.1);
  ctx.lineTo(-12, 1.7);
  ctx.closePath();
}

function wingPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(16.5, 2.6);
  ctx.lineTo(5, 7.2);
  ctx.lineTo(-13, 6.4);
  ctx.lineTo(-9, 1.8);
  ctx.lineTo(2, 0.8);
  ctx.closePath();
}

function canopyPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(7.5, -5.7);
  ctx.quadraticCurveTo(4.5, -10.2, -1, -10.4);
  ctx.quadraticCurveTo(-6, -10.4, -8.5, -4.6);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Shading
// ---------------------------------------------------------------------------

// Built once against the local frame. The demarcation stops sit four hundredths
// apart on purpose: that near-step is the camouflage line, and softening it is
// what made the old version look like a toy.
let grads = null;
function gradients(ctx) {
  if (grads) return grads;

  const body = ctx.createLinearGradient(0, -6.4, 0, 6.2);
  body.addColorStop(0, PLANE.dark);
  body.addColorStop(0.3, PLANE.shade);
  body.addColorStop(0.46, PLANE.mid);
  body.addColorStop(0.5, PLANE.skin);
  body.addColorStop(0.56, PLANE.light);
  body.addColorStop(1, PLANE.light);

  // A cylinder turns: dark at the top, a hard bright band across the middle,
  // dark again underneath. This one gradient is most of what says "radial".
  const cowl = ctx.createLinearGradient(0, -6.5, 0, 6.4);
  cowl.addColorStop(0, '#16253a');
  cowl.addColorStop(0.24, PLANE.shade);
  cowl.addColorStop(0.42, PLANE.mid);
  cowl.addColorStop(0.5, PLANE.skin);
  cowl.addColorStop(0.6, PLANE.light);
  cowl.addColorStop(0.78, PLANE.mid);
  cowl.addColorStop(1, PLANE.dark);

  const wing = ctx.createLinearGradient(0, 0.8, 0, 7.2);
  wing.addColorStop(0, '#16283c');
  wing.addColorStop(0.42, PLANE.shade);
  wing.addColorStop(0.62, PLANE.mid);
  wing.addColorStop(0.78, PLANE.skin);
  wing.addColorStop(1, PLANE.light);

  const fin = ctx.createLinearGradient(0, -13.2, 0, -3);
  fin.addColorStop(0, PLANE.shade);
  fin.addColorStop(0.6, PLANE.dark);
  fin.addColorStop(1, PLANE.shade);

  const glass = ctx.createLinearGradient(0, -10.4, 0, -4.6);
  glass.addColorStop(0, PLANE.spec);
  glass.addColorStop(0.28, PLANE.canopy);
  glass.addColorStop(0.62, PLANE.canopyDark);
  glass.addColorStop(1, PLANE.canopyFrame);

  grads = { body, cowl, wing, fin, glass };
  return grads;
}

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

function drawProp(ctx, tick, throttle) {
  const cx = NOSE + 2.6;
  if (throttle <= 0) {
    ctx.strokeStyle = PLANE.skin;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(cx, -13);
    ctx.lineTo(cx, 13);
    ctx.stroke();
    return;
  }
  ctx.save();
  ctx.translate(cx, 0);
  ctx.scale(0.2, 1);
  const disc = ctx.createRadialGradient(0, 0, 1, 0, 0, 13.5);
  disc.addColorStop(0, 'rgba(226,238,252,0.5)');
  disc.addColorStop(0.55, 'rgba(210,228,248,0.28)');
  disc.addColorStop(1, 'rgba(190,214,240,0)');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(0, 0, 13.5, 0, Math.PI * 2);
  ctx.fill();
  // The bright half of the blade arc walks round the disc, four turns a second.
  const a0 = ((tick % 15) / 15) * Math.PI * 2;
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = PLANE.spec;
  for (const off of [0, Math.PI]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 13.5, a0 + off, a0 + off + 0.9);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawGear(ctx) {
  ctx.strokeStyle = PLANE.dark;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(11.5, 5.4);
  ctx.lineTo(9.6, 10.4);
  ctx.moveTo(5, 6);
  ctx.lineTo(8, 10.4);
  ctx.stroke();
  ctx.fillStyle = PLANE.contact;
  ctx.beginPath();
  ctx.ellipse(9, 11.2, 2.8, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PLANE.skin;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.ellipse(9, 11.2, 1.2, 1.2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = PLANE.contact;
  ctx.beginPath();
  ctx.ellipse(TAIL + 2.5, 3.4, 1.7, 1.7, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawHook(ctx) {
  ctx.strokeStyle = PLANE.dark;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(TAIL + 3, 1.2);
  ctx.lineTo(TAIL - 6, 6.6);
  ctx.stroke();
  ctx.strokeStyle = PLANE.contact;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(TAIL - 6.6, 5.6, 1.8, 0.2, 2.6);
  ctx.stroke();
}

// The national star-and-bar. Nothing else says "1944 US Navy" this quickly, and
// at this scale it is three white shapes.
function drawInsignia(ctx, cx, cy, r) {
  ctx.fillStyle = PLANE.insignia;
  ctx.fillRect(cx - r * 2.6, cy - r * 0.52, r * 1.5, r * 1.05);
  ctx.fillRect(cx + r * 1.1, cy - r * 0.52, r * 1.5, r * 1.05);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------------------

// Draw the aircraft in the local frame. The caller has already translated to the
// centre of mass and rotated; nothing in here knows about the world.
export function drawPlaneBody(ctx, opts = {}) {
  const { tick = 0, throttle = 1, gear = false, hook = false } = opts;
  const g = gradients(ctx);

  drawProp(ctx, tick, throttle);
  if (gear) drawGear(ctx);
  if (hook) drawHook(ctx);

  // Tailplane, behind the fin and below the spine.
  tailplanePath(ctx);
  ctx.fillStyle = PLANE.shade;
  ctx.fill();
  ctx.strokeStyle = PLANE.skin;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-12, -0.2);
  ctx.lineTo(TAIL - 3.5, -1.7);
  ctx.stroke();

  // Fin. Ten units of it stand above a tail boom three and a half deep, which
  // is what makes the tail the tallest thing on the aeroplane.
  finPath(ctx);
  ctx.fillStyle = g.fin;
  ctx.fill();
  ctx.strokeStyle = PLANE.skin;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-7, -4.5);
  ctx.quadraticCurveTo(-12, -9, -17.5, -13.2);
  ctx.lineTo(-22.4, -13.2);
  ctx.stroke();
  // Rudder hinge line.
  ctx.strokeStyle = PLANE.contact;
  ctx.lineWidth = 0.7;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(-19.6, -13.1);
  ctx.lineTo(-20.6, -3.6);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Wing, passing behind the fuselage.
  wingPath(ctx);
  ctx.fillStyle = g.wing;
  ctx.fill();
  ctx.strokeStyle = PLANE.light;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(16.5, 2.6);
  ctx.lineTo(5, 7.2);
  ctx.stroke();
  // A white stripe across the wing.
  ctx.save();
  wingPath(ctx);
  ctx.clip();
  ctx.strokeStyle = PLANE.insignia;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-2.5, 0);
  ctx.lineTo(-4.5, 9);
  ctx.stroke();
  ctx.restore();

  // Fuselage.
  fuselagePath(ctx);
  ctx.fillStyle = g.body;
  ctx.fill();

  ctx.save();
  fuselagePath(ctx);
  ctx.clip();

  // The hard shadow the wing root casts on the fuselage side. This is what
  // separates wing from fuselage without an outline between them.
  ctx.fillStyle = PLANE.contact;
  ctx.globalAlpha = 0.72;
  ctx.beginPath();
  ctx.moveTo(16.5, 2.6);
  ctx.lineTo(2, 0.8);
  ctx.lineTo(-9, 1.8);
  ctx.lineTo(-9, 3.4);
  ctx.lineTo(2, 2.2);
  ctx.lineTo(16.5, 4.2);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Panel lines: crisp, dark, and following the section rather than ruled
  // straight, because the fuselage is a body of revolution.
  ctx.strokeStyle = PLANE.contact;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (const x of [8, -10, -17]) {
    ctx.moveTo(x, -5.4);
    ctx.lineTo(x - 0.6, 4.4);
  }
  ctx.stroke();
  // The demarcation between sea blue and gull grey, hard-edged.
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(20, 0.2);
  ctx.lineTo(-8, -0.5);
  ctx.lineTo(TAIL, -1.1);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // The specular band along the spine: a hard line, not an airbrushed bloom.
  ctx.strokeStyle = PLANE.mid;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(12, -5.7);
  ctx.lineTo(7, -5.3);
  ctx.moveTo(-9.5, -4.3);
  ctx.lineTo(TAIL + 3, -3.1);
  ctx.stroke();

  drawInsignia(ctx, -4.6, 0.2, 2.2);

  // A white band round the aft fuselage. On a dark aeroplane against a bright
  // sky these hard white marks are what carry at distance, where a soft
  // highlight would not.
  ctx.fillStyle = PLANE.insignia;
  ctx.fillRect(-11.6, -5.2, 2.1, 10);
  // And the one warm accent, a squadron band just aft of it.
  ctx.fillStyle = PLANE.flash;
  ctx.fillRect(-15.4, -4.9, 1.8, 9.4);
  ctx.fillStyle = PLANE.flashDark;
  ctx.fillRect(-15.4, 0, 1.8, 4.5);
  ctx.restore();

  // Cowling, over the fuselage: blunt, cylindrical, deeper than what it is
  // bolted to.
  cowlPath(ctx);
  ctx.fillStyle = g.cowl;
  ctx.fill();
  ctx.save();
  cowlPath(ctx);
  ctx.clip();
  ctx.strokeStyle = PLANE.contact;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(13.4, -7);
  ctx.lineTo(13.4, 7);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // Exhaust stubs along the bottom of the cowl.
  ctx.fillStyle = PLANE.contact;
  for (let i = 0; i < 4; i++) ctx.fillRect(15.5 + i * 2.6, 4.4, 1.4, 1.8);
  ctx.restore();

  // The cowl lip: a hard bright rim round the front of the cylinder, and the
  // dark intake shadow just inside it.
  ctx.strokeStyle = PLANE.light;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(27.2, -6.4);
  ctx.quadraticCurveTo(NOSE + 1.4, -6.1, NOSE + 1.6, -4.2);
  ctx.lineTo(NOSE + 1.6, 4.4);
  ctx.quadraticCurveTo(NOSE + 1.4, 6.1, 27.2, 6.3);
  ctx.stroke();
  ctx.strokeStyle = PLANE.contact;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(26.6, -4.9);
  ctx.lineTo(NOSE + 0.2, -3.8);
  ctx.lineTo(NOSE + 0.2, 4.0);
  ctx.lineTo(26.6, 4.9);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Spinner.
  ctx.fillStyle = PLANE.spec;
  ctx.beginPath();
  ctx.ellipse(NOSE + 1.8, -0.4, 1.7, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PLANE.mid;
  ctx.beginPath();
  ctx.ellipse(NOSE + 2.4, 0.8, 1, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Canopy: framed glazing, not a bubble. A hard frame, a horizon reflection
  // and a bright top edge.
  canopyPath(ctx);
  ctx.fillStyle = g.glass;
  ctx.fill();
  ctx.fillStyle = PLANE.pilot;
  ctx.beginPath();
  ctx.ellipse(-2.6, -7.2, 1.9, 1.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PLANE.canopyFrame;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(7.5, -5.7);
  ctx.quadraticCurveTo(4.5, -10.2, -1, -10.4);
  ctx.quadraticCurveTo(-6, -10.4, -8.5, -4.6);
  ctx.moveTo(2.4, -9.2);
  ctx.lineTo(2.4, -5.4);
  ctx.moveTo(-4.6, -10.3);
  ctx.lineTo(-4.6, -5.0);
  ctx.stroke();
  ctx.strokeStyle = PLANE.spec;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(3.6, -8.4);
  ctx.quadraticCurveTo(0, -10.1, -3.6, -9.7);
  ctx.stroke();

  // THE CONTACT EDGE. Last, over everything, unbroken from the cowl lip to the
  // tailwheel. On a black sky this stroke was a white rim light; on a bright sky
  // the same line does the same job in the opposite value.
  ctx.strokeStyle = PLANE.contact;
  ctx.lineWidth = 0.9;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // The path is the true bottom of the silhouette: cowl lip, belly, across to
  // the wing where its leading edge crosses the belly line, along the wing, and
  // up to the tailwheel. One polyline, no gaps.
  ctx.beginPath();
  ctx.moveTo(NOSE + 1.5, 4.6);
  ctx.lineTo(27.4, 6.4);
  ctx.lineTo(13, 5.9);
  ctx.lineTo(9.6, 5.4);
  ctx.lineTo(5, 7.3);
  ctx.lineTo(-13, 6.5);
  ctx.lineTo(TAIL + 1, 1.9);
  ctx.stroke();

  // A thin lit edge along the spine, so the upper surface has some form against
  // the sky instead of reading as a flat cut-out.
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = PLANE.skin;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(13, -6.3);
  ctx.lineTo(7.5, -5.7);
  ctx.moveTo(-9, -4.6);
  ctx.lineTo(TAIL + 1, -3.1);
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

// An aircraft parked on deck with its wings folded straight up into a V —
// the single most carrier-looking object there is.
export function drawParkedPlane(ctx, x, y, scale = PLANE_SCALE) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const g = ctx.createLinearGradient(0, -5, 0, 0.4);
  g.addColorStop(0, PLANE.dark);
  g.addColorStop(0.55, PLANE.shade);
  g.addColorStop(0.62, PLANE.skin);
  g.addColorStop(1, PLANE.light);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(10, -3.4);
  ctx.quadraticCurveTo(12.6, -1.8, 12.6, 0);
  ctx.lineTo(-9, 0.4);
  ctx.lineTo(-11, -4.8);
  ctx.lineTo(-8, -4.2);
  ctx.lineTo(-2, -4.8);
  ctx.quadraticCurveTo(5, -5.2, 10, -3.4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = PLANE.shade;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(3, -3.8);
  ctx.lineTo(-2.5, -12.5);
  ctx.moveTo(4.4, -3.8);
  ctx.lineTo(10, -12);
  ctx.stroke();
  ctx.strokeStyle = PLANE.skin;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(3.4, -4.4);
  ctx.lineTo(-2.1, -12.4);
  ctx.stroke();
  ctx.fillStyle = PLANE.canopy;
  ctx.beginPath();
  ctx.ellipse(-1, -4.8, 2.6, 1.7, 0, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = PLANE.contact;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(6, 2.8);
  ctx.moveTo(-6, 0.2);
  ctx.lineTo(-6, 2.4);
  ctx.stroke();
  ctx.strokeStyle = PLANE.spec;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12.2, 0);
  ctx.lineTo(-8.8, 0.4);
  ctx.stroke();
  ctx.restore();
}
