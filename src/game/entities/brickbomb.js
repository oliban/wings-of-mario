import { Entity, registerEntity } from '../entity.js';
import { TILE } from '../../core/constants.js';
import * as ITEMS from '../../data/sprites/items.js';
import { animOf, fx, sfx } from './mushroom.js';
import { tileKey } from '../blocks.js';

// The BRICK BOMB — what the toolbelt throws.
//
// It is a player projectile like the fireball, but it is a TOOL, not a weapon:
// it passes over enemies without harming them and its whole purpose is the row
// of bricks it leaves behind.
//
// It is a real grenade. It arcs out of Mario's hand under gravity and goes off
// at the first of: touching a solid surface from any side, or its FUSE running
// out. Where it goes off is where the row forms — five bricks on the bomb's own
// tile row, starting at the bomb's own column, running the way it was thrown.
// That is the whole feature: land it on the ground and you get a step to jump
// onto; let the fuse expire over a pit or a lava lake and the row hangs in the
// air where the bomb was, which is the bridge.
//
// THE BOMB IS ALWAYS THROWN. A press he cannot afford still lobs a grenade; it
// just goes off as a DUD — a puff of smoke and no bricks. "Nothing happened
// when I pressed the button" is indistinguishable from a broken feature, and a
// dud is the cheapest way to say "yes, I heard you, and no, not this time".
//
// WIRING (player.js owns all of this, none of it lives here) — debit on the
// RESULT, not on the throw:
//   import BrickBomb, { BRICKBOMB_COST, throwBrickBomb } from '...';
//   throwBrickBomb(world, this, {
//     funded: this._coins() >= BRICKBOMB_COST,   // false => guaranteed dud
//     cost: 0,                                   // nothing prepaid
//     onResult: (r) => { if (!r.dud) this._spendCoins(BRICKBOMB_COST); },
//   });
// `onResult` fires exactly once, when the row has finished (or failed) laying:
//   { built: 0..5, dud: bool, reason: 'built'|'unfunded'|'no-room', tiles: [] }
//
// The older prepaid shape still works and is still correct: omit `funded` and
// `cost`, debit at throw time, and a bomb that lays nothing refunds itself.

// Coins per throw. The wiring imports this rather than keeping a second copy.
export const BRICKBOMB_COST = 1;

// Bricks in a row. There is no longer a "gap" constant: the gap between Mario
// and the row is whatever distance the bomb covered before it went off.
export const BRICK_ROW_LENGTH = 5;

// Bombs in flight at once.
export const BRICKBOMB_MAX = 2;

