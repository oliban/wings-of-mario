// The pilot's colour scheme, in one place, because the whole look depends on
// relationships between these values rather than on any one of them.
//
// Two rules drive everything here, both taken from the 1987 original and both
// design decisions rather than hardware accidents:
//
//   VALUE HIERARCHY, taken by sampling the user's own reference screenshots
//   rather than from any earlier guess. The sky is the BRIGHTEST large area at
//   luma 143; the ship is a light grey that sits right beside it and separates by
//   hue and by its dark structural lines; the sea is a dark saturated blue at
//   47-104; and the aircraft is a DARK shape at 38-128 carrying small white
//   markings at 255. The aeroplane reads because it is the darkest, most
//   saturated object against a bright sky — the opposite of the arrangement that
//   a black sky calls for, and the arrangement the user actually pictures.
//
//   HUE SEPARATION. Sky and sea are the same blue family at very different
//   values; the ship is a near-neutral cool grey; the aircraft is a dark
//   desaturated blue with white markings and one warm accent. Measured off the
//   reference: sky #00aeff, hull #8d8c9c, sea #00488e-#426d9a.
//
// Nothing here is a pixel-art palette. Anti-aliasing, gradients and arbitrary
// colour depth are all in use — the pilot renders through its own Canvas2D
// renderer and imports none of the Mario engine's sprite pipeline.

// ---------------------------------------------------------------------------
// Sky — near black. See SKY_STYLE below for the graded/flat decision.
// ---------------------------------------------------------------------------
export const SKY = {
  zenith: '#0090e6',
  high: '#009cf0',
  mid: '#00a8fa',
  horizon: '#2bb8ff',
  flat: '#00aeff',
};

// The user's references settle this: a strong saturated mid-blue, #00aeff, filling
// most of the frame. Theirs is flat; ours grades by about twenty luma points from
// ceiling to horizon, which still reads as one blue at a glance but gives the
// player a cue over a 560-pixel climb that a 1987 side-view game never had to
// convey. Set SKY_STYLE to 'flat' for the reference's exact treatment.
export const SKY_STYLE = 'graded';

// Fair-weather cumulus. White is safe now that the aeroplane is the DARK object:
// a bright cloud behind a dark aircraft helps it rather than competing with it.
export const CLOUD = {
  core: '#bcd9f0',
  lit: '#e8f4ff',
  crown: '#ffffff',
  base: '#8fbde0',
};

// ---------------------------------------------------------------------------
// Sea — saturated cyan-teal, the mid value of the scene.
// ---------------------------------------------------------------------------
export const SEA = {
  crest: '#5b9fd6',
  surface: '#2f76b4',
  shallow: '#1c5b98',
  mid: '#124479',
  deep: '#0b2f56',
  abyss: '#061a30',
  foam: '#ffffff',
  foamShade: '#a8cbe8',
};

// ---------------------------------------------------------------------------
// Carrier — a hue nothing else on screen uses. The original's flat magenta,
// desaturated into a slate-violet that survives being next to a cyan sea.
// ---------------------------------------------------------------------------
// Sampled straight off the reference: a cool grey with a faint violet cast,
// #8d8c9c, with #646373 and #434252 under it. The earlier slate violet had the
// right instinct and far too much saturation.
export const SHIP = {
  deckLit: '#a8a8b8',
  deck: '#8d8c9c',
  deckShade: '#757585',
  hullLit: '#9d9baa',
  hull: '#8d8c9c',
  hullShade: '#646373',
  hullDark: '#434252',
  island: '#8d8c9c',
  islandLit: '#a8a8b8',
  islandShade: '#646373',
  rule: '#c9c9d6',
  window: '#323040',
  boot: '#3a3444',
  lamp: '#ffe08a',
  crew: '#e2703a',
  crewSkin: '#f6cfa4',
};

export const ENSIGN = {
  field: '#f4f6fb',
  stripe: '#d33a35',
  canton: '#26418f',
};

