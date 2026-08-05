import { TILE } from '../../core/constants.js';
import { MARIO, SEA } from './palette.js';

// The Super Mario Bros. tile set, redrawn as vector art for the pilot's view.
//
// WHY THIS FILE EXISTS. The pilot used to draw every level character as a flat
// coloured rectangle with a lit top edge — good landscape, wrong game. Its
// vocabulary was earth, grass, scrub and sand; Mario's is BLOCKS. That one
// mismatch is why nothing but the layout survived a side-by-side with the same
// level drawn by our own Mario renderer, and everything in this file follows
// from changing what the renderer thinks it is drawing.
//
// FOUR RULES THIS FILE IS BUILT AROUND.
//
//   1. EVERY SOLID CELL IS AN OUTLINED BLOCK. SMB's world is discrete objects
//      with a near-black line round each one; ours was continuous terrain. The
//      outline is the cheapest mark in the budget and the one that carries the
//      furthest — see the note on legibility at the bottom of this comment.
//
//   2. THE MATERIALS ARE THE MARIO SIDE'S MATERIALS. Every ramp comes from
//      `MARIO` in palette.js, which is copied slot for slot out of
//      `src/data/tiles.js` and `src/data/scenery.js`. Ground is EARTH's brown,
//      brick is BRICK's hot orange, the staircase is QUARRY's sandstone, the
//      castle wall is ASHLAR's cold blue — the same paint the player standing
//      on those tiles is looking at. Nothing here invents a colour.
//
//   3. SILHOUETTE AND STRUCTURE, NOT PIXELS. The pilot renders through a
//      supersampled vector pipeline with no sprite sheet, so there is nothing
//      to be gained by snapping to an 8x8 NES grid and something to be lost:
//      curves come out as curves. Original artwork throughout — the homage is
//      in proportion and palette relationship, no asset is copied.
//
//   4. LEGIBILITY IS PART OF FIDELITY AT THIS ALTITUDE. The zoom runs from
//      1.15 down to 0.32, which puts a tile between 18 and 5 screen pixels. A
//      question block's rivets are four correct pixels at 18 and four grains
//      of noise at 5. Every painter takes a level of detail and drops ornament
//      as the world shrinks, in a fixed order: ornament, then pattern, then
//      everything but the block's colour, its outline and its one identifying
//      mark.
//
// Nothing here reads a clock. The two animations take the simulation tick.

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

export const THEMES = ['overworld', 'underground', 'castle', 'water', 'athletic'];

export function themeFor(name) {
  return THEMES.includes(name) ? name : 'overworld';
}

