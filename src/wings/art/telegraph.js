// Layers 2, 3 and 4 of the telegraph: the shadow marker on the ground, the
// screen-edge arrow, and the bomb itself once it is low enough to be in shot.
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
  // The bomb. Cold steel against a warm reticle: they are the two ends of the
  // same warning and must never be confused for one another at a glance. All
  // three are darker than SMB's sky and brighter than its pipe green, so the
  // silhouette holds against both.
  bombBody: '#4a5160',
  bombLit: '#cfd6e2',
  bombFin: '#20242e',
  // The moment of arrival, one frame before the crater.
  flash: '#fff3c4',
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

// The same, for a grid with more than one ink. `'*'` in the palette paints
// every lit pixel regardless of its char, which is how the drop shadow is
// stamped from the same grid as the sprite.
function stampInks(ctx, grid, x, y, inks) {
  for (let gy = 0; gy < grid.length; gy++) {
    const row = grid[gy];
    for (let gx = 0; gx < row.length; gx++) {
      const ch = row[gx];
      if (ch === '.') continue;
      const colour = inks['*'] || inks[ch];
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(x + gx, y + gy, 1, 1);
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

// ---------------------------------------------------------------------------
// The bomb itself.
//
// Nine pixels, on the same sprite-grid principle as the arrows and for the
// same reason: a rotated rect antialiases, and a bomb that goes soft at the
// edges stops reading as a hard object against 8-bit scenery. `0` is the body,
// `1` the specular line down its spine — dead centre, so it survives every
// mirror and transpose below — and `2` the tail fins, which are what tell the
// eye which end is the nose.
const BOMB_S = [
  '..2...2..',
  '..2.1.2..',
  '..22122..',
  '...010...',
  '...010...',
  '...010...',
  '...010...',
  '...000...',
  '....0....',
];

// Nose to the bottom-right. A three-wide band down the diagonal with the fins
// stepped off the tail; drawn by hand rather than derived, because a rotated
// 45-degree sprite has to be redrawn to stay readable.
const BOMB_SE = [
  '2.2......',
  '0102.....',
  '2010.....',
  '.2010....',
  '...010...',
  '....010..',
  '.....010.',
  '......010',
  '........0',
];

export const BOMBS = {
  S: BOMB_S,
  N: mirrorY(BOMB_S),
  E: transpose(BOMB_S),
  W: mirrorX(transpose(BOMB_S)),
  SE: BOMB_SE,
  SW: mirrorX(BOMB_SE),
  NE: mirrorY(BOMB_SE),
  NW: mirrorX(mirrorY(BOMB_SE)),
};

export function bombFor(angle) {
  const turn = Math.PI * 2;
  const a = ((angle % turn) + turn) % turn;
  const octant = Math.round(a / (Math.PI / 4)) % 8;
  return BOMBS[BY_OCTANT[octant]];
}

// Below this the bomb is hanging rather than falling and a speed streak behind
// it would be a lie. Two px/frame is an eighth of terminal velocity.
const TRAIL_SPEED = 2;
const TRAIL_AT = [8, 12, 16];

// (x, y) is the bomb's centre in GAME pixels, already camera-relative;
// `angle` is atan2(vy, vx). opts: { speed } in px/frame, for the streak.
export function drawFallingBomb(ctx, x, y, angle, opts = {}) {
  const grid = bombFor(angle);
  const cx = Math.round(x);
  const cy = Math.round(y);

  // The streak first, so the bomb sits on top of it: three dots receding along
  // the reversed velocity, which is the path it has just come down. It is what
  // makes a 9px sprite read as MOVING in a still frame — and a still frame is
  // exactly what a player gets when he is deciding which way to run.
  const speed = opts.speed || 0;
  if (speed >= TRAIL_SPEED) {
    ctx.fillStyle = TG_ART.shadow;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    for (const d of TRAIL_AT) {
      ctx.fillRect(Math.round(x - ux * d), Math.round(y - uy * d), 1, 1);
    }
  }

  const ox = cx - 4;
  const oy = cy - 4;
  stampInks(ctx, grid, ox + 1, oy + 1, { '*': TG_ART.shadow });
  stampInks(ctx, grid, ox, oy, {
    0: TG_ART.bombBody,
    1: TG_ART.bombLit,
    2: TG_ART.bombFin,
  });
}

// Arrival. `t` runs 0..1 over the handful of frames between the bomb reaching
// its mark and the crater appearing, which is a network round trip away: this
// is what stops those frames reading as the bomb having simply vanished.
// A cross of whole pixels punching outward, no curves and no alpha.
export function drawImpactFlash(ctx, x, y, t) {
  if (t < 0 || t >= 1) return;
  const cx = Math.round(x);
  const cy = Math.round(y);
  const r = Math.round(3 + 11 * t);
  const arm = Math.max(1, Math.round(4 * (1 - t)));
  ctx.fillStyle = t < 0.5 ? TG_ART.flash : TG_ART.core;
  ctx.fillRect(cx - r, cy - 1, r * 2, 2);
  ctx.fillRect(cx - 1, cy - r, 2, r * 2);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const d = Math.round(r * 0.7);
      ctx.fillRect(cx + sx * d - (sx < 0 ? arm : 0), cy + sy * d, arm, 1);
    }
  }
}
