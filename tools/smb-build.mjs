#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Render a decoded SMB area into this engine's tile grammar.
//
//   node tools/smb-build.mjs 1-1 --check    render and compare with ours
//   node tools/smb-build.mjs 2-1            print the tile rows
//
// Row mapping: ours = SMB + 2. The original's playfield is 13 rows with the
// status bar above it; ours is 15 with the floor at 13-14. Confirmed against
// all four of 1-1's pipes (SMB rows 9/8/7/7 -> ours 11/10/9/9) and against its
// three holes, whose widths are param + 1.
//
// SOLIDITY. The parser writes metatiles into a 13-row buffer and only copies a
// metatile into the collision buffer when it clears the bar for its top two
// bits: $10 at attribute 0, $51 at attribute 1, $88 at attribute 2, and $c0 at
// attribute 3 (BlockBuffLowBounds). That single rule is why tree trunks, bridge
// railings, chains, ropes, castle walls and every piece of scenery below are
// drawn but never collided with, and it decides which of them we emit as decor.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeObjects, decodeEnemies } from './smb-decode.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF = JSON.parse(readFileSync(join(ROOT, 'reference', 'smb-areas.json'), 'utf8'));

const H = 15;
const ROW = (r) => r + 2; // SMB row -> ours
const FLOOR_TOP = 13;

// Enemy ids -> our entity types. The group ids ($37-$3e) expand to two or three
// of the same enemy, which is what DoGroup does in the original.
const ENEMY_MAP = {
  0x00: 'koopa:green', 0x02: 'buzzy', 0x03: 'koopa:red', 0x05: 'hammerbro',
  0x06: 'goomba', 0x07: 'blooper', 0x0a: 'cheep:grey', 0x0b: 'cheep:red',
  0x0c: 'podoboo', 0x0d: 'piranha', 0x0e: 'koopa:green', 0x0f: 'koopa:red',
  0x10: 'koopa:green', 0x11: 'lakitu', 0x12: 'spiny', 0x2d: 'bowser',
};
// HandleGroupEnemies, exactly: subtract $37, and the three bits that remain say
// everything. Below 4 the group is goombas, 4 and up green koopas; d1 picks the
// row (clear = y $b0 = SMB row 11, set = y $70 = row 7); d0 picks the count
// (clear = 2, set = 3). The previous table had the wrong ids, the wrong counts
// and the wrong rows, so every grouped enemy in the game was being dropped.
function groupOf(id) {
  if (id < 0x37 || id > 0x3e) return null;
  const v = id - 0x37;
  return {
    type: v < 4 ? 'goomba' : 'koopa:green',
    row: v & 0x02 ? 7 : 11,
    count: v & 0x01 ? 3 : 2,
  };
}

// $1b-$1f are FIREBARS, not enemy groups — the enemy init table puts
// InitShortFirebar at $1b-$1e and InitLongFirebar at $1f. FirebarSpinSpdData
// and FirebarSpinDirData, indexed by id - $1b, give the rest. Speeds are $28
// and $38, so the fast ones run 1.4x; direction $10 means anticlockwise. The
// long firebar is a short one with a second half duplicated onto it.
const FIREBARS = {
  0x1b: { count: 6, speed: 1, dir: 1 },
  0x1c: { count: 6, speed: 1.4, dir: 1 },
  0x1d: { count: 6, speed: 1, dir: -1 },
  0x1e: { count: 6, speed: 1.4, dir: -1 },
  0x1f: { count: 12, speed: 1, dir: 1 },
};

// Moving lifts are enemy-stream objects, not area objects: entries $24-$2c of
// the enemy init table are the balance, vertical, large up/down, horizontal,
// drop and small up/down lift platforms. Without them 2-4's rope shaft is an
// unjumpable void.
const LIFTS = {
  0x24: { mode: 'pulley', tiles: 3 },
  0x25: { mode: 'vertical', tiles: 3 },
  0x26: { mode: 'vertical', tiles: 4, dir: -1 },
  0x27: { mode: 'vertical', tiles: 4, dir: 1 },
  0x28: { mode: 'horizontal', tiles: 3 },
  0x29: { mode: 'fall', tiles: 3 },
  0x2a: { mode: 'horizontal', tiles: 3 },
  0x2b: { mode: 'vertical', tiles: 2, dir: -1 },
  0x2c: { mode: 'vertical', tiles: 2, dir: 1 },
};

// --- scenery tables, copied byte for byte from the disassembly --------------
// BackSceneryData is three 48-byte sets, indexed by (page mod 3) * 16 plus the
// set's offset plus the column within the page.
const BSCENE_OFF = [0x00, 0x30, 0x60];
// prettier-ignore
const BACK_SCENERY_DATA = [
  0x93,0x00,0x00,0x11,0x12,0x12,0x13,0x00, 0x00,0x51,0x52,0x53,0x00,0x00,0x00,0x00,
  0x00,0x00,0x01,0x02,0x02,0x03,0x00,0x00, 0x00,0x00,0x00,0x00,0x91,0x92,0x93,0x00,
  0x00,0x00,0x00,0x51,0x52,0x53,0x41,0x42, 0x43,0x00,0x00,0x00,0x00,0x00,0x91,0x92,

  0x97,0x87,0x88,0x89,0x99,0x00,0x00,0x00, 0x11,0x12,0x13,0xa4,0xa5,0xa5,0xa5,0xa6,
  0x97,0x98,0x99,0x01,0x02,0x03,0x00,0xa4, 0xa5,0xa6,0x00,0x11,0x12,0x12,0x12,0x13,
  0x00,0x00,0x00,0x00,0x01,0x02,0x02,0x03, 0x00,0xa4,0xa5,0xa5,0xa6,0x00,0x00,0x00,

  0x11,0x12,0x12,0x13,0x00,0x00,0x00,0x00, 0x00,0x00,0x00,0x9c,0x00,0x8b,0xaa,0xaa,
  0xaa,0xaa,0x11,0x12,0x13,0x8b,0x00,0x9c, 0x9c,0x00,0x00,0x01,0x02,0x03,0x11,0x12,
  0x12,0x13,0x00,0x00,0x00,0x00,0xaa,0xaa, 0x9c,0xaa,0x00,0x8b,0x00,0x01,0x02,0x03,
];
// prettier-ignore
const BACK_SCENERY_MT = [
  0x80,0x83,0x00, 0x81,0x84,0x00, 0x82,0x85,0x00,   // cloud left / middle / right
  0x02,0x00,0x00, 0x03,0x00,0x00, 0x04,0x00,0x00,   // bush left / middle / right
  0x00,0x05,0x06, 0x07,0x06,0x0a, 0x00,0x08,0x09,   // mountain left / middle / right
  0x4d,0x00,0x00,                                   // fence
  0x0d,0x0f,0x4e, 0x0e,0x4e,0x4e,                   // tall tree, short tree
];
// prettier-ignore
const FORE_SCENERY = [
  [0x86,0x87,0x87,0x87,0x87,0x87,0x87,0x87,0x87,0x87,0x87,0x69,0x69], // in water
  [0x00,0x00,0x00,0x00,0x00,0x45,0x47,0x47,0x47,0x47,0x47,0x00,0x00], // wall
  [0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x86,0x87], // over water
];

