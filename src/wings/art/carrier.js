import { SHIP, ENSIGN } from './palette.js';
import { drawParkedPlane } from './plane.js';

// The carrier. Two things make a side-on grey box read as a flat-top, and
// neither of them is hull detail:
//
//   THE ISLAND IS ENORMOUS. In the original the bridge, mast and ensign stand
//   about 55% of the play area tall — nearly as tall as the ship is long is
//   wide. Ours used to be 13%, which is why it read as a barge with a shed on
//   it. Here the island is ~95px over a ~200px play area.
//
//   THE HULL OWNS A HUE NOBODY ELSE USES. The original's flat magenta is a
//   six-colour palette accident, but the *strategy* is deliberate and is why
//   every object in that frame is identifiable at a glance. Ours is a slate
//   violet: clearly not the cyan of the sea, clearly not the near-black of the
//   sky, clearly not the neutral white of the aircraft.
//
// The rest — plating that follows the form, a stepped L-profile bridge, the hull
// number, a deck-crew figure, aircraft parked with their wings folded up into a
// V — is dressing, but it is the dressing that makes the ship specific.

export const ISLAND_H = 92;
export const ISLAND_W = 68;
export const DECK_THICK = 7;

// ---------------------------------------------------------------------------
// Hull
// ---------------------------------------------------------------------------

// Bow at x1, stern at x0, deck at deckY, waterline at seaY. The stem rakes
// forward at the top and tucks under at the waterline; the transom is close to
// vertical. Neither end is a vertical cut.
function hullPath(ctx, x0, x1, deckY, seaY) {
  const d = seaY - deckY;
  ctx.beginPath();
  ctx.moveTo(x0 - 4, deckY);
  ctx.lineTo(x1 + 6, deckY); // the flight deck overhangs both ends
  ctx.lineTo(x1 + 6, deckY + d * 0.12);
  ctx.quadraticCurveTo(x1 + 2, deckY + d * 0.45, x1 - 12, seaY + 3);
  ctx.lineTo(x0 + 6, seaY + 3);
  ctx.quadraticCurveTo(x0 - 1, deckY + d * 0.5, x0 - 3, deckY + d * 0.16);
  ctx.closePath();
}

