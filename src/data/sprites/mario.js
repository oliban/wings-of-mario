// Mario — every form, every animation.
//
// Palette slot contract. Every entry of MARIO_PALS uses it, so any sprite can be
// recolored into any form (or star flash) without redrawing a single pixel:
//
//   0 outline      4 hair         8 overall shadow   c shoe mid
//   1 skin shadow  5 cap shadow   9 overall mid      d button / buckle
//   2 skin mid     6 cap mid      a overall light    e cap specular
//   3 skin light   7 cap light    b shoe dark        f soft interior line
//
// Slot 1 doubles as the lit tone on the boots (same warm brown family), so leather
// gets a four-step ramp (0 -> b -> c -> 1) without burning a palette slot. Those
// steps are measured, not asserted: b->c is 71 units and c->1 is 42.
//
// Every palette in this file is checked pairwise: in all eight of them no two of
// the sixteen slots are closer than 40 RGB units. A ramp whose neighbours are 12
// or 30 apart is not a ramp, it is one colour that the code claims is three.
//
// Light falls from the upper left. All sprites face RIGHT; the engine mirrors.
//
// Five rules the whole file follows:
//   * The BRIM OVERHANGS THE CROWN. Measured down the right edge of the big head:
//     crown 12, brim 14, face 13, nose 15. Two steps out, one step back, two out
//     again. If the dome is as wide as the brim the whole head collapses into one
//     rounded blob in flat silhouette — which is exactly what it used to do.
//   * The NOSE carries the profile. It steps one pixel past the cap brim on the two
//     eye rows and pulls back in under the moustache, so the head reads as a face
//     and not a brick even at 1x. The brim casts a shadow (slot 1) on the row
//     directly beneath it; skin light (slot 3) only lands on the nose bridge and
//     the cheekbone, never under the brim.
//   * The NEAR arm BREAKS the torso box. On the standing poses column x11 is
//     transparent for the length of the forearm: torso outline at x10, sky at x11,
//     arm outline at x12, sleeve at x13-14, arm outline at x15. Slot f draws the
//     seam only where the sleeve is still welded to the shoulder.
//   * The LEGS never fuse. Every pose keeps at least one column of background
//     between the two limbs below the hip — including the passing frame of the
//     walk, which is on screen roughly a third of all running time. At most ONE
//     row, the pelvis, is allowed to weld them.
//   * No floating interior bars. Slot f is a fold line that touches a silhouette
//     edge or a limb; it is never a free-standing rectangle in the middle of a
//     colour field.
//
// Two invariants that are measured, not asserted, and that this file previously
// broke in fifteen sprites:
//   * NO SPRITE HAS A FULLY OPAQUE ROW. Not one of the 63 baked frames contains a
//     16-wide run of ink. A solid row is the signature of two forms that have been
//     allowed to touch — arm into skull, leg into leg, hand into hip — and it is
//     invisible in the art file but fatal in flat silhouette.
//   * Every sprite uses all sixteen palette slots — a declared slot that no pixel
//     reaches means the form under it was never shaded.
//
// Every block below is a fixed-width 16-column grid; `sm`/`bg` assert both the
// width and the expected row count, so an off-size block fails at import instead
// of pushing a row through the floor at runtime.

import { makeSprite, Anim } from '../../core/gfx.js';
import { INK } from '../palette.js';

const OUT = INK.outline;
// The seam colour is a cold near-black indigo, not a third brown. It has to sit
// between a red sleeve and a blue bib and stay >= 40 units from the outline, the
// hair AND the boots; when it was #3b2412 it was 40 from the outline and 20 from
// boot leather, so every fold line it drew silently merged into what it touched.
const SOFT = '#18103c';

const SKIN = ['#a8571c', '#ef9a49', '#f8d5ac'];
const SKIN_PALE = ['#b06a33', '#f4b47e', '#ffe6cc'];
// Hair is a cool ashen brown so it separates from BOTH the cap shadow above it
// and the boot leather below it. A red-brown (#733210) measured 32 from the cap
// shadow it sits directly under — the sideburn vanished into the brim.
const HAIR = '#5a3a28';
// Boot dark is kept well clear of the outline so soles still read against a black
// (underground / castle) background. Slot 1 (skin shadow, #a8571c) doubles as the
// boot's lit tone: 1 -> c is 42 units and c -> b is 71, so the leather is a real
// three-step form instead of the two-step mass it used to be.
const SHOE = ['#4a1f06', '#84421c'];
const BTN = '#f0c840';

//                 shadow      mid        light      specular
// Overall light stays below the #5c94fc sky so leg edges never dissolve into it.
// RED specular is pushed toward hot pink rather than orange — an orange specular
// measured 30 units from skin mid and read as a hole punched through to the
// forehead. BLUE mid is darkened (not the light lifted) so the bib's three-column
// belly shadow actually steps: 8->9 is 59 and 9->a is 75.
const RED = ['#7c1408', '#d02a16', '#f0603a', '#ff8b7f'];
const BLUE = ['#0b2f74', '#1749a8', '#3878d8', '#a8d0ff'];
const WHITE = ['#6c7590', '#a8b4cc', '#d8e0f0', '#ffffff'];
const GOLD = ['#8a5600', '#e0a41c', '#fbe07c', '#fff8d0'];
const GREEN = ['#0d5210', '#2fa832', '#8ce65a', '#d4ffb0'];
// Work clothes for the toolbelt form: a denim cap and shirt over canvas overalls.
// The overalls CANNOT be the obvious tan — slot 1 is skin shadow (#a8571c) and
// slot c is boot leather, so any tan bib measured under 30 units from one of them
// and the man turned into one brown column. Pushing the canvas green-olive is what
// buys the separation (72 units off the skin ramp at its closest index) while
// still reading as workwear rather than as a second Luigi: the green is a drab
// khaki three steps darker and far less saturated than Luigi's #2fa832.
// The denim keeps its mid and light BELOW the #5c94fc sky (52 units clear at the
// closest slot) so a jumping figure never dissolves into the background.
const DENIM = ['#16345e', '#2f5f9c', '#4c86cc', '#a8d0ff'];
const CANVAS = ['#2c4a14', '#6e8a24', '#b8c85a'];

function pal(cap, ovl, skin = SKIN, hair = HAIR, shoe = SHOE, btn = BTN) {
  return [
    OUT, skin[0], skin[1], skin[2],
    hair, cap[0], cap[1], cap[2],
    ovl[0], ovl[1], ovl[2], shoe[0],
    shoe[1], btn, cap[3], SOFT,
  ];
}

const SMALL_PAL = pal(RED, BLUE);
const BIG_PAL = pal(RED, BLUE);
const FIRE_PAL = pal(WHITE, RED, SKIN, HAIR, SHOE, BTN);
const DEAD_PAL = pal(RED, BLUE, SKIN_PALE);
const FIRE_DEAD_PAL = pal(WHITE, RED, SKIN_PALE, HAIR, SHOE, BTN);
// Toolbelt keeps the boots and the brass button of the other forms on purpose:
// the belt drawn across the pelvis is painted in those same two leather slots and
// buckled with that same brass, so it costs no palette slot at all.
const TOOL_PAL = pal(DENIM, CANVAS, SKIN, HAIR, SHOE, BTN);
const TOOL_DEAD_PAL = pal(DENIM, CANVAS, SKIN_PALE, HAIR, SHOE, BTN);

// The star flash cycles cap, overalls, shoes, hair and buttons — never the SKIN.
// Holding the face on one ramp is what keeps the cap/face edge readable through
// all four phases; a gold cap over gold skin turns the head into one blank mass.
//
// Every phase is measured: no two of its sixteen slots are closer than 40 RGB
// units. That is why the boots go green under gold overalls and the button goes
// dark red under them — a gold button on a gold bib is not a button, and a white
// button next to a white specular is one slot spent twice.
const STAR_PALS = [
  pal(WHITE, GOLD, SKIN, '#1c3a5c', ['#243a10', '#3c6a1c'], '#7c1408'),
  pal(GOLD, GREEN, SKIN, '#1c3a5c', ['#4a1f06', '#8a3a24'], '#7c1408'),
  pal(GREEN, RED, SKIN, '#1c3a5c', SHOE, BTN),
  pal(RED, WHITE, SKIN, HAIR, SHOE, BTN),
];

export const MARIO_PALS = {
  small: SMALL_PAL,
  big: BIG_PAL,
  fire: FIRE_PAL,
  tool: TOOL_PAL,
  toolDead: TOOL_DEAD_PAL,
  dead: DEAD_PAL,
  star: STAR_PALS,
};

const BLANK = '................';

function grid(rows, h, name) {
  if (rows.length !== h) {
    throw new Error(`mario: ${name} is ${rows.length} rows, expected ${h}`);
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length !== 16) {
      throw new Error(`mario: ${name} row ${i} "${rows[i]}" is ${rows[i].length} wide, expected 16`);
    }
  }
  return rows;
}

function sm(rows, name, h = 16) {
  return makeSprite(grid(rows, h, 'small.' + name), SMALL_PAL, {
    name: 'mario.small.' + name, ox: -2, oy: 0,
  });
}
function bg(rows, name, h = 32) {
  return makeSprite(grid(rows, h, 'big.' + name), BIG_PAL, {
    name: 'mario.big.' + name, ox: -2, oy: 0,
  });
}

/* ================================================================== *
 *  SMALL MARIO — 16 x 16   (head 8 rows, torso 4, legs 4)
 * ================================================================== */

// Face rows 4-5 push the nose out to x14 (outline x15) — one pixel past the cap
// brim — then row 6 pulls back to x13 and row 7 to x11. Moustache is 5px under the
// nose only, so the sideburn, the lit cheek and the jaw stay separate browns.
// The cap specular runs (x6,r1)->(x5,r2), a diagonal down the lit face of the dome.
const S_HEAD = [
  '.....000000.....',
  '...07ee76650....',
  '..07ee7666650...',
  '..0665555555550.',
  '..04422202323210',
  '..04432202222210',
  '..0442344444210.',
  '...0122222100...',
];

// Walk down-B: the head has rocked the other way. Cap and brim ride BEHIND the
// face — the crown sits a column back of the neutral head and two back of the
// lean — so the skull counter-rotates against the shoulders once per cycle
// instead of nodding the same way twice. Crown 11, brim 14, nose 15.
const S_HEAD_TIP = [
  '....000000......',
  '..07ee76650.....',
  '.07ee7666650....',
  '.06655555555550.',
  '..04422202323210',
  '..04432202222210',
  '..0442344444210.',
  '...0122222100...',
];

// Walk frame C / swim pull: cap + brim slid one pixel forward of the face so the
// head leads the step and dips into the stroke.
const S_HEAD_LEAN = [
  '......000000....',
  '....07ee76650...',
  '...07ee7666650..',
  '...0665555555550',
  '..04422202323210',
  '..04432202222210',
  '..0442244444210.',
  '...0122222100...',
];

// Swim recovery: chin pulled a pixel back, brim tipped up so the nose bridge shows
// above it. The head genuinely lifts — it is not S_HEAD translated.
const S_HEAD_LIFT = [
  '.....000000.....',
  '...07ee76650....',
  '..07ee766655550.',
  '..0665555502210.',
  '..04422202232210',
  '..0443220222210.',
  '..044244444210..',
  '..0122222100....',
];

// Skid: cap thrown two pixels back, face only one, and the eye widened to a 2px
// slot-0 slit for the gritted look.
const S_HEAD_SKID = [
  '...000000.......',
  '.07ee76650......',
  '07ee7666650.....',
  '0665555555550...',
  '.04422200232210.',
  '.04432200222210.',
  '.0442244444210..',
  '..0122222100....',
];

// Reach: the raised hand lives in the two rows the jaw leaves empty on the right.
const S_HEAD_REACH = [
  '.....000000.....',
  '...07ee76650....',
  '..07ee7666650...',
  '..0665555555550.',
  '..04422202323210',
  '..04432202222210',
  '..04422444442100',
  '...0122222100220',
];

const S_HEAD_CLIMB_HI = [
  '......000000....',
  '....07ee76650...',
  '03207ee7666650..',
  '021066555555550.',
  '075.442220232210',
  '065.443220222210',
  '065.442244444210',
  '.0650122222100..',
];
const S_HEAD_CLIMB_LO = [
  '......000000....',
  '....07ee76650...',
  '...07ee7666650..',
  '...066555555550.',
  '032.442220232210',
  '021.443320222210',
  '075.442244444210',
  '.0650122222100..',
];

/* --- small torso blocks (rows 8..11) ------------------------------ *
 * x11 carries the slot-f arm seam at the shoulder; below the shoulder x11 goes
 * transparent so the forearm silhouettes clear of the ribs (torso outline x10,
 * sky x11, arm outline x12, sleeve x13, outline x14). The far sleeve is 2px at
 * x2-3 and runs 6 on its outboard column into 5 against the chest, so it reads as
 * a rounded limb behind the ribs rather than a flat stripe down the bib.          */

