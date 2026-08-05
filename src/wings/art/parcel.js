// THE SUPPLY DROP, in pixels.
//
// A crate under a parachute, falling onto Mario's screen when the bombing has
// stranded him — see src/wings/parcel.js for what it carries and
// src/wings/supply-drop.js for the flight. This file is only the art, and it is
// deliberately only the art: it is imported by src/wings/mario-main.js, which
// is the one module that has both a canvas and the flight state, so nothing
// here has to know what a World is and nothing in the flight has to know what a
// canvas is.
//
// AUTHORED AS SPRITES, not as ctx primitives, unlike its neighbours in this
// directory. Those draw the PILOT'S world, which renders through its own
// Canvas2D renderer and imports none of the Mario engine's sprite pipeline
// (see the note at the top of art/palette.js). This one is drawn over the Mario
// game, at Mario's resolution, next to Mario's own sprites — so it is pixel art
// on the engine's own gfx.js, which is also what lets it be looked at with:
//
//   node tools/sheet.mjs src/wings/art/parcel.js --bg sky --scale 8
//
// PALETTE POLICY, the same discipline src/data/tiles.js states and asserts:
// near-black outline; light from the UPPER LEFT; chroma kept all the way into
// the light tones. Two families that must never be confused at 16 pixels — a
// cool near-white canopy and warm wood — plus one saturated red that appears on
// both, because the band on the canopy and the stencil on the crate are the
// same marking and say the same thing: this came off the ship.
//
// The white and the red are the ENSIGN values from src/wings/art/palette.js
// (#f4f6fb, #d33a35), which is the flag on the carrier the aeroplane flies
// from. It is the one honest way for a Mario-side object to say where it came
// from without drawing the ship on Mario's screen.

import { makeSprite, Anim } from '../../core/gfx.js';

//  0 outline        1 canopy shade    2 canopy mid     3 canopy lit
//  4 band shade     5 band            6 rigging
//  7 wood shade     8 wood            9 wood lit
const PAL = [
  '#1a1c24',
  '#8f97a8',
  '#c2c7d4',
  '#f4f6fb',
  '#a32a26',
  '#d33a35',
  '#6b5a3e',
  '#7a4a1c',
  '#9c5f24',
  '#c98a3e',
];

// THE CRATE. Horizontal planks with a lit X brace across the front and the
// ship's red stencil band over the middle, which is also where the two arms of
// the brace cross — a crossing drawn at 16 pixels is a smudge, and hiding it
// under the band is cheaper than trying to draw it.
//
// The upper half is the lit wood and the lower half the shade, which is the
// whole of the form: a box has no other shape to give away.
const CRATE = [
  '0000000000000000',
  '0999999999999970',
  '0898888888888970',
  '0889888888889870',
  '0888988888898870',
  '0888898888988870',
  '0888889889888870',
  '0555555555544440',
  '0555555555544440',
  '0777778778777770',
  '0777787777877770',
  '0777877777787770',
  '0778777777778770',
  '0787777777777870',
  '0777777777777770',
  '0000000000000000',
];

// THE CANOPY, and it took three passes to stop it looking like something else.
// A flat lens with a red band across it read as a flying saucer; a dome that
// curved back in at the bottom read as a mushroom cap. This is a BELL — widest
// at the skirt, fourteen rows tall over a sixteen-pixel crate, with a scalloped
// hem — which is the silhouette everybody recognises without being told.
//
// The red is carried on two vertical GORES rather than on a horizontal band.
// The gores are what make it fabric: they narrow towards the crown exactly as
// sewn panels do, and they are the reason it cannot be mistaken for a rigid
// object. Light from the upper left, so the left gores are the lit whites and
// the right-hand red panel is the dark one.
//
// Two frames, differing only in how far the bell is puffed out at its waist.
// Nothing in this game may sit perfectly still (ARCHITECTURE.md §12), and a
// parachute least of all — a canopy that held one shape all the way down would
// read as a cardboard cutout on a string.
const CANOPY_A = [
  '............0240............',
  '..........03522410..........',
  '........035522214410........',
  '.......03355222244110.......',
  '......0335522222444110......',
  '.....033555222221444110.....',
  '.....033555222221444110.....',
  '....03335552222214441110....',
  '....03335552222214441110....',
  '...0333555222222244441110...',
  '..033355552222222144441110..',
  '.03333555522222221444411110.',
  '0333355552222222214444411110',
  '0000..0000..0000..0000..0000',
];

const CANOPY_B = [
  '............0240............',
  '..........03522410..........',
  '........035522214410........',
  '.......03355222244110.......',
  '.......03355222244110.......',
  '......0335522222444110......',
  '......0335522222444110......',
  '.....033555222221444110.....',
  '.....033555222221444110.....',
  '....03335552222214441110....',
  '...0333555222222244441110...',
  '.03333555522222221444411110.',
  '0333355552222222214444411110',
  '0000..0000..0000..0000..0000',
];

// Four rigging lines from the canopy's mouth to the crate's top corners. Drawn
// as single pixels rather than as ropes with thickness, which is what they look
// like at this distance and what the original's own thin details look like.
const LINES = [
  '...6.......6....6.......6...',
  '....6......6....6......6....',
  '.....6.....6....6.....6.....',
  '.....6.....6....6.....6.....',
  '......6....6....6....6......',
  '.......6....6..6....6.......',
];

