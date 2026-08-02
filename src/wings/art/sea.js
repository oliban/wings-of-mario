import { SEA } from './palette.js';

// The sea. In the user's reference it is a thin dark band under the hull — about
// 6% of the play area, running from luma 104 at the foam down to 47 in the deep,
// against a sky at 143. So it is the DARK half of the frame now, not the middle
// value, and it stays thin: the render clamps it to a strip in scene.js.
//
// The old version's waterline was a repeating square-wave glyph that read as a
// mechanical zigzag border. This one is three superimposed sine trains at
// different periods, amplitudes and speeds, so the surface never repeats over
// any distance the player can see and the crest pattern beats against itself.
// All of it is a pure function of world x and the simulation tick, so a
// screenshot at tick N is reproducible.

// Wave trains: [wavelength, amplitude, speed]. Coprime-ish wavelengths so the
// combined profile has a period of several thousand pixels.
const TRAINS = [
  [97, 2.1, 0.30],
  [53, 1.3, 0.55],
  [23, 0.7, 0.95],
];

// A second, slower, shallower swell drawn a few pixels higher up — which is
// where more distant water sits on screen. Two layers running at different
// speeds is what gives the sea depth; one layer, however well drawn, is a
// ribbon. Deliberately not a multiple of the near periods, so the two beat.
const FAR_TRAINS = [
  [149, 1.4, 0.14],
  [71, 0.8, 0.26],
];

export function farSurfaceAt(x, tick) {
  let h = 0;
  for (const [len, amp, spd] of FAR_TRAINS) {
    h += amp * Math.sin(((x - tick * spd) / len) * Math.PI * 2);
  }
  return h;
}

// Surface height at world x, in pixels above mean sea level.
export function surfaceAt(x, tick) {
  let h = 0;
  for (const [len, amp, spd] of TRAINS) {
    h += amp * Math.sin(((x - tick * spd) / len) * Math.PI * 2);
  }
  return h;
}

// Slope, used to decide which faces are lit and where crests break.
function slopeAt(x, tick) {
  let d = 0;
  for (const [len, amp, spd] of TRAINS) {
    d += ((amp * Math.PI * 2) / len) * Math.cos(((x - tick * spd) / len) * Math.PI * 2);
  }
  return d;
}

let bodyGrad = null;
let bodyKey = '';

// The water below the surface: a bright saturated band at the top falling away
// fast into near-black. The fast fall is what keeps the *bright* part of the sea
// to about a tenth of the play area even when the camera is low.
function seaGradient(ctx, top, bottom) {
  const key = `${top}|${bottom}`;
  if (key === bodyKey) return bodyGrad;
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, SEA.surface);
  g.addColorStop(0.16, SEA.shallow);
  g.addColorStop(0.38, SEA.mid);
  g.addColorStop(0.68, SEA.deep);
  g.addColorStop(1, SEA.abyss);
  bodyGrad = g;
  bodyKey = key;
  return g;
}

// Trace the surface across the viewport, one sample every two pixels. Two is
// enough at this amplitude and halves the path cost.
function surfacePath(ctx, cam, viewW, top, tick, close, bottom) {
  ctx.beginPath();
  ctx.moveTo(-2, top + surfaceAt(cam.x - 2, tick));
  for (let sx = 0; sx <= viewW + 2; sx += 2) {
    ctx.lineTo(sx, top + surfaceAt(cam.x + sx, tick));
  }
  if (close) {
    ctx.lineTo(viewW + 2, bottom);
    ctx.lineTo(-2, bottom);
    ctx.closePath();
  }
}