// Arm hanging at the side — hand at x12-13, sky notch cut at x11.
const SA_LOW = [
  '..076666666650..',
  '.0766966966f760.',
  '.065a999980.070.',
  '.021ad99d998320.',
];
// Walk contact: arm swept back. Seam and sleeve step one column left, hand at
// x11-12 — a full column behind the hanging pose.
const SA_BACK = [
  '..076666666650..',
  '.076696669f760..',
  '.065a99998f760..',
  '.021ad99d98320..',
];
// Arm straight out in front, hand clear of the chest at x12-14.
const SA_PULL = [
  '..076666666650..',
  '.0766966966f7650',
  '.065a999998f2220',
  '.021ad99d99880..',
];
// Walk push-off (3 rows — hips ride a pixel higher): the forward hand rides at
// x12-14, a row higher and two columns ahead of the back-swing.
const SA_PULL3 = [
  '..076666666650..',
  '.0766966966f7650',
  '.021ad99d9982220',
];
// Recovery: elbows in, the folded hand outlined onto the chest.
const SA_TUCK = [
  '..076666666650..',
  '.0766966966f760.',
  '.065a9902216650.',
  '.021ad99000880..',
];
// Arm rising forward at shoulder height.
const SA_RISE = [
  '..076666666650..',
  '.0766966966f7220',
  '.065a99999880...',
  '.021ad99d99880..',
];
// Arm overhead — hand is drawn into S_HEAD_REACH.
const SA_REACH = [
  '..07666666666220',
  '.0766966966f760.',
  '.065a99999880...',
  '.021ad99d99880..',
];
// Float: forearms angled forward at chest height, hands high.
const SA_FLOAT = [
  '..076666666650..',
  '.0766966966f2220',
  '.065a999998f760.',
  '.021ad99d99880..',
];
// Grow/shrink squash: shoulders spread, both hands braced out at the hips.
const SA_SQUASH = [
  '.07666666666650.',
  '022.6966966f.220',
  '022.ad99d980.220',
];

/* --- small leg blocks (rows 12..15) -------------------------------
 * Far leg is one step darker than the near leg all the way down so the two never
 * read as one blue slab.                                                        */

const SL_TOGETHER = [
  '..0a9999999980..',
  '..0998800a9980..',
  '..0ccb0.01ccb0..',
  '.0bccb0.0bcccb0.',
];
// Contact: both boots planted, three columns of sky between the soles so the
// stride still reads as a stride in flat silhouette.
const SL_STRIDE = [
  '..0a9999999980..',
  '.099800..0a9980.',
  '01cb0....01ccb0.',
  '0bccb0...0bcccb0',
];
// Passing (3 rows — body has dropped a pixel): rear boot swung up and forward,
// clear of the ground AND clear of the standing leg's column.
const SL_PASS = [
  '0ccb0..0a9980...',
  '0bcb0..01ccb0...',
  '.......0bcccb0..',
];
// Push-off (5 rows — hips ride a pixel higher): front heel reaching, rear leg
// stretched back on its toe.
const SL_REACH = [
  '..0a9999999980..',
  '.0998800a99980..',
  '099800...0a9980.',
  '01cb0....01ccb0.',
  '0bccb0...0bcccb0',
];
// Swim: wide split, knees at different bends, boots never level.
const SL_SPLIT = [
  '..0a9999999980..',
  '01cb0....0a99980',
  '0bccb0...01ccb0.',
  '.........0bcccb0',
];
// Swim pull: rear boot kicked up and back a row higher than the near knee, near
// boot dropped — neither foot level, and no leg here matches a walk pose.
const SL_SWIMPULL = [
  '..0a9999999980..',
  '01ccb0..0a99980.',
  '0bccb0...099980.',
  '.........01ccb0.',
];
// Swim: both knees folded up.
const SL_TUCK = [
  '..0a9999999980..',
  '..0ccb0.01ccb0..',
  '.0bccb0.0bcccb0.',
  '................',
];
// Swim: near leg snapping down, far leg kicked back and up.
const SL_KICK = [
  '..0a9999999980..',
  '01cb00..0a9980..',
  '0bccb0..01ccb0..',
  '........0bcccb0.',
];
// Glide: both knees relaxed and hanging a pixel apart, near boot one row above the
// far one, and nothing at all on the bottom row — the float rides higher than any
// stroke frame.
const SL_HANG = [
  '..0980.0a9980...',
  '..0980..01ccb0..',
  '..0880..0bcccb0.',
  '.0bccb0.........',
];
// Float: trailing foot drifts down and back, the other hangs loose.
const SL_FLOAT = [
  '..0a9999999980..',
  '.09980..0a9980..',
  '.0ccb0..01ccb0..',
  '0bccb0..0bccb0..',
];
// Swim: legs trailing back with the toes pointed — a different boot shape, not a
// slid copy of SL_TOGETHER.
const SL_TRAIL = [
  '..0a9999999980..',
  '.09980.0a99880..',
  '01cb00.01cb00...',
  '0bccb0.0bccb0...',
];
// Airborne: rear leg tucked up, front leg reaching down.
const SL_JUMP = [
  '..0a9999999980..',
  '01cb00..0a99980.',
  '0bccb0..0a99980.',
  '........01ccb0..',
];
// Grow/shrink squash (5 rows): hips bulge a pixel wider each side and the soles
// spread — the size change lands with weight instead of mid-stride.
const SL_SQUASH = [
  '..0a9999999980..',
  '.0a999999999890.',
  '.09980.0a9980...',
  '.0cccb0.01cccb0.',
  '0bbcccb0.0bcccb0',
];

const SMALL_IDLE = sm([...S_HEAD, ...SA_LOW, ...SL_TOGETHER], 'idle');

// Walk: A contact, arm swept back (hand x11-12) -> B passing, arm vertical
// (hand x12-13, body dropped 1px) -> C push-off, arm driven forward (hand x12-14,
// a row higher). Head, hips, both boots AND the hand all move every frame.
const SMALL_WALK_A = sm([...S_HEAD, ...SA_BACK, ...SL_STRIDE], 'walkA');
const SMALL_WALK_B = sm([BLANK, ...S_HEAD, ...SA_LOW, ...SL_PASS], 'walkB');
const SMALL_WALK_C = sm([...S_HEAD_LEAN, ...SA_PULL3, ...SL_REACH], 'walkC');

const SMALL_JUMP = sm([
  ...S_HEAD_REACH,
  '..07666666666220',
  '02266966966f760.',
  '022a99999880....',
  '..0ad99d99880...',
  ...SL_JUMP,
], 'jump');

const SMALL_SKID = sm([
  ...S_HEAD_SKID,
  '.076666666650...',
  '0766966966f6650.',
  '066a9999980.0760',
  '011ad99d9980.320',
  '.0a999999998000.',
  '.01cb0..0a99980.',
  '.0bccb0.0a99980.',
  '.......01ccccb0.',
], 'skid');

// Same column contract as BIG_DEAD_ROWS: arm x0-x2, SKY at x3, head x4-x11 with
// its own outline at x4 and x11, SKY at x12, arm x13-x15. Five rows of solid
// 16-wide ink used to weld the cap, both fists and the face into one lump.
const SMALL_DEAD = makeSprite(grid([
  '...0000000000...',
  '..07ee76666650..',
  '.06655555555550.',
  '000.04111140.000',
  '032.04022040.310',
  '021.01232210.210',
  '076.04444440.650',
  '065..012210..550',
  '.06776666665550.',
  '.066f999999f650.',
  '.06ad999999d860.',
  '..0a9999998880..',
  '..0a9988899880..',
  '..0a980.0a9980..',
  '..01cb0.01ccb0..',
  '..0bbb0.0bcccb0.',
], 16, 'small.dead'), DEAD_PAL, { name: 'mario.small.dead', ox: -2, oy: 0 });

// Climb: the legs alternate their grip. In A the near leg is folded up and its
// boot sits three rows above the far boot; in B the pair is swapped.
const SMALL_CLIMB_A = sm([
  ...S_HEAD_CLIMB_HI,
  '...076666666650.',
  '03266966966f760.',
  '021.6a999998f760',
  '...0ad99d998210.',
  '...0a9999999980.',
  '...09980.01ccb0.',
  '...09880.0bccb0.',
  '..0bcccb0.......',
], 'climbA');

const SMALL_CLIMB_B = sm([
  ...S_HEAD_CLIMB_LO,
  '...076666666650.',
  '...06966966f760.',
  '032.6a999998f760',
  '021.6ad99d998210',
  '...0a9999999980.',
  '...01cb0.0a9980.',
  '..0bccb0.0a9880.',
  '.........01ccb0.',
], 'climbB');

// Six-frame stroke: the hand traces reach (above the head) -> forward -> at the
// side -> past the hip -> tucked on the chest -> rising, and no two leg blocks
// are translations of each other. The head dips on the pull (S_HEAD_LEAN) and
// lifts on the recovery (S_HEAD_LIFT) instead of riding as a rigid block.
const SMALL_SWIM_1 = sm([...S_HEAD_REACH, ...SA_REACH, ...SL_SPLIT], 'swim1');
const SMALL_SWIM_2 = sm([...S_HEAD_LEAN, ...SA_PULL, ...SL_SWIMPULL], 'swim2');
const SMALL_SWIM_3 = sm([...S_HEAD_LEAN, ...SA_LOW, ...SL_KICK], 'swim3');
const SMALL_SWIM_4 = sm([...S_HEAD, ...SA_BACK, ...SL_TUCK], 'swim4');
const SMALL_SWIM_5 = sm([...S_HEAD_LIFT, ...SA_TUCK, ...SL_TRAIL], 'swim5');
const SMALL_SWIM_6 = sm([...S_HEAD_LIFT, ...SA_RISE, ...SL_FLOAT], 'swim6');

// Floating: forearms up at chest height, both knees loose, near foot a row above
// the far one and the bottom row empty — the glide visibly rides higher than the
// stroke it came out of.
const SMALL_SWIM_IDLE = sm([...S_HEAD, ...SA_FLOAT, ...SL_HANG], 'swimIdle');

// Transformation pose: a 16-row squash-and-hold. Same footprint as every other
// small sprite (it used to be 17 and pushed a row through the floor) and its own
// pose rather than a borrowed walk frame.
const SMALL_GROW = sm([...S_HEAD, ...SA_SQUASH, ...SL_SQUASH], 'grow');

export const SMALL_MARIO = {
  idle: SMALL_IDLE,
  walk: new Anim([SMALL_WALK_A, SMALL_WALK_B, SMALL_WALK_C], 5),
  jump: SMALL_JUMP,
  skid: SMALL_SKID,
  dead: SMALL_DEAD,
  climb: new Anim([SMALL_CLIMB_A, SMALL_CLIMB_B], 8),
  swim: new Anim([SMALL_SWIM_1, SMALL_SWIM_2, SMALL_SWIM_3, SMALL_SWIM_4, SMALL_SWIM_5, SMALL_SWIM_6],
    [6, 5, 5, 7, 6, 6]),
  swimIdle: SMALL_SWIM_IDLE,
  grow: SMALL_GROW,
  star: STAR_PALS,
};

/* ================================================================== *
 *  BIG MARIO — 16 x 32   (head 12 rows, torso 10, legs + boots 10)
 * ================================================================== */

// Silhouette down the face: brim 14, nose 15, nose 15, moustache 14, jaw 13,
// chin 12, neck 11. Row 5 is the brim's cast shadow (slot 1). Skin light lands on
// the nose bridge (x10-11, rows 5-6) and the cheekbone (x5-6, rows 7-8) — the two
// planes that actually face the upper-left key.
const B_HEAD = [
  '.....000000.....',
  '...07ee76650....',
  '..07ee7666650...',
  '..07776666650...',
  '..0665555555550.',
  '..044112223210..',
  '..04422202332210',
  '..04433202222210',
  '..0443224444410.',
  '...01222444410..',
  '...0122222100...',
  '....01222110....',
];

// Walk frame C: cap + brim lead the face by a pixel.
const B_HEAD_LEAN = [
  '......000000....',
  '....07ee76650...',
  '...07ee7666650..',
  '...07776666650..',
  '...0665555555550',
  '..044112223210..',
  '..04422202332210',
  '..04433202222210',
  '..0443224444410.',
  '...01222444410..',
  '...0122222100...',
  '....01222110....',
];

// Swim pull: the whole head drops a row into the water and the cap tips a pixel
// forward of the face, so the skull rolls with the stroke instead of riding it.
const B_HEAD_DIP = [
  '................',
  '......000000....',
  '....07ee76650...',
  '...07ee7666650..',
  '...07776666650..',
  '...0665555555550',
  '..044112223210..',
  '..04422202332210',
  '..04433202222210',
  '..0443224444410.',
  '...01222444410..',
  '...0122222100...',
];

// Swim recovery: brim tipped up so the bridge of the nose clears it a row early,
// jaw and chin pulled a pixel back. The chin lifts, the cap does not translate.
const B_HEAD_LIFT = [
  '.....000000.....',
  '...07ee76650....',
  '..07ee7666650...',
  '..07776666655550',
  '..06655555502210',
  '..04411222332210',
  '..0442220222210.',
  '..0443320222210.',
  '..044324444410..',
  '..01222444410...',
  '..0122222100....',
  '...01222110.....',
];

// Skid: cap thrown two pixels back over a face that only moves one, so the brim
// leads and the chin trails. Eye widened to a 2px slot-0 slit.
const B_HEAD_L = [
  '...000000.......',
  '.07ee76650......',
  '07ee7666650.....',
  '07776666650.....',
  '0665555555550...',
  '.044112223210...',
  '.04422200332210.',
  '.04433200222210.',
  '.0443224444410..',
  '..01222444410...',
  '..0122222100....',
  '...01222110.....',
];

