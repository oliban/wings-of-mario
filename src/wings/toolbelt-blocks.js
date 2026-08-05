// THE TOOLBELT IN THE QUESTION BLOCKS, outside Harry mode.
//
// Upstream gives the toolbelt to Harry and to nobody else: BlockSystem#reset
// calls _pickToolbeltTiles() on every level load, and its first line is
// `if (!w || w.harryMode !== true) return;` — so in an ordinary game the set is
// cleared and the level is exactly as authored. Two visible '?' blocks that
// would have held a plain coin hold a toolbelt instead, chosen from a seeded
// RNG on the level id, so the same level always hides it in the same blocks.
//
// WHY THIS FORK WANTS IT ANYWAY. The user asked for the belt to come "from
// blocks like before AND when stranded". The parcel hands one over when the
// bombs have cut Mario off (src/wings/parcel.js) — that is the emergency. This
// is the other half: a toolbelt he can go and FIND, so bridging is a thing he
// can plan a route around rather than only a consolation for being trapped.
// Against a pilot who permanently deletes the ground, a player who can rebuild
// a little of it on purpose is the counterplay the match wants.
//
// HOW, WITHOUT TOUCHING THE ENGINE. src/game/blocks.js is upstream and the diff
// against upstream is exactly 150 lines across three files, none of them this
// one. So rather than edit the gate, this calls the engine's own seeding with
// `harryMode` held true across the call and put back afterwards — the same
// instance-level technique as guardWorld() in src/wings/sanctuary.js and
// mario-side.js's wrap of game.loadLevel.
//
// It is a re-seed, not a second seed: _pickToolbeltTiles() clears the set
// before it fills it, so calling it again after the load replaces the empty set
// the engine just made with the one Harry would have had. Same function, same
// seeded RNG, same two blocks — this fork simply asks for them.
//
// WHAT IT DOES NOT DO. `harryMode` is restored to whatever it was, so nothing
// else that reads it changes: the hero stays Mario, the coin counter keeps its
// 1UP at 100, and the HUD is untouched. The one flag that matters here is off
// again before the caller gets control back.

// Sub-areas are left alone, matching the rule the engine's own seeding uses: a
// coin room's blocks stay coin blocks.
export function seedToolbeltBlocks(world) {
  if (!world || world.areaId) return false;
  const blocks = world.blocks;
  if (!blocks || typeof blocks._pickToolbeltTiles !== 'function') return false;
  // Already seeded — a re-entry from a second hook, or a level that has not
  // been rebuilt since the last call. Re-seeding is harmless but pointless.
  if (blocks.toolTiles && blocks.toolTiles.size > 0) return false;

  const was = world.harryMode;
  world.harryMode = true;
  try {
    blocks._pickToolbeltTiles();
  } finally {
    // In a finally because a throw in upstream's seeding must not leave this
    // game permanently in Harry mode — that would cost the player his 1UPs at
    // 100 coins for the rest of the run.
    world.harryMode = was;
  }
  return !!(blocks.toolTiles && blocks.toolTiles.size > 0);
}

// A level is rebuilt on every load, every death and every trip down a pipe, and
// each one clears the block system — so the seeding has to happen again.
//
// THE STATE IS THE TRIGGER, not an edge, and that is the whole design. The
// first version watched for a rebuild: level id changed, area changed, or the
// tick counter went backwards. It raced. This runs on the overlay's hook list,
// which is driven off rAF, so a step can land in the MIDDLE of an async
// loadLevel — after the world has taken the new level but before
// BlockSystem#reset has cleared the set. The edge is then spent on a half-built
// world, reset wipes what was seeded, and no edge ever comes again: the level
// sat there for the rest of the run with no toolbelt in it. That is exactly
// what 1-1 did while 1-2 worked, because the boot load and the test's load were
// the same level.
//
// "The main map has no toolbelt in it" is not an edge and cannot be missed. It
// is true until the seeding succeeds and false forever after — including once
// Mario has collected them, since using a block marks it used and leaves the
// key in the set.
export class ToolbeltSeeder {
  constructor() {
    this.seeded = 0;
  }

  step(world) {
    if (!world || !world.level) return false;
    if (!seedToolbeltBlocks(world)) return false;
    this.seeded++;
    return true;
  }
}

export default seedToolbeltBlocks;
