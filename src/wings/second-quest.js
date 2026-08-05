// THE END OF 8-4, AND THE QUEST THAT FOLLOWS IT.
//
// Two things the original does that we did not:
//
//   1. Rescuing the Princess prints HER lines, not Toad's. Upstream shows the
//      castle card for every level whose id ends in -4 (src/main.js:359) and
//      picks its wording on `nextLevel(id)` alone, so 8-4 — the one castle with
//      no next level — fell into the "the game is yet to be completely built"
//      branch and Mario never saw the Princess at all.
//
//   2. The original then starts a SECOND QUEST at 1-1, harder. The engine has
//      the seam for it already: `secondaryHardMode(levelId, primary)` in
//      src/game/world.js takes a `primary` argument that nothing has ever set,
//      and `world.loadLevel` reads it off `this.primaryHardMode` on every load.
//
// This module is PURE — no DOM, no canvas, no engine instance at import time —
// so the wording, the ROM timings and the enemy rewrite can all be tested in
// plain Node. src/wings/peach-ending.js is the half that needs a drawing
// context; it takes its words and its clock from here.
//
// NO ENGINE FILE IS EDITED by any of this. The two hooks are an instance-method
// wrap (`world._spawnLevelEntities`) and a property assignment
// (`world.primaryHardMode`), the same technique guardWorld() in
// src/wings/sanctuary.js and the toolbelt seeder already use.

import { PHYS } from '../game/physics.js';

// ---------------------------------------------------------------------------
// What the Princess actually says
// ---------------------------------------------------------------------------

// Straight off reference/smbdis.asm, not off memory. The messages are VRAM
// buffer records: a two-byte address, a length, then the characters. The
// address is in NAMETABLE 1 ($2400-$27ff), so the row and column below are
// (addr - $2400) / 32 and % 32 — which is why "THANK YOU MARIO!" lands at
// row 10 rather than somewhere that looks centred by accident.
//
//   MarioThanksMessage    asm:2306  $2548 -> row 10 col  8
//   PrincessSaved1        asm:2333  $25a7 -> row 13 col  7
//   PrincessSaved2        asm:2341  $25e3 -> row 15 col  3
//   WorldSelectMessage1   asm:2350  $264a -> row 18 col 10
//   WorldSelectMessage2   asm:2357  $2688 -> row 20 col  8
//
// `at` is the frame the line appears on, counted from the first one. The
// original does not print them together: PrintVictoryMessages (asm:2694... no,
// asm:1176-1226) adds 4 to SecondaryMsgCounter every frame and carries into
// PrimaryMsgCounter, so ONE COUNTER STEP IS 64 FRAMES, and on world 8 the
// counter prints at 0, 3, 4, 5 and 6 (steps 1 and 2 are a deliberate pause
// while Mario is still being thanked). Hence 0, 192, 256, 320, 384.
//
// NOTE the split: it is "PUSH BUTTON B" and "TO SELECT A WORLD" on two lines,
// two separate messages a counter step apart. Written as one line it would
// appear a whole second too early and in the wrong place.
export const PRINCESS_MESSAGES = [
  { text: 'THANK YOU MARIO!', row: 10, col: 8, at: 0 },
  { text: 'YOUR QUEST IS OVER.', row: 13, col: 7, at: 192 },
  { text: 'WE PRESENT YOU A NEW QUEST.', row: 15, col: 3, at: 256 },
  { text: 'PUSH BUTTON B', row: 18, col: 10, at: 320 },
  { text: 'TO SELECT A WORLD', row: 20, col: 8, at: 384 },
];

// Toad's, for the castles that are not the last one — recorded here so the two
// scenes can be told apart at a glance and never merged again. This is what
// upstream already prints (src/i18n.js thankYou/anotherCastleA/anotherCastleB);
// nothing in this module draws it.
//
//   MushroomRetainerSaved asm:2322  $25c5 -> row 14 col 5, then $2605 -> row 16 col 5
//
// ONE message with two lines, printed at counter step 2 — so 128 frames after
// the thanks, where the Princess's first extra line waits 192.
export const RETAINER_MESSAGES = [
  { text: 'THANK YOU MARIO!', row: 10, col: 8, at: 0 },
  { text: 'BUT OUR PRINCESS IS IN', row: 14, col: 5, at: 128 },
  { text: 'ANOTHER CASTLE!', row: 16, col: 5, at: 128 },
];

// VictoryMusic is queued on the SAME counter step as "YOUR QUEST IS OVER."
// (asm:1204-1207, `cpy #$03 / bne PrintMsg`), and only on world 8. The thanks
// therefore plays over the castle-clear fanfare and the ending theme starts
// under the Princess's own line.
export const VICTORY_MUSIC_AT = 192;

// After the last message the counter reaches 7 and PlayerEndWorld sets
// WorldEndTimer = 6 (asm:1224-1225). WorldEndTimer is $07a1, inside the
// INTERVAL timer block, and IntervalTimerControl reloads with $14 = 20
// (asm:790-794) — so an interval timer ticks once every 21 frames, not every
// frame. 6 * 21 = 126, and the whole scene is 448 + 126 frames.
export const PRINCESS_HOLD = 448 + 126;

// ---------------------------------------------------------------------------
// The second quest's enemies
// ---------------------------------------------------------------------------

