// items.js — collectibles, pickups and one-shot effects.
// Original pixel art. Faithful SMB silhouettes, every pixel authored here.
// Light source is UPPER-LEFT on every solid form.

import { makeSprite, Anim } from '../../core/gfx.js';
import { INK } from '../palette.js';

const OUT = INK.outline;

/* ------------------------------------------------------------------ *
 * MUSHROOMS
 * Shared geometry, two palettes — exactly how the NES did it.
 *   0 outline  1 cap shadow  2 cap mid  3 cap lit  4 cap rim
 *   5 spot shade  6 spot white  7 stem shade  8 stem mid  9 stem lit
 *   a cap specular
 * ------------------------------------------------------------------ */

// Cap: 1px red rim on BOTH shoulders (rows 6-8) so the spots never touch the
// outline, an 'a' specular arc walking the upper-left curve (rows 1-3), and a
// row-9 underside that bows instead of ruling a straight line. Every spot
// shadow (slot 5) is a 2px run or longer — a single pixel of shade reads as
// chipped stone rather than as the underside of a cream dot.
//
// A: cap lifted. A slot-1 band at row 10 is the cap's own shadow thrown across
// the top of the stem, so the dome visibly floats off it.
const MUSHROOM_UP = [
  '.....000000.....',
  '...0aa4333220...',
  '..0a4333332220..',
  '.0a433366222210.',
  '.04333666652210.',
  '0333336665522210',
  '0266653322666510',
  '0266652222666510',
  '0266552222266510',
  '0111122222211110',
  '0000111111110000',
  '...0998888770...',
  '...0900880070...',
  '...0900880070...',
  '...0788887770...',
  '...0000000000...',
];

// B: the dome SQUASHES. Crown and feet are both pinned — row 0 and row 15 are
// byte-identical to frame A — and the height comes out of the cap itself: the
// dome is ten rows here against A's eleven, the shoulders reach full width at
// row 4 instead of row 5, and the stem takes up the slack with an extra row
// underneath. The spots deform with the surface they sit on rather than riding
// along: every one of them is a row shallower and a column wider, the top spot
// goes from 3px to 4px across, and the eyes squint from two rows to one.
// No vertical shift aligns this with frame A — rows 3-9 are all authored.
const MUSHROOM_DOWN = [
  '.....000000.....',
  '...0aa4333220...',
  '..0a4333332220..',
  '.0a433666622210.',
  '0433366665522210',
  '0266663322666610',
  '0266652222666510',
  '0265552222255510',
  '0111122222211110',
  '0000111111110000',
  '...0998888770...',
  '...0998888870...',
  '...0900880070...',
  '...0988888870...',
  '...0788887770...',
  '...0000000000...',
];

// Slot 5 is the shadow side of a cream spot, so it is a warm tint of the spot
// itself — a neutral grey was the only desaturated hue on an otherwise fully
// warm sprite and read as chipped stone at 1x.
const MUSH_SUPER_PAL = [
  OUT, '#6b1200', '#b52a10', '#e03a1c', '#ff8b7f',
  '#e8b8a8', '#ffffff', '#9c7038', '#f0cc90', '#fff4d8', '#ffd0c8',
];

// The 1-Up cap is pushed to a YELLOW-green so a 1-Up climbing a vine stays two
// objects: against the vine's blue-green stalk this ramp never comes closer
// than 40 RGB units at any matching index (it used to fuse at 20).
const MUSH_1UP_PAL = [
  OUT, '#2e5400', '#5fa000', '#98d422', '#cdf05a',
  '#c8dca0', '#ffffff', '#9c7038', '#f0cc90', '#fff4d8', '#eaffb0',
];

const mushroom = (pal, name) =>
  new Anim(
    [
      makeSprite(MUSHROOM_UP, pal, { name: `${name}#0` }),
      makeSprite(MUSHROOM_DOWN, pal, { name: `${name}#1` }),
    ],
    8
  );

export const MUSHROOM_SUPER = { idle: mushroom(MUSH_SUPER_PAL, 'mushroom.super') };
export const MUSHROOM_1UP = { idle: mushroom(MUSH_1UP_PAL, 'mushroom.1up') };

/* ------------------------------------------------------------------ *
 * FIRE FLOWER — 4-frame palette cycle through the blossom ramp.
 *   0 outline  1 petal dark  2 petal mid  3 petal lit  4 petal spec
 *   5 face dark  6 face white  7 stem dark  8 stem mid  9 stem lit
 *   a bud accent
 * ------------------------------------------------------------------ */

// The crown is ONE dome (rows 0-1, no 12 o'clock notch — that notch turned the
// blossom into a pair of pointed ears). The petals are separated at 10 and 2
// o'clock instead, by the slot-0 grooves at row 2 cols 4 and 11. The white face
// plate is an octagon at rows 3-6 x cols 5-10 — half the blossom's width, so a
// 2px petal ring survives above, below and on both flanks — with 1x2 pupils at
// cols 6 and 9. Light upper-left: slot 4 walks the 10 o'clock rim.
// The two leaf blades are drawn from TWO different outlines, not one stamp slid
// up and down. The broad blade is five columns of blade with a squared shoulder;
// the curled blade is four columns with the tip hooked back toward the stem, and
// it is one whole pixel narrower at the waist. Every frame pairs them
// differently, so the leaves change SHAPE between frames and not just address.
const FLOWER_0 = [
  '.....000000.....',
  '....04333220....',
  '..040333322010..',
  '.04333555522210.',
  '0433356556522210',
  '0333256556522110',
  '.03322555521110.',
  '..022222211110..',
  '...021111110....',
  '....0000000.....',
  '..000.0980.000..',
  '.09980098008870.',
  '0988700980087770',
  '.08770098007770.',
  '..000.0980.000..',
  '......0000......',
];

// 1: the blossom CONTRACTS — rows 4-5 pull a full column in on both flanks, so
// the head is 14px wide here against 16 in frame 0 and the alpha mask genuinely
// changes. The left blade curls (a different outline, not a shifted one) while
// the right blade stays broad and droops a row.
const FLOWER_1 = [
  '.....000000.....',
  '....04333220....',
  '..040333322010..',
  '.04333555522210.',
  '.04335655652210.',
  '.03325655652110.',
  '.03322555521110.',
  '..022222211110..',
  '...021111110....',
  '....0000000.....',
  '..00..0980......',
  '.0980.0980.000..',
  '09870.098008870.',
  '.0770.0980087770',
  '..00..098007770.',
  '......0000.000..',
];

// 2: the crown RISES — row 1 spreads from six columns to ten and row 0 caps it
// two columns wider, so the blossom stands taller. The face plate slides a row
// down inside the petal ring and the pupils ride to rows 5-6. The blades swap:
// broad on the left dropping a row, curled on the right.
const FLOWER_2 = [
  '....00000000....',
  '...0433332210...',
  '..040333322010..',
  '.04333333222210.',
  '0433335555222210',
  '0333256556522110',
  '.03325655651110.',
  '..022255551110..',
  '...021111110....',
  '....0000000.....',
  '......0980..00..',
  '..000.0980.0870.',
  '.09980098008770.',
  '0988700980.0770.',
  '.087700980..00..',
  '..000.0000......',
];

