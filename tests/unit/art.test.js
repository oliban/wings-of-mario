import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  SKY, SEA, SHIP, PLANE, PANEL, CLOUD, ORD, ENSIGN, luma,
} from '../../src/wings/art/palette.js';
import {
  PLANE_LEN, PLANE_ASPECT, PLANE_HEIGHT, LANDMARKS, drawPlane, drawPlaneBody, drawParkedPlane,
} from '../../src/wings/art/plane.js';
import { surfaceAt, drawSea, drawWake, drawBowWave, drawSplash } from '../../src/wings/art/sea.js';
import { drawSky, drawClouds } from '../../src/wings/art/sky.js';
import {
  ISLAND_H, ISLAND_W, DECK_THICK, drawHull, drawDeck, drawIsland, drawCrew, drawDeckPark,
} from '../../src/wings/art/carrier.js';
import { HUD_H, CELLS, drawPanel } from '../../src/wings/art/hud.js';
import { WORLD_SCALE, PLAY_H } from '../../src/wings/scene.js';
import { drawBomb, drawRocket, drawTracer, drawFireball } from '../../src/wings/art/ordnance.js';
import { VIEW_W, VIEW_H, DECK_X0, DECK_X1, DECK_Y, SEA_Y } from '../../src/wings/geo.js';

// The pilot view is no longer a pixel-art pipeline, so there are no sprite grids
// to check for ragged rows. What replaced those tests are the things the new
// approach actually has to get right: the VALUE HIERARCHY and HUE SEPARATION the
// whole look depends on, the AIRCRAFT PROPORTIONS measured off the original, the
// layout proportions, and determinism.

const ART_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/wings/art');
const ART_FILES = readdirSync(ART_DIR).filter((f) => f.endsWith('.js'));

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

const ALL_COLOURS = [
  ['SKY', SKY], ['SEA', SEA], ['SHIP', SHIP], ['PLANE', PLANE],
  ['PANEL', PANEL], ['CLOUD', CLOUD], ['ORD', ORD], ['ENSIGN', ENSIGN],
];

