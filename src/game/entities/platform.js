import { Entity, registerEntity } from '../entity.js';
import { makeSprite } from '../../core/gfx.js';
import { TILE, SCREEN_W } from '../../core/constants.js';
import * as ITEMS from '../../data/sprites/items.js';
import { sfx } from './mushroom.js';
import { playersOf } from './index.js';

const PAL = {
  overworld: ['#1a1008', '#7a3000', '#c85a10', '#ffb050'],
  athletic: ['#1a1008', '#7a3000', '#c85a10', '#ffb050'],
  underground: ['#000d10', '#00727d', '#3ec2cd', '#b5ebf2'],
  water: ['#001a3a', '#0f63b3', '#5db3ff', '#bcdfff'],
  castle: ['#0d0d0d', '#4e4e4e', '#8a8a8a', '#e0e0e0'],
};

const LIFT_LEFT = [
  '..000000',
  '.0333333',
  '03222222',
  '03211221',
  '03211221',
  '03111111',
  '.0111111',
  '..000000',
];

const LIFT_MID = [
  '00000000',
  '33333333',
  '22222222',
  '21122112',
  '21122112',
  '11111111',
  '11111111',
  '00000000',
];

const WHEEL = [
  '..0000..',
  '.033330.',
  '03322330',
  '03211230',
  '03211230',
  '03322330',
  '.033330.',
  '..0000..',
];

// items.js supplies one authored lift plate; when it is present it is tiled across
// the whole platform and the hand-authored caps are only used as the fallback.
const PLATE = ITEMS.LIFT && ITEMS.LIFT.platform && typeof ITEMS.LIFT.platform.draw === 'function'
  ? ITEMS.LIFT.platform
  : null;

const CACHE = {};
function skin(theme) {
  const key = PAL[theme] ? theme : 'overworld';
  if (!CACHE[key]) {
    CACHE[key] = {
      plate: PLATE,
      left: makeSprite(LIFT_LEFT, PAL[key], { name: `lift-l-${key}` }),
      mid: makeSprite(LIFT_MID, PAL[key], { name: `lift-m-${key}` }),
      wheel: makeSprite(WHEEL, PAL[key], { name: `pulley-${key}` }),
      rope: PAL[key][3],
      ropeDark: PAL[key][1],
    };
  }
  return CACHE[key];
}

const FALL_DELAY = 10;
const FALL_ACCEL = 0.08;
const FALL_MAX = 4.0;
const PULLEY_SPEED = 0.75;
const PULLEY_TRAVEL = 96;

export default class Platform extends Entity {
  static type = 'platform';

  constructor(world, x, y, opts = {}) {
    super(world, x, y, opts);
    this.mode = opts.mode || opts.kind || 'horizontal';
    this.tilesWide = opts.tiles || opts.width || 3;
    // SPBBox (asm:8930-8940) gives a lift bounding-box control of 5 in a castle
    // OR in secondary hard mode and 6 otherwise, and DrawPlatform (asm:13343-13350)
    // pushes the last two of its six sprites offscreen under the same test. Six
    // sprites is three tiles, four is two: the short lift of the castles and of
    // the back half of the game. Only the three-tile decks have a shorter form —
    // the two- and four-tile lifts carry their own widths.
    if (this.tilesWide === 3 && (world.theme === 'castle' || (world && world.hardMode))) {
      this.tilesWide = 2;
    }
    this.w = this.tilesWide * TILE;
    this.h = 8;
    this.t = 0;
    this.vx = 0;
    this.vy = 0;
    this.deltaX = 0;
    this.deltaY = 0;
    this.riderCount = 0;
    this.isPlatform = true;
    this.oneWay = true;
    this.tangible = true;
    this.autoCorpse = false;
    this.persistent = true;
    this.skin = skin(opts.theme || world.theme || (world.level && world.level.theme) || 'overworld');

    this.originX = x;
    this.originY = y;
    this.range = opts.range != null ? opts.range : 64;
    this.speed = opts.speed != null ? opts.speed : 1.0;
    this.dir = opts.dir === -1 ? -1 : 1;

    // A vertical lift with no direction of its own is the original's
    // InitVertPlatform ($25) — the one that hangs on a spring and bobs. It does
    // NOT bob around the row it is written at: InitVertPlatform stores that row
    // as YPlatformTopYPos, the LIMIT of its travel, and sets YPlatformCenterYPos
    // 64 pixels away from it — below when the lift is written high on the screen,
    // above when it is written low (smbdis.asm:8914-8926, and YMovingPlatform at
    // 10896 springs about the centre). Bobbing around the written row instead put
    // every one of these lifts half its travel too high; in 4-3 that was the
    // difference between a lift you can jump onto from the ground and one you
    // cannot, which reach.mjs sees as a dead end at column 69.
    //
    // The lifts that DO carry a direction are $26/$27 and $2b/$2c — LargeLiftUp /
    // LargeLiftDown and PlatLiftUp / PlatLiftDown — which run continuously rather
    // than springing, and they keep the written row as their centre.
    this.swingY =
      this.mode === 'vertical' && opts.dir == null
        ? this.originY + (this.originY < 128 ? this.range : -this.range)
        : this.originY;

    this.falling = false;
    this.fallTimer = -1;

    this.partner = opts.partner || null;
    this.anchorY = opts.anchorY != null ? opts.anchorY : y - 96;
    this.ropeSpan = opts.spacing != null ? opts.spacing : 112;

    if (this.mode === 'pulley' && !this.partner) {
      const other = world.spawn('platform', x + this.ropeSpan, this.anchorY + (this.anchorY - y), {
        ...opts,
        mode: 'pulley',
        partner: this,
        anchorY: this.anchorY,
        spacing: this.ropeSpan,
      });
      if (other) {
        this.partner = other;
        this.ropeMaster = true;
      }
    }

    if (this.mode === 'horizontal') this.vx = this.speed * this.dir;
    else if (this.mode === 'vertical') this.vy = this.speed * this.dir;
  }

