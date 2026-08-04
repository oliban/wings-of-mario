// Layers 2 and 3 of the telegraph: the shadow marker on the ground and the
// screen-edge arrow.
//
// Everything here works in 256x240 GAME pixels on whole-pixel fillRects. The
// overlay applies the display scale as a canvas transform before calling in,
// so one game pixel becomes k device pixels and the marker stays on the same
// grid as the world beneath it. There is no ctx.rotate anywhere in this file:
// the eight directions are a sprite grid, because a rotated rect antialiases
// and the picture under it is hard-edged.

export const TG_ART = {
  // A hazard red that exists nowhere in the SMB tile palettes, so a reticle is
  // never mistaken for scenery, and a warm core so the exact tile reads even
  // when the brackets are at full spread.
  reticle: '#ff3b2f',
  core: '#ffd24a',
  arrow: '#ff3b2f',
  // A one-pixel drop shadow under both, for legibility over bright ground.
  shadow: '#2a0a06',
};

// Pointing +X (right). +Y is DOWN throughout this repo.
//
// A solid head with a shaft behind it, not a bare `>` chevron: a chevron's lit
// mass sits BEHIND its tip, so at seven pixels it reads as an ambiguous wedge
// and its centre of mass points backwards. Here the mass is ahead of centre,
// which is the same thing the eye uses to read the direction.
const ARROW_E = [
  '...0...',
  '...00..',
  '...000.',
  '0000000',
  '...000.',
  '...00..',
  '...0...',
];

// Pointing up and to the right: a right triangle with its legs along the top
// and right edges, which reads as a direction at seven pixels where a thin
// chevron does not.
const ARROW_NE = [
  '0000000',
  '.000000',
  '..00000',
  '...0000',
  '....000',
  '.....00',
  '......0',
];

const mirrorX = (g) => g.map((row) => [...row].reverse().join(''));
const mirrorY = (g) => [...g].reverse();
// [y][x] -> [x][y]: sends +X to +Y, so an east arrow becomes a south one.
const transpose = (g) => g[0].split('').map((_, y) => g.map((row) => row[y]).join(''));

export const ARROWS = {
  E: ARROW_E,
  W: mirrorX(ARROW_E),
  S: transpose(ARROW_E),
  N: mirrorY(transpose(ARROW_E)),
  NE: ARROW_NE,
  NW: mirrorX(ARROW_NE),
  SE: mirrorY(ARROW_NE),
  SW: mirrorY(mirrorX(ARROW_NE)),
};

// Clockwise from east, because +Y is down: E, SE, S, SW, W, NW, N, NE.
const BY_OCTANT = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

export function arrowFor(angle) {
  const turn = Math.PI * 2;
  const a = ((angle % turn) + turn) % turn;
  const octant = Math.round(a / (Math.PI / 4)) % 8;
  return ARROWS[BY_OCTANT[octant]];
}

function stamp(ctx, grid, x, y, colour) {
  ctx.fillStyle = colour;
  for (let gy = 0; gy < grid.length; gy++) {
    const row = grid[gy];
    for (let gx = 0; gx < row.length; gx++) {
      if (row[gx] === '0') ctx.fillRect(x + gx, y + gy, 1, 1);
    }
  }
}

// The shadow marker. (cx, cy) is the CENTRE OF THE IMPACT TILE'S TOP EDGE in
// game pixels — the reticle sits ON the ground it is about to remove, not
// floating over it. `r` is the half-width from reticleRadius().
//
// opts: { urgent (bool), frame (int, for the blink — a frame counter, never a
// clock) }
export function drawReticle(ctx, cx, cy, r, opts = {}) {
  const x = Math.round(cx);
  const y = Math.round(cy);
  const rr = Math.max(3, Math.round(r));
  const arm = Math.max(2, Math.round(rr * 0.6));

  // Four corner brackets. Drawn shadow-first, one pixel down and right.
  for (const [colour, ox, oy] of [[TG_ART.shadow, 1, 1], [TG_ART.reticle, 0, 0]]) {
    ctx.fillStyle = colour;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const px = x + sx * rr + ox;
        const py = y + sy * rr + oy;
        ctx.fillRect(sx < 0 ? px : px - arm + 1, py, arm, 1);
        ctx.fillRect(px, sy < 0 ? py : py - arm + 1, 1, arm);
      }
    }
  }

  // The core pip marks the tile itself. Inside the last half-second it blinks,
  // which is the only moving part of the instrument and therefore the only
  // thing that can say "now".
  if (!opts.urgent || ((opts.frame || 0) >> 2) % 2 === 0) {
    ctx.fillStyle = TG_ART.core;
    ctx.fillRect(x - 1, y - 1, 3, 2);
  }
}

// The edge indicator. (x, y) is already a screen position on the edge band, in
// game pixels, from telegraph.edgeArrow().
export function drawEdgeArrow(ctx, x, y, angle) {
  const grid = arrowFor(angle);
  const ox = Math.round(x) - 3;
  const oy = Math.round(y) - 3;
  stamp(ctx, grid, ox + 1, oy + 1, TG_ART.shadow);
  stamp(ctx, grid, ox, oy, TG_ART.arrow);
}
