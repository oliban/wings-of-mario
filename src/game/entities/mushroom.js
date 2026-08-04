import { Entity, registerEntity } from '../entity.js';
import { makeSprite, Anim } from '../../core/gfx.js';
import { TILE } from '../../core/constants.js';
import * as ITEMS from '../../data/sprites/items.js';
import { PHYS } from '../physics.js';

// ---------------------------------------------------------------------------
// Shared item helpers. Every non-enemy entity in this folder routes sound,
// particles and art resolution through these so the integration surface with
// world.js / fx / the art modules is one place, not fourteen.
// ---------------------------------------------------------------------------

export function sfx(world, name) {
  if (!world || !name) return;
  if (typeof world.sfx === 'function') world.sfx(name);
  else if (world.audio && typeof world.audio.sfx === 'function') world.audio.sfx(name);
}

export function fx(world, kind, x, y, a, b) {
  if (!world || typeof world.fx !== 'function') return null;
  return world.fx(kind, x, y, a, b);
}

// The art modules export Sprites, Anims or raw row arrays depending on the asset.
// Accept all three, and fall back to the art authored alongside each entity so a
// missing or renamed export degrades to real pixels instead of a crash.
export function spriteOf(v, rows, pal, opts) {
  if (v && typeof v.draw === 'function') return v;
  if (v instanceof Anim) return v.frames[0];
  if (Array.isArray(v) && typeof v[0] === 'string') return makeSprite(v, pal, opts);
  return makeSprite(rows, pal, opts);
}

// `pal` may be one palette shared by every frame, or one palette per frame.
export function animOf(v, rowsList, pal, opts, hold = 4, loop = true) {
  if (v instanceof Anim) return v;
  if (Array.isArray(v) && v[0] && typeof v[0].draw === 'function') return new Anim(v, hold, loop);
  if (v && typeof v.draw === 'function') return Anim.still(v);
  const perFrame = Array.isArray(pal) && Array.isArray(pal[0]);
  return new Anim(
    rowsList.map((rows, i) =>
      makeSprite(rows, perFrame ? pal[i % pal.length] : pal, {
        ...opts,
        name: `${(opts && opts.name) || 'anim'}#${i}`,
      })
    ),
    hold,
    loop
  );
}

const CAP_RED = ['#1a1008', '#8c1018', '#d02828', '#ff6b52', '#c08a4c', '#ffffff', '#ffeec6', '#e8bf82'];
const CAP_GREEN = ['#1a1008', '#0d5c14', '#18a028', '#5ce65a', '#c08a4c', '#ffffff', '#ffeec6', '#e8bf82'];

const MUSH_ROWS = [
  '.....000000.....',
  '...0033333300...',
  '..033355555330..',
  '.03333555555330.',
  '0333355555553330',
  '0333555555555330',
  '0332555555555210',
  '0322225555522110',
  '0222221111211110',
  '0000000000000000',
  '...0466666640...',
  '...0466666640...',
  '...0466666640...',
  '...0447666640...',
  '...0444444440...',
  '...0000000000...',
];

const MUSHROOM = spriteOf(ITEMS.MUSHROOM_SUPER && ITEMS.MUSHROOM_SUPER.idle, MUSH_ROWS, CAP_RED, {
  name: 'mushroom.super',
});
const MUSHROOM_1UP = spriteOf(ITEMS.MUSHROOM_1UP && ITEMS.MUSHROOM_1UP.idle, MUSH_ROWS, CAP_GREEN, {
  name: 'mushroom.1up',
});

export const ITEM_GRAVITY = PHYS.enemyGravity;
export const ITEM_MAX_FALL = PHYS.enemyMaxFall;
// `lda #$10 / sta Enemy_X_Speed,x` at the end of GrowThePowerUp
// (smbdis.asm:7190-7191). Speeds are sixteenths of a pixel per frame — anchored
// by NormalXSpdData `.db $f8, $f4` (asm:8162), the goomba's own 0.5 — so $10 is
// exactly 1.0, not the 0.75 this had.
//
// DUPLICATED: blocks.js:49 holds the same constant for items that DID come out
// of a block. Both must move together; they are separate only because there is
// no shared home for an item constant yet (PHYS would be it).
export const ITEM_WALK = 1.0;

// Axis-resolved tile stepping shared by the free-moving items.
// Returns the push direction (-1 pushed left, 1 pushed right, 0 clear).
export function stepX(e) {
  const w = e.world;
  e.x += e.vx;
  const yt = e.y + 3;
  const yb = e.y + e.h - 4;
  if (e.vx > 0) {
    const rx = e.x + e.w;
    if (w.solidAt(rx, yt) || w.solidAt(rx, yb)) {
      e.x = Math.floor(rx / TILE) * TILE - e.w;
      return -1;
    }
  } else if (e.vx < 0) {
    const lx = e.x;
    if (w.solidAt(lx, yt) || w.solidAt(lx, yb)) {
      e.x = (Math.floor(lx / TILE) + 1) * TILE;
      return 1;
    }
  }
  return 0;
}