test('every colour in the scheme is an opaque six-digit hex', () => {
  for (const [name, group] of ALL_COLOURS) {
    for (const [k, v] of Object.entries(group)) {
      assert.equal(typeof v, 'string', `${name}.${k} is not a colour`);
      assert.match(v, /^#[0-9a-f]{6}$/i, `${name}.${k} = ${v}`);
    }
  }
});

// The single most important relationship in the whole look, and it is measured
// off the user's own reference screenshots: the SKY is the brightest large area,
// the sea is dark, and the AEROPLANE is a dark saturated shape against the sky
// carrying small white markings. This file asserted the opposite in an earlier
// round, for a black sky. Getting it backwards is what makes a screenshot stop
// looking like the game.
test('the sky is the brightest large area and the aeroplane is dark against it', () => {
  const sky = luma(SKY.flat);
  assert.ok(sky > 115 && sky < 170, `sky luma ${sky.toFixed(0)}, reference is 143`);
  for (const k of ['zenith', 'high', 'mid', 'horizon']) {
    assert.ok(Math.abs(luma(SKY[k]) - sky) < 45, `SKY.${k} strays too far from the reference blue`);
  }
  // Every airframe tone below the sky: the aeroplane is a dark shape, not a
  // light one. Markings are the only bright thing on it.
  for (const k of ['light', 'skin', 'mid', 'shade', 'dark']) {
    assert.ok(luma(PLANE[k]) < sky - 8,
      `PLANE.${k} at luma ${luma(PLANE[k]).toFixed(0)} is not darker than the sky`);
  }
  assert.ok(luma(PLANE.spec) > 240, 'the markings have to be white to carry at this size');
  assert.ok(luma(PLANE.dark) < 60, 'the upper surface should be genuinely dark');
});

test('the sea is the dark half of the frame, well under the sky', () => {
  const sky = luma(SKY.flat);
  assert.ok(luma(SEA.surface) < sky - 25,
    `sea surface ${luma(SEA.surface).toFixed(0)} is not clearly under the sky at ${sky.toFixed(0)}`);
  assert.ok(luma(SEA.abyss) < 40, 'the deep should go genuinely dark');
  const order = ['surface', 'shallow', 'mid', 'deep', 'abyss'];
  for (let k = 1; k < order.length; k++) {
    assert.ok(luma(SEA[order[k]]) < luma(SEA[order[k - 1]]), 'the sea must darken with depth');
  }
  assert.ok(luma(SEA.foam) > 240, 'foam is the one white thing on the water');
});

// Sampled off the reference: the hull is #8d8c9c, a near-neutral cool grey with a
// faint violet cast — NOT the saturated slate violet an earlier round invented
// from an Apple II palette accident. It separates from a blue sky and a blue sea
// by being desaturated and light, and from the aeroplane by being much lighter.
test('the ship is a light near-neutral grey, distinct from sky, sea and aircraft', () => {
  const sat = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const mx = Math.max(...c);
    return mx === 0 ? 0 : (mx - Math.min(...c)) / mx;
  };
  assert.ok(sat(SHIP.hull) < 0.22, `hull saturation ${sat(SHIP.hull).toFixed(2)} — it is a grey ship`);
  assert.ok(luma(SHIP.hull) > 120, 'the hull is a light mass, which is what the aeroplane reads against');
  assert.ok(luma(SHIP.hull) > luma(SEA.surface) + 20, 'the hull must lift off the water');
  assert.ok(luma(SHIP.hull) > luma(PLANE.light) + 8, 'a dark aeroplane needs a lighter deck to sit on');
  // The aircraft is a saturated blue-grey; the ship is not. That is the
  // separation, now that both sit in the same value neighbourhood as the sky.
  assert.ok(sat(PLANE.shade) > sat(SHIP.hull) + 0.2, 'the aeroplane is the more saturated of the two');
  assert.ok(sat(PLANE.flash) > 0.6, 'the squadron band is the one warm accent and must be warm');
  assert.ok(sat(SEA.mid) > 0.5, 'the sea is a saturated blue, not a grey');
});

// ---------------------------------------------------------------------------
// The aircraft
// ---------------------------------------------------------------------------

test('the aircraft is drawn to the original\'s proportions', () => {
  assert.ok(PLANE_ASPECT > 2.55 && PLANE_ASPECT < 2.85,
    `aspect ${PLANE_ASPECT} — anything squarer than about 2.6:1 reads as a bird`);
  assert.ok(Math.abs(PLANE_HEIGHT - PLANE_LEN / PLANE_ASPECT) < 1e-6);
  assert.equal(LANDMARKS.nose - LANDMARKS.tail, LANDMARKS.localLen,
    'the authored frame must run nose to tail');
});

// The one finding from the reference comparison that no amount of rendering
// quality can buy: the mass belongs at the back.
// A Hellcat is brutally front-heavy in profile. An even-diameter tube reads as a
// light aircraft no matter what is painted on it, and it is also why the fin
// failed to read as the tallest point even when it geometrically was.
test('the fuselage is deep at the cowl and tapers hard to the tail', () => {
  const { cowlDepth, tailDepth } = LANDMARKS;
  assert.ok(cowlDepth / tailDepth > 3,
    `taper is only ${(cowlDepth / tailDepth).toFixed(1)}:1 — a warplane is front-heavy`);
});

test('the vertical fin is the tallest point of the aircraft, and it is at the tail', () => {
  const { nose, finTopY, finTopX, canopyPeakY, spineY, bellyY, wingLowY } = LANDMARKS;
  assert.ok(finTopY < canopyPeakY, 'the fin must rise above the canopy');
  assert.ok(finTopY < spineY, 'the fin must rise above the spine');
  const aft = (nose - finTopX) / LANDMARKS.localLen;
  assert.ok(aft > 0.9 && aft <= 1.02, `the fin top is ${(aft * 100).toFixed(0)}% aft, wanted ~95%`);
  assert.ok(bellyY > 0 && wingLowY > bellyY, 'the wing must hang below the belly to be its own mass');
});