export function drawHull(ctx, x0, x1, deckY, seaY) {
  const d = seaY - deckY;
  ctx.save();
  hullPath(ctx, x0, x1, deckY, seaY);
  const g = ctx.createLinearGradient(0, deckY, 0, seaY + 3);
  g.addColorStop(0, SHIP.hullLit);
  g.addColorStop(0.22, SHIP.hull);
  g.addColorStop(0.75, SHIP.hullShade);
  g.addColorStop(1, SHIP.hullDark);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.clip();

  // Shadow cast by the deck overhang — the single strongest cue that the deck
  // is a flat plate sitting on top of a hull rather than the hull's top edge.
  const sh = ctx.createLinearGradient(0, deckY, 0, deckY + 11);
  sh.addColorStop(0, 'rgba(10,6,18,0.85)');
  sh.addColorStop(1, 'rgba(10,6,18,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(x0 - 6, deckY, x1 - x0 + 14, 11);

  // Plating that follows the form: strakes along the hull's run, a lighter
  // knuckle where the side turns under, and portholes on the upper strake.
  ctx.strokeStyle = 'rgba(20,12,34,0.5)';
  ctx.lineWidth = 1;
  for (const f of [0.34, 0.56, 0.78]) {
    const y = deckY + d * f;
    ctx.beginPath();
    ctx.moveTo(x0 - 4, y);
    ctx.quadraticCurveTo((x0 + x1) / 2, y + 1.5, x1 + 6, y - 1);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(230,220,250,0.16)';
  ctx.beginPath();
  ctx.moveTo(x0 - 4, deckY + d * 0.33);
  ctx.quadraticCurveTo((x0 + x1) / 2, deckY + d * 0.345, x1 + 6, deckY + d * 0.31);
  ctx.stroke();

  // Portholes in irregular groups rather than an even row: a fixed hash decides
  // the gaps, so the rhythm is broken but identical on every run.
  ctx.fillStyle = 'rgba(14,8,26,0.75)';
  let px = x0 + 12;
  for (let i = 0; px < x1 - 10; i++) {
    const k = ((i * 2654435761) >>> 0);
    ctx.beginPath();
    ctx.arc(px, deckY + d * (0.44 + ((k >>> 9) % 5) / 100), 1.5, 0, Math.PI * 2);
    ctx.fill();
    // Every few ports come in a close pair, as they do on a real side shell.
    px += ((k >>> 3) % 4) === 0 ? 7 : 15 + ((k >>> 17) % 12);
  }
  // Vertical plate seams, so the side reads as riveted sections not a wash.
  ctx.strokeStyle = 'rgba(20,12,34,0.28)';
  for (let x = x0 + 8; x < x1; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, deckY + 6);
    ctx.lineTo(x - 2, seaY);
    ctx.stroke();
  }

  // Vertical variation along the length: the shell is not evenly lit, and a
  // uniform grey the length of the ship is what makes a hull look like a wall.
  const along = ctx.createLinearGradient(x0, 0, x1, 0);
  along.addColorStop(0, 'rgba(20,12,34,0.30)');
  along.addColorStop(0.28, 'rgba(20,12,34,0.05)');
  along.addColorStop(0.52, 'rgba(20,12,34,0.26)');
  along.addColorStop(0.78, 'rgba(20,12,34,0.04)');
  along.addColorStop(1, 'rgba(20,12,34,0.22)');
  ctx.fillStyle = along;
  ctx.fillRect(x0 - 8, deckY, x1 - x0 + 20, seaY - deckY + 4);

  // A darker band down at the waterline, then the boot topping itself.
  const boot = ctx.createLinearGradient(0, seaY - 13, 0, seaY - 3);
  boot.addColorStop(0, 'rgba(20,12,34,0)');
  boot.addColorStop(1, 'rgba(20,12,34,0.5)');
  ctx.fillStyle = boot;
  ctx.fillRect(x0 - 8, seaY - 13, x1 - x0 + 20, 10);
  ctx.fillStyle = SHIP.boot;
  ctx.fillRect(x0 - 8, seaY - 3.5, x1 - x0 + 20, 6);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Flight deck
// ---------------------------------------------------------------------------

// THE WIRE TAKING THE LOAD.
//
// The three cables were painted flat and never moved, whatever happened on
// them: a trap looked exactly like an aeroplane deciding to stop. This is the
// one that caught, drawn as the hook drags it into a V and it rings out.
//
// A DAMPED SPRING, in simulation ticks. The deflection is a decaying cosine —
// hard down on the catch, springing back through the flat and overshooting a
// little the other way, each swing smaller than the last. That is what a steel
// cable under a sudden load does, and it is why this reads as elastic rather
// than as a line being dragged: the recoil is the part the eye believes.
export const WIRE = {
  // Three cables, 26px apart, the first 62px up the deck from the stern.
  COUNT: 3,
  FIRST: 62,
  SPACING: 26,
  HALF: 11,
  // How far the hook pulls the wire down at the moment of the catch.
  DEPTH: 7,
  // How long the whole thing rings for, and how fast it swings. Two and a bit
  // swings inside three quarters of a second: long enough to see, short enough
  // that the deck is at rest before the player has finished exhaling.
  TICKS: 46,
  SWINGS: 2.4,
};

// How deep the caught wire is pulled at `t` ticks after the catch, in pixels.
// Pure, so the shape can be tested without a canvas.
export function wireSag(t, depth = WIRE.DEPTH, ticks = WIRE.TICKS) {
  if (!(t >= 0) || t >= ticks) return 0;
  const u = t / ticks;
  // Decaying cosine: 1 at u=0, through zero and back, smaller each time.
  return depth * (1 - u) * Math.cos(u * Math.PI * WIRE.SWINGS);
}

// Which cable the hook took: the one nearest where the aeroplane stopped.
export function wireIndexAt(x0, x) {
  if (typeof x !== 'number') return -1;
  const i = Math.round((x - x0 - WIRE.FIRST) / WIRE.SPACING);
  return Math.max(0, Math.min(WIRE.COUNT - 1, i));
}

// `wire` is {x, t, hook} from the scene: which cable was taken, how many ticks
// ago, and where the hook has DRAGGED IT TO. The drag is the whole picture —
// the stanchions stay where they are bolted and the cable is pulled out into a
// long V behind the aeroplane, lengthening as it runs on down the deck.
//
// Drawing it at the cable's own position instead was the first attempt and it
// read as nothing at all: a 22px wire dipping 7px, entirely underneath a 24px
// aeroplane parked on top of it.
export function drawWires(ctx, x0, deckY, wire) {
  const top = deckY - DECK_THICK - 0.5;
  const caught = wire ? wireIndexAt(x0, wire.x) : -1;
  const ring = wire ? wireSag(wire.t) : 0;
  for (let i = 0; i < WIRE.COUNT; i++) {
    const x = x0 + WIRE.FIRST + i * WIRE.SPACING;
    ctx.strokeStyle = SHIP.rule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (i === caught) {
      // The apex is the hook. While the aeroplane is still running it is ahead
      // of the stanchions and moving; once it stops, the ring-down plays out
      // there. Kept at least a little proud of the deck so the cable never
      // disappears into the planking.
      const apex = typeof wire.hook === 'number' ? wire.hook : x;
      ctx.moveTo(x - WIRE.HALF, top);
      ctx.lineTo(apex, top + Math.max(1, ring));
      ctx.lineTo(x + WIRE.HALF, top);
    } else {
      ctx.moveTo(x - WIRE.HALF, top);
      ctx.lineTo(x + WIRE.HALF, top);
    }
    ctx.stroke();
    ctx.fillStyle = SHIP.deckShade;
    ctx.fillRect(x - WIRE.HALF - 0.5, deckY - DECK_THICK - 1, 1.6, 2);
    ctx.fillRect(x + WIRE.HALF - 1, deckY - DECK_THICK - 1, 1.6, 2);
  }
}

export function drawDeck(ctx, x0, x1, deckY, tick, wire = null) {
  ctx.save();
  // The deck plate itself, seen almost edge-on: a bright top surface over a
  // shadowed under-edge.
  const g = ctx.createLinearGradient(0, deckY - DECK_THICK, 0, deckY + 1);
  g.addColorStop(0, SHIP.deckLit);
  g.addColorStop(0.45, SHIP.deck);
  g.addColorStop(1, SHIP.deckShade);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x0 - 9, deckY - DECK_THICK + 2);
  ctx.lineTo(x1 + 11, deckY - DECK_THICK + 2);
  ctx.lineTo(x1 + 12, deckY + 1);
  ctx.lineTo(x0 - 10, deckY + 1);
  ctx.closePath();
  ctx.fill();

  // Round-down at the stern and a slight rise at the bow, so the deck is not a
  // ruled rectangle.
  ctx.fillStyle = SHIP.deckShade;
  ctx.beginPath();
  ctx.moveTo(x0 - 10, deckY - DECK_THICK + 2);
  ctx.quadraticCurveTo(x0 - 4, deckY - DECK_THICK + 4.5, x0 + 6, deckY - DECK_THICK + 4.5);
  ctx.lineTo(x0 + 6, deckY - DECK_THICK + 2);
  ctx.closePath();
  ctx.fill();

  // Painted centreline: a dashed stripe down the landing area, which is what
  // tells you at a glance which way the deck runs.
  ctx.strokeStyle = SHIP.deckLit;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([9, 7]);
  ctx.lineDashOffset = 0;
  ctx.beginPath();
  ctx.moveTo(x0 + 10, deckY - 3);
  ctx.lineTo(x1 - 24, deckY - 3);
  ctx.stroke();
  ctx.setLineDash([]);

  // Touchdown stripes across the aft third.
  ctx.strokeStyle = 'rgba(20,12,34,0.5)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const x = x0 + 16 + i * 9;
    ctx.beginPath();
    ctx.moveTo(x, deckY - DECK_THICK + 2.5);
    ctx.lineTo(x - 1.5, deckY - 0.5);
    ctx.stroke();
  }

  // Arrestor wires: three cables standing proud of the deck on their
  // stanchions. This is what the hook is actually reaching for — and when it
  // takes one, that one bends. `wire` is {x, t} from the scene: where the hook
  // stopped and how many ticks ago, or null for three cables at rest.
  drawWires(ctx, x0, deckY, wire);

  // AA gun galleries along the deck edge: small repeated tubs slung under the
  // lip, each with a barrel poking out. In the reference these are the strongest
  // texture on the whole ship, and a row of blinking lamps was standing in for
  // them.
  ctx.fillStyle = SHIP.hullShade;
  ctx.fillRect(x0 - 8, deckY + 1, x1 - x0 + 19, 3);
  for (let i = 0, x = x0 + 6; x < x1 + 4; x += 15, i++) {
    ctx.fillStyle = SHIP.hullDark;
    ctx.fillRect(x, deckY + 0.5, 8, 4);
    ctx.fillStyle = SHIP.deckShade;
    ctx.fillRect(x + 1, deckY + 1, 6, 1);
    // Every third tub has its barrel up, and the elevation creeps with the tick
    // so the battery is never a still photograph.
    if (i % 3 === 0) {
      ctx.save();
      ctx.strokeStyle = SHIP.hullDark;
      ctx.lineWidth = 1.1;
      ctx.translate(x + 4, deckY + 0.5);
      ctx.rotate(-1.1 + 0.18 * Math.sin((tick + i * 40) * 0.02));
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(5, 0);
      ctx.stroke();
      ctx.restore();
    }
  }

  // The deck elevator: a recess set into the deck with its lattice inside.
  const ex = x1 - 78;
  ctx.fillStyle = '#0d0716';
  ctx.fillRect(ex, deckY - DECK_THICK + 2, 34, DECK_THICK - 1);
  ctx.strokeStyle = SHIP.deckShade;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    ctx.moveTo(ex + i * 8.5, deckY - DECK_THICK + 2);
    ctx.lineTo(ex + i * 8.5 + 4, deckY);
  }
  ctx.moveTo(ex, deckY - 2.5);
  ctx.lineTo(ex + 34, deckY - 2.5);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Island