// 3: the blossom LEANS — rows 4-5 lose their rightmost column while the left
// flank stays put, so the head tips off-axis instead of just recolouring, and
// the face plate and both pupils roll a column right with it. Both blades curl
// and settle low: the flower relaxes before the cycle starts over.
const FLOWER_3 = [
  '.....000000.....',
  '....03433220....',
  '..030433322010..',
  '.03433355552210.',
  '034333565565210.',
  '033333565565110.',
  '.03332255552110.',
  '..022222211110..',
  '...021111110....',
  '....0000000.....',
  '......0980......',
  '..00..0980..00..',
  '.0980.0980.0870.',
  '09870.098008770.',
  '.0770.0980.0770.',
  '..00..0000..00..',
];

const FLOWER_GEOM = [FLOWER_0, FLOWER_1, FLOWER_2, FLOWER_3];

const FLOWER_FACE = ['#ffffff', '#1a1008'];
// 62 / 89 units apart. At '#0f7a08' the mid sat 40 units off the dark and 128
// off the lit, so the stem and both leaves rendered as one merged dark green
// with a bright edge — two of the three slots were doing the same job.
const FLOWER_STEM = ['#14520a', '#2a8c10', '#63c832'];

const flowerPal = (d, m, l, s) => [
  OUT, d, m, l, s, FLOWER_FACE[0], FLOWER_FACE[1],
  FLOWER_STEM[0], FLOWER_STEM[1], FLOWER_STEM[2],
];

// The green step of the cycle is a LIME, not a leaf green: at '#1c6a10' the
// blossom sat 26 RGB units from the stem's own dark and the whole sprite fused
// into one green shape. This ramp holds 63 / 145 / 137 units of separation.
//
// The second step is a CRIMSON-orange rather than a wood orange: at '#7c3800'
// it sat three RGB units off LIFT_PAL's plank shadow, so a fire flower riding a
// moving platform fused with the plank it stood on. This ramp clears the plank
// by 45 units at its closest index.
const FLOWER_CYCLE = [
  flowerPal('#7c1000', '#c02010', '#ff5030', '#ffb0a0'),
  flowerPal('#9c1c00', '#e04c08', '#ff9c58', '#ffe0b8'),
  flowerPal('#6d5c00', '#bdac2c', '#e4e594', '#ffffff'),
  flowerPal('#4a7000', '#8cc410', '#d6f040', '#ffffcc'),
];

// Every frame carries its OWN geometry under the colour cycle, and the BLOSSOM
// deforms as well as the leaves: frame 1 contracts it a column on each flank,
// frame 2 raises the crown, frame 3 tips it right. The alpha mask therefore
// changes at the head between every adjacent pair, not only where the two leaf
// blocks sit — and the blades themselves swap between two different outlines.
export const FIRE_FLOWER = {
  idle: new Anim(
    FLOWER_CYCLE.map((p, i) => makeSprite(FLOWER_GEOM[i], p, { name: `flower#${i}` })),
    6
  ),
};

/* ------------------------------------------------------------------ *
 * TOOLBELT — the power-up that rises out of a question block like the
 * fire flower and puts Mario in work clothes.
 *   0 outline  1 leather dark  2 leather mid  3 leather lit
 *   4 brass dark  5 brass mid  6 brass lit
 *   7 steel dark  8 steel mid  9 steel lit
 *
 * The read has to survive 16x16 against a mushroom, a flower and a star,
 * so the sprite commits to ONE silhouette idea the others do not have: a
 * horizontal band with things hanging off it. The strap runs edge to edge
 * across rows 2-6 (nothing else in the item set is a full-width bar), the
 * buckle is deliberately TALLER than the strap so it breaks that bar top
 * and bottom instead of being a yellow dot inside it, and two tools hang
 * clear of it with sky between them — a screwdriver on the left, a hammer
 * on the right whose head is the widest mass below the belt.
 *
 * Four frames: the hanging tools swing a column as a rigid unit (they are
 * shifted from the handle down, not from the middle — a tool that bends at
 * the waist reads as a rendering fault, not as a swing) and a glint walks
 * the brass. The alpha mask therefore changes between every adjacent pair.
 * ------------------------------------------------------------------ */

// Leather is pushed a step lighter than real belt hide: at #4a2208 the strap
// carried no value against the underground black and the whole pickup went to
// a gold buckle floating over nothing. This ramp keeps 44 units off the brass
// mid at its closest index, so strap and buckle stay two materials.
const TOOL_PAL = [
  '#1a1008', '#5a2a0a', '#9c5620', '#d08a3c',
  '#6e4400', '#e0a41c', '#fbe07c',
  '#4e5670', '#8f9cb8', '#e0e8ff',
];

// 0 — at rest, glint on the upper left of the buckle ring.
const TOOLBELT_0 = [
  '.....000000.....',
  '.....066550.....',
  '0000006655000000',
  '3333306005033333',
  '2222206005022222',
  '1111106555011111',
  '0000005445000000',
  '.03300444400330.',
  '.03300000000330.',
  '.0880......0330.',
  '.0880......0330.',
  '.0880....0000000',
  '.0880....0999880',
  '.0880....0888870',
  '.0980....0887770',
  '.000.....0000000',
];

// 1 — both tools swung a column, whole: handle, shank and head together.
const TOOLBELT_1 = [
  '.....000000.....',
  '.....066650.....',
  '0000006555000000',
  '3333306005033333',
  '2222206005022222',
  '1111106555011111',
  '0000005445000000',
  '0330.044440330..',
  '0330.000000330..',
  '0880......0330..',
  '0880......0330..',
  '0880....0000000.',
  '0880....0999880.',
  '0880....0888870.',
  '0980....0887770.',
  '000.....0000000.',
];

// 2 — back at rest, the glint having crossed to the pin bar.
const TOOLBELT_2 = [
  '.....000000.....',
  '.....066550.....',
  '0000006555000000',
  '3333306005033333',
  '2222206005022222',
  '1111106556011111',
  '0000005445000000',
  '.03300444400330.',
  '.03300000000330.',
  '.0880......0330.',
  '.0880......0330.',
  '.0880....0000000',
  '.0880....0999880',
  '.0880....0888870',
  '.0980....0887770',
  '.000.....0000000',
];

// 3 — swung again, glint down on the tongue below the strap.
const TOOLBELT_3 = [
  '.....000000.....',
  '.....066550.....',
  '0000006555000000',
  '3333306005033333',
  '2222206005022222',
  '1111106555011111',
  '0000005445000000',
  '0330.045440330..',
  '0330.000000330..',
  '0880......0330..',
  '0880......0330..',
  '0880....0000000.',
  '0880....0999880.',
  '0880....0888870.',
  '0980....0887770.',
  '000.....0000000.',
];

