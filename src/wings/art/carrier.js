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

export const ISLAND_H = 96;
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

  ctx.fillStyle = 'rgba(14,8,26,0.75)';
  for (let x = x0 + 14; x < x1 - 10; x += 21) {
    ctx.beginPath();
    ctx.arc(x, deckY + d * 0.45, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Vertical plate seams, so the side reads as riveted sections not a wash.
  ctx.strokeStyle = 'rgba(20,12,34,0.28)';
  for (let x = x0 + 8; x < x1; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, deckY + 6);
    ctx.lineTo(x - 2, seaY);
    ctx.stroke();
  }

  // Boot topping at the waterline.
  ctx.fillStyle = SHIP.boot;
  ctx.fillRect(x0 - 8, seaY - 3.5, x1 - x0 + 20, 6);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Flight deck
// ---------------------------------------------------------------------------

export function drawDeck(ctx, x0, x1, deckY, tick) {
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

  // Arrestor wires: three cables standing proud of the deck on their stanchions.
  // This is what the hook is actually reaching for.
  ctx.strokeStyle = SHIP.rule;
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const x = x0 + 62 + i * 26;
    ctx.beginPath();
    ctx.moveTo(x - 11, deckY - DECK_THICK - 0.5);
    ctx.lineTo(x + 11, deckY - DECK_THICK - 0.5);
    ctx.stroke();
    ctx.fillStyle = SHIP.deckShade;
    ctx.fillRect(x - 11.5, deckY - DECK_THICK - 1, 1.6, 2);
    ctx.fillRect(x + 10, deckY - DECK_THICK - 1, 1.6, 2);
  }

  // Deck-edge catwalk with lamps that blink in two alternating groups.
  ctx.fillStyle = SHIP.hullShade;
  ctx.fillRect(x0 - 8, deckY + 1, x1 - x0 + 19, 3);
  for (let i = 0, x = x0 + 6; x < x1 + 4; x += 15, i++) {
    ctx.fillStyle = SHIP.hullDark;
    ctx.fillRect(x, deckY + 1, 6, 3);
    if ((i & 1) === ((tick >> 5) & 1)) {
      ctx.fillStyle = SHIP.lamp;
      ctx.fillRect(x + 2, deckY + 1.5, 2, 2);
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

// Bridge, uptakes, mast and ensign, standing ISLAND_H above the deck. The
// forward third steps back into a narrower block, so the profile is an L and
// not a box.
export function drawIsland(ctx, x, deckY, tick) {
  const baseY = deckY - DECK_THICK + 2;
  ctx.save();

  // Mast: a pale pole rising nearly as far again above the bridge, with two
  // yardarms. Half the island's height is mast, exactly as in the original.
  const bridgeTop = baseY - 52;
  const mastX = x + 26;
  ctx.strokeStyle = SHIP.rule;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(mastX, bridgeTop);
  ctx.lineTo(mastX, baseY - ISLAND_H);
  ctx.stroke();
  ctx.lineWidth = 1.1;
  for (const f of [0.34, 0.66]) {
    const y = bridgeTop - (ISLAND_H - 52) * f;
    ctx.beginPath();
    ctx.moveTo(mastX - 7, y);
    ctx.lineTo(mastX + 7, y);
    ctx.stroke();
  }

  // Air-search aerial at the masthead, swinging through a bearing off the tick.
  const sweep = Math.sin(tick * 0.035);
  ctx.save();
  ctx.translate(mastX, baseY - ISLAND_H + 3);
  ctx.scale(Math.max(0.15, Math.abs(sweep)), 1);
  ctx.strokeStyle = SHIP.rule;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.rect(-5, -3.5, 10, 5);
  ctx.moveTo(-5, -1);
  ctx.lineTo(5, -1);
  ctx.stroke();
  ctx.restore();

  // Ensign at the masthead, flying aft, rippling off the tick.
  drawEnsign(ctx, mastX + 1, baseY - ISLAND_H + 7, tick);

  // Lower block: the widest tier, carrying the hull number.
  block(ctx, x, baseY - 22, ISLAND_W, 22, 4);
  // Middle block: bridge proper, four tiers of windows.
  block(ctx, x + 6, baseY - 40, ISLAND_W - 14, 18, 4);
  // Upper block, stepped back — the short arm of the L.
  block(ctx, x + 16, baseY - 52, ISLAND_W - 34, 12, 3);

  // Hull number, chunky and white, on the lower block.
  ctx.fillStyle = SHIP.rule;
  ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText('18', x + 42, baseY - 6);
  ctx.restore();
}

// One tier of superstructure: a lit top edge, a shaded face, a row of windows.
function block(ctx, x, y, w, h, rows) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, SHIP.islandLit);
  g.addColorStop(0.3, SHIP.island);
  g.addColorStop(1, SHIP.islandShade);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = SHIP.rule;
  ctx.fillRect(x, y, w, 1.2);
  ctx.fillStyle = 'rgba(20,12,34,0.5)';
  ctx.fillRect(x, y + h - 1, w, 1);

  // Horizontal bands separated by lighter rules, each carrying evenly spaced
  // dark window rectangles. This is the whole texture of the original's bridge.
  const step = (h - 2) / rows;
  for (let r = 0; r < rows; r++) {
    const by = y + 2 + r * step;
    // A continuous dark window strip broken by mullions reads as a bridge
    // gallery; a grid of separate squares reads as a filing cabinet.
    ctx.fillStyle = SHIP.window;
    ctx.fillRect(x + 2.5, by + step * 0.2, w - 5, Math.max(1.4, step * 0.4));
    ctx.fillStyle = SHIP.islandShade;
    for (let wx = x + 6; wx < x + w - 4; wx += 6.5) {
      ctx.fillRect(wx, by + step * 0.2, 1.1, Math.max(1.4, step * 0.4));
    }
    // The lighter rule under each tier is what separates the bands.
    ctx.fillStyle = 'rgba(242,236,251,0.8)';
    ctx.fillRect(x + 1, by + step - 1.1, w - 2, 1.1);
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
  drawParkedPlane(ctx, x, y, 1);
  drawParkedPlane(ctx, x + 30, y, 1);
}
