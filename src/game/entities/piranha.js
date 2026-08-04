import { Entity, registerEntity } from '../entity.js';
import { TILE } from '../../core/constants.js';
import * as EB from '../../data/sprites/enemies-b.js';
import {
  pickAnim,
  frozen,
  hurtPlayer,
  isStarPlayer,
  playersOf,
  addScore,
  fx,
  sfx,
} from './index.js';

// MovePiranhaPlant (smbdis.asm): InitPiranhaPlant sets PiranhaPlant_Y_Speed to
// $01 and the travel to `sbc #$18` = 24 pixels, and RiseFallPiranhaPlant only
// moves on every other frame (`lda FrameCounter / lsr / bcc PutinPipe`) — so a
// pixel every two frames, 48 frames to travel each way. At each end it parks for
// EnemyFrameTimer = $40 = 64 frames. The full cycle is 48+64+48+64 = 224 frames.
const PLANT_H = 24;
const RISE = 48;
const SNAP = 64;
const SINK = 48;
const WAIT = 64;
const SAFE_DIST = 24;

const SNAP_ANIM = pickAnim(EB, ['PIRANHA.snap', 'PIRANHA_ANIM', 'PIRANHA'], null, 18);
const FIRE_ANIM = pickAnim(EB, ['PIRANHA_FIRE.snap', 'PIRANHA.snap'], null, 18);

export default class Piranha extends Entity {
  static type = 'piranha';

  constructor(world, x, y, opts = {}) {
    super(world, x, y, opts);
    this.w = 16;
    this.h = 0;
    this.facing = 1;
    this.noclip = true;
    this.gravity = 0;
    this.autoCorpse = false;
    // Drawn on the BEHIND layer so it slides up out of the pipe mouth rather
    // than floating in front of it.
    this.behind = true;
    this.noSettle = true;

    this.spawnY = y;
    this.mouthY = opts.pipeTop == null ? null : opts.pipeTop;
    this.anim = opts.variant === 'fire' ? FIRE_ANIM : SNAP_ANIM;
    this.out = 0;
    this.phase = 'wait';
    this.phaseT = (opts.phase | 0) % (WAIT + RISE + SNAP + SINK);
    this.popT = 0;
    this.isEnemy = true;
    // Not a stream enemy: VerticalPipe writes the plant into the enemy buffer
    // itself, centred on its pipe, as part of parsing the AREA data. It is there
    // whatever the enemy cursor is doing, so a camera jump must not drop it —
    // otherwise surfacing from a coin room strips the plant out of the very pipe
    // you came up through.
    this.fromEnemyStream = false;
  }

  // The pipe lip is the first solid tile at or below the spawn point.
  _anchor() {
    if (this.mouthY != null) return this.mouthY;
    const w = this.world;
    const cx = this.x + 8;
    const ty0 = Math.floor(this.spawnY / TILE);
    if (w && typeof w.solidAt === 'function') {
      for (let k = 0; k <= 4; k++) {
        if (w.solidAt(cx, (ty0 + k) * TILE + 8)) {
          this.mouthY = (ty0 + k) * TILE;
          return this.mouthY;
        }
      }
    }
    this.mouthY = this.spawnY + PLANT_H;
    return this.mouthY;
  }

  // It will not sprout under a player's feet — EITHER player's. Checking only
  // world.player let the plant grow through player two while he stood on the pipe.
  _playerNear() {
    for (const p of playersOf(this.world)) {
      if (!p || p.dead || p.state === 'dying') continue;
      if (Math.abs(p.centerX - (this.x + 8)) < SAFE_DIST + (p.w || 16) * 0.5) return true;
    }
    return false;
  }

  update() {
    if (frozen(this.world)) return;
    if (this.dead) {
      if (++this.popT > 6) this.remove();
      return;
    }

    const mouth = this._anchor();
    this.phaseT++;

    switch (this.phase) {
      case 'wait':
        this.out = 0;
        if (this.phaseT >= WAIT && !this._playerNear()) this._to('rise');
        break;
      case 'rise':
        this.out = (this.phaseT / RISE) * PLANT_H;
        if (this.phaseT >= RISE) {
          this.out = PLANT_H;
          this._to('snap');
        }
        break;
      case 'snap':
        this.out = PLANT_H;
        if (this.phaseT >= SNAP) this._to('sink');
        break;
      default:
        this.out = (1 - this.phaseT / SINK) * PLANT_H;
        if (this.phaseT >= SINK) {
          this.out = 0;
          this._to('wait');
        }
        break;
    }

    if (this.out < 0) this.out = 0;
    this.h = Math.max(0, Math.round(this.out));
    this.y = mouth - this.h;
  }

  _to(phase) {
    this.phase = phase;
    this.phaseT = 0;
  }

  draw(ctx, cam) {
    if (this.dead || this.out <= 0) return;
    const spr = this.anim.frame(this.tick);
    const mouth = this.mouthY == null ? this.spawnY + PLANT_H : this.mouthY;
    const topY = mouth - Math.round(this.out);
    const camX = cam ? cam.x || 0 : 0;
    const camY = cam ? cam.y || 0 : 0;
    // Drawn from its own top, not the shrinking hitbox: the pipe tiles in front
    // do the clipping.
    spr.draw(ctx, Math.floor(this.x - camX), Math.floor(topY - camY), false, false);
  }

  _pop(score) {
    if (this.dead) return;
    this.dead = true;
    this.tangible = false;
    this.popT = 0;
    const mouth = this.mouthY == null ? this.spawnY + PLANT_H : this.mouthY;
    const cy = mouth - this.out * 0.5;
    fx(this.world, 'enemyPoof', this.x + 8, cy);
    addScore(this.world, score, this.x + 8, cy);
    sfx(this.world, 'kick');
    this.h = 0;
  }

  onFireball() {
    if (this.dead || this.out <= 0) return false;
    this._pop(200);
    return true;
  }

  onShell() {
    if (this.dead || this.out <= 0) return;
    this._pop(200);
  }

  onStar() {
    if (this.dead || this.out <= 0) return;
    this._pop(200);
  }

  // Teeth all round: there is no safe angle of approach.
  onStomp() {
    return false;
  }

  onPlayerTouch(player) {
    if (this.dead || this.out <= 0) return;
    if (isStarPlayer(player)) {
      this._pop(200);
      return;
    }
    hurtPlayer(this);
  }

  // Rooted in the pipe — bumping the block under it does nothing.
  onBlockBump() {}

  onBumped() {}
}

registerEntity(Piranha);