export const TOOLBELT = {
  idle: new Anim(
    [TOOLBELT_0, TOOLBELT_1, TOOLBELT_2, TOOLBELT_3].map((r, i) =>
      makeSprite(r, TOOL_PAL, { name: `toolbelt#${i}` })),
    7
  ),
};

/* ------------------------------------------------------------------ *
 * STARMAN — 5-point star. SMB1's star has no boots and no whites of the
 * eyes: the pupils sit as bare 2x2 blocks directly on the body, which is the
 * only way they survive the silver step of the colour cycle.
 *   0 outline  1 dark  2 mid  3 lit  4 spec  5 occlusion  6 eye
 * ------------------------------------------------------------------ */

// A real five-pointed star needs three things to read at 1x: a top point that is
// NARROW for its whole length, a hard CONCAVE step where the arms leave that
// point, and legs thick enough to survive the outline. Rows 0-4 hold the top
// point at 2-4px of body; row 5 is solid outline out to both edges, so the arms
// arriving at row 6 read as a step and not as a flare; rows 11-13 splay the legs
// outward one column per row and never drop below 3 coloured pixels.
//
// Slot 5 is a deeper-than-dark occlusion for the two concave corners the light
// cannot reach: the notch under the top point's RIGHT flank (rows 6-7, cols
// 11-12 — the left one stays lit because the key light is upper-left) and the V
// where the two legs part.
//
// A: rest.
const STAR_ROWS_A = [
  '......0000......',
  '......0430......',
  '......0430......',
  '.....043320.....',
  '....04333220....',
  '..004333322200..',
  '.04333332225510.',
  '0443333322225110',
  '.04336622662110.',
  '..033662266210..',
  '..032222222110..',
  '..032500005110..',
  '.03220....02110.',
  '03220......02110',
  '.000........000.',
  '................',
];

// B: squash. The star drops a row at the top and loses one at the bottom, and
// the mass it sheds goes into the arms: they run THREE rows of full width
// instead of two, the eyes ride down with them, and the legs finish a row early
// and blunt. The point shortens while the arms thicken — no translation of A
// produces this.
const STAR_ROWS_B = [
  '................',
  '......0000......',
  '......0430......',
  '.....043320.....',
  '....04333220....',
  '..004333322200..',
  '.04333332225510.',
  '0443333322225110',
  '0443333222225110',
  '.04336622662110.',
  '..033662266210..',
  '..032222222110..',
  '..032500005110..',
  '.03220....02110.',
  '..000......000..',
  '................',
];

// C: stretch. The opposite extreme — the top point runs three rows of 2px body
// instead of two, both arms pull IN a full column at each end (12px of body
// against A's 14), and the legs run a row deeper, so the star is tall, narrow
// and reaching.
const STAR_ROWS_C = [
  '......0000......',
  '......0430......',
  '......0430......',
  '......0430......',
  '.....043320.....',
  '....04333220....',
  '...0433332220...',
  '..043333222510..',
  '.04433332222510.',
  '..043662266110..',
  '..033662266210..',
  '..032222222110..',
  '..032500005110..',
  '.03220....02110.',
  '03220......02110',
  '.000........000.',
];

const starPal = (d, m, l, s, o) => [OUT, d, m, l, s, o, '#101820'];

// Four steps that never collide with another material. The gold shadow is
// pushed down to '#5a3c00' so its closest approach to COIN_PAL is 41 RGB units
// instead of 8 — a star and a coin on the same screen have to be two objects.
// The third step is a COOL blue-silver, not neutral grey: '#8f8f8f' is the exact
// steel of both the springboard and the axe, and for four ticks the star was
// made of the same metal. Slots 3-4 sit 39 units apart so the specular reads.
const STAR_CYCLE = [
  starPal('#5a3c00', '#f0b800', '#ffe83c', '#fffce8', '#2e1c00'),
  starPal('#9f4a00', '#e07818', '#ef9a49', '#ffe0a8', '#5a2400'),
  starPal('#6e6e84', '#b0b0c8', '#e4e4f8', '#ffffff', '#343450'),
  starPal('#366d00', '#77b820', '#bdf03c', '#e8ffb0', '#1c3a00'),
];

// rest -> squash -> stretch -> squash under the colour cycle, 4-tick holds, so
// the star pulses at 7.5 Hz through three genuinely different silhouettes.
const STAR_GEOM = [STAR_ROWS_A, STAR_ROWS_B, STAR_ROWS_C, STAR_ROWS_B];

export const STARMAN = {
  idle: new Anim(
    STAR_CYCLE.map((p, i) => makeSprite(STAR_GEOM[i], p, { name: `starman#${i}` })),
    4
  ),
};

/* ------------------------------------------------------------------ *
 * COIN — 4-frame spin: face, three-quarter, edge, three-quarter back.
 * All four frames occupy the same fourteen rows, so the coin narrows through
 * the turn without changing height.
 *   0 outline  1 gold shadow  2 gold mid  3 gold lit  4 gold spec
 * ------------------------------------------------------------------ */

const COIN_PAL = [OUT, '#7a5600', '#c08c00', '#f8c800', '#fff4b0'];

// Struck face: an outer rim, a CLOSED 1px slot-1 annulus (row 4 and row 11
// across cols 6-9, cols 5 and 10 down rows 5-10) and a solid slot-3 relief
// inside it. Not one interior pixel is isolated — the old checkerboard of
// alternating 1/3/4 read as chips and dents at 12x. The only specular is the
// 2x1 run at row 3 cols 5-6 plus its row-2 cap.
const COIN_FACE = [
  '................',
  '......0000......',
  '.....044320.....',
  '....04433220....',
  '....03111120....',
  '...0313333120...',
  '...0313333120...',
  '...0213333110...',
  '...0213333110...',
  '...0213333110...',
  '...0213333110...',
  '....02111110....',
  '....02211110....',
  '.....022110.....',
  '......0000......',
  '................',
];

const COIN_THREE = [
  '................',
  '......0000......',
  '.....043310.....',
  '....04333210....',
  '....04333210....',
  '....04331210....',
  '....04331210....',
  '....03331210....',
  '....03331210....',
  '....03331210....',
  '....02221110....',
  '....02221110....',
  '.....022110.....',
  '.....011110.....',
  '......0000......',
  '................',
];

// Edge on. Three columns of gold, not two: at 2px the sprite spent half its
// footprint on outline and read as a black tick mark. It also occupies exactly
// the same fourteen rows as the other three frames (y1..y14) — the old edge
// frame was sixteen rows tall, so the coin GREW by two pixels at the thinnest
// point of the spin and popped on a three-tick hold.
const COIN_EDGE = [
  '................',
  '......000.......',
  '.....04430......',
  '.....04430......',
  '.....04330......',
  '.....04330......',
  '.....04310......',
  '.....04310......',
  '.....03210......',
  '.....03210......',
  '.....03210......',
  '.....01110......',
  '.....01110......',
  '.....01110......',
  '......000.......',
  '................',
];

