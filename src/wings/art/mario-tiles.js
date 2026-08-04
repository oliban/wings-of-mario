import { TILE } from '../../core/constants.js';
import { SMB, SEA } from './palette.js';

// The Super Mario Bros. tile set, redrawn as vector art for the pilot's view.
//
// WHY THIS FILE EXISTS. The pilot used to draw every level character as a flat
// coloured rectangle with a lit top edge — good landscape, wrong game. What
// makes a strip of blocks read as MARIO is not that it is land, it is that the
// blocks are those blocks: a question block has a face and rivets, a brick has
// mortar, a pipe has a rim wider than its barrel, and a bush and a cloud are
// the same scalloped silhouette in two colours. None of that survives being
// approximated as a rectangle, and all of it survives being drawn as shapes.
//
// TWO RULES THIS FILE IS BUILT AROUND.
//
//   1. SILHOUETTE AND STRUCTURE, NOT PIXELS. The pilot renders through a
//      supersampled vector pipeline with no sprite sheet, so there is nothing
//      to be gained by snapping to an 8x8 NES grid and something to be lost:
//      curves come out as curves. Every shape here is authored in the tile's
//      own 16-unit space and drawn with whatever the renderer can give it.
//      Original artwork throughout — proportions and palette relationships are
//      the homage, no asset is copied.
//
//   2. LEGIBILITY IS PART OF FIDELITY AT THIS ALTITUDE. The pilot's zoom runs
//      from 1.15 down to 0.32, which puts a tile between 18 and 5 screen
//      pixels. A question block's rivets are four correct pixels at 18 and
//      four grains of noise at 5. So every painter takes a level of detail and
//      drops ornament as the world shrinks, in a fixed order: ornament first,
//      then pattern, then everything but the block's colour, its outline and
//      its one identifying mark. What is left at the smallest scale is chosen
//      to be the thing that still says "Mario" — the gold square with a dark
//      glyph, the orange grid, the green pipe with its wide head.
//
// Nothing here reads a clock. `mark` animations take the simulation tick.

export const LOD = { COARSE: 0, MID: 1, FULL: 2 };

// Device pixels per tile at which each level of detail switches on. Measured
// against the zoom the game actually uses: 18.4px at the attack altitude,
// 12.3 in the middle of the climb, 6.9 high up, 5.1 at the service ceiling.
export function lodFor(scale) {
  const px = TILE * (scale || 1);
  if (px >= 11) return LOD.FULL;
  if (px >= 6.5) return LOD.MID;
  return LOD.COARSE;
}

const TAU = Math.PI * 2;

// A circle as its own subpath. Canvas joins consecutive arcs with a straight
// line, so a row of dots added without this comes out strung together on a
// bar — which is precisely what the hill's face did on the first pass.
function disc(ctx, cx, cy, r, from = 0, to = TAU) {
  ctx.moveTo(cx + r * Math.cos(from), cy + r * Math.sin(from));
  ctx.arc(cx, cy, r, from, to);
}

// ---------------------------------------------------------------------------
// Area palettes
// ---------------------------------------------------------------------------

// The same block, recoloured by where you are. This is not decoration: in the
// original the ground block, the brick and the solid block share ONE piece of
// artwork across the whole game and are told apart only by the area's palette,
// which is why an underground level reads as blue and a castle as grey with no
// new tiles drawn for either. The pilot's islands are the same levels, so they
// get the same treatment — 1-2 was coming out as an orange overworld island
// standing in the sea, which is the wrong level.
//
// The pipe, the question block and the scenery keep their own colours in every
// area, exactly as the original does.
export const THEME = {
  overworld: {
    body: SMB.orange, lit: SMB.orangeLit, dark: SMB.orangeDark, mortar: SMB.mortar,
  },
  // The tree-top levels use the overworld's blocks.
  athletic: {
    body: SMB.orange, lit: SMB.orangeLit, dark: SMB.orangeDark, mortar: SMB.mortar,
  },
  underground: {
    body: '#3068d8', lit: '#7cb4f8', dark: '#1c3c90', mortar: '#0c1c48',
  },
  water: {
    body: '#0f8a86', lit: '#5cd8cc', dark: '#075450', mortar: '#04302e',
  },
  castle: {
    body: SMB.stone, lit: SMB.stoneLit, dark: SMB.stoneDark, mortar: '#4c4c56',
  },
};

export function themeFor(name) {
  return THEME[name] || THEME.overworld;
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

// The hard dark line around every block in the game. Drawn as four strips
// rather than a stroke so it never straddles the tile edge and never doubles
// up where two blocks meet.
function outline(ctx, x, y, w, h, lod, colour = SMB.ink) {
  const t = lod === LOD.COARSE ? 0.9 : 1;
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w, t);
  ctx.fillRect(x, y + h - t, w, t);
  ctx.fillRect(x, y, t, h);
  ctx.fillRect(x + w - t, y, t, h);
}

