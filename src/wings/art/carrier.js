import { makeSprite, Anim } from '../../core/gfx.js';

// The ship. She is 320 pixels of hull with 48 of freeboard, and the old version
// spent all of it on one grey rectangle with a dotted texture. What makes a
// flat-top read as a flat-top is the run of details along the deck edge — the
// painted centreline, the arrestor wires standing proud of the planking, the
// catwalk hanging under the deck lip, the island with its mast and radar — and
// then a hull that is plated, portholed and has a bow and a stern rather than
// two vertical cuts.
//
// Everything is 16px-tiled so the ship can be any length, except the bow, the
// stern and the island, which are one-off sprites.

// Warship grey lit from above: the deck is the brightest surface on the ship
// and every plane below it steps down. Slot 5 is the deck paint, 6 the boot
// topping at the waterline, 7 the lit ports and the deck lamps — the only warm
// colours on a cold hull.
export const CARRIER_PAL = [
  '#090c13', // 0 outline / shadow line
  '#2c3342', // 1 hull shadow
  '#454d5f', // 2 hull mid
  '#697388', // 3 upper works
  '#98a3b8', // 4 deck plating
  '#c9d4e4', // 5 deck highlight / arrestor wire
  '#d7a43c', // 6 deck paint
  '#8f2f24', // 7 boot topping
  '#ffe9a8', // 8 lit port / deck lamp
  '#3f4a5e', // 9 recessed panel / porthole
];

// ---------------------------------------------------------------------------
// Deck
// ---------------------------------------------------------------------------

// Plain deck planking: four rows of armoured plate over the deck beams. Rows
// 0-3 are the deck surface proper, everything below is structure.
const DECK_BASE = [
  '5445444544454445',
  '4444444444444444',
  '3333333333333333',
  '2229222222922222',
];

// The painted centreline runs down the middle of the landing area as a dashed
// stripe, which is what tells you at a glance which way the deck runs.
export const C_DECK = makeSprite(
  [...DECK_BASE.slice(0, 1), '4466664444666644', ...DECK_BASE.slice(2)],
  CARRIER_PAL,
  { name: 'wings.deck' }
);

// Plain plating for the ends of the run, outside the marked landing area.
export const C_DECK_PLAIN = makeSprite(DECK_BASE, CARRIER_PAL, { name: 'wings.deck.plain' });

// An arrestor wire: a taut cable standing a pixel proud of the deck on two
// stanchions. Three of these are what the hook is actually reaching for.
export const C_DECK_WIRE = makeSprite(
  [
    '5555555555555555',
    '4444404444404444',
    '3333333333333333',
    '2229222222922222',
  ],
  CARRIER_PAL,
  { name: 'wings.deck.wire' }
);

// The touchdown stripes at the aft end of the landing area.
export const C_DECK_STRIPE = makeSprite(
  [
    '5445444544454445',
    '6644446666444466',
    '3333333333333333',
    '2229222222922222',
  ],
  CARRIER_PAL,
  { name: 'wings.deck.stripe' }
);

// The catwalk that runs the length of the deck edge: a railed gallery slung
// under the lip, with a deck lamp every other tile.
export const C_CATWALK = makeSprite(
  [
    '2222222222222222',
    '0110011001100110',
    '2222222222222222',
    '1111111111111111',
  ],
  CARRIER_PAL,
  { name: 'wings.catwalk' }
);

// The same gallery with a lamp fitted. Alternated along the run and blinked by
// the scene, so the deck edge is never a static line.
export const C_CATWALK_LAMP = makeSprite(
  [
    '2222222222222222',
    '0110811001108110',
    '2222222222222222',
    '1111111111111111',
  ],
  CARRIER_PAL,
  { name: 'wings.catwalk.lamp' }
);

// ---------------------------------------------------------------------------
// Hull
// ---------------------------------------------------------------------------

// Plated side shell with a run of portholes and a welded strake every few rows.
export const C_HULL = makeSprite(
  [
    '3333333333333333',
    '3393333933393339',
    '3333333333333333',
    '0000000000000000',
    '2222222222222222',
    '2222222222222222',
    '2229222222922222',
    '2222222222222222',
    '0000000000000000',
    '2222222222222222',
    '2292222922292229',
    '2222222222222222',
    '1111111111111111',
    '1111111111111111',
    '1111111111111111',
    '1111111111111111',
  ],
  CARRIER_PAL,
  { name: 'wings.hull' }
);

// The strip that straddles sea level: shadowed shell, the red boot topping, and
// then nothing, because below this is water.
export const C_WATERLINE = makeSprite(
  [
    '1111111111111111',
    '1111111111111111',
    '0000000000000000',
    '7777777777777777',
    '7777777777777777',
    '0000000000000000',
    '................',
    '................',
  ],
  CARRIER_PAL,
  { name: 'wings.waterline' }
);

// ---------------------------------------------------------------------------
// Bow and stern
// ---------------------------------------------------------------------------