// Which of our decor chars stands in for each background-scenery metatile.
// None of these clears its block-buffer bar, so none of them is solid.
function decorChar(mt) {
  if (mt >= 0x80 && mt <= 0x85) return 'c'; // cloud
  if (mt >= 0x02 && mt <= 0x04) return 'b'; // bush
  if (mt >= 0x05 && mt <= 0x0a) return 'h'; // mountain
  if (mt === 0x0d || mt === 0x0e || mt === 0x0f || mt === 0x4e) return 't'; // tree
  if (mt === 0x4d) return 'b'; // DEVIATION: no fence in our legend, use a bush
  return null;
}

// StaircaseObject is not a triangle measured off a floor. It renders ONE column
// per level column out of these two tables, with StaircaseControl counting down
// from 9. Row + height is 10 in every single entry, so the foot of every step
// is SMB row 10 — an absolute row. That is what lets 2-3's staircase, which
// stands over open water with no floor under it at all, still meet the bridge.
const STAIR_ROW = [0x03, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a];
const STAIR_HEIGHT = [0x07, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01, 0x00];

// Object names that fell through the renderer with nothing to show for it.
// 2-2 shipped without its exit pipe because WaterPipe was quietly swallowed
// here, so silence is not acceptable: `--unhandled` turns this into a report.
export const unhandled = new Map();

// The three Frenzy objects are enemy spawners, not tiles.
const FRENZY_KIND = { 'Frenzy(cheeps)': 'cheep', 'Frenzy(bullets)': 'bullet', 'Frenzy(stop)': 'stop' };