// ---------------------------------------------------------------------------
// Ballistics. Tuned by measurement, not by feel — the numbers below are what
// the flight actually produces, measured in the running game.
//
//   flat ground                   ->  lands frame 23, 110 px = 6.9 tiles
//   fuse 25 frames, unobstructed  ->  119 px = 7.4 tiles
//   apex                          ->  27 px = 1.69 tiles above the launch point
//   at the bang                   ->  centre 7 px below the launch feet line,
//                                     so the mid-air row still lands on the
//                                     thrower's own foot row
//
// THE THROW IS A ROTATION, NOT A FIXED ARC. How hard and which way Mario is
// moving when he presses is the whole input:
//
//   standing or rising straight up  ->  straight up, and the row forms over his
//                                       head, because the fuse ends at the apex
//   walking                         ->  a shallow lob, part of the way over
//   flat out                        ->  the old 45-degree throw, unchanged
//
// One number drives it: t, Mario's horizontal speed as a fraction of a full run
// (physics.js maxRunSpeed, 2.5625). t swings the launch angle from vertical to
// 45 degrees and scales the launch power, so range grows with speed twice over
// — a faster throw is both flatter and harder. Direction comes from which way
// he is MOVING, not which way he is facing, so a bomb thrown mid-skid goes the
// way he is actually travelling; facing only decides it when he is still.
//
// At t = 1 this reproduces the old throw exactly — vx 4.76, vy -4.76, fuse 25 —
// so everything measured below still holds at a full run:
//
//   flat ground                   ->  lands frame 23, 110 px = 6.9 tiles
//   fuse 25 frames, unobstructed  ->  119 px = 7.4 tiles
//   apex                          ->  27 px = 1.69 tiles above the launch point
//   at the bang                   ->  centre 7 px below the launch feet line,
//                                     so the mid-air row still lands on the
//                                     thrower's own foot row
//
// That 45-degree throw was a long one by request ("8-10 marios away"), taken to
// 75% on a second pass. The 75% was applied to the VELOCITY, not the fuse: at a
// fixed angle range goes as v-squared, so the speed is the old 5.5 x sqrt(0.75)
// = 4.76 and both range and apex came out at three quarters on any terrain.
// Cutting the fuse would have left the old flat trajectory chopped off part-way
// — a different shape, not a shorter throw of the same shape.
//
// THE FUSE IS DERIVED, NOT A CONSTANT, because the two ends want opposite
// things. A flat throw has to still be FALLING PAST the feet line when it goes
// off or the row forms a tile high and you have to jump to your own bridge; a
// vertical throw has to go off at the TOP or it falls back to the height it was
// thrown from and builds at Mario's feet instead of over his head. Both come
// out of one expression: burn to the apex, then a share of the way down that
// grows with t. At t = 0 that is the apex exactly, at t = 1 it is 25 frames,
// the middle of the old three-frame window (the centre crossed the feet line at
// 24 and was a row lower by 27).
//
// Nothing here may exceed TILE (16) per step or the bomb would tunnel through
// thin walls: peak vy is 5.74 at the longest fuse, under both TILE and MAX_FALL.
export const BRICKBOMB_GRAVITY = 0.42;
export const BRICKBOMB_MAX_FALL = 8;

// Launch power at a standstill and at a full run. The upper number is the old
// 45-degree throw's speed as a vector: sqrt(4.76^2 + 4.76^2).
const THROW_POWER_MIN = 5.2;
const THROW_POWER_MAX = 6.732;

// The speed that counts as "flat out" — physics.js maxRunSpeed. Local rather
// than imported so the ballistics stay one self-contained block, but it must
// track that value: if it drifts low, every run throw pins at 45 degrees.
const THROW_FULL_SPEED = 2.5625;

// Below this Mario counts as not moving horizontally, and facing decides the
// direction instead. Loose enough to swallow the drift left by a skid.
const THROW_DIR_EPS = 0.12;

// How far past the apex the fuse burns, as a multiple of the climb, at a full
// run. Chosen so t = 1 lands on 25 frames exactly.
const THROW_DESCENT_SHARE = 1.2;

// The longest a fuse can ever be, so callers that want a bound have one.
export const BRICKBOMB_FUSE = 25;

// Kept for anything that still imports them: the flat-out throw's components.
export const BRICKBOMB_SPEED = 4.76;
export const BRICKBOMB_LAUNCH_VY = -4.76;

// The bomb leaves the hand at a fixed height above the FEET, not at a fraction
// of the body. Big and small Mario are a whole tile apart in height, so a
// body-relative launch put the two arcs one tile apart at the far end — and one
// tile is the difference between a bridge you walk onto and one you have to
// jump to. One launch height, one arc, both sizes, ducking included.
const LAUNCH_ABOVE_FEET = 10;
const BOMB_W = 10;
const BOMB_H = 10;

// Frames between bricks as the row sweeps out.
const SWEEP_STEP = 3;

const BOMB_PAL = [
  '#12080a',
  '#2a2a38',
  '#4a4a60',
  '#8a8aa0',
  '#ffffff',
  '#8a4a14',
  '#ef9a49',
  '#ffd830',
];

const BOMB_A = [
  '.......76...',
  '......076...',
  '......50....',
  '.....50.....',
  '...00000....',
  '..0332220...',
  '.034322210..',
  '.033222110..',
  '.022221110..',
  '.022111110..',
  '..0211110...',
  '...00000....',
];

