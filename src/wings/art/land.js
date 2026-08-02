import { TILE } from '../../core/constants.js';
import { LAND, SEA } from './palette.js';

// An island, seen from an aeroplane. It is drawn straight off the level's own
// characters — the same rows Mario walks on — but NOT with Mario's tile
// sprites: at this altitude a 16px brick sprite is mush, and the pilot's
// renderer is a vector pipeline with no sprite sheet in it anyway. What the
// pilot needs from a mile out is the SHAPE of the land and where the ground
// stops, so each character becomes a flat material with a lit top edge, and
// the top edge is the whole trick: it is what makes a stack of tiles read as
// a hillside with sun on it rather than as a wall of squares.
//
// Craters need no code here. A destroyed tile reports as '.' from charAt, so
// a bombed island is drawn with the hole already in it.

// Material per legend character. `cap` is the lit edge drawn where the tile
// above is open air; `mark` picks a shape other than a filled cell.
const M = {
  ground: { fill: LAND.earth, dark: LAND.earthDark, cap: LAND.grass, capLit: LAND.grassLit },
  stair: { fill: LAND.sand, dark: '#9a7538', cap: LAND.sandLit, capLit: LAND.sandLit },
  brick: { fill: LAND.brick, dark: '#7a3a1c', cap: LAND.brickLit, capLit: LAND.brickLit },
  block: { fill: LAND.gold, dark: '#9c7318', cap: LAND.goldLit, capLit: LAND.goldLit },
  rock: { fill: LAND.rock, dark: LAND.rockDark, cap: LAND.rockLit, capLit: LAND.rockLit },
  castle: { fill: '#6b6f78', dark: '#3f434b', cap: '#8f949d', capLit: '#8f949d' },
  pipe: { fill: LAND.pipe, dark: '#1c6b2e', cap: LAND.pipeLit, capLit: LAND.pipeLit },
  timber: { fill: LAND.timber, dark: '#6d4319', cap: '#c98a4a', capLit: '#e0a463' },
  scrub: { fill: LAND.scrub, dark: '#1f5a1c', cap: LAND.scrubLit, capLit: LAND.scrubLit, soft: true },
  lava: { fill: '#d4531a', dark: '#8a2f0c', cap: '#ffb03a', capLit: '#ffb03a' },
  water: { fill: SEA.shallow, dark: SEA.mid, cap: SEA.crest, capLit: SEA.crest },
  cloud: { mark: 'puff' },
  coin: { mark: 'coin' },
  pole: { mark: 'pole' },
  ball: { mark: 'ball' },
};

const CHAR_MATERIAL = {
  '#': M.ground,
  '=': M.brick,
  '?': M.block, M: M.block, 1: M.block, C: M.block,
  B: M.rock, S: M.stair, T: M.stair,
  '[': M.pipe, ']': M.pipe, '{': M.pipe, '}': M.pipe,
  '<': M.pipe, '>': M.pipe, '-': M.pipe, v: M.pipe,
  X: M.castle, K: M.castle, k: M.castle,
  L: M.lava, l: M.lava,
  '~': M.water, _: M.water,
  h: M.scrub, b: M.scrub, t: M.scrub, g: M.scrub,
  P: M.timber, '@': M.timber, F: M.timber,
  c: M.cloud,
  o: M.coin,
  '|': M.pole,
  '^': M.ball,
  a: M.rock,
};

// A stable per-tile jitter so a hundred identical ground tiles do not read as
// wallpaper. A hash of the coordinate, never a random number: the same island
// draws the same way on every machine and in every screenshot.
function jitter(tx, ty) {
  const h = (tx * 73856093) ^ (ty * 19349663);
  return ((h >>> 8) & 15) / 15;
}