// ---------------------------------------------------------------------------

// The island. Getting this wrong is what made the ship read as a hotel: even
// rectangular tiers with a uniform grid of identical windows and a plain cross
// for a mast is an office block, whatever colour it is painted.
//
// A warship bridge is four specific things, all visible in the reference:
//
//   IRREGULAR STEPPED MASSING. Tiers of different widths AND different offsets,
//   narrowing as they rise and stepping back further on one side than the other.
//   Symmetry is what reads as architecture.
//   A LATTICE MAST with cross-bracing carrying a bedspring radar array and a
//   yardarm — the single strongest warship cue in the whole silhouette.
//   FEW, SMALL, IRREGULAR OPENINGS. Bridge glazing and scattered slits, not a
//   window grid.
//   GREEBLES. Boxes, vents, a funnel, a director tub, railings and platforms
//   breaking every outline. Warship superstructures are visually noisy; clean
//   rectangles read civilian.
export function drawIsland(ctx, x, deckY, tick) {
  const baseY = deckY - DECK_THICK + 2;
  const H = ISLAND_H;
  const W = ISLAND_W;
  // Heights are fractions of the island's own height, so the massing survives a
  // change of scale.
  const at = (f) => baseY - H * f;

  ctx.save();

  // --- masts, drawn first so the tiers overlap their feet -------------------
  const poleX = x + W * 0.46;
  const latX = x + W * 0.78;

  // Lattice tripod: two splayed legs with cross-bracing between them. Open
  // framework, not a solid pole.
  ctx.strokeStyle = SHIP.deckLit;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(latX - 3.5, at(0.34));
  ctx.lineTo(latX - 0.8, at(0.68));
  ctx.moveTo(latX + 3.5, at(0.34));
  ctx.lineTo(latX + 0.8, at(0.68));
  ctx.stroke();
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const f0 = 0.34 + (0.34 * i) / 5;
    const f1 = 0.34 + (0.34 * (i + 1)) / 5;
    const w0 = 3.5 - 2.7 * (i / 5);
    const w1 = 3.5 - 2.7 * ((i + 1) / 5);
    ctx.moveTo(latX - w0, at(f0));
    ctx.lineTo(latX + w1, at(f1));
    ctx.moveTo(latX + w0, at(f0));
    ctx.lineTo(latX - w1, at(f1));
  }
  ctx.stroke();

  // Air-search bedspring on top of the tripod: a flat rectangular array of
  // horizontal bars, swinging through a bearing off the tick.
  ctx.save();
  ctx.translate(latX, at(0.71));
  ctx.scale(Math.max(0.2, Math.abs(Math.sin(tick * 0.028))), 1);
  ctx.fillStyle = SHIP.deckLit;
  ctx.fillRect(-6, -4.5, 12, 5);
  ctx.strokeStyle = SHIP.hullDark;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    ctx.moveTo(-6, -4.5 + i * 1.25);
    ctx.lineTo(6, -4.5 + i * 1.25);
  }
  ctx.stroke();
  ctx.restore();

  // Main pole with a yardarm and the ensign at the truck.
  ctx.strokeStyle = SHIP.rule;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(poleX, at(0.56));
  ctx.lineTo(poleX, at(1));
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(poleX - 7, at(0.8));
  ctx.lineTo(poleX + 7, at(0.8));
  ctx.moveTo(poleX - 7, at(0.8));
  ctx.lineTo(poleX - 7, at(0.83));
  ctx.moveTo(poleX + 7, at(0.8));
  ctx.lineTo(poleX + 7, at(0.83));
  ctx.stroke();
  // A small surface-search aerial on the yardarm.
  ctx.fillStyle = SHIP.deckLit;
  ctx.fillRect(poleX + 2, at(0.87) - 3, 4.5, 3);
  drawEnsign(ctx, poleX + 1.5, at(1) + 1, tick);

  // --- massing: five tiers, no two the same width, each offset differently ---
  tier(ctx, x, at(0.22), W, H * 0.22, 'deck');
  tier(ctx, x + 3, at(0.34), W - 15, H * 0.12, 'plain');
  tier(ctx, x + 1, at(0.47), W - 29, H * 0.13, 'bridge');
  tier(ctx, x + 8, at(0.56), W - 45, H * 0.09, 'plain');
  tier(ctx, x + 13, at(0.63), W - 54, H * 0.07, 'plain');

  // Funnel: an angled uptake on the outboard side, the tallest solid thing after
  // the masts and the one part of the island that is not a box.
  const fx = x + W - 30;
  ctx.beginPath();
  ctx.moveTo(fx, at(0.4));
  ctx.lineTo(fx + 3.5, at(0.63));
  ctx.lineTo(fx + 12, at(0.63));
  ctx.lineTo(fx + 12, at(0.4));
  ctx.closePath();
  ctx.fillStyle = SHIP.hullShade;
  ctx.fill();
  ctx.fillStyle = SHIP.hullDark;
  ctx.fillRect(fx + 3.5, at(0.63) - 1.5, 8.5, 2);

  // Director tub outboard on the lower block: a cylinder with a wider rim.
  const dx = x + W - 8;
  ctx.fillStyle = SHIP.hullShade;
  ctx.fillRect(dx - 3, at(0.34), 6, H * 0.1);
  ctx.fillStyle = SHIP.island;
  ctx.beginPath();
  ctx.ellipse(dx, at(0.34), 5, 2.4, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = SHIP.deckLit;
  ctx.fillRect(dx - 5, at(0.34) - 0.8, 10, 1);

  // Greebles: small boxes, vents and a davit breaking the tier outlines.
  ctx.fillStyle = SHIP.hullShade;
  ctx.fillRect(x + 6, at(0.24) - 3, 5, 3);
  ctx.fillRect(x + 26, at(0.35) - 2.5, 4, 2.5);
  ctx.fillRect(x + W - 30, at(0.23) - 2, 3.5, 2);
  ctx.fillStyle = SHIP.island;
  ctx.fillRect(x + 18, at(0.48) - 2, 3, 2);
  // Railings along the open platforms: a dotted light line, not a solid rule.
  ctx.fillStyle = SHIP.deckLit;
  for (let i = 0; i < 9; i++) ctx.fillRect(x + 4 + i * 3.4, at(0.22) - 2.2, 0.9, 2.2);
  for (let i = 0; i < 5; i++) ctx.fillRect(x + 34 + i * 3.2, at(0.34) - 2, 0.8, 2);

  // The hull number, on the forward face where nothing parks in front of it.
  ctx.fillStyle = SHIP.rule;
  ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText('18', x + 6, baseY - 5);
  ctx.restore();
}