// The bevel every solid block in the game carries: light along the top and
// left, dark along the bottom and right, inside the outline.
function bevel(ctx, x, y, w, h, lit, dark, d = 2) {
  ctx.fillStyle = lit;
  ctx.fillRect(x + 1, y + 1, w - 2, d);
  ctx.fillRect(x + 1, y + 1, d, h - 2);
  ctx.fillStyle = dark;
  ctx.fillRect(x + 1, y + h - 1 - d, w - 2, d);
  ctx.fillRect(x + w - 1 - d, y + 1, d, h - 2);
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

// The overworld ground block. Its whole character is that it is IDENTICAL
// everywhere — no jitter, no lit top edge only on the surface row. A hundred
// of them in a row making one unbroken orange grid is the look; a hundred
// subtly different ones is a hillside, which is what this used to be.
//
// The speckle is the block's signature and is fixed, not hashed: the same four
// dark pits and two light chips in the same places on every tile.
const PITS = [[3.5, 4.5], [9.5, 3.5], [5.5, 10], [11, 9]];
const CHIPS = [[7.5, 6], [3.5, 12]];

function ground(ctx, x, y, lod, pal = THEME.overworld) {
  ctx.fillStyle = pal.body;
  ctx.fillRect(x, y, TILE, TILE);
  bevel(ctx, x, y, TILE, TILE, pal.lit, pal.dark, lod === LOD.COARSE ? 2.5 : 2);
  if (lod === LOD.FULL) {
    ctx.fillStyle = pal.dark;
    for (const [px, py] of PITS) ctx.fillRect(x + px, y + py, 2, 2);
    ctx.fillStyle = pal.lit;
    for (const [px, py] of CHIPS) ctx.fillRect(x + px, y + py, 2, 2);
  }
  outline(ctx, x, y, TILE, TILE, lod);
}

// ---------------------------------------------------------------------------
// Brick
// ---------------------------------------------------------------------------

// Four courses of masonry with the vertical joints staggered — the courses
// alternate between a joint down the middle and joints at the two edges, which
// is what makes a wall of them interlock instead of gridding.
function brick(ctx, x, y, lod, pal = THEME.overworld) {
  const { body, lit, mortar } = pal;
  ctx.fillStyle = body;
  ctx.fillRect(x, y, TILE, TILE);
  if (lod !== LOD.COARSE) {
    ctx.fillStyle = mortar;
    for (let i = 1; i < 4; i++) ctx.fillRect(x, y + i * 4 - 0.5, TILE, 1);
    // Odd courses joint in the middle; even courses joint at the edges, where
    // the neighbouring tile supplies the other half.
    ctx.fillRect(x + TILE / 2 - 0.5, y, 1, 4);
    ctx.fillRect(x + TILE / 2 - 0.5, y + 8, 1, 4);
    ctx.fillRect(x, y + 4, 1, 4);
    ctx.fillRect(x, y + 12, 1, 4);
    // A lit top to each course. Small, but it is the difference between
    // masonry and a striped rectangle.
    ctx.fillStyle = lit;
    for (let i = 0; i < 4; i++) ctx.fillRect(x + 1, y + i * 4 + 0.5, TILE - 2, 1);
  } else {
    ctx.fillStyle = lit;
    ctx.fillRect(x + 1, y + 1, TILE - 2, 1.5);
  }
  outline(ctx, x, y, TILE, TILE, lod);
}

// ---------------------------------------------------------------------------
// Question block
// ---------------------------------------------------------------------------

// The glyph, built as a stroked path rather than text: a canvas font would
// render differently on every machine, and a screenshot at tick N has to be
// the same picture everywhere.
function questionGlyph(ctx, cx, cy, s, colour) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2.4 * s;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy - 2.1 * s, 2.5 * s, Math.PI * 0.98, Math.PI * 0.28, false);
  ctx.lineTo(cx + 0.2 * s, cy + 1.6 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + 0.2 * s, cy + 4.4 * s, 1.25 * s, 0, TAU);
  ctx.fillStyle = colour;
  ctx.fill();
}