  ridden() {
    for (const p of playersOf(this.world)) if (this.supports(p)) return true;
    return false;
  }

  // A one-way top surface: catches anything descending onto it.
  supports(e) {
    if (!e || e === this || e.removed) return false;
    if (e.x + e.w <= this.x + 1 || e.x >= this.x + this.w - 1) return false;
    const feet = e.y + e.h;
    const slack = 3 + Math.max(0, e.vy) + Math.abs(this.deltaY);
    return feet >= this.y - 2 && feet <= this.y + slack;
  }

  land(e) {
    e.y = this.y - e.h;
    if (e.vy > 0) e.vy = 0;
    e.grounded = true;
    e.onPlatform = this;
  }

  carry() {
    const dx = this.deltaX;
    const dy = this.deltaY;
    const riders = [];
    // Both brothers ride. Carrying only world.player slid the platform out from
    // under player two.
    for (const p of playersOf(this.world)) if (this.supports(p)) riders.push(p);
    for (const e of this.world.entities || []) {
      if (e === this || e.removed || e.isPlatform) continue;
      if (e.ridesPlatforms && this.supports(e)) riders.push(e);
    }
    for (const r of riders) {
      r.x += dx;
      this.land(r);
    }
    this.riderCount = riders.length;
  }

  update() {
    this.t++;
    const px = this.x;
    const py = this.y;

    switch (this.mode) {
      case 'horizontal': {
        this.x += this.vx;
        if (this.x > this.originX + this.range) {
          this.x = this.originX + this.range;
          this.vx = -this.speed;
        } else if (this.x < this.originX - this.range) {
          this.x = this.originX - this.range;
          this.vx = this.speed;
        }
        break;
      }
      case 'vertical': {
        this.y += this.vy;
        if (this.y > this.swingY + this.range) {
          this.y = this.swingY + this.range;
          this.vy = -this.speed;
        } else if (this.y < this.swingY - this.range) {
          this.y = this.swingY - this.range;
          this.vy = this.speed;
        }
        break;
      }
      case 'fall': {
        if (!this.falling) {
          if (this.fallTimer < 0 && this.ridden()) {
            this.fallTimer = FALL_DELAY;
            sfx(this.world, 'block-bump');
          }
          if (this.fallTimer > 0) {
            this.fallTimer--;
            // Anticipation shudder before the drop.
            this.y = this.originY + ((this.fallTimer >> 1) & 1);
            if (this.fallTimer === 0) this.falling = true;
          }
        } else {
          this.vy = Math.min(this.vy + FALL_ACCEL, FALL_MAX);
          this.y += this.vy;
        }
        break;
      }
      case 'pulley': {
        this.updatePulley();
        break;
      }
      default:
        break;
    }

    this.deltaX = this.x - px;
    this.deltaY = this.y - py;
    this.carry();

    const level = this.world.level;
    const floor = (level ? level.height : 15) * TILE;
    if (this.y > floor + 64) this.removed = true;
    if (this.x + this.w < this.world.cam.x - 96 || this.x > this.world.cam.x + SCREEN_W + 96) {
      if (this.mode === 'fall' && this.falling) this.removed = true;
    }
  }

