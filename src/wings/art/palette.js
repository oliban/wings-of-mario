// The pilot's colour scheme, in one place, because the whole look depends on
// relationships between these values rather than on any one of them.
//
// Two rules drive everything here, both taken from the 1987 original and both
// design decisions rather than hardware accidents:
//
//   VALUE HIERARCHY. The sky is the darkest thing on screen, the sea sits in the
//   middle, and the aircraft carries the brightest highlights in the frame. A
//   small fast-moving object stays legible when it is the *brightest* thing
//   present, and it is the aircraft the player is looking at. Approximate
//   luminance: sky 2-30, sea 60-145, ship 40-190, aircraft 50-255.
//
//   HUE SEPARATION. Every major object owns a hue nobody else uses — sky
//   near-black indigo, sea cyan, ship violet, aircraft neutral white-grey with a
//   warm flash. That is why a still of the original is readable at a glance, and
//   it is achievable at any colour depth. The original's specific magenta is a
//   six-colour palette accident; the strategy is not.
//
// Nothing here is a pixel-art palette. Anti-aliasing, gradients and arbitrary
// colour depth are all in use — the pilot renders through its own Canvas2D
// renderer and imports none of the Mario engine's sprite pipeline.

// ---------------------------------------------------------------------------
// Sky — near black. See SKY_STYLE below for the graded/flat decision.
// ---------------------------------------------------------------------------
export const SKY = {
  zenith: '#000105',
  high: '#020514',
  mid: '#040b22',
  horizon: '#0a1636',
  flat: '#000000',
};

// The original's sky is literally #000000 and that is the single most
// recognisable thing about the game. We keep the value, not the flatness: a very
// dark graded indigo reads as black at a glance while giving the player an
// altitude cue over a 560px climb the original never had to convey. Set to
// 'flat' for the pure-black homage; both were rendered and compared.
export const SKY_STYLE = 'graded';

// Cloud banks are the only light thing in the sky, and they are dim — a cloud
// brighter than the aeroplane would break the hierarchy.
export const CLOUD = {
  core: '#16224a',
  lit: '#243463',
  crown: '#334a7d',
  base: '#0b1229',
};

export const STAR = '#5f7bb5';

// ---------------------------------------------------------------------------
// Sea — saturated cyan-teal, the mid value of the scene.
// ---------------------------------------------------------------------------
export const SEA = {
  crest: '#5fdcff',
  surface: '#1aa8d8',
  shallow: '#0f83b4',
  mid: '#0a5f86',
  deep: '#053f5c',
  abyss: '#02202f',
  foam: '#eaffff',
  foamShade: '#a5e6f8',
};

// ---------------------------------------------------------------------------
// Carrier — a hue nothing else on screen uses. The original's flat magenta,
// desaturated into a slate-violet that survives being next to a cyan sea.
// ---------------------------------------------------------------------------
export const SHIP = {
  deckLit: '#e8e1f4',
  deck: '#b5a8ca',
  deckShade: '#8b7ca6',
  hullLit: '#7d5fa6',
  hull: '#63498a',
  hullShade: '#472f68',
  hullDark: '#2c1c45',
  island: '#8f74b8',
  islandLit: '#a98fd0',
  islandShade: '#5f4585',
  rule: '#f2ecfb',
  window: '#150d22',
  boot: '#7c2440',
  lamp: '#ffd98a',
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
export const PLANE = {
  spec: '#ffffff',
  light: '#e2eaf3',
  skin: '#b6c4d3',
  mid: '#8496a9',
  shade: '#4d5f74',
  dark: '#2a3746',
  contact: '#0a0f16',
  canopy: '#8fdcff',
  canopyDark: '#1f4e68',
  canopyFrame: '#243447',
  pilot: '#e8c9a0',
  flash: '#e2542c',
  flashDark: '#8f2d14',
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