// PrimaryHardMode has SIX read sites in the disassembly. What each one does and
// where it stands here:
//
//   asm:2694  InitializeArea       SecondaryHardMode is forced on in every
//                                  world, not just from 5-3 -> handled by the
//                                  engine's own secondaryHardMode(id, primary)
//   asm:7992  enemy parser         a goomba record becomes a buzzy beetle
//   asm:8168  InitNormalEnemy      walk speed $f8 -> $f4, i.e. 1.5x
//   asm:8764  HandleGroupEnemies   the same goomba swap for group records --
//                                  MOOT: agent-reports/hard-mode.md establishes
//                                  that the ROM's data contains no group record
//                                  ($37-$3e) anywhere in the game
//   asm:9348  RevivedXSpeed        a thawed enemy comes back faster
//   asm:11508 RevivalRateData      a stomped shell revives sooner
//
// The last two are not done: neither an unfreeze nor a shell revival exists on
// this engine's enemies to hang them off. See the report.

// Which enemies go through InitNormalEnemy, and therefore take the speed bump.
// The jump table at asm:8070-8078 routes ids $00-$02 (green koopa, buzzy) there
// directly, $03 (red koopa) via InitRedKoopa and $06 (goomba) via InitGoomba.
// A PARATROOPA DOES NOT: ids $0e/$0f/$10 have their own inits, so a spec with
// `winged` set is left alone. Nothing else in our level data is a walker.
const NORMAL_WALKERS = new Set(['goomba', 'buzzy', 'koopa']);

// $f8 -> $f4 is -8 -> -12 in the ROM's sixteenths of a pixel per frame, which
// is 0.5 -> 0.75 px/frame. Expressed as a ratio against PHYS.enemyWalkSpeed so
// that the one authoritative walk speed stays in src/game/physics.js.
export const SECOND_QUEST_WALK = 1.5;

export function isNormalWalker(spec) {
  return !!spec && NORMAL_WALKERS.has(spec.type) && !spec.winged;
}

// One enemy record, as the second quest's parser would have read it. Returns
// the SAME object when nothing changes, so an unchanged level costs no garbage
// and a caller can tell by identity whether anything happened.
export function hardenSpec(spec) {
  if (!isNormalWalker(spec)) return spec;
  // The swap is at PARSE time (asm:7989-7994), before InitEnemyObject runs, so
  // the buzzy beetle a goomba turns into is a real buzzy beetle in every
  // respect — fireproof, stompable into a shell — and it gets the buzzy's own
  // init. Ours does too, because the type is rewritten before world.spawn().
  const type = spec.type === 'goomba' ? 'buzzy' : spec.type;
  // An explicit speed on the record wins: the level data does not set one
  // today, but if it ever did it would be a deliberate override and not
  // something a difficulty flag should quietly multiply.
  const speed = spec.speed == null ? PHYS.enemyWalkSpeed * SECOND_QUEST_WALK : spec.speed;
  return { ...spec, type, speed };
}

export function hardenEntities(list) {
  if (!Array.isArray(list) || !list.length) return list;
  let changed = false;
  const out = list.map((s) => {
    const h = hardenSpec(s);
    if (h !== s) changed = true;
    return h;
  });
  return changed ? out : list;
}

// ---------------------------------------------------------------------------
// Hanging it on a live World
// ---------------------------------------------------------------------------

const GUARD = Symbol.for('wings.secondQuest');

// Take over the WORLD INSTANCE's `_spawnLevelEntities`, never src/game/world.js.
// The engine hands it the level object it is about to populate from, so the
// whole of the second quest's enemy rewrite is a copy of that object with a
// rewritten `entities` array — the level module itself is never mutated, which
// matters because src/data/levels/*.js are shared singletons and a first quest
// after a second one must get its goombas back.
//
// Gated at CALL time rather than install time so this can be installed once, on
// the overlay's hook list, and only bite once the quest is armed.
export function guardSecondQuest(world) {
  if (!world || typeof world._spawnLevelEntities !== 'function') return false;
  if (world[GUARD]) return false;
  const prev = world._spawnLevelEntities.bind(world);
  world[GUARD] = true;
  world._spawnLevelEntities = (lvl) => {
    if (!world.primaryHardMode || !lvl) return prev(lvl);
    const entities = hardenEntities(lvl.entities);
    return prev(entities === lvl.entities ? lvl : { ...lvl, entities });
  };
  return true;
}

// Turn the second quest on for every load from here. `world.primaryHardMode` is
// read by world.loadLevel (world.js:799) and by the guard above; nothing else
// in the engine looks at it, which is exactly why it was safe to leave as a
// seam. It is a property of the World instance, and startGame/endSession reuse
// one World for the whole session, so it survives the restart to 1-1 on its own.
export function armSecondQuest(world, quest = 2) {
  if (!world) return 1;
  world.primaryHardMode = true;
  world.quest = quest;
  return world.quest;
}

// A run that ended in a game over is over: the next game from the title is
// quest 1 again. The original agrees — WorldSelectEnableFlag, which is what
// sets PrimaryHardMode at asm:1045, is only ever set by finishing 8-4.
export function disarmSecondQuest(world) {
  if (!world) return 1;
  world.primaryHardMode = false;
  world.quest = 1;
  return world.quest;
}

export default guardSecondQuest;