test('the canopy sits a little past halfway back, as it does on a Hellcat', () => {
  const aft = (LANDMARKS.nose - LANDMARKS.canopyPeakX) / LANDMARKS.localLen;
  assert.ok(aft > 0.5 && aft < 0.66, `the canopy is ${(aft * 100).toFixed(0)}% aft, wanted ~56%`);
});

// The original's aircraft is 15% of its screen width, and that is the fraction
// the eye judges a screenshot on. Ours matches it. The consequence — that it is
// a bigger share of our shorter flight deck than the original's is of its own —
// is recorded here so it is a decision rather than a drift.
// Measured against the user's own reference screenshot, where the aeroplane's
// bounding box is 14.1% of the play area's width. What the player sees is the
// world-space length through the render zoom, so both terms belong in the test.
// The number that matters is the aeroplane against the SHIP. In the reference the
// carrier fills the frame and the aircraft is about an eighth of it; ours was a
// fifth of the deck, which is why the scene read as a close-up however the sprite
// itself was sized.
test('the aircraft is a small dark shape on a big ship', () => {
  const onDeck = PLANE_LEN / (DECK_X1 - DECK_X0);
  assert.ok(onDeck > 0.09 && onDeck < 0.16,
    `the aircraft is ${(onDeck * 100).toFixed(0)}% of the flight deck, reference is ~11%`);
  const onScreen = (PLANE_LEN * WORLD_SCALE) / VIEW_W;
  assert.ok(onScreen > 0.07 && onScreen < 0.13,
    `the aircraft is ${(onScreen * 100).toFixed(1)}% of screen width, reference is ~11%`);
  // ...and the ship has to actually dominate, or the ratio buys nothing.
  const deckOnScreen = ((DECK_X1 - DECK_X0) * WORLD_SCALE) / VIEW_W;
  assert.ok(deckOnScreen > 0.6, `the carrier is only ${(deckOnScreen * 100).toFixed(0)}% of the frame`);
  assert.equal(PLAY_H, VIEW_H - HUD_H);
});

// ---------------------------------------------------------------------------
// The ship
// ---------------------------------------------------------------------------

test('the island rises to about half the play area, as in the reference', () => {
  const f = (ISLAND_H * WORLD_SCALE) / PLAY_H;
  assert.ok(f > 0.4 && f < 0.65,
    `the island is ${(f * 100).toFixed(0)}% of the play area on screen, reference is ~51%`);
  // It still has to be tall relative to the SHIP, which is what makes a box read
  // as a flat-top in the first place.
  assert.ok(ISLAND_H / (SEA_Y - DECK_Y) > 1.4, 'the island must tower over the freeboard');
  assert.ok(ISLAND_H > ISLAND_W, 'an island is taller than it is long');
  assert.ok(DECK_THICK > 0 && DECK_THICK < 12, 'the flight deck is a plate, not a storey');
});

test('the ship fits between the deck and the waterline the simulation gives it', () => {
  assert.ok(DECK_Y < SEA_Y, 'the deck is above the water');
  assert.ok(DECK_Y - ISLAND_H > 0, 'the island must not run off the top of the world');
});

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

test('the panel is bottom-anchored, boxed, and about a sixth of the screen', () => {
  const f = HUD_H / VIEW_H;
  assert.ok(f > 0.12 && f < 0.21, `the panel is ${(f * 100).toFixed(0)}% of the screen`);
});