// ---------------------------------------------------------------------------
// Aircraft — the brightest object in frame, and the only neutral one.
// ---------------------------------------------------------------------------
// The aircraft carries the brightest values in the frame, but it is a WARPLANE,
// not a trainer: US Navy 1944 scheme, dark sea blue over light gull grey with a
// hard demarcation between them. The dark upper surface is still three times the
// luminance of the sky, and putting the light grey underneath is what gives the
// rim light something to sit on — a uniformly pale aeroplane had nothing for the
// highlight to be brighter *than*.
// A dark blue-grey warplane on a bright sky, with white national markings — 1944
// overall gloss sea blue. Every airframe tone is below the sky's luma of 143, so
// the aeroplane reads as a dark saturated shape; the markings and the canopy
// glint are the only bright things on it, and they are small and hard-edged.
//
// This is a straight inversion of the scheme built for a near-black sky. The
// silhouette work is unchanged — taper, fin, cowl, canopy — only the values are
// restated.
export const PLANE = {
  spec: '#ffffff',      // markings, canopy glint, spinner
  light: '#5f88ad',     // lit lower surfaces, still darker than the sky
  skin: '#48709a',
  mid: '#33587e',
  shade: '#22405e',
  dark: '#16283e',      // shadowed upper surfaces
  contact: '#0a1220',   // contact edges
  canopy: '#bfe0f2',
  canopyDark: '#3f6f92',
  canopyFrame: '#132234',
  pilot: '#e8c9a0',
  flash: '#c03626',     // the one warm accent: a rudder band
  flashDark: '#7d1f13',
  insignia: '#ffffff',
  prop: '#dce9f7',
};

// ---------------------------------------------------------------------------
// Instrument panel — the original's bright green bezel, which is as much a
// signature as the black sky.
// ---------------------------------------------------------------------------
export const PANEL = {
  bezel: '#7dbf35',
  bezelLit: '#c2ee76',
  bezelShade: '#3d6a16',
  body: '#0a0d11',
  well: '#04060a',
  face: '#111922',
  faceEdge: '#2b3947',
  ink: '#dfe9f2',
  inkDim: '#7d8fa1',
  needle: '#ff6a3d',
  ok: '#5fd07a',
  warn: '#e8b13c',
  danger: '#e0452a',
};

// ---------------------------------------------------------------------------
// Islands — the only WARM large area in the scene, which is the whole job.
// From two hundred pixels up an island has to read as land in one glance,
// against a cyan sea and a blue sky, so it is separated by hue before it is
// separated by value: earth, sand and vegetation, none of which appear
// anywhere else. Every tone here sits below the sky's luma of 143 so the
// aeroplane still owns the top of the value hierarchy.
// ---------------------------------------------------------------------------
export const LAND = {
  earth: '#8a5a2b',
  earthLit: '#a9733c',
  earthDark: '#5b3717',
  grass: '#3f8f2e',
  grassLit: '#68bb45',
  sand: '#c8a05a',
  sandLit: '#e0c088',
  rock: '#7f858e',
  rockLit: '#a2a8b1',
  rockDark: '#4b5058',
  brick: '#a4522a',
  brickLit: '#c2703c',
  gold: '#d9a327',
  goldLit: '#f4d268',
  pipe: '#2e9e46',
  pipeLit: '#57c86a',
  timber: '#a46a2e',
  scrub: '#2f7a2a',
  scrubLit: '#4d9c3d',
  surf: '#dff0ff',
  shadow: 'rgba(6,26,48,0.35)',
};