function question(ctx, x, y, lod, tick) {
  // The original animates the block through three brightnesses. Driven off the
  // simulation tick, so a screenshot at tick N is reproducible.
  const phase = Math.floor(tick / 8) % 4;
  const bright = phase === 1 || phase === 3;
  ctx.fillStyle = bright ? SMB.goldLit : SMB.gold;
  ctx.fillRect(x, y, TILE, TILE);
  bevel(ctx, x, y, TILE, TILE, bright ? SMB.white : SMB.goldLit, SMB.goldDark, 2);
  if (lod === LOD.FULL) {
    // Rivets: four small light squares just inside the corners.
    ctx.fillStyle = SMB.goldLit;
    for (const [px, py] of [[2.5, 2.5], [11, 2.5], [2.5, 11], [11, 11]]) {
      ctx.fillRect(x + px, y + py, 2.5, 2.5);
    }
    ctx.fillStyle = SMB.ink;
    for (const [px, py] of [[3, 3], [11.5, 3], [3, 11.5], [11.5, 11.5]]) {
      ctx.fillRect(x + px, y + py, 1.5, 1.5);
    }
  }
  if (lod === LOD.COARSE) {
    // At five pixels a drawn question mark is a smudge. A single dark bar in
    // the middle of a gold square keeps the block reading as marked rather
    // than blank, which is the whole of what survives.
    ctx.fillStyle = SMB.orangeDark;
    ctx.fillRect(x + 6, y + 4, 4, 8);
  } else {
    questionGlyph(ctx, x + TILE / 2, y + TILE / 2, 1, SMB.orangeDark);
  }
  outline(ctx, x, y, TILE, TILE, lod);
}

// A question block that has been hit: same block, no face.
function used(ctx, x, y, lod, pal = THEME.overworld) {
  ctx.fillStyle = pal.dark;
  ctx.fillRect(x, y, TILE, TILE);
  bevel(ctx, x, y, TILE, TILE, pal.body, pal.mortar, 2);
  outline(ctx, x, y, TILE, TILE, lod);
}

// The plain solid block — staircases, the platforms above pits, the blocks the
// original uses where a brick would be breakable. A smooth bevel and nothing
// else, which is exactly how it differs from the ground block beside it.
function solid(ctx, x, y, lod, pal = THEME.overworld) {
  ctx.fillStyle = pal.body;
  ctx.fillRect(x, y, TILE, TILE);
  bevel(ctx, x, y, TILE, TILE, pal.lit, pal.dark, 3);
  if (lod === LOD.FULL) {
    ctx.fillStyle = pal.lit;
    ctx.fillRect(x + 4, y + 4, TILE - 8, 1);
    ctx.fillStyle = pal.dark;
    ctx.fillRect(x + 4, y + TILE - 5, TILE - 8, 1);
  }
  outline(ctx, x, y, TILE, TILE, lod);
}

// Castle masonry: the same course pattern as a brick in a cold grey.
function castle(ctx, x, y, lod) {
  brick(ctx, x, y, lod, THEME.castle);
}