// Returns 1 when it landed, -1 when it hit a ceiling, 0 otherwise.
export function stepY(e) {
  const w = e.world;
  e.y += e.vy;
  const xl = e.x + 3;
  const xr = e.x + e.w - 4;
  if (e.vy > 0) {
    const by = e.y + e.h;
    if (w.solidAt(xl, by, 'down') || w.solidAt(xr, by, 'down')) {
      e.y = Math.floor(by / TILE) * TILE - e.h;
      e.grounded = true;
      return 1;
    }
    e.grounded = false;
  } else if (e.vy < 0) {
    const ty = e.y;
    if (w.solidAt(xl, ty) || w.solidAt(xr, ty)) {
      e.y = (Math.floor(ty / TILE) + 1) * TILE;
      return -1;
    }
  }
  return 0;
}

// While the block system is lifting an item out of a block, only the part that
// has cleared the block top may be visible.
export function drawEmerging(e, ctx, cam, spr) {
  const sx = Math.floor(e.x - cam.x + (e.w - spr.w) * 0.5);
  const sy = Math.floor(e.y - cam.y + (e.h - spr.h));
  if (!e.emerging) {
    spr.draw(ctx, sx, sy);
    return;
  }
  const blockTop = (e.emergeTarget != null ? e.emergeTarget : e.y - e.h) + e.h;
  const clipY = Math.floor(blockTop - cam.y);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx - 2, clipY - 80, spr.w + 4, 80);
  ctx.clip();
  spr.draw(ctx, sx, sy);
  ctx.restore();
}

// Powerups award 1000 only when they actually changed Mario; when he is already
// at that power level player.powerUp() pays the consolation score itself.
export function awardPowerup(world, player, kind, cx, cy, already) {
  if (!already) world.addScore(1000, cx, cy);
  if (player && typeof player.powerUp === 'function') player.powerUp(kind);
  fx(world, 'powerupSparkle', cx, cy);
  sfx(world, 'powerup');
}

export default class Mushroom extends Entity {
  static type = 'mushroom';

  constructor(world, x, y, opts = {}) {
    super(world, x, y, opts);
    this.w = 16;
    this.h = 16;
    this.t = 0;
    this.variant = opts.variant || (opts.oneUp ? '1up' : 'super');
    this.isItem = true;
    this.tangible = true;
    this.gravity = ITEM_GRAVITY;
    this.maxFall = ITEM_MAX_FALL;
    this.facing = opts.dir === -1 ? -1 : 1;
    this.autoCorpse = false;
    // Spawned straight into the level (not out of a block): walk immediately.
    if (!opts.fromBlock) this.vx = ITEM_WALK * this.facing;
    else sfx(world, 'item-appear');
  }

  // Called by blocks.js the tick the item finishes rising out of its block.
  onEmerged() {
    fx(this.world, 'powerupSparkle', this.x + 8, this.y + 8);
    // Always right, with no wall test. GrowThePowerUp ends `asl / sta
    // Enemy_SprAttrib+5 / rol / sta Enemy_MovingDir,x` (smbdis.asm:7193-7196):
    // the asl leaves A zero with carry set, so the rol rotates that carry back
    // in and the direction is unconditionally 1. A mushroom that surfaces facing
    // a wall is turned a frame later by DoEnemySideCheck (asm:12589-12610),
    // which is exactly what stepX()'s push does for us in update() below — so
    // the old peek at the neighbouring tiles was redundant as well as unfaithful.
    this.facing = 1;
    this.vx = ITEM_WALK * this.facing;
  }

  onBlockBump() {
    this.vy = -3.6;
    this.grounded = false;
  }

  update() {
    this.t++;
    this.vy = Math.min(this.vy + ITEM_GRAVITY, ITEM_MAX_FALL);
    const push = stepX(this);
    if (push !== 0) {
      this.facing = push;
      this.vx = ITEM_WALK * this.facing;
    }
    stepY(this);

    const lvl = this.world.level;
    if (this.y > ((lvl && lvl.height) || 15) * TILE + 64) this.removed = true;
    if (this.x + this.w < this.world.cam.x - 32) this.removed = true;
  }

  onPlayerTouch(player) {
    if (this.removed) return false;
    this.removed = true;
    const cx = this.x + this.w * 0.5;
    if (this.variant === '1up') {
      if (player && typeof player.powerUp === 'function') player.powerUp('1up');
      else this.world.addLife(1, cx, this.y);
      fx(this.world, 'powerupSparkle', cx, this.y + 8);
      return true;
    }
    const already = !!player && player.power !== 'small';
    awardPowerup(this.world, player, 'mushroom', cx, this.y, already);
    return true;
  }

  onStomp() {
    return false;
  }

  onFireball() {
    return false;
  }

  draw(ctx, cam) {
    drawEmerging(this, ctx, cam, this.variant === '1up' ? MUSHROOM_1UP : MUSHROOM);
  }
}

export class OneUpMushroom extends Mushroom {
  static type = '1up';
  constructor(world, x, y, opts = {}) {
    super(world, x, y, { ...opts, variant: '1up' });
  }
}

registerEntity(Mushroom);
registerEntity(OneUpMushroom);
registerEntity('oneup', OneUpMushroom);
registerEntity('mushroom_1up', OneUpMushroom);