// Coming out of the edge frame the coin shows its BACK: the rim's thickness is
// visible as a lit slot-4 band on col 5, separated from the flat back plate by
// a slot-1 seam on col 6. Authored, not a flip — the left outline is a straight
// col 4 for the whole of rows 3-11 and the plate is the same 8px width, centred
// on x=7.5 exactly like coin.three, so the coin cannot wobble as the spin
// loops; and the ramp still runs bright-to-dark left-to-right, so the key light
// never leaves the upper-left.
const COIN_BACK = [
  '................',
  '......0000......',
  '.....043210.....',
  '....04132210....',
  '....04132210....',
  '....04132210....',
  '....04132210....',
  '....04132210....',
  '....03122110....',
  '....03122110....',
  '....03122110....',
  '....02122110....',
  '.....012210.....',
  '.....011110.....',
  '......0000......',
  '................',
];

export const COIN = {
  spin: new Anim(
    [
      makeSprite(COIN_FACE, COIN_PAL, { name: 'coin.face' }),
      makeSprite(COIN_THREE, COIN_PAL, { name: 'coin.three' }),
      makeSprite(COIN_EDGE, COIN_PAL, { name: 'coin.edge' }),
      makeSprite(COIN_BACK, COIN_PAL, { name: 'coin.back' }),
    ],
    [7, 4, 3, 4]
  ),
};

export const COIN_HUD = {
  idle: makeSprite(
    [
      '...00...',
      '..0430..',
      '.043320.',
      '.031320.',
      '.031320.',
      '.012210.',
      '..0110..',
      '...00...',
    ],
    COIN_PAL,
    { name: 'coin.hud' }
  ),
};

/* ------------------------------------------------------------------ *
 * FIREBALL — white-hot core orbiting inside a burning shell.
 *   0 outline  1 ember  2 red  3 orange  4 yellow  5 white-hot
 * ------------------------------------------------------------------ */

const FIRE_PAL = [
  OUT, '#8c1800', '#e04010', '#ff8020', '#ffd040', '#ffffff',
];

// Four AUTHORED frames, no flips and no translations. The white-hot core orbits
// UL -> UR -> LR -> LL while the shell's yellow specular (slot 4) stays pinned
// to the upper-left in every frame, so the key light never strobes side to
// side — and the SHELL ITSELF deforms through the cycle: round, squashed flat,
// stretched tall and narrow, then a leaning teardrop. The ball tumbles instead
// of being a static bead with a moving decal.
const FB_A = [
  '..0000..',
  '.045530.',
  '04553210',
  '04553220',
  '03332210',
  '03222110',
  '.021110.',
  '..0000..',
];

// Squashed: eight wide but only six rows tall. Core has swung to the upper
// right, ringed in orange — the only yellow stays on the upper-left shoulder.
const FB_B = [
  '........',
  '.000000.',
  '04433350',
  '04333550',
  '03222330',
  '.021110.',
  '..0000..',
  '........',
];

// Stretched: six columns wide and the full eight rows tall; core low-right.
const FB_C = [
  '..0000..',
  '.043210.',
  '.043210.',
  '.033220.',
  '.032550.',
  '.032550.',
  '.022110.',
  '..0000..',
];

// Leaning teardrop — the mass has slumped to the lower left with the core, and
// the crown has narrowed to three pixels.
const FB_D = [
  '...000..',
  '..04320.',
  '.043210.',
  '04432210',
  '03553210',
  '03553110',
  '.033110.',
  '..0000..',
];

// The flash cools through the WHOLE ramp: white core, yellow, orange, red,
// then an ember (slot 1) perimeter inside the outline rather than jumping
// straight from orange to black.
const BURST_FLASH = [
  '................',
  '................',
  '................',
  '................',
  '.....013310.....',
  '....01344310....',
  '...0134554310...',
  '...0145555410...',
  '...0134454310...',
  '...0133343310...',
  '....01333210....',
  '.....012210.....',
  '................',
  '................',
  '................',
  '................',
];

const BURST_RING = [
  '................',
  '................',
  '......0110......',
  '....01233210....',
  '...0134224310...',
  '..0134....4310..',
  '..0145....5410..',
  '..0145....5410..',
  '..0145....5410..',
  '..0134....4310..',
  '...0134224310...',
  '....01233210....',
  '......0110......',
  '................',
  '................',
  '................',
];

// Eight comets thrown out of the centre. Each one runs white head -> orange ->
// red -> ember tail pointing back at the origin, and the four diagonals are
// drawn pointing OUTWARD on both sides instead of being copied unmirrored.
// No tail ends on slot 0: FIRE_PAL's slot 0 is the black outline, and a tail
// finishing on it punched two holes in the sky with no silhouette attached, so
// both horizontal comets bottom out on the ember instead.
const BURST_SPARKS = [
  '.......55.......',
  '.53....44....35.',
  '..32...33...23..',
  '...21......12...',
  '................',
  '................',
  '................',
  '531..........135',
  '421..........124',
  '................',
  '................',
  '................',
  '...12......21...',
  '..23...22...32..',
  '.35....33....53.',
  '.......55.......',
];

export const FIREBALL = {
  spin: new Anim(
    [FB_A, FB_B, FB_C, FB_D].map((r, i) => makeSprite(r, FIRE_PAL, { name: `fireball#${i}` })),
    4
  ),
  burst: new Anim(
    [BURST_FLASH, BURST_RING, BURST_SPARKS].map((r, i) =>
      makeSprite(r, FIRE_PAL, { name: `fbBurst#${i}` })
    ),
    [3, 4, 5],
    false
  ),
};

/* ------------------------------------------------------------------ *
 * SCORE POPUPS — 3x5 numerals on a 5px pitch, with ONE offset drop shadow
 * down-right, exactly as SMB1 does it. A full 8-neighbour dilation ringed every
 * glyph and, at the old 4px pitch, welded the 1px gutters shut: SCORES.100 came
 * out a solid 13x7 slab that was 64% pure black. It is 45% now, the gutters
 * survive, and the ink reads as ink.
 *   0 shadow  1 top face  2 mid  3 bottom edge  4 specular
 * ------------------------------------------------------------------ */

const SCORE_GLYPHS = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['.1.', '11.', '.1.', '.1.', '111'],
  '2': ['111', '..1', '111', '1..', '111'],
  '4': ['101', '101', '111', '..1', '..1'],
  '5': ['111', '1..', '111', '..1', '111'],
  '8': ['111', '101', '111', '101', '111'],
  U: ['101', '101', '101', '101', '111'],
  P: ['111', '101', '111', '1..', '1..'],
};

// Five slots with real distance between them — 78 / 109 down the body ramp and
// 74 from the top face to the specular, so the highlight actually reads instead
// of sitting 21 units off the tone beneath it and doing nothing.
//   0 shadow  1 top face  2 mid  3 bottom edge  4 specular
const SCORE_PAL = [OUT, '#c8d2e8', '#98a4c0', '#5a6480', '#ffffff'];