// A material's ramp in a given area: [outline, shadow, body, lit, bright].
function mat(material, theme) {
  return material[theme] || material.overworld;
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
// Shared primitives
// ---------------------------------------------------------------------------

// The hard dark line around every block in the game. Drawn as four strips
// rather than a stroke so it never straddles the tile edge and never doubles
// up where two blocks meet.
//
// It is kept at EVERY level of detail, including the smallest. At the zoom
// floor a world pixel is a third of a device pixel, so this does not survive
// as a line — it survives as a darkening along every block edge, which is what
// keeps a wall of blocks from fusing into one slab of colour. Dropping it to
// save fill rate at altitude was tried and is visibly worse.
function outline(ctx, x, y, w, h, r) {
  ctx.fillStyle = r[0];
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
}

// The bevel every solid block in the game carries: light along the top and
// left, shadow along the bottom and right, inside the outline.
function bevel(ctx, x, y, w, h, r, d = 2) {
  ctx.fillStyle = r[3];
  ctx.fillRect(x + 1, y + 1, w - 2, d);
  ctx.fillRect(x + 1, y + 1, d, h - 2);
  ctx.fillStyle = r[1];
  ctx.fillRect(x + 1, y + h - 1 - d, w - 2, d);
  ctx.fillRect(x + w - 1 - d, y + 1, d, h - 2);
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

// The floor of every level: two courses of slabs on a mortar grid, running
// bond, with the courses running THROUGH the tile seams rather than stopping
// at them. That last part is the whole character of it — a hundred ground
// tiles in a row are one wall, not a hundred squares, and the joint pattern
// has to be a function of where the tile is in the world for that to hold.
//
// It is also why there is no per-tile jitter and no lit "grass" cap on the
// surface row any more. In the original the ground block buried in the middle
// of the ground is the same block as the one on top; the unbroken repeat is
// the look, and the sunlit cap was drawing a hillside instead.
// Two courses to the tile, one slab wide each, the lower course offset half a
// slab from the upper one. Measured off the Mario side's own ground: the slabs
// there are as wide as a tile and half as tall, and getting this wrong in the
// other direction — four small slabs to a tile — turns the floor into a busy
// texture that goes to mush the moment the pilot climbs.
const SLAB_W = 16;
const COURSE_H = 8;

function ground(ctx, x, y, r, lod, tx) {
  ctx.fillStyle = r[1];
  ctx.fillRect(x, y, TILE, TILE);
  if (lod === LOD.COARSE) {
    // At five pixels the joints are noise. Body colour with the shadow left
    // showing along the bottom edge, so a stack of ground still has a grain.
    ctx.fillStyle = r[2];
    ctx.fillRect(x, y, TILE, TILE - 1);
    ctx.fillStyle = r[0];
    ctx.fillRect(x, y + TILE - 1, TILE, 1);
    return;
  }
  const worldX = tx * TILE;
  for (let course = 0; course < 2; course++) {
    const cy = y + course * COURSE_H;
    const shift = course === 0 ? 0 : SLAB_W / 2;
    let sx = worldX - (((worldX - shift) % SLAB_W) + SLAB_W) % SLAB_W;
    for (; sx < worldX + TILE; sx += SLAB_W) {
      const left = Math.max(sx + 1, worldX);
      const right = Math.min(sx + SLAB_W, worldX + TILE);
      if (right <= left) continue;
      const px = x + (left - worldX);
      const pw = right - left;
      ctx.fillStyle = r[2];
      ctx.fillRect(px, cy, pw, COURSE_H - 1);
      if (lod === LOD.FULL) {
        ctx.fillStyle = r[3];
        ctx.fillRect(px, cy, pw, 1);
        ctx.fillStyle = r[1];
        ctx.fillRect(px, cy + COURSE_H - 2, pw, 1);
      }
    }
    ctx.fillStyle = r[0];
    ctx.fillRect(x, cy + COURSE_H - 1, TILE, 1);
  }
}

// ---------------------------------------------------------------------------
// Brick
// ---------------------------------------------------------------------------

// The one block the player may smash, and the only warm saturated masonry on
// the island. Two courses to the tile with the joints staggered, and — unlike
// the ground — a hard outline round the whole tile, because a brick is an
// object you can break and the ground is a surface you cannot.
function brick(ctx, x, y, r, lod) {
  ctx.fillStyle = r[2];
  ctx.fillRect(x, y, TILE, TILE);
  if (lod !== LOD.COARSE) {
    ctx.fillStyle = r[0];
    ctx.fillRect(x, y + COURSE_H - 1, TILE, 1);
    // Upper course joints at the middle, lower course at the edges, where the
    // neighbouring tile supplies the other half of the joint.
    ctx.fillRect(x + TILE / 2 - 0.5, y, 1, COURSE_H);
    ctx.fillRect(x, y + COURSE_H, 1, COURSE_H);
    ctx.fillStyle = r[3];
    ctx.fillRect(x + 1, y + 1, TILE - 2, 1);
    ctx.fillRect(x + 1, y + COURSE_H, TILE - 2, 1);
  } else {
    // The one mark that survives: a single joint across the middle. Without it
    // a brick at five pixels is a plain square and there is nothing to tell it
    // from the ground underneath.
    ctx.fillStyle = r[0];
    ctx.fillRect(x, y + COURSE_H - 1, TILE, 1);
  }
  outline(ctx, x, y, TILE, TILE, r);
}

// ---------------------------------------------------------------------------
// Question block
// ---------------------------------------------------------------------------

// The glyph, built as a stroked path rather than text: a canvas font would
// render differently on every machine, and a screenshot at tick N has to be
// the same picture everywhere. Drawn in the cream the Mario side uses, over a
// dark shadow — a dark glyph on gold, which is what the first pass did, is
// both wrong and much harder to see from the air.
function questionGlyph(ctx, cx, cy, colour, width) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy - 2.1, 2.5, Math.PI * 0.98, Math.PI * 0.28, false);
  ctx.lineTo(cx + 0.2, cy + 1.6);
  ctx.stroke();
  ctx.beginPath();
  disc(ctx, cx + 0.2, cy + 4.4, 1.25);
  ctx.fillStyle = colour;
  ctx.fill();
}

function question(ctx, x, y, r, lod, tick) {
  const gold = MARIO.GOLD;
  // The original cycles the block's face. Driven off the simulation tick, so
  // a screenshot at tick N is reproducible however many frames were drawn.
  const phase = Math.floor(tick / 8) % 4;
  const lift = phase === 1 || phase === 3 ? 1 : 0;
  ctx.fillStyle = gold[1 + lift];
  ctx.fillRect(x, y, TILE, TILE);
  bevel(ctx, x, y, TILE, TILE, [r[0], gold[0], gold[1 + lift], gold[2 + lift], gold[3]], 2);
  if (lod === LOD.FULL) {
    // Rivets: four dark studs on light seats, just inside the corners.
    ctx.fillStyle = gold[3];
    for (const [px, py] of [[2.5, 2.5], [11, 2.5], [2.5, 11], [11, 11]]) {
      ctx.fillRect(x + px, y + py, 2.5, 2.5);
    }
    ctx.fillStyle = MARIO.GLYPH[0];
    for (const [px, py] of [[3, 3], [11.5, 3], [3, 11.5], [11.5, 11.5]]) {
      ctx.fillRect(x + px, y + py, 1.5, 1.5);
    }
  }
  if (lod === LOD.COARSE) {
    // At five pixels a drawn question mark is a smudge. A cream bar on gold
    // keeps the block reading as marked rather than blank, which is the whole
    // of what survives — and it is still the brightest thing on the island.
    ctx.fillStyle = MARIO.GLYPH[0];
    ctx.fillRect(x + 5.5, y + 3.5, 5, 9);
    ctx.fillStyle = MARIO.GLYPH[1];
    ctx.fillRect(x + 6.5, y + 4.5, 3, 7);
  } else {
    questionGlyph(ctx, x + TILE / 2, y + TILE / 2 + 0.6, MARIO.GLYPH[0], 3.6);
    questionGlyph(ctx, x + TILE / 2, y + TILE / 2, MARIO.GLYPH[1], 2.2);
  }
  outline(ctx, x, y, TILE, TILE, r);
}

