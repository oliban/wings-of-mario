import { makeSprite, Anim } from '../../core/gfx.js';

// The sky and sea gradients are painted with fillRect, not sprites: a 512x240
// backdrop as pixel strings would be 240 rows of nothing. Only the surface
// itself, where the eye actually looks, is authored art.
export const SKY_TOP = '#1b3f88';
export const SKY_HAZE = '#8ec4e8';
export const SEA_SHALLOW = '#1c6ea8';
export const SEA_DEEP = '#06213f';

export const SEA_PAL = [
  '#04182f', // 0 trough outline
  '#0f4a7a', // 1 deep
  '#1c6ea8', // 2 body
  '#3fa0d4', // 3 lit face
  '#c8ecff', // 4 foam
];

// Three phases of the same swell, cycled by tick, so the horizon is never a
// straight line.
export const WAVE_ANIM = new Anim(
  [
    makeSprite(
      ['................', '..000...........', '.04440......000.',
       '.03330.....04440', '002220.....03330', '0022200000002220'],
      SEA_PAL, { name: 'wings.wave.a' }
    ),
    makeSprite(
      ['................', '.......000......', '000....04440....',
       '04440..03330....', '03330..02220..00', '0222000022200044'],
      SEA_PAL, { name: 'wings.wave.b' }
    ),
    makeSprite(
      ['................', '.....000........', '.....04440......',
       '000..03330......', '04440.02220.....', '0333000222000000'],
      SEA_PAL, { name: 'wings.wave.c' }
    ),
  ],
  10
);

export const CLOUD_PAL = ['#7f9dc4', '#c2d6ee', '#e9f2ff', '#ffffff'];

// Parallax cloud. Lit on top, shaded underneath — the same light as everything
// else in the game.
export const CLOUD = makeSprite(
  [
    '......000000....',
    '...000333333000.',
    '..0333333333330.',
    '.033322222222330',
    '.032222222222220',
    '..000000000000..',
  ],
  CLOUD_PAL,
  { name: 'wings.cloud' }
);

export const ORD_PAL = [
  '#0a0a10', // 0 outline
  '#4a4f5c', // 1 shadowed steel
  '#7d8492', // 2 steel
  '#c6ccd8', // 3 lit steel
  '#ffd66b', // 4 tracer core
];

export const BOMB = makeSprite(
  ['.00.', '0330', '0230', '0230', '0220', '0220', '0110', '0110', '.010', '0.0.'],
  ORD_PAL,
  { name: 'wings.bomb' }
);

export const ROCKET = makeSprite(
  ['..0000000000', '.03322222210', '032222222110', '.0111111110.'],
  ORD_PAL,
  { name: 'wings.rocket' }
);

export const TRACER = makeSprite(['0440', '0330'], ORD_PAL, { name: 'wings.tracer' });

export const PUFF_PAL = [
  '#1a0c06', '#5c2408', '#a4470f', '#e2842a', '#ffd06b', '#fff4c4',
];

// One puff. An explosion is several of these placed around the crater rim at
// deterministic angles, which reads bigger than any single sprite and costs one
// drawing instead of a sheet.
export const PUFF = makeSprite(
  [
    '...0000...',
    '.00544400.',
    '0544433300',
    '0544333220',
    '.054332200',
    '..00322000',
    '...00000..',
  ],
  PUFF_PAL,
  { name: 'wings.puff' }
);
