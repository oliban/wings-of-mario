// Block behaviour: the bump, the coin pop, the shatter, multi-coin bricks, and
// the item that rises out of a struck block.
//
// Pixels and pixels-per-frame at a fixed 1/60.0988 s step. Nothing here
// multiplies by dt. +Y is DOWN. x,y is the TOP-LEFT of the hitbox.

import { TILE, SCREEN_H } from '../core/constants.js';
import { Rng } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Bump curve. A struck block travels 8px up and back down over 10 frames on a
// clean parabola: y(t) = v0*t + g*t^2/2 with v0 = -3.2, g = 0.64.
//   t=0 -> 0      t=5 -> -8 (apex)      t=10 -> 0
// ---------------------------------------------------------------------------
export const BUMP_FRAMES = 10;
const BUMP_V0 = -3.2;
const BUMP_G = 0.64;

export function bumpOffset(t) {
  if (t <= 0 || t >= BUMP_FRAMES) return 0;
  return BUMP_V0 * t + 0.5 * BUMP_G * t * t;
}

// Coin popped from a block: up 5 tiles (80px) and back, spinning.
const COIN_V0 = -12;
const COIN_G = 0.9;

const DEBRIS_G = 0.42;

// Multi-coin brick. It is a CLOCK, not a counter: PlayerHeadCollision
// (smbdis.asm:7245-7257) recognises metatile $58/$5d, loads BrickCoinTimer with
// $0b on the first hit, and on every hit restores the OLD brick metatile while
// that timer is still running. The coin total is therefore however many bumps
// fit inside the window, never a fixed ten.
//
// $079d is an INTERVAL timer, not a frame timer. DecTimersLoop (asm:789-799)
// walks offsets $00-$14 every frame but only reaches $15-$23 when
// IntervalTimerControl underflows, which is once every 21 frames. So $0b
// interval ticks is 11 * 21 = 231 frames, a little under four seconds.
//
// The ROM's timer is one global, shared by every multi-coin brick in the game,
// and its companion flag is cleared when a BrickWithCoins object is RENDERED
// (asm:4183-4185). We keep it per block instead. No two multi-coin bricks in
// the game are within 34 columns of each other, so the second is always
// re-rendered — clearing the flag — long before the first could still be
// running, and the two models cannot be told apart in play.
const MULTICOIN_TICKS = 0x0b;
const INTERVAL_FRAMES = 21;

// Item emerging from a block, drawn behind the tile layer. GrowThePowerUp
// (smbdis.asm:7181-7196) opens with `lda FrameCounter / and #$03 / bne ChkPUSte`
// and only then does `dec Enemy_Y_Position+5` — one pixel every FOURTH frame.
// So the 16px rise takes 64 frames, not the 32 that 0.5 px/frame gave it.
const EMERGE_SPEED = 0.25;

const ITEM_GRAVITY = 0.35;
const ITEM_MAX_FALL = 4.5;
// `lda #$10 / sta Enemy_X_Speed,x` at the end of GrowThePowerUp (asm:7190-7191).
// Speeds are sixteenths of a pixel per frame — anchored by NormalXSpdData
// `.db $f8, $f4` (asm:8162), the goomba's own 0.5 — so $10 is exactly 1.0.
//
// DUPLICATED: entities/mushroom.js:83 exports the same constant for items that
// did not come out of a block. Both must move together; they are separate only
// because there is no shared home for an item constant yet (PHYS would be it).
const ITEM_WALK = 1.0;
const STAR_BOUNCE = -5.6;
const STAR_WALK = 1.35;

// ---------------------------------------------------------------------------
// Harry mode's toolbelt blocks.
//
// Exactly this many of the level's plain coin question blocks give up a toolbelt
// instead, chosen from a seed derived from the level id so the same run always
// produces the same two blocks. Math.random() here would make tools/reach.mjs
// and tools/playthrough.mjs disagree with themselves between runs.
// ---------------------------------------------------------------------------
const TOOLBELT_BLOCKS = 2;

function seedFor(id) {
  let h = 0x811c9dc5;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0 || 1;
}

// Packed tile key, shared with world.js so per-tile tables agree.
export const tileKey = (tx, ty) => (ty << 12) | (tx & 0xfff);
const key = tileKey;