// The cloud-block floor of coin heaven. In the original this is its own
// metatile rather than a recoloured brick, and it reads as a slab of cloud:
// white, with the scallop showing along its top and bottom edges.
function cloudBlock(ctx, x, y, lod) {
  ctx.fillStyle = SMB.white;
  ctx.fillRect(x, y + 3, TILE, TILE - 6);
  ctx.beginPath();
  for (let i = 0; i < 2; i++) {
    disc(ctx, x + 4 + i * 8, y + 4, 4);
    disc(ctx, x + 4 + i * 8, y + TILE - 4, 4);
  }
  ctx.fill();
  if (lod !== LOD.COARSE) {
    ctx.fillStyle = SMB.cloudShade;
    ctx.beginPath();
    for (let i = 0; i < 2; i++) disc(ctx, x + 4 + i * 8, y + TILE - 3.5, 3, 0, Math.PI);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Pipe
// ---------------------------------------------------------------------------

// The pipe is four characters — two for the rim, two for the barrel — and the
// thing that makes it a pipe is that the rim is WIDER than the barrel and has
// a lip along its underside. Each half is drawn knowing which side it is, so
// the highlight runs unbroken down the whole left flank and the two halves
// meet with no seam.
//
// `half`: -1 left, +1 right. `head`: the rim rather than the barrel.
function pipe(ctx, x, y, half, head, lod) {
  const inset = head ? 0 : 2;
  const left = half < 0 ? x + inset : x;
  const w = TILE - inset;
  ctx.fillStyle = SMB.green;
  ctx.fillRect(left, y, w, TILE);

  // The barrel's shading, in bands: a bright highlight a third of the way in
  // from the left, mid green across the middle, dark down the right flank.
  if (half < 0) {
    ctx.fillStyle = SMB.greenLit;
    ctx.fillRect(left + 2, y, 3, TILE);
    ctx.fillStyle = SMB.white;
    if (lod !== LOD.COARSE) ctx.fillRect(left + 2.5, y, 1, TILE);
  } else {
    ctx.fillStyle = SMB.greenDark;
    ctx.fillRect(x + w - 5, y, 4, TILE);
  }

  if (head) {
    // The lip: a dark line under the rim, and a lit line along its top.
    ctx.fillStyle = SMB.greenDark;
    ctx.fillRect(left, y + TILE - 3, w, 2);
    if (lod !== LOD.COARSE) {
      ctx.fillStyle = SMB.greenLit;
      ctx.fillRect(left + 1, y + 1.5, w - 2, 1);
    }
  }
  // Outline down the outer flank and along the top or bottom as appropriate.
  ctx.fillStyle = SMB.ink;
  if (half < 0) ctx.fillRect(left, y, 1, TILE);
  else ctx.fillRect(x + w - 1, y, 1, TILE);
  if (head) {
    ctx.fillRect(left, y, w, 1);
    ctx.fillRect(left, y + TILE - 1, w, 1);
  }
  // Where the barrel is narrower than the rim, the ground shows through beside
  // it — nothing to draw, the inset already left it empty.
}

// A pipe lying on its side: the same construction rotated, used for the warp
// pipes the player enters from the left or right.
function pipeH(ctx, x, y, part, lod) {
  // part: 'mouth-left' | 'mouth-right' | 'body'
  const mouth = part !== 'body';
  const facing = part === 'mouth-left' ? -1 : 1;
  const top = mouth ? y : y + 2;
  const h = mouth ? TILE : TILE - 2;
  ctx.fillStyle = SMB.green;
  ctx.fillRect(x, top, TILE, h);
  ctx.fillStyle = SMB.greenLit;
  ctx.fillRect(x, top + 2, TILE, 3);
  if (lod !== LOD.COARSE) {
    ctx.fillStyle = SMB.white;
    ctx.fillRect(x, top + 2.5, TILE, 1);
  }
  ctx.fillStyle = SMB.greenDark;
  ctx.fillRect(x, top + h - 5, TILE, 4);
  ctx.fillStyle = SMB.ink;
  ctx.fillRect(x, top, TILE, 1);
  ctx.fillRect(x, top + h - 1, TILE, 1);
  if (mouth) {
    const ex = facing < 0 ? x : x + TILE - 1;
    ctx.fillRect(ex, top, 1, h);
    ctx.fillStyle = SMB.greenDark;
    ctx.fillRect(facing < 0 ? x + 1 : x + TILE - 4, top + 1, 3, h - 2);
  }
}

// ---------------------------------------------------------------------------
// Cannon
// ---------------------------------------------------------------------------

function cannon(ctx, x, y, barrel, lod) {
  ctx.fillStyle = SMB.iron;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = SMB.ironLit;
  if (barrel) {
    // The muzzle: a lighter square set into the left of the block, which is
    // the direction a bullet leaves it.
    ctx.fillRect(x + 1, y + 3, TILE - 2, 2);
    ctx.fillStyle = '#101018';
    ctx.fillRect(x + 1, y + 6, 8, 5);
  } else {
    ctx.fillRect(x + 2, y + 2, TILE - 4, 1.5);
    if (lod !== LOD.COARSE) {
      ctx.fillStyle = '#101018';
      ctx.fillRect(x + 5, y + 6, 6, 6);
    }
  }
  outline(ctx, x, y, TILE, TILE, lod);
}

// ---------------------------------------------------------------------------
// Scenery: bush, hill, cloud — the scalloped family
// ---------------------------------------------------------------------------

// The silhouette the whole overworld is built out of. A row of overlapping
// lobes on a flat base; the cloud is the same shape with lobes underneath as
// well, and the bush is the same shape in green. Filled as one path so the
// lobes union together with no seams.
//
// x,y,w,h are the shape's box in world pixels; `lobes` is how many humps to
// put across the top, taken from the run's width in tiles.
function scallop(ctx, x, y, w, h, lobes, opts = {}) {
  const lw = w / lobes;
  // Lobes barely wider than the tile they sit on, so the valleys between them
  // stay open. Overlapping them more turns a bush into a caterpillar, which is
  // what the first pass at this looked like.
  const r = lw * (opts.r || 0.55);
  const crownRow = y + h * (opts.crown || 0.6);
  ctx.beginPath();
  for (let i = 0; i < lobes; i++) {
    // The middle of the run stands proudest, which is what stops a long bush
    // from reading as a row of identical beads.
    const centre = (lobes - 1) / 2;
    const lift = lobes > 1 ? (1 - Math.abs(i - centre) / (centre + 1.1)) * r * 0.5 : r * 0.25;
    const cy = Math.max(y + r * 0.7, crownRow - lift);
    disc(ctx, x + (i + 0.5) * lw, cy, r);
  }
  if (opts.under) {
    // A cloud bulges downward too, in the same lobes.
    for (let i = 0; i < lobes; i++) {
      const rr = r * 0.92;
      const cy = y + h - rr * 0.72;
      disc(ctx, x + (i + 0.5) * lw, cy, rr);
    }
  }
  ctx.moveTo(x, crownRow);
  ctx.rect(x, crownRow, w, h - (crownRow - y));
  ctx.fill();
}

function bush(ctx, x, y, w, h, lod) {
  const lobes = Math.max(1, Math.round(w / TILE));
  ctx.fillStyle = SMB.green;
  scallop(ctx, x, y, w, h, lobes, { r: 0.55, crown: 0.62 });
  if (lod !== LOD.COARSE) {
    // The original shades the foot of the bush rather than outlining it — one
    // flat darker green where it meets the ground, no highlight anywhere. A
    // bush is a silhouette, and adding specular dots to it (the first attempt)
    // makes it read as fruit.
    ctx.fillStyle = SMB.greenDark;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x, y + h - 3, w, 3);
    ctx.globalAlpha = 1;
  }
}

// The cloud: the bush's silhouette, in white, with a second row of lobes
// underneath. Two rows rather than one because a cloud in the original is two
// tiles tall and almost all lobe — a single row of humps on a slab is a
// battlement, which is exactly what it looked like at altitude before this.
function cloud(ctx, x, y, w, h, lod) {
  const lobes = Math.max(1, Math.round(w / TILE));
  ctx.fillStyle = SMB.white;
  scallop(ctx, x, y, w, h, lobes, { r: 0.62, crown: 0.44, under: true });
  if (lod !== LOD.COARSE) {
    // Shade the underside so the cloud has a lit top rather than reading as a
    // white hole in the sky. The original does the same with one flat blue.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 4, y + h * 0.66, w + 8, h);
    ctx.clip();
    ctx.fillStyle = SMB.cloudShade;
    scallop(ctx, x, y, w, h, lobes, { r: 0.62, crown: 0.44, under: true });
    ctx.restore();
  }
}

// The overworld hill: a dome with 45-degree flanks, a rounded crown, a small
// tuft standing out at each foot, and the dark spots on its face. The spots
// are what stop it reading as a green triangle, and they are the reason the
// hill is recognisable at all from a distance.
function hill(ctx, x, y, w, h, lod) {
  ctx.fillStyle = SMB.green;
  // The flanks run at roughly 45 degrees, as the original's stepped tiles do,
  // and the crown is rounded over about a tile and a half rather than coming
  // to a point. A point makes a fir tree; the shallow crown is what makes it a
  // hill.
  const crown = Math.min(w * 0.22, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x + w * 0.5 - crown, y + crown * 0.9);
  ctx.quadraticCurveTo(x + w * 0.5, y - h * 0.02, x + w * 0.5 + crown, y + crown * 0.9);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
  // The two round feet the original gives every hill, standing proud of the
  // flanks at the base. Small, and the fastest way to tell a Mario hill from a
  // generic green triangle.
  const foot = Math.max(3, Math.min(w * 0.11, h * 0.28));
  ctx.beginPath();
  disc(ctx, x + foot, y + h - foot, foot);
  disc(ctx, x + w - foot, y + h - foot, foot);
  ctx.rect(x, y + h - foot, w, foot);
  ctx.fill();
  if (lod === LOD.COARSE) return;
  // The dark marks on its face. In the original they sit in a rough smile
  // under the crown, which is why a Mario hill reads as friendly rather than
  // as terrain.
  ctx.fillStyle = SMB.greenDark;
  const s = Math.max(1.4, w * 0.045);
  ctx.beginPath();
  disc(ctx, x + w * 0.42, y + h * 0.56, s);
  disc(ctx, x + w * 0.58, y + h * 0.56, s);
  ctx.fill();
  ctx.beginPath();
  disc(ctx, x + w * 0.28, y + h * 0.84, s * 0.8);
  disc(ctx, x + w * 0.5, y + h * 0.86, s * 0.8);
  disc(ctx, x + w * 0.72, y + h * 0.84, s * 0.8);
  ctx.fill();
}

// The overworld tree: the bush's canopy on a trunk.
function tree(ctx, x, y, w, h, lod) {
  const trunkW = Math.max(3, w * 0.16);
  ctx.fillStyle = '#7a4a12';
  ctx.fillRect(x + w / 2 - trunkW / 2, y + h * 0.45, trunkW, h * 0.55);
  bush(ctx, x, y, w, h * 0.62, lod);
}

// ---------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------

// The end-of-level castle. It is not a tile — it is metadata on the level, so
// nothing that walks the tile map could ever have drawn it, and every island
// used to end in a bare cliff falling into the sea. It is also the single most
// recognisable object in the game after the pipe, and from the air it is what
// tells the pilot WHICH END of the island he is over.
//
// Five tiles wide, planted on the ground, with a keep on top: crenellated
// parapet, arched door, two windows. `h` is the full height — the original
// ships a short one and a tall one, and the tall one is the same drawing with
// a longer body.
export function castleKeep(ctx, x, y, w, h, lod, pal = THEME.overworld) {
  const tower = w * 0.4;
  const towerX = x + (w - tower) / 2;
  const towerH = Math.min(h * 0.4, w * 0.4);
  const bodyY = y + towerH;
  const merlon = w / 9;

  const wall = (bx, by, bw, bh) => {
    ctx.fillStyle = pal.body;
    ctx.fillRect(bx, by, bw, bh);
    if (lod !== LOD.COARSE) {
      // Coursed masonry at the castle's own scale — horizontal courses with
      // the vertical joints staggered course by course. Horizontal lines on
      // their own read as clapboard, which is what the first pass looked like.
      ctx.fillStyle = pal.mortar;
      let course = 0;
      for (let ly = by + 8; ly < by + bh - 1; ly += 8) {
        ctx.fillRect(bx, ly, bw, 1);
        course++;
        const off = course % 2 ? 0 : 8;
        for (let lx = bx + off + 8; lx < bx + bw - 1; lx += 16) {
          ctx.fillRect(lx, ly, 1, Math.min(8, by + bh - 1 - ly));
        }
      }
      ctx.fillStyle = pal.dark;
      ctx.fillRect(bx + bw - 2, by, 2, bh);
      ctx.fillStyle = pal.lit;
      ctx.fillRect(bx, by, 2, bh);
    }
    ctx.fillStyle = SMB.ink;
    ctx.fillRect(bx, by, bw, 1);
    ctx.fillRect(bx, by + bh - 1, bw, 1);
    ctx.fillRect(bx, by, 1, bh);
    ctx.fillRect(bx + bw - 1, by, 1, bh);
  };

  // Crenellations: teeth standing on a wall's top edge, drawn as short walls.
  const teeth = (bx, by, bw, n) => {
    const t = bw / (n * 2 - 1);
    for (let i = 0; i < n; i++) wall(bx + i * t * 2, by - merlon, t, merlon + 1);
  };

  wall(x, bodyY, w, y + h - bodyY);
  teeth(x, bodyY, w, 5);
  wall(towerX, y + merlon, tower, towerH - merlon);
  teeth(towerX, y + merlon, tower, 3);

  // The arch and the windows, in the black the original uses for both.
  ctx.fillStyle = '#101010';
  const doorW = w * 0.2;
  const doorH = Math.min(w * 0.28, (y + h - bodyY) * 0.7);
  const doorX = x + (w - doorW) / 2;
  const doorY = y + h - doorH;
  ctx.beginPath();
  ctx.moveTo(doorX, y + h);
  ctx.lineTo(doorX, doorY + doorW / 2);
  ctx.quadraticCurveTo(doorX + doorW / 2, doorY - doorW * 0.15, doorX + doorW, doorY + doorW / 2);
  ctx.lineTo(doorX + doorW, y + h);
  ctx.closePath();
  ctx.fill();
  if (lod === LOD.COARSE) return;
  const win = w * 0.1;
  ctx.fillRect(x + w * 0.16, bodyY + win * 0.8, win, win);
  ctx.fillRect(x + w * 0.74, bodyY + win * 0.8, win, win);
  ctx.fillRect(towerX + tower / 2 - win / 2, y + merlon + win * 0.9, win, win);
}

// The flag on the pole. Drawn from the ball down the left flank, which is
// where the original hangs it before the player pulls it down.
export function flag(ctx, x, y, lod) {
  const px = x + TILE / 2 - 1.5;
  ctx.fillStyle = SMB.white;
  ctx.beginPath();
  ctx.moveTo(px, y + 2);
  ctx.lineTo(px - TILE * 0.72, y + 6.5);
  ctx.lineTo(px, y + 11);
  ctx.closePath();
  ctx.fill();
  if (lod === LOD.COARSE) return;
  // The emblem: one dark mark, which is all that is legible of it at any
  // altitude the pilot flies at.
  ctx.fillStyle = SMB.ink;
  ctx.fillRect(px - TILE * 0.34, y + 5.5, 2.5, 2.5);
}

// ---------------------------------------------------------------------------
// Loose marks
// ---------------------------------------------------------------------------

function coin(ctx, x, y, lod, tick) {
  const cx = x + TILE / 2;
  const cy = y + TILE / 2;
  // The coin's spin, on the simulation tick: four phases, the narrowest of
  // which is a bar rather than a disc.
  const phase = Math.floor(tick / 6) % 4;
  const wobble = [1, 0.62, 0.24, 0.62][phase];
  const rx = 4.2 * wobble;
  ctx.fillStyle = SMB.gold;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(1, rx), 5.6, 0, 0, TAU);
  ctx.fill();
  if (lod === LOD.COARSE) return;
  ctx.fillStyle = SMB.goldDark;
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.6, rx * 0.45), 3.2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = SMB.goldLit;
  ctx.fillRect(cx - Math.max(0.5, rx * 0.2), cy - 2.6, Math.max(1, rx * 0.4), 5.2);
}

