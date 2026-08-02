import { makeSprite, Anim } from '../../core/gfx.js';

// Everything the aircraft drops, fires or turns into. Kept apart from the sea
// and the sky because it belongs to neither.
export const ORD_PAL = [
  '#0a0a10', // 0 outline
  '#3a4050', // 1 shadowed steel
  '#6d7484', // 2 steel
  '#b6bccb', // 3 lit steel
  '#e8eef8', // 4 specular
  '#ffd66b', // 5 tracer core
];

export const BOMB = makeSprite(
  ['.00.', '0430', '0330', '0230', '0220', '0220', '0110', '0110', '.010', '0.0.'],
  ORD_PAL,
  { name: 'wings.bomb' }
);

export const ROCKET = makeSprite(
  ['..0000000000', '.04332222210', '043222222110', '.0111111110.'],
  ORD_PAL,
  { name: 'wings.rocket' }
);

export const TRACER = makeSprite(['0550', '0430'], ORD_PAL, { name: 'wings.tracer' });

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

// The fireball an aircraft leaves behind. Four frames, no loop: it flashes
// white, blooms, and collapses into smoke.
export const FIREBALL = new Anim(
  [
    makeSprite(
      ['..0000..', '.055550.', '05544550', '05444450', '05444450', '05544550', '.055550.', '..0000..'],
      PUFF_PAL, { name: 'wings.fireball.a' }
    ),
    makeSprite(
      ['.004400.', '04433440', '04332340', '43222234', '43222234', '04332340', '04433440', '.004400.'],
      PUFF_PAL, { name: 'wings.fireball.b' }
    ),
    makeSprite(
      ['.0.33.0.', '03322330', '.3211123', '32111112', '32111112', '.3211123', '03322330', '.0.33.0.'],
      PUFF_PAL, { name: 'wings.fireball.c' }
    ),
    makeSprite(
      ['..0..0..', '0.2112.0', '.211..12', '2.1....1', '1....1.2', '21..112.', '0.2112.0', '..0..0..'],
      PUFF_PAL, { name: 'wings.fireball.d' }
    ),
  ],
  6,
  false
);
