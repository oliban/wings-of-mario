import { makeSprite } from '../../core/gfx.js';

// Mario as the pilot sees him: 12x16, from 400 feet, through a canopy. Small,
// high-contrast and readable against both grass and castle stone, because at
// the pilot's scale the only question is "is that him".
//
// This is NOT the engine's Mario sprite and must not become it. The pilot's
// page never loads the game's art, and reaching into src/game for a sprite
// would couple the two pages together for a 12x16 picture.
export const CONTACT_PAL = [
  '#0a0d14', // 0 outline
  '#c0392b', // 1 cap and shirt
  '#e8b088', // 2 skin
  '#2b4a9b', // 3 dungarees
  '#f4d9c0', // 4 skin highlight
  '#7a2018', // 5 shirt shadow
  '#1d3268', // 6 dungaree shadow — the FAR leg
];

// THE FIGURE IS BUILT IN THREE BANDS, stacked in this order, so that a pose
// changes only the band it actually moves:
//
//   rows 0-6    head — never changes; at 12px the cap IS the identification
//   rows 7-11   torso and arms
//   rows 12-15  belt and legs — where a walk lives
//
// The engine's sprite file is authored the same way (S_HEAD, SW_ARM_*,
// SW_LEG_*), for the same reason: a stride that accidentally redraws the face
// reads as a flicker rather than as legs.
const HEAD = [
  '...0000.....',
  '..011110....',
  '..0111110...',
  '..0022420...',
  '..0242420...',
  '..0244420...',
  '...022200...',
];

const TORSO = [
  '..01131100..',
  '.011131110..',
  '011113311110',
  '022113311220',
  '024113311420',
];

// Standing: both soles planted, weight even. This is the pose the contact has
// always had, and it stays the one drawn when he is not going anywhere.
const LEGS_STAND = [
  '000333333000',
  '..03300330..',
  '..03300330..',
  '..00000000..',
];

// THE STRIDE, in three drawings — contact, passing, contact — which is the
// shape the ROM itself uses (ActionWalkRun cycles PlayerAnimCtrl at 3,
// smbdis.asm:14627-14657). Six would be wasted here: at twelve pixels wide a
// leg is two pixels of dungaree, and the eye cannot read six distinct
// silhouettes out of that. It can read apart / together / apart.
//
// TWO THINGS MAKE A LEG READ AT THIS SIZE, and the first draft had neither:
//
//   SKY BETWEEN THE LEGS. Outline is #0a0d14 and dungaree is #2b4a9b — both
//   dark, and butted together at twelve pixels they merge into one blob that
//   reads as a skirt, not as a man walking. Every stride drawing below keeps a
//   column of background between the thighs.
//
//   A FAR LEG THAT RECEDES. The two contacts are the same silhouette with the
//   legs swapped, so with flat colour they are nearly the same picture and the
//   cycle reads as a twitch. Shading the trailing leg (palette 6) is what makes
//   them two drawings rather than one drawn twice.
//
// They are NOT one drawing mirrored. Mirroring is what `facing` already does to
// the whole sprite, so a stride built that way would swing the cap and the nose
// round twice a step. Only the legs swap.
const LEGS_CONTACT_A = [
  '000333333000',
  '.0660.0330..',
  '0660...0330.',
  '000.....000.',
];

const LEGS_PASS = [
  '000333333000',
  '..06300330..',
  '...03330....',
  '....000.....',
];

const LEGS_CONTACT_B = [
  '000333333000',
  '..0330.0660.',
  '.0330...0660',
  '.000.....000',
];

// Airborne: the legs split, front knee up and the trailing boot thrown back.
// One drawing serves the rise and the fall — SMB's small Mario has a single
// jump pose too, and at this size a separate falling drawing would be four
// pixels of difference nobody can see at 400 feet.
const LEGS_JUMP = [
  '000333333000',
  '.0660..0330.',
  '0660....0330',
  '000......000',
];

// Skidding: feet braced wide against the direction of travel, planted lower
// than a stride reaches. Worth its own drawing because a skid is the one ground
// pose where Mario is moving the opposite way to the one he is facing, and the
// pilot reading "he has turned round" a third of a second early is the
// difference between leading him and missing him.
const LEGS_SKID = [
  '000333333000',
  '..06300330..',
  '.0660..0330.',
  '.000....000.',
];

const sprite = (legs, name) => makeSprite(
  [...HEAD, ...TORSO, ...legs], CONTACT_PAL, { name: `wings.contact.${name}` },
);

export const CONTACT_STAND = sprite(LEGS_STAND, 'stand');
export const CONTACT_JUMP = sprite(LEGS_JUMP, 'jump');
export const CONTACT_SKID = sprite(LEGS_SKID, 'skid');

// Contact, passing, contact. Index 1 is the passing pose and is the one the
// renderer lifts a pixel — see CONTACT_BOB.
export const CONTACT_WALK = [
  sprite(LEGS_CONTACT_A, 'walkA'),
  sprite(LEGS_PASS, 'walkPass'),
  sprite(LEGS_CONTACT_B, 'walkB'),
];

// THE BOB, per walk frame, in pixels UP. A twelve-pixel figure whose legs
// straighten on the passing frame must rise, or the stride reads as a man
// scissoring his legs while gliding along a rail. One pixel is the whole
// effect at this scale; two makes him hop.
export const CONTACT_BOB = [0, 1, 0];

// The idle sprite keeps the old export name and the old default, because the
// radar, the capture tool and the tests all reach for it by that name.
export const MARIO_CONTACT = CONTACT_STAND;

export default MARIO_CONTACT;