// A question block that has been hit: the same block spent, no face. Gold
// dimmed rather than recoloured, so the player can still see what it was.
function used(ctx, x, y, r, lod) {
  const gold = MARIO.GOLD;
  ctx.fillStyle = gold[0];
  ctx.fillRect(x, y, TILE, TILE);
  bevel(ctx, x, y, TILE, TILE, [r[0], r[0], gold[0], gold[1], gold[1]], 2);
  outline(ctx, x, y, TILE, TILE, r);
}

// The plain solid block, and the staircase block. A smooth deep bevel and an
// inner rule and nothing else, which is exactly how it differs from the
// coursed ground beside it.
function solid(ctx, x, y, r, lod) {
  ctx.fillStyle = r[2];
  ctx.fillRect(x, y, TILE, TILE);
  bevel(ctx, x, y, TILE, TILE, r, 3);
  if (lod === LOD.FULL) {
    ctx.fillStyle = r[4];
    ctx.fillRect(x + 4, y + 4, TILE - 8, 1);
    ctx.fillStyle = r[1];
    ctx.fillRect(x + 4, y + TILE - 5, TILE - 8, 1);
  }
  outline(ctx, x, y, TILE, TILE, r);
}

// The cloud-block floor of coin heaven. Its own metatile in the original
// rather than a recoloured brick, and it reads as a slab of cloud: white, with
// the scallop showing along its top and bottom edges.
function cloudBlock(ctx, x, y, r, lod) {
  const c = MARIO.CLOUD;
  ctx.fillStyle = c[4];
  ctx.fillRect(x, y + 3, TILE, TILE - 6);
  ctx.beginPath();
  for (let i = 0; i < 2; i++) {
    disc(ctx, x + 4 + i * 8, y + 4, 4);
    disc(ctx, x + 4 + i * 8, y + TILE - 4, 4);
  }
  ctx.fill();
  if (lod === LOD.COARSE) return;
  ctx.fillStyle = c[2];
  ctx.beginPath();
  for (let i = 0; i < 2; i++) disc(ctx, x + 4 + i * 8, y + TILE - 3.5, 3, 0, Math.PI);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Pipe
// ---------------------------------------------------------------------------

// The pipe is four characters — two for the rim, two for the barrel — and the
// thing that makes it a pipe is that the rim is WIDER than the barrel and has
// a lip along its underside. Each half is drawn knowing which side it is, so
// the specular column runs unbroken down the whole left flank and the two
// halves meet with no seam.
//
// This is the tile that survives the zoom best of anything on the island: at
// the floor the rim's overhang is still a step in the silhouette, and a green
// stub with a wider head is a pipe at any size.
//
// `half`: -1 left, +1 right. `head`: the rim rather than the barrel.
function pipe(ctx, x, y, r, half, head, lod, rows = 1) {
  const inset = head ? 0 : 2;
  const left = half < 0 ? x + inset : x;
  const w = TILE - inset;
  const TILE_H = TILE * rows;
  ctx.fillStyle = r[2];
  ctx.fillRect(left, y, w, TILE_H);

  // A cylinder lit from the upper left: specular just inside the outline, lit
  // tone beside it, body across the middle, shadow down the right flank.
  if (half < 0) {
    ctx.fillStyle = r[3];
    ctx.fillRect(left + 1, y, 4, TILE_H);
    if (lod !== LOD.COARSE) {
      ctx.fillStyle = r[4];
      ctx.fillRect(left + 2, y, 1.5, TILE_H);
    }
  } else {
    ctx.fillStyle = r[1];
    ctx.fillRect(x + w - 5, y, 4, TILE_H);
  }

  if (head) {
    // The lip: a shadow line under the rim, and a lit line along its top.
    ctx.fillStyle = r[1];
    ctx.fillRect(left, y + TILE - 3, w, 2);
    if (lod !== LOD.COARSE) {
      ctx.fillStyle = r[3];
      ctx.fillRect(left + 1, y + 1.5, w - 2, 1);
    }
  }
  ctx.fillStyle = r[0];
  if (half < 0) ctx.fillRect(left, y, 1, TILE_H);
  else ctx.fillRect(x + w - 1, y, 1, TILE_H);
  if (head) {
    ctx.fillRect(left, y, w, 1);
    ctx.fillRect(left, y + TILE - 1, w, 1);
  }
}

// A pipe lying on its side: the same cylinder rotated, for the warp pipes the
// player enters from the left or the right.
function pipeH(ctx, x, y, r, part, lod) {
  const mouth = part !== 'body';
  const facing = part === 'mouth-left' ? -1 : 1;
  const top = mouth ? y : y + 2;
  const h = mouth ? TILE : TILE - 2;
  ctx.fillStyle = r[2];
  ctx.fillRect(x, top, TILE, h);
  ctx.fillStyle = r[3];
  ctx.fillRect(x, top + 1, TILE, 4);
  if (lod !== LOD.COARSE) {
    ctx.fillStyle = r[4];
    ctx.fillRect(x, top + 2, TILE, 1.5);
  }
  ctx.fillStyle = r[1];
  ctx.fillRect(x, top + h - 5, TILE, 4);
  ctx.fillStyle = r[0];
  ctx.fillRect(x, top, TILE, 1);
  ctx.fillRect(x, top + h - 1, TILE, 1);
  if (mouth) {
    ctx.fillRect(facing < 0 ? x : x + TILE - 1, top, 1, h);
    ctx.fillStyle = r[1];
    ctx.fillRect(facing < 0 ? x + 1 : x + TILE - 4, top + 1, 3, h - 2);
  }
}

// ---------------------------------------------------------------------------
// Cannon
// ---------------------------------------------------------------------------

function cannon(ctx, x, y, barrel, lod) {
  const r = MARIO.IRON;
  ctx.fillStyle = r[2];
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = r[3];
  if (barrel) {
    ctx.fillRect(x + 1, y + 3, TILE - 2, 2);
    ctx.fillStyle = r[0];
    ctx.fillRect(x + 1, y + 6, 8, 5);
  } else {
    ctx.fillRect(x + 2, y + 2, TILE - 4, 1.5);
    if (lod !== LOD.COARSE) {
      ctx.fillStyle = r[0];
      ctx.fillRect(x + 5, y + 6, 6, 6);
    }
  }
  outline(ctx, x, y, TILE, TILE, r);
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
  // stay open. Overlapping them more turns a bush into a caterpillar.
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
    for (let i = 0; i < lobes; i++) {
      const rr = r * 0.92;
      disc(ctx, x + (i + 0.5) * lw, y + h - rr * 0.72, rr);
    }
  }
  ctx.moveTo(x, crownRow);
  ctx.rect(x, crownRow, w, h - (crownRow - y));
  ctx.fill();
}

