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
];

export const MARIO_CONTACT = makeSprite(
  [
    '...0000.....',
    '..011110....',
    '..0111110...',
    '..0022420...',
    '..0242420...',
    '..0244420...',
    '...022200...',
    '..01131100..',
    '.011131110..',
    '011113311110',
    '022113311220',
    '024113311420',
    '000333333000',
    '..03300330..',
    '..03300330..',
    '..00000000..',
  ],
  CONTACT_PAL,
  { name: 'wings.contact.mario' }
);

export default MARIO_CONTACT;
