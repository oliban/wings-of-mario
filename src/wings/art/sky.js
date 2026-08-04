import { SKY, SKY_STYLE, CLOUD } from './palette.js';

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

// Fair-weather cumulus. White now that the aeroplane is the dark object: a
// bright cloud behind a dark aircraft helps it read rather than competing with
// it, which is the opposite of the constraint a night sky imposed.
const DECKS = [
  { x: 240, y: 74, m: 0.16, w: 96, h: 9 },
  { x: 1180, y: 128, m: 0.22, w: 112, h: 10 },
  { x: 2080, y: 56, m: 0.13, w: 90, h: 8 },
  { x: 2980, y: 160, m: 0.26, w: 104, h: 9 },
  { x: 3900, y: 96, m: 0.18, w: 88, h: 8 },
  { x: 4860, y: 182, m: 0.3, w: 108, h: 10 },
  { x: 5340, y: 62, m: 0.15, w: 96, h: 9 },
];

// One bank. A cumulus has a defined, lumpy TOP and a flat BASE where it meets
// its condensation level — soft radial falloff in every direction is a smudge,
// which is what the first two attempts looked like. So the lobes are unioned
// into a single path with a rectangle across the base, filled with a vertical
// ramp, and only the top edge gets a crisp lighter stroke.
//
// `seed` is the bank's IDENTITY — its own fixed position in the world — and it
// is what the lobe layout is hashed from, so no two banks are alike and every
// bank is the same on every run. It is a separate argument from `x` on purpose,
// and this is the whole bug this file had: the layout used to be hashed from
// the SCREEN x, which drifts every single tick with the parallax and the
// camera. A hash of a value that moves is a new hash every frame, so all six
// lobes jumped to new offsets and radii sixty times a second — the clouds
// boiled. The seed must never be anything that moves.
function bankPath(ctx, x, y, w, h, seed) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const k = ((seed * 2654435761) >>> 0) + i * 0x9e3779b1;
    const t = i / 5;
    const lx = x + (t - 0.5) * (w - h) + (((k >>> 5) % 12) - 6);
    const r = Math.max(1, h * (0.62 + ((k >>> 13) % 70) / 100));
    const ly = y - r * (0.45 + ((k >>> 19) % 45) / 100);
    ctx.moveTo(lx + r, ly);
    ctx.arc(lx, ly, r, 0, Math.PI * 2);
  }
  ctx.rect(x - w * 0.38, y - h * 0.42, w * 0.76, h * 0.42);
}

function drawBank(ctx, x, y, w, h, seed) {
  // A cumulus has a lumpy, DEFINED top and a flat base. Soft in every direction
  // is a smudge, which is what this was for three rounds. The lobes are unioned
  // into one path with a rectangle across the base, filled with a vertical ramp
  // that fades out at the bottom, and only the crown gets a crisp lighter edge.
  const g = ctx.createLinearGradient(0, y - h * 2.1, 0, y + 1);
  g.addColorStop(0, CLOUD.crown);
  g.addColorStop(0.3, CLOUD.lit);
  g.addColorStop(0.68, CLOUD.core);
  g.addColorStop(1, 'rgba(143,189,224,0)');
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = g;
  bankPath(ctx, x, y, w, h, seed);
  ctx.fill();

  // The crown, clipped so it never draws along the flat base.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - w, y - h * 5, w * 2, h * 4.3);
  ctx.clip();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = CLOUD.crown;
  ctx.lineWidth = 0.9;
  bankPath(ctx, x, y, w, h, seed);
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

// How far a bank's ink reaches beyond the (x, y, w, h) box it nominally
// occupies. A lobe is offset by up to (w - h)/2 + 6 from the centre and has a
// radius of up to 1.32h, and the crown stroke is clipped to 5h above the base.
// The cull has to use these rather than the nominal box: a bank culled while
// any part of it is still on screen pops, and a pop at the edge of the frame is
// indistinguishable from a flicker.
function reach(d) {
  const lobe = Math.max(1, d.h * 1.32);
  return { x: (d.w - d.h) / 2 + 6 + lobe + 2, up: d.h * 5 + 2, down: lobe + 2 };
}

// Which banks are inside the frame. Split out from the drawing so it can be
// tested directly: the cull is a performance optimisation and has to be
// invisible, which is only checkable if you can ask it what it decided.
//
// viewW/viewH are in WORLD pixels — the caller draws through the zoom
// transform, so these already grow as the world is drawn smaller, and the
// margins below are world pixels too. Nothing here is in device units, which
// is what would otherwise make the cull scale-dependent.
export function visibleBanks(viewW, viewH, cam, tick) {
  const out = [];
  for (let id = 0; id < DECKS.length; id++) {
    const d = DECKS[id];
    const sx = d.x - tick * 0.05 * d.m - cam.x * d.m;
    const sy = d.y - cam.y * d.m * 0.75;
    const r = reach(d);
    if (sy - r.up > viewH || sy + r.down < 0) continue;
    if (sx + r.x < 0 || sx - r.x > viewW) continue;
    // `id` is which bank this is and never changes; `seed` is what its shape
    // is hashed from and must not change either. They are separate so a test
    // can hold the first still and watch the second.
    out.push({ id, x: sx, y: sy, w: d.w, h: d.h, seed: d.x });
  }
  return out;
}

export function drawClouds(ctx, viewW, viewH, cam, tick) {
  ctx.save();
  for (const b of visibleBanks(viewW, viewH, cam, tick)) {
    drawBank(ctx, b.x, b.y, b.w, b.h, b.seed);
  }
  ctx.restore();
}
