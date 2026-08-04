#!/usr/bin/env node
// Find places a player can get to but not get out of.
//
// SMB's camera never scrolls back, so the left edge of the screen is a hard wall.
// That makes any spot whose only exit is leftward a permanent trap: the level is
// unwinnable and the player has to burn a life on the timer.
//
//   node tools/reach.mjs            # all levels and sub-areas
//   node tools/reach.mjs 1-2        # one level
//   node tools/reach.mjs 1-2 -v     # also dump the graph stats
//   node tools/reach.mjs 1-2 --patch 198,10=.
//                                   # "what if that block weren't there?" — edits the
//                                   # tile map in memory before analysing. Repeatable.
//   node tools/reach.mjs --big      # model a TWO-TILE-TALL body (big/fire Mario)
//   node tools/reach.mjs --sizes    # run both bodies and rank what only BIG cannot escape
//   node tools/reach.mjs --sizes --strict
//                                   # ...and count the ACCEPTED traps too, so you can
//                                   # see the detector is still alive. See ACCEPTED.
//   node tools/reach.mjs 3-1 --patch 3-1b:5,6==
//                                   # patches take an optional AREA prefix
//
// MEASURING ONE OF THESE BY HAND
// ------------------------------
// If you go and drive the game to confirm a cell this tool reports, use ONE FRESH
// PAGE PER RUN. Reloading an area restores its TILES but not an item block's
// already-spent state, so the second run in a page finds a plain breakable brick
// where the first found an item block — and big Mario "escapes" a pocket that is
// really sealed. Two successive sweeps gave the opposite verdict to a single clean
// run on 3-1b (5,7) for exactly that reason, and it is the one harness fault this
// project has hit that produced a confidently WRONG all-clear on a reported bug.
// Two more, while you are there: teleporting onto a coin tile eats that coin, so
// take any "has the level changed" baseline AFTER placing the player; and holding
// jump for N frames is ONE jump, not many, so toggle it or you will read "he
// cannot jump out" off a probe that only ever jumped once.
//
// MODEL
// -----
// A column is not one place. An underground cavern has a ceiling AND a floor;
// a tree-top level has standing room on the canopy and (sometimes) under it.
// So the unit of analysis is a NODE = (column, surfaceY): a tile the player can
// stand in, i.e. free space with support directly beneath it.
//
// Two nodes are connected when the player can actually travel between them: a
// run jump gains about MAX_JUMP_UP tiles of height and clears about MAX_GAP
// tiles of gap, and the flight path has to be clear of solid tiles. Moving
// lifts, springboards, vines and warps get modelled explicitly because they are
// the difference between a level being generous and being broken.
//
// A trap is then a node reachable from the spawn from which no exit is
// reachable — where an exit is the flagpole/axe column, the right edge, or the
// mouth of a warp that leaves the area. "Reachable" is forward-biased: the
// camera never scrolls back, and it sits FOLLOW_X = 112px behind the player, so
// from the furthest column you have reached you may still walk BACKTRACK = 7
// tiles left, and no further. Taking a warp resets the camera, so a warp edge
// clears that limit.
//
// BODY HEIGHT
// -----------
// The model was size-agnostic — one tile of body, effectively small Mario — and
// that is why 3-1b's brick pyramid never showed up: every pocket inside it is one
// tile tall, so a small body walks in and out and a BIG one (HITBOX.BIG_H = 32px
// = two tiles) cannot. `--big` gives the body a head row: a node needs headroom,
// and every flight path is checked two rows deep.
//
// Ducking IS modelled, and has to be: 1-2 is built on sliding under one-tile
// ceilings, and without it that level alone reported 25 trap regions that were
// really just its own low corridors. But it is momentum only — you cannot duck
// and then start walking (asm:5585-5589) — so it needs a run-up. See canDuckSlide.
//
// Two things this pass gets right that a naive one does not, both of which had it
// reporting nothing about the room it was written for:
//   * it is seeded from the SMALL player's reachable set, because you arrive in
//     one of these pockets small and GROW; and
//   * it seeds from where the inbound PIPE puts you down, not from the area's
//     `spawn` field, which for a sub-area is a generated fallback.
//
// Brick-smashing is still not modelled, so a flagged cell whose ceiling is a
// plain breakable brick may in practice be escapable by a big player bumping his
// way out. Of the four cells this reports in 3-1b, only (5,7) is truly sealed —
// its ceiling is the spent item block. The others were confirmed by hand as
// escapable ONLY by demolishing bricks, which is worth flagging anyway.
//
// The movement numbers are deliberately conservative. Approximate by design:
//   * flight arcs are checked as "rise to an apex row, cross, drop", not as a
//     real parabola;
//   * a lift is credited with its whole sweep, ignoring whether you can time it;
//   * enemies, shells, and stomping off an enemy are ignored entirely.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './serve.mjs';