const BOMB_B = [
  '.......67...',
  '......067...',
  '......50....',
  '.....50.....',
  '...00000....',
  '..0332220...',
  '.033222210..',
  '.034222110..',
  '.022221110..',
  '.022111110..',
  '..0211110...',
  '...00000....',
];

const AUTHORED =
  (ITEMS.BRICK_BOMB && (ITEMS.BRICK_BOMB.fly || ITEMS.BRICK_BOMB.idle)) ||
  (ITEMS.TOOLBELT && ITEMS.TOOLBELT.bomb) ||
  ITEMS.BRICK_BOMB;

const BOMB_ANIM = animOf(AUTHORED, [BOMB_A, BOMB_B], BOMB_PAL, { name: 'brickbomb' }, 4);

function num(v, d) {
  return typeof v === 'number' && isFinite(v) ? v : d;
}

// ---------------------------------------------------------------------------
// Flight. The live bomb and the dry-run prediction MUST agree exactly, so both
// go through these two functions and neither keeps a copy of the maths. `s` is
// anything carrying x, y, vx, vy, w, h — the entity itself, or a plain object.
// ---------------------------------------------------------------------------

export function launchState(thrower, dir) {
  const pvx = num(thrower.vx, 0);
  const speed = Math.abs(pvx);

  // Which way he is TRAVELLING, falling back to facing when he is not.
  const d = speed >= THROW_DIR_EPS ? (pvx < 0 ? -1 : 1) : dir === -1 ? -1 : 1;

  // t: nothing at a standstill, 1 flat out. Everything else follows from it.
  const t = Math.min(1, speed / THROW_FULL_SPEED);
  const ang = t * (Math.PI / 4); // measured from straight up
  const power = THROW_POWER_MIN + (THROW_POWER_MAX - THROW_POWER_MIN) * t;
  const vx = d * power * Math.sin(ang);
  const vy = -power * Math.cos(ang);

  // Burn to the apex, then a share of the way back down that grows with t. The
  // climb is not rounded before it is scaled — rounding first costs a frame at
  // full run and drops the fuse out of its window.
  const climb = -vy / BRICKBOMB_GRAVITY;
  const fuse = Math.max(1, Math.round(climb * (1 + t * THROW_DESCENT_SHARE)));

  const feet = thrower.y + thrower.h;
  return {
    w: BOMB_W,
    h: BOMB_H,
    // A vertical throw leaves the hand over his head, not out to one side, or
    // the row it builds sits a tile off from the column he is standing in.
    x: thrower.x + thrower.w * 0.5 + d * 6 * Math.sin(ang) - BOMB_W * 0.5,
    y: feet - LAUNCH_ABOVE_FEET - BOMB_H * 0.5,
    vx,
    vy,
    dir: d,
    fuse,
  };
}

// One tick of flight. Returns true when the bomb struck a solid — from any
// side, which includes landing on top of one. `s` is left resolved against the
// surface it hit, so its tile row and column are the ones the row forms on.
export function stepBomb(world, s) {
  s.vy = Math.min(s.vy + BRICKBOMB_GRAVITY, BRICKBOMB_MAX_FALL);

  s.x += s.vx;
  const yt = s.y + 1;
  const yb = s.y + s.h - 1;
  if (s.vx > 0 && (world.solidAt(s.x + s.w, yt) || world.solidAt(s.x + s.w, yb))) {
    s.x = Math.floor((s.x + s.w) / TILE) * TILE - s.w;
    return true;
  }
  if (s.vx < 0 && (world.solidAt(s.x, yt) || world.solidAt(s.x, yb))) {
    s.x = (Math.floor(s.x / TILE) + 1) * TILE;
    return true;
  }

  s.y += s.vy;
  const xl = s.x + 1;
  const xr = s.x + s.w - 1;
  if (s.vy > 0) {
    const by = s.y + s.h;
    if (world.solidAt(xl, by, 'down') || world.solidAt(xr, by, 'down')) {
      s.y = Math.floor(by / TILE) * TILE - s.h;
      return true;
    }
  } else if (s.vy < 0) {
    if (world.solidAt(xl, s.y) || world.solidAt(xr, s.y)) {
      s.y = (Math.floor(s.y / TILE) + 1) * TILE;
      return true;
    }
  }
  return false;
}

