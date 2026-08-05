#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Decode the extracted SMB area data into positions we can author levels from.
//
//   node tools/smb-decode.mjs 1-1        one level
//   node tools/smb-decode.mjs --all      every level
//
// The formats below are taken from the disassembly's own parsers rather than
// from any second-hand description: ProcessEnemyData / PositionEnemyObj for the
// enemy stream, and ProcessAreaData / DecodeAreaData for the object stream.
//
// ENEMY STREAM (2 bytes, sometimes 3)
//   byte0  bits 7-4  column within the page
//          bits 3-0  row; $0f is a page-control command, $0e a 3-byte special
//   byte1  bit 7     advance to the next page before placing
//          bit 6     hard-mode only (skipped on a first quest)
//          bits 5-0  enemy id
//
// OBJECT STREAM (2 bytes)
//   byte0  bits 7-4  column within the page
//          bits 3-0  row; $0d/$0e/$0f are commands rather than rows
//   byte1  bit 7     advance to the next page before placing
//          bits 6-0  object id and parameter
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = JSON.parse(readFileSync(join(ROOT, 'reference', 'smb-areas.json'), 'utf8'));

export const ENEMY_NAMES = {
  0x00: 'greenkoopa', 0x02: 'buzzy', 0x03: 'redkoopa', 0x05: 'hammerbro',
  0x06: 'goomba', 0x07: 'blooper', 0x08: 'bulletbill-frenzy', 0x09: 'tall',
  0x0a: 'greycheep', 0x0b: 'redcheep', 0x0c: 'podoboo', 0x0d: 'piranha',
  0x0e: 'greenparatroopa-jump', 0x0f: 'redparatroopa', 0x10: 'greenparatroopa-fly',
  0x11: 'lakitu', 0x12: 'spiny', 0x14: 'flyingcheep', 0x15: 'bowserflame',
  0x16: 'fireworks', 0x17: 'bbill-ccheep-frenzy', 0x18: 'stop-frenzy',
  // $1b-$1f are FIREBARS, not enemy groups: the enemy init table puts
  // InitShortFirebar at $1b-$1e and InitLongFirebar at $1f (smbdis.asm:8100-8104),
  // and FirebarSpinSpdData/FirebarSpinDirData index off id - $1b. These carried
  // "goomba-group-3-row10"-style labels for a long time, which is a lie this
  // decode tells to anything that reads it — an inventory of the enemy stream
  // came back claiming trios of goombas in castles that have none. The real
  // groups are $37-$3e and are handled by groupOf() in smb-build.mjs.
  0x1b: 'firebar-6-cw', 0x1c: 'firebar-6-cw-fast',
  0x1d: 'firebar-6-ccw', 0x1e: 'firebar-6-ccw-fast', 0x1f: 'firebar-12-cw',
  0x2d: 'bowser', 0x2e: 'powerup', 0x2f: 'vine', 0x30: 'flagpole',
  0x31: 'starflag', 0x32: 'jumpspring', 0x33: 'bulletbill-cannon', 0x35: 'toad',
};

// Walk the enemy stream the way CheckRightBounds/CheckPageCtrlRow do
// (smbdis.asm:7905-7940). The order of the three steps is what matters:
//
//   1. the second byte's MSB advances the page — this is done for EVERY record,
//      including the three-byte row-$0e ones, BEFORE the row is looked at;
//   2. only then is row $0f treated as a page-select;
//   3. the page select latch is cleared after each record that is stepped over.
//
// Getting (1) wrong costs 16 columns per row-$0e record whose second byte has
// bit 7 set, and every enemy after it lands that much too early.
function walkEnemies(bytes, onEnemy, onPointer) {
  let page = 0;
  let pageSel = false;
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 === 0xff) break;
    const row = b0 & 0x0f;
    const b1 = bytes[i + 1];

    if (b1 & 0x80 && !pageSel) {
      page += 1;
      pageSel = true;
    }
    if (row === 0x0f && !pageSel) {
      // Page control: the second byte IS the page, and nothing is spawned.
      page = b1 & 0x3f;
      pageSel = true;
      i += 2;
      continue;
    }
    const x = page * 16 + (b0 >> 4);
    if (row === 0x0e) {
      // Three-byte area pointer, not an enemy: second byte is the destination
      // area pointer, third is world number in the 3 MSB and entrance page in
      // the 5 LSB.
      const b2 = bytes[i + 2];
      onPointer({ x, pointer: b1, world: b2 >> 5, entrancePage: b2 & 0x1f });
      pageSel = false;
      i += 3;
      continue;
    }
    const id = b1 & 0x3f;
    onEnemy({
      x,
      y: row,
      id,
      name: ENEMY_NAMES[id] || `id$${id.toString(16)}`,
      hardOnly: (b1 & 0x40) !== 0,
    });
    pageSel = false;
    i += 2;
  }
}