const TILE = 16;
const MAX_JUMP_UP = 4; // tiles of height a run jump gains
// Six, not five. The original ships six-tile holes — 6-2 at 123-128, 8-1 at
// 221-226, 8-2 at 148-153 — and calling those unjumpable made three of its
// levels look broken. Measured at 8-2's own gap, arriving at the lip at 2.56,
// 2.00 and 1.60 px/frame, Mario lands on column 155 every time with the far lip
// at 154; on flat ground with a run-up he covers 7.5 to 8.6 tiles. Five was
// conservative by more than a tile.
//
// Note this is measured as COLUMN DISTANCE, not hole width: a six-wide hole at
// 123-128 is a jump from 122 to 129, a dx of seven. Six was not enough to clear
// the original's six-wide holes for exactly that reason.
const MAX_GAP = 7; // tiles of horizontal gap a run jump clears
const FALL_BONUS = 3; // extra tiles of reach when the landing is far below
const SWIM_UP = 8; // water lets you climb as far as you like
const SPRING_UP = 8; // a springboard roughly doubles the jump
const VINE_UP = 12; // a vine reaches the sky
const BACKTRACK = 7; // tiles you can walk left of your furthest point (camera.FOLLOW_X)

const args = process.argv.slice(2);
const verbose = args.includes('-v');
const bigFlag = args.includes('--big');
const sizesFlag = args.includes('--sizes');
// Count the ACCEPTED traps too. This is the switch that proves the sweep can
// still fail: green with the allow-list on, red with it off, same cells either way.
const strictFlag = args.includes('--strict');
const patches = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--patch') continue;
  // `x,y=c` patches the main area; `3-1b:x,y=c` patches a sub-area. Sub-areas were
  // unpatchable, which meant the one place a synthetic trap was worth injecting —
  // a bonus room — could not be tested at all.
  const m = /^(?:([\w-]+):)?(\d+),(\d+)=(.)$/.exec(args[i + 1] || '');
  if (!m) {
    console.error(`bad --patch "${args[i + 1]}", want [area:]x,y=char`);
    process.exit(2);
  }
  patches.push({ area: m[1] || 'main', x: +m[2], y: +m[3], ch: m[4] });
  args.splice(i, 2);
  i--;
}
let why = null;
{
  const i = args.indexOf('--why');
  if (i >= 0) {
    const m = /^(\d+),(\d+)$/.exec(args[i + 1] || '');
    if (!m) {
      console.error('bad --why, want x,y');
      process.exit(2);
    }
    why = { x: +m[1], y: +m[2] };
    args.splice(i, 2);
  }
}
const only = args.find((a) => !a.startsWith('-')) || null;

function applyPatches(lvl) {
  for (const p of patches) {
    const target = p.area === 'main' ? lvl : (lvl.areas || {})[p.area];
    if (!target) {
      console.error(`--patch names area "${p.area}", which this level does not have`);
      process.exit(2);
    }
    const row = target.tiles[p.y];
    if (row == null || p.x >= row.length) continue;
    target.tiles[p.y] = row.slice(0, p.x) + p.ch + row.slice(p.x + 1);
    console.log(`patched ${p.area} (${p.x},${p.y}) '${row[p.x]}' -> '${p.ch}'`);
  }
}

const { LEGEND, secondaryHardMode } = await import(
  pathToFileURL(join(ROOT, 'src/game/world.js')).href
);

const rec = (ch) => LEGEND[ch] || null;
const INF = 1e9;

/**
 * Where you have to be standing for a pipe to swallow you. This mirrors
 * Player._checkPipeEntry exactly, because the difference between "you can still
 * reach the pipe" and "you are stuck forever" in 1-2 is one tile.
 *   down : feet on the lip, either of the two lip columns
 *   right: walking INTO the mouth from the left, body straddling fx-1/fx, with
 *          the player's middle on row fy or fy+1
 */
export function atMouth(x, y, wp) {
  const fx = Math.round(wp.from.x);
  const fy = Math.round(wp.from.y);
  const dir = wp.dir || 'down';
  if (dir === 'down') return (x === fx || x === fx + 1) && y === fy - 1;
  if (dir === 'right') return (x === fx - 1 || x === fx) && (y === fy || y === fy + 1);
  if (dir === 'left') return (x === fx + 1 || x === fx + 2) && (y === fy || y === fy + 1);
  return false;
}

// ---------------------------------------------------------------------------
// Tile queries
// ---------------------------------------------------------------------------