export function buildArea(levelId, opts = {}) {
  // A raw area name is accepted as well as a level id, so the shared sub-areas
  // — the coin rooms, the warp zones — can be rendered from their own data
  // rather than hand-drawn.
  const entry = REF.levelMap[levelId];
  const area = entry ? REF.areas[entry.area] : REF.areas[levelId];
  if (!area) throw new Error(`no level or area named ${levelId}`);
  const objs = decodeObjects(area.objectBytes);
  const enemies = decodeEnemies(area.enemyBytes);

  const terrain = area.header[1] & 0x0f;
  // Header byte 1's two MSB pick the AreaStyleObject sub-routine; the value 3
  // means the cloud-block override instead and leaves the style at 0.
  const styleBits = (area.header[1] & 0xc0) >> 6;
  const areaStyle = styleBits === 3 ? 0 : styleBits;
  const bgScenery0 = (area.header[1] & 0x30) >> 4;
  const fore0 = (area.header[0] & 0x07) < 4 ? area.header[0] & 0x07 : 0;

  const width = Math.max(...objs.map((o) => o.x)) + 8;
  const g = Array.from({ length: H }, () => new Array(width).fill('.'));
  const put = (x, y, ch) => {
    if (x >= 0 && x < width && y >= 0 && y < H) g[y][x] = ch;
  };
  const fillCol = (x, y0, y1, ch) => {
    for (let y = y0; y <= y1; y++) put(x, y, ch);
  };

  // TerrainRenderBits, verbatim: two bytes forming a row mask over SMB rows
  // 0-15, bit i of the first byte being row i and bit i of the second row 8+i.
  // Terrain 1 is "no ceiling, floor 2" and comes out as rows 11-12, which is
  // our 13-14 — the floor every hand-authored level already uses.
  const TERRAIN = [
    [0b00000000, 0b00000000], [0b00000000, 0b00011000], [0b00000001, 0b00011000],
    [0b00000111, 0b00011000], [0b00001111, 0b00011000], [0b11111111, 0b00011000],
    [0b00000001, 0b00011111], [0b00000111, 0b00011111], [0b00001111, 0b00011111],
    [0b10000001, 0b00011111], [0b00000001, 0b00000000], [0b10001111, 0b00011111],
    [0b11110001, 0b00011111], [0b11111001, 0b00011000], [0b11110001, 0b00011000],
    [0b11111111, 0b00011111],
  ];

  // None of these three is one setting for the level. AlterAreaAttributes (row
  // 14) rewrites TerrainControl and BackgroundScenery from its own column
  // onward when d6 is clear, and ForegroundScenery when d6 is set. That is what
  // makes 2-3 a bridge level — terrain 0, no floor at all, from column 6 — and
  // what opens and closes the lava under 2-4.
  const schedule = [{ x: 0, t: terrain, bg: bgScenery0, fore: fore0 }];
  for (const o of objs) {
    if (o.index !== 46) continue;
    const prev = schedule[schedule.length - 1];
    // AlterAreaAttributes takes effect on the NEXT column, not its own.
    // AreaParserCore renders scenery and terrain into the metatile buffer for a
    // column and only THEN calls ProcessAreaData for it, so the column carrying
    // the attribute is already drawn with the old TerrainControl. Applying it a
    // column early walls off the exit pipe of UndergroundArea3's page-2 coin
    // room behind the solid terrain its own AlterAreaAttributes raises.
    const at = o.x + 1;
    if (o.b1 & 0x40) {
      const f = o.b1 & 0x07;
      schedule.push({ x: at, t: prev.t, bg: prev.bg, fore: f < 4 ? f : 0 });
    } else {
      schedule.push({ x: at, t: o.b1 & 0x0f, bg: (o.b1 & 0x30) >> 4, fore: prev.fore });
    }
  }
  const attrAt = (x) => {
    let s = schedule[0];
    for (const c of schedule) {
      if (c.x > x) break;
      s = c;
    }
    return s;
  };
  const terrainAt = (x) => attrAt(x).t;

  // AreaParserCore's order is background scenery, then foreground scenery over
  // it, then terrain over that, and the area objects last — each pass is free
  // to paint over the one before it, so we follow the same order.
  for (let x = 0; x < width; x++) {
    const bg = attrAt(x).bg;
    if (!bg) continue;
    const v = BACK_SCENERY_DATA[(Math.floor(x / 16) % 3) * 16 + BSCENE_OFF[bg - 1] + (x % 16)];
    if (!v) continue;
    let mtx = ((v & 0x0f) - 1) * 3;
    let r = v >> 4;
    for (let i = 0; i < 3 && r < 0x0b; i++, mtx++, r++) {
      const ch = decorChar(BACK_SCENERY_MT[mtx]);
      if (ch) put(x, ROW(r), ch);
    }
  }

  const liquidTop = opts.theme === 'castle' ? 'L' : '~';
  const liquidBody = opts.theme === 'castle' ? 'L' : '_';
  for (let x = 0; x < width; x++) {
    const fore = attrAt(x).fore;
    if (!fore) continue;
    const data = FORE_SCENERY[fore - 1];
    for (let r = 0; r <= 12; r++) {
      const mt = data[r];
      if (!mt) continue;
      // $69 is the water-area terrain metatile and the only solid one here.
      if (mt === 0x69) put(x, ROW(r), '#');
      else if (mt === 0x86) put(x, ROW(r), liquidTop);
      else if (mt === 0x87) put(x, ROW(r), liquidBody);
      // DEVIATION: $45/$47 is the decorative castle wall behind the player and
      // this engine has no non-solid wall tile, so it is left out.
    }
  }

  // CloudTypeOverride: when the header's two MSB are 3 the terrain metatile
  // becomes $88, the cloud block, instead of the area type's own ground. That
  // is what the coin-heaven areas above the beanstalks are made of, and $88
  // clears its block-buffer bar, so it is solid and you stand on it — 'O',
  // solid exactly like 'B', not a one-way platform.
  //
  // In a cloud level the BRICK is the same metatile: BrickMetatiles is
  // `$22, $51, $52, $52` plus a fifth entry `$88` that RowOfBricks picks when
  // the override is set. So one tile is the entire contents of these areas.
  const groundChar = styleBits === 3 ? 'O' : '#';
  for (let x = 0; x < width; x++) {
    const bits = TERRAIN[terrainAt(x)] || TERRAIN[1];
    const solidRow = (r) => (r < 8 ? (bits[0] >> r) & 1 : (bits[1] >> (r - 8)) & 1);
    for (let r = 0; r <= 12; r++) if (solidRow(r)) put(x, ROW(r), groundChar);
  }

  const meta = {
    pipes: [], flagpole: null, castle: null, axe: null, springs: [],
    vine: null, warpPipe: null, waterPipe: null, sidePipes: [],
  };
  const contents = [];
  const frenzies = [];
  const pipePlants = [];

  for (const o of objs) {
    const x = o.x;
    const y = ROW(o.row);
    const n = o.param;
    switch (o.name) {
      case 'VerticalPipe':
      case 'VerticalPipe(warp)': {
        // GetPipeHeight: the height is the low THREE bits of the parameter, and
        // the pipe is that many rows below its lip. Every floor-standing pipe
        // works out to bottom at SMB row 10, which is why filling to the floor
        // looked right, but the parameter is the authority.
        const top = y;
        const bottom = Math.min(ROW(12), top + (n & 0x07));
        put(x, top, '['); put(x + 1, top, ']');
        for (let r = top + 1; r <= bottom; r++) { put(x, r, '{'); put(x + 1, r, '}'); }
        meta.pipes.push({ x, top, warp: o.name.includes('warp') });
        if (o.name.includes('warp')) meta.warpPipe = { x, top };
        // The plant belongs to the PIPE, not to the enemy stream — VerticalPipe
        // writes it into the enemy buffer itself, centred on the pipe. The one
        // exception is hard-coded: `lda AreaNumber / ora WorldNumber / beq
        // DrawPipe` means world 1-1 never gets a piranha plant, on any pipe.
        if (levelId !== '1-1') pipePlants.push({ type: 'piranha', x: x + 0.5, y: top });
        break;
      }
      // RenderSidewaysPipe: four columns, with the mouth on the LEFT (the parts
      // are stored backwards horizontally) and a vertical shaft above the last
      // two columns running from the top of the screen down. $05 is the shaft
      // length, param - 2, so the pipe's own two rows are param-1 and param.
      case 'ExitPipe':
      case 'IntroPipe': {
        const shaftLen = n - 2;
        const top = ROW(shaftLen + 1);
        for (let i = 0; i <= 3; i++) {
          const ch = i === 0 ? '<' : i === 3 ? '>' : '-';
          put(x + i, top, ch);
          put(x + i, top + 1, ch);
        }
        for (let r = ROW(0); r < top; r++) { put(x + 2, r, '{'); put(x + 3, r, '}'); }
        meta.sidePipes.push({ x, top });
        break;
      }
      // RowOfBricks, and ONLY RowOfBricks, takes the cloud override:
      // `lda CloudTypeOverride / beq DrawBricks / ldy #$04` picks
      // BrickMetatiles' fifth entry, which is $88 — the same cloud block the
      // terrain uses. ColumnOfBricks is explicitly exempt ("no cloud override
      // as for row"), so it stays a brick even up here.
      case 'RowOfBricks':
        for (let i = 0; i <= n; i++) put(x + i, y, styleBits === 3 ? 'O' : '=');
        break;
      case 'RowOfSolidBlocks': for (let i = 0; i <= n; i++) put(x + i, y, 'B'); break;
      case 'RowOfCoins': for (let i = 0; i <= n; i++) put(x + i, y, 'o'); break;
      case 'ColumnOfBricks': fillCol(x, y, Math.min(ROW(12), y + n), '='); break;
      case 'ColumnOfSolidBlocks': fillCol(x, y, Math.min(ROW(12), y + n), 'B'); break;
      case 'QBlock(powerup)': put(x, y, 'M'); break;
      case 'QBlock(coin)': put(x, y, '?'); break;
      case 'QBlock(hidden coin)': put(x, y, 'C'); break;
      case 'Hidden1Up': put(x, y, '1'); break;
      case 'Brick(powerup)': put(x, y, '='); contents.push({ x, y, item: 'power' }); break;
      case 'Brick(star)': put(x, y, '='); contents.push({ x, y, item: 'star' }); break;
      case 'Brick(coins)': put(x, y, '='); contents.push({ x, y, item: 'coin', count: 10 }); break;
      case 'Brick(1up)': put(x, y, '='); contents.push({ x, y, item: '1up' }); break;
      case 'Brick(vine)': put(x, y, 'v'); meta.vine = { x, y }; break;
      case 'EmptyBlock': put(x, y, 'U'); break;
      case 'QuestionBlockRow_High': for (let i = 0; i <= n; i++) put(x + i, ROW(3), '?'); break;
      case 'QuestionBlockRow_Low': for (let i = 0; i <= n; i++) put(x + i, ROW(7), '?'); break;
      case 'Hole_Empty': for (let i = 0; i <= n; i++) fillCol(x + i, FLOOR_TOP, H - 1, '.'); break;
      case 'Hole_Water':
        // Waves on SMB row 10, water under them to the bottom of the buffer.
        // In a castle the same two metatiles are lava — it is the palette that
        // differs, not the tiles, which is why 1-4's moat has to be lethal.
        for (let i = 0; i <= n; i++) {
          put(x + i, ROW(10), liquidTop);
          fillCol(x + i, ROW(11), H - 1, liquidBody);
        }
        break;
      // A bridge's row nybble is where its RAILING goes, and the railing is
      // metatile $0b, below the block buffer's bar — you walk straight through
      // it. The deck you actually stand on is the row BELOW that.
      case 'Bridge_High': for (let i = 0; i <= n; i++) put(x + i, ROW(7), 'B'); break;
      case 'Bridge_Middle': for (let i = 0; i <= n; i++) put(x + i, ROW(8), 'B'); break;
      case 'Bridge_Low': for (let i = 0; i <= n; i++) put(x + i, ROW(10), 'B'); break;
      case 'StaircaseObject':
        for (let i = 0; i <= n; i++) {
          const s = Math.max(0, 8 - i);
          fillCol(x + i, ROW(STAIR_ROW[s]), ROW(STAIR_ROW[s] + STAIR_HEIGHT[s]), 'S');
        }
        break;
      case 'AreaStyleObject': {
        if (areaStyle === 2) {
          // BulletBillCannon: barrel, then neck and base until the length runs out.
          put(x, y, 'K');
          for (let r = y + 1; r <= Math.min(ROW(12), y + n); r++) put(x, r, 'k');
          break;
        }
        // TreeLedge and MushroomLedge are the same shape: a solid deck of
        // n + 1 tiles at the object's own row, with a NON-SOLID stem running
        // from just below the deck down to SMB row 12. The original draws that
        // stem with $4c (tree) or $4f/$50 (mushroom), all of which fall under
        // their attribute's block-buffer bar, so it is scenery and nothing else.
        for (let i = 0; i <= n; i++) put(x + i, y, '#');
        if (areaStyle === 1) {
          const stem = x + (n >> 1); // mushrooms grow one stem, under the middle
          for (let r = y + 1; r <= ROW(12); r++) put(stem, r, 't');
        } else {
          for (let i = 1; i < n; i++) {
            // trees grow a trunk under every column but the two end caps
            for (let r = y + 1; r <= ROW(12); r++) put(x + i, r, 't');
          }
        }
        break;
      }
      // One column, two rows ($6b over $6c), both solid — the sideways mouth
      // you swim into at the end of a water area. The original's own comment
      // calls the length "residual code, water pipe is 1 col thick".
      case 'WaterPipe':
        put(x, y, '<');
        put(x, y + 1, '<');
        meta.waterPipe = { x, top: y };
        break;
      case 'Jumpspring': meta.springs.push({ x, y }); break;
      case 'Flagpole': meta.flagpole = { x }; break;
      case 'CastleObject': if (x > 8) meta.castle = { x }; break;
      // ChainObj/AxeObj/CastleBridgeObj all ignore the row nybble and take
      // their row from C_ObjectRow: axe 6, chain 7, bridge 8. Of their three
      // metatiles only the bridge's ($89) clears its bar, so only it is solid.
      case 'Axe': put(x, ROW(6), 'a'); meta.axe = { x, y: ROW(6) }; break;
      case 'CastleBridge': for (let i = 0; i < 13; i++) put(x + i, ROW(8), 'B'); break;
      // Deliberately not rendered. Every one of these is either a spawner
      // handled through the entity list below, or a metatile that the original
      // draws but never puts in the block buffer, so it is pure decoration and
      // nothing in this engine can interact with it.
      case 'Frenzy(cheeps)':
      case 'Frenzy(bullets)':
      case 'Frenzy(stop)':
        // Spawners, not tiles: they become `frenzy` entities further down.
        frenzies.push({ type: 'frenzy', x, y: ROW(0), kind: FRENZY_KIND[o.name] });
        break;
      case 'PulleyRope':      // $41-$43, attribute 1 and under $51: scenery
      case 'EndlessRope':     // $40, likewise — the rope the lifts run on
      case 'BalancePlatRope': // $40/$44, likewise
      case 'Chain':           // $0c, attribute 0 and under $10: scenery
      case 'FlagBalls_Residual': // $6d, drawn by dead code in the original
        break;
      case 'ScrollLock':      // camera commands, no tiles at all
      case 'ScrollLockWarp':
      case 'LoopCmd':
      case 'AlterAreaAttributes': // consumed by the schedule above
        break;
      default:
        // Anything that reaches here is a piece of the level going silently
        // missing. `node tools/smb-build.mjs --unhandled` lists them.
        unhandled.set(o.name, (unhandled.get(o.name) || 0) + 1);
        break;
    }
  }

  // FlagpoleObject: ball on SMB row 0, shaft rows 1-9, and a solid block ($61)
  // on row 10 for the pole to stand on.
  if (meta.flagpole) {
    const fx = meta.flagpole.x;
    put(fx, ROW(0), '^');
    for (let r = 1; r <= 9; r++) put(fx, ROW(r), '|');
    put(fx, ROW(10), 'B');
  }

  const ents = [];
  const pairedBalance = new Set();
  for (const e of enemies) {
    if (e.hardOnly) continue;
    // DEVIATION: skip a walker that would spawn inside the opening screen.
    // 1-1's stream really does carry a goomba at column 6 — the decode is
    // anchored by the explicit page marker later in the same stream, and every
    // other enemy in it lands where the original's do. But the original plainly
    // has nothing there: you do not meet a goomba until around column 22, which
    // is the next record. Whatever suppresses it in the original (its spawner
    // walks the stream as the screen scrolls, and this object sits behind the
    // camera's start) is not something we reproduce, so the faithful byte gives
    // an unfaithful experience. One line to restore if that is ever understood.
    if (e.x < 8 && e.id < 0x37 && ENEMY_MAP[e.id]) continue;
    const gr = groupOf(e.id);
    if (gr) {
      // A group is NOT placed at its own column. HandleGroupEnemies takes the
      // base from ScreenRight_X_Pos — the screen's right edge at the frame the
      // record is consumed — and steps `clc / adc #$18`, 24 pixels, for each
      // member after the first (smbdis.asm:8774-8790). The record's column only
      // decides WHEN it fires: CheckRightExtBounds compares the column against
      // (ScreenRight_X_Pos + $30) & $f0, and since a column is always a multiple
      // of 16 that rounding cancels, so the record fires on the first frame
      // ScreenRight_X_Pos >= column*16 - 48 (asm:7906-7912, 7957-7962). The
      // nominal base is therefore three tiles LEFT of the column and the step is
      // one and a half tiles — the last member of a three lands on the column.
      //
      // Placing them at the column instead buried 23 of the game's 148 grouped
      // enemies in pipes, bricks and staircases; with this it is one. Both of
      // 1-2's opening koopas were in that 23: one inside the three-tall pillar
      // at column 31, one plugged into the one-tile slot at column 32.
      for (let i = 0; i < gr.count; i++)
        ents.push({ type: gr.type, x: e.x - 3 + i * 1.5, y: gr.row + 1 });
      continue;
    }
    const fb = FIREBARS[e.id];
    if (fb) {
      // A firebar's hub is its row exactly, +0. PositionEnemyObj sets
      // Enemy_Y_Position to row * 16 with NO status-bar offset, where
      // GetAreaObjYPosition adds 32 for objects — so an enemy row already sits
      // two rows lower than the same object row, and our +1 for walkers is that
      // offset minus the half tile CheckpointEnemyID adds to ids below $15.
      // Firebars are above $15, so they get neither. Checked against 1-4: every
      // firebar lands exactly on the EmptyBlock the original mounts it on
      // (enemy row 6 vs object row 4, both our row 6).
      ents.push({ type: 'firebar', x: e.x, y: e.y, ...fb });
      continue;
    }
    const lift = LIFTS[e.id];
    if (lift) {
      // PosPlatform nudges every lift 12 pixels right of its own column.
      const spec = { type: 'platform', x: e.x + 0.75, y: e.y + 1, ...lift, range: 64, speed: 0.75 };
      if (e.id === 0x24) {
        // A balance platform is HALF of a pair. The original writes both halves
        // into the enemy stream and links them by adjacency through
        // BalPlatformAlignment: the first gets alignment $ff, the second gets
        // the first's buffer offset. Our Platform in pulley mode spawns its own
        // partner, so emitting both halves would put four platforms on two
        // ropes. Emit the first, and take the rope's span and its balance point
        // from where the original actually put the second.
        if (pairedBalance.has(e)) continue;
        const mate = enemies.find(
          (o) => o !== e && o.id === 0x24 && o.x > e.x && !pairedBalance.has(o) && !o.hardOnly
        );
        if (mate) {
          pairedBalance.add(mate);
          spec.spacing = (mate.x - e.x) * 16;
          spec.anchorY = ((e.y + 1 + mate.y + 1) / 2) * 16;
        }
      }
      ents.push(spec);
      continue;
    }
    const t = ENEMY_MAP[e.id];
    if (!t) {
      // Same rule as the object stream: nothing disappears quietly. These are
      // the ids we know carry no entity of their own.
      //   $15 bowser's flame (our Bowser emits its own), $16 fireworks,
      //   $17/$18 frenzy control, $2e powerup (spawned by a
      //   block), $2f vine (spawned by a block), $30 flagpole flag and $31 star
      //   flag (drawn by the flagpole/castle objects), $33 cannon (drawn by
      //   AreaStyleObject), $34 warp-zone trigger, $35 toad.
      if (![0x15, 0x16, 0x17, 0x18, 0x2e, 0x2f, 0x30, 0x31, 0x33, 0x34, 0x35].includes(e.id)) {
        unhandled.set(`enemy $${e.id.toString(16)}`, (unhandled.get(`enemy $${e.id.toString(16)}`) || 0) + 1);
      }
      continue;
    }
    // Enemies map with +1, not the objects' +2: the original's enemy row is the
    // row the body occupies, so a row-11 koopa stands ON the floor rather than
    // half-buried in its top course.
    ents.push({ type: t, x: e.x, y: e.y + 1 });
  }
  ents.push(...frenzies);
  ents.push(...pipePlants);

  return { width, terrain, tiles: g.map((r) => r.join('')), meta, contents, entities: ents, objs, enemies };
}