// Every glyph is shaded top-lit — rows 0-1 top face, rows 2-3 mid, row 4
// bottom edge — and the top-left lit pixel of each glyph carries the
// specular, so the numerals have a real ramp rather than a detached pale foot.
const SCORE_RAMP = ['1', '1', '2', '2', '3'];

function scoreSprite(text) {
  const glyphs = [...text].map((c) => {
    const g = SCORE_GLYPHS[c];
    if (!g) throw new Error(`items: no score glyph for ${JSON.stringify(c)}`);
    return g;
  });
  // 5px pitch for 3px glyphs: a 2px gutter, so the drop shadow can never weld
  // two digits together into one black brick.
  const w = glyphs.length * 5 + 1;
  const h = 9;
  const grid = [];
  for (let y = 0; y < h; y++) grid.push(new Array(w).fill('.'));

  glyphs.forEach((g, gi) => {
    const gx = gi * 5 + 1;
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 3; x++) {
        if (g[y][x] === '1') grid[y + 2][gx + x] = SCORE_RAMP[y];
      }
    }
    let placed = false;
    for (let y = 0; y < 5 && !placed; y++) {
      for (let x = 0; x < 3 && !placed; x++) {
        if (g[y][x] === '1') {
          grid[y + 2][gx + x] = '4';
          placed = true;
        }
      }
    }
  });

  // SMB1's popups are bare white numerals. A full 8-neighbour dilation ringed
  // every glyph and welded the digits together — 64% of the sprite came out
  // pure black. One offset shadow down-right is all the legibility the numerals
  // need over both sky and black, and it leaves the ink reading as ink.
  const lit = grid.map((r) => r.slice());
  for (let y = h - 1; y > 0; y--) {
    for (let x = w - 1; x > 0; x--) {
      if (grid[y][x] === '.' && lit[y - 1][x - 1] !== '.') grid[y][x] = '0';
    }
  }
  return makeSprite(grid.map((r) => r.join('')), SCORE_PAL, { name: `score.${text}` });
}

export const SCORES = {
  100: scoreSprite('100'),
  200: scoreSprite('200'),
  400: scoreSprite('400'),
  500: scoreSprite('500'),
  800: scoreSprite('800'),
  1000: scoreSprite('1000'),
  2000: scoreSprite('2000'),
  4000: scoreSprite('4000'),
  5000: scoreSprite('5000'),
  8000: scoreSprite('8000'),
  '1UP': scoreSprite('1UP'),
};

/* ------------------------------------------------------------------ *
 * SPRINGBOARD — 3 compression states. The coil count is constant (8
 * turns); only the pitch changes.
 *
 * All three frames are 16x32 with the base plate pinned to row 31 and the
 * slack padded in as transparent rows at the TOP, so a caller drawing
 * frames[n] at a fixed y sees the plate press DOWN under Mario instead of
 * the whole spring shrinking upward off the ground. One plate width (16)
 * across all three states, so nothing jumps wider on compression.
 *   0 outline  1 steel dark  2 steel mid  3 steel lit  4 steel spec
 *   5 coil dark  6 coil mid  7 coil lit  8 coil spec  9 coil far side
 * ------------------------------------------------------------------ */

const SPRING_PAL = [
  OUT, '#4e4e4e', '#8f8f8f', '#d0d0d8', '#ffffff',
  '#5a1a00', '#bd3c30', '#ef6a40', '#ff8b7f', '#7a2000',
];

// A coil spring seen from the side is a ZIGZAG, not a stack of rungs. Each
// turn is one continuous wire: it crosses the front from the upper left down to
// the right (two half-rows, the right half sitting one row lower than the left,
// joined at col 7-8), then passes BEHIND and travels back leftward while still
// descending — that return sweep is the only thing visible through the gap, and
// it is painted in the far-side tone so it reads as depth. Nothing rules a
// horizontal bar across the full width and nothing paints a solid column down
// either flank, which is what made the old drawing read as a ladder in a box.
//
// The wire ramps 8-7-7-6-6-5 along its own length, so the specular sits on the
// left of every crossing and the light never leaves the upper-left.
//
// One authored cross-section for the wire, placed by column. Turn 0 is tucked
// under the top plate and turn 7 under the base, so both are INSET a column and
// the barrel visibly narrows at its ends instead of running as a parallel-sided
// grille; and the key light falls off down the stack, one ramp step at turn 3
// and another at turn 6, so the bottom of the spring sits in its own shadow.
// Eight turns, eight different rows — none of it is a stamp.
// Three authored steps per ramp rather than an arithmetic dim — the coil only
// owns four tones, so a mechanical shift collapses the bottom turns to one flat
// colour. Each step here still carries lit / mid / dark.
const SP_WIRE = ['08776650', '07766550', '07665550'];
const SP_TIGHT = ['0877665550', '0776655550', '0766555550'];
const SP_FLAT = ['087776665550', '077766655550', '076665555550'];
const SP_FLAT_END = ['0877665550', '0776655550', '0766555550'];
const SP_BACK = '0999999990';
const SP_BACK_END = '09999990';

const SP_INSET = [1, 0, 0, 0, 0, 0, 0, 1];
const SP_FALL = [0, 0, 0, 1, 1, 1, 2, 2];

const SP_ROW = (ramp, x, stub, sx) => {
  const r = new Array(16).fill('.');
  if (stub) for (let i = 0; i < stub.length; i++) r[sx + i] = stub[i];
  for (let i = 0; i < ramp.length; i++) r[x + i] = ramp[i];
  return r.join('');
};

// Half compressed: the return sweep has no clear row left, so each front-wire
// run widens to 10px and OVERLAPS its neighbour by four columns — the eye reads
// one continuous wire stepping down instead of two stacks of rungs — and the
// far side shows as a 3px stub in the sky the run vacates.
//
// Fully compressed the turns touch. Each row is then one whole turn seen
// edge-on: a 12px wire that shifts two columns between turns, with the far side
// of the previous turn showing as a 2px stub in the space it vacates. The end
// turns run two columns SHORTER, so the stack still reads as a barrel.

// One plate width for every state. Row 0 of the top plate is steel dark, not
// pure outline, so Mario's feet land on metal rather than on a black bar, and
// row 1 steps 4-3-2-1 in runs of no more than three so the lit edge reads as
// bent metal instead of a white sticker glued to a grey bar.
const SP_TOP = ['0111111111111110', '0443332222111110', '0222221111111110', '0000000000000000'];
const SP_BOT = ['0000000000000000', '0333322222111110', '0222111111111110', '0000000000000000'];