// ---------------------------------------------------------------------------
// The island's TILE palette — Super Mario Bros., and specifically THIS GAME'S
// Super Mario Bros.
//
// LAND above is a landscape palette: earth, sand, scrub, chosen so a landmass
// reads as land from a mile up. It is still what the surf and the coastline
// use. But the blocks standing on that land are not landscape, and they are
// not the pilot's to invent either: the player on the ground is looking at
// these same tiles from six feet away, in artwork that is already authored,
// already approved, and guarded by a boot-time assertion. Two halves of one
// game drawing the same brick from two disjoint colour systems is the fault
// this palette exists to end.
//
// SOURCE. Every ramp below is copied from `src/data/tiles.js` (EARTH, BRICK,
// ASHLAR, STONE, QUARRY, PIPE, TIMBER, GOLD, GLYPH) and `src/data/scenery.js`
// (P_GREEN, P_CLOUD, P_STONE, P_FLAG). COPIED, not imported: those modules are
// the Mario engine's sprite pipeline, authored for a 256x240 NES framebuffer,
// and the pilot's renderer must not depend on them. If they change, these
// change — the values are the contract, and `tests/unit/island-tiles.test.js`
// holds them to the same separation the Mario side asserts on itself.
//
// RAMP SHAPE. Five slots, dark to light:
//
//   0 outline   1 shadow   2 body   3 lit   4 bright
//
// and five themes, because in this game a material is a different hue in every
// area — that is a rule `tiles.js` states and measures, not a decoration.
// ---------------------------------------------------------------------------

// Ground. The floor of every level.
const EARTH = {
  overworld: ['#100400', '#281004', '#70380e', '#b86e22', '#d49a54'],
  underground: ['#020e0a', '#0a221a', '#1e5e48', '#3c9e7a', '#6abea0'],
  castle: ['#06060a', '#1c1c2c', '#40405e', '#6e6e92', '#9a9ab6'],
  water: ['#0a0806', '#201c16', '#524638', '#887662', '#ac9e8c'],
  athletic: ['#040e02', '#0e220a', '#2a601c', '#4aa23a', '#76c268'],
};

// The one thing the player is allowed to smash, so it is the one warm
// saturated masonry in every theme — and never gold, or it would eat the
// question block's "this one is special".
const BRICK = {
  overworld: ['#26100a', '#a02a06', '#ee5814', '#ff9254', '#ffc49a'],
  underground: ['#140806', '#7a3a24', '#b46844', '#d89a70', '#f0c8a0'],
  castle: ['#2a0818', '#84264e', '#c8467e', '#e08aa8', '#f4c0d0'],
  water: ['#1a0202', '#96221c', '#f45240', '#ffa69a', '#ffdad2'],
  athletic: ['#18061c', '#742a7e', '#b854c0', '#d894dc', '#f0c6f4'],
};

// The castle wall: cold dressed stone, a full value tier ABOVE the breakable
// brick, so "I can smash this" and "I cannot" separate in greyscale alone.
const ASHLAR = {
  overworld: ['#02060e', '#3a68c6', '#84a4e2', '#c0d2f4', '#e8f0fc'],
  underground: ['#141e24', '#4a6272', '#88a0b2', '#c2d2dc', '#e8f2f8'],
  castle: ['#1c1028', '#7a58aa', '#ac8ad4', '#d0bcee', '#ecdeff'],
  water: ['#10040e', '#b442a2', '#dc80cc', '#f2b8e8', '#ffe4fa'],
  athletic: ['#04322c', '#1e8670', '#38ccac', '#74f2d4', '#b4ffe8'],
};

// The plain solid block.
const STONE = {
  overworld: ['#0e080c', '#6a4458', '#9e768c', '#cab0be', '#f4e0ea'],
  underground: ['#160e20', '#5c3e7a', '#8c64ac', '#b496ce', '#dacaea'],
  castle: ['#1c1410', '#5e4438', '#8e6c58', '#b89484', '#dcc0b0'],
  water: ['#06080c', '#465a76', '#6e84a2', '#9caec4', '#c2d2e4'],
  athletic: ['#121c10', '#344832', '#5c7e56', '#8aac84', '#b6d0b0'],
};