  updatePulley() {
    const other = this.partner;
    if (!other || other.removed) {
      // Rope cut: this lift is on its own and drops.
      this.mode = 'fall';
      this.falling = true;
      this.vy = 0.5;
      return;
    }
    if (!this.ropeMaster) return;

    const a = this;
    const b = other;
    const wa = a.ridden() ? 1 : 0;
    const wb = b.ridden() ? 1 : 0;
    let v = 0;
    if (wa && !wb) v = PULLEY_SPEED;
    else if (wb && !wa) v = -PULLEY_SPEED;
    else if (wa && wb) v = 0;

    if (v !== 0) {
      const na = a.y + v;
      const nb = b.y - v;
      const lowA = a.originY + PULLEY_TRAVEL;
      const highA = a.originY - PULLEY_TRAVEL;
      if (na <= lowA && na >= highA && nb <= b.originY + PULLEY_TRAVEL && nb >= b.originY - PULLEY_TRAVEL) {
        const pb = b.y;
        a.y = na;
        b.y = nb;
        b.deltaY = b.y - pb;
        b.deltaX = 0;
        b.carry();
      } else {
        // Ran out of rope: the loaded lift tears free.
        const loaded = wa ? a : b;
        loaded.partner = null;
        loaded.mode = 'fall';
        loaded.falling = true;
        loaded.vy = 0.5;
        sfx(this.world, 'block-bump');
      }
    } else {
      b.deltaY = 0;
      b.deltaX = 0;
      b.carry();
    }
  }

  onPlayerTouch(player) {
    if (this.supports(player) && player.vy >= 0) this.land(player);
  }

  onFireball() {
    return false;
  }

  onStomp() {
    return false;
  }

  drawRope(ctx, cam) {
    if (!this.ropeMaster || !this.partner || this.mode !== 'pulley') return;
    const ay = Math.floor(this.anchorY - cam.y);
    const ax1 = Math.floor(this.x + this.w / 2 - cam.x);
    const ax2 = Math.floor(this.partner.x + this.partner.w / 2 - cam.x);
    const y1 = Math.floor(this.y - cam.y);
    const y2 = Math.floor(this.partner.y - cam.y);
    ctx.fillStyle = this.skin.ropeDark;
    ctx.fillRect(Math.min(ax1, ax2), ay, Math.abs(ax2 - ax1) + 1, 1);
    ctx.fillRect(ax1, ay, 1, Math.max(0, y1 - ay));
    ctx.fillRect(ax2, ay, 1, Math.max(0, y2 - ay));
    ctx.fillStyle = this.skin.rope;
    ctx.fillRect(Math.min(ax1, ax2), ay - 1, Math.abs(ax2 - ax1) + 1, 1);
    this.skin.wheel.draw(ctx, ax1 - 4, ay - 8);
    this.skin.wheel.draw(ctx, ax2 - 4, ay - 8);
  }

  draw(ctx, cam) {
    this.drawRope(ctx, cam);
    const sx = Math.floor(this.x - cam.x);
    const sy = Math.floor(this.y - cam.y);
    const plate = this.skin.plate;
    if (plate) {
      // Tile the authored plate across the full width, clipped to the hitbox.
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, sy, this.w, Math.max(this.h, plate.h));
      ctx.clip();
      for (let i = 0; i * plate.w < this.w; i++) plate.draw(ctx, sx + i * plate.w, sy);
      ctx.restore();
      return;
    }
    const segs = Math.max(1, Math.round(this.w / 8));
    this.skin.left.draw(ctx, sx, sy);
    for (let i = 1; i < segs - 1; i++) this.skin.mid.draw(ctx, sx + i * 8, sy);
    if (segs > 1) this.skin.left.draw(ctx, sx + (segs - 1) * 8, sy, true);
  }
}

registerEntity(Platform);