// Eight turns in every state — only the pitch changes, so the spring
// genuinely compresses instead of losing coils.
function coil(pitch) {
  const rows = [];
  for (let t = 0; t < 8; t++) {
    const i = SP_INSET[t];
    const d = SP_FALL[t];
    if (pitch === 1) {
      const w = (i ? SP_FLAT_END : SP_FLAT)[d];
      rows.push(
        t & 1 ? SP_ROW(w, 15 - w.length - i, '99', 1 + i) : SP_ROW(w, 1 + i, '99', 13 - i)
      );
      continue;
    }
    if (pitch >= 3) {
      rows.push(SP_ROW(SP_WIRE[d], 1 + i));
      rows.push(SP_ROW(SP_WIRE[d], 7 - i));
      rows.push(i ? SP_ROW(SP_BACK_END, 4) : SP_ROW(SP_BACK, 3));
      continue;
    }
    rows.push(SP_ROW(SP_TIGHT[d], 1 + i, '999', 12 - i));
    rows.push(SP_ROW(SP_TIGHT[d], 5 - i, '999', 1 + i));
  }
  return rows;
}

const SP_BLANK = '................';
const spring = (pitch) => {
  const body = [...SP_TOP, ...coil(pitch), ...SP_BOT];
  return [...Array(32 - body.length).fill(SP_BLANK), ...body];
};

export const SPRINGBOARD = {
  frames: [
    makeSprite(spring(3), SPRING_PAL, { name: 'spring.free' }),
    makeSprite(spring(2), SPRING_PAL, { name: 'spring.mid' }),
    makeSprite(spring(1), SPRING_PAL, { name: 'spring.low' }),
  ],
};

/* ------------------------------------------------------------------ *
 * CASTLE AXE — 3-frame specular sweep across the steel.
 *   0 outline  1 steel dark  2 steel mid  3 steel lit  4 steel spec
 *   5 haft dark  6 haft mid  7 haft lit
 * ------------------------------------------------------------------ */

// The haft's darkest tone stays well clear of black — the axe only ever
// appears against the castle's black sky.
const AXE_PAL = [
  OUT, '#4e4e4e', '#8f8f8f', '#d0d0d8', '#ffffff',
  '#5f3a12', '#8a5a20', '#c08a44',
];

// The head is a HATCHET, not a dart: the bit — the cutting edge — is the tall
// arc at the far end from the handle (a straight-ish 8px edge at col 1, rounded
// off at cols 2-4), and the head tapers rightward to a 2px poll at col 10 where
// the haft passes through. The previous drawing had this backwards, tapering to
// a point at the left, which read as an arrowhead.
//
// Three poses, and the pose is in the SILHOUETTE. The head shears about its
// poll: cols 1-5 sit one row high in frame 0, level in frame 1 and one row low
// in frame 2, while cols 6-10 and the whole haft stay pinned. The specular band
// travels down the bevel with the rock, and on the bottom of the swing the haft
// bends a pixel right so the axe visibly wobbles on its pedestal.
// The haft is a CYLINDER, three tones wide the whole way down — '07650', lit /
// mid / dark left to right under the upper-left key. It used to run '06550', a
// two-tone ruled bar that left slot 7 painting one pixel in the entire sprite,
// and it necked from three pixels of wood at the bottom to one where it passed
// behind the head, which no pole does.
const AXE_UP = [
  '..0000..........',
  '.044430.........',
  '.044330.........',
  '.04333300.......',
  '.0333333207650..',
  '.0333222207650..',
  '.0333222107650..',
  '.0332221007650..',
  '.0322200007650..',
  '..0000...07650..',
  '.........07650..',
  '.........07650..',
  '.........07650..',
  '.........07650..',
  '.........07650..',
  '.........00000..',
];

// The specular MOVES down the bevel with the head instead of switching off:
// slot 4 holds six pixels in this pose, five or six in every other, so the
// steel catches the light continuously rather than flashing once per cycle.
const AXE_LEVEL = [
  '................',
  '..0000..........',
  '.033330.........',
  '.04433300.......',
  '.0344422207650..',
  '.0334422207650..',
  '.0332222107650..',
  '.0322221107650..',
  '.0222220007650..',
  '.022220..07650..',
  '..0000...07650..',
  '.........07650..',
  '.........07650..',
  '.........07650..',
  '.........07650..',
  '.........00000..',
];

const AXE_DOWN = [
  '................',
  '................',
  '..0000..........',
  '.033330.........',
  '.0343330007650..',
  '.0344422107650..',
  '.0334421107650..',
  '.0322211007650..',
  '.0222210007650..',
  '.0222100007650..',
  '.022210..07650..',
  '..0000...07650..',
  '.........07650..',
  '.........07650..',
  '.........07650..',
  '.........00000..',
];

// The fourth pose is DRAWN, not the level pose played twice. Coming back up the
// head leads with its bit: the cutting edge reaches a row higher than in the
// level pose while the poll is still low, so cols 1-7 carry a different
// outline from any other frame and the axe reads as rocking rather than as a
// three-drawing cycle with one of them shown twice.
const AXE_RISE = [
  '................',
  '.00000..........',
  '.0444330........',
  '.0433330........',
  '.0333333007650..',
  '.0334422207650..',
  '.0333222107650..',
  '.0322211007650..',
  '.0222100007650..',
  '..00000..07650..',
  '.........07650..',
  '.........07650..',
  '.........07650..',
  '.........07650..',
  '.........07650..',
  '.........00000..',
];

// Rocking, not sawtoothing: up, level, down, rise. Four poses, four drawings.
const AXE_FRAMES = [AXE_UP, AXE_LEVEL, AXE_DOWN, AXE_RISE];

export const AXE = {
  idle: new Anim(
    AXE_FRAMES.map((r, i) => makeSprite(r, AXE_PAL, { name: `axe#${i}` })),
    5
  ),
};

/* ------------------------------------------------------------------ *
 * VINE — repeating body segment plus a growing tip with a curled bud.
 *   0 outline  1 stalk dark  2 stalk shade  3 stalk mid  4 stalk lit
 *   5 leaf dark  6 leaf mid  7 leaf lit
 * ------------------------------------------------------------------ */

// Two ramps, deliberately far apart: the stalk is a deep blue-green (slots
// 1-4, stepping 56 / 57 / 77 instead of the old 47 / 39 / 73 — at 39 units the
// two middle greens read as one flat tone at 1x) and the leaves a lighter
// yellow-green (slots 5-7). Measured at matching ramp indices the two ramps sit
// 54 / 83 / 91 apart, so a stacked vine reads as stalk-plus-foliage rather than
// one green blob, and the stalk clears the 1-Up mushroom's cap by 40.
const VINE_PAL = [
  OUT, '#0a4a10', '#17801a', '#33b028', '#6ce040',
  '#4a7c08', '#84c020', '#c4e858', '#b8f878',
];