// The flagpole: a pale shaft with a green ball on it, and the flag itself.
function poleShaft(ctx, x, y) {
  const cx = x + TILE / 2;
  ctx.fillStyle = SMB.greenDark;
  ctx.fillRect(cx - 1.5, y, 3, TILE);
  ctx.fillStyle = SMB.greenLit;
  ctx.fillRect(cx - 1.5, y, 1, TILE);
}

function poleBall(ctx, x, y, lod) {
  const cx = x + TILE / 2;
  ctx.fillStyle = SMB.green;
  ctx.beginPath();
  ctx.arc(cx, y + TILE - 4, 4.2, 0, TAU);
  ctx.fill();
  if (lod === LOD.COARSE) return;
  ctx.fillStyle = SMB.greenLit;
  ctx.beginPath();
  ctx.arc(cx - 1.2, y + TILE - 5.2, 1.6, 0, TAU);
  ctx.fill();
}

// The axe at the end of a castle level.
function axe(ctx, x, y, lod) {
  ctx.fillStyle = '#7a4a12';
  ctx.fillRect(x + 7, y + 6, 2, 8);
  ctx.fillStyle = SMB.stoneLit;
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 4);
  ctx.quadraticCurveTo(x + 12, y + 2, x + 12, y + 8);
  ctx.quadraticCurveTo(x + 8, y + 7, x + 4, y + 8);
  ctx.closePath();
  ctx.fill();
  if (lod !== LOD.COARSE) {
    ctx.fillStyle = SMB.stoneDark;
    ctx.fillRect(x + 4, y + 7, 8, 1);
  }
}

