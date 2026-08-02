import { makeSprite, Anim } from '../../core/gfx.js';

// The sky. Altitude has to be legible from the backdrop alone, with the HUD
// covered up, so it is painted as eight discrete bands from a deep blue at the
// ceiling to a pale haze on the horizon rather than as one smooth wash. Bands
// are how an 8-bit machine draws a sky; a 240-row gradient is how a 2005 one
// does, and the difference is most of why the old screenshot read as a web page
// with a plane on it.
export const SKY_BANDS = [
  '#0b2359', // 0 ceiling
  '#12336f',
  '#1c4785',
  '#295f9c',
  '#3a7ab2',
  '#5297c8',
  '#71b3dc',
  '#96cdec', // 7 horizon haze
];

// The seam between two bands: four rows of ordered dither so the step is a
// crosshatch and not a hard line. Slot 0 is the band above, slot 1 the band
// below; the scene recolours one seam sprite per boundary at load.
const SEAM_ROWS = [
  '0001000100010001',
  '0101010101010101',
  '1010101010101010',
  '1110111011101110',
];

export const SKY_SEAMS = [];
for (let i = 0; i < SKY_BANDS.length - 1; i++) {
  SKY_SEAMS.push(
    makeSprite(SEAM_ROWS, [SKY_BANDS[i], SKY_BANDS[i + 1]], { name: `wings.sky.seam${i}` })
  );
}

export const SEAM_H = SEAM_ROWS.length;

// Cloud light comes from the upper left like everything else: slot 3 is the
// sunlit crown, 0 the flat shaded base a cumulus always has.
export const CLOUD_PAL = [
  '#5d8cbb', // 0 shaded base
  '#9dc0e2', // 1 mid
  '#d5e8fa', // 2 lit
  '#ffffff', // 3 sunlit crown
];

export const CLOUD_S = makeSprite(
  [
    '....................',
    '.......33333........',
    '....333333323.......',
    '...333311111233.....',
    '..03111110111223....',
    '...0000000001000....',
    '....00000.00000.....',
    '............0.......',
  ],
  CLOUD_PAL,
  { name: 'wings.cloud.s' }
);

export const CLOUD_M = makeSprite(
  [
    '..................................',
    '............333.......3...........',
    '..........333333333333233.........',
    '.......3333322233332222223........',
    '.....333332222222222222222........',
    '....3332222222222222222222333.....',
    '....322222222211122211112222233...',
    '...0111222221111111111111111122...',
    '....011111111100011100001111100...',
    '....000111110000000000000000000...',
    '.....000000000...000....00000.....',
    '.......00000......................',
  ],
  CLOUD_PAL,
  { name: 'wings.cloud.m' }
);

export const CLOUD_L = makeSprite(
  [
    '....................................................',
    '................33333.......33333...................',
    '..............333333333...333222233.................',
    '.............3332222233333332222222.................',
    '.............32222222223332222222223..33333.........',
    '........333332222222222222222222222..3222223........',
    '.......33333322222222222222222222222322222223.......',
    '......33222222222222222222222222222222222222........',
    '.....3322222222222222222222222122222222222222333....',
    '.....322222222222221122222221112222222222222222233..',
    '....0112222222222211111111111101122222221112222222..',
    '.....0112222222221100111111100011111111111111111110.',
    '.....0011111111111000000000000.0011111110001111100..',
    '......0011111111100..0000000...0000000000000000000..',
    '.......00000000000...............0000000...00000....',
    '........000000000...................................',
    '....................................................',
  ],
  CLOUD_PAL,
  { name: 'wings.cloud.l' }
);

// A thin, fast, low-lying scud layer. Two frames so the near layer visibly
// boils rather than sliding as a rigid cut-out.
export const SCUD = new Anim(
  [
    makeSprite(
      ['...2222....22...', '.2222222122222..', '.11111100011110.', '..000.....000...'],
      CLOUD_PAL,
      { name: 'wings.scud.a' }
    ),
    makeSprite(
      ['..2222.....222..', '.2222212222222..', '.11110001111110.', '..00.....0000...'],
      CLOUD_PAL,
      { name: 'wings.scud.b' }
    ),
  ],
  24
);

// Cloud decks at fixed world positions and fixed parallax depths. A literal, so
// the sky is identical on every run and a screenshot at tick N is reproducible.
// `m` is the parallax factor and `s` selects the sprite.
export const CLOUD_DECKS = [
  { x: 180, y: 60, m: 0.18, s: 'l' }, { x: 560, y: 208, m: 0.34, s: 'm' },
  { x: 900, y: 128, m: 0.22, s: 'l' }, { x: 1240, y: 330, m: 0.52, s: 'l' },
  { x: 1600, y: 44, m: 0.14, s: 'm' }, { x: 1940, y: 250, m: 0.42, s: 'm' },
  { x: 2300, y: 150, m: 0.26, s: 'l' }, { x: 2680, y: 380, m: 0.58, s: 's' },
  { x: 3020, y: 90, m: 0.20, s: 'm' }, { x: 3380, y: 296, m: 0.46, s: 'l' },
  { x: 3740, y: 176, m: 0.30, s: 's' }, { x: 4100, y: 356, m: 0.55, s: 'm' },
  { x: 4460, y: 68, m: 0.16, s: 'l' }, { x: 4820, y: 232, m: 0.38, s: 'm' },
  { x: 5180, y: 118, m: 0.24, s: 'l' }, { x: 5560, y: 310, m: 0.50, s: 'm' },
];

// The scud layer runs closest to the camera and therefore fastest.
export const SCUD_BANK = [
  { x: 300, y: 424, m: 0.78 }, { x: 780, y: 392, m: 0.86 }, { x: 1260, y: 448, m: 0.72 },
  { x: 1820, y: 404, m: 0.90 }, { x: 2380, y: 436, m: 0.76 }, { x: 2940, y: 388, m: 0.84 },
  { x: 3560, y: 452, m: 0.70 }, { x: 4180, y: 412, m: 0.88 }, { x: 4820, y: 432, m: 0.74 },
];

export const CLOUDS_BY_KEY = { s: CLOUD_S, m: CLOUD_M, l: CLOUD_L };