function isSprite(v) {
  return !!v && typeof v.draw === 'function' && typeof v.w === 'number';
}
function isAnim(v) {
  return !!v && typeof v.frame === 'function';
}
function frameOf(art, tick) {
  if (isAnim(art)) return art.frame(tick);
  if (isSprite(art)) return art;
  return null;
}
// Every still of an animation, for art that is used as a set of variants rather
// than as a sequence (the four shards of a shattered brick).
function framesOf(art) {
  if (isAnim(art) && Array.isArray(art.frames)) return art.frames.filter(isSprite);
  if (isSprite(art)) return [art];
  return [];
}

// ---------------------------------------------------------------------------
// Coin that pops out of a bumped block. Purely visual: the coin is banked the
// instant the block is struck, exactly as in the original.
// ---------------------------------------------------------------------------
export class BumpCoin {
  constructor(world, x, y) {
    this.world = world;
    this.x = x;
    this.y = y;
    this.y0 = y;
    this.vy = COIN_V0;
    this.t = 0;
    this.dead = false;
    this.w = TILE;
    this.h = TILE;
  }

  update() {
    this.t++;
    this.vy += COIN_G;
    this.y += this.vy;
    if (this.vy > 0 && this.y >= this.y0) {
      this.y = this.y0;
      this.dead = true;
      this.world.fx('coinSparkle', this.x + TILE * 0.5, this.y + TILE * 0.5);
    }
  }

  draw(ctx, cam) {
    const s = frameOf(this.world.art.coin, this.t * 2);
    if (!s) return;
    s.draw(
      ctx,
      Math.floor(this.x - cam.x + (TILE - s.w) * 0.5),
      Math.floor(this.y - cam.y + (TILE - s.h) * 0.5)
    );
  }
}

// ---------------------------------------------------------------------------
// One quarter of a shattered brick. It tumbles by cycling the four mirror
// states of its source pixels — how the NES faked rotation. Hard edges, no
// interpolation, no smoothing.
// ---------------------------------------------------------------------------
export class BrickDebris {
  constructor(world, x, y, vx, vy, canvas, sub) {
    this.world = world;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.canvas = canvas;
    this.sub = sub;
    this.t = 0;
    this.dead = false;
    this.spin = vx < 0 ? -1 : 1;
  }

  update() {
    this.t++;
    this.vy += DEBRIS_G;
    this.x += this.vx;
    this.y += this.vy;
    if (this.t > 200 || this.y > this.world.cam.y + SCREEN_H + 48) this.dead = true;
  }