function makeGrid(lvl, body = 1) {
  const T = lvl.tiles;
  const H = T.length;
  const W = lvl.width || T[0].length;
  const at = (x, y) => (x < 0 || x >= W || y < 0 || y >= H ? null : rec(T[y][x]));

  // Blocks movement from every side.
  const wall = (x, y) => {
    if (x < 0 || x >= W) return true; // level edges are walls
    if (y < 0) return true; // the ceiling of the world
    if (y >= H) return false; // below the floor is a pit, not a wall
    const r = at(x, y);
    if (!r) return false;
    if (r.harm) return true; // lava is not somewhere you fly through
    if (r.platform) return false; // one-way: you pass up through it
    return !!r.solid;
  };

  // Air the player can occupy. `free` is one tile — the old size-agnostic body;
  // `freeBody` is the whole standing body, feet on row y and `body-1` rows of
  // head above it. Everything that asks "can the player BE here" uses freeBody.
  const free = (x, y) => !wall(x, y) && y >= 0 && y < H;
  const freeBody = (x, y) => {
    for (let r = y - body + 1; r <= y; r++) if (!free(x, r)) return false;
    return true;
  };

  // Something you can land on top of.
  const support = (x, y) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return false;
    const r = at(x, y);
    if (!r) return false;
    if (r.harm) return false;
    // A bumpable question or hidden block counts as footing even though it is
    // not solid in the map: striking it from below turns it into a used block,
    // which IS solid, and the original builds puzzles on exactly that. 2-1
    // stacks a hidden coin block at (28,9) under a hidden 1-up at (28,5) — you
    // bump the lower one, stand on what it becomes, and take the upper one.
    // Modelling only the static map called that faithful level unplayable.
    return !!(r.solid || r.platform || (r.question && r.bumpable));
  };

  const liquid = (x, y) => {
    const r = at(x, y);
    return !!(r && r.liquid);
  };

  // Can the player STAND, at full height, on this column and start walking from
  // it? The run-up test below needs this and nothing else does.
  const stand = (x, y) => freeBody(x, y) && support(x, y + 1);

  return { T, W, H, body, at, wall, free, freeBody, support, stand, liquid };
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function buildNodes(lvl, g, entries = [], rootId = '') {
  const nodes = [];
  const key = (x, y) => x * 64 + y;
  const byKey = new Map();

  const add = (x, y, extra) => {
    if (x < 0 || x >= g.W || y < 0 || y >= g.H) return null;
    const k = key(x, y);
    if (byKey.has(k)) {
      const n = byKey.get(k);
      if (extra) Object.assign(n, extra);
      return n;
    }
    const n = { x, y, virtual: false, swim: false, exit: false, ...(extra || {}) };
    n.id = nodes.length;
    nodes.push(n);
    byKey.set(k, n);
    return n;
  };

  // Every free tile with support beneath it, at EVERY depth in the column.
  for (let x = 0; x < g.W; x++) {
    for (let y = 0; y < g.H; y++) {
      if (!g.freeBody(x, y)) continue;
      if (g.support(x, y + 1)) add(x, y, { swim: g.liquid(x, y) });
      else if (g.liquid(x, y)) add(x, y, { swim: true }); // treading water counts
    }
  }

  // Moving lifts: level entities and map anchors alike. Credit the whole sweep.
  const lifts = [];
  // A pulley places ONE half in the level data and its partner is created by
  // the entity's constructor, so the second platform is invisible to anything
  // reading the level. Model it here the same way the constructor does —
  // mirrored about the rope's balance point, a rope-span to the right. 4-3 is
  // built almost entirely on balance pairs and reported 76 trap regions
  // without this, while being perfectly playable.
  const addLift = (pos, opts) => {
    lifts.push(liftFrom(pos, opts));
    const mode = opts.mode || opts.kind;
    if (mode !== 'pulley') return;
    const spacing = opts.spacing != null ? opts.spacing : 112;
    const anchorY = opts.anchorY != null ? opts.anchorY : pos.y * TILE - 96;
    lifts.push(
      liftFrom({ x: pos.x + spacing / TILE, y: (2 * anchorY) / TILE - pos.y }, opts)
    );
  };
  // The two conditions that shorten a three-tile deck, from the level itself.
  const deck = {
    castle: (lvl.theme || '') === 'castle',
    hardMode: secondaryHardMode(rootId),
  };
  for (const spec of lvl.entities || []) {
    if (spec && spec.type === 'platform') addLift(spec, { ...spec, ...deck });
  }
  for (let y = 0; y < g.H; y++) {
    for (let x = 0; x < g.W; x++) {
      const r = g.at(x, y);
      if (!r || r.anchor !== 'platform') continue;
      addLift({ x, y }, { ...(r.anchorOpts || {}), ...deck });
    }
  }
  for (const lift of lifts) {
    lift.nodes = [];
    for (let c = lift.x0; c <= lift.x1; c++) {
      for (let ry = lift.y0; ry <= lift.y1; ry++) {
        const n = add(c, ry, { virtual: true, lift: true });
        if (n) lift.nodes.push(n);
      }
    }
  }

  // Springboards and vine blocks buy extra height for anything standing near them.
  const boosts = [];
  for (const spec of lvl.entities || []) {
    if (spec && spec.type === 'springboard') boosts.push({ x: spec.x, y: spec.y, up: SPRING_UP });
  }
  for (let y = 0; y < g.H; y++) {
    for (let x = 0; x < g.W; x++) {
      const r = g.at(x, y);
      if (r && r.item === 'vine') boosts.push({ x, y, up: VINE_UP });
    }
  }
  for (const n of nodes) {
    for (const b of boosts) {
      if (Math.abs(n.x - b.x) <= 2 && Math.abs(n.y - b.y) <= 3) n.up = Math.max(n.up || 0, b.up);
    }
  }

  // Where an inbound pipe actually puts the player down — see the note at the
  // spawn in buildLevelGraph. Marked virtual so findTraps never reports one as a
  // place you are stranded: it is a point you fall through, not a ledge.
  const entryNodes = [];
  for (const e of entries) {
    const ex = Math.floor(e.x);
    const ey = Math.floor(e.y);
    if (ex < 0 || ex >= g.W || ey < 0 || ey >= g.H) continue;
    const n = g.freeBody(ex, ey)
      ? add(ex, ey, { virtual: true, entry: true })
      : byKey.get(key(ex, ey)) || null;
    if (n) entryNodes.push(n);
  }

  return { nodes, byKey, key, lifts, entryNodes };
}