// Half a canopy: the moment after the crate leaves the aeroplane and before the
// silk has taken the load. Fewer rows of dome and MORE rows of line, so the
// bloom reads as the canopy climbing away from the crate rather than as a
// second, smaller parachute.
const HALF_CANOPY = [
  '......0335522222444110......',
  '......0335522222444110......',
  '.....033555222221444110.....',
  '.....033555222221444110.....',
  '....03335552222214441110....',
  '...0333555222222244441110...',
  '.03333555522222221444411110.',
  '0333355552222222214444411110',
  '0000..0000..0000..0000..0000',
];

const HALF_LINES = [
  '...6.......6....6.......6...',
  '....6......6....6......6....',
  '....6......6....6......6....',
  '.....6.....6....6.....6.....',
  '.....6.....6....6.....6.....',
  '......6....6....6....6......',
  '......6....6....6....6......',
  '.......6....6..6....6.......',
  '.......6....6..6....6.......',
];

// WHERE THE SILK GOES once it is down, and this took two passes to get right.
// The first drew it as a wide bar stacked ON TOP of the crate, which read as a
// shelf: fabric hanging off the lid with sixteen pixels of nothing under it is
// fabric that has not landed. Silk that has collapsed lies ON THE GROUND. So it
// is drawn in the six-pixel gutters either side of the crate, rising to about
// half its height and pooling at the ground line, with one sagging row over the
// lid to say it came down over the box rather than beside it.
//
// LID is exactly the crate's own width — nothing overhangs, so nothing floats.
const LID_A = ['0332222221111110'];
const LID_B = ['0222222211111110'];

// The pool, as [left, right] six-pixel gutters for the crate's LAST rows. The
// bottom row is the ground line and is outline in both gutters, which is what
// stops the heap looking like it is hovering a pixel above the floor.
const POOL_A = [
  ['.....0', '0.....'],
  ['....03', '30....'],
  ['....03', '30....'],
  ['...033', '330...'],
  ['..0333', '3330..'],
  ['.03332', '23330.'],
  ['033322', '223330'],
  ['000000', '000000'],
];

const POOL_B = [
  ['......', '......'],
  ['......', '......'],
  ['.....0', '0.....'],
  ['....03', '30....'],
  ['...033', '330...'],
  ['..0332', '2330..'],
  ['.03322', '22330.'],
  ['000000', '000000'],
];

// Padding so every row of a composite sprite is the same width; gfx.js throws
// on a ragged sprite, which is exactly the check we want and exactly the
// mistake hand-authored composites make.
const pad = (rows, w = 28) => rows.map((r) => {
  const left = Math.floor((w - r.length) / 2);
  return '.'.repeat(left) + r + '.'.repeat(w - r.length - left);
});

const stack = (...parts) => pad([].concat(...parts));

// The crate with silk pooled in the gutters either side of it. `pool` covers
// the LAST rows of the crate, bottom-aligned, so the ground line of the heap
// and the ground line of the crate are the same row by construction.
function heaped(lid, pool) {
  const top = pool.length - CRATE.length;
  const rows = CRATE.map((row, i) => {
    const p = pool[i + top];
    return p ? `${p[0]}${row}${p[1]}` : pad([row])[0];
  });
  return [...pad(lid), ...rows];
}

export const PARCEL_CRATE = makeSprite(CRATE, PAL, { name: 'parcel-crate' });

export const PARCEL_OPENING = makeSprite(
  stack(HALF_CANOPY, HALF_LINES, CRATE), PAL, { name: 'parcel-opening' }
);

export const PARCEL_FALLING = new Anim([
  makeSprite(stack(CANOPY_A, LINES, CRATE), PAL, { name: 'parcel-falling#0' }),
  makeSprite(stack(CANOPY_B, LINES, CRATE), PAL, { name: 'parcel-falling#1' }),
], 8);

export const PARCEL_LANDED = new Anim([
  makeSprite(heaped(LID_A, POOL_A), PAL, { name: 'parcel-landed#0' }),
  makeSprite(heaped(LID_B, POOL_B), PAL, { name: 'parcel-landed#1' }),
], 10, false);

/**
 * Draw the drop at `x`, `y` — the crate's BOTTOM CENTRE, in whatever frame the
 * caller's context is already in. Anchoring on the bottom centre is what lets
 * the falling and landed sprites be different heights without the crate
 * appearing to jump at the moment it touches down.
 *
 * `s` is the state object from src/wings/supply-drop.js: `{ phase, open, t,
 * alpha }`. The tick it carries is the animation clock, so the canopy breathes
 * on the engine's fixed step like everything else on this canvas.
 */
export function drawSupplyDrop(ctx, x, y, s) {
  if (!s) return null;
  const art = s.phase === 'fall'
    ? (s.open < 1 ? PARCEL_OPENING : PARCEL_FALLING.frame(s.t))
    : PARCEL_LANDED.frame(s.t);
  const a = s.alpha == null ? 1 : s.alpha;
  const prev = ctx.globalAlpha;
  if (a < 1) ctx.globalAlpha = prev * a;
  art.draw(ctx, Math.round(x - art.w / 2), Math.round(y - art.h));
  ctx.globalAlpha = prev;
  return art;
}

export default drawSupplyDrop;