  draw(ctx, cam) {
    if (!this.canvas) return;
    const sw = this.sub ? this.sub.sw : this.canvas.width;
    const sh = this.sub ? this.sub.sh : this.canvas.height;
    const dx = Math.floor(this.x - cam.x);
    const dy = Math.floor(this.y - cam.y);
    const phase = (((Math.floor(this.t / 4) * this.spin) % 4) + 4) % 4;
    const flipX = phase === 1 || phase === 2;
    const flipY = phase === 2 || phase === 3;
    ctx.save();
    ctx.translate(dx + (flipX ? sw : 0), dy + (flipY ? sh : 0));
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    if (this.sub) ctx.drawImage(this.canvas, this.sub.sx, this.sub.sy, sw, sh, 0, 0, sw, sh);
    else ctx.drawImage(this.canvas, 0, 0);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Fallback power-up. Used only when the entity registry has no class for the
// item a block yielded, so a question block is never silent. The registry
// always wins once the real item entities land.
// ---------------------------------------------------------------------------
export class FallbackItem {
  constructor(world, kind, x, y) {
    this.world = world;
    this.kind = kind;
    this.type = kind;
    this.x = x;
    this.y = y;
    this.w = TILE;
    this.h = TILE;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.grounded = false;
    this.dead = false;
    this.removed = false;
    this.tick = 0;
    this.isItem = true;
    this.tangible = true;
    this.rooted = kind === 'fireflower';
    this.bouncy = kind === 'star';
    this.emerging = false;
    this.suspended = false;
  }

  onEmerged() {
    this.world.fx('powerupSparkle', this.x + this.w * 0.5, this.y + this.h * 0.5);
    if (this.rooted) return;
    this.vx = (this.bouncy ? STAR_WALK : ITEM_WALK) * this.facing;
  }

  onBlockBump() {
    if (this.rooted) return;
    this.vy = -3.6;
    this.grounded = false;
  }

  update() {
    this.tick++;
    if (this.rooted) return;
    this.vy = Math.min(this.vy + ITEM_GRAVITY, ITEM_MAX_FALL);
    this._moveX();
    this._moveY();
    if (this.bouncy && this.grounded) this.vy = STAR_BOUNCE;
    const cam = this.world.cam;
    if (this.x + this.w < cam.x - 32 || this.y > this.world.h * TILE + 64) this.removed = true;
  }

  _moveX() {
    const w = this.world;
    this.x += this.vx;
    const ys = [this.y + 3, this.y + this.h - 4];
    if (this.vx > 0) {
      const px = this.x + this.w;
      for (const py of ys) {
        if (!w.solidAt(px, py)) continue;
        this.x = Math.floor(px / TILE) * TILE - this.w;
        this.vx = -this.vx;
        this.facing = -this.facing;
        return;
      }
    } else if (this.vx < 0) {
      const px = this.x;
      for (const py of ys) {
        if (!w.solidAt(px, py)) continue;
        this.x = (Math.floor(px / TILE) + 1) * TILE;
        this.vx = -this.vx;
        this.facing = -this.facing;
        return;
      }
    }
  }

  _moveY() {
    const w = this.world;
    this.y += this.vy;
    const xs = [this.x + 3, this.x + this.w - 4];
    if (this.vy > 0) {
      const py = this.y + this.h;
      for (const px of xs) {
        if (!w.solidAt(px, py, 'down')) continue;
        this.y = Math.floor(py / TILE) * TILE - this.h;
        this.vy = 0;
        this.grounded = true;
        return;
      }
      this.grounded = false;
    } else if (this.vy < 0) {
      const py = this.y;
      for (const px of xs) {
        if (!w.solidAt(px, py)) continue;
        this.y = (Math.floor(py / TILE) + 1) * TILE;
        this.vy = 0;
        return;
      }
    }
  }

  onStomp() {
    return false;
  }

  onPlayerTouch(player) {
    if (this.removed) return false;
    this.removed = true;
    const w = this.world;
    const cx = this.x + this.w * 0.5;
    if (this.kind === '1up') {
      if (typeof player.powerUp === 'function') player.powerUp('1up');
      else w.addLife(1, cx, this.y);
      return true;
    }
    w.addScore(1000, cx, this.y);
    const name = this.kind === 'fireflower' ? 'flower' : this.kind;
    if (typeof player.powerUp === 'function') player.powerUp(name);
    w.fx('powerupSparkle', cx, this.y + this.h * 0.5);
    return true;
  }

  draw(ctx, cam) {
    const s = frameOf(this.world.art[this.kind], this.tick);
    if (!s) return;
    s.draw(
      ctx,
      Math.floor(this.x - cam.x + (this.w - s.w) * 0.5),
      Math.floor(this.y - cam.y + (this.h - s.h))
    );
  }
}

// ---------------------------------------------------------------------------
// BlockSystem — per-tile block state, the bump animation, and the debris and
// coins the bumps throw off.
// ---------------------------------------------------------------------------
export class BlockSystem {
  constructor(world) {
    this.world = world;
    this.bumps = new Map(); // key -> { tx, ty, t }
    this.state = new Map(); // key -> { used, multicoin, timer, hits }
    this.effects = [];
    this.rng = new Rng(0x1b10c5);
    this._shardCache = new WeakMap();
    this.toolTiles = new Set();
    // IntervalTimerControl, which the ROM inits to $14 and decrements once a
    // frame; the interval timers step on the frame it underflows.
    this._interval = INTERVAL_FRAMES - 1;
  }

  reset() {
    this.bumps.clear();
    this.state.clear();
    this._interval = INTERVAL_FRAMES - 1;
    this.effects.length = 0;
    this._pickToolbeltTiles();
  }

  // Called once per level/area load, after world.js has built the tile map and
  // the contents overrides. Outside Harry mode this only clears the set, so
  // every other mode sees the level exactly as it was authored.
  _pickToolbeltTiles() {
    const set = this.toolTiles;
    set.clear();
    const w = this.world;
    if (!w || w.harryMode !== true) return;
    // Main area only: a bonus room's coin blocks stay coin blocks.
    if (w.areaId) return;

    const cands = [];
    for (let ty = 0; ty < w.h; ty++) {
      for (let tx = 0; tx < w.w; tx++) {
        const rec = w.recAt(tx, ty);
        // Visible '?' blocks holding a plain coin. Hidden blocks are skipped —
        // a power-up nobody can see is a power-up nobody finds — and so is any
        // tile the level's `contents` list has already spoken for.
        if (!rec || rec.question !== true || rec.invisible === true) continue;
        if (rec.item !== 'coin') continue;
        if (w.contents && w.contents.get(key(tx, ty))) continue;
        cands.push(key(tx, ty));
      }
    }
    if (!cands.length) return;

    const rng = new Rng(seedFor((w.level && w.level.id) || w.levelId));
    const n = Math.min(TOOLBELT_BLOCKS, cands.length);
    for (let i = 0; i < n; i++) {
      const j = i + rng.int(0, cands.length - 1 - i);
      const t = cands[i];
      cands[i] = cands[j];
      cands[j] = t;
      set.add(cands[i]);
    }
  }

  stateAt(tx, ty, create = false) {
    const k = key(tx, ty);
    let s = this.state.get(k);
    if (!s && create) {
      s = { used: false, multicoin: false, timer: 0, hits: 0 };
      this.state.set(k, s);
    }
    return s;
  }

  isUsed(tx, ty) {
    const s = this.state.get(key(tx, ty));
    return !!(s && s.used);
  }

  // Render offset for a tile, in pixels (negative = up).
  offsetAt(tx, ty) {
    if (this.bumps.size === 0) return 0;
    const b = this.bumps.get(key(tx, ty));
    return b ? bumpOffset(b.t) : 0;
  }

  isBumping(tx, ty) {
    return this.bumps.has(key(tx, ty));
  }

  update() {
    for (const [k, b] of this.bumps) {
      b.t++;
      if (b.t >= BUMP_FRAMES) this.bumps.delete(k);
    }
    // The brick does NOT close itself when the clock runs out. The ROM picks the
    // metatile to restore at bump time (asm:7254-7257), so an expired multi-coin
    // brick keeps its face until something strikes it again — however long the
    // player is away.
    if (--this._interval < 0) {
      this._interval = INTERVAL_FRAMES - 1;
      for (const s of this.state.values()) if (s.timer > 0) s.timer--;
    }
    const fx = this.effects;
    let n = 0;
    for (let i = 0; i < fx.length; i++) {
      const e = fx[i];
      e.update();
      if (!e.dead) fx[n++] = e;
    }
    fx.length = n;
  }

  drawEffects(ctx, cam) {
    for (let i = 0; i < this.effects.length; i++) this.effects[i].draw(ctx, cam);
  }

  // -------------------------------------------------------------------------
  // The bump. `by` is whoever struck it from below (normally the player).
  // Returns true if the block reacted.
  // -------------------------------------------------------------------------
  bump(tx, ty, by) {
    const rec = this.world.recAt(tx, ty);
    if (!rec) return false;
    if (rec.question) return this._bumpQuestion(tx, ty, rec, by);
    if (rec.breakable) return this._bumpBrick(tx, ty, rec, by);
    if (rec.solid) {
      this.world.sfx('bump');
      return false;
    }
    return false;
  }

  _bumpQuestion(tx, ty, rec, by) {
    const w = this.world;
    const st = this.stateAt(tx, ty, true);
    if (st.used) {
      w.sfx('bump');
      return false;
    }
    st.hits++;
    this._startBump(tx, ty, by);
    this._yield(tx, ty, rec, st, by);
    if (!st.used && !st.multicoin) {
      st.used = true;
      w.setTile(tx, ty, 'U');
    }
    return true;
  }

  _bumpBrick(tx, ty, rec, by) {
    const w = this.world;
    const st = this.stateAt(tx, ty, true);
    const item = this._contentsOf(tx, ty, rec);

    if (item) {
      // A brick with something inside acts as a question block: it cannot be
      // shattered until it has given up its contents.
      if (st.used) {
        w.sfx('bump');
        return false;
      }
      st.hits++;
      this._startBump(tx, ty, by);
      this._yield(tx, ty, rec, st, by);
      if (!st.used && !st.multicoin) {
        st.used = true;
        w.setTile(tx, ty, 'U');
      }
      return true;
    }

    if (this._canBreak(by)) return this.shatter(tx, ty, by);

    this._startBump(tx, ty, by);
    w.sfx('bump');
    return true;
  }

  _canBreak(by) {
    if (!by) return false;
    if (by.canBreakBlocks === true) return true;
    if (by.isPlayer !== true) return false;
    if (by.big === true) return true;
    const p = by.power || by.state;
    return !!p && p !== 'small' && p !== 'tiny';
  }

  _contentsOf(tx, ty, rec) {
    if (this.toolTiles.size && this.toolTiles.has(key(tx, ty))) return 'toolbelt';
    const ov = this.world.contents.get(key(tx, ty));
    const item = ov ? ov.item : rec.item;
    // Level files built before the marker had a name still say `item:'coin'`
    // with a `count`. The ROM has no count — the brick is timed — but a count on
    // a brick's coin is unambiguous, so it still reads as a multi-coin brick.
    if (ov && item === 'coin' && ov.count > 0) return 'multicoin';
    return item || null;
  }

  // A "power" block yields a mushroom to a small player and a fire flower to a
  // big one. In co-op that has to follow whoever actually hit the block: reading
  // it off world.player handed small Luigi a fire flower whenever Mario happened
  // to be big, and handed big Luigi a useless mushroom whenever Mario was small.
  // `by` is absent only when something other than a player opens the block (a
  // shell, a star-struck bump); those fall back to the primary brother, which is
  // the closest thing to "the player" such a bump has.
  _resolveItem(item, by) {
    if (item !== 'power' && item !== 'powerup') return item;
    const p = by && by.isPlayer === true ? by : this.world.player;
    const big = p && (p.big === true || (p.power && p.power !== 'small'));
    return big ? 'fireflower' : 'mushroom';
  }

  _yield(tx, ty, rec, st, by) {
    const w = this.world;
    const raw = this._contentsOf(tx, ty, rec);
    if (!raw) return;

    if (raw === 'multicoin' || raw === 'coins') {
      // The first hit starts the clock. Every hit pays a coin, including the one
      // that arrives after the clock has run out — BumpBlock dispatches on the
      // ORIGINAL metatile off the stack (asm:7319-7326), so the closing hit is
      // still a CoinBlock. That hit is also the one that turns the brick into the
      // empty block; nothing else ever does.
      st.multicoin = true;
      if (st.hits === 1) st.timer = MULTICOIN_TICKS;
      this._payCoin(tx, ty);
      if (st.hits > 1 && st.timer <= 0) {
        st.used = true;
        w.setTile(tx, ty, 'U');
      }
      return;
    }

    if (raw === 'coin') {
      this._payCoin(tx, ty);
      return;
    }

    w.sfx('sprout');
    this.spawnFromBlock(this._resolveItem(raw, by), tx, ty, by);
  }

  // The Coin entity banks the coin and the 200 points itself, so only the
  // fallback path does the accounting.
  _payCoin(tx, ty) {
    const w = this.world;
    const px = tx * TILE;
    const py = ty * TILE - TILE;
    if (w.spawn('coin', px, py, { mode: 'bump' })) return;
    this.popCoinPx(px, py);
    w.addCoin(1);
    w.addScore(200, px + TILE * 0.5, py + TILE - 4);
  }

  // -------------------------------------------------------------------------
  // Item emerging from a struck block.
  // -------------------------------------------------------------------------
  spawnFromBlock(item, tx, ty, by) {
    const w = this.world;
    const px = tx * TILE;
    const py = ty * TILE;
    // The level's `contents` entry keeps everything that is not the payload as
    // spawn options, and the item needs them: a beanstalk without its `warp`
    // grows to nowhere.
    const ov = w.contents && typeof w.contents.get === 'function' ? w.contents.get(key(tx, ty)) : null;
    const extra = ov && ov.opts ? ov.opts : null;
    let e = w.spawn(item, px, py, { fromBlock: true, tx, ty, ...(extra || {}) });
    if (!e) {
      if (!w.art[item]) return null;
      e = new FallbackItem(w, item, px, py);
      w.entities.push(e);
    }
    e.x = px + (TILE - e.w) * 0.5;
    e.y = py + (TILE - e.h);
    e.vx = 0;
    e.vy = 0;
    e.grounded = false;
    if (e.selfEmerge === true) return e;
    e.emerging = true;
    e.suspended = true;
    e.emergeTarget = py - e.h;
    return e;
  }

  stepEmerge(e) {
    e.y -= EMERGE_SPEED;
    if (e.y > e.emergeTarget) return;
    e.y = e.emergeTarget;
    e.emerging = false;
    e.suspended = false;
    if (typeof e.onEmerged === 'function') e.onEmerged();
  }

  // -------------------------------------------------------------------------
  // Shatter — big Mario only.
  // -------------------------------------------------------------------------
  shatter(tx, ty, by) {
    const w = this.world;
    const rec = w.recAt(tx, ty);
    if (!rec || !rec.solid) return false;

    const sprite = w.tileSprite(rec, w.tick);
    // BrickShatter calls CheckTopOfBlock BEFORE it shatters (asm:7380), so a
    // coin resting on the brick is taken as the brick goes.
    this._takeCoinAbove(tx, ty);
    w.setTile(tx, ty, '.');
    this.bumps.delete(key(tx, ty));
    this.state.delete(key(tx, ty));

    this.spawnDebris(tx, ty, sprite);
    this.flipEntitiesOn(tx, ty, by);

    w.addScore(50, tx * TILE + TILE * 0.5, ty * TILE);
    w.sfx('brick-break');
    // 2 frames, not 6. Six frames of hit-stop is ~100 ms of frozen input, which
    // reads as a dropped frame rather than impact — SMB itself has none at all.
    w.freeze(2);
    w.shake(1.4, 7);
    w.fx('brickShatter', tx * TILE + TILE * 0.5, ty * TILE + TILE * 0.5, w.theme);
    return true;
  }

  break(tx, ty, by) {
    return this.shatter(tx, ty, by);
  }

  _startBump(tx, ty, by) {
    const k = key(tx, ty);
    const b = this.bumps.get(k);
    if (b) b.t = 0;
    else this.bumps.set(k, { tx, ty, t: 0 });
    this._takeCoinAbove(tx, ty);
    this.flipEntitiesOn(tx, ty, by);
    this.world.shake(0.7, 3);
  }

  // CheckTopOfBlock (asm:7395-7411). Bumping a block takes a coin sitting
  // directly on top of it: the ROM blanks that metatile and runs SetupJumpCoin,
  // which is the hopping coin and its score. It is called from BOTH BumpBlock
  // (asm:7308) and BrickShatter (asm:7380), so it applies to question blocks,
  // to bricks that only rattle, and to bricks big Mario smashes alike.
  //
  // We were leaving every one of them behind. 24 coins in this game rest on a
  // brick — all of them in 1-2 and 4-2 — and smashing the brick out from under
  // one used to drop it on the floor of the level's logic: still collectable by
  // jumping, but not the coin you had just earned.
  //
  // The ROM tests for metatile $c2 specifically, which is the DRY coin; the
  // underwater coin is a different tile and is deliberately not taken this way,
  // which is what the water check stands in for.
  _takeCoinAbove(tx, ty) {
    if (ty <= 0) return false; // `beq TopEx` — nothing above the top row
    const w = this.world;
    if (w.theme === 'water') return false;
    const above = w.recAt(tx, ty - 1);
    if (!above || !above.coin) return false;
    w.setTile(tx, ty - 1, '.');
    // _payCoin spawns its coin one tile ABOVE the row it is given, so passing
    // the block's own row puts the hop exactly where the coin was.
    this._payCoin(tx, ty);
    return true;
  }

  // -------------------------------------------------------------------------
  // Anything standing on the block gets launched: enemies die on their back,
  // loose items hop.
  // -------------------------------------------------------------------------
  flipEntitiesOn(tx, ty, by) {
    const w = this.world;
    const bx = tx * TILE;
    const btop = ty * TILE;
    const dir = by && by.facing ? by.facing : 1;
    for (let i = 0; i < w.entities.length; i++) {
      const e = w.entities[i];
      if (!e || e.removed || e.dead || e === by || e === w.player) continue;
      if (e.x + e.w <= bx - 1 || e.x >= bx + TILE + 1) continue;
      const feet = e.y + e.h;
      if (feet < btop - 8 || feet > btop + 10) continue;

      if (typeof e.onBlockBump === 'function') {
        e.onBlockBump(tx, ty, by);
        continue;
      }
      if (typeof e.onBumped === 'function') {
        e.onBumped(dir);
        continue;
      }
      if (e.isItem) {
        e.vy = -3.6;
        e.grounded = false;
        continue;
      }
      if (typeof e.kill === 'function') {
        e.kill('fall', by);
        w.addScore(100, e.x + e.w * 0.5, e.y);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------
  popCoin(tx, ty) {
    this.popCoinPx(tx * TILE, ty * TILE - TILE);
  }

  popCoinPx(px, py) {
    this.effects.push(new BumpCoin(this.world, px, py));
    this.world.sfx('coin');
  }

  spawnDebris(tx, ty, sprite) {
    const w = this.world;
    const px = tx * TILE;
    const py = ty * TILE;
    // The Debris entity emits all four chunks from one spawn.
    if (w.spawn('debris', px, py, { theme: w.theme })) return;
    this._spawnDebrisFallback(px, py, sprite);
  }

  // No debris entity registered. First choice is the authored shard art; failing
  // that, the brick tile itself is cut into quarters, which is exactly what the
  // pieces should look like.
  _spawnDebrisFallback(px, py, sprite) {
    const w = this.world;
    const vs = [
      [-1.5, -6.3, 0, 0],
      [1.5, -6.3, 8, 0],
      [-1.2, -3.9, 0, 8],
      [1.2, -3.9, 8, 8],
    ];

    // items.js publishes the shard art as a tumble animation, so each of the
    // four pieces takes a different still and no two chunks share a silhouette.
    const shards = framesOf(w.art.debris)
      .map((s) => ({ s, canvas: this._canvasOf(s) }))
      .filter((e) => e.canvas);
    if (shards.length) {
      for (let i = 0; i < vs.length; i++) {
        const [vx, vy, ox, oy] = vs[i];
        const { s, canvas: cv } = shards[i % shards.length];
        const jitter = this.rng.range(-0.15, 0.15);
        this.effects.push(
          new BrickDebris(
            w,
            px + ox + (8 - s.w) * 0.5,
            py + oy + (8 - s.h) * 0.5,
            vx + jitter,
            vy,
            cv,
            null
          )
        );
      }
      return;
    }

    // No dedicated shard art: quarter the brick tile instead.
    if (!isSprite(sprite)) return;
    const canvas = this._canvasOf(sprite);
    if (!canvas) return;
    const useSub = sprite.w >= 16 && sprite.h >= 16;

    for (const [vx, vy, ox, oy] of vs) {
      const sub = useSub ? { sx: ox, sy: oy, sw: 8, sh: 8 } : null;
      const pw = sub ? 8 : canvas.width;
      const ph = sub ? 8 : canvas.height;
      const dx = useSub ? px + ox : px + TILE * 0.5 - pw * 0.5 + (vx < 0 ? -2 : 2);
      const dy = useSub ? py + oy : py + TILE * 0.5 - ph * 0.5;
      const jitter = this.rng.range(-0.15, 0.15);
      this.effects.push(new BrickDebris(this.world, dx, dy, vx + jitter, vy, canvas, sub));
    }
  }

  _canvasOf(sprite) {
    const cached = this._shardCache.get(sprite);
    if (cached) return cached;
    let c = null;
    try {
      c = sprite.canvas;
    } catch (err) {
      return null;
    }
    if (c) this._shardCache.set(sprite, c);
    return c;
  }
}

export default BlockSystem;