function cell(ctx, x, y, mat, tx, ty, openAbove) {
  const j = jitter(tx, ty);
  ctx.fillStyle = mat.fill;
  if (mat.soft) {
    // Vegetation has no square edges: a mound, not a block.
    ctx.beginPath();
    ctx.moveTo(x, y + TILE);
    ctx.quadraticCurveTo(x, y + 1 + j * 3, x + TILE / 2, y + 1 + j * 2);
    ctx.quadraticCurveTo(x + TILE, y + 1 + j * 3, x + TILE, y + TILE);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillRect(x, y, TILE, TILE);
    // A darker foot on every cell gives the stack a grain, and gives the
    // bottom of a cliff somewhere to get dark.
    ctx.fillStyle = mat.dark;
    ctx.globalAlpha = 0.25 + j * 0.35;
    ctx.fillRect(x, y + TILE - 3, TILE, 3);
    ctx.globalAlpha = 1;
  }
  if (!openAbove) return;
  // The lit top edge. This is the line that turns a block of cells into
  // ground with the sun on it.
  ctx.fillStyle = mat.cap;
  if (mat.soft) {
    ctx.beginPath();
    ctx.moveTo(x, y + 4 + j * 2);
    ctx.quadraticCurveTo(x + TILE / 2, y + j * 2, x + TILE, y + 4 + j * 2);
    ctx.quadraticCurveTo(x + TILE / 2, y + 2 + j * 2, x, y + 4 + j * 2);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, TILE, 3 + Math.round(j));
    ctx.fillStyle = mat.capLit;
    ctx.fillRect(x, y, TILE, 1);
  }
}

function mark(ctx, x, y, kind, tick, j) {
  const cx = x + TILE / 2;
  const cy = y + TILE / 2;
  if (kind === 'puff') {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(cx + (i - 1) * 5, cy + (i === 1 ? -2 : 1), 5.5 - i * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  if (kind === 'coin') {
    ctx.fillStyle = LAND.gold;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 3.4, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = LAND.goldLit;
    ctx.beginPath();
    ctx.ellipse(cx - 0.8, cy - 1, 1.2, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (kind === 'pole') {
    ctx.fillStyle = LAND.rockLit;
    ctx.fillRect(cx - 1, y, 2, TILE);
    return;
  }
  if (kind === 'ball') {
    ctx.fillStyle = LAND.goldLit;
    ctx.beginPath();
    ctx.arc(cx, cy + 4, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Draw one island. `cam` is the world-pixel top-left of the viewport, `vw`/`vh`
// its size in world pixels — the same frame every other world layer draws in.
export function drawLandmass(ctx, isle, cam, vw, vh, tick = 0, seaY = 560) {
  if (isle.x1 < cam.x - TILE || isle.x0 > cam.x + vw + TILE) return;

  const tx0 = Math.max(0, Math.floor((cam.x - isle.x0) / TILE) - 1);
  const tx1 = Math.min(isle.w - 1, Math.ceil((cam.x + vw - isle.x0) / TILE) + 1);
  const ty0 = Math.max(0, Math.floor((cam.y - isle.y0) / TILE) - 1);
  const ty1 = Math.min(isle.h - 1, Math.ceil((cam.y + vh - isle.y0) / TILE) + 1);
  if (tx1 < tx0 || ty1 < ty0) return;

  ctx.save();
  ctx.translate(isle.x0 - cam.x, isle.y0 - cam.y);

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const ch = isle.charAt(tx, ty);
      if (ch === '.' || ch === ' ') continue;
      const mat = CHAR_MATERIAL[ch] || M.rock;
      const x = tx * TILE;
      const y = ty * TILE;
      if (mat.mark) {
        mark(ctx, x, y, mat.mark, tick, jitter(tx, ty));
        continue;
      }
      const above = isle.charAt(tx, ty - 1);
      const openAbove = ty === 0 || above === '.' || above === ' '
        || !CHAR_MATERIAL[above] || CHAR_MATERIAL[above].mark || CHAR_MATERIAL[above].soft;
      cell(ctx, x, y, mat, tx, ty, openAbove);
    }
  }

  ctx.restore();

  // Surf. Where the island meets the water there is a bright line, and it is
  // what tells the pilot the difference between a beach he can bomb and a
  // lagoon he would sink in.
  const bottom = isle.h - 1;
  const wy = seaY - cam.y;
  if (wy < -8 || wy > vh + 8) return;
  ctx.save();
  ctx.fillStyle = LAND.surf;
  for (let tx = tx0; tx <= tx1; tx++) {
    if (isle.charAt(tx, bottom) === '.') continue;
    const x = isle.x0 + tx * TILE - cam.x;
    const swell = Math.sin((tx * 0.9 + tick * 0.06)) * 1.4;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x, wy - 3 + swell, TILE, 2);
    ctx.globalAlpha = 0.25;
    ctx.fillRect(x, wy - 1 + swell, TILE, 3);
  }
  ctx.restore();
}

export default drawLandmass;