// Fly the whole throw without spawning anything and without touching the world.
// Returns the resolved end state.
export function simulateThrow(world, thrower, dir) {
  const s = launchState(thrower, dir);
  for (let i = 0; i < s.fuse; i++) {
    if (stepBomb(world, s)) break;
  }
  return s;
}

// The tile the row starts on, from a bomb (or a simulated bomb) at rest. The
// CENTRE decides, not an edge: a bomb resting on the ground has its bottom
// exactly on the tile boundary, and a floor()ed edge would name the floor tile
// it is standing on rather than the empty tile it is standing in.
export function rowOriginOf(s) {
  return {
    tx: Math.floor((s.x + s.w * 0.5) / TILE),
    ty: Math.floor((s.y + s.h * 0.5) / TILE),
  };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

// Every body a brick must not be conjured inside. world.players exists in
// co-op; world.player alone otherwise.
function bodiesOf(world) {
  const out = [];
  if (!world) return out;
  const roster = Array.isArray(world.players) && world.players.length ? world.players : [];
  for (const p of roster) if (p) out.push(p);
  if (world.player && out.indexOf(world.player) < 0) out.push(world.player);
  const list = world.entities || [];
  for (const e of list) {
    if (!e || e.removed || e.dead) continue;
    if (e.tangible === false) continue;
    if (e.isFireball || e.isBrickBomb) continue;
    if (out.indexOf(e) < 0) out.push(e);
  }
  return out;
}

// What a brick may be built THROUGH. Air, obviously — but also lava, water and
// scenery, none of which are structure.
//
// This was an air-only whitelist and it was wrong twice over. Bridging a lava
// lake is the signature use of the tool and Harry's level is a lava crossing
// end to end, yet a row laid at lava level found every tile "occupied" and the
// throw was refused outright — stand on h-1's shore, press RUN, nothing
// happens. The same rule silently ate two bricks of every five-brick row thrown
// across 1-1's opening, because row 12 there is `hhhhh......bbbbbhhh` and a
// bush is not air. Same bug, two symptoms.
//
// Structure stays sacred: solid (ground, blocks, bricks, pipes, used blocks,
// castle brick, coral, cannons), one-way platforms, the flagpole, the castle
// axe, an invisible question block, a spawn anchor, and a free coin nobody
// wants deleted.
function buildableTile(rec) {
  if (!rec) return false;
  if (rec.solid || rec.platform || rec.climb || rec.question) return false;
  if (rec.axe || rec.anchor || rec.coin) return false;
  return true;
}

// A brick may go here only if the tile is inside the level, is buildable by the
// rule above, and no body is standing in it. `ignore` is the bomb itself.
export function canPlaceBrickAt(world, tx, ty, ignore) {
  if (!world) return false;
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return false;
  if (!buildableTile(world.recAt(tx, ty))) return false;
  const px = tx * TILE;
  const py = ty * TILE;
  for (const b of bodiesOf(world)) {
    if (b === ignore) continue;
    if (b.x < px + TILE && b.x + b.w > px && b.y < py + TILE && b.y + b.h > py) return false;
  }
  return true;
}

// The five tile POSITIONS a row would occupy, obstructions ignored. Geometry
// only — most callers want brickRowTiles() below.
export function rowCandidates(world, thrower, dir) {
  const out = [];
  if (!world || !thrower) return out;
  // The row runs the way the bomb was THROWN, which is not always the way the
  // caller asked for: launchState prefers Mario's travel to his facing.
  const s = simulateThrow(world, thrower, dir);
  const { tx, ty } = rowOriginOf(s);
  for (let i = 0; i < BRICK_ROW_LENGTH; i++) out.push({ tx: tx + s.dir * i, ty });
  return out;
}

// The tiles a throw would ACTUALLY fill, in build order — WITHOUT throwing. The
// row position is not known until the bomb goes off, but it is perfectly
// predictable: this flies the same arc through the same stepBomb() the live
// bomb uses.
//
// CONTIGUOUS. The row runs outward from the detonation point and STOPS DEAD at
// the first tile it cannot build. It never skips an obstruction and resumes on
// the far side. Every tile of a split row is individually legal, which is
// exactly why the old behaviour read as a bug rather than as a rule: a throw
// from h-1's shore detonated against building A and laid bricks at columns 8
// and 12 with three tiles of stone between them — two disconnected bricks for
// the price of a bridge. A bridge with a hole in it is not a bridge.
//
// Same at the level edge and against a ceiling: out-of-bounds and solid both
// fail canPlaceBrickAt(), so both stop the run rather than interrupting it.
export function brickRowTiles(world, thrower, dir) {
  const run = [];
  for (const t of rowCandidates(world, thrower, dir)) {
    if (!canPlaceBrickAt(world, t.tx, t.ty, null)) break;
    run.push(t);
  }
  return run;
}

// Why a throw would be refused, for the caller's feedback. Affordability is not
// in here: the wallet is the caller's, and 'cannot afford' is its own answer.
export const THROW_OK = 'ok';
export const THROW_NO_ROOM = 'no-room';
export const THROW_TOO_MANY = 'too-many';

// How a bomb ended, reported through `bomb.result` and `opts.onResult`.
export const BOMB_BUILT = 'built';
export const BOMB_UNFUNDED = 'unfunded';
export const BOMB_NO_ROOM = THROW_NO_ROOM;

// Everything a caller needs to decide, and to say WHY, in one call:
//   { reason, tiles, buildable, origin }
// `tiles` is the contiguous run that would be laid and `buildable` is its
// length, so `reason === THROW_OK` means the throw is worth charging for.
export function planThrow(world, thrower, dir) {
  const d = dir === -1 ? -1 : 1;
  const tiles = brickRowTiles(world, thrower, d);
  const reason = !BrickBomb.canSpawn(world)
    ? THROW_TOO_MANY
    : tiles.length === 0
      ? THROW_NO_ROOM
      : THROW_OK;
  return { reason, tiles, buildable: tiles.length, origin: tiles[0] || null };
}

// The one call the wiring needs. Returns the entity, or null if the throw was
// refused (too many bombs already in flight).
export function throwBrickBomb(world, thrower, opts) {
  if (!world || !thrower) return null;
  if (!BrickBomb.canSpawn(world)) return null;
  const o = opts || {};
  const dir = o.dir || (thrower.facing === -1 ? -1 : 1);
  // An unfunded bomb cannot have been paid for, so it defaults to owing
  // nothing. Defaulting it to BRICKBOMB_COST would have the dud REFUND a price
  // that was never paid.
  const funded = o.funded !== false;
  return world.spawn('brickbomb', thrower.x, thrower.y, {
    cost: funded ? BRICKBOMB_COST : 0,
    ...o,
    dir,
    owner: thrower,
  });
}

export default class BrickBomb extends Entity {
  static type = 'brickbomb';
  static MAX = BRICKBOMB_MAX;
  static COST = BRICKBOMB_COST;

  static count(world) {
    let n = 0;
    const list = (world && world.entities) || [];
    for (const e of list) if (e instanceof BrickBomb && !e.removed && !e.landed) n++;
    return n;
  }

  static canSpawn(world) {
    return BrickBomb.count(world) < BRICKBOMB_MAX;
  }

  constructor(world, x, y, opts = {}) {
    super(world, x, y, opts);
    this.w = BOMB_W;
    this.h = BOMB_H;
    this.t = 0;
    this.isBrickBomb = true;
    this.friendly = true;
    this.tangible = false;
    this.autoCorpse = false;
    this.despawnOffscreen = false;
    this.facing = opts.dir === -1 ? -1 : 1;

    const owner = opts.owner || world.player;
    this.owner = owner || null;

    // May this bomb build at all? false = the player could not pay, so it is a
    // guaranteed dud: it still flies, it still goes off, it just puffs.
    this.funded = opts.funded !== false;

    // What the throw was ALREADY charged, so a throw that builds nothing can
    // hand it back. Only throwBrickBomb() sets this; a bare
    // world.spawn('brickbomb') from a level or a probe is free. An unfunded
    // bomb owes nothing by construction — it must never pay out.
    this.cost = this.funded ? num(opts.cost, 0) : 0;
    this.refunded = false;

    // Fires once, when the row has finished (or failed) laying. This is how the
    // wiring knows whether to take the money.
    this.onResult = typeof opts.onResult === 'function' ? opts.onResult : null;
    this.result = null;
    this.tilesLaid = [];

    const src = owner || { x, y, w: 16, h: 16 };
    const s = launchState(src, this.facing);
    this.x = s.x;
    this.y = s.y;
    this.vx = s.vx;
    this.vy = s.vy;
    // The row sweeps the way the bomb went, which launchState may have taken
    // from Mario's travel rather than his facing. Without this a bomb thrown
    // mid-skid flies one way and builds the other.
    this.facing = s.dir;

    this.fuse = num(opts.fuse, s.fuse);
    this.landed = false;
    this.rowY = 0;
    this.firstTx = 0;
    this.sweep = 0;
    this.placed = 0;
    this.builtCount = 0;

    if (BrickBomb.count(world) >= BRICKBOMB_MAX) this.removed = true;
    else sfx(world, 'kick');
  }

  placeBrick(tx, ty) {
    const w = this.world;
    if (!canPlaceBrickAt(w, tx, ty, this)) return false;
    w.setTile(tx, ty, '=');
    // A tile that once held a bumped or emptied block may still carry that
    // block's state; the fresh brick must start clean or it would refuse to
    // shatter. shatter() clears the same entry (blocks.js:540).
    const bs = w.blocks;
    if (bs && bs.state && typeof bs.state.delete === 'function') bs.state.delete(tileKey(tx, ty));
    if (bs && bs.bumps && typeof bs.bumps.delete === 'function') bs.bumps.delete(tileKey(tx, ty));
    fx(w, 'landingDust', tx * TILE + TILE * 0.5, ty * TILE + TILE, 0.8);
    sfx(w, 'bump');
    this.builtCount++;
    this.tilesLaid.push({ tx, ty });
    return true;
  }

  // Length of the CONTIGUOUS run from the detonation point outward — not how
  // many of the five are individually free. A row that has to jump an
  // obstruction is a shorter row, not a split one, so the dud test has to ask
  // the same question the sweep will: how far can it get before it stops?
  _roomCount() {
    let n = 0;
    for (let i = 0; i < BRICK_ROW_LENGTH; i++) {
      if (!canPlaceBrickAt(this.world, this.firstTx + this.facing * i, this.rowY, this)) break;
      n++;
    }
    return n;
  }

  // The wiring pre-checks with brickRowTiles() and only charges for a throw
  // that had somewhere to build. That test reads TILES; bodies are the bomb's
  // business and can still eat the whole row — five tiles, every one occupied —
  // between the press and the bang. Rare, but it is the one remaining case that
  // would take the price for nothing, so the money goes back.
  _refund() {
    const w = this.world;
    if (!w || !this.cost || this.refunded) return;
    this.refunded = true;
    // Harry mode's addCoin is a plain wallet add: no 100-coin reset, no 1-up,
    // no coin sound. Outside Harry mode there is no toolbelt, but a direct
    // write keeps a stray refund from paying out a free life.
    if (w.harryMode === true && typeof w.addCoin === 'function') w.addCoin(this.cost);
    else w.coins = (w.coins | 0) + this.cost;
  }

  detonate() {
    if (this.landed) return;
    this.landed = true;
    this.vx = 0;
    this.vy = 0;
    const o = rowOriginOf(this);
    this.firstTx = o.tx;
    this.rowY = o.ty;
    this.sweep = 0;
    this.placed = 0;

    if (!this.funded || this._roomCount() === 0) {
      this._fizzle();
      return;
    }

    fx(this.world, 'fireballBurst', this.x + this.w * 0.5, this.y + this.h * 0.5);
    sfx(this.world, 'brick-break');
    if (this.world && typeof this.world.shake === 'function') this.world.shake(1.2, 6);
  }

  // The dud. Deliberately nothing like the real thing: a real detonation is a
  // bright burst, a shake and five hammer blows walking away from you, this is
  // one small puff of smoke and a soft thud. No shake — the screen kicking for
  // a throw that did nothing would read as an effect, not as a failure.
  _fizzle() {
    const w = this.world;
    const cx = this.x + this.w * 0.5;
    const cy = this.y + this.h * 0.5;
    fx(w, 'enemyPoof', cx, cy);
    fx(w, 'landingDust', cx, cy + 4, 0.5);
    sfx(w, 'bump');
    // Skip the sweep entirely; the next tick finalises and reports.
    this.placed = BRICK_ROW_LENGTH;
  }

  // Runs once, after the row has finished laying or the dud has puffed.
  _finish() {
    if (!this.result) {
      const dud = this.builtCount === 0;
      if (dud) this._refund();
      this.result = {
        built: this.builtCount,
        dud,
        reason: dud ? (this.funded ? BOMB_NO_ROOM : BOMB_UNFUNDED) : BOMB_BUILT,
        tiles: this.tilesLaid,
      };
      if (this.onResult) {
        try {
          this.onResult(this.result, this);
        } catch (err) {
          /* a broken listener must not strand the bomb */
        }
      }
    }
    this.removed = true;
  }

  update() {
    this.t++;

    if (this.landed) {
      // Sweep the row out one brick at a time, away from the thrower.
      if (this.placed >= BRICK_ROW_LENGTH) {
        this._finish();
        return;
      }
      if (this.sweep % SWEEP_STEP === 0) {
        // Stop at the first tile that will not take a brick — never skip it and
        // carry on past. Ending the run early is the whole point: the row must
        // come out as one unbroken bridge or not at all.
        if (!this.placeBrick(this.firstTx + this.facing * this.placed, this.rowY)) {
          this.placed = BRICK_ROW_LENGTH;
          return;
        }
        this.placed++;
      }
      this.sweep++;
      return;
    }

    const w = this.world;
    if (stepBomb(w, this)) {
      this.detonate();
      return;
    }

    this.fuse--;
    if (this.fuse <= 0) {
      this.detonate();
      return;
    }

    // Nothing below the level to land on: go off where it is and let the AIR
    // test decide what, if anything, survives.
    const lvl = w && w.level;
    if (this.y > ((lvl && lvl.height) || 15) * TILE + 64) this.detonate();
  }

  // Inert to everything. It is a tool, not a weapon.
  onPlayerTouch() {
    return false;
  }

  onStomp() {
    return false;
  }

  onFireball() {
    return false;
  }

  kill() {
    this.removed = true;
  }

  draw(ctx, cam) {
    if (this.landed) return;
    const spr = BOMB_ANIM.frame(this.t);
    const sx = Math.floor(this.x - cam.x + (this.w - spr.w) * 0.5);
    const sy = Math.floor(this.y - cam.y + (this.h - spr.h) * 0.5);
    spr.draw(ctx, sx, sy, this.facing === -1);
  }
}

registerEntity(BrickBomb);
registerEntity('brick-bomb', BrickBomb);
registerEntity('bomb', BrickBomb);