// The bow: the flight deck overhangs a stem that rakes aft as it goes down into
// the water. Deck lip on row 0, catwalk on rows 4-7, boot topping on rows 43-47
// so it meets the tiled waterline strip exactly.
export const C_BOW = makeSprite(
  [
    '5445444544454445444540..',
    '4444444444444444444440..',
    '3333333333333333333330..',
    '2222222222222222222220..',
    '2222222222222222222220..',
    '0110011001100110011000..',
    '2222222222222222222220..',
    '1111111111111111111110..',
    '22222222222222222222220.',
    '22922222292222229222220.',
    '2222222222222222222220..',
    '1111111111111111111110..',
    '2222222222222222222220..',
    '222222222222222222220...',
    '222222222222222222220...',
    '11111111111111111110....',
    '22222222222222222220....',
    '22922222292222229220....',
    '2222222222222222220.....',
    '1111111111111111110.....',
    '2222222222222222220.....',
    '222222222222222220......',
    '222222222222222220......',
    '111111111111111110......',
    '22222222222222220.......',
    '22922222292222220.......',
    '2222222222222220........',
    '1111111111111110........',
    '2222222222222220........',
    '222222222222220.........',
    '222222222222220.........',
    '111111111111110.........',
    '22222222222220..........',
    '22922222292220..........',
    '22222222222220..........',
    '1111111111110...........',
    '2222222222220...........',
    '2222222222220...........',
    '222222222220............',
    '111111111110............',
    '22222222220.............',
    '22922222290.............',
    '22222222220.............',
    '0000000000..............',
    '7777777770..............',
    '7777777770..............',
    '7777777770..............',
    '0000000000..............',
  ],
  CARRIER_PAL,
  { name: 'wings.bow' }
);

// The stern: a near-vertical transom under the round-down of the deck, tucked
// forward a few pixels so the ship reads as having an end rather than a cut.
export const C_STERN = makeSprite(
  [
    '..0544454445444544454445',
    '..0444444444444444444444',
    '..0333333333333333333333',
    '..0222222222222222222222',
    '...022222222222222222222',
    '...001100110011001100110',
    '...022222222222222222222',
    '...011111111111111111111',
    '.02222222222222222222222',
    '.09222222922222292222229',
    '.02222222222222222222222',
    '.01111111111111111111111',
    '.02222222222222222222222',
    '..0222222222222222222222',
    '..0222222222222222222222',
    '..0111111111111111111111',
    '..0222222222222222222222',
    '..0222222922222292222229',
    '..0222222222222222222222',
    '..0111111111111111111111',
    '..0222222222222222222222',
    '..0222222222222222222222',
    '...022222222222222222222',
    '...011111111111111111111',
    '...022222222222222222222',
    '...022222922222292222229',
    '...022222222222222222222',
    '...011111111111111111111',
    '...022222222222222222222',
    '...022222222222222222222',
    '...022222222222222222222',
    '....01111111111111111111',
    '....02222222222222222222',
    '....02222922222292222229',
    '....02222222222222222222',
    '....01111111111111111111',
    '....02222222222222222222',
    '....02222222222222222222',
    '....02222222222222222222',
    '....01111111111111111111',
    '.....0222222222222222222',
    '.....0222922222292222229',
    '.....0222222222222222222',
    '.....0000000000000000000',
    '.....0777777777777777777',
    '.....0777777777777777777',
    '.....0777777777777777777',
    '.....0000000000000000000',
  ],
  CARRIER_PAL,
  { name: 'wings.stern' }
);

// ---------------------------------------------------------------------------
// Island
// ---------------------------------------------------------------------------

// The island: funnel uptakes, an open flag bridge, the enclosed navigating
// bridge with its lit ports, and a mast. Its bottom row sits on the deck.
export const C_ISLAND = makeSprite(
  [
    '.............0..........',
    '.............5..........',
    '.............5..........',
    '..........0005000.......',
    '.............5..........',
    '............05555.......',
    '.............5..........',
    '.......0000005000.......',
    '.............5..........',
    '.......000000500000.....',
    '.............5..........',
    '.......04444450444440...',
    '.......03333333333330...',
    '.......03222222222330...',
    '.....00033333333333300..',
    '.....04444444444444440..',
    '.....03888333388833330..',
    '.....03888333388833330..',
    '.....03333333333333330..',
    '.....02222222222222220..',
    '...000333333333333333000',
    '...044444444444444444440',
    '...038883338883338883330',
    '...038883338883338883330',
    '...033333333333333333330',
    '...022222222222222222220',
    '...022292222292222292220',
    '...011111111111111111110',
    '...011111111111111111110',
    '...000000000000000000000',
  ],
  CARRIER_PAL,
  { name: 'wings.island' }
);

// The air-search radar on the mast head. Four frames of a bedspring aerial
// swinging through a bearing, so the ship is never a still photograph.
export const C_RADAR = new Anim(
  [
    makeSprite(['.555.', '.5.5.', '.555.', '..0..'], CARRIER_PAL, { name: 'wings.radar.a' }),
    makeSprite(['.55..', '.5.5.', '..55.', '..0..'], CARRIER_PAL, { name: 'wings.radar.b' }),
    makeSprite(['..5..', '..5..', '..5..', '..0..'], CARRIER_PAL, { name: 'wings.radar.c' }),
    makeSprite(['..55.', '.5.5.', '.55..', '..0..'], CARRIER_PAL, { name: 'wings.radar.d' }),
  ],
  10
);

// The bow wave the ship pushes ahead of herself. Two frames, in the sea palette
// rather than the ship's, because it is water.
export const BOW_WAVE_PAL = ['#0a3560', '#3ea3d8', '#a8dcf5', '#eafaff'];

export const BOW_WAVE = new Anim(
  [
    makeSprite(
      [
        '.......33.......',
        '....3332233.....',
        '..33222112233...',
        '.3221111111223..',
        '.0111111111110..',
      ],
      BOW_WAVE_PAL, { name: 'wings.bowwave.a' }
    ),
    makeSprite(
      [
        '......3..3......',
        '...333.22.33....',
        '..3222111122333.',
        '.32111111111223.',
        '.01111111111110.',
      ],
      BOW_WAVE_PAL, { name: 'wings.bowwave.b' }
    ),
  ],
  9
);