export function decodeEnemies(bytes) {
  const out = [];
  walkEnemies(bytes, (e) => out.push(e), () => {});
  return out;
}

// The row-$0e records: where a pipe entered near this column sends you, and at
// which page of the destination you come out. A record is read when the screen's
// right edge reaches it, so it is armed roughly nine columns before the player
// gets there — which is why each of 8-4's records sits a few columns past the
// pipe it governs.
export function decodePointers(bytes) {
  const out = [];
  walkEnemies(bytes, () => {}, (p) => out.push(p));
  return out;
}

function report(levelId) {
  const entry = REF.levelMap[levelId];
  if (!entry) {
    console.log(`unknown level ${levelId}`);
    return;
  }
  const area = REF.areas[entry.area];
  const enemies = decodeEnemies(area.enemyBytes);
  console.log(`\n${levelId}  (${entry.area})`);
  console.log(
    '  enemies: ' +
      enemies.map((e) => `${e.name}@${e.x},${e.y}${e.hardOnly ? '*' : ''}`).join('  ')
  );
}

// Only report when run directly; importing this module must stay silent.
if (process.argv[1] && process.argv[1].endsWith('smb-decode.mjs')) {
  const args = process.argv.slice(2);
  const ids = args.includes('--all')
    ? Object.keys(REF.levelMap).filter((k) => !k.endsWith('-sub'))
    : args.filter((a) => !a.startsWith('--'));
  for (const id of ids.length ? ids : ['1-1']) report(id);
}

// --- object stream -------------------------------------------------------
// Index = row-dependent offset + id, exactly as the parser computes it:
//   rows 0-11, (b1 & $70) == 0 : small object, offset 22, id = b1 & $0f
//   rows 0-11, otherwise       : large object, offset 0,  id = (b1 & $70) >> 4
//                                ($70 with d3 set is a warp pipe, id 0)
//   row 12                     : offset 8,  id = (b1 & $70) >> 4
//   row 15                     : offset 16, id = (b1 & $70) >> 4
//   row 13, d6 set             : offset 34, id = b1 & $3f
//   row 13, d6 clear           : page control, page = b1 & $1f
//   row 14                     : offset 46 (alter area attributes)
export const OBJECTS = [
  'VerticalPipe(warp)', 'AreaStyleObject', 'RowOfBricks', 'RowOfSolidBlocks',
  'RowOfCoins', 'ColumnOfBricks', 'ColumnOfSolidBlocks', 'VerticalPipe',
  'Hole_Empty', 'PulleyRope', 'Bridge_High', 'Bridge_Middle', 'Bridge_Low',
  'Hole_Water', 'QuestionBlockRow_High', 'QuestionBlockRow_Low',
  'EndlessRope', 'BalancePlatRope', 'CastleObject', 'StaircaseObject',
  'ExitPipe', 'FlagBalls_Residual',
  'QBlock(powerup)', 'QBlock(coin)', 'QBlock(hidden coin)', 'Hidden1Up',
  'Brick(powerup)', 'Brick(vine)', 'Brick(star)', 'Brick(coins)', 'Brick(1up)',
  'WaterPipe', 'EmptyBlock', 'Jumpspring',
  'IntroPipe', 'Flagpole', 'Axe', 'Chain', 'CastleBridge',
  'ScrollLockWarp', 'ScrollLock', 'ScrollLock', 'Frenzy(cheeps)',
  'Frenzy(bullets)', 'Frenzy(stop)', 'LoopCmd', 'AlterAreaAttributes',
];

export function decodeObjects(bytes) {
  const out = [];
  let page = 0;
  let pageSel = false;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const b0 = bytes[i];
    if (b0 === 0xfd) break;
    const b1 = bytes[i + 1];
    const row = b0 & 0x0f;

    if (b1 & 0x80 && !pageSel) {
      page += 1;
      pageSel = true;
    }

    if (row === 0x0d && !(b1 & 0x40)) {
      if (!pageSel) {
        page = b1 & 0x1f;
        pageSel = true;
      }
      continue;
    }

    let index;
    let param = b1 & 0x0f;
    if (row === 0x0e) index = 46;
    else if (row === 0x0d) index = 34 + (b1 & 0x3f);
    else if (row === 0x0c) index = 8 + ((b1 & 0x70) >> 4);
    else if (row === 0x0f) index = 16 + ((b1 & 0x70) >> 4);
    else if ((b1 & 0x70) === 0) index = 22 + (b1 & 0x0f);
    else index = (b1 & 0x70) === 0x70 && b1 & 0x08 ? 0 : (b1 & 0x70) >> 4;

    out.push({
      x: page * 16 + (b0 >> 4),
      row,
      index,
      param,
      b1, // raw, because AlterAreaAttributes needs d6 and d5-d4 as well as the low nybble
      name: OBJECTS[index] || `obj#${index}`,
    });
    pageSel = false;
  }
  return out;
}