// The staircase block, and the light tier of every theme. Cut sandstone above
// ground, because the 1-1 staircase in the original is warm brown masonry.
const QUARRY = {
  overworld: ['#221a14', '#6a5038', '#9c7c5c', '#c8a884', '#f0dcbc'],
  underground: ['#0c160e', '#3e7c56', '#66ac80', '#98cca8', '#c8ecd4'],
  castle: ['#14140c', '#6e6c48', '#9c9a7c', '#c4c4b2', '#dcdcd0'],
  water: ['#1c0a10', '#8a4450', '#b87280', '#d6a4ac', '#f8d0d4'],
  athletic: ['#0a0e10', '#466472', '#729aa8', '#a6c6d2', '#d2e8f0'],
};

const PIPE = {
  overworld: ['#0a3010', '#0a5a12', '#22a028', '#66d84e', '#c8f79a'],
  underground: ['#062010', '#0e4a2c', '#1a8452', '#3cc078', '#9cecb4'],
  castle: ['#0a1a10', '#204028', '#3a6a44', '#68a072', '#b4d8b8'],
  water: ['#04281c', '#0a6650', '#12a07c', '#48d0a0', '#a8f0cc'],
  athletic: ['#123008', '#2c7010', '#54b420', '#92e04c', '#daf89a'],
};

// The one-way platform, and nothing else. Always the lightest ramp in its
// theme: a platform you can jump THROUGH must not look like terrain.
const TIMBER = {
  overworld: ['#301806', '#aa6428', '#d69c64', '#ecc6a0', '#fff2d4'],
  underground: ['#0a0e04', '#56762c', '#8ebe5a', '#bedea0', '#f0ffdc'],
  castle: ['#040a0c', '#426e88', '#7eaabe', '#bcd6e0', '#f0ffff'],
  water: ['#101008', '#828444', '#b2b27c', '#d2d2b2', '#f0f0e4'],
  athletic: ['#16080e', '#86405a', '#c2869c', '#eaccda', '#fff8ff'],
};

export const MARIO = {
  EARTH,
  BRICK,
  ASHLAR,
  STONE,
  QUARRY,
  PIPE,
  TIMBER,

  // Gold stays gold in every area — only its outline picks up the theme — so
  // the question block always reads as "special". Four slots; the theme's
  // outline is prepended at draw time.
  GOLD: ['#7e5804', '#c08c0e', '#f0c832', '#fff2ac'],
  GLYPH: ['#3d1a00', '#fff6d2'],

  // Scenery. Bush, hill and tree canopy share one ramp, as they share one
  // silhouette; the cloud is that silhouette in the cloud ramp.
  GREEN: ['#001e00', '#077704', '#3fb52e', '#8fd96a', '#bdf4ab'],
  BARK: ['#32190c', '#48280e', '#6d4116', '#93601e', '#bb832f'],
  CLOUD: ['#101f8c', '#5c82ee', '#b3c4fc', '#d8e3ff', '#ffffff'],

  // The end-of-level keep: warm castle stone, with a true black for the
  // doorway and a rim so no opening is flat black.
  KEEP: ['#28130a', '#5e2b0e', '#b3651f', '#d98c3a', '#f2b567'],
  VOID: '#000000',
  VOID_RIM: '#241209',

  // The flag: cool linen, with a red mushroom badge on it.
  FLAG: ['#1e2440', '#8598cc', '#dfe8f8', '#ffffff'],
  BADGE: ['#2a1108', '#c62c22', '#f7e8d2'],

  // No authoritative ramp on the Mario side for these three, so they are the
  // pilot's own, kept in the same idiom.
  IRON: ['#0a0a10', '#2a2a34', '#4c4c5a', '#84848e', '#b8b8c0'],
  LAVA: ['#3a0c02', '#8b2408', '#e05010', '#fca044', '#ffd89a'],
};

export const ORD = {
  steel: '#aab6c4',
  steelLit: '#eef4fb',
  steelDark: '#3d4a5a',
  tracer: '#ffd66b',
  flameCore: '#fff4c4',
  flameHot: '#ffd06b',
  flameMid: '#e2842a',
  flameLow: '#a4470f',
  smoke: '#3a3a44',
};

// Relative luminance, used by the tests that guard the hierarchy above.
export function luma(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
