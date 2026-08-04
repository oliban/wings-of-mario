import { PANEL, SHIP, SEA, PLANE, LAND } from './palette.js';
import { profileFor } from '../radar-terrain.js';

// The instrument panel. In the original this is not a status line — it is a
// boxed panel across the BOTTOM of the screen in a bright green bezel with
// corner ornaments, holding round analog dials, ordnance counters with a little
// plane icon, a black attitude/radar window and a score box. It is a large
// fraction of what makes a still of that game recognisable at a glance, and
// after the aircraft itself the round gauges are the strongest single signal
// that you are looking at a flight game rather than a platformer.
//
// The chunky 5x7 character ROM with its forced letter spacing is a hardware
// artefact and is not reproduced; a clean condensed face reads better and costs
// nothing. Everything else about the layout is kept.

export const HUD_H = 44;

const FONT_LABEL = '600 7px ui-monospace, "SF Mono", Menlo, monospace';
const FONT_READ = '600 11px ui-monospace, "SF Mono", Menlo, monospace';
const FONT_BIG = '700 14px ui-monospace, "SF Mono", Menlo, monospace';

// Cell boundaries across the 512px panel.
export const CELLS = {
  stores: [3, 118],
  alt: [121, 191],
  radar: [194, 318],
  fuel: [321, 391],
  score: [394, 509],
};

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

// A bezelled box with the original's corner ornaments: a bright frame, a bevel
// picked out light on the top-left and dark on the bottom-right, and four
// little corner brackets.
function box(ctx, x, y, w, h) {
  ctx.fillStyle = PANEL.well;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PANEL.bezel;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.strokeStyle = PANEL.bezelLit;
  ctx.beginPath();
  ctx.moveTo(x + 1.5, y + h - 1.5);
  ctx.lineTo(x + 1.5, y + 1.5);
  ctx.lineTo(x + w - 1.5, y + 1.5);
  ctx.stroke();
  ctx.strokeStyle = PANEL.bezelShade;
  ctx.beginPath();
  ctx.moveTo(x + w - 1.5, y + 1.5);
  ctx.lineTo(x + w - 1.5, y + h - 1.5);
  ctx.lineTo(x + 1.5, y + h - 1.5);
  ctx.stroke();
  ctx.fillStyle = PANEL.bezelLit;
  for (const [cx, cy, sx, sy] of [
    [x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * 1, cy + sy * 1);
    ctx.lineTo(cx + sx * 6, cy + sy * 1);
    ctx.lineTo(cx + sx * 6, cy + sy * 2.5);
    ctx.lineTo(cx + sx * 2.5, cy + sy * 2.5);
    ctx.lineTo(cx + sx * 2.5, cy + sy * 6);
    ctx.lineTo(cx + sx * 1, cy + sy * 6);
    ctx.closePath();
    ctx.fill();
  }
}

// A round analog gauge: bezel, dark dished face, a tick scale, a coloured danger
// arc, a needle and an engraved label. Value is 0..1.
function dial(ctx, cx, cy, r, value, label, opts = {}) {
  const { danger = 0.22, reverse = false } = opts;
  ctx.save();

  // Bezel and dished face.
  const bez = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  bez.addColorStop(0, PANEL.bezelLit);
  bez.addColorStop(0.5, PANEL.bezel);
  bez.addColorStop(1, PANEL.bezelShade);
  ctx.fillStyle = bez;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  const face = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  face.addColorStop(0, PANEL.faceEdge);
  face.addColorStop(0.6, PANEL.face);
  face.addColorStop(1, PANEL.body);
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
  ctx.fill();

  // The scale sweeps 240 degrees, opening downward, the way a real instrument
  // does.
  const A0 = Math.PI * 0.75;
  const SPAN = Math.PI * 1.5;

  ctx.lineWidth = 2;
  ctx.strokeStyle = reverse ? PANEL.ok : PANEL.danger;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 4.5, A0, A0 + SPAN * danger);
  ctx.stroke();

  ctx.strokeStyle = PANEL.inkDim;
  for (let i = 0; i <= 8; i++) {
    const a = A0 + (SPAN * i) / 8;
    const major = i % 2 === 0;
    ctx.lineWidth = major ? 1.4 : 0.8;
    const r0 = r - (major ? 7 : 5);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3));
    ctx.stroke();
  }

  // Needle.
  const v = Math.max(0, Math.min(1, value));
  const a = A0 + SPAN * v;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(a);
  ctx.fillStyle = PANEL.needle;
  ctx.beginPath();
  ctx.moveTo(-2.5, -1.6);
  ctx.lineTo(r - 5, -0.7);
  ctx.lineTo(r - 5, 0.7);
  ctx.lineTo(-2.5, 1.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = PANEL.ink;
  ctx.beginPath();
  ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
  ctx.fill();

  // Engraved label across the lower face.
  ctx.font = FONT_LABEL;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PANEL.inkDim;
  ctx.fillText(label, cx, cy + r * 0.46);
  ctx.restore();
}