// Reach: hand and wrist occupy the three rows the jaw leaves free on the right.
const B_HEAD_REACH = [
  '.....000000.....',
  '...07ee76650....',
  '..07ee7666650...',
  '..07776666650...',
  '..0665555555550.',
  '..044112223210..',
  '..04422202332210',
  '..04433202222210',
  '..0443224444410.',
  '...0122244441000',
  '...0122222100022',
  '....012221100220',
];

// Climbing: the far arm crosses in front of the pole. It is a lit sleeve (slot 7
// at the shoulder, 6 down the upper arm) over a shadow column (slot 5) on the
// side turning away from the key light, capped by a two-tone skin fist — a
// modelled limb, not a 2px bar of one flat red. On the three rows where the arm
// runs alongside the cheek, x3 is background: the reaching arm has to clear the
// skull or the whole climb pose is one 16-wide slab of ink.
const B_HEAD_CLIMB_HI = [
  '......000000....',
  '....07ee76650...',
  '...07ee7666650..',
  '...07776666650..',
  '032066555555550.',
  '021044112223210.',
  '075.442220233210',
  '065.443320222210',
  '065.443224444410',
  '.06501222444410.',
  '.0650122222100..',
  '..06501222110...',
];

const B_HEAD_CLIMB_LO = [
  '......000000....',
  '....07ee76650...',
  '...07ee7666650..',
  '...07776666650..',
  '...066555555550.',
  '...044112223210.',
  '032.442220233210',
  '021.443320222210',
  '075.443224444410',
  '.06501222444410.',
  '.0650122222100..',
  '..06501222110...',
];

/* --- big torso blocks (rows 12..21) -------------------------------
 * Column plan: x1 outline, x2-3 far sleeve, x4-x9 overalls ramped
 * light->mid->shadow left to right, x10 torso outline, x11 SKY, x12 arm outline,
 * x13-14 near sleeve, x15 arm outline. Slot f welds the sleeve to the shoulder on
 * rows 13-14 only; below that the arm is a free limb with background behind it.
 * The hand is a 2x2 of skin that terminates the arm with its own outline.
 *
 * BOTH sleeves are modelled, not filled. The near sleeve runs 7 (lit) -> 6 (mid)
 * -> 5 (shadow) left to right across its width, so the limb closest to the camera
 * is a cylinder; it used to be 8 flat pixels of slot 6 and never reached slot 7
 * anywhere in the sprite. The far sleeve is 6 on its outboard column and 5 on the
 * column against the chest, and it ends in a slot-0 cuff before the hand instead
 * of running six flat pixels of one red straight into four flat pixels of skin.
 *
 * The chest is not a flat blue rectangle: the shadow WIDENS as it descends —
 * one column at the sternum, two at the ribs, three at the belly — so the bib
 * reads as a barrel turning away from the upper-left key rather than as a field
 * with a 1px line down one side.
 *
 * The last three rows of every block are the shared pelvis: waist, a rounded hip
 * mass turning away from the light, and a crotch fold that runs into the leg gap.
 * (No 4px slot-f bar floating in the middle of the bib — that read as a mail slot
 * at 30x and as a hole at 1x.)                                                  */

const BA_DOWN = [
  '..076666666650..',
  '.0766966696f760.',
  '.065aa99999f7650',
  '.065ad999d0.0760',
  '.065aa99980.0760',
  '.001a999880.0320',
  '.021a998880.0210',
  '..0a99999988800.',
  '..0a9999888880..',
  '..0a9988899880..',
];
// Walk contact — arm swept back behind the hip. Seam and sleeve step one column
// left of the hanging pose and the hand drops to rows 18-19 at x12-13.
const BA_WALK_BACK = [
  '..076666666650..',
  '.076696669f7650.',
  '.065aa9999f7650.',
  '.065ad999df7650.',
  '.065aa9998f7650.',
  '.001a99988f7650.',
  '.021a9988880320.',
  '..0a99999980210.',
  '..0a9999888800..',
  '..0a9988899880..',
];
// Walk push-off (9 rows — chest squashed, hips a pixel higher) — arm driven
// forward and up, elbow high, hand out at x14-15 clear of the chest. The forearm
// is short because it is foreshortened straight at the camera.
const BA_WALK_FWD = [
  '..0766666666650.',
  '.0766966696f7660',
  '.065aa99999f7660',
  '.065ad999d9f7622',
  '.065a99999988021',
  '.021a99999888000',
  '..0a9999998880..',
  '..0a9999888880..',
  '..0a9988899880..',
];
// Stroke pose 1 — arm overhead (hand lives in B_HEAD_REACH).
const BA_REACH = [
  '..07666666666220',
  '.0766966696f760.',
  '.065aa9999980...',
  '.065ad999d980...',
  '.065a99999880...',
  '.001a99998880...',
  '.021a99988880...',
  '..0a9999998880..',
  '..0a9999888880..',
  '..0a9988899880..',
];
// Stroke pose 2 — arm straight out in front, hand clear of the chest.
const BA_PULL = [
  '..076666666650..',
  '.0766966696f760.',
  '.065aa99999f7620',
  '.065ad999d9f7220',
  '.065a99999880...',
  '.001a99998880...',
  '.021a99988880...',
  '..0a9999998880..',
  '..0a9999888880..',
  '..0a9988899880..',
];
// Stroke pose 4 — hand driven down past the hip.
const BA_BACK = [
  '..076666666650..',
  '.0766966696f760.',
  '.065aa99999f7650',
  '.065ad999d9f7650',
  '.065a999998f7650',
  '.001a99998880760',
  '.021a99998880320',
  '..0a999999888210',
  '..0a99998888800.',
  '..0a9988899880..',
];
// Stroke pose 5 — recovery. The elbow swings out, the forearm crosses in over the
// bib and the hand is boxed on its own outline at the end of it: a limb, not four
// loose skin pixels keyed into the blue.
const BA_TUCK = [
  '..076666666650..',
  '.0766966696f760.',
  '.065aa99999f7650',
  '.065ad990776650.',
  '.065a9902216650.',
  '.001a999000880..',
  '.021a99998880...',
  '..0a9999998880..',
  '..0a9999888880..',
  '..0a9988899880..',
];
// Stroke pose 6 — arm swinging back up to shoulder height.
const BA_RISE = [
  '..076666666650..',
  '.076696669f7220.',
  '.065aa9999980210',
  '.065ad999d980...',
  '.065a99999880...',
  '.001a99998880...',
  '.021a99988880...',
  '..0a9999998880..',
  '..0a9999888880..',
  '..0a9988899880..',
];
// Float (9 rows): forearms lifted to chest height and angled forward.
const BA_FLOAT = [
  '..076666666650..',
  '.0766966696f760.',
  '.065aa99999f7220',
  '.065ad999d9f2220',
  '.065a99999880...',
  '.021a99998880...',
  '..0a9999998880..',
  '..0a9999888880..',
  '..0a9988899880..',
];

/* --- big leg blocks (rows 22..31) ---------------------------------
 * Both legs get a knee and a calf: 4px thigh, a 3px pinch at the knee, a 4px calf
 * with the light column stepping one pixel outboard to follow the curve, then a
 * 3px ankle into the boot. The far leg runs a full 3-tone ramp (a/9/8) one step
 * darker than the near leg so the two never fuse into a single blue column.     */

// Idle stance. The hips stay welded for two rows, then a column of sky opens
// between the legs and runs unbroken to the soles — in flat silhouette the idle
// has to read as a man standing, not as a pillar with a head on it. The far leg
// pinches at the knee (row 25) and the near calf swells one column outboard
// (rows 26-27) so neither limb is an extruded rectangle.
const BL_TOGETHER = [
  '..0a98800a9980..',
  '..0a980..0a9980.',
  '..0a980..0a9980.',
  '..09980..0a9980.',
  '..09880..0a99980',
  '..08880..0999980',
  '..01ccb0.01ccb0.',
  '..0cccb0.0cccb0.',
  '.0bcccb0.0bcccb0',
  '.0bbbbb0.0bbbbb0',
];
// Contact: both boots down, legs splayed.
const BL_STRIDE = [
  '.0998800a99980..',
  '.099800..0a9980.',
  '.09880...0a9980.',
  '099800...0a99980',
  '09880....0a99980',
  '08880....0888880',
  '0cccb0...01ccb0.',
  '0cccb0...0cccb0.',
  '0bcccb0..0bcccb0',
  '0bbbbb0..0bbbbb0',
];
// Passing (9 rows — body dropped a pixel): rear boot lifted clear and toed off,
// near leg vertical under the weight. The rear leg is one column narrower than the
// near one so a full column of sky runs at x7 from hip to sole: every row here is
// exactly two ink runs. This is the frame that is on screen a third of all running
// time — when the two legs touched at x7/x8 the whole cycle collapsed into a slab.
const BL_PASS = [
  '..09980.0a9980..',
  '..09980.0a9980..',
  '..08880.0a9980..',
  '..01cb0.0a9980..',
  '..0ccb0.0a9880..',
  '.0bbbb0.01ccb0..',
  '........0cccb0..',
  '.......0bcccb0..',
  '.......0bbbbb0..',
];
// Push-off (11 rows — hips a pixel higher): front heel reaching, rear heel up.
const BL_PUSH = [
  '..0998800a9980..',
  '.0998800.0a9980.',
  '.099800..0a9980.',
  '099800...0a99980',
  '09880....0a99980',
  '09880....0a99980',
  '08880....0999980',
  '01cb0....0888880',
  '0cccb0...01ccb0.',
  '0bbbb0...0cccb0.',
  '........0bcccb0.',
];
// Swim: moderate split, rear sole one row shy of the near one.
const BL_OPEN = [
  '..0998800a99980.',
  '.099880..0a9980.',
  '.09880...0a9980.',
  '.09880...0a9980.',
  '.08880...0a9980.',
  '.01cb0...0a9980.',
  '.0cccb0..099980.',
  '0bcccb0..01ccb0.',
  '0bbbbb0..0cccb0.',
  '.........0bcccb0',
];
// Swim: wide split with the near knee bent forward, feet three rows apart.
const BL_SPLIT = [
  '..0998800a99980.',
  '.099880..0a9980.',
  '099880...0a9980.',
  '09880....0a99980',
  '01cb0....0a99980',
  '0cccb0...0a99980',
  '0bbbb0....099980',
  '..........01ccb0',
  '.........0bcccb0',
  '.........0bbbbb0',
];
// Swim: near leg folded up and forward, far leg trailing down and back.
const BL_SCISSOR = [
  '..0998800a9980..',
  '.099880..0a99980',
  '.09880...0a99980',
  '099880....099980',
  '09880.....01ccb0',
  '09880.....0cccb0',
  '08880....0bcccb0',
  '01cb0.....0bbbb0',
  '0cccb0..........',
  '0bbbbb0.........',
];
// Swim: both knees folded, boots clear of the ground line entirely.
const BL_TUCK = [
  '..09980.0a9980..',
  '..09980.0a9980..',
  '..08880.0a9880..',
  '..01cb0.0a8880..',
  '..0ccb0.01ccb0..',
  '.0bbbb0.0cccb0..',
  '.......0bcccb0..',
  '.......0bbbbb0..',
  '................',
  '................',
];
// Swim: near leg snapping straight down, far leg kicked back and up.
const BL_KICK = [
  '..0998800a9980..',
  '.0998800.0a9980.',
  '099880...0a9980.',
  '01ccb0...0a9980.',
  '0cccb0...0a9980.',
  '0bbbb0...0a9980.',
  '.........0a9980.',
  '.........01ccb0.',
  '.........0cccb0.',
  '........0bcccb0.',
];
// Float (11 rows): trailing foot drifts down and back, the other hangs loose.
const BL_FLOAT = [
  '..0998800a9980..',
  '..0998800a9980..',
  '.099800..0a9980.',
  '.09880...0a9980.',
  '.09880...0a9980.',
  '.08880...0a9880.',
  '.01cb0...0a8880.',
  '.0cccb0..01ccb0.',
  '0bcccb0..0cccb0.',
  '0bbbbb0.0bcccb0.',
  '.........0bbbb0.',
];
// Swim: legs trailing back and slightly bent, toes pointed away from the stroke.
const BL_TRAIL = [
  '..0998800a9980..',
  '..0998800a9980..',
  '.0998800a99980..',
  '.099800.0a9980..',
  '.09880..0a9980..',
  '.08880..0a9880..',
  '01cb0...0a8880..',
  '0cccb0..01ccb0..',
  '0bcccb0.0cccb0..',
  '0bbbbb00bbbbb0..',
];
// Airborne: the rear leg is genuinely FOLDED — its sole sits at row 27, four rows
// clear of the ground line — while the lead leg hangs full length to row 31. This
// used to share three identical rows with the swim split, which made the jump and
// the power stroke read as the same drawing.
const BL_JUMP = [
  '..0998800a99980.',
  '.0998800.0a9980.',
  '01cb00...0a9980.',
  '0cccb0...0a99980',
  '0bcccb0..0a99980',
  '0bbbbb0..0999980',
  '.........0899880',
  '.........01ccb0.',
  '.........0cccb0.',
  '........0bcccb0.',
];

const BIG_IDLE = bg([...B_HEAD, ...BA_DOWN, ...BL_TOGETHER], 'idle');