function bush(ctx, x, y, w, h, lod) {
  const g = MARIO.GREEN;
  const lobes = Math.max(1, Math.round(w / TILE));
  // The outline first, as a slightly larger copy of the same silhouette. A
  // scallop only reads as a scallop if it is bounded — against a bright sky an
  // unbounded green blob loses its edge entirely at altitude.
  ctx.fillStyle = g[0];
  scallop(ctx, x - 1, y - 1, w + 2, h + 1, lobes, { r: 0.57, crown: 0.6 });
  ctx.fillStyle = g[2];
  scallop(ctx, x, y, w, h, lobes, { r: 0.55, crown: 0.62 });
  if (lod === LOD.COARSE) return;
  // The original shades the foot and lights the crown of each lobe. No
  // specular dots — those read as fruit, which is what the first pass did.
  ctx.fillStyle = g[1];
  ctx.globalAlpha = 0.5;
  ctx.fillRect(x, y + h - 3, w, 3);
  ctx.globalAlpha = 1;
  ctx.fillStyle = g[3];
  const lw = w / lobes;
  for (let i = 0; i < lobes; i++) {
    ctx.beginPath();
    disc(ctx, x + (i + 0.5) * lw - lw * 0.1, y + h * 0.34, lw * 0.26, Math.PI * 1.1, Math.PI * 1.95);
    ctx.fill();
  }
}

// The cloud: the bush's silhouette in the cloud ramp, with a second row of
// lobes underneath. Two rows rather than one because a cloud in the original
// is two tiles tall and almost all lobe — a single row of humps on a slab is a
// battlement, which is exactly what it looked like at altitude before this.
function cloud(ctx, x, y, w, h, lod) {
  const c = MARIO.CLOUD;
  const lobes = Math.max(1, Math.round(w / TILE));
  const shape = { r: 0.62, crown: 0.44, under: true };
  ctx.fillStyle = c[0];
  scallop(ctx, x - 1, y - 1, w + 2, h + 2, lobes, shape);
  ctx.fillStyle = c[4];
  scallop(ctx, x, y, w, h, lobes, shape);
  if (lod === LOD.COARSE) return;
  // Shade the underside so the cloud has a lit top rather than reading as a
  // white hole in the sky. The original does the same with one flat blue.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 4, y + h * 0.66, w + 8, h);
  ctx.clip();
  ctx.fillStyle = c[2];
  scallop(ctx, x, y, w, h, lobes, shape);
  ctx.restore();
}

