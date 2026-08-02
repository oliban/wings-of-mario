import { makeSprite } from '../../core/gfx.js';

// Warship grey, lit from above: the deck plating is the brightest thing on the
// ship and every surface below it steps down. Slot 5 is the deck centreline,
// slot 6 the boot topping at the waterline, slot 7 the lit ports on the
// island — the only warm colours on an otherwise cold hull.
export const CARRIER_PAL = [
  '#0a0c12', // 0 outline / rivets
  '#39404f', // 1 hull shadow
  '#585f70', // 2 hull mid
  '#7d8698', // 3 upper works
  '#a8b2c4', // 4 deck plating
  '#d9a441', // 5 centreline
  '#8f2f24', // 6 boot topping
  '#ffe9a8', // 7 lit ports
];

// The deck surface. Tiled from DECK_X0 to DECK_X1 with its top row at DECK_Y.
export const C_DECK = makeSprite(
  [
    '4444444444444444', '3333333333333333', '3355335533553355', '2222222222222222',
    '1111011110111101', '1111111111111111', '1111111111111111', '1111011110111101',
    '1111111111111111', '1111111111111111', '1111011110111101', '1111111111111111',
    '1111111111111111', '1111011110111101', '1111111111111111', '1111111111111111',
  ],
  CARRIER_PAL,
  { name: 'wings.carrier.deck' }
);

export const C_HULL = makeSprite(
  [
    '1111111111111111', '1111011110111101', '1111111111111111', '1111111111111111',
    '1111011110111101', '1111111111111111', '1111111111111111', '1111011110111101',
    '1111111111111111', '1111111111111111', '1111011110111101', '1111111111111111',
    '1111111111111111', '1111011110111101', '1111111111111111', '1111111111111111',
  ],
  CARRIER_PAL,
  { name: 'wings.carrier.hull' }
);

// The tile straddling sea level: hull, boot topping, then nothing below.
export const C_WATERLINE = makeSprite(
  [
    '1111111111111111', '1111011110111101', '1111111111111111', '0000000000000000',
    '6666666666666666', '6666666666666666', '6666666666666666', '0000000000000000',
    '1111111111111111', '1111011110111101', '1111111111111111', '0000000000000000',
    '................', '................', '................', '................',
  ],
  CARRIER_PAL,
  { name: 'wings.carrier.waterline' }
);

// The island: mast, bridge and flight-control gallery. Its bottom row aligns
// with DECK_Y.
export const C_TOWER = makeSprite(
  [
    '............0...........',
    '...........040..........',
    '...........040..........',
    '...........040..........',
    '..........04440.........',
    '...........040..........',
    '...........040..........',
    '......000000000000......',
    '.....04444444444440.....',
    '.....03333333333330.....',
    '.....03277777772330.....',
    '.....03277777772330.....',
    '.....03222222222330.....',
    '...0003333333333300000..',
    '...0444444444444444440..',
    '...0333333333333333330..',
    '...0327777732777773330..',
    '...0327777732777773330..',
    '...0322222232222223330..',
    '...0333333333333333330..',
    '...0222222222222222220..',
    '...0222222222222222220..',
    '...0111111111111111110..',
    '...0111111111111111110..',
    '...0000000000000000000..',
  ],
  CARRIER_PAL,
  { name: 'wings.carrier.tower' }
);