// One tier. `kind` decides what openings it carries: a bridge gets a glazing
// band, everything else gets a few scattered slits. Never a grid.
function tier(ctx, x, y, w, h, kind) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, SHIP.islandLit);
  g.addColorStop(0.22, SHIP.island);
  g.addColorStop(1, SHIP.islandShade);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = SHIP.deckLit;
  ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = SHIP.hullDark;
  ctx.fillRect(x, y + h - 1, w, 1);

  if (kind === 'bridge') {
    // Continuous glazing broken by mullions — the bridge windows, and the only
    // large opening on the island.
    ctx.fillStyle = SHIP.window;
    ctx.fillRect(x + 2, y + h * 0.28, w - 4, Math.max(1.6, h * 0.32));
    ctx.fillStyle = SHIP.islandShade;
    for (let wx = x + 6; wx < x + w - 3; wx += 6) {
      ctx.fillRect(wx, y + h * 0.28, 1, Math.max(1.6, h * 0.32));
    }
    return;
  }

  // Scattered slits at irregular intervals, from a fixed hash of the tier's own
  // position so they never change between runs and never line up into a grid.
  ctx.fillStyle = SHIP.window;
  const k = ((x * 2654435761) >>> 0) ^ ((y * 40503) >>> 0);
  let px = x + 3;
  for (let i = 0; px < x + w - 4; i++) {
    const gap = 5 + ((k >>> (i * 3 % 20)) % 7);
    const wide = ((k >>> (i * 5 % 18)) % 3) === 0;
    ctx.fillRect(px, y + (kind === 'deck' ? h * 0.55 : h * 0.34), wide ? 3.4 : 1.6, 1.4);
    px += gap;
  }
}
function drawEnsign(ctx, x, y, tick) {
  const w = 20;
  const h = 11;
  const ripple = Math.sin(tick * 0.09);
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(w * 0.5, ripple * 2, w, ripple * 1.2);
  ctx.lineTo(w, h + ripple * 1.2);
  ctx.quadraticCurveTo(w * 0.5, h + ripple * 2, 0, h);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = ENSIGN.field;
  ctx.fillRect(0, -2, w, h + 4);
  ctx.fillStyle = ENSIGN.stripe;
  for (let i = 0; i < 4; i++) ctx.fillRect(0, i * 2.8 + ripple * 0.6, w, 1.4);
  ctx.fillStyle = ENSIGN.canton;
  ctx.fillRect(0, ripple * 0.4, w * 0.42, h * 0.55);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Deck furniture
// ---------------------------------------------------------------------------

// The launch officer: a small figure with his arms up, the only human on screen,
// and the thing that gives the ship its scale.
export function drawCrew(ctx, x, deckY, tick) {
  const y = deckY - DECK_THICK + 2;
  const wave = Math.sin(tick * 0.14) * 1.4;
  ctx.save();
  ctx.strokeStyle = SHIP.crew;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 5);
  ctx.moveTo(x, y - 4.5);
  ctx.lineTo(x - 2.6, y - 8.5 + wave);
  ctx.moveTo(x, y - 4.5);
  ctx.lineTo(x + 2.6, y - 8.5 - wave);
  ctx.stroke();
  ctx.fillStyle = SHIP.crewSkin;
  ctx.beginPath();
  ctx.arc(x, y - 6.6, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = SHIP.crew;
  ctx.beginPath();
  ctx.arc(x, y - 7.2, 1.7, Math.PI, 0);
  ctx.fill();
  ctx.restore();
}

// Aircraft parked at the bow with their wings folded up into a V. Nothing else
// says "carrier" this quickly.
export function drawDeckPark(ctx, x, deckY) {
  const y = deckY - DECK_THICK + 2;
  drawParkedPlane(ctx, x, y);
  drawParkedPlane(ctx, x + 40, y);
}