// A one-way platform: the original's mushroom-top and the moving lifts are all
// drawn as a slab with a lit top and a dark lip.
function platform(ctx, x, y, lod) {
  ctx.fillStyle = '#c86818';
  ctx.fillRect(x, y + 4, TILE, 7);
  ctx.fillStyle = '#f0a848';
  ctx.fillRect(x, y + 4, TILE, 2);
  ctx.fillStyle = SMB.ink;
  ctx.fillRect(x, y + 3, TILE, 1);
  ctx.fillRect(x, y + 11, TILE, 1);
  if (lod === LOD.FULL) {
    ctx.fillStyle = '#8b3a0e';
    for (let i = 0; i < 2; i++) ctx.fillRect(x + 3 + i * 8, y + 7, 3, 3);
  }
}

// Lava, and the row of half-discs the original draws along its surface.
function lava(ctx, x, y, surface, lod) {
  ctx.fillStyle = SMB.lava;
  ctx.fillRect(x, y, TILE, TILE);
  if (!surface) return;
  ctx.fillStyle = SMB.lavaLit;
  ctx.beginPath();
  for (let i = 0; i < 2; i++) disc(ctx, x + 4 + i * 8, y + 3, 4);
  ctx.fill();
  if (lod !== LOD.COARSE) {
    ctx.fillStyle = SMB.lavaDark;
    ctx.fillRect(x, y + 7, TILE, 1);
  }
}

