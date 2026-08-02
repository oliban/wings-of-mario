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
