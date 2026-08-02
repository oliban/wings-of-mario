import { SKY, SKY_STYLE, CLOUD, STAR } from './palette.js';

// The sky. In the original it is literally #000000 across 84% of the play area,
// and that is the single most recognisable thing about the game — a bright
// aircraft hanging in a black void over a thin cyan sea.
//
// We keep the value and drop the flatness. The original's sky is one flat black
// partly because the machine had six colours and partly because a 1987 side-view
// game had no altitude to convey; ours has 560 world pixels of climb and the
// player needs to feel where they are in it. So the sky grades from effectively
// black at the ceiling to a dark saturated indigo at the horizon: at a glance it
// still reads black, and the value hierarchy — sky darkest, sea mid, aircraft
// brightest — is unchanged. Set SKY_STYLE to 'flat' in palette.js for the pure
// black; both were rendered and compared before choosing.

// Bands are quoted as fractions of the drop from the ceiling to sea level.
const STOPS = [
  [0.0, SKY.zenith],
  [0.35, SKY.high],
  [0.7, SKY.mid],
  [1.0, SKY.horizon],
];

let skyGrad = null;
let skyKey = '';

export function drawSky(ctx, viewW, viewH, camY, ceilingY, seaY) {
  if (SKY_STYLE === 'flat') {
    ctx.fillStyle = SKY.flat;
    ctx.fillRect(0, 0, viewW, viewH);
    return;
  }
  const top = ceilingY - camY;
  const bottom = seaY - camY;
  const key = `${top}|${bottom}|${viewW}`;
  if (key !== skyKey) {
    skyGrad = ctx.createLinearGradient(0, top, 0, bottom);
    for (const [at, col] of STOPS) skyGrad.addColorStop(at, col);
    skyKey = key;
  }
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, viewW, viewH);
}

// Stars at fixed world positions. They only show in the upper third, where the
// sky is genuinely black, and they are the cheapest possible altitude cue: if
// you can see them you are high. A literal table, so the sky is identical on
// every run and a screenshot at tick N is reproducible.
const STARS = [];
for (let i = 0; i < 90; i++) {
  // A fixed integer hash rather than Math.random: deterministic, and the same
  // on every machine.
  const h = (i * 2654435761) >>> 0;
  STARS.push({
    x: (h % 6000) - 400,
    y: ((h >>> 12) % 190),
    m: 0.25 + ((h >>> 24) % 40) / 100,
    b: 0.25 + ((h >>> 8) % 60) / 100,
  });
}

export function drawStars(ctx, viewW, viewH, cam, tick) {
  if (SKY_STYLE !== 'flat' && cam.y > 220) return;
  ctx.save();
  ctx.fillStyle = STAR;
  for (const s of STARS) {
    const x = s.x - cam.x * s.m * 0.12;
    const y = s.y - cam.y * s.m * 0.5;
    const sx = ((x % 6000) + 6000) % 6000;
    if (sx > viewW + 4 || y < -2 || y > viewH) continue;
    // A slow twinkle keyed off the tick, so nothing in the sky is ever static.
    const tw = 0.55 + 0.45 * Math.sin((tick + s.x) * 0.03);
    ctx.globalAlpha = s.b * tw * 0.8;
    ctx.fillRect(sx, y, 1, 1);
  }
  ctx.restore();
}

// Cloud banks. Dim — a cloud brighter than the aeroplane would break the value
// hierarchy — and drawn as soft stacked lobes rather than outlined blobs.
const DECKS = [
  { x: 240, y: 96, m: 0.16, w: 170, h: 15 },
  { x: 760, y: 260, m: 0.34, w: 124, h: 11 },
  { x: 1180, y: 150, m: 0.22, w: 196, h: 17 },
  { x: 1620, y: 262, m: 0.5, w: 146, h: 12 },
  { x: 2080, y: 62, m: 0.13, w: 158, h: 14 },
  { x: 2520, y: 300, m: 0.42, w: 178, h: 15 },
  { x: 2980, y: 190, m: 0.26, w: 136, h: 11 },
  { x: 3440, y: 322, m: 0.55, w: 200, h: 17 },
  { x: 3900, y: 120, m: 0.18, w: 150, h: 12 },
  { x: 4380, y: 286, m: 0.46, w: 170, h: 15 },
  { x: 4860, y: 220, m: 0.3, w: 132, h: 11 },
  { x: 5340, y: 80, m: 0.15, w: 188, h: 16 },
];

// One bank. A cumulus has a defined, lumpy TOP and a flat BASE where it meets
// its condensation level — soft radial falloff in every direction is a smudge,
// which is what the first two attempts looked like. So the lobes are unioned
// into a single path with a rectangle across the base, filled with a vertical
// ramp, and only the top edge gets a crisp lighter stroke. The lobe layout is a
// fixed function of the bank's own x, so no two banks are alike and every bank
// is the same on every run.
function bankPath(ctx, x, y, w, h) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const k = ((x * 2654435761) >>> 0) + i * 0x9e3779b1;
    const t = i / 5;
    const lx = x + (t - 0.5) * (w - h) + (((k >>> 5) % 12) - 6);
    // Clamped: a hash that ever produced a negative radius would throw and take
    // the whole frame with it.
    const r = Math.max(1, h * (0.62 + ((k >>> 13) % 70) / 100));
    const ly = y - r * (0.45 + ((k >>> 19) % 45) / 100);
    ctx.moveTo(lx + r, ly);
    ctx.arc(lx, ly, r, 0, Math.PI * 2);
  }
  // The flat base, inset so it never sticks out past the lobes and reads as a
  // ruled bar.
  ctx.rect(x - w * 0.38, y - h * 0.42, w * 0.76, h * 0.42);
}

function drawBank(ctx, x, y, w, h) {
  // The base stop is fully transparent: a cumulus has a defined base, but a hard
  // opaque edge there reads as a bar of paint rather than as cloud.
  const g = ctx.createLinearGradient(0, y - h * 1.9, 0, y + 1);
  g.addColorStop(0, CLOUD.crown);
  g.addColorStop(0.3, CLOUD.lit);
  g.addColorStop(0.6, CLOUD.core);
  g.addColorStop(0.76, CLOUD.base);
  g.addColorStop(1, 'rgba(11,18,41,0)');
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = g;
  bankPath(ctx, x, y, w, h);
  ctx.fill();

  // A crisp crown, clipped so it never appears along the flat base.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - w, y - h * 4, w * 2, h * 3.35);
  ctx.clip();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = CLOUD.crown;
  ctx.lineWidth = 0.8;
  bankPath(ctx, x, y, w, h);
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

export function drawClouds(ctx, viewW, viewH, cam, tick) {
  ctx.save();
  for (const d of DECKS) {
    const sx = d.x - tick * 0.05 * d.m - cam.x * d.m;
    const sy = d.y - cam.y * d.m * 0.75;
    if (sy - d.h * 2.4 > viewH || sy - d.h * 2.4 < -60) continue;
    if (sx + d.w / 2 < -20 || sx - d.w / 2 > viewW + 20) continue;
    drawBank(ctx, sx, sy, d.w, d.h);
  }
  ctx.restore();
}
