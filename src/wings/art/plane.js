import { makeSprite, Anim } from '../../core/gfx.js';

// A carrier fighter-bomber, right-facing and level. Sun from the upper-left:
// slot 3 is the lit spine, slot 1 the shaded belly. Slot 6 is the canopy glass
// and slot 4 the prop disc, the only two things on the aircraft that catch a
// specular highlight.
export const PLANE_PAL = [
  '#0a0d14', // 0 outline
  '#2e4155', // 1 shadow
  '#4a657f', // 2 mid
  '#7392b0', // 3 lit spine
  '#cfe2f7', // 4 highlight / prop disc
  '#12304e', // 5 canopy frame
  '#69c4ff', // 6 canopy glass
  '#c34a34', // 7 squadron flash
];
PLANE_PAL[12] = '#a9bdd2'; // c: prop blur, one step down from the highlight

const A = [
  '...0....................',
  '..0130..................',
  '..01230.................',
  '..012230................',
  '.0012223000000000000004.',
  '0111222333333336655500c4',
  '.0112222222222266655500c',
  '..01122222222222222110c4',
  '...0112222222221100004..',
  '.....01222222110....04..',
  '......01122110......04..',
  '.......000000........0..',
];

// Frame B moves the disc highlight down the arc, so the blade reads as turning
// rather than as a static smear.
const B = [
  '...0....................',
  '..0130..................',
  '..01230.............0...',
  '..012230............0c..',
  '.0012223000000000000004.',
  '0111222333333336655500c4',
  '.0112222222222266655500c',
  '..01122222222222222110c4',
  '...0112222222221100004..',
  '.....01222222110....0c..',
  '......01122110......0...',
  '.......000000...........',
];

export const PLANE_FRAMES = [
  makeSprite(A, PLANE_PAL, { name: 'wings.plane.a' }),
  makeSprite(B, PLANE_PAL, { name: 'wings.plane.b' }),
];

// Two ticks a frame: at 60Hz the disc strobes, which is what a propeller does.
export const PLANE_ANIM = new Anim(PLANE_FRAMES, 2);

// Drawn under the tail when the hook is down, so "gear" is visible on the
// aircraft and not just a word in the HUD.
export const HOOK = makeSprite(
  ['.000..', '.011..', '..01..', '..010.', '...01.', '...00.'],
  PLANE_PAL,
  { name: 'wings.hook' }
);