// The stalk is not one cross-section extruded: it SWELLS to six body pixels at
// the internode (rows 3-4), carries a knuckle at row 7, and turns away from the
// light at rows 10-11 where the lit slot 4 drops out of the section entirely
// and it reads 8-3-3-2-1. It also jogs a pixel right at rows 6-8 and left at
// rows 13-14. Row 15 returns to the row-0 columns, so stacked segments tile
// without the 1px sawtooth that used to repeat at every 16px seam forever.
// Both leaf clusters run lit-to-dark from their attachment outward with the
// light held upper-left.
const VINE_BODY_A = [
  '.....0843210....',
  '...000843210....',
  '..0760843210....',
  '.076608443210...',
  '0766508443210...',
  '.05550843210....',
  '.0000.0843210...',
  '......08443210..',
  '......0843210...',
  '.....0843210000.',
  '.....08332107660',
  '.....08332106550',
  '.....0843210000.',
  '....0843210.....',
  '....0843210.....',
  '.....0843210....',
];

// Sway frame, authored at the SAME vertical position — no array rotation, so a
// stacked vine bends instead of running like a conveyor belt. The stalk takes
// its jog the other way (left at rows 2-7, right at rows 12-15), the knuckle
// travels from row 7 to row 14, the left leaf cluster rides two rows DOWN and
// the right cluster one row UP, so the whole segment torques. The '8' highlight
// stays on the stalk's left edge in both frames.
const VINE_BODY_B = [
  '.....0843210....',
  '.....0843210....',
  '....08443210....',
  '..0008443210....',
  '.07608443210....',
  '076608443210....',
  '.0550843210.....',
  '.0000843210.....',
  '.....0843210000.',
  '.....08332107660',
  '.....08332106550',
  '.....0843210000.',
  '......0843210...',
  '......0843210...',
  '......08443210..',
  '.....0843210....',
];

// The tip carries ONE small curled bud on the left (cols 2-4, rows 10-12) —
// three rows, its own 7/6/5 curl — and no copy of the body's leaf clusters.
const VINE_TIP_A = [
  '........000.....',
  '.......08410....',
  '......084310....',
  '.....08443210...',
  '....0844332110..',
  '...08443322110..',
  '...0843322110...',
  '....08332110....',
  '.....0843210....',
  '...000843210....',
  '..0770843210....',
  '..0660843210....',
  '..0550843210....',
  '...000843210....',
  '.....08432110...',
  '.....0843210....',
];

// The shoot WHIPS rather than slides: rows 6-7 are byte-identical to frame A
// (the shoot is anchored where it leaves the stalk), rows 4-5 swing one column
// left and rows 0-3 swing two, so the tip describes an arc. The bud does not
// change colour — it OPENS, its curl growing from two columns to three.
const VINE_TIP_B = [
  '......000.......',
  '.....08410......',
  '....084310......',
  '...08443210.....',
  '...0844332110...',
  '..08443322110...',
  '...0843322110...',
  '....08332110....',
  '.....0843210....',
  '..0000843210....',
  '.07770843210....',
  '.06660843210....',
  '.05550843210....',
  '..0000843210....',
  '.....08432110...',
  '.....0843210....',
];

export const VINE = {
  tip: new Anim(
    [VINE_TIP_A, VINE_TIP_B].map((r, i) => makeSprite(r, VINE_PAL, { name: `vine.tip#${i}` })),
    12
  ),
  body: new Anim(
    [VINE_BODY_A, VINE_BODY_B].map((r, i) => makeSprite(r, VINE_PAL, { name: `vine.body#${i}` })),
    12
  ),
};

/* ------------------------------------------------------------------ *
 * LIFT — 48x8 riveted plank. Three plank sections, seams at the joins,
 * one rivet per section catching the upper-left light.
 *   0 outline  1 dark  2 mid  3 lit  4 spec  5 rivet shadow  6 rivet spec
 * ------------------------------------------------------------------ */

const LIFT_PAL = [
  OUT, '#7a3a00', '#b06000', '#e08c30', '#ffc880', '#3a1c08', '#f0a860',
];

// The rope gets its own hemp ramp rather than borrowing the plank's oranges —
// a cord the same hue as the platform it suspends disappears against it.
// '#a08a58' sits 99 RGB units off the plank's '#b06000' at the same ramp index.
const ROPE_PAL = [OUT, '#6b5a3a', '#a08a58', '#d8c894'];

const SEAM = '51';

// Rivets sit at index 5 of every 14-char section, i.e. absolute x = 6, 22, 38:
// 16px apart with a matching 6px margin at each end, so the run reads as a
// deliberate row instead of drifting right. Each stud is a 3px dome — the
// plank's own specular on its upper-left pixel over a warm dome tone — sitting
// on a 2px contact shadow. Pure white studs read as stickers on a background
// prop, so no tone here is brighter than the plank's own highlight. All three
// studs read 4,6,6 left-to-right with the specular on the upper-LEFT pixel and
// the contact shadow deepening 1,5,5 to the lower right — the middle stud used
// to be lit from the opposite side to its two neighbours on the same plank.
// Row 0 is the plank's own dark tone rather than solid outline: Mario lands on
// wood, not on a black bar.
const LIFT_ROWS = [
  '0' + '1'.repeat(46) + '0',
  '0' + '34444444444444' + SEAM + '44444444444444' + SEAM + '44444444444443' + '0',
  '0' + '23333333333333' + SEAM + '33333333333333' + SEAM + '33333333333332' + '0',
  '0' + '23333466333333' + SEAM + '33333466333333' + SEAM + '33333466333332' + '0',
  '0' + '22222155222222' + SEAM + '22222155222222' + SEAM + '22222155222222' + '0',
  '0' + '12222222222222' + SEAM + '22222222222222' + SEAM + '22222222222221' + '0',
  '0' + '11111111111111' + SEAM + '11111111111111' + SEAM + '11111111111111' + '0',
  '0000000000000000' + '0000000000000000' + '0000000000000000',
];

// Balance-lift hardware for the '@' anchors in 1-3 / 4-3. The cord carries its
// outline on the LEFT edge only, so all three remaining columns are hemp and
// the twist has somewhere to happen: the lit strand walks col 1 -> 2 -> 3 -> 2
// every four rows, which at 1x reads as a braided cord instead of a ruled line.
const LIFT_ROPE_TWIST = ['0321', '0232', '0123', '0232'];
const LIFT_ROPE = [
  ...LIFT_ROPE_TWIST, ...LIFT_ROPE_TWIST, ...LIFT_ROPE_TWIST, ...LIFT_ROPE_TWIST,
];

const LIFT_PULLEY = [
  '..0000..',
  '.044320.',
  '04432210',
  '04355210',
  '03255210',
  '03222110',
  '.021110.',
  '..0000..',
];

export const LIFT = {
  platform: makeSprite(LIFT_ROWS, LIFT_PAL, { name: 'lift.platform' }),
  // Trimmed slices of the plank ramp — the rope needs no rivet tones and the
  // pulley no rivet specular, so neither ships a slot it never paints.
  rope: makeSprite(LIFT_ROPE, ROPE_PAL, { name: 'lift.rope' }),
  pulley: makeSprite(LIFT_PULLEY, LIFT_PAL.slice(0, 6), { name: 'lift.pulley' }),
};