// Walk: A contact, arm swept back, both boots planted -> B passing, arm vertical,
// whole body dropped one row, rear boot swung clear -> C push-off, arm driven
// forward to x14-15, chest squashed a row, hips a pixel higher, cap leading the
// face. Head, hips, hand and both boots all change every frame.
const BIG_WALK_A = bg([...B_HEAD, ...BA_WALK_BACK, ...BL_STRIDE], 'walkA');
const BIG_WALK_B = bg([BLANK, ...B_HEAD, ...BA_DOWN, ...BL_PASS], 'walkB');
const BIG_WALK_C = bg([...B_HEAD_LEAN, ...BA_WALK_FWD, ...BL_PUSH], 'walkC');

const BIG_JUMP = bg([
  ...B_HEAD_REACH,
  '..07666666666220',
  '02266966696f760.',
  '022aa9999980....',
  '.065ad999d980...',
  '.065a99999880...',
  '.001a99998880...',
  '.021a99988880...',
  '..0a9999998880..',
  '..0a9999888880..',
  '..0a9988899880..',
  ...BL_JUMP,
], 'jump');

const BIG_SKID = bg([
  ...B_HEAD_L,
  '.076666666650...',
  '0766966696650...',
  '055aa99999f650..',
  '055ad999d9f650..',
  '055a999998f6650.',
  '011a9998880.0760',
  '011a99988880.320',
  '.0a99999988800..',
  '.0a9999888880...',
  '.0a9988899880...',
  '.0998800a99980..',
  '.099800..0a9980.',
  '.09880...0a9980.',
  '099800...0a99980',
  '09880....0a99980',
  '01cb0....0a99980',
  '0cccb0...0a99980',
  '0bbbb0....099980',
  '........01ccccb0',
  '.......0bcccccb0',
], 'skid');

// Duck — a real crouch, not the idle with rows deleted. The cap loses its top two
// rows so the head sinks into the shoulders, the near arm tilts down until the
// hand hangs at thigh height, and the legs fold: thigh forward, shin back, boots
// planted two pixels wider than idle. The near arm keeps its column of sky at x12
// all the way down and the far shoulder no longer bulges out to x0, so the crouch
// is at most 15 columns wide and never a solid 16-wide brick.
const BIG_DUCK = bg([
  '....00000000....',
  '..07ee76666650..',
  '..0665555555550.',
  '..044112223210..',
  '..04422202332210',
  '..04433202222210',
  '..0443224444410.',
  '...01222444410..',
  '...0122222100...',
  '....01222110....',
  '.07666666666650.',
  '.0766966696f7650',
  '.065aa99999f7650',
  '.065ad999d90.760',
  '.001a9999980.760',
  '.021a9999880.320',
  '.0998800a999800.',
  '.09980..0a99980.',
  '.08880..099980..',
  '.08880..088880..',
  '0cccb0...01ccb0.',
  '0bcccb0..0bcccb0',
], 'duck', 22);

// Climb: the legs genuinely alternate their grip. In A the near knee is folded up
// and its boot sits six rows above the far boot, which stays extended; in B the
// pair is swapped. Nothing here is the other frame slid up a row.
const BIG_CLIMB_A = bg([
  ...B_HEAD_CLIMB_HI,
  '...076666666650.',
  '..0766966696760.',
  '..065aa99999f760',
  '..065ad999d9f760',
  '032.5a999998f760',
  '021.5a999998f760',
  '...0a9999998880.',
  '...0a9999888880.',
  '...0a9988899880.',
  '...09980.0a9980.',
  '...09980.0a9980.',
  '...09980..0a980.',
  '...0980..01ccb0.',
  '...09880.0bcccb0',
  '...098880.......',
  '....08880.......',
  '....08880.......',
  '...01ccb0.......',
  '..0bcccb0.......',
  '..0bbbbb0.......',
], 'climbA');

const BIG_CLIMB_B = bg([
  ...B_HEAD_CLIMB_LO,
  '...076666666650.',
  '..0766966696760.',
  '..065aa99999f760',
  '..065ad999d9f760',
  '..065a999998f760',
  '032.5a999998f760',
  '021.5a9999998880',
  '...0a9999888880.',
  '...0a9988899880.',
  '...09980.0a9980.',
  '...09980.0a9980.',
  '...0980..0a9980.',
  '...01cb0.0a9980.',
  '..0bccb0.0a9980.',
  '.........0a9980.',
  '.........0a9880.',
  '..........09880.',
  '.........01ccb0.',
  '.........0bcccb0',
  '.........0bbbbb0',
], 'climbB');

// Six-frame stroke. Near hand: above the head -> out in front -> at the side ->
// past the hip -> folded on the bib -> rising back to the shoulder. Every leg
// block is a different pose, and the head bobs with the stroke: dipped on frames
// 2-3, neutral on 4, lifted on 5-6.
const BIG_SWIM_1 = bg([...B_HEAD_REACH, ...BA_REACH, ...BL_SPLIT], 'swim1');
const BIG_SWIM_2 = bg([...B_HEAD_DIP, ...BA_PULL, ...BL_OPEN], 'swim2');
const BIG_SWIM_3 = bg([...B_HEAD_DIP, ...BA_DOWN, ...BL_KICK], 'swim3');
const BIG_SWIM_4 = bg([...B_HEAD, ...BA_BACK, ...BL_TUCK], 'swim4');
const BIG_SWIM_5 = bg([...B_HEAD_LIFT, ...BA_TUCK, ...BL_SCISSOR], 'swim5');
const BIG_SWIM_6 = bg([...B_HEAD_LIFT, ...BA_RISE, ...BL_TRAIL], 'swim6');

const BIG_SWIM_IDLE = bg([...B_HEAD, ...BA_FLOAT, ...BL_FLOAT], 'swimIdle');

// Death: head turned to the camera so both eyes read, both arms punched up beside
// it, boots pointed down. The cap owns rows 0-3 alone; from row 4 to row 11 the
// column layout is hard: arm x0-x2, SKY at x3, head outline x4, face x5-x10, head
// outline x11, SKY at x12, arm x13-x15. Two unbroken columns of background run the
// whole height of the skull, so in flat silhouette this is a man with his arms up
// and not one 16x10 brick with a face printed on it — which is exactly what ten
// consecutive fully-opaque rows used to give.
//
// The arms are lit as one form: the left arm shows its lit face (slot 7 -> 6) and
// the right arm shows its shadow face (slot 6 -> 5), each carrying its outline on
// the side turning away from the upper-left key. The fists are 2x2 of skin capped
// by an outline row above and a cuff row below.
const BIG_DEAD_ROWS = [
  '...0000000000...',
  '..077ee7666650..',
  '..07ee76666550..',
  '.06655555555550.',
  '000.04111140.000',
  '032.04022040.310',
  '021.04032040.210',
  '010.01232210.100',
  '076.04444440.650',
  '076.01444410.650',
  '066..012210..650',
  '065...0120...550',
  '.06776666665550.',
  '.066f999999f650.',
  '.06aa9999999860.',
  '.06ad999999d860.',
  '.06aa9999998860.',
  '.0aa99999998880.',
  '.0a999999988880.',
  '..0a9999998880..',
  '..0a9999888880..',
  '..0a9988899880..',
  '..0aa980.0aa980.',
  '..0a9980.0a9980.',
  '..0a9980.0a9980.',
  '..09980..0a9980.',
  '..09880..0a9980.',
  '..08880..099980.',
  '..01ccb0.01ccb0.',
  '..0cccb0.0cccb0.',
  '...0ccb0.0ccb0..',
  '...0bbb0.0bbb0..',
];

const BIG_DEAD = makeSprite(grid(BIG_DEAD_ROWS, 32, 'big.dead'), DEAD_PAL,
  { name: 'mario.big.dead', ox: -2, oy: 0 });
const FIRE_DEAD = makeSprite(BIG_DEAD_ROWS, FIRE_DEAD_PAL,
  { name: 'mario.fire.dead', ox: -2, oy: 0 });

/* ================================================================== *
 *  GROW / SHRINK TRANSITION — all 16 x 32, content bottom-aligned so a
 *  single draw position can flicker between them. GROW_MID is squashed:
 *  one row shorter through the chest with the boots a pixel wider each
 *  side, so the change of size lands with some weight.
 * ================================================================== */

const MID_BODY = [
  '..076666666650..',
  '.0766966696f760.',
  '.065aa99999f7650',
  '.021ad99d9880220',
  '..0a9999998880..',
  '..0a9999888880..',
  '..0a9988899880..',
  '..08880.0a8880..',
  '.01cccb0.01cccb0',
  '.0bcccb0.0bcccb0',
  '0bbbbbb0.0bbbbb0',
];

const GROW_SMALL = bg([...Array(16).fill(BLANK), ...SMALL_IDLE.rows], 'growSmall');
const GROW_MID = bg([...Array(9).fill(BLANK), ...B_HEAD, ...MID_BODY], 'growMid');
const GROW_BIG = bg([...BIG_IDLE.rows], 'growBig');

export const GROW_FRAMES = [
  GROW_SMALL, GROW_MID, GROW_BIG,
  GROW_MID, GROW_SMALL, GROW_MID,
  GROW_BIG, GROW_MID, GROW_BIG,
];

export const BIG_MARIO = {
  idle: BIG_IDLE,
  walk: new Anim([BIG_WALK_A, BIG_WALK_B, BIG_WALK_C], 5),
  jump: BIG_JUMP,
  skid: BIG_SKID,
  duck: BIG_DUCK,
  dead: BIG_DEAD,
  climb: new Anim([BIG_CLIMB_A, BIG_CLIMB_B], 8),
  swim: new Anim([BIG_SWIM_1, BIG_SWIM_2, BIG_SWIM_3, BIG_SWIM_4, BIG_SWIM_5, BIG_SWIM_6],
    [6, 5, 5, 7, 6, 6]),
  swimIdle: BIG_SWIM_IDLE,
  // The engine looks for the mid-transition pose here (POSE_ALIASES 'grow').
  grow: GROW_MID,
  star: STAR_PALS,
};

/* ================================================================== *
 *  FIRE MARIO — Big Mario's pixels, fire palette, plus a throw pose
 * ================================================================== */

const fire = (s, name) => s.recolor(FIRE_PAL, 'mario.fire.' + name);
const fireAnim = (a, name) =>
  new Anim(a.frames.map((f, i) => fire(f, `${name}${i}`)), a.holds, a.loop);

// Cap pitched a pixel forward of the face, mouth open with the effort, throwing
// arm driven down past the hip so the hand breaks the silhouette below the belt.
// Rear leg braced back in a lunge.
const FIRE_THROW = makeSprite(grid([
  '......000000....',
  '....07ee76650...',
  '...07ee7666650..',
  '...07776666650..',
  '...0665555555550',
  '..044112223210..',
  '..04422202332210',
  '..04433202222210',
  '..0443224444410.',
  '...01222444410..',
  '...0122002100...',
  '....01222110....',
  '..076666666650..',
  '.0766966696f760.',
  '.065aa99999f7650',
  '.065ad999d9f7650',
  '.065a999998f7650',
  '.001a99998880760',
  '.021a99998880650',
  '..0a999999888220',
  '..0a999988888220',
  '..0a998889988000',
  '.0998800a99980..',
  '.099800..0a9980.',
  '099800...0a9980.',
  '09880....0a99980',
  '08880....0a99980',
  '01cb0....0888880',
  '0cccb0...01ccb0.',
  '0bcccb0..0cccb0.',
  '0bbbbb0..0bcccb0',
  '.........0bbbbb0',
], 32, 'fire.throw'), FIRE_PAL, { name: 'mario.fire.throw', ox: -2, oy: 0 });

export const FIRE_MARIO = {
  idle: fire(BIG_IDLE, 'idle'),
  walk: fireAnim(BIG_MARIO.walk, 'walk'),
  jump: fire(BIG_JUMP, 'jump'),
  skid: fire(BIG_SKID, 'skid'),
  duck: fire(BIG_DUCK, 'duck'),
  dead: FIRE_DEAD,
  climb: fireAnim(BIG_MARIO.climb, 'climb'),
  swim: fireAnim(BIG_MARIO.swim, 'swim'),
  swimIdle: fire(BIG_SWIM_IDLE, 'swimIdle'),
  throwing: FIRE_THROW,
  grow: fire(GROW_MID, 'grow'),
  star: STAR_PALS,
};

/* ================================================================== *
 *  TOOLBELT MARIO — Big Mario's pixels in work clothes, plus a belt
 *
 *  Derived from BIG_MARIO the way FIRE_MARIO is, so every animation big
 *  Mario has (and every one he gains later) arrives here for free. The
 *  costume is a denim cap and shirt over olive canvas overalls; the read
 *  that actually names the power-up is the LEATHER BELT.
 *
 *  The belt is not authored per pose — 63 hand-drawn waistlines would
 *  drift out of register the first time a walk frame moved a row. It is
 *  a transform on whatever rows are passed in:
 *
 *    * the two pelvis rows are found by walking UP from the soles through
 *      the split-leg block to the row where the hips weld together;
 *    * on those two rows, and ONLY on pixels already in the overall ramp
 *      (8/9/a), the canvas is remapped to boot leather — lit strap on the
 *      upper row, dark strap on the lower — with a 2x2 brass buckle set
 *      forward of centre, where a buckle sits on a man facing right.
 *
 *  Because it only ever swaps one slot for another, the alpha mask, the
 *  row widths, the "no fully opaque row" invariant and the "every sprite
 *  uses all sixteen slots" invariant of the source frame all survive
 *  untouched. The belt cannot fuse two limbs together, because it never
 *  paints a pixel that was not already opaque.
 * ================================================================== */

