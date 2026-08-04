// ---------------------------------------------------------------------------
// HARRY 1 — "the town in the lava"
//
// Built from two of Harry's paintings of the same scene (Downloads/IMG_1853 and
// its follow-up), read left to right. Nothing here is new engine work: every
// object is a component the game already ships.
//
// THREE THINGS IN THE PAINTINGS WERE NOT GUESSABLE AND FREDRIK READ THEM FOR
// HARRY. Ask; do not infer:
//   * the red floor is LAVA, not ground;
//   * the long green ladder drawn along the far edge is a CEILING — this is an
//     underground level;
//   * the small red arrows with a circle on the end are KOOPAS.
//
// So the level is a crossing, not a walk. Everything Harry drew standing on the
// red is standing IN the lava, and every island runs down to the bottom row so
// it reads as stone rising out of it. Two shores, at the spawn and at the
// flagpole; between them the floor kills you.
//
//   pencil rectangles      -> 'B' islands, one column group per building
//   the three ground loops -> three bare stepping stones, three columns each,
//                             across the widest stretch of lava. They are the
//                             only way over it, which is where Harry put them.
//   the coiled mushrooms   -> a springboard on a pier, with a one-way 'P' cap
//                             above it. A cap is passable from below, so the
//                             coil throws you up THROUGH the mushroom and you
//                             land on top of it. Each cap is also a BRIDGE: it
//                             spans lava the ground under it does not.
//   the dashes in the air  -> a row of coins over the high stretch of the band
//   the red arrows         -> three koopas, at the columns he marked
//   the stick figures      -> two more koopas, one on the ledge where he drew a
//                             figure standing and one on top of a mushroom
//   the tall flag tower    -> the 7-tile tower at column 52
//   the house at the end   -> the castle
//
// GAP SIZES ARE MEASURED, NOT GUESSED. On a clear floor he spans 3.34 tiles
// from a standstill, 5.27 walking and 7.48 at a run — identical small or big
// (scratchpad/jumpreach.mjs). A 2-tile gap is therefore free even standing
// still, which is all the first version of this level was made of. Gaps here
// are 3 and 4 and half the floor is lava. Two rules fell out of that:
//
//   * NO LANDING PAD NARROWER THAN THREE COLUMNS. A running jump spans 7.5
//     tiles, so off a wide island you fly clean over a 2-wide stone into the
//     lava beyond. That killed two separate test runs.
//   * A CAP OVER A COIL MUST CATCH A SLOW BOUNCE. A walking approach drifts
//     about four tiles during the bounce and a running one about seven. The
//     second mushroom's cap is nine columns for that reason; at six it threw a
//     walking player into the lava with nothing he could do about it.
//
// The koopas are RED, not green. A green one walks straight off a ledge and
// would be in the lava long before the player arrived (koopa.js:52-53).
//
// Four podoboos come up out of the lava at the four widest crossings. They are
// the one thing in neither painting: a lake of lava that never moves reads as
// scenery, and the point of this level is that it is not scenery.
//
// TWO DELIBERATE DEPARTURES FROM THE PAINTINGS:
//
// 1. The flag is drawn on the middle tower, with half the scene still to the
//    right of it. A flagpole ENDS the level, so honouring that position would
//    make everything Harry drew after it unreachable. The tower stays where it
//    is drawn and the flagpole moved to the end, in front of the house.
// 2. Building heights are capped at what a jump can reach. His rectangles
//    measure ~6 tiles throughout; these are 3 to 7, and the tall one is climbed
//    off the first mushroom cap rather than jumped at from the floor.
//
// The theme is underground — which paints the roof and the mushroom caps green
// and the blocks lavender, close to his pencil-and-green — but the sky stays
// Harry's paper grey rather than the cave's black, because the empty paper is
// the first thing you notice about the paintings.
// ---------------------------------------------------------------------------

const TILES = [
  '##########################################################################################################################',
  '##########################################################################################################################',
  '..........................................................................................................^...............',
  '..........................................................................................................|...............',
  '..........................................................................................................|...............',
  '..........................................................................................................|...............',
  '....................................................BBBB..................................................|...............',
  '....................................................BBBB..................................................|...............',
  '....................................................BBBB...oooooooo....PPPPPPPPP..........................|...............',
  '...............BBBB........................PPPPPPP..BBBB........M...............PPPPPP....................|...............',
  '.........BBB...BBBB.....................BBB.........BBBB.................................BBBB...BBB.......|...............',
  '.........BBB...BBBB.....................BBB.........BBBB.................................BBBB...BBB.......|...............',
  '.........BBB...BBBB...BBB...BBB...BBB...BBB..BB.....BBBB...BBBBBBBB....BBBBBB....BB......BBBB...BBB.......B...............',
  '######LLLBBBLLLBBBBLLLBBBLLLBBBLLLBBBLLLBBBLLBBLLLLLBBBBLLLBBBBBBBBLLLLBBBBBBLLLLBBLLLLLLBBBBLLLBBBLLL####################',
  '######LLLBBBLLLBBBBLLLBBBLLLBBBLLLBBBLLLBBBLLBBLLLLLBBBBLLLBBBBBBBBLLLLBBBBBBLLLLBBLLLLLLBBBBLLLBBBLLL####################',
];

export default {
  id: 'h-1',
  name: 'HARRY 1',
  time: 400,
  theme: 'underground',
  // Paper grey. `sky` overrides the clear colour without changing the theme, so
  // the tiles, music and physics stay the overworld's — and the overworld lava
  // ramp is a blood red, which is the red Harry used.
  sky: 'paper',
  music: 'harry-lava',
  width: 122,
  height: 15,
  spawn: { x: 2, y: 12 },
  tiles: TILES,
  contents: [],
  entities: [
    { type: 'goomba', x: 16, y: 8 },
    // the three red arrows Harry added, in the order he drew them. Red koopas,
    // not green: a green one walks straight off a ledge and would be in the
    // lava long before you arrived. Red ones turn at the edge and patrol.
    { type: 'koopa', x: 17, y: 8, variant: 'red' },
    { type: 'podoboo', x: 20, y: 13 },
    { type: 'koopa', x: 29, y: 11, variant: 'red' },
    { type: 'podoboo', x: 32, y: 13 },
    { type: 'koopa', x: 41, y: 9, variant: 'red' },
    // mushroom 1 — the pier under the cap that bridges to the tall tower
    { type: 'springboard', x: 45, y: 10 },
    { type: 'koopa', x: 62, y: 11, variant: 'red' },
    { type: 'podoboo', x: 68, y: 13 },
    // the stick figure standing on the ledge
    { type: 'koopa', x: 72, y: 11, variant: 'red' },
    // mushroom 2 — set back from the ledge's leading edge, so a long jump lands
    // on solid ground rather than straight onto the plate
    { type: 'springboard', x: 74, y: 10 },
    // mushroom 3, and the figure Harry drew standing on top of it
    { type: 'springboard', x: 81, y: 10 },
    { type: 'koopa', x: 83, y: 8, variant: 'red' },
    { type: 'podoboo', x: 87, y: 13 },
  ],
  flagpole: { x: 106 },
  castle: { x: 110 },
};