/* ------------------------------------------------------------------ *
 * BRICK DEBRIS — one chunk tumbling. The silhouette changes every
 * frame; the light stays pinned to the upper-left.
 *   0 outline  1 dark  2 mid  3 lit  4 spec
 * ------------------------------------------------------------------ */

const DEBRIS_PAL = [OUT, '#5a1a00', '#9f4a00', '#c86818', '#ef9a49'];

const DEBRIS_FRAMES = [
  [
    '0000000.',
    '04443320',
    '04433210',
    '.0433210',
    '..043210',
    '...04310',
    '....0410',
    '.....000',
  ],
  [
    '.000000.',
    '04433210',
    '04332210',
    '0433210.',
    '.033210.',
    '.03210..',
    '..0210..',
    '..000...',
  ],
  [
    '........',
    '.000000.',
    '04443320',
    '04433210',
    '03332210',
    '.0322110',
    '..00000.',
    '........',
  ],
  [
    '..000...',
    '.04430..',
    '.044320.',
    '.043210.',
    '.033210.',
    '.032110.',
    '.021110.',
    '..0000..',
  ],
];

export const DEBRIS = {
  tumble: new Anim(
    DEBRIS_FRAMES.map((r, i) => makeSprite(r, DEBRIS_PAL, { name: `debris#${i}` })),
    4
  ),
};

/* ------------------------------------------------------------------ *
 * BUBBLE — a HOLLOW film, not a disc. Everything inside the meniscus is
 * transparent so the water behind actually shows through; the only solid
 * pixels are the 1px rim and the specular where the light catches the film.
 * Three frames wobble the rim as it rises.
 *   0 outline  1 film shadow  2 rim shade  3 rim lit  4 spec
 * ------------------------------------------------------------------ */

// A bubble has no black in it. Slot 0 here is a deep cold blue, NOT the global
// OUT: at 8x8 the ring is 20 pixels against 16 of film, so a near-black outline
// made the sprite read as a dark donut on the water rather than as a bright
// film — the opposite of SMB1's unoutlined bubbles.
const BUBBLE_PAL = ['#0c1c3a', '#1c3a7a', '#4a86d8', '#a8d4ff', '#ffffff'];

// Everything inside the meniscus is transparent, so the water behind actually
// shows through; the only solid pixels are a UNIFORM 1px rim and one specular
// pixel where the light catches the film. The rim is promoted to slot 3 on the
// upper-left quadrant and falls to slot 1 on the lower right, so a hollow ring
// still carries a light direction.
const BUBBLE_A = [
  '..0000..',
  '.043320.',
  '03....20',
  '03....20',
  '02....10',
  '02....10',
  '.021110.',
  '..0000..',
];

// Pinched: the film pulls in two columns at rows 2-3, so the crown narrows
// while the belly stays wide.
const BUBBLE_B = [
  '..0000..',
  '.043320.',
  '.03..20.',
  '.03..20.',
  '02....10',
  '02....10',
  '.021110.',
  '..0000..',
];

// Stretched: the crown pulls into a 2px cap and the specular rides to the top
// of the film, the way a bubble draws into a teardrop as it rises.
const BUBBLE_C = [
  '...00...',
  '..0430..',
  '.03..20.',
  '03....20',
  '03....10',
  '02....10',
  '.021110.',
  '..0000..',
];

export const BUBBLE = {
  idle: new Anim(
    [BUBBLE_A, BUBBLE_B, BUBBLE_C].map((r, i) =>
      makeSprite(r, BUBBLE_PAL, { name: `bubble#${i}` })
    ),
    8
  ),
};

/* ------------------------------------------------------------------ *
 * FIREWORK — 8-spoke burst that expands then breaks apart.
 *   0 unused outline  1 ember  2 red  3 orange  4 yellow  5 white
 * ------------------------------------------------------------------ */

// A firework is additive light — it has no black outline. Slot 0 is therefore
// the coolest ember, not OUT. It is deliberately NOT a near-black maroon: every
// tone here has to survive being drawn over '#5c94fc' sky without punching a
// hole in it, so the ramp bottoms out at a deep red that still reads as fire.
//   0 deep ember  1 ember  2 red  3 orange  4 yellow  5 white-hot
const FW_PAL = ['#7a1400', '#c02808', '#e85818', '#ff8020', '#ffd040', '#ffffff'];

// A: detonation. White-hot flash, eight short 4px flares reaching radius 4.
// The diagonals are not lit yet — they carry the unburnt shell fragments, a
// dark chip wedged in the notch BETWEEN two flares (never on open sky) with an
// ember and then an orange pixel outboard of it. Those fragments are what
// ignites into the eight comets of frame B.
const FW_A = [
  '................',
  '................',
  '................',
  '.......22.......',
  '....3..33..3....',
  '.....1.44.1.....',
  '......0440......',
  '...2344554432...',
  '...2344554432...',
  '......0440......',
  '.....1.44.1.....',
  '....3..33..3....',
  '.......22.......',
  '................',
  '................',
  '................',
];

// B: expansion. Every arm has reached radius 6 — one and a half times frame A —
// and the flash has cooled from white to yellow. Each arm is now a comet: the
// trail cools 3 -> 2 -> 1 -> 0 walking OUT from the dying flash, then the star
// itself blazes yellow-to-white at the tip. The hottest pixel of every arm is
// its outermost one, so nothing reads as a dark speck against sky.
const FW_B = [
  '................',
  '.5.....55.....5.',
  '..4....44....4..',
  '...0...00...0...',
  '....1..11..1....',
  '.....2.22.2.....',
  '......3333......',
  '.54012344321045.',
  '.54012344321045.',
  '......3333......',
  '.....2.22.2.....',
  '....1..11..1....',
  '...0...00...0...',
  '..4....44....4..',
  '.5.....55.....5.',
  '................',
];

// C: dissipation. The flash is gone — all that is left of it is a 2x2 chip of
// deep ember smoke at the centre — and every comet has translated one further
// step out (radius 3..7, heads on the cell edge) while the whole burst SAGS:
// the three upper comets have fallen three rows and the two horizontal ones
// two, so the pattern is no longer symmetric about row 7. Each trail now runs
// monotonically 1 -> 5 outward, a clean fading streak with its hottest pixel at
// the leading edge.
const FW_C = [
  '................',
  '................',
  '................',
  '5......55......5',
  '.4.....44.....4.',
  '..3....33....3..',
  '...2...22...2...',
  '....1..11..1....',
  '................',
  '54321..00..12345',
  '54321..00..12345',
  '....1..11..1....',
  '...2...22...2...',
  '..3....33....3..',
  '.4.....44.....4.',
  '5......55......5',
];

export const FIREWORK = {
  burst: new Anim(
    [FW_A, FW_B, FW_C].map((r, i) => makeSprite(r, FW_PAL, { name: `firework#${i}` })),
    [4, 6, 6],
    false
  ),
};