// A lift spec keeps its tile top-left, so its deck top is at spec.y * TILE and
// the row a player standing on it occupies is one above that.
function liftFrom(pos, opts) {
  const mode = opts.mode || opts.kind || 'horizontal';
  // A three-tile deck is drawn and boxed as TWO tiles in a castle or in
  // secondary hard mode (asm:8930-8940, 13343-13350). Platform.tilesWide, same
  // rule — the tool and the engine have to agree about a deck's width.
  let tiles = opts.tiles || opts.width || 3;
  if (tiles === 3 && (opts.castle || opts.hardMode)) tiles = 2;
  const range = opts.range != null ? opts.range : 64;
  const topPx = pos.y * TILE;
  const standRow = (px) => Math.floor((px - 1) / TILE);
  const x0 = Math.floor(pos.x);
  const lift = { mode, x0, x1: x0 + tiles - 1, y0: standRow(topPx), y1: standRow(topPx) };
  if (mode === 'vertical' || mode === 'pulley') {
    // A springing vertical lift (the original's InitVertPlatform, $25 — the ones
    // that carry no direction of their own) bobs around a centre 64 pixels from
    // the row it is written at, not around that row. Platform.swingY, same rule.
    const swing =
      mode === 'vertical' && opts.dir == null
        ? topPx + (topPx < 128 ? range : -range)
        : topPx;
    lift.y0 = standRow(swing - range);
    lift.y1 = standRow(swing + range);
    if (mode === 'pulley') lift.y0 = standRow(topPx - (opts.spacing != null ? opts.spacing : 112));
  } else if (mode === 'horizontal') {
    lift.x0 = Math.floor((pos.x * TILE - range) / TILE);
    lift.x1 = Math.floor((pos.x * TILE + range) / TILE) + tiles - 1;
  } else if (mode === 'fall') {
    lift.y1 = standRow(topPx) + 6; // it drops away under you
  }
  return lift;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

// Columns of full-height standing room a big player needs behind him before a
// one-tile ceiling, to be carrying speed when he reaches it. Three is the
// smallest run-up that keeps 1-2 honest; see canDuckSlide.
const RUNUP = 3;

function makeTravel(g) {
  // Every feet-row from yTop to yBot has to admit the WHOLE body, head included.
  const colFree = (x, yTop, yBot) => {
    for (let y = yTop; y <= yBot; y++) if (!g.freeBody(x, y)) return false;
    return true;
  };

  // May a two-tile body cross a ONE-tile-high stretch by ducking?
  //
  // In the original you cannot duck-WALK. PlayerCtrlRoutine (smbdis.asm:5585-5589)
  // nullifies Left_Right_Buttons AND Up_Down_Buttons the moment down is held on
  // the ground with a direction pressed, so a crouched Mario gets no acceleration
  // at all — ImposeFriction then bleeds off whatever speed he already had. The
  // duck-slide is therefore momentum ONLY: you can carry speed into a low gap,
  // you can never start moving inside one.
  //
  // Modelled as a run-up requirement: RUNUP columns of full-height standing room
  // immediately BEHIND the player, on his own row, in the direction he is going.
  // 1-2's low stretch at columns 54-55 is approached across a wide open floor and
  // passes; 3-1b's pocket at (5,7) is one column wide with brick on both sides,
  // so there is nowhere to build speed and it correctly stays sealed.
  //
  // Only a level walk qualifies. Ducking mid-jump is not a thing worth modelling,
  // and a body that is one tile tall (small Mario) has nothing to duck to.
  const canDuckSlide = (a, b, p, step) => {
    if (g.body < 2) return false;
    if (a.y !== p || b.y !== p) return false;
    for (let i = 1; i <= RUNUP; i++) if (!g.stand(a.x - step * i, p)) return false;
    return true;
  };

  return function canTravel(a, b) {
    if (a === b) return false;
    const dx = b.x - a.x;
    const adx = Math.abs(dx);
    const rise = a.y - b.y; // > 0 means b is higher

    const jumpUp = a.swim || b.swim ? SWIM_UP : Math.max(MAX_JUMP_UP, a.up || 0);
    if (rise > jumpUp) return false;

    const drop = Math.max(0, -rise);
    let maxDx = MAX_GAP + Math.min(FALL_BONUS, drop);
    if (a.swim || b.swim) maxDx = MAX_GAP;
    if (adx > maxDx) return false;

    // Rise to an apex row, cross at that row, drop onto b.
    const hi = Math.min(a.y, b.y);
    const lo = Math.max(0, a.y - jumpUp);
    for (let p = hi; p >= lo; p--) {
      if (!colFree(a.x, p, a.y)) break; // ceiling above a; no higher apex is possible
      if (!colFree(b.x, p, b.y)) continue;
      let clear = true;
      const step = dx > 0 ? 1 : -1;
      const slide = canDuckSlide(a, b, p, step);
      for (let c = a.x + step; c !== b.x; c += step) {
        if (g.freeBody(c, p)) continue;
        // A big player who is ALREADY MOVING keeps his speed under a one-tile
        // ceiling — 1-2 is built on it. See canDuckSlide for why this is not a
        // free pass.
        if (slide && g.free(c, p)) continue;
        clear = false;
        break;
      }
      if (clear) return true;
    }
    return false;
  };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * The whole traversal model for one area, as data. Exported so other tools
 * (playthrough.mjs) can ask "is this block reachable?" without re-deriving it.
 */
export function buildLevelGraph(lvl, areaKey = 'main', opts = {}) {
  const g = makeGrid(lvl, opts.body || 1);
  const { nodes, byKey, key, lifts, entryNodes } = buildNodes(lvl, g, opts.entries || [], opts.rootId || '');
  const canTravel = makeTravel(g);

  // --- adjacency -----------------------------------------------------------
  const byColumn = new Map();
  for (const n of nodes) {
    if (!byColumn.has(n.x)) byColumn.set(n.x, []);
    byColumn.get(n.x).push(n);
  }
  const out = nodes.map(() => []);
  const warpOut = nodes.map(() => []);
  const SPAN = MAX_GAP + FALL_BONUS;
  for (const a of nodes) {
    for (let c = a.x - SPAN; c <= a.x + SPAN; c++) {
      const col = byColumn.get(c);
      if (!col) continue;
      for (const b of col) if (canTravel(a, b)) out[a.id].push(b.id);
    }
  }
  // Riding a lift joins every tile of its sweep.
  for (const lift of lifts) {
    for (const a of lift.nodes) {
      for (const b of lift.nodes) if (a !== b) out[a.id].push(b.id);
    }
  }

  // --- goal and exits ------------------------------------------------------
  let goalX = null;
  if (lvl.flagpole) goalX = Math.round(lvl.flagpole.x);
  if (goalX == null) {
    for (let y = 0; y < g.H && goalX == null; y++) {
      const i = lvl.tiles[y].indexOf('a');
      if (i >= 0) goalX = i;
    }
  }
  if (goalX == null) goalX = g.W - 2;

  let warpExits = 0;
  for (const wp of lvl.warps || []) {
    // A warp that leaves the LEVEL — to another level, or one that simply ends
    // it — is an exit too. Only `to.area` was checked, so these fell into the
    // in-area branch and were given an edge to whatever nearestNode(undefined,
    // undefined) happened to return. 4-2 reported 39 trap regions on that
    // alone; 2-2 passed only because its geometry never exposed it.
    if (wp.to && (wp.to.level || wp.to.complete)) {
      for (const n of nodes) if (atMouth(n.x, n.y, wp)) n.exit = true;
      warpExits++;
      continue;
    }
    const dest = wp.to && wp.to.area;
    if (dest && dest !== areaKey) {
      // Leaves the area entirely: reaching the mouth is a win here.
      for (const n of nodes) if (atMouth(n.x, n.y, wp)) n.exit = true;
      warpExits++;
    } else {
      // Stays in the area (1-4's maze loop). An ordinary edge — but taking it
      // re-seats the camera, so it is flagged as a warp.
      const to =
        landingNode(byKey, key, g, wp.to.x, wp.to.y) || nearestNode(nodes, wp.to.x, wp.to.y);
      if (to) for (const n of nodes) if (atMouth(n.x, n.y, wp)) warpOut[n.id].push(to.id);
    }
  }
  for (const n of nodes) if (n.x >= goalX) n.exit = true;

  // --- the spawn -----------------------------------------------------------
  const spawnX = Math.round((lvl.spawn && lvl.spawn.x) || 2);
  const spawnY = Math.round((lvl.spawn && lvl.spawn.y) != null ? lvl.spawn.y : 12);
  const start = landingNode(byKey, key, g, spawnX, spawnY) || nearestNode(nodes, spawnX, spawnY);

  // A sub-area's `spawn` is NOT where the player arrives. It is the generator's
  // "first column with floor and headroom", a fallback; the pipe that leads here
  // names its own destination, and in 3-1b that is (2.5, 3) — in the air, above
  // the coin pyramid, with the whole fall to steer. Seeding only from `spawn`
  // put the player on the room floor, from which the pyramid is six tiles up and
  // unreachable, so NOTHING inside it was ever analysed at either size. Entries
  // are airborne and virtual: somewhere you pass through, never somewhere you are
  // reported as stranded.
  const entryIds = entryNodes.map((n) => n.id);

  // Reachability under the camera rule. `best[i]` is the smallest "furthest
  // column reached" with which the player can be standing on node i; a smaller
  // value means more of the level is still behind the camera edge, so this is a
  // shortest-path search on that value rather than a plain flood.
  const reach = (from) => {
    const seedIds = Array.isArray(from) ? from : [from];
    const best = new Int32Array(nodes.length).fill(INF);
    const queued = new Uint8Array(nodes.length);
    const q = [];
    for (const fromId of seedIds) {
      if (fromId == null) continue;
      best[fromId] = nodes[fromId].x;
      q.push(fromId);
      queued[fromId] = 1;
    }
    while (q.length) {
      const i = q.shift();
      queued[i] = 0;
      const m = best[i];
      const relax = (j, nm) => {
        if (nm >= best[j]) return;
        best[j] = nm;
        if (!queued[j]) {
          queued[j] = 1;
          q.push(j);
        }
      };
      for (const j of out[i]) {
        if (nodes[j].x < m - BACKTRACK) continue; // behind the camera edge
        relax(j, Math.max(m, nodes[j].x));
      }
      for (const j of warpOut[i]) relax(j, nodes[j].x); // a pipe re-seats the camera
    }
    return best;
  };

  const seedIds = start ? [start.id, ...entryIds] : entryIds;
  const fromSpawn = seedIds.length ? reach(seedIds) : new Int32Array(nodes.length).fill(INF);
  const nodeAt = (x, y) => byKey.get(key(x, y)) || null;
  const reachedFromSpawn = (n) => !!n && fromSpawn[n.id] < INF;

  return {
    grid: g,
    nodes,
    lifts,
    out,
    warpOut,
    goalX,
    warpExits,
    spawn: { x: spawnX, y: spawnY },
    start,
    reach,
    fromSpawn,
    nodeAt,
    reachedFromSpawn,
    INF,
  };
}

/** Nodes reachable from the spawn from which no exit is reachable. */
export function findTraps(gr) {
  const traps = [];
  for (const n of gr.nodes) {
    if (gr.fromSpawn[n.id] >= INF) continue;
    if (n.exit) continue;
    if (n.virtual) continue; // a lift deck is not a place you get stranded
    const onward = gr.reach(n.id);
    let ok = false;
    for (let i = 0; i < gr.nodes.length && !ok; i++) {
      if (onward[i] < INF && gr.nodes[i].exit) ok = true;
    }
    if (!ok) traps.push(n);
  }
  return traps;
}

function analyse(name, lvl, areaKey, body = 1, entries = []) {
  // '8-4/8-4w' -> '8-4': a sub-area answers to its parent level's numbers.
  const gr = buildLevelGraph(lvl, areaKey, { body, entries, rootId: String(name).split('/')[0] });
  if (!gr.nodes.length) {
    console.log(`\n${name}: no standable tile anywhere — level is unplayable.`);
    return 1;
  }
  if (!gr.start) {
    console.log(`\n${name}: spawn (${gr.spawn.x},${gr.spawn.y}) has no floor under it.`);
    return 1;
  }

  if (why) {
    const n = gr.nodeAt(why.x, why.y);
    if (n) {
      const r = gr.reach(n.id);
      const got = gr.nodes.filter((m) => r[m.id] < INF);
      console.log(
        `\n${name}: from (${n.x},${n.y}) you can reach ${got.length} node(s): ` +
          got.map((m) => `${m.x},${m.y}${m.exit ? '*' : ''}${m.virtual ? '~' : ''}`).join(' ')
      );
    }
  }

  const traps = findTraps(gr);

  if (verbose) {
    let reached = 0;
    for (let i = 0; i < gr.nodes.length; i++) if (gr.fromSpawn[i] < INF) reached++;
    console.log(
      `\n${name}: ${gr.nodes.length} nodes, ${gr.out.reduce((a, b) => a + b.length, 0)} edges, ` +
        `${gr.lifts.length} lift(s), goal x=${gr.goalX}, ` +
        `${gr.warpExits} warp exit(s), ${gr.nodes.filter((n) => n.exit).length} exit node(s), ` +
        `reachable=${reached}`
    );
  }

  // Group traps into contiguous (surfaceY, column-range) runs.
  traps.sort((a, b) => a.y - b.y || a.x - b.x);
  const runs = [];
  for (const n of traps) {
    const last = runs[runs.length - 1];
    if (last && last.y === n.y && n.x === last.x1 + 1) last.x1 = n.x;
    else runs.push({ y: n.y, x0: n.x, x1: n.x });
  }
  runs.sort((a, b) => a.x0 - b.x0 || a.y - b.y);

  if (runs.length) {
    console.log(`\n${name}  (spawn ${gr.spawn.x},${gr.start.y}  goal x=${gr.goalX})`);
    for (const r of runs) {
      const span = r.x0 === r.x1 ? `column ${r.x0}` : `columns ${r.x0}..${r.x1}`;
      console.log(`  TRAP ${span}  standing on y=${r.y}`);
    }
  }
  return runs.length;
}

// ---------------------------------------------------------------------------
// Size comparison
// ---------------------------------------------------------------------------

// Traps a TWO-tile body cannot escape but a ONE-tile body can. Every big node is
// also a small node (a body that fits two rows fits one), so the difference is
// always "big Mario is the one in trouble here".
//
// Ranked by how likely a player is to end up in it. A pocket you can only enter
// by a precise jump is a curiosity; one you can WALK into off the natural route
// is the bug. `walk-in` means some reachable node outside the region sits on the
// same row one column away — you get there by holding a direction.
//
// SEEDING. The candidates are NOT the cells big Mario can walk to. He usually
// cannot walk into one of these at all — 3-1b's pocket at (5,7) is sealed by
// (5,5) against a big body arriving from either side, and a sweep seeded from the
// big spawn is therefore structurally blind to the exact class it exists to find.
// He arrives SMALL and GROWS: the room hands him a mushroom brick directly over
// his head, and the frame he takes it he is two tiles tall in a one-tile pocket.
// So the seed is every cell a SMALL player can reach, and the question asked of
// each is "if he were big HERE, could he get out?".
function compareSizes(name, lvl, areaKey, entries = []) {
  const small = buildLevelGraph(lvl, areaKey, { body: 1, entries });
  const big = buildLevelGraph(lvl, areaKey, { body: 2, entries });
  if (!big.nodes.length || !big.start) return 0;

  const smallTrapped = new Set();
  for (const n of findTraps(small)) smallTrapped.add(`${n.x},${n.y}`);

  // Reachable by a small player, and roomy enough for a big body to exist in.
  const seeds = [];
  for (const n of big.nodes) {
    if (n.virtual) continue; // a lift deck is not somewhere you get stranded
    if (n.exit) continue;
    if (smallTrapped.has(`${n.x},${n.y}`)) continue; // already a trap at both sizes
    const s = small.nodeAt(n.x, n.y);
    if (!small.reachedFromSpawn(s)) continue;
    seeds.push(n);
  }

  const bigTraps = seeds.filter((n) => {
    const onward = big.reach(n.id);
    for (let i = 0; i < big.nodes.length; i++) {
      if (onward[i] < INF && big.nodes[i].exit) return false;
    }
    return true;
  });
  if (!bigTraps.length) return 0;

  const region = new Set(bigTraps.map((n) => `${n.x},${n.y}`));
  // Predecessors: reachable nodes OUTSIDE the region with an edge into it.
  const entryRank = new Map(); // "x,y" of a trap node -> { walkIn, preds }
  for (const n of bigTraps) entryRank.set(`${n.x},${n.y}`, { walkIn: false, preds: 0 });
  for (const a of big.nodes) {
    // Predecessors are asked of the SMALL graph too: "could he have walked in
    // here and then grown" is the question, and big-spawn reachability is the
    // assumption that made this sweep blind in the first place.
    if (!small.reachedFromSpawn(small.nodeAt(a.x, a.y))) continue;
    if (region.has(`${a.x},${a.y}`)) continue;
    for (const j of big.out[a.id]) {
      const b = big.nodes[j];
      const e = entryRank.get(`${b.x},${b.y}`);
      if (!e) continue;
      e.preds++;
      if (a.y === b.y && Math.abs(a.x - b.x) === 1) e.walkIn = true;
    }
  }

  // Group into contiguous runs on a row, carrying the worst entry rank.
  bigTraps.sort((a, b) => a.y - b.y || a.x - b.x);
  const runs = [];
  for (const n of bigTraps) {
    const e = entryRank.get(`${n.x},${n.y}`);
    const last = runs[runs.length - 1];
    if (last && last.y === n.y && n.x === last.x1 + 1) {
      last.x1 = n.x;
      last.walkIn = last.walkIn || e.walkIn;
      last.preds += e.preds;
    } else runs.push({ y: n.y, x0: n.x, x1: n.x, walkIn: e.walkIn, preds: e.preds });
  }
  runs.sort((a, b) => Number(b.walkIn) - Number(a.walkIn) || b.preds - a.preds || a.x0 - b.x0);

  console.log(`\n${name}  (spawn ${big.spawn.x},${big.start.y}  goal x=${big.goalX})`);
  let unaccepted = 0;
  for (const r of runs) {
    const span = r.x0 === r.x1 ? `column ${r.x0}` : `columns ${r.x0}..${r.x1}`;
    const how = r.walkIn ? 'WALK-IN' : r.preds ? 'jump-in' : 'unreachable-except-by-growing';
    const ok = acceptedCells(name, r);
    if (ok && !strictFlag) {
      console.log(`  accepted trap  ${span}  standing on y=${r.y}  — ${ok}`);
      continue;
    }
    unaccepted++;
    console.log(`  BIG-ONLY TRAP ${span}  standing on y=${r.y}  ${how}  (${r.preds} way(s) in)`);
  }
  return unaccepted;
}

// ---------------------------------------------------------------------------
// Known and ACCEPTED traps
// ---------------------------------------------------------------------------
//
// A trap that is in the ORIGINAL is not a bug, and a sweep that stays red over
// one is a sweep people learn to ignore. These are still printed on every run —
// muting them from the count is not the same as hiding them — and `--strict`
// counts them anyway, which is how you check the detector is still alive.
//
// Nothing goes in here without a decision behind it. Name the decision.
const ACCEPTED = [
  {
    // 3-1b's coin pyramid. Big Mario is sealed in these four pockets: brick left,
    // brick right, and for (5,7) the SPENT ITEM BLOCK at (5,5) overhead, the one
    // tile in reach he cannot break. He cannot walk in at either side — he walks
    // in SMALL, bumps the mushroom brick over his head, and the frame he grows he
    // is two tiles tall in a one-tile pocket.
    //
    // Checked against the ROM and kept: our side probes match DoPlayerSideCheck
    // (asm:12026-12058) row for row, the room's tiles and its Brick(powerup) at
    // (5,5) match reference/smb-areas.json byte for byte, and the mushroom's trip
    // to him — emerge, walk right, off the ledge, reverse on a wall — is what
    // asm:7181-7196 / 12572-12577 / 12589-12610 describe. The original traps you
    // here too, and the level timer is its own way out.
    //
    // DECISION 2026-08-02: the user was shown this evidence and chose to keep it
    // faithful rather than alter the room. Do not "fix" 3-1b.
    area: '3-1/3-1b',
    cells: ['4,8', '5,7', '10,7', '11,8'],
    why: "the original's own geometry, kept deliberately (see ACCEPTED, 2026-08-02)",
  },
];

// Does an entire reported run fall inside one accepted entry? A run that has
// grown past its accepted cells is NOT accepted — that is a new trap touching an
// old one, and it must still turn the sweep red.
function acceptedCells(name, run) {
  for (const a of ACCEPTED) {
    if (a.area !== name) continue;
    let all = true;
    for (let x = run.x0; x <= run.x1 && all; x++) all = a.cells.includes(`${x},${run.y}`);
    if (all) return a.why;
  }
  return null;
}

// Spawns and warp destinations are written in mid-air; the player falls to the
// first surface below.
function landingNode(byKey, key, g, x, y) {
  const tx = Math.round(x);
  for (let ty = Math.round(y); ty < g.H; ty++) {
    const n = byKey.get(key(tx, ty));
    if (n) return n;
  }
  return null;
}

function nearestNode(nodes, x, y) {
  let best = null;
  let bd = Infinity;
  for (const n of nodes) {
    const d = Math.abs(n.x - x) * 4 + Math.abs(n.y - y);
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return bd <= 40 ? best : null;
}

// Every place the player can be PUT DOWN in `areaKey`: the destination of any
// warp anywhere in the level that names it. A sub-area is only ever entered
// through one of these, and its own `spawn` field is a generated fallback that
// frequently is not one of them — 3-1b's says the room floor while the pipe
// drops you in from the ceiling three rows above the coin pyramid.
function entriesInto(lvl, areaKey) {
  const out = [];
  const scan = (warps, selfKey) => {
    for (const wp of warps || []) {
      const to = wp.to;
      if (!to || to.level || to.complete) continue;
      const dest = to.area || selfKey;
      if (dest !== areaKey) continue;
      if (typeof to.x !== 'number' || typeof to.y !== 'number') continue;
      out.push({ x: to.x, y: to.y });
    }
  };
  scan(lvl.warps, 'main');
  for (const [aid, area] of Object.entries(lvl.areas || {})) scan(area.warps, aid);
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const dir = join(ROOT, 'src/data/levels');
  const files = readdirSync(dir)
    .filter((f) => /^(?:\d+|h)-\d+\.js$/.test(f))
    .sort();
  return (async () => {
    let total = 0;
    let checked = 0;
    for (const f of files) {
      const id = f.replace('.js', '');
      if (only && id !== only) continue;
      const mod = await import(pathToFileURL(join(dir, f)).href);
      const lvl = mod.default;
      if (only) applyPatches(lvl);
      const run = sizesFlag
        ? (n, l, a, e) => compareSizes(n, l, a, e)
        : (n, l, a, e) => analyse(n, l, a, bigFlag ? 2 : 1, e);
      total += run(id, lvl, 'main', entriesInto(lvl, 'main'));
      checked++;
      for (const [aid, area] of Object.entries(lvl.areas || {})) {
        total += run(`${id}/${aid}`, area, aid, entriesInto(lvl, aid));
        checked++;
      }
    }
    const what = sizesFlag ? 'big-only trap region' : 'trap region';
    console.log(
      total
        ? `\n${total} ${what}(s) found in ${checked} area(s).`
        : `\nNo ${what}s found in ${checked} area(s).`
    );
    process.exit(total ? 1 : 0);
  })();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