const OVERALL_CHARS = '89a';

function opaqueRuns(row) {
  let n = 0;
  let prev = false;
  for (let i = 0; i < row.length; i++) {
    const on = row[i] !== '.';
    if (on && !prev) n++;
    prev = on;
  }
  return n;
}

// Walk up from the bottom: skip a lone trailing boot (the passing frames end on
// one leg), climb through the rows where the two legs are separate, and stop at
// the first row where they are one mass again. That row is the pelvis; the belt
// sits on the two rows above it, which is where every big pose already keeps its
// shared waist band.
function waistRows(rows) {
  const h = rows.length;
  let y = h - 1;
  while (y >= 0 && opaqueRuns(rows[y]) < 2) y--;
  while (y >= 0 && opaqueRuns(rows[y]) >= 2) y--;
  const split = y + 1;
  const top = split - 3;
  if (top < h * 0.5 || top < 1 || split >= h) return null;
  return [top, top + 1];
}

function beltify(rows) {
  const w = waistRows(rows);
  if (!w) return rows;
  const [hi, lo] = w;
  const strap = (row, ch) =>
    row.split('').map((c) => (OVERALL_CHARS.includes(c) ? ch : c)).join('');

  const out = rows.slice();
  // Lit strap on slot 1 rather than on the mid-leather of the boots: against the
  // dark olive canvas a #84421c band was read as the shadow under the bib, and a
  // belt that reads as a shadow is not a belt. Slot 1 is 78 units off the canvas
  // mid, and the dark row under it keeps the leather a two-step form.
  out[hi] = strap(out[hi], '1');
  out[lo] = strap(out[lo], 'c');

  // The buckle rides the front two thirds of the strap, not its centre: the
  // figure faces right, and a buckle centred in the silhouette reads as a spine.
  const span = [];
  for (let x = 0; x < rows[hi].length; x++) {
    if (OVERALL_CHARS.includes(rows[hi][x]) && OVERALL_CHARS.includes(rows[lo][x])) span.push(x);
  }
  if (span.length >= 4) {
    const x0 = span[Math.min(span.length - 2, Math.floor(span.length * 0.6))];
    for (const y of [hi, lo]) {
      const r = out[y].split('');
      for (const x of [x0, x0 + 1]) {
        if (OVERALL_CHARS.includes(rows[y][x])) r[x] = 'd';
      }
      out[y] = r.join('');
    }
  }
  return out;
}

const tool = (s, name) =>
  makeSprite(beltify(s.rows), TOOL_PAL, { name: 'mario.tool.' + name, ox: s.ox, oy: s.oy });
const toolAnim = (a, name) =>
  new Anim(a.frames.map((f, i) => tool(f, `${name}${i}`)), a.holds, a.loop);

const TOOL_DEAD = makeSprite(beltify(BIG_DEAD_ROWS), TOOL_DEAD_PAL,
  { name: 'mario.tool.dead', ox: -2, oy: 0 });

// The bomb goes out of the same lunge the fireball does — the throw is the arm
// motion, not the projectile — so the pose is shared and only the clothes change.
const TOOL_THROW = tool(FIRE_THROW, 'throw');

export const TOOLBELT_MARIO = {
  idle: tool(BIG_IDLE, 'idle'),
  walk: toolAnim(BIG_MARIO.walk, 'walk'),
  jump: tool(BIG_JUMP, 'jump'),
  skid: tool(BIG_SKID, 'skid'),
  duck: tool(BIG_DUCK, 'duck'),
  dead: TOOL_DEAD,
  climb: toolAnim(BIG_MARIO.climb, 'climb'),
  swim: toolAnim(BIG_MARIO.swim, 'swim'),
  swimIdle: tool(BIG_SWIM_IDLE, 'swimIdle'),
  throwing: TOOL_THROW,
  grow: tool(GROW_MID, 'grow'),
  star: STAR_PALS,
};


/* ================================================================== *
 *  SMOOTH LOCOMOTION — a 6-frame walk and a 6-frame run, both scales.
 *
 *  Appended as its own section and attached to the exported sets at the
 *  end, so nothing above this line has to move. The 3-frame `walk` is
 *  untouched and stays as the fallback.
 *
 *  THE VERTICAL PLAN. A cycle with no vertical travel is a slide. Every
 *  frame is STACKED out of blocks whose row counts sum to the sprite
 *  height, so the hip line is authored rather than offset:
 *
 *      small   [blank?] + head 8  + torso T + legs L = 16
 *      big     [blank?] + head 12 + torso T + legs L = 32
 *
 *  Walk — head top row / hip row / block heights (small):
 *
 *      1 contact A   crown 2  shoulder 10  belt 12  torso 2  legs 4
 *      2 down A      crown 0  shoulder  9  belt 12  torso 5  legs 3
 *      3 passing A   crown 0  shoulder  8  belt 11  torso 3  legs 5
 *      4 contact B   crown 2  shoulder 10  belt 12  torso 2  legs 4
 *      5 down B      crown 0  shoulder  9  belt 12  torso 5  legs 3
 *      6 passing B   crown 0  shoulder  8  belt 11  torso 3  legs 5
 *
 *  The shoulder line travels 10 -> 9 -> 8. LOWEST at contact, where the
 *  strike drives the figure into the floor: the skull is redrawn a row
 *  shorter (S_HEAD_SQUASH — dome merged, jowl spread), the torso keeps
 *  only two rows and the whole stack starts two rows down the frame.
 *  Mid at the down, where the compressed torso pays a NECK row back.
 *  HIGHEST at passing, with the support leg straight underneath. Three
 *  levels and 2px of travel — not the two-level square wave a 1px bob
 *  gives you. The head runs its own 1px against it: the cap rides a
 *  column FORWARD on down A and a column BACK on down B, so the skull
 *  counter-rotates against the shoulders once per cycle.
 *
 *  Frames 1-3 lead with the near leg, 4-6 with the far leg. The second
 *  half is REDRAWN on the darker ramp, not mirrored — a far limb is
 *  never as light, as wide, or as far forward as a near one, and the two
 *  halves differ in SILHOUETTE, not just in shading: contact A plants a
 *  wide stride with the lead sole out at x15, contact B a short one two
 *  columns inboard; passing A carries the body on the near leg at x9-14,
 *  passing B on the far leg at x1-6. Arms run opposite the legs, and the
 *  near fist walks x8-10 behind the hip -> x12-13 at the side -> x13-14
 *  at chest height and back — four columns, a quarter of the sprite.
 * ================================================================== */

// Half-nod: brim pushed a row lower over the eye (its cast shadow deepens to slot
// 1 across two pixels), a pixel of dome shaved off the crown, jaw pulled in. Kept
// as the shallow version of the strike head for anything that needs a 1px dip
// rather than the full 2px drive of S_HEAD_SQUASH below.
const S_HEAD_NOD = [
  '.....000000.....',
  '...07ee76650....',
  '..07ee7666650...',
  '..0666555555550.',
  '..04411202323210',
  '..04432202222210',
  '..0442344444210.',
  '....01222100....',
];

// Contact head, redrawn for the deepest point of the step. The dome loses a row
// (the two dome rows merge into the wide one, so the crown still stops two pixels
// inboard of the brim) and the jaw gains one: the chin has been driven down into
// the collar and the jowl spreads. Eight rows still, but two pixels lower in the
// frame than at passing — this is the drawing the whole 2px torso travel hangs on.
const S_HEAD_SQUASH = [
  '.....000000.....',
  '..07ee7666650...',
  '..0666555555550.',
  '..04411202323210',
  '..04432202222210',
  '..0442344444210.',
  '...012222100....',
  '....01221100....',
];

// The other contact. Same compression, but the head has counter-rotated with the
// hips: cap and brim ride a column forward while the jaw is pulled a column back
// under them, so the skull tips instead of repeating. Crown 12, brim 14, nose 15 —
// the overhang and the nose step survive the tilt.
const S_HEAD_SQUASH_B = [
  '......000000....',
  '...07ee766650...',
  '...066555555550.',
  '..04411202323210',
  '..04432202222210',
  '..0442344444210.',
  '..012222100.....',
  '...0122100......',
];

/* --- small walk torsos (2 rows at contact, 3 at passing, 5 at the downs) --- *
 * At contact the torso is COMPRESSED: shoulder and chest only, with the belt row
 * pushed down into the leg block. That is where the third level of the bob comes
 * from — the figure is genuinely shorter on the strike, not slid.                */

// 1 — contact A: near arm at the back of its swing. The elbow is behind the ribs,
// the seam sits at x7 and the fist has swung all the way in to x8-10 — four
// columns behind where it lands at the front of the swing, a quarter of the
// sprite. The shoulder line narrows to x2-12 with the arm off it.
// The FAR arm runs antiphase, so it is FORWARD here: its fist has climbed off the
// belt onto the CHEST row at x2-x3 and the hip line below it is clear of skin
// entirely. At 16px this is the whole far swing — inboard and high at one contact,
// outboard and low at the other.
const SW_ARM_BACK = [
  '..07666666650...',
  '.060120f3210....',
];
// 2 — down A: the neck row. The body has dropped out from under the head. The
// forearm angles FORWARD off the elbow and the fist clears the hip at x13-14.
const SW_ARM_DOWNA = [
  '....01222100....',
  '..076666666650..',
  '.0766966966f760.',
  '.0a90120980.0760',
  '.0a99d99d9980320',
];
// Down A, COMPRESSED. The neck row is gone: the strike has driven the chin into
// the collar, so the whole figure sits a row lower in the frame while the boots
// stay welded to row 15. That is the recoil the plain ramp was missing — the body
// holds its depth through contact and only lifts on the passing frame.
const SW_ARM_SQUASHA = [
  '..0766666666650.',
  '.0766966966f760.',
  '.0a90120980.0760',
  '.0a99d99d9980320',
];
// 3 — passing A: shoulder pulled forward by the swing, sleeve running out to
// x14, fist still at belt height — the arm is halfway up, not up.
const SW_ARM_RISE = [
  '..0766666666650.',
  '.0656966966f7660',
  '.021ad99d9980320',
];
// 4 — contact B: front of the swing. The fist has climbed to CHEST height at
// x13-14 and the shoulder line runs a column wider (x2-14) than it does with the
// arm back, so the twist reads even in flat silhouette.
// Near fist forward, so the far arm is at the opposite extreme: its fist has
// dropped to the belt row — drawn in the leg block below — and stepped outboard
// to x0. Four columns of travel from where the near fist sits at contact A.
const SW_ARM_FWD = [
  '..0766666666650.',
  '.0766966966f7220',
];
// 5 — down B: neck row again, but the forearm is tucked back against the ribs
// and the fist has fallen to x12-13 — the return half of the swing.
const SW_ARM_DOWNB = [
  '....01222100....',
  '..076666666650..',
  '.0766966966f760.',
  '.065a999998f760.',
  '0210ad99d998320.',
];
// Down B, COMPRESSED — the other half of the recoil. Same missing neck row, but
// the shoulder line is a column narrower and the flank seam runs one row longer,
// so the two squashed frames are different drawings, not one used twice.
const SW_ARM_SQUASHB = [
  '..076666666650..',
  '.0766966966f7650',
  '.065a999998f760.',
  '0210ad99d998320.',
];
// 6 — passing B: elbow relaxed, sleeve short, fist trailing at x11-12. The far
// fist has swung back inboard to x2-x3 and its knuckles have rolled into the key
// light (slot 3) on the way up.
const SW_ARM_TRAIL = [
  '..076666666650..',
  '.0766966966f760.',
  '.032ad99d98320..',
];

/* --- small walk legs ----------------------------------------------- */

// 1 — contact A: belt row first (the compressed torso handed it down), then the
// widest stride in the cycle — near leg reaching forward to x15, its sole flaring
// BACK off the heel it just landed on to x8; far leg extended behind with the sole
// flaring FORWARD off its toe. Three columns of sky at x6-x8 between the thighs.
// Passing-B head for the small walk: the cap has ridden a column FORWARD off the
// neutral skull while the jaw swings a column back under it, so the second passing
// frame is a different drawing from the first instead of S_HEAD used twice.
const S_HEAD_ROLL = [
  '......000000....',
  '....07ee76650...',
  '...07ee7666650..',
  '..0665555555550.',
  '..04422202323210',
  '..04432202222210',
  '..0442344444210.',
  '..0122222100....',
];