function water(ctx, x, y, surface, tick) {
  ctx.fillStyle = surface ? SEA.surface : SEA.shallow;
  ctx.fillRect(x, y, TILE, TILE);
  if (!surface) return;
  ctx.fillStyle = SEA.crest;
  const s = Math.sin((x * 0.4 + tick * 0.08)) * 1.2;
  ctx.fillRect(x, y + 1 + s, TILE, 2);
}

function coral(ctx, x, y, lod) {
  ctx.fillStyle = SMB.greenDark;
  ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 2);
  if (lod === LOD.COARSE) return;
  ctx.fillStyle = SMB.green;
  ctx.fillRect(x + 4, y + 4, 3, TILE - 6);
  ctx.fillRect(x + 9, y + 6, 3, TILE - 8);
}

// ---------------------------------------------------------------------------
// The character table
// ---------------------------------------------------------------------------

// Characters drawn as one shape spanning a whole connected run of them —
// scenery, which in the original is authored as multi-tile objects and only
// stored as runs of characters. Drawing these per-tile is what turned a bush
// into a row of identical domes.
export const COMPOSITE = {
  b: bush,
  h: hill,
  c: cloud,
  t: tree,
};

// Everything else: one painter per tile. Anything not here is drawn as a plain
// solid block, which is the safest thing to be wrong about — it is what an
// unrecognised SOLID looks like, and the pilot can bomb it either way.
// The painters, keyed by level character. Each takes the same argument bag:
// `a.lod` how much ornament it may draw, `a.tick` the simulation tick for
// anything that animates, `a.open` whether the tile above is air, `a.pal` the
// area palette.
const PAINT = {
  '#': (ctx, x, y, a) => ground(ctx, x, y, a.lod, a.pal),
  '=': (ctx, x, y, a) => brick(ctx, x, y, a.lod, a.pal),
  v: (ctx, x, y, a) => brick(ctx, x, y, a.lod, a.pal),
  '?': (ctx, x, y, a) => question(ctx, x, y, a.lod, a.tick),
  M: (ctx, x, y, a) => question(ctx, x, y, a.lod, a.tick),
  U: (ctx, x, y, a) => used(ctx, x, y, a.lod, a.pal),
  B: (ctx, x, y, a) => solid(ctx, x, y, a.lod, a.pal),
  S: (ctx, x, y, a) => solid(ctx, x, y, a.lod, a.pal),
  T: (ctx, x, y, a) => solid(ctx, x, y, a.lod, a.pal),
  O: (ctx, x, y, a) => cloudBlock(ctx, x, y, a.lod),
  X: (ctx, x, y, a) => castle(ctx, x, y, a.lod),
  K: (ctx, x, y, a) => cannon(ctx, x, y, true, a.lod),
  k: (ctx, x, y, a) => cannon(ctx, x, y, false, a.lod),
  '[': (ctx, x, y, a) => pipe(ctx, x, y, -1, true, a.lod),
  ']': (ctx, x, y, a) => pipe(ctx, x, y, 1, true, a.lod),
  '{': (ctx, x, y, a) => pipe(ctx, x, y, -1, false, a.lod),
  '}': (ctx, x, y, a) => pipe(ctx, x, y, 1, false, a.lod),
  '<': (ctx, x, y, a) => pipeH(ctx, x, y, 'mouth-left', a.lod),
  '>': (ctx, x, y, a) => pipeH(ctx, x, y, 'mouth-right', a.lod),
  '-': (ctx, x, y, a) => pipeH(ctx, x, y, 'body', a.lod),
  L: (ctx, x, y, a) => lava(ctx, x, y, a.open, a.lod),
  l: (ctx, x, y, a) => lava(ctx, x, y, a.open, a.lod),
  '~': (ctx, x, y, a) => water(ctx, x, y, true, a.tick),
  _: (ctx, x, y, a) => water(ctx, x, y, false, a.tick),
  g: (ctx, x, y, a) => coral(ctx, x, y, a.lod),
  o: (ctx, x, y, a) => coin(ctx, x, y, a.lod, a.tick),
  '|': (ctx, x, y) => poleShaft(ctx, x, y),
  '^': (ctx, x, y, a) => poleBall(ctx, x, y, a.lod),
  a: (ctx, x, y, a) => axe(ctx, x, y, a.lod),
  P: (ctx, x, y, a) => platform(ctx, x, y, a.lod),
  '@': (ctx, x, y, a) => platform(ctx, x, y, a.lod),
  F: (ctx, x, y, a) => platform(ctx, x, y, a.lod),
  V: (ctx, x, y, a) => platform(ctx, x, y, a.lod),
  Y: (ctx, x, y, a) => platform(ctx, x, y, a.lod),
  W: (ctx, x, y, a) => platform(ctx, x, y, a.lod),
};

// The blocks the original never shows. Drawing a hidden 1-up block as a gold
// question block would be a lie the Mario player can see through, and the
// pilot loses nothing: they are not solid, and a bomb still takes them out.
const INVISIBLE = new Set(['1', 'C']);

export function isInvisible(ch) {
  return INVISIBLE.has(ch);
}

// Draw one tile character at world pixel (x, y).
export function drawTileChar(ctx, x, y, ch, a) {
  if (INVISIBLE.has(ch)) return;
  const fn = PAINT[ch];
  if (fn) fn(ctx, x, y, a);
  else solid(ctx, x, y, a.lod, a.pal);
}

export { ground, brick, question, solid, pipe, bush, hill, cloud, PAINT };
export default drawTileChar;