export function drawSea(ctx, viewW, viewH, cam, seaY, tick) {
  const top = seaY - cam.y;
  if (top > viewH) return;

  // The far swell first: duller, flatter, and sitting a few pixels higher,
  // because water further away is higher on screen. Everything the near surface
  // then covers reads as distance.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-2, top - 4 + farSurfaceAt(cam.x - 2, tick));
  for (let sx = 0; sx <= viewW + 2; sx += 3) {
    ctx.lineTo(sx, top - 4 + farSurfaceAt(cam.x + sx, tick));
  }
  ctx.lineTo(viewW + 2, top + 12);
  ctx.lineTo(-2, top + 12);
  ctx.closePath();
  const far = ctx.createLinearGradient(0, top - 6, 0, top + 5);
  far.addColorStop(0, '#3f86c4');
  far.addColorStop(1, SEA.shallow);
  ctx.fillStyle = far;
  ctx.fill();
  // A pale line right on the far horizon, which is the cue that says "distance".
  ctx.strokeStyle = 'rgba(168,203,232,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-2, top - 4 + farSurfaceAt(cam.x - 2, tick));
  for (let sx = 0; sx <= viewW + 2; sx += 3) {
    ctx.lineTo(sx, top - 4 + farSurfaceAt(cam.x + sx, tick));
  }
  ctx.stroke();
  ctx.restore();

  // The body of the near water, clipped to the live surface so the horizon is a
  // moving line rather than a ruled edge.
  ctx.save();
  surfacePath(ctx, cam, viewW, top, tick, true, viewH + 2);
  ctx.fillStyle = seaGradient(ctx, top, top + 70);
  ctx.fill();

  // A brighter sheet just under the surface, so the top of the water catches the
  // light the way a real sea does.
  ctx.clip();
  ctx.globalAlpha = 0.55;
  const sheen = ctx.createLinearGradient(0, top - 2, 0, top + 9);
  sheen.addColorStop(0, SEA.crest);
  sheen.addColorStop(1, 'rgba(91,159,214,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, top - 4, viewW, 14);
  ctx.restore();

  // Sunlit faces: every stretch of surface whose slope is rising to the left
  // catches the sun and gets a bright edge. This is what gives the swell form
  // rather than being a wobbly line.
  ctx.save();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = SEA.crest;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  let drawing = false;
  for (let sx = -2; sx <= viewW + 2; sx += 2) {
    const wx = cam.x + sx;
    const lit = slopeAt(wx, tick) > 0.05;
    const y = top + surfaceAt(wx, tick);
    if (lit && !drawing) {
      ctx.moveTo(sx, y);
      drawing = true;
    } else if (lit) {
      ctx.lineTo(sx, y);
    } else {
      drawing = false;
    }
  }
  ctx.stroke();
  ctx.restore();

  // Breaking crests. A crest breaks where the surface is near its maximum and
  // the slope is turning over; the test is on world x and tick alone, so the
  // same crest breaks at the same place on every run.
  ctx.save();
  ctx.fillStyle = SEA.foam;
  for (let sx = -8; sx <= viewW + 8; sx += 3) {
    const wx = cam.x + sx;
    const h = surfaceAt(wx, tick);
    if (h < 3.0) continue;
    const d = slopeAt(wx, tick);
    if (d > -0.02 || d < -0.42) continue;
    const y = top + h;
    const w = 1.6 + (h - 3.0) * 2.2;
    ctx.globalAlpha = Math.min(0.95, (h - 3.0) * 1.5);
    ctx.beginPath();
    ctx.ellipse(sx, y - 0.5, w, 1.0, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha *= 0.45;
    ctx.fillStyle = SEA.foamShade;
    ctx.fillRect(sx - w, y + 0.4, w * 2, 0.7);
    ctx.fillStyle = SEA.foam;
  }
  ctx.restore();
}

// The churn a hull drags behind it: a band of foam that scrolls aft and fades
// out with distance from the stern.
export function drawWake(ctx, cam, sternX, seaY, tick, len = 150) {
  const top = seaY - cam.y;
  ctx.save();
  for (let i = 0; i < 46; i++) {
    const t = i / 45;
    const wx = sternX - t * len - ((tick * 0.9) % 8);
    const sx = wx - cam.x;
    const y = top + surfaceAt(wx, tick);
    const fade = (1 - t) ** 1.5;
    ctx.globalAlpha = 0.7 * fade;
    ctx.fillStyle = SEA.foam;
    const w = 2.2 + fade * 3.4;
    ctx.beginPath();
    ctx.ellipse(sx, y - 0.4, w, 1.1 + fade, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35 * fade;
    ctx.fillStyle = SEA.foamShade;
    ctx.fillRect(sx - w, y + 1, w * 2, 1.4 + fade * 1.6);
  }
  ctx.restore();
}

// The wave a hull pushes ahead of itself.
export function drawBowWave(ctx, cam, bowX, seaY, tick) {
  const top = seaY - cam.y + surfaceAt(bowX, tick);
  const sx = bowX - cam.x;
  const pulse = 0.75 + 0.25 * Math.sin(tick * 0.11);
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = SEA.foam;
  ctx.beginPath();
  ctx.moveTo(sx - 16, top + 2);
  ctx.quadraticCurveTo(sx - 4, top - 4.5 * pulse, sx + 9, top + 1.5);
  ctx.quadraticCurveTo(sx - 2, top + 3.5, sx - 16, top + 2);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = SEA.foamShade;
  ctx.fillRect(sx - 18, top + 2.4, 30, 1.6);
  ctx.restore();
}

// Spray thrown by something hitting the water. `t` runs 0..1 over the effect.
export function drawSplash(ctx, x, y, t) {
  if (t >= 1) return;
  ctx.save();

  // The column: a short, wide burst of water thrown straight up at the point of
  // impact, collapsing back within the first third of the effect.
  const col = Math.max(0, 1 - t * 2.6);
  if (col > 0) {
    const g = ctx.createLinearGradient(0, y - 26 * col, 0, y + 2);
    g.addColorStop(0, 'rgba(234,255,255,0)');
    g.addColorStop(0.35, SEA.foam);
    g.addColorStop(1, SEA.foamShade);
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.95 * col;
    ctx.beginPath();
    ctx.moveTo(x - 10 * col - 2, y + 2);
    ctx.quadraticCurveTo(x - 4 * col, y - 24 * col, x, y - 27 * col);
    ctx.quadraticCurveTo(x + 4 * col, y - 24 * col, x + 10 * col + 2, y + 2);
    ctx.closePath();
    ctx.fill();
  }

  // Droplets thrown out of it on a fixed fan, so the same crash throws the same
  // spray every time.
  ctx.fillStyle = SEA.foam;
  for (let i = 0; i < 30; i++) {
    const k = (i * 2654435761) >>> 0;
    const a = -Math.PI / 2 + ((i / 29) - 0.5) * 2.5 + ((k % 20) - 10) / 90;
    const speed = 30 + (k >>> 5) % 44;
    const px = x + Math.cos(a) * speed * t;
    const py = y + Math.sin(a) * speed * t + 78 * t * t;
    if (py > y + 1) continue;
    const r = (2.4 - 1.5 * t) * (0.55 + ((k >>> 11) % 9) / 10);
    ctx.globalAlpha = 0.95 * (1 - t);
    ctx.beginPath();
    ctx.arc(px, py, Math.max(0.4, r), 0, Math.PI * 2);
    ctx.fill();
  }

  // The ring washing out from the impact.
  ctx.globalAlpha = 0.7 * (1 - t) ** 1.4;
  ctx.strokeStyle = SEA.foam;
  ctx.lineWidth = 2.2 * (1 - t) + 0.5;
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 5 + 46 * t, 1.2 + 7 * t, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.35 * (1 - t);
  ctx.fillStyle = SEA.foamShade;
  ctx.beginPath();
  ctx.ellipse(x, y + 1, 5 + 34 * t, 1 + 5 * t, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