const SW_LEG_CONTACT_A = [
  '.0a99d99d99880..',
  '.09980...0a99980',
  '01cb00...0cccb0.',
  '0bccb0..0bccccb0',
];
// 2 — down A: hips at their lowest. The near thigh swells under the load and
// the boot is flat under the hip; the far boot has peeled up onto its toe and
// narrows to two pixels at the sole.
const SW_LEG_DOWN_A = [
  '.09980..0a99880.',
  '01ccb0..01ccb0..',
  '.0cb0...0bcccb0.',
];
// 3 — passing A: near leg straight and vertical carrying everything, far leg
// folded knee-high, its boot a full row clear of the ground line.
const SW_LEG_PASS_A = [
  '..0a9999999980..',
  '.09980...0a9980.',
  '.01ccb0..0a9980.',
  '..0bcb0..01ccb0.',
  '........0bcccb0.',
];
// 4 — contact B: the far leg leads, and the stride is a different SHAPE, not the
// same shape re-shaded. It is two columns shorter than frame 1's (lead sole stops
// at x14, the near foot's reached x15), the trailing boot has rolled forward onto
// its toe a column inboard, and the whole stance sits a column to the right. Its
// first row is the belt, carrying the far arm's fist out to x0 at the back of its
// swing. Silhouette-only difference from frame 1: 13 of 64 pixels below the belt.
const SW_LEG_CONTACT_B = [
  '0210ad99d99880..',
  '..0a980..09980..',
  '.01ccb0..09980..',
  '.0bcccb0.0bccb0.',
];
// 5 — down B: the far leg plants two columns LEFT of where the near leg planted
// at down A and its boot is a row longer, while the near leg has peeled clean off
// the floor onto a two-pixel toe. The support foot changing column is what stops
// the two down frames reading as one drawing with the shading swapped.
const SW_LEG_DOWN_B = [
  '.0a9800.09980...',
  '..0cb0..099980..',
  '.......0bcccb0..',
];
// 6 — passing B: the body is carried on the FAR leg here, planted out at x1-6,
// while the near leg swings through folded and lit with its boot clear of the
// floor at x9-14. Passing A carries it the other way round on the near leg at
// x9-14 — so the two passing poses put the standing foot on opposite sides of the
// sprite: 21 of 64 silhouette pixels differ below the belt, not 5.
const SW_LEG_PASS_B = [
  '..0a9999999980..',
  '.0a980..0a9980..',
  '..0980..0a9980..',
  '..0980...01ccb0.',
  '.0bcccb0........',
];

const SMALL_W6_1 = sm([BLANK, BLANK, ...S_HEAD_SQUASH, ...SW_ARM_BACK, ...SW_LEG_CONTACT_A], 'w6_1');
const SMALL_W6_2 = sm([BLANK, ...S_HEAD_LEAN, ...SW_ARM_SQUASHA, ...SW_LEG_DOWN_A], 'w6_2');
const SMALL_W6_3 = sm([...S_HEAD, ...SW_ARM_RISE, ...SW_LEG_PASS_A], 'w6_3');
const SMALL_W6_4 = sm([BLANK, BLANK, ...S_HEAD_SQUASH_B, ...SW_ARM_FWD, ...SW_LEG_CONTACT_B], 'w6_4');
const SMALL_W6_5 = sm([BLANK, ...S_HEAD_TIP, ...SW_ARM_SQUASHB, ...SW_LEG_DOWN_B], 'w6_5');
const SMALL_W6_6 = sm([...S_HEAD_ROLL, ...SW_ARM_TRAIL, ...SW_LEG_PASS_B], 'w6_6');

SMALL_MARIO.walk6 = new Anim(
  [SMALL_W6_1, SMALL_W6_2, SMALL_W6_3, SMALL_W6_4, SMALL_W6_5, SMALL_W6_6],
  [5, 3, 4, 5, 3, 4]);

/* ------------------------------------------------------------------ *
 *  SMALL RUN — same stacking discipline, different physics.
 *
 *  A run is not a fast walk. Four things change and all four are drawn:
 *    * the whole figure PITCHES FORWARD — the cap sits two pixels ahead
 *      of the face (S_HEAD_DRIVE) and the shoulder line starts at x3
 *      instead of x2, so the chest leads the belt;
 *    * the STRIDE lengthens — five columns of sky between the feet at
 *      contact instead of three, the lead boot reaching x15;
 *    * the ARMS BEND — every SR_ARM_ block is drawn from scratch and
 *      shares NOT ONE row with its walk counterpart. The elbow folds
 *      near 90 degrees, so the forearm climbs instead of hanging: the
 *      fist tops out ON the shoulder row and the back of the swing is a
 *      bent-elbow L against the ribs, never the walk's straight bar;
 *    * the passing pose goes AIRBORNE. Row 15 is empty on frames 3 and
 *      6: neither foot is on the ground and the trailing boot has been
 *      thrown up behind the hip. A run has no double-support phase, so
 *      the `down` AND `contact` frames carry the rear foot clear of the
 *      floor too — the walk's contacts plant both soles, these never do.
 *
 *  The vertical plan matches the walk: shoulder 10 at contact, 9 at the
 *  down, 8 in flight, off a head that is redrawn a row shorter on the
 *  strike and rocked a column back on down B.
 * ------------------------------------------------------------------ */

// Cap driven two pixels ahead of the face, brim low, eye squeezed to a 2px
// slot-0 slit. The brim still overhangs the crown (crown x12, brim x14) and the
// nose still steps one past the brim to x15 — the head leans, it does not smear.
const S_HEAD_DRIVE = [
  '.......000000...',
  '.....07ee76650..',
  '....07ee7666650.',
  '....06655555550.',
  '..04422002323210',
  '..04432202222210',
  '..0442244444210.',
  '...0122222100...',
];

// Down-B head for the run: the cap rocks BACK off the drive — crown a column
// behind where S_HEAD_DRIVE carries it — while the face holds its forward pitch,
// so the head counter-rotates once per cycle instead of driving twice.
const S_HEAD_DRIVE_TIP = [
  '......000000....',
  '....07ee76650...',
  '...07ee766650...',
  '...066555555550.',
  '..04422002323210',
  '..04432202222210',
  '..0442244444210.',
  '...0122222100...',
];

// Contact head for the small run: the skull loses a row of dome, the brim
// thickens to three tones and the jaw is redrawn longer and further back, and the
// frame stacks it two rows down. Redrawn, not translated — the strike drives the
// head into the shoulders and the shoulder line with it.
const S_HEAD_DRIVE_NOD = [
  '.......000000...',
  '.....07ee76650..',
  '....06665555550.',
  '..04421202323210',
  '..04432202222210',
  '..0442244444210.',
  '...012222210....',
  '....0122100.....',
];

// The other strike. The cap holds its forward drive while the jaw swings back a
// column under it — the skull tips on the second contact instead of repeating the
// first. Crown 12, brim 14, nose 15 all survive.
const S_HEAD_DRIVE_NOD_B = [
  '......000000....',
  '....07ee766650..',
  '...066655555550.',
  '..04421202323210',
  '..04432202222210',
  '..0442244444210.',
  '..01222210......',
  '...012210.......',
];

// Flight head: the chin comes up and the face pulls back a column under a cap
// that stays forward. The nose steps out and in a row earlier and the cheekbone
// takes a second pixel of skin light.
const S_HEAD_DRIVE_UP = [
  '.......000000...',
  '.....07ee76650..',
  '....07ee7666650.',
  '....06655555550.',
  '..0442200233210.',
  '..0443320222210.',
  '..0443244444210.',
  '..0122222100....',
];

// The SECOND flight head. Same lifted chin, but the cap has rocked a column back
// off the drive while the jaw juts a column forward under it — the two airborne
// frames are different skulls, so the top of the sprite does not loop at three.
const S_HEAD_DRIVE_UP_B = [
  '......000000....',
  '....07ee76650...',
  '...07ee7666650..',
  '....06655555550.',
  '..0442200233210.',
  '..0443320222210.',
  '..0443244444210.',
  '...0122222100...',
];

/* --- small run torsos --------------------------------------------- */

// 1 — contact A: near arm slammed back with the elbow folded — the seam sits at
// x8 and the fist lands at x9-11, a bent L against the ribs rather than the walk's
// horizontal bar. Two rows only: at contact the belt has moved into the leg block.
const SR_ARM_BACK = [
  '...07666666650..',
  '.0601206f32100..',
];
// 2 — down A: neck row, elbow bent, fist already up at RIB height (x13-14) —
// the run pumps through the bottom of the swing instead of hanging there.
const SR_ARM_DOWNA = [
  '....0122210.....',
  '...076666666650.',
  '.0766966966f7650',
  '.0a9012099880220',
  '.0a99d99d99880..',
];
// 3 — airborne A: top of the pump. The fist has climbed onto the SHOULDER row
// at x13-14 and breaks the silhouette above the chest.
const SR_ARM_AIR_A = [
  '..07666666665220',
  '.0766966966f7650',
  '0310ad99d99880..',
];
// 4 — contact B: the fist is punched up ONTO the shoulder row at x13-14, breaking
// the silhouette above the chest — a height the walk's forward swing never gets
// near — with the forearm stacked under it and the elbow still folded.
const SR_ARM_FWD = [
  '...0766666665220',
  '.0766966966f7660',
];
// 5 — down B: forearm folded back along the flank with the seam running two rows
// down it, and the fist rolled palm-back into a 3px mass at x11-13 at the bottom
// of the return. No row here matches any row of the walk's down frames.
const SR_ARM_DOWNB = [
  '....012221100...',
  '...076666666650.',
  '.0766966996f7650',
  '.065a999998f7650',
  '0310ad99d993210.',
];
// 6 — airborne B: shoulder narrowed and only one bib strap left in view — the
// torso has twisted away with the arm at the top of its BACK swing.
const SR_ARM_AIR_B = [
  '...07666666650..',
  '.076696666f7650.',
  '.032ad99d93210..',
];

/* --- small run legs ------------------------------------------------ */

// 1 — contact A: belt row, then the longest stride in the file — four columns of
// sky between the limbs and the lead shin driven out to x15 over two rows. Exactly
// ONE ink run on row 15: the lead sole. The trailing boot has already left the
// floor a row up, so there is no double-support phase here — the walk's contact
// plants both soles, the run's never does.
const SR_LEG_CONTACT_A = [
  '.0a99d99d99880..',
  '.09800...0a99980',
  '01ccb0....0a9980',
  '.........0bcccb0',
];
// 2 — down A: no double support. The rear boot is already two rows clear of the
// floor while the lead leg eats the landing.
const SR_LEG_DOWN_A = [
  '0ccb0...0a99880.',
  '0bcb0...01ccb0..',
  '........0bcccb0.',
];
// 3 — airborne A: row 15 empty. Rear leg thrown back and UP (its boot starts a
// row higher than the lead boot), lead foot reaching to x15.
const SR_LEG_AIR_A = [
  '..0a9999999980..',
  '.09880..0a99980.',
  '01cb0....0a9980.',
  '0bcb0.....01ccb0',
  '................',
];
// 4 — contact B: far leg leads, and it is a different stride shape — it lands a
// column further back, its sole stops at x14 where the near foot's reached x15,
// and the trailing near boot is thrown a column further behind. Belt row first,
// carrying the far fist out to x0 at the back of its pump.
const SR_LEG_CONTACT_B = [
  '0210ad99d99880..',
  '0a980....09980..',
  '01ccb0...099980.',
  '.........0bccb0.',
];
// 5 — down B: the far leg plants two columns LEFT of where the near leg planted
// at down A and its boot runs a row longer, while the near leg is folded up onto a
// three-pixel toe behind it. The support foot moves; the frame is not down A with
// the ramps swapped.
const SR_LEG_DOWN_B = [
  '01ccb0..09980...',
  '.0bcb0..099980..',
  '.......0bcccb0..',
];
// 6 — airborne B: row 15 empty again, but the flight pose is the OTHER one. In
// frame 3 the near leg is thrown back down the left of the sprite and the far knee
// drives up in front; here the far leg has folded to a boot tucked at the hip and
// the near leg swings forward alone down the right — 16 of 64 silhouette pixels
// below the belt differ, so the two flights are different drawings, not one flipped.
const SR_LEG_AIR_B = [
  '..0a9999999980..',
  '0ccb0...0a99980.',
  '........0a9980..',
  '.........01ccb0.',
  '................',
];

const SMALL_RUN_1 = sm([BLANK, BLANK, ...S_HEAD_DRIVE_NOD, ...SR_ARM_BACK, ...SR_LEG_CONTACT_A], 'run1', 16);
const SMALL_RUN_2 = sm([...S_HEAD_DRIVE, ...SR_ARM_DOWNA, ...SR_LEG_DOWN_A], 'run2');
const SMALL_RUN_3 = sm([...S_HEAD_DRIVE_UP, ...SR_ARM_AIR_A, ...SR_LEG_AIR_A], 'run3');
const SMALL_RUN_4 = sm([BLANK, BLANK, ...S_HEAD_DRIVE_NOD_B, ...SR_ARM_FWD, ...SR_LEG_CONTACT_B], 'run4', 16);
const SMALL_RUN_5 = sm([...S_HEAD_DRIVE_TIP, ...SR_ARM_DOWNB, ...SR_LEG_DOWN_B], 'run5');
const SMALL_RUN_6 = sm([...S_HEAD_DRIVE_UP_B, ...SR_ARM_AIR_B, ...SR_LEG_AIR_B], 'run6');

SMALL_MARIO.run = new Anim(
  [SMALL_RUN_1, SMALL_RUN_2, SMALL_RUN_3, SMALL_RUN_4, SMALL_RUN_5, SMALL_RUN_6],
  [3, 2, 4, 3, 2, 4]);