// A recessed readout well with a right-aligned number in it.
function readout(ctx, x, y, w, h, value, opts = {}) {
  const { font = FONT_READ, colour = PANEL.ink, align = 'right' } = opts;
  ctx.save();
  ctx.fillStyle = PANEL.well;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PANEL.faceEdge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colour;
  ctx.fillText(String(value), align === 'right' ? x + w - 3 : x + 3, y + h / 2 + 0.5);
  ctx.restore();
}

// The little aircraft that marks the ordnance counters — a plan view, so it is
// obviously the same squadron as the side view flying above it.
function planIcon(ctx, x, y, s, colour) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(0, -5.5);
  ctx.quadraticCurveTo(1.5, -3, 1.5, 0.5);
  ctx.lineTo(1.2, 4);
  ctx.lineTo(-1.2, 4);
  ctx.lineTo(-1.5, 0.5);
  ctx.quadraticCurveTo(-1.5, -3, 0, -5.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-6, -1.6, 12, 1.9);
  ctx.fillRect(-3, 3, 6, 1.4);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The radar
// ---------------------------------------------------------------------------

// Bright enough to find at a glance in a 124x36 window, and a colour that
// appears nowhere else on the panel so a browser test can count its pixels.
export const RADAR_BLIP = '#b7ff5a';

// How tall a fully solid island stands above the radar's horizon. Ten of the
// eighteen pixels between the horizon and the top of the window: enough that a
// castle towers over an overworld shoreline, and it still leaves the aircraft
// clear sky to fly in above the tallest terrain.
const TERRAIN_H = 10;

// Scorched land. Deliberately a long way from the orange — at one pixel wide
// the only difference anyone will ever see is value, so a bombed stretch is
// dark where clean land is bright, and loses its lit crest as well. Exported
// for the same reason RADAR_BLIP is: it appears nowhere else on the panel, so
// a browser test can count its pixels.
export const RADAR_SCORCH = '#4d2417';
const BURNT = RADAR_SCORCH;
const BURNT_LIT = '#7d3d24';
// Where a bomb has taken more than this share of a column's tiles, the column
// reads as wrecked rather than merely dented. One bomb's crater is a couple of
// dozen tiles against a bucket of ~160, so this is roughly "more than a single
// hit here".
const BURNT_AT = 0.06;
// A bucket is ~10 tile columns wide. Half of them floorless is a hole you
// could put an aeroplane through; a third would flag every ordinary two-tile
// pit in 1-1 and break the coastline everywhere.
const GAP_AT = 0.5;
const ROOF_AT = 0.5;