// The overworld hill: a dome with roughly 45-degree flanks, a rounded crown, a
// small tuft standing proud at each foot, a darker lobe down the right third,
// and the two dark eyes. The shadow lobe and the eyes are what stop it reading
// as a green triangle, and they are how the original's hill is recognisable
// from any distance at all.
function hill(ctx, x, y, w, h, lod) {
  const g = MARIO.GREEN;
  const crown = Math.min(w * 0.22, h * 0.5);
  const foot = Math.max(3, Math.min(w * 0.11, h * 0.28));

  const dome = (ox, oy, ow, oh, of) => {
    ctx.beginPath();
    ctx.moveTo(ox, oy + oh);
    ctx.lineTo(ox + ow * 0.5 - crown, oy + crown * 0.9);
    ctx.quadraticCurveTo(ox + ow * 0.5, oy - oh * 0.02, ox + ow * 0.5 + crown, oy + crown * 0.9);
    ctx.lineTo(ox + ow, oy + oh);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    disc(ctx, ox + of, oy + oh - of, of);
    disc(ctx, ox + ow - of, oy + oh - of, of);
    ctx.rect(ox, oy + oh - of, ow, of);
    ctx.fill();
  };

  ctx.fillStyle = g[0];
  dome(x - 1, y - 1, w + 2, h + 1, foot + 1);
  ctx.fillStyle = g[2];
  dome(x, y, w, h, foot);
  if (lod === LOD.COARSE) return;

  // The shadow lobe: the right third of the dome, in the darker green. Clipped
  // to the dome so it never spills past the silhouette.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x + w * 0.5 - crown, y + crown * 0.9);
  ctx.quadraticCurveTo(x + w * 0.5, y - h * 0.02, x + w * 0.5 + crown, y + crown * 0.9);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = g[1];
  ctx.beginPath();
  ctx.moveTo(x + w * 0.62, y);
  ctx.quadraticCurveTo(x + w * 0.66, y + h * 0.6, x + w * 0.78, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // The eyes.
  ctx.fillStyle = g[0];
  const s = Math.max(1.4, w * 0.045);
  ctx.beginPath();
  disc(ctx, x + w * 0.42, y + h * 0.5, s);
  disc(ctx, x + w * 0.58, y + h * 0.5, s);
  ctx.fill();
}

// The tree-top levels' tree: the bush canopy on a trunk.
function tree(ctx, x, y, w, h, lod) {
  const trunkW = Math.max(3, w * 0.16);
  const b = MARIO.BARK;
  ctx.fillStyle = b[0];
  ctx.fillRect(x + w / 2 - trunkW / 2 - 1, y + h * 0.45, trunkW + 2, h * 0.55);
  ctx.fillStyle = b[2];
  ctx.fillRect(x + w / 2 - trunkW / 2, y + h * 0.45, trunkW, h * 0.55);
  if (lod !== LOD.COARSE) {
    ctx.fillStyle = b[3];
    ctx.fillRect(x + w / 2 - trunkW / 2, y + h * 0.45, 1.5, h * 0.55);
  }
  bush(ctx, x, y, w, h * 0.62, lod);
}

// ---------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------

// The end-of-level castle. It is not a tile — it is metadata on the level, so
// nothing that walks the tile map could ever have drawn it, and every island
// used to end in a bare cliff falling into the sea. It is also the landmark
// that tells the pilot WHICH END of the island he is over.
//
// Five tiles wide, planted on the ground, in the Mario side's own warm castle
// stone rather than the area palette: the keep is the same building in every
// world and the original does not repaint it.
export function castleKeep(ctx, x, y, w, h, lod) {
  const r = MARIO.KEEP;
  const tower = w * 0.4;
  const towerX = x + (w - tower) / 2;
  const towerH = Math.min(h * 0.4, w * 0.4);
  const bodyY = y + towerH;
  const merlon = w / 9;

  const wall = (bx, by, bw, bh) => {
    ctx.fillStyle = r[2];
    ctx.fillRect(bx, by, bw, bh);
    if (lod !== LOD.COARSE) {
      // Coursed masonry at the castle's own scale — horizontal courses with
      // the vertical joints staggered course by course. Horizontal lines on
      // their own read as clapboard.
      ctx.fillStyle = r[1];
      let course = 0;
      for (let ly = by + 8; ly < by + bh - 1; ly += 8) {
        ctx.fillRect(bx, ly, bw, 1);
        course++;
        const off = course % 2 ? 0 : 8;
        for (let lx = bx + off + 8; lx < bx + bw - 1; lx += 16) {
          ctx.fillRect(lx, ly, 1, Math.min(8, by + bh - 1 - ly));
        }
      }
      ctx.fillStyle = r[3];
      ctx.fillRect(bx, by, 2, bh);
    }
    outline(ctx, bx, by, bw, bh, r);
  };

  const teeth = (bx, by, bw, n) => {
    const t = bw / (n * 2 - 1);
    for (let i = 0; i < n; i++) wall(bx + i * t * 2, by - merlon, t, merlon + 1);
  };

  wall(x, bodyY, w, y + h - bodyY);
  teeth(x, bodyY, w, 5);
  wall(towerX, y + merlon, tower, towerH - merlon);
  teeth(towerX, y + merlon, tower, 3);

  // The arch and the windows. A rim round every opening, so no hole is flat
  // black — the Mario side's own rule.
  const doorW = w * 0.2;
  const doorH = Math.min(w * 0.3, (y + h - bodyY) * 0.7);
  const doorX = x + (w - doorW) / 2;
  const doorY = y + h - doorH;
  const arch = (ax, ay, aw, ah) => {
    ctx.beginPath();
    ctx.moveTo(ax, ay + ah);
    ctx.lineTo(ax, ay + aw / 2);
    ctx.quadraticCurveTo(ax + aw / 2, ay - aw * 0.15, ax + aw, ay + aw / 2);
    ctx.lineTo(ax + aw, ay + ah);
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = MARIO.VOID_RIM;
  arch(doorX - 1, doorY - 1, doorW + 2, doorH + 1);
  ctx.fillStyle = MARIO.VOID;
  arch(doorX, doorY, doorW, doorH);
  if (lod === LOD.COARSE) return;
  const win = w * 0.1;
  ctx.fillStyle = MARIO.VOID_RIM;
  ctx.fillRect(x + w * 0.16 - 1, bodyY + win * 0.8 - 1, win + 2, win + 2);
  ctx.fillRect(x + w * 0.74 - 1, bodyY + win * 0.8 - 1, win + 2, win + 2);
  ctx.fillRect(towerX + tower / 2 - win / 2 - 1, y + merlon + win * 0.9 - 1, win + 2, win + 2);
  ctx.fillStyle = MARIO.VOID;
  ctx.fillRect(x + w * 0.16, bodyY + win * 0.8, win, win);
  ctx.fillRect(x + w * 0.74, bodyY + win * 0.8, win, win);
  ctx.fillRect(towerX + tower / 2 - win / 2, y + merlon + win * 0.9, win, win);
}

// The flag on the pole: a square of cool linen with the mushroom badge on it,
// hung from the ball down the left flank, which is where the original keeps it
// before the player pulls it down.
export function flag(ctx, x, y, lod) {
  const f = MARIO.FLAG;
  const b = MARIO.BADGE;
  const px = x + TILE / 2 - 1.5;
  const w = TILE * 0.72;
  ctx.fillStyle = f[0];
  ctx.beginPath();
  ctx.moveTo(px, y + 1);
  ctx.lineTo(px - w - 1, y + 6.5);
  ctx.lineTo(px, y + 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = f[3];
  ctx.beginPath();
  ctx.moveTo(px, y + 2.5);
  ctx.lineTo(px - w, y + 6.5);
  ctx.lineTo(px, y + 10.5);
  ctx.closePath();
  ctx.fill();
  if (lod === LOD.COARSE) return;
  ctx.fillStyle = f[1];
  ctx.beginPath();
  ctx.moveTo(px, y + 8);
  ctx.lineTo(px - w * 0.6, y + 8);
  ctx.lineTo(px, y + 10.5);
  ctx.closePath();
  ctx.fill();
  // The badge is a mushroom in the original. At this size it is one red mark
  // with a pale foot, and that is as much as ever reads.
  ctx.fillStyle = b[1];
  ctx.fillRect(px - w * 0.62, y + 5, 3, 2);
  ctx.fillStyle = b[2];
  ctx.fillRect(px - w * 0.62, y + 7, 3, 1.2);
}

// ---------------------------------------------------------------------------
// Loose marks
// ---------------------------------------------------------------------------

function coin(ctx, x, y, lod, tick) {
  const g = MARIO.GOLD;
  const cx = x + TILE / 2;
  const cy = y + TILE / 2;
  // The coin's spin, on the simulation tick: four phases, the narrowest of
  // which is a bar rather than a disc.
  const wobble = [1, 0.62, 0.24, 0.62][Math.floor(tick / 6) % 4];
  const rx = Math.max(1, 4.2 * wobble);
  ctx.fillStyle = g[2];
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, 5.6, 0, 0, TAU);
  ctx.fill();
  if (lod === LOD.COARSE) return;
  ctx.fillStyle = g[0];
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.6, rx * 0.45), 3.2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = g[3];
  ctx.fillRect(cx - Math.max(0.5, rx * 0.2), cy - 2.6, Math.max(1, rx * 0.4), 5.2);
}

// The flagpole: a green shaft with a lit edge, and the ball on top of it.
function poleShaft(ctx, x, y) {
  const p = MARIO.PIPE.overworld;
  const cx = x + TILE / 2;
  ctx.fillStyle = p[0];
  ctx.fillRect(cx - 2, y, 4, TILE);
  ctx.fillStyle = p[2];
  ctx.fillRect(cx - 1.5, y, 3, TILE);
  ctx.fillStyle = p[4];
  ctx.fillRect(cx - 1.5, y, 1, TILE);
}

function poleBall(ctx, x, y, lod) {
  const p = MARIO.PIPE.overworld;
  const cx = x + TILE / 2;
  ctx.fillStyle = p[0];
  ctx.beginPath();
  disc(ctx, cx, y + TILE - 4, 5);
  ctx.fill();
  ctx.fillStyle = p[2];
  ctx.beginPath();
  disc(ctx, cx, y + TILE - 4, 4);
  ctx.fill();
  if (lod === LOD.COARSE) return;
  ctx.fillStyle = p[4];
  ctx.beginPath();
  disc(ctx, cx - 1.2, y + TILE - 5.2, 1.5);
  ctx.fill();
}

// The axe at the end of a castle level.
function axe(ctx, x, y, lod) {
  const q = MARIO.QUARRY.castle;
  ctx.fillStyle = MARIO.BARK[2];
  ctx.fillRect(x + 7, y + 6, 2, 8);
  ctx.fillStyle = q[4];
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 4);
  ctx.quadraticCurveTo(x + 12, y + 2, x + 12, y + 8);
  ctx.quadraticCurveTo(x + 8, y + 7, x + 4, y + 8);
  ctx.closePath();
  ctx.fill();
  if (lod === LOD.COARSE) return;
  ctx.fillStyle = q[1];
  ctx.fillRect(x + 4, y + 7, 8, 1);
}

