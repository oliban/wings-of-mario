import { TILE } from '../core/constants.js';
import { LEVELS } from '../data/levels/index.js';
import { assertLocalY } from './geo.js';

// The crossing, as a level Mario's engine can load like any other.
//
// It is GENERATED rather than authored into src/data/levels/, and registered
// into the LEVELS map at runtime. getLevel()'s normalize() checks
// `LEVELS[id]` first, so a runtime key is loadable through the ordinary
// game.loadLevel path with no engine edit whatsoever — which is the whole
// reason the ferry is a level and not a new mode.
export const FERRY_LEVEL_ID = 'ferry';

// Exactly one screen wide. The camera cannot scroll, the whole boat is always
// in shot, and there is nowhere to run — which is the point of the mechanic.
export const FERRY_W = 16;
export const FERRY_H = 15;

export const DECK_ROW = 9;
export const DECK_TX0 = 2;
export const DECK_TX1 = 13;
export const SEA_ROW = 11;

export function makeFerryLevel() {
  const rows = [];
  for (let ty = 0; ty < FERRY_H; ty++) {
    let row = '';
    for (let tx = 0; tx < FERRY_W; tx++) {
      const onPlanking = ty === DECK_ROW && tx >= DECK_TX0 && tx <= DECK_TX1;
      const onGunwale = ty === DECK_ROW - 1 && (tx === DECK_TX0 || tx === DECK_TX1);
      if (onPlanking || onGunwale) row += 'B'; // stone: the darkest solid there is
      else if (ty === SEA_ROW) row += '~'; // water surface
      else if (ty > SEA_ROW) row += '_'; // water body
      else row += '.';
    }
    rows.push(row);
  }
  return {
    id: FERRY_LEVEL_ID,
    name: 'THE CROSSING',
    time: 400,
    theme: 'overworld',
    music: 'overworld',
    width: FERRY_W,
    height: FERRY_H,
    // Amidships, standing on the planking.
    spawn: { x: Math.floor((DECK_TX0 + DECK_TX1) / 2), y: DECK_ROW - 1 },
    tiles: rows,
    contents: [],
    entities: [],
  };
}

// Everything a torpedo takes away: the planking and both gunwales. In tile-key
// format, island-local, exactly as world.destroyTiles() wants them.
export function deckKeys() {
  const keys = [];
  for (let tx = DECK_TX0; tx <= DECK_TX1; tx++) keys.push(`${tx},${DECK_ROW}`);
  keys.push(`${DECK_TX0},${DECK_ROW - 1}`);
  keys.push(`${DECK_TX1},${DECK_ROW - 1}`);
  return keys;
}

// Is this pixel position on the boat? Used to catch a Mario who jumped the
// gunwale: the sea here is water TILES, so he would otherwise tread water
// beside the boat forever, which is the one softlock this design can actually
// prevent without a rescue system.
//
// This is the seam. The Ferry itself is WORLD-space (it is on the ocean, at
// SEA_Y); everything below the waterline in THIS file is island-local level
// pixels, and the level is only FERRY_H * TILE = 240px tall. Handing the
// boat's world y to onDeck() would silently answer "overboard" for every
// position on the deck, so assert instead of guessing.
export function onDeck(px, py) {
  assertLocalY(py, 'ferry.onDeck py');
  const tx = Math.floor(px / TILE);
  const ty = Math.floor(py / TILE);
  return tx >= DECK_TX0 && tx <= DECK_TX1 && ty <= DECK_ROW;
}

export function registerFerryLevel(registry = LEVELS) {
  if (!registry[FERRY_LEVEL_ID]) registry[FERRY_LEVEL_ID] = makeFerryLevel();
  return registry[FERRY_LEVEL_ID];
}

export default registerFerryLevel;