// One island, drawn as the level it actually is rather than as a bar.
//
// The strip is a ground silhouette with the coastline broken where there is no
// floor, a thin lid over the stretches that are enclosed overhead, and
// scorching where the pilot has already been. See radar-terrain.js for what
// that keeps and what it throws away, and why.
//
// The height curve is sqrt, not linear. It is a display choice and it lives
// here rather than in the profile: real terrain spends almost all its time in
// the bottom third of a fifteen-row band, so linear scaling squashes 1-1's
// entire landscape into one pixel and hands the other nine to a castle nobody
// needs that much resolution on.
function radarIsland(ctx, isle, toX, horizon) {
  const px0 = toX(isle.x);
  const px1 = toX(isle.x1);
  const pw = Math.max(2, px1 - px0);
  const n = Math.max(2, Math.round(pw));
  const profile = isle.island ? profileFor(isle.island, n) : null;

  // No island object — a caller that only had spans. Fall back to the old
  // solid bar rather than drawing nothing.
  if (!profile) {
    ctx.fillStyle = 'rgba(226,112,58,0.8)';
    ctx.fillRect(px0, horizon - 4, pw, 4);
    return;
  }

  for (let i = 0; i < profile.length; i++) {
    const c = profile[i];
    const cx = Math.round(px0 + (i * pw) / profile.length);
    const cw = Math.max(1, Math.round(px0 + ((i + 1) * pw) / profile.length) - cx);
    const burnt = c.damage >= BURNT_AT;

    // The waterline. It breaks where there is genuinely no floor — which is
    // what a hole in 1-3 looks like from above — but a stretch the pilot has
    // BLOWN to nothing keeps a scorched line instead of disappearing. An
    // island flattened end to end would otherwise read as open sea, and the
    // pilot would lose both the landmark and the record of his own work.
    if (c.gap < GAP_AT || c.damage > 0) {
      ctx.fillStyle = burnt || c.damage > 0 ? BURNT : LAND.earthDark;
      ctx.fillRect(cx, horizon, cw, 1);
    }

    const gh = Math.round(TERRAIN_H * Math.sqrt(Math.max(0, Math.min(1, c.ground))));
    if (gh > 0) {
      ctx.fillStyle = burnt ? BURNT : 'rgba(226,112,58,0.85)';
      ctx.fillRect(cx, horizon - gh, cw, gh);
      // A lit crest, so a one-pixel step in the silhouette is a step and not a
      // smudge. Scorched land does not get one: losing the highlight is half
      // of what makes a bombed stretch read as bombed.
      ctx.fillStyle = burnt ? BURNT_LIT : LAND.sandLit;
      ctx.fillRect(cx, horizon - gh, cw, 1);
    }

    // A walkway over a void. Only drawn where the coastline is broken, so it
    // never competes with the silhouette: it is there to say "the void here
    // has a floor suspended in it", which is 1-3 in one mark and is the
    // difference between that island and open sea.
    if (c.gap >= GAP_AT && c.shelf > 0) {
      const sh = Math.round(TERRAIN_H * Math.sqrt(Math.min(1, c.shelf)));
      ctx.fillStyle = burnt ? BURNT_LIT : LAND.sand;
      ctx.fillRect(cx, horizon - Math.max(1, sh), cw, 1);
    }

    // The lid. Underground and castle levels are roofed nearly end to end, and
    // this single line is the whole difference between 1-2 and 1-1 at fifteen
    // pixels wide.
    if (c.roof >= ROOF_AT) {
      ctx.fillStyle = burnt ? BURNT_LIT : LAND.rock;
      ctx.fillRect(cx, horizon - TERRAIN_H, cw, 1);
    }
  }
}