// A one-way platform. Always the lightest material in its area, because a
// platform you can jump THROUGH has to look like a different object from the
// terrain before the player commits to the jump.
function platform(ctx, x, y, r, lod) {
  ctx.fillStyle = r[2];
  ctx.fillRect(x, y + 4, TILE, 7);
  ctx.fillStyle = r[4];
  ctx.fillRect(x, y + 4, TILE, 2);
  ctx.fillStyle = r[0];
  ctx.fillRect(x, y + 3, TILE, 1);
  ctx.fillRect(x, y + 11, TILE, 1);
  if (lod === LOD.FULL) {
    ctx.fillStyle = r[1];
    for (let i = 0; i < 2; i++) ctx.fillRect(x + 3 + i * 8, y + 7, 3, 3);
  }
}

// Lava, and the row of half-discs the original draws along its surface.
function lava(ctx, x, y, surface, lod) {
  const r = MARIO.LAVA;
  ctx.fillStyle = r[2];
  ctx.fillRect(x, y, TILE, TILE);
  if (!surface) return;
  ctx.fillStyle = r[3];
  ctx.beginPath();
  for (let i = 0; i < 2; i++) disc(ctx, x + 4 + i * 8, y + 3, 4);
  ctx.fill();
  if (lod === LOD.COARSE) return;
  ctx.fillStyle = r[1];
  ctx.fillRect(x, y + 7, TILE, 1);
}