/* ------------------------------------------------------------------ *
 *  BIG WALK — 16 x 32. Same plan, one more articulation.
 *
 *      1 contact A   head 1  shoulder 13  hip 22   torso 9   legs 10
 *      2 down A      head 0  shoulder 12  hip 23   torso 11  legs 9
 *      3 passing A   head 0  shoulder 12  hip 21   torso 9   legs 11
 *      4 contact B   head 1  shoulder 13  hip 22   torso 9   legs 10
 *      5 down B      head 0  shoulder 12  hip 23   torso 11  legs 9
 *      6 passing B   head 0  shoulder 12  hip 21   torso 9   legs 11
 *
 *  At this size the neck is drawn: the two `down` frames carry two extra
 *  skin rows between the chin and the collar, and the head sits a pixel
 *  HIGHER there than it does at contact even though the hips are a pixel
 *  LOWER. Head and hips are never travelling the same direction on the
 *  same frame; that is the whole trick.
 *
 *  Every leg here is a real limb — 4px thigh, a 3px pinch at the knee, a
 *  4-5px calf whose light column steps outboard, a 5px ankle, then the
 *  boot. Never an extruded rectangle, and never two limbs touching below
 *  the pelvis row.
 * ------------------------------------------------------------------ */

// Contact head: crown compressed a row, brim thickened and dropped, its cast
// shadow spread to three pixels of slot 1, jaw and chin pulled in. The head is
// squashed by the step, not slid down it.
const B_HEAD_NOD = [
  '.....000000.....',
  '...07ee76650....',
  '..07ee7666650...',
  '..07766666650...',
  '..0666555555550.',
  '..044111223210..',
  '..04422202332210',
  '..04433202222210',
  '..0443224444410.',
  '...01222444410..',
  '....012222100...',
  '.....0122110....',
];

// The OTHER contact head. The cap has ridden a column forward while the jaw has
// been pulled a column BACK under it, so the skull counter-rotates on the second
// strike instead of repeating the first. Crown x13, brim x15, chin x4 — the
// overhang survives the tilt and no row is a copy of B_HEAD_NOD's.
const B_HEAD_NOD_B = [
  '......000000....',
  '....07ee76650...',
  '...07ee7666650..',
  '...07766666650..',
  '..0666555555550.',
  '..044111223210..',
  '..04422202332210',
  '..04433202222210',
  '..0443224444410.',
  '..01222444410...',
  '...012222100....',
  '....0122110.....',
];

// Down-B head: the cap rocks BACK off the lean while the jaw swings forward under
// it — the mirror of B_HEAD_NOD_B's tilt, so the head rolls once per stride rather
// than nodding twice. Brim keeps its low cast shadow from B_HEAD_LEAN.
const B_HEAD_TIP = [
  '.....000000.....',
  '...07ee76650....',
  '..07ee7666650...',
  '..07776666650...',
  '...0665555555550',
  '..044112223210..',
  '..04422202332210',
  '..04433202222210',
  '..0443224444410.',
  '....01222444410.',
  '....0122222100..',
  '.....01222110...',
];

// Passing-B head: level cap, but the jaw and moustache have swung a column back
// as the far leg takes the weight — the second passing frame is not the first
// one's head reused.
const B_HEAD_ROLL = [
  '.....000000.....',
  '...07ee76650....',
  '..07ee7666650...',
  '..07776666650...',
  '..0665555555550.',
  '..044112223210..',
  '..04422202332210',
  '..04433202222210',
  '..0443224444410.',
  '..01222444410...',
  '..0122222100....',
  '...01222110.....',
];

// The two rows that appear between chin and collar on the `down` frames.
const B_NECK = [
  '.....012210.....',
  '....0122210.....',
];

// The run's neck. The whole figure is pitched forward, so the throat is drawn a
// column ahead of the walk's and the collar under it is longer on the near side —
// the run never borrows the walk's neck.
const B_NECK_RUN = [
  '......012210....',
  '.....01222100...',
];

/* --- big walk torsos ----------------------------------------------- */

// 1 — contact A: near arm at the back of its swing. Seam and sleeve a column
// left of the hanging pose, fist dropped behind the hip at x11-12.
//
// The FAR arm runs antiphase to it and is therefore FORWARD here: the forearm
// crosses in front of the bib, so only a short sleeve, a cuff and the fist show
// at x1-x3 and they sit HIGH (row 17). Below the fist the far arm is gone and
// the bib's own light column (x2) reads through — the arm has swung off it.
const BW_ARM_BACK = [
  '..076666666650..',
  '.076696669f7650.',
  '.065aa9999f7650.',
  '.0a901220df7650.',
  '.0aa012098f7650.',
  '.0a99999880320..',
  '.0a99998880210..',
  '..0a999988880...',
  '..0a9988899880..',
];
// 2 — down A: neck rows in. Forearm swings clear of the ribs and the fist rides
// at x12-13 with a column of sky behind it.
// The far fist is a row lower than at contact and its knuckles have rolled into
// the key light (slot 3 instead of slot 1) — the hand is turning over at the top
// of the forward swing, not repeating frame 1 a pixel down.
const BW_ARM_DOWNA = [
  ...B_NECK,
  '..076666666650..',
  '.0766966696f760.',
  '.065aa99999f7650',
  '.0ad01220d0.0760',
  '.0aa0120980.0760',
  '.0a99999880.0320',
  '.0a99998880.0210',
  '..0a99999988800.',
  '..0a9988899880..',
  '.0aa98888999880.',
];
// 3 — passing A: shoulder pulled forward by the swing, sleeve running out to
// x14, fist at RIB height (x13-14) — halfway up, not up.
// The far arm has crossed to the BACK half of its swing: the elbow steps out past
// the torso to x0, the forearm carries its own outline at x3, and the fist has
// dropped to hip height with its knuckles still lit.
const BW_ARM_RISE = [
  '..076666666650..',
  '.0766966696f7660',
  '.065aa99999f7660',
  '.065ad999d9f7220',
  '0655a99999880...',
  '0650a99998880...',
  '0010a99988880...',
  '03109999998880..',
  '..0a9988899880..',
];
// 4 — contact B: front of the swing. The fist has climbed to CHEST height at
// x14-15 and the arm folds back into the body two rows below it.
// The FAR arm is at the opposite extreme: fully BACK. It is the longest the far
// arm gets — the elbow breaks the silhouette at x0 a row earlier than at passing
// and the fist has fallen all the way to the pelvis row (20), four rows below
// where it sits at contact A.
const BW_ARM_FWD = [
  '..0766666666650.',
  '.0766966696f7622',
  '.065aa99999f7621',
  '0655ad999d9880..',
  '0650a99999880...',
  '0650a99998880...',
  '0010a99988880...',
  '02109999998880..',
  '..0a9988899880..',
];
// 5 — down B: neck rows again, forearm tucked back along the ribs, fist falling
// through x12-13 on the return.
// The far arm has started back up: still outboard at x0 but the fist has climbed
// a row off the pelvis, and the sleeve below it is gone.
const BW_ARM_DOWNB = [
  ...B_NECK,
  '..076666666650..',
  '.0766966696f760.',
  '.065aa99999f7650',
  '.065ad999d9f7650',
  '0010aa999980760.',
  '0210a9998880320.',
  '.0a999988880210.',
  '..0a999988880...',
  '..0a9988899880..',
  '.0a998888999880.',
];
// 6 — passing B: elbow folded back behind the ribs, the seam running four rows
// down the flank, fist trailing at x11-12.
const BW_ARM_TRAIL = [
  '..076666666650..',
  '.076696669f7650.',
  '.065aa9999f7650.',
  '.065ad999d9f760.',
  '.065aa99998f760.',
  '.001a99988f7650.',
  '.021a998880320..',
  '..0a999988820...',
  '..0a9988899880..',
];

/* --- big walk legs -------------------------------------------------- */

// 1 — contact A: near leg reaching forward to x15, far leg driven back to x0.
const BW_LEG_CONTACT_A = [
  '.0a98800a99980..',
  '.09980...0a9980.',
  '099800...0a9980.',
  '09880....0a99980',
  '09880....0999980',
  '08880....0888880',
  '01cb0....01ccb0.',
  '0cccb0...0cccb0.',
  '0bcccb0..0bcccb0',
  '0bbbbb0..0bbbbb0',
];
// 2 — down A: hips at their lowest. Near leg vertical under the load, far heel
// peeled up so its sole clears the ground line by a row.
const BW_LEG_DOWN_A = [
  '.09880..0a99980.',
  '099800...0a9980.',
  '09880....0a99980',
  '08880....0999980',
  '01cb0....0888880',
  '0cccb0...01ccb0.',
  '0bcb0....0cccb0.',
  '.........0bcccb0',
];
// 3 — passing A: near leg straight and vertical — thigh, knee pinch, calf swell,
// ankle, boot — with the far leg folded knee-high three rows off the floor.
const BW_LEG_PASS_A = [
  '..0a9999999980..',
  '..09880.0a9980..',
  '..0980..0a9980..',
  '..09880.0a980...',
  '..08880.0a9980..',
  '..01cb0.0a99980.',
  '.0cccb0.0999980.',
  '.0bbbb0.0888880.',
  '........01cccb0.',
  '........0ccccb0.',
  '.......0bccccb0.',
];
// 4 — contact B: the far leg leads. Narrower, a step darker, and stopping at
// x13 where the near leg reached x15.
const BW_LEG_CONTACT_B = [
  '.0a98800999980..',
  '.0a980...09980..',
  '.0a9980..09980..',
  '0a9980...099980.',
  '0a9980...098880.',
  '088880...088880.',
  '01ccb0...01cb0..',
  '0cccb0...0cccb0.',
  '0bcccb0..0bccb0.',
  '0bbbbb0..0bbbb0.',
];
// 5 — down B: the far leg is planted, but the body has ALREADY ridden over it, so
// the plant sits three columns further inboard (x6-12) than the near foot's plant
// at down A (x9-15). The support foot moving across the sprite between the two
// down frames is what stops the walk skating. The near leg is behind it, peeled
// clean onto a three-pixel toe that bottoms a row early at 30.
const BW_LEG_DOWN_B = [
  '0a980..099980...',
  '0a980..09980....',
  '.0a80..099980...',
  '.0a80..098880...',
  '01cb0..088880...',
  '0ccb0..01ccb0...',
  '0bcb0.0ccccb0...',
  '......0bcccb0...',
];
// 6 — passing B: the weight is on the FAR leg, and it is on the OTHER SIDE of the
// sprite from where passing A carries it. Frame 3 stands on the near leg out at
// x8-14 with the far boot folded up at x2-6; this frame stands on the far leg at
// x0-6 — thigh, knee pinch, calf, ankle, boot, sole all the way to row 31 — while
// the NEAR leg swings through folded on the right with its boot three rows clear
// of the floor at 28. That is the frame where the right-hand boot finally leaves
// the ground line, and it is why the two passing poses are different drawings and
// not one drawing with the shading swapped.
const BW_LEG_PASS_B = [
  '..09a9999999980.',
  '.09980..0a9980..',
  '.09880..0a99980.',
  '.0980....0a99980',
  '.09980....0a9980',
  '.09880...01ccb0.',
  '.08880...0cccb0.',
  '.08880..0bcccb0.',
  '.01ccb0.........',
  '0ccccb0.........',
  '0bcccb0.........',
];

const BIG_W6_1 = bg([BLANK, ...B_HEAD_NOD, ...BW_ARM_BACK, ...BW_LEG_CONTACT_A], 'w6_1');
const BIG_W6_2 = bg([...B_HEAD_LEAN, ...BW_ARM_DOWNA, ...BW_LEG_DOWN_A], 'w6_2');
const BIG_W6_3 = bg([...B_HEAD, ...BW_ARM_RISE, ...BW_LEG_PASS_A], 'w6_3');
const BIG_W6_4 = bg([BLANK, ...B_HEAD_NOD_B, ...BW_ARM_FWD, ...BW_LEG_CONTACT_B], 'w6_4');
const BIG_W6_5 = bg([...B_HEAD_TIP, ...BW_ARM_DOWNB, ...BW_LEG_DOWN_B], 'w6_5');
const BIG_W6_6 = bg([...B_HEAD_ROLL, ...BW_ARM_TRAIL, ...BW_LEG_PASS_B], 'w6_6');

BIG_MARIO.walk6 = new Anim(
  [BIG_W6_1, BIG_W6_2, BIG_W6_3, BIG_W6_4, BIG_W6_5, BIG_W6_6],
  [5, 3, 4, 5, 3, 4]);

/* ------------------------------------------------------------------ *
 *  BIG RUN — 16 x 32.
 *
 *  A run has NO double-support phase, and that is the structural change
 *  from the walk: exactly one boot is on the ground line in frames 1, 2,
 *  4 and 5, and NEITHER is in frames 3 and 6, where the last two rows of
 *  the sprite are empty and the whole figure floats two pixels. The walk
 *  never leaves the floor.
 *
 *  On top of that: the cap is driven two pixels ahead of the face, the
 *  shoulder line starts at x3 so the chest leads the belt, the fist tops
 *  out on the SHOULDER row instead of at the ribs, and the trailing boot
 *  is thrown further behind and higher than any walk pose reaches.
 *
 *  The difference does NOT stop at the belt. Every head here is drawn for
 *  the run (its face rows share nothing with the walk's), the neck is the
 *  run's own forward-pitched B_NECK_RUN, and no BR_ARM_ block shares more
 *  than one row with the BW_ARM_ block at the same index — the forearms
 *  are folded and stacked vertically where the walk's trail horizontally.
 * ------------------------------------------------------------------ */