// A real instrument, not a decorative rectangle: a plan of the whole operating
// area with the ship, the aircraft and the current viewport on it. When there
// are islands to hunt across, this is what the pilot navigates by.
function radar(ctx, x, y, w, h, sim, world, tick) {
  ctx.fillStyle = '#061428';
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const span = world.maxX - world.minX;
  const toX = (wx) => x + ((wx - world.minX) / span) * w;
  const horizon = y + h * 0.5;

  // Sea and sky, so the window reads as the same world you are flying in.
  // The window shows the same world: bright sky above, dark sea below.
  ctx.fillStyle = '#0f9be0';
  ctx.fillRect(x, y, w, horizon - y);
  ctx.fillStyle = '#123f70';
  ctx.fillRect(x, horizon, w, h - (horizon - y));
  ctx.strokeStyle = SEA.crest;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x, horizon);
  ctx.lineTo(x + w, horizon);
  ctx.stroke();

  // A sweep line running off the tick, so the instrument is visibly live.
  const sweep = ((tick * 0.7) % (w + 30)) - 15;
  const beam = ctx.createLinearGradient(x + sweep - 22, 0, x + sweep, 0);
  beam.addColorStop(0, 'rgba(125,191,53,0)');
  beam.addColorStop(1, 'rgba(125,191,53,0.20)');
  ctx.fillStyle = beam;
  ctx.fillRect(x + sweep - 22, y, 22, h);

  // Range graticule.
  ctx.strokeStyle = 'rgba(125,191,53,0.14)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let i = 1; i < 6; i++) {
    ctx.moveTo(x + (w / 6) * i, y);
    ctx.lineTo(x + (w / 6) * i, y + h);
  }
  ctx.stroke();

  // The carrier, drawn as a ship rather than as a bar: hull, deck line, island
  // and mast, so the window shows the thing the pilot is looking for.
  const sx0 = toX(world.deckX0);
  const sx1 = toX(world.deckX1);
  ctx.fillStyle = SHIP.hullShade;
  ctx.beginPath();
  ctx.moveTo(sx0 - 1, horizon - 3);
  ctx.lineTo(sx1 + 2, horizon - 3);
  ctx.lineTo(sx1, horizon + 1);
  ctx.lineTo(sx0, horizon + 1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = SHIP.deckLit;
  ctx.fillRect(sx0 - 1, horizon - 3.6, sx1 - sx0 + 3, 1);
  ctx.fillStyle = SHIP.island;
  ctx.fillRect(sx1 - 11, horizon - 8, 5, 4.6);
  ctx.fillStyle = SHIP.rule;
  ctx.fillRect(sx1 - 9, horizon - 11.5, 0.9, 3.6);
  // Her wake, so the plan shows which way she is steaming.
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(sx0 - 9, horizon - 1, 8, 1);

  // Islands, once there are any — each one drawn as its own terrain.
  for (const isle of world.islands || []) radarIsland(ctx, isle, toX, horizon);

  // The viewport, so the pilot can see what part of the plan is on screen.
  ctx.strokeStyle = 'rgba(223,233,242,0.35)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(toX(sim.cam.x) + 0.5, y + 1.5, Math.max(3, (512 / span) * w), h - 3);

  // The aircraft: a bright dot at the top of the value hierarchy, with its
  // height in the window driven by real altitude.
  const p = sim.plane;
  const alt = Math.max(0, world.seaY - (p.y + 12)) / world.seaY;
  const py = horizon - alt * (horizon - y - 4);
  ctx.fillStyle = PLANE.spec;
  ctx.beginPath();
  ctx.arc(toX(p.x + 12), py, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(toX(p.x + 12), py + 2);
  ctx.lineTo(toX(p.x + 12), horizon);
  ctx.stroke();

  // The contact. A fuzzy fix drawn as a fuzzy thing: a ring whose radius is
  // the uncertainty and a pip at its centre, both dimming as the fix ages.
  // The pilot is being told "somewhere around here, a moment ago", and the
  // instrument should look like it means that.
  const contact = world.contact;
  if (contact) {
    const cx = toX(contact.x);
    const cy = horizon - 5;
    const spread = 4 + (1 - contact.confidence) * 10;
    ctx.globalAlpha = 0.25 + contact.confidence * 0.45;
    ctx.strokeStyle = RADAR_BLIP;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, spread, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = RADAR_BLIP;
    ctx.fillRect(Math.round(cx) - 1, Math.round(cy) - 1, 2, 2);
  }
  ctx.restore();

  ctx.strokeStyle = PANEL.faceEdge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export function drawPanel(ctx, viewW, viewH, sim, world, tick) {
  const y = viewH - HUD_H;
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // Panel body, with a brushed sheen so it reads as a metal fascia.
  const g = ctx.createLinearGradient(0, y, 0, viewH);
  g.addColorStop(0, '#151a21');
  g.addColorStop(0.12, PANEL.body);
  g.addColorStop(1, '#04060a');
  ctx.fillStyle = g;
  ctx.fillRect(0, y, viewW, HUD_H);
  ctx.fillStyle = PANEL.bezel;
  ctx.fillRect(0, y, viewW, 1.5);
  ctx.fillStyle = PANEL.bezelLit;
  ctx.fillRect(0, y, viewW, 0.6);

  const p = sim.plane;
  const iy = y + 4;
  const ih = HUD_H - 8;

  // --- stores and squadron -------------------------------------------------
  {
    const [x0, x1] = CELLS.stores;
    box(ctx, x0, iy, x1 - x0, ih);
    ctx.font = FONT_LABEL;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PANEL.inkDim;
    ctx.fillText('ROCKETS', x0 + 8, iy + 11);
    ctx.fillText('BOMBS', x0 + 8, iy + 25);
    readout(ctx, x0 + 46, iy + 5, 26, 11, sim.rockets == null ? 30 : sim.rockets);
    readout(ctx, x0 + 46, iy + 19, 26, 11, sim.bombs == null ? 3 : sim.bombs);
    planIcon(ctx, x0 + 92, iy + 12, 1.2, PLANE.canopy);
    ctx.font = FONT_BIG;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PANEL.ink;
    ctx.fillText(String(sim.squadron), x0 + 92, iy + 28);
  }

  // --- altimeter -----------------------------------------------------------
  {
    const [x0, x1] = CELLS.alt;
    const r = Math.min((x1 - x0) / 2, ih / 2);
    const alt = Math.max(0, world.seaY - (p.y + 12));
    dial(ctx, (x0 + x1) / 2, iy + ih / 2, r, alt / world.seaY, 'ALT');
  }

  // --- radar ---------------------------------------------------------------
  {
    const [x0, x1] = CELLS.radar;
    radar(ctx, x0, iy, x1 - x0, ih, sim, world, tick);
  }

  // --- fuel ----------------------------------------------------------------
  {
    const [x0, x1] = CELLS.fuel;
    const r = Math.min((x1 - x0) / 2, ih / 2);
    dial(ctx, (x0 + x1) / 2, iy + ih / 2, r, world.fuel, 'FUEL');
  }

  // --- speed, hook and status ---------------------------------------------
  {
    const [x0, x1] = CELLS.score;
    box(ctx, x0, iy, x1 - x0, ih);
    ctx.font = FONT_LABEL;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PANEL.inkDim;
    ctx.fillText('SPEED', x0 + 8, iy + 11);
    readout(ctx, x0 + 46, iy + 5, 34, 11, p.speed.toFixed(1));

    ctx.font = FONT_LABEL;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PANEL.inkDim;
    ctx.fillText('HOOK', x0 + 8, iy + 25);
    // Hook lamp: lit amber when the hook is down, saying the same thing the
    // aircraft itself is saying.
    ctx.fillStyle = p.gear ? PANEL.warn : '#242a31';
    ctx.beginPath();
    ctx.arc(x0 + 42, iy + 25, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PANEL.faceEdge;
    ctx.lineWidth = 1;
    ctx.stroke();

    const status = sim.status === 'over' ? 'SQUADRON GONE'
      : sim.status === 'lost' ? 'PRESS R'
        : world.verdict || '';
    if (status) {
      ctx.font = FONT_LABEL;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = sim.status === 'ready' ? PANEL.ok : PANEL.danger;
      ctx.fillText(status, x1 - 8, iy + 25);
    }
  }

  ctx.restore();
}