function water(ctx, x, y, surface, tick) {
  ctx.fillStyle = surface ? SEA.surface : SEA.shallow;
  ctx.fillRect(x, y, TILE, TILE);
  if (!surface) return;
  ctx.fillStyle = SEA.crest;
  ctx.fillRect(x, y + 1 + Math.sin(x * 0.4 + tick * 0.08) * 1.2, TILE, 2);
}

function coral(ctx, x, y, lod) {
  const g = MARIO.PIPE.water;
  ctx.fillStyle = g[1];
  ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 2);
  if (lod === LOD.COARSE) return;
  ctx.fillStyle = g[3];
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
// Characters that stack VERTICALLY into one object: the barrel of a pipe. A
// pipe is one continuous cylinder, and drawing it a tile at a time leaves a
// faint seam across it at every tile boundary — the specular column and the
// body are re-antialiased against each other at a fractional device row, once
// per tile, and at the attack altitude you can count the tiles down the pipe.
export const VSTACK = new Set(['{', '}']);

export const COMPOSITE = {
  b: bush,
  h: hill,
  c: cloud,
  t: tree,
};

// The painters, keyed by level character. Each takes the same argument bag:
// `a.lod` how much ornament it may draw, `a.tick` the simulation tick for
// anything that animates, `a.open` whether the tile above is air, `a.theme`
// the area, and `a.tx`/`a.ty` the tile's place in the world for the materials
// whose pattern courses across tile seams.
const PAINT = {
  '#': (ctx, x, y, a) => ground(ctx, x, y, mat(MARIO.EARTH, a.theme), a.lod, a.tx),
  '=': (ctx, x, y, a) => brick(ctx, x, y, mat(MARIO.BRICK, a.theme), a.lod),
  v: (ctx, x, y, a) => brick(ctx, x, y, mat(MARIO.BRICK, a.theme), a.lod),
  X: (ctx, x, y, a) => brick(ctx, x, y, mat(MARIO.ASHLAR, a.theme), a.lod),
  '?': (ctx, x, y, a) => question(ctx, x, y, mat(MARIO.EARTH, a.theme), a.lod, a.tick),
  M: (ctx, x, y, a) => question(ctx, x, y, mat(MARIO.EARTH, a.theme), a.lod, a.tick),
  U: (ctx, x, y, a) => used(ctx, x, y, mat(MARIO.EARTH, a.theme), a.lod),
  B: (ctx, x, y, a) => solid(ctx, x, y, mat(MARIO.STONE, a.theme), a.lod),
  S: (ctx, x, y, a) => solid(ctx, x, y, mat(MARIO.QUARRY, a.theme), a.lod),
  T: (ctx, x, y, a) => solid(ctx, x, y, mat(MARIO.QUARRY, a.theme), a.lod),
  O: (ctx, x, y, a) => cloudBlock(ctx, x, y, null, a.lod),
  K: (ctx, x, y, a) => cannon(ctx, x, y, true, a.lod),
  k: (ctx, x, y, a) => cannon(ctx, x, y, false, a.lod),
  '[': (ctx, x, y, a) => pipe(ctx, x, y, mat(MARIO.PIPE, a.theme), -1, true, a.lod),
  ']': (ctx, x, y, a) => pipe(ctx, x, y, mat(MARIO.PIPE, a.theme), 1, true, a.lod),
  '{': (ctx, x, y, a) => pipe(ctx, x, y, mat(MARIO.PIPE, a.theme), -1, false, a.lod, a.rows),
  '}': (ctx, x, y, a) => pipe(ctx, x, y, mat(MARIO.PIPE, a.theme), 1, false, a.lod, a.rows),
  '<': (ctx, x, y, a) => pipeH(ctx, x, y, mat(MARIO.PIPE, a.theme), 'mouth-left', a.lod),
  '>': (ctx, x, y, a) => pipeH(ctx, x, y, mat(MARIO.PIPE, a.theme), 'mouth-right', a.lod),
  '-': (ctx, x, y, a) => pipeH(ctx, x, y, mat(MARIO.PIPE, a.theme), 'body', a.lod),
  L: (ctx, x, y, a) => lava(ctx, x, y, a.open, a.lod),
  l: (ctx, x, y, a) => lava(ctx, x, y, a.open, a.lod),
  '~': (ctx, x, y, a) => water(ctx, x, y, true, a.tick),
  _: (ctx, x, y, a) => water(ctx, x, y, false, a.tick),
  g: (ctx, x, y, a) => coral(ctx, x, y, a.lod),
  o: (ctx, x, y, a) => coin(ctx, x, y, a.lod, a.tick),
  '|': (ctx, x, y) => poleShaft(ctx, x, y),
  '^': (ctx, x, y, a) => poleBall(ctx, x, y, a.lod),
  a: (ctx, x, y, a) => axe(ctx, x, y, a.lod),
  P: (ctx, x, y, a) => platform(ctx, x, y, mat(MARIO.TIMBER, a.theme), a.lod),
  '@': (ctx, x, y, a) => platform(ctx, x, y, mat(MARIO.TIMBER, a.theme), a.lod),
  F: (ctx, x, y, a) => platform(ctx, x, y, mat(MARIO.TIMBER, a.theme), a.lod),
  V: (ctx, x, y, a) => platform(ctx, x, y, mat(MARIO.TIMBER, a.theme), a.lod),
  Y: (ctx, x, y, a) => platform(ctx, x, y, mat(MARIO.TIMBER, a.theme), a.lod),
  W: (ctx, x, y, a) => platform(ctx, x, y, mat(MARIO.TIMBER, a.theme), a.lod),
};