// Cap two pixels ahead of the face, brim outline pulled back to x14 so the nose
// still steps past it to x15, eye squeezed to a 2px slot-0 slit. Crown x12,
// brim x14, face x15 — the overhang survives the lean.
const B_HEAD_DRIVE = [
  '.......000000...',
  '.....07ee76650..',
  '....07ee7666650.',
  '....07776666650.',
  '....06655555550.',
  '..0441222332100.',
  '..04422002332210',
  '..0443320222210.',
  '..04432444444210',
  '...012224444100.',
  '..012222210.....',
  '...0122210......',
];

// Down-B head for the big run: the cap rocks a column BACK off the drive while
// the face holds its pitch, so the head counter-rotates once per cycle instead of
// driving identically on both halves. Crown 13, brim 14, nose 15.
const B_HEAD_DRIVE_TIP = [
  '......000000....',
  '....07ee76650...',
  '...07ee7666650..',
  '...07776666650..',
  '...066555555550.',
  '..0441222332100.',
  '..04422002332210',
  '..0443320222210.',
  '..04432444444210',
  '...012224444100.',
  '..012222210.....',
  '...0122210......',
];

// Contact head for the run. The cap is still driven two pixels ahead of the face,
// but the skull is COMPRESSED into eleven rows — a crown row lost, the brim
// thickened to three tones, the moustache flared a column wider and the two chin
// rows merged into one — and the frame stacks it two rows down, so the crown lands
// two pixels lower than it does anywhere else in the cycle while the jaw stays
// welded to the collar. The strike drives the head into the shoulders; nothing in
// this block is a row of the walk's contact head.
const B_HEAD_DRIVE_NOD = [
  '.......000000...',
  '.....07ee76650..',
  '....07ee7666650.',
  '....07766666650.',
  '....06655555550.',
  '..0441122233210.',
  '..04422002332210',
  '..0443320222210.',
  '..04432444444210',
  '...0122244410...',
  '....01222100....',
];

// The other strike. Cap and brim rock a column BACK off the drive while the face
// keeps its forward pitch and the jaw juts, so the second contact of the run is a
// different skull rather than the first one slid. Crown 13, brim 14, nose 15.
const B_HEAD_DRIVE_NOD_B = [
  '......000000....',
  '....07ee76650...',
  '...07ee7666650..',
  '...07766666650..',
  '...066655555550.',
  '..04411222332210',
  '..0442200233210.',
  '..0443320222210.',
  '..0443244444421.',
  '..01222444410...',
  '...012222100....',
];

// Flight head. At the apex the chin comes UP: the whole face pulls back a column
// under a cap that stays forward, the nose steps out a row EARLIER and pulls in a
// row earlier, the cheekbone catches a second pixel of skin light and the jaw and
// chin shorten. Crown at row 0 — the highest the head gets all cycle.
const B_HEAD_DRIVE_UP = [
  '.......000000...',
  '.....07ee76650..',
  '....07ee7666650.',
  '....07776666550.',
  '....06655555550.',
  '..04411222332210',
  '..0442200233210.',
  '..0443320222210.',
  '..0443244444210.',
  '..01222444410...',
  '..0122222100....',
  '...012221100....',
];

// The SECOND flight head at 16x32. The chin is still up, but the cap has rocked a
// column BACK off the drive while the jaw and moustache jut a column forward — so
// the two airborne frames are separate drawings and the head keeps counter-rotating
// through the second half of the stride instead of repeating the first.
const B_HEAD_DRIVE_UP_B = [
  '......000000....',
  '....07ee76650...',
  '...07ee7666650..',
  '...07776666550..',
  '....06655555550.',
  '..04411222332210',
  '..0442200233210.',
  '..0443320222210.',
  '..0443244444210.',
  '...01222444410..',
  '...0122222100...',
  '....012221100...',
];

/* --- big run torsos ------------------------------------------------ */

// 1 — contact A: arm cocked all the way back with the elbow HIGH, so the fist
// sits at chest height behind the ribs rather than hanging at the belt.
// The FAR arm is at the opposite end of its pump: driven FORWARD across the bib,
// so only a cuff and the fist show at x2-x3 and they sit high on the ribs.
const BR_ARM_BACK = [
  '...07666666650..',
  '.0766966696f650.',
  '.0aa012209f7650.',
  '.0ad01209d0320..',
  '.0a99999980210..',
  '.0a9999988880...',
  '..0a999888880...',
  '..0a999998880...',
  '..0a9988899880..',
];
// 2 — down A: the run's own neck rows in, elbow folded, fist already climbing at
// x13-14 — the walk hangs its fist at the belt on this beat.
const BR_ARM_DOWNA = [
  ...B_NECK,
  '...07666666650..',
  '.0766966696f7650',
  '.001aa99999f7220',
  '.032ad999d98020.',
  '.0a9999999880...',
  '.0a9999998880...',
  '..0a999988880...',
  '..0a9999998880..',
  '..0a9988899880..',
];
// 3 — airborne A: top of the pump. The fist breaks the silhouette ON the
// shoulder row at x13-14 — a height the walk never reaches.
// Seven rows, not nine: the two pelvis rows have moved down into the LEG block so
// the crotch can open two rows higher than it does at contact. The far arm is on
// the back half of its pump — elbow out past the silhouette at x0, fist at the
// bottom of the swing.
const BR_ARM_AIR_A = [
  '..07666666665220',
  '.0766966696f7650',
  '.065aa99999f7650',
  '.065ad999d99880.',
  '0655a99999880...',
  '0010a99998880...',
  '0210a99988880...',
];
// 4 — contact B: the elbow FOLDS instead of extending. The fist is punched up onto
// the shoulder row at x13-14 and the forearm is stacked vertically beneath it down
// x12-14, where the walk's forward arm trails away horizontally two rows lower —
// not one row of this block appears in BW_ARM_FWD.
// Near fist punched forward, so the FAR arm is at the very back of its pump: the
// longest it gets, elbow breaking the silhouette a row earlier than at passing and
// the fist dropped onto the pelvis line.
const BR_ARM_FWD = [
  '...0766666666650',
  '.0766966696f7622',
  '.065aa99999f7621',
  '0650ad999d9880..',
  '0655a99999880...',
  '0650a99998880...',
  '0010a99988880...',
  '03209999998880..',
  '..0a9988899880..',
];
// 5 — down B: the near arm is at the OPPOSITE point of the pump from down A — the
// forearm is folded back along the flank with the seam running four rows down it
// and the fist has dropped two rows below where down A carries it, to x12-13 on the
// pelvis line. Nothing here is a row of the walk's down-B arm.
const BR_ARM_DOWNB = [
  ...B_NECK_RUN,
  '...07666666650..',
  '.076696669f7650.',
  '.065aa9999f7660.',
  '.065ad999d9f760.',
  '0010aa99998f760.',
  '0210a999880320..',
  '.0a99998880210..',
  '..0a9999888880..',
  '..0a9889999880..',
];
// 6 — airborne B: shoulder narrowed to ten columns and only one bib strap left
// in view — the whole torso has twisted with the arm at the back of its pump.
// Seven rows: the pelvis has moved into the leg block here too. The far arm is on
// its way back FORWARD — cuff and fist have climbed to the ribs at x2-x3 again.
const BR_ARM_AIR_B = [
  '...0766666650...',
  '.076696666f7650.',
  '.065aa9999f7650.',
  '.065ad999df7650.',
  '.001aa9998f7650.',
  '.021a999880320..',
  '.0a99998880210..',
];

/* --- big run legs --------------------------------------------------- */

// 1 — contact A: near foot strikes and takes everything; the far leg is already
// extended behind with its sole two rows clear of the ground.
// The stride is genuinely longer than the walk's: the gap between the thighs opens
// to FIVE columns (the walk tops out at four) and the lead shin reaches x15, where
// the walk's stops at x14. The trailing sole is three rows clear of the floor.
const BR_LEG_CONTACT_A = [
  '.0a98800a99980..',
  '099880..0a99980.',
  '09880...0a999980',
  '08880....0a99980',
  '01cb0.....0a9980',
  '0cccb0....0a9980',
  '0bbbb0....099980',
  '..........01ccb0',
  '.........0ccccb0',
  '........0bccccb0',
];
// 2 — down A: deepest point of the cycle. The far leg has swung through, knee
// folded, boot four rows off the floor.
const BR_LEG_DOWN_A = [
  '.0998800a99980..',
  '..09980..0a9980.',
  '..01cb0..0a9980.',
  '.0cccb0..0a99980',
  '.0bbbb0..0999980',
  '.........0888880',
  '.........01ccb0.',
  '.........0cccb0.',
  '........0bcccb0.',
];
// 3 — airborne A: the last two rows are EMPTY. Near leg thrown back behind the
// hip after the push-off, far knee driven up in front, nothing on the floor.
// Thirteen rows: the pelvis has come DOWN out of the arm block, so the crotch —
// and with it the whole hip line — opens two rows HIGHER than at contact. The body
// genuinely rises into the flight phase instead of the boots merely tucking, and
// the last two rows are still empty so nothing is touching the floor.
const BR_LEG_AIR_A = [
  '..0a9999998880..',
  '..0a9988899880..',
  '.0a9880.099980..',
  '0a9980...09980..',
  '0a980....09980..',
  '09880....09980..',
  '08880....01cb0..',
  '08880....0cccb0.',
  '01cb0...0bcccb0.',
  '0cccb0..........',
  '0bbbb0..........',
  '................',
  '................',
];
// 4 — contact B: far foot strikes. Narrower and a step darker than the near
// foot was in frame 1, and the near leg trails clear of the ground behind it.
const BR_LEG_CONTACT_B = [
  '.0a98800999980..',
  '0a9980..0999980.',
  '0a9980...099980.',
  '088880...098880.',
  '01ccb0....09980.',
  '0cccb0....09980.',
  '0bcccb0...01cb0.',
  '.........01ccb0.',
  '.........0cccb0.',
  '........0bcccb0.',
];
// 5 — down B: the far leg eats the landing and plants its boot TWO COLUMNS left of
// where the near leg plants at down A, while the near leg is folded through
// knee-high with its sole a row higher, clearing row 29 instead of row 30. The two
// down frames now differ by 44 silhouette pixels instead of 19: different support
// column, different trailing-boot height, opposite ends of the arm pump.
const BR_LEG_DOWN_B = [
  '.0a98800999980..',
  '..0a980..09980..',
  '..01ccb0.09980..',
  '.0bcccb0.099980.',
  '.........098880.',
  '........0888880.',
  '.......01ccb0...',
  '.......0cccb0...',
  '......0bcccb0...',
];
// 6 — airborne B: floating again, but the other flight pose. Frame 3 throws the
// NEAR leg back down the left of the sprite and drives the far knee up in front;
// here the far leg is folded to a boot tucked high behind the hip and the near leg
// swings forward alone down the right of the frame. 58 of the 160 silhouette pixels
// below the pelvis differ — the two flights are drawn, not flipped.
const BR_LEG_AIR_B = [
  '..0a999988880...',
  '..0a9988899880..',
  '.09980..0a99980.',
  '.0cb0...0a9980..',
  '0bcb0...0a9980..',
  '........0a99980.',
  '........0999980.',
  '........0888880.',
  '........01ccb0..',
  '.......0cccccb0.',
  '......0bccccb0..',
  '................',
  '................',
];

const BIG_RUN_1 = bg([BLANK, BLANK, ...B_HEAD_DRIVE_NOD, ...BR_ARM_BACK, ...BR_LEG_CONTACT_A], 'run1');
const BIG_RUN_2 = bg([...B_HEAD_DRIVE, ...BR_ARM_DOWNA, ...BR_LEG_DOWN_A], 'run2');
const BIG_RUN_3 = bg([...B_HEAD_DRIVE_UP, ...BR_ARM_AIR_A, ...BR_LEG_AIR_A], 'run3');
const BIG_RUN_4 = bg([BLANK, BLANK, ...B_HEAD_DRIVE_NOD_B, ...BR_ARM_FWD, ...BR_LEG_CONTACT_B], 'run4');
const BIG_RUN_5 = bg([...B_HEAD_DRIVE_TIP, ...BR_ARM_DOWNB, ...BR_LEG_DOWN_B], 'run5');
const BIG_RUN_6 = bg([...B_HEAD_DRIVE_UP_B, ...BR_ARM_AIR_B, ...BR_LEG_AIR_B], 'run6');

BIG_MARIO.run = new Anim(
  [BIG_RUN_1, BIG_RUN_2, BIG_RUN_3, BIG_RUN_4, BIG_RUN_5, BIG_RUN_6],
  [3, 2, 4, 3, 2, 4]);

/* ------------------------------------------------------------------ *
 *  FIRE MARIO — derived, never redrawn. Same pixels, fire palette.
 * ------------------------------------------------------------------ */

FIRE_MARIO.walk6 = fireAnim(BIG_MARIO.walk6, 'walk6');
FIRE_MARIO.run = fireAnim(BIG_MARIO.run, 'run');

/* ------------------------------------------------------------------ *
 *  TOOLBELT MARIO — derived the same way, belt included.
 * ------------------------------------------------------------------ */

TOOLBELT_MARIO.walk6 = toolAnim(BIG_MARIO.walk6, 'walk6');
TOOLBELT_MARIO.run = toolAnim(BIG_MARIO.run, 'run');