// --- CLI ---
if (process.argv[1] && process.argv[1].endsWith('smb-build.mjs')) {
  const args = process.argv.slice(2);
  const id = args.find((a) => !a.startsWith('--')) || '1-1';
  if (args.includes('--unhandled')) {
    // EVERY AREA, BY NAME. This used to walk REF.levelMap, which is 36 entries
    // but names only 28 distinct areas — the shared coin rooms, both coin
    // heavens, the warp zone and the two bonus water areas were never audited,
    // while the output said "36 area(s)" and looked like full coverage. A
    // coverage tool that overstates its coverage is worse than none, because it
    // stops anyone looking. Count what was actually rendered, and say so.
    const named = args.filter((a) => !a.startsWith('--'));
    const all = named.length ? named : Object.keys(REF.areas);
    const seen = new Set();
    for (const key of all) {
      const entry = REF.levelMap[key];
      seen.add(entry ? entry.area : key);
      buildArea(key);
    }
    const cover = `${seen.size} distinct area(s) of ${Object.keys(REF.areas).length}`;
    if (!unhandled.size) {
      console.log(`no unhandled object types across ${cover}`);
    } else {
      console.log(`UNHANDLED object types across ${cover}:`);
      for (const [name, count] of [...unhandled].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${String(count).padStart(4)}  ${name}`);
      }
    }
    process.exit(unhandled.size ? 1 : 0);
  }
  const built = buildArea(id);
  if (args.includes('--check')) {
    const mod = await import(`../src/data/levels/${id}.js`);
    const ours = mod.default;
    console.log(`${id}: built width ${built.width}, ours ${ours.width}`);
    console.log(`  flagpole built ${built.meta.flagpole && built.meta.flagpole.x} / ours ${ours.flagpole && ours.flagpole.x}`);
    console.log(`  castle   built ${built.meta.castle && built.meta.castle.x} / ours ${ours.castle && ours.castle.x}`);
    const pipes = (rows) => {
      const out = [];
      rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === '[') out.push(x + ':' + y); }));
      return out.join(' ');
    };
    console.log(`  pipes built  ${pipes(built.tiles)}`);
    console.log(`  pipes ours   ${pipes(ours.tiles)}`);
  } else {
    built.tiles.forEach((r, i) => console.log(String(i).padStart(2), r));
    console.log('meta', JSON.stringify(built.meta));
    console.log('entities', built.entities.length);
  }

}

// --- the shared underground coin rooms -------------------------------------
// UndergroundArea3 is not one room. It is FIVE, laid end to end at pages 0, 2,
// 4, 6 and 8, each walled off by a ColumnOfBricks at its left edge and ended by
// an ExitPipe. Which one a level reaches is in that level's own enemy stream:
// a row-$0e record carries the area pointer, the world number and the ENTRANCE
// PAGE, and the page is what picks the room. So 1-1 and 2-1 get the plain coin
// hall at page 0, 3-1 gets the brick diamond with a power-up in it at page 4,
// 4-1 gets page 6 and 5-1 page 8 — five different rooms out of one area.
//
// Returns 32 columns of that page, the column its exit pipe stands in, and the
// column the ceiling pipe should drop you into.
// Which coin room a level's warp pipe reaches, straight out of its own enemy
// stream. ParseRow0e reads a 3-byte record: byte 1 is the AreaPointer (bits 6-5
// the area type, bits 4-0 the offset within it) and byte 2 carries the world
// number in its top three bits and the ENTRANCE PAGE in the low five. The coin
// rooms are underground offset 2, so a record pointing there names the page.
export function bonusPagesFor(levelId) {
  const entry = REF.levelMap[levelId];
  const b = REF.areas[entry.area].enemyBytes;
  const pages = [];
  for (let i = 0; i + 2 < b.length; ) {
    const b0 = b[i];
    if (b0 === 0xff) break;
    if ((b0 & 0x0f) !== 0x0e) { i += 2; continue; }
    const ptr = b[i + 1];
    if (((ptr >> 5) & 3) === 2 && (ptr & 0x1f) === 2) pages.push(b[i + 2] & 0x1f);
    i += 3;
  }
  // NULL, not 0, when the level names no coin room at all. Defaulting to page 0
  // silently gave 5-2 a room its data never mentions — it has a water bonus and
  // a coin heaven, and no coin room.
  return pages.length ? pages : null;
}

// The other half of the same record, read from the other end. `bonusPagesFor`
// asks a LEVEL's stream which room it reaches; this asks the SUB-AREA's stream
// where it puts you back. ParseRow0e (smbdis.asm:8021-8039) gates on
// `cmp WorldNumber / bne NotUse`, which is how one shared room serves eight
// worlds, and the low five bits of byte 2 are the EntrancePage. On arrival the
// screen is placed at that page (asm:2669-2671) and the player at
// PlayerStarting_X_Pos into it (asm:2856-2857).
//
// `offset` is which entry that table is read at, and it is NOT the same for the
// two kinds of sub-area. PlayerStarting_X_Pos is `.db $28,$18,$38,$28`
// (asm:2815-2816), indexed by AltEntranceControl:
//   mode 2, a side pipe out of a coin room -> $38 = 56px = 3 columns and a half
//   mode 3, CloudExit out of a coin heaven -> $28 = 40px = 2 columns and a half
// `SetEntr` sets mode 2 and CloudExit (asm:5657-5661) increments it to 3, so the
// coin heavens land you a whole column further left than the coin rooms do. The
// callers append the half.
//
// It has to be data rather than a search, because the original never protects
// you on the way out: PlayerEnemyCollision does not run while
// GameEngineSubroutine is still the entrance routine (asm:11298-11300) and
// resumes the instant control returns. Picking the column off the terrain walked
// past the pipe the player is supposed to rise out of and set him down in the
// open next to whatever was standing there.
export function returnColumnFor(world, { area = 'UndergroundArea3', page = null, offset = 3 } = {}) {
  const b = REF.areas[area].enemyBytes;
  let cursorPage = 0; // where the stream cursor has walked to
  let pageSel = false;
  for (let i = 0; i + 1 < b.length; ) {
    const b0 = b[i];
    if (b0 === 0xff) break;
    const row = b0 & 0x0f;
    if (row === 0x0f) {
      cursorPage = b[i + 1] & 0x3f;
      pageSel = true;
      i += 2;
      continue;
    }
    if (row === 0x0e) {
      const col = cursorPage * 16 + (b0 >> 4);
      const b2 = b[i + 2];
      // A coin room is a 32-column window onto its page, so take the record that
      // falls inside the window this level actually uses — worlds 5 and 8 both
      // read page 8, and 8-1 reads page 2, from the same stream. A coin heaven
      // is a whole area with one record per world, so it passes no page and the
      // world match alone decides.
      const inWindow = page == null || (col >= page * 16 && col < page * 16 + 32);
      if ((b2 >> 5) + 1 === world && inWindow) {
        return (b2 & 0x1f) * 16 + offset;
      }
      pageSel = false;
      i += 3;
      continue;
    }
    if (b[i + 1] & 0x80 && !pageSel) {
      cursorPage += 1;
      pageSel = true;
    }
    // The page-select window is one object wide: Inc2B/Inc3B clear
    // EnemyObjectPageSel after every record they consume (smbdis.asm:8047-8051),
    // which is what lets a later MSB advance the page again. decodeEnemies does
    // the same; leaving it set makes the cursor drift on long streams.
    pageSel = false;
    i += 2;
  }
  return null;
}

// Pair that column with the pipe standing in it, so the exit names a real pipe
// mouth rather than a bare floor tile. Returns null when the data names no
// record, leaving the caller to fall back to its terrain search.
export function bonusReturn(meta, world, bonusPage) {
  const col = returnColumnFor(world, { page: bonusPage });
  return col == null ? null : { col, top: pipeTopAt(meta, col) };
}

// The same pairing for the water rooms, read out of THEIR area's stream.
// WaterArea1 is a whole area rather than a 32-column window onto a page, so like
// skyReturn it passes no page and the world match alone decides; its stream
// carries one row-$0e record for world 5 and one for world 6, and both name
// EntrancePage 7.
//
// The offset is 3, not skyReturn's 2: you leave a water room through a SIDE
// pipe, and SideExitPipeEntry sets AltEntranceControl to 2 (asm:5706-5710), so
// PlayerStarting_X_Pos is read at index 2 = $38 = three columns and a half. The
// caller appends the half.
export function waterReturn(meta, world) {
  const col = returnColumnFor(world, { area: 'WaterArea1', offset: 3 });
  return col == null ? null : { col, top: pipeTopAt(meta, col) };
}

// The top of the pipe standing in that column, so an exit names a real pipe
// mouth rather than a bare floor tile. 12 is floor level, and a return that
// carries it is a return no pipe was found for.
function pipeTopAt(meta, col) {
  const pipe = (meta.pipes || []).find((p) => p.x <= col && col <= p.x + 1);
  return pipe ? pipe.top : 12;
}

// A coin heaven does not put you back through a pipe at all, which is why no
// pipe stands at any of these columns and why looking for one would be the wrong
// check. PlayerEntrance branches to the walk-up-out-of-a-pipe routine ONLY for
// mode 2 (`cmp #$02 / beq EntrMode2`, asm:5494-5497); the cloud exit is mode 3,
// so it falls through to `ldy Player_Y_Position / cpy #$30 / bcc
// AutoControlPlayer` — placed at PlayerStarting_Y_Pos index 0 = $00, the very top
// of the screen (asm:2819-2823), and auto-controlled on the way down. You were in
// the clouds; you come back by falling out of them.
//
// Rendered here as `y: 0, exit: 'none'`, which world.js places and hands control
// to immediately. The one thing it does not reproduce is the original's ~48px of
// suppressed input at the top of the drop.
export function skyReturn(world, areaName) {
  const col = returnColumnFor(world, { area: areaName, offset: 2 });
  return col == null ? null : `{ area: 'main', x: ${col}.5, y: 0, exit: 'none' }`;
}

export function bonusRoom(page) {
  const b = buildArea('UndergroundArea3', { theme: 'underground' });
  const x0 = page * 16;
  const rows = b.tiles.map((r) => r.slice(x0, x0 + 32).padEnd(32, '#'));
  const side = b.meta.sidePipes.find((p) => p.x >= x0 && p.x < x0 + 32);
  const contents = b.contents
    .filter((c) => c.x >= x0 && c.x < x0 + 32)
    .map((c) => ({ ...c, x: c.x - x0 }));
  // The original relies on the screen edge for the top of the room; our rows 0
  // and 1 sit above its 13-row buffer entirely, so they are capped to keep the
  // player in.
  rows[0] = '#'.repeat(32);
  rows[1] = '#'.repeat(32);
  return {
    rows,
    contents,
    exit: side ? { x: side.x - x0, top: side.top } : null,
  };
}

// The room as a level module, ready to paste into a generator's output. `back`
// is the column in the main area the exit pipe surfaces at.
export function bonusRoomSource(id, name, page, back, backTop, varName = 'BONUS') {
  const r = bonusRoom(page);
  const q = (v) => JSON.stringify(v).replace(/"([a-zA-Z]+)":/g, '$1: ').replace(/"/g, "'");
  // Where you land is not a constant: page 0's coin hall has a solid block of
  // bricks against the left wall and page 4's does not, so the drop-in point is
  // the first column with floor under it and room for big Mario above.
  const SOL = new Set(['#', 'B', '=', 'S', 'U']);
  let spawn = { x: 2, y: 12 };
  for (let x = 1; x < 30; x++) {
    let y = 12;
    while (y > 3 && SOL.has(r.rows[y][x])) y--;
    if (SOL.has(r.rows[y + 1][x]) && r.rows[y][x] === '.' && r.rows[y - 1][x] === '.') {
      spawn = { x, y };
      break;
    }
  }
  return `// The coin room, rendered from UndergroundArea3 page ${page} — the room this
// level's own enemy stream names. You drop in at the left, take the coins, and
// walk right into the pipe, which surfaces at column ${back}.
const ${varName} = {
  id: '${id}',
  name: '${name}',
  theme: 'underground',
  music: 'underground',
  width: 32,
  height: 15,
  spawn: { x: ${spawn.x}, y: ${spawn.y} },
  tiles: [
${r.rows.map((s) => `    '${s}',`).join('\n')}
  ],
  contents: [
${r.contents.map((c) => `    ${q(c)},`).join('\n')}
  ],
  entities: [],
  warps: [
    { from: { x: ${r.exit.x}, y: ${r.exit.top} }, dir: 'right', to: { area: 'main', x: ${back}.5, y: ${backTop}, exit: 'up' } },
  ],
};
`;
}

// The coin heaven above a beanstalk. There are TWO of them and they are not
// interchangeable: 2-1 and 5-2 climb to GroundArea12 ($2b) and 3-1 and 6-2 to
// GroundArea21 ($34), which each level names in its own row-$0e record. Both
// have the cloud-block override in their header, so their whole floor is cloud.
// The original ends them with a ScrollLock and returns you through a pipe; we
// put that pipe at the end of the run of coins.
export function skyAreaSource(id, name, dest, areaName = 'GroundArea12') {
  const b = buildArea(areaName, { theme: 'overworld' });
  // An AlterAreaAttributes partway through drops the terrain to 0, so the cloud
  // floor simply stops. Crop to where it stops — past that there is nothing to
  // stand on and nothing to see.
  let W = b.width;
  while (W > 1 && b.tiles[13][W - 1] !== 'O') W--;
  const g = b.tiles.map((r) => r.slice(0, W).split(''));
  // The exit pipe sits on the cloud floor at the far end.
  const px = W - 4;
  g[11][px] = '['; g[11][px + 1] = ']';
  g[12][px] = '{'; g[12][px + 1] = '}';
  return `// Coin heaven, rendered from ${areaName} — the area THIS level's own enemy
// stream names. Its floor is cloud block, from the header's cloud-type override.
const SKY = {
  id: '${id}',
  name: '${name}',
  theme: 'overworld',
  music: 'bonus',
  width: ${W},
  height: 15,
  spawn: { x: 3, y: 12 },
  tiles: [
${g.map((r) => `    '${r.join('')}',`).join('\n')}
  ],
  entities: [],
  warps: [{ from: { x: ${px}, y: 11 }, dir: 'down', to: ${dest} }],
};
`;
}

// The underwater bonus room, WaterArea1 — 5-2 and 6-2 each have a pipe into it.
// You drop in at the top left, swim right, and leave by the water pipe.
//
// The drop-in is NOT the coin rooms' emergence out of a ceiling, and the room
// has no ceiling to emerge from: rows 0 and 1 are open water. Coming down a pipe
// into a sub-area leaves AltEntranceControl at 0 (PlayerRdy clears it,
// asm:5546-5547; only SideExitPipeEntry sets 2 and CloudExit 3), so PlayerEntrance
// takes neither pipe branch — it reads `ldy Player_Y_Position / cpy #$30 / bcc
// AutoControlPlayer` (asm:5498-5501) and simply lets him sink under no control
// until he is past $30. Position comes from index 0 of both tables: X =
// PlayerStarting_X_Pos[0] = $28 = column 2.5, and Y = PlayerStarting_Y_Pos
// [PlayerEntranceCtrl] where WaterArea1's header byte 0 is $41, so
// (($41 & %00111000) >> 3) = 0 = $00 (asm:2801-2807 for the header bits,
// 2850-2858 for the lookup) — the very top of the screen, row 0.
//
// Hence `spawn: { x: 2, y: 0 }` and callers warping in with `exit: 'none'`: no
// pipe animation, because the original plays none here.
export function waterRoomSource(id, name, back, backTop) {
  const b = buildArea('WaterArea1', { theme: 'water' });
  // The surface band is the top two ROWS, exactly as emitLevel floods a water
  // level (`r[x] = y <= 1 ? '~' : '_'`). This once read `x < 2`, the same rule
  // with the axis swapped, which put the waterline down the left-hand EDGE:
  // columns 0-1 were surface all the way to the seabed and every row above the
  // crest was open water. The room now enters at row 0, so it faced the player
  // on arrival.
  const rows = b.tiles.map((r, y) => {
    let out = '';
    for (let x = 0; x < b.width; x++) out += r[x] === '.' ? (y <= 1 ? '~' : '_') : r[x];
    return out;
  });
  const wp = b.meta.waterPipe;
  return `// The underwater bonus room, rendered from WaterArea1 — the area this level's
// own enemy stream names. Swim right; the water pipe at column ${wp.x} lets you out
// again at column ${back}.
const WATERROOM = {
  id: '${id}',
  name: '${name}',
  theme: 'water',
  music: 'underwater',
  width: ${b.width},
  height: 15,
  spawn: { x: 2, y: 0 },
  tiles: [
${rows.map((r) => `    '${r}',`).join('\n')}
  ],
  entities: [],
  warps: [
    { from: { x: ${wp.x - 1}, y: ${wp.top} }, dir: 'right', to: { area: 'main', x: ${back}.5, y: ${backTop}, exit: 'up' } },
  ],
};
`;
}

// GroundArea16, the sky warp zone above 4-2's beanstalk. WarpZoneNumbers has
// two rows for it: `$24, $05, $24` — blank, five, blank — for the beanstalk
// route, and `$08, $07, $06` for the other one. So which pipes work depends on
// how you arrived, and `dests` says which.
// The room ENDS at the wall the player cannot pass, and the emitted width is the
// camera's right limit (camera.js: maxX = width*16 - screenW). Emitting anything
// past the wall therefore lets the camera scroll beyond the warp pipes, and
// because the camera is forward-only and player.js pins the player to cam.x, a
// pipe that crosses the left edge is gone for good. That was the bug: at width
// 70 the camera reached column 54, so walking to the last pipe put the world-8
// pipe at column 50 permanently out of reach — aiming for it landed you in 7-1.
//
// The original solves this with a ScrollLockObject (smbdis.asm:3566) that stops
// the camera dead. We have no such mechanism, but we do not need one here: the
// lock exists so the player can walk BACK to a pipe he has passed, which reduces
// to "the camera's left edge must never pass the first pipe". Ending the room at
// the wall gives exactly that, from the data, with no camera code.
//
// NOTE the trap this replaces: `buildArea` computes width as furthest object + 8
// (see the width line near the top of this file), and objects that place no
// tiles — ScrollLockWarp, the Frenzy commands, LoopCmd — count. For GroundArea16
// the furthest object IS the scroll lock at column 70, so the camera command that
// exists to constrain the camera was defining the limit it was meant to
// constrain. That affects 16 of the 34 areas and is its own task; do not "fix"
// the width line without measuring, because every castle is padded by a trailing
// LoopCmd 8 columns past the axe and the bridge.
export function warpZoneSource(id, name, dests) {
  const b = buildArea('GroundArea16', { theme: 'overworld' });
  const wall = b.objs.filter((o) => o.name === 'ColumnOfSolidBlocks').map((o) => o.x);
  if (!wall.length) throw new Error('warpZoneSource: no wall found — cannot bound the room');
  const W = Math.max(...wall) + 1;
  const rows = b.tiles.map((r) => r.slice(0, W));
  const pipes = b.meta.pipes.filter((p) => p.warp);
  const warps = pipes
    .map((p, i) => (dests[i] ? `    { from: { x: ${p.x}, y: ${p.top} }, dir: 'down', to: { level: '${dests[i]}' } },` : null))
    .filter(Boolean);
  return `const WARPZONE = {
  id: '${id}',
  name: 'WARP ZONE',
  theme: 'overworld',
  music: 'bonus',
  width: ${W},
  height: 15,
  spawn: { x: 2, y: 12 },
  tiles: [
${rows.map((r) => `    '${r}',`).join('\n')}
  ],
  entities: [],
  signs: [
${pipes.map((p, i) => (dests[i] ? `    { x: ${p.x + 0.25}, y: ${p.top - 2}, text: '${dests[i][0]}' },` : null)).filter(Boolean).join('\n')}
  ],
  warps: [
${warps.join('\n')}
  ],
};
`;
}

// --- level module emitter -------------------------------------------------
export function emitLevel(id, opts = {}) {
  const b = buildArea(id, opts);
  const rows = b.tiles.slice();
  const W = b.width;

  // Water levels flood every open cell; the top open row becomes the surface.
  if (opts.theme === 'water') {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (rows[y][x] === '.') {
          const r = rows[y].split('');
          r[x] = y <= 1 ? '~' : '_';
          rows[y] = r.join('');
        }
      }
    }
  }

  const ents = b.entities.map((e) => {
    const [type, variant] = e.type.split(':');
    const { type: _t, x, y, ...rest } = e;
    return variant ? { type, x, y, variant, ...rest } : { type, x, y, ...rest };
  });
  for (const s of b.meta.springs) ents.push({ type: 'springboard', x: s.x, y: s.y });

  return { id, width: W, rows, meta: b.meta, contents: b.contents, entities: ents, terrain: b.terrain };
}