// The blocks the original never shows. Drawing a hidden 1-up block as a gold
// question block would be a lie the Mario player can see through, and the
// pilot loses nothing: they are not solid, and a bomb still takes them out.
const INVISIBLE = new Set(['1', 'C']);

export function isInvisible(ch) {
  return INVISIBLE.has(ch);
}

// ARMOUR: the wash over a tile no bomb will ever take.
//
// The pilot has always been able to drop twelve bombs on the spawn floor and
// watch nothing happen, with no way to tell that ground apart from the ground
// beside it. The same is now true of a warp pipe. Both are deliberate rules
// (src/wings/sanctuary.js) and both read as a broken game until they are
// visible — the honest fix is to say so on the glass rather than to let the
// player learn it by wasting ordnance.
//
// A WASH, NOT A REPLACEMENT. The tile keeps its own material and silhouette —
// it is still recognisably ground, still recognisably a pipe — and takes a cool
// steel tint over the top. That is what the user asked for: a different nuance
// of the same thing, not a second set of art. It also means the treatment is
// one function for every protected tile there will ever be, so a new rule
// cannot ship without its colour.
//
// The colour is IRON out of the shared palette, which is the pilot's own metal
// — the carrier, the flak, the aeroplane — and reads as "armoured" against
// every one of Mario's materials without belonging to any of them.
const ARMOUR_TINT = 'rgba(120,126,148,0.46)';
const ARMOUR_EDGE = 'rgba(184,184,192,0.5)';

export function armour(ctx, x, y, lod = LOD.FULL, rows = 1) {
  const h = TILE * Math.max(1, rows);
  ctx.fillStyle = ARMOUR_TINT;
  ctx.fillRect(x, y, TILE, h);
  // Coarse is the zoomed-out end, where a hatch would alias into noise: the
  // flat tint is the whole treatment up there and it still reads.
  if (lod === LOD.COARSE) return;
  // A rivet line down the left edge and along the top, which is what makes it
  // read as plating rather than as haze at mid range.
  ctx.fillStyle = ARMOUR_EDGE;
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x, y, TILE, 1);
}

// Draw one tile character at world pixel (x, y).
export function drawTileChar(ctx, x, y, ch, a) {
  if (INVISIBLE.has(ch)) return;
  const fn = PAINT[ch];
  if (fn) fn(ctx, x, y, a);
  else solid(ctx, x, y, mat(MARIO.STONE, a.theme), a.lod);
}

export { ground, brick, question, solid, pipe, bush, hill, cloud, mat, PAINT };
export default drawTileChar;
