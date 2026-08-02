import { makeSprite, Anim } from '../../core/gfx.js';

// The sea. Three things have to be true at once: it has to be obviously below
// the aircraft, it has to be obviously moving, and it has to be darker the
// further down you look, so a dive reads as a dive. So it is built the same way
// as the sky — discrete bands with dithered seams — with two swell layers and
// breaking crests laid on top of the surface itself.
export const SEA_BANDS = [
  '#2f8fbe', // 0 the lit strip right at the horizon
  '#1f76a8',
  '#155f91',
  '#0e4a78',
  '#09375e',
  '#052644', // 5 deep
];

const SEAM_ROWS = [
  '0001000100010001',
  '0101010101010101',
  '1010101010101010',
  '1110111011101110',
];

export const SEA_SEAMS = [];
for (let i = 0; i < SEA_BANDS.length - 1; i++) {
  SEA_SEAMS.push(
    makeSprite(SEAM_ROWS, [SEA_BANDS[i], SEA_BANDS[i + 1]], { name: `wings.sea.seam${i}` })
  );
}

export const SEA_SEAM_H = SEAM_ROWS.length;

// Light from the upper left again: the western face of every swell is the lit
// one (slot 4), the eastern face falls away into slot 1, and only the very top
// of a breaking crest gets foam.
export const SEA_PAL = [
  '#04182f', // 0 trough
  '#0a3560', // 1 shaded face
  '#12558a', // 2 body
  '#1c74b0', // 3 lit body
  '#3ea3d8', // 4 sunlit face
  '#a8dcf5', // 5 foam shadow
  '#eafaff', // 6 foam
];

// The near swell: a 24px-period wave train drawn at the surface, two periods
// wide so it tiles seamlessly. It is one sprite scrolled by tick rather than a
// flipbook, because a swell travels — it does not stand still and change shape.
export const SWELL_NEAR = makeSprite(
  [
    '.........4444444.................4444444........',
    '.......342222222333............342222222333.....',
    '....33423222222222233.......33423222222222233...',
    '333422322222222222222333333422322222222222222333',
    '222322222111111122222222222322222111111122222222',
    '222222211111111111122222222222211111111111122222',
    '222211111000000011111222222211111000000011111222',
    '111111100000000000011111111111100000000000011111',
    '111100000000000000000111111100000000000000000111',
  ],
  SEA_PAL,
  { name: 'wings.swell.near' }
);

// The far swell runs behind the near one at a lower amplitude and a slower
// speed, which is what gives the surface depth instead of one stamped ribbon.
export const SWELL_FAR = makeSprite(
  [
    '..............3333333333333.............',
    '.......333333322222222222223333333......',
    '3333333222222322222222222222222222333333',
    '2222223222222222222222222222222222222222',
    '2222222222222211111111111112222222222222',
    '2222222111111111111111111111111111222222',
  ],
  SEA_PAL,
  { name: 'wings.swell.far' }
);

// A crest breaking. Three frames, held long enough to read: the cap builds,
// tips over, and washes out into a patch of foam.
export const CREST = new Anim(
  [
    makeSprite(
      ['........', '...66...', '..6556..', '.455444.', '44444444'],
      SEA_PAL, { name: 'wings.crest.a' }
    ),
    makeSprite(
      ['...66...', '..6666..', '.655556.', '4554444.', '44444444'],
      SEA_PAL, { name: 'wings.crest.b' }
    ),
    makeSprite(
      ['..6..6..', '.666666.', '6555555.', '45544444', '44444444'],
      SEA_PAL, { name: 'wings.crest.c' }
    ),
  ],
  14
);

// Spray thrown by something hitting the water. Four frames, no loop: it goes up
// hard, spreads, and falls back.
export const SPRAY_PAL = [
  '#0a3560', // 0 water shadow
  '#3ea3d8', // 1 water
  '#a8dcf5', // 2 foam shadow
  '#eafaff', // 3 foam
];

export const SPRAY = new Anim(
  [
    makeSprite(
      [
        '..............',
        '..............',
        '..............',
        '.....3223.....',
        '....332233....',
        '...33222233...',
        '..0322112230..',
        '..0011111100..',
      ],
      SPRAY_PAL, { name: 'wings.spray.a' }
    ),
    makeSprite(
      [
        '.....3..3.....',
        '....3.32.3....',
        '...33.223.33..',
        '..3322112233..',
        '.33221111223..',
        '.32211111122..',
        '0322111111230.',
        '0011111111100.',
      ],
      SPRAY_PAL, { name: 'wings.spray.b' }
    ),
    makeSprite(
      [
        '..3........3..',
        '.3..3....3..3.',
        '3..32......23.',
        '..3221....1223',
        '.322111..11223',
        '32211111111122',
        '02211111111120',
        '00111111111100',
      ],
      SPRAY_PAL, { name: 'wings.spray.c' }
    ),
    makeSprite(
      [
        '..............',
        '.3..........3.',
        '..2........2..',
        '...2......2...',
        '..22.1..1..22.',
        '.22111111112..',
        '.02111111120..',
        '..0011111100..',
      ],
      SPRAY_PAL, { name: 'wings.spray.d' }
    ),
  ],
  6,
  false
);

// The wake a hull drags behind it: a churned, foaming band that scrolls under
// the ship. Two frames, so the froth boils.
export const WAKE = new Anim(
  [
    makeSprite(
      [
        '..66....66...6..66......66..6...',
        '.6556..6556.655.6556...6556.65..',
        '55445545544554455445555544554455',
        '44444444444444444444444444444444',
      ],
      SEA_PAL, { name: 'wings.wake.a' }
    ),
    makeSprite(
      [
        '.6..66...66..66...6..66...66..6.',
        '655.6556.6556.6556.65.6556.6556.',
        '45544554455445544554455445544554',
        '44444444444444444444444444444444',
      ],
      SEA_PAL, { name: 'wings.wake.b' }
    ),
  ],
  8
);