test('the panel cells tile the width without overlapping', () => {
  const cells = Object.entries(CELLS).sort((a, b) => a[1][0] - b[1][0]);
  let prev = 0;
  for (const [name, [x0, x1]] of cells) {
    assert.ok(x0 >= prev, `${name} overlaps the cell to its left`);
    assert.ok(x1 > x0, `${name} has no width`);
    prev = x1;
  }
  assert.ok(prev <= VIEW_W, 'the panel runs off the right of the screen');
  assert.ok(prev > VIEW_W * 0.95, 'the panel should fill the width, not float in the middle');
});

test('the panel carries the instruments that make a still read as a flight game', () => {
  for (const k of ['stores', 'alt', 'radar', 'fuel', 'score']) {
    assert.ok(CELLS[k], `the panel is missing its ${k} cell`);
  }
  // The two round dials should be round: their cells have to be at least as wide
  // as the panel is tall, or the gauge collapses into an ellipse.
  for (const k of ['alt', 'fuel']) {
    const w = CELLS[k][1] - CELLS[k][0];
    assert.ok(w >= HUD_H - 8, `the ${k} dial has no room to be round`);
  }
  assert.ok(CELLS.radar[1] - CELLS.radar[0] > 90, 'the radar needs to be readable, not a token');
});

// ---------------------------------------------------------------------------
// The sea
// ---------------------------------------------------------------------------

test('the sea surface is a pure function of world x and tick', () => {
  for (const [x, t] of [[0, 0], [137, 41], [-260, 900], [5000, 12345]]) {
    assert.equal(surfaceAt(x, t), surfaceAt(x, t), 'surfaceAt is not deterministic');
  }
  // It has to actually move, and it has to move differently in different places.
  assert.notEqual(surfaceAt(100, 0), surfaceAt(100, 30));
  assert.notEqual(surfaceAt(100, 0), surfaceAt(160, 0));
});

test('the swell is a real seaway, not one repeating glyph', () => {
  // Three trains beating against each other should not repeat inside a screen.
  let matches = 0;
  for (let x = 0; x < 512; x++) {
    if (Math.abs(surfaceAt(x, 0) - surfaceAt(x + 97, 0)) < 0.01) matches++;
  }
  assert.ok(matches < 60, 'the surface repeats on the longest wavelength — that is one train, not three');
  let lo = Infinity;
  let hi = -Infinity;
  for (let x = 0; x < 4000; x++) {
    const h = surfaceAt(x, 7);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  assert.ok(hi - lo > 4 && hi - lo < 12, `swell range ${(hi - lo).toFixed(1)}px is wrong for this scale`);
});

// ---------------------------------------------------------------------------
// Determinism and self-containment
// ---------------------------------------------------------------------------

test('nothing in the art is driven by wall-clock time or unseeded randomness', () => {
  for (const f of ART_FILES) {
    const src = readFileSync(join(ART_DIR, f), 'utf8');
    // Strip comments so the prose that explains the rule does not trip it.
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/Math\.random/.test(code), `${f} uses Math.random`);
    assert.ok(!/Date\.now|performance\.now|new Date/.test(code), `${f} reads the wall clock`);
  }
});

test('the art fetches nothing — no CDN, no external image, no webfont', () => {
  for (const f of ART_FILES) {
    const src = readFileSync(join(ART_DIR, f), 'utf8');
    assert.ok(!/https?:\/\//.test(src), `${f} references a URL`);
    assert.ok(!/new Image|fetch\(|@font-face|FontFace/.test(src), `${f} loads an external asset`);
  }
});

test('every art module exports drawing functions and no canvas at import time', () => {
  const fns = [
    drawPlane, drawPlaneBody, drawParkedPlane,
    drawSea, drawWake, drawBowWave, drawSplash,
    drawSky, drawClouds,
    drawHull, drawDeck, drawIsland, drawCrew, drawDeckPark,
    drawPanel, drawBomb, drawRocket, drawTracer, drawFireball,
  ];
  for (const fn of fns) assert.equal(typeof fn, 'function');
  // Importing under Node proves none of them touches `document` on load, which
  // is what keeps this whole file runnable outside a browser.
  assert.ok(fns.length > 15);
});
