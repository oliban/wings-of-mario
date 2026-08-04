import { Entity, registerEntity } from '../entity.js';
import { makeSprite } from '../../core/gfx.js';
import { SCREEN_W } from '../../core/constants.js';
import * as EA from '../../data/sprites/enemies-a.js';
import { pickSprite, enemyDie, frozen, hurtPlayer, starTouch, playerOf, spawnAt, fx, sfx } from './index.js';

// 0 outline 1 shell dark 2 shell mid 3 shell lit 4 shell spec
// 5 cloud white 6 cloud shade 7 face 8 eye/mouth 9 face shade
const LAKITU_PAL = [
  '#1a1008', '#0d4a12', '#1d8f22', '#55c753', '#bdf4ab',
  '#ffffff', '#b8c8d8', '#f8d5ac', '#12080a', '#e8892c',
];

// Shelled head and shoulders riding a lumpy cloud.
const LAKITU_IDLE = [
  '.....000000.....',
  '...0444433320...',
  '..044433332220..',
  '.04433333222110.',
  '.04333332221110.',
  '0333333222211110',
  '0333322221111110',
  '0777777777777770',
  '0775557777555770',
  '0778857777588770',
  '0775557777555770',
  '0777999999997770',
  '0777777777777770',
  '0000000000000000',
  '...000....000...',
  '..05550..05550..',
  '.05555555555550.',
  '0555555555555550',
  '0555555555555660',
  '0555555666666660',
  '0666666666666660',
  '.06666666666660.',
  '..066666666660..',
  '...0000000000...',
];

// Same rig, mouth thrown open for the wind-up.
const LAKITU_THROW = LAKITU_IDLE.slice();
LAKITU_THROW[11] = '0777888888887770';

const IDLE = pickSprite(EA, ['LAKITU.idle', 'LAKITU', 'LAKITU_IDLE'], () =>
  makeSprite(LAKITU_IDLE, LAKITU_PAL, { name: 'lakitu-idle' })
);
const THROW = pickSprite(EA, ['LAKITU.throwing', 'LAKITU.throw', 'LAKITU_THROW'], () =>
  makeSprite(LAKITU_THROW, LAKITU_PAL, { name: 'lakitu-throw' })
);

export const LAKITU_ART = { idle: IDLE, throw: THROW };

const WINDUP = 26;
const RELEASE_AT = 16;

export default class Lakitu extends Entity {
  static type = 'lakitu';

  constructor(world, x, y, opts = {}) {
    super(world, x, y, opts);
    this.w = 16;
    this.h = 24;
    this.facing = opts.facing || -1;
    this.noclip = true;
    // He shadows the player rather than sitting in the level, so he must keep
    // thinking even when the camera has left him behind for a moment.
    this.alwaysUpdate = true;
    this.gravity = 0;

    this.hoverY = opts.hoverY == null ? 40 : opts.hoverY;
    // World x past which he abandons the chase (SMB hands Lakitu off at a
    // fixed point in the level). Null means he follows until outrun.
    this.leaveX = opts.leaveX == null ? null : opts.leaveX;
    // LakituAndSpinyHandler (smbdis.asm:9600-9604) sets FrenzyEnemyTimer to $80.
    // That is $078f, below the frame/interval cut at offset $14 (asm:786-799), so
    // it decrements every frame: an egg every 128 frames. The wind-up below is
    // ours — the original creates the spiny the instant the timer expires — so the
    // throw clock runs THROUGH the wind-up and release-to-release stays 128.
    this.period = opts.period == null ? 128 : opts.period;
    this.throwT = Math.floor(this.period * 0.5);
    this.windT = -1;
    this.passT = 0;
    this.fleeing = false;
    this.bobT = 0;
    this.isEnemy = true;
    // Lakitu ($11) is the second `iny` case in EnemyStomped (asm:11456-11458),
    // so Y=2 and StompedEnemyPtsData[2] = $05 (asm:11436) = "800" in
    // FloateyNumTileData (asm:1267). EIGHT hundred, not the 200 a stomped
    // bullet bill or flying cheep pays.
    this.stompPoints = 800;
  }

  update() {
    if (frozen(this.world)) return;
    const cam = this.world && this.world.cam;
    const camX = cam ? cam.x : 0;
    const camY = cam ? cam.y : 0;
    const p = playerOf(this.world);
    this.bobT++;

    if (this.fleeing) {
      this.x += this.vx;
      this.y = camY + this.hoverY - this.bobT * 0.14 + Math.sin(this.bobT * 0.05) * 4;
      if (this.x + this.w < camX - 64 || this.x > camX + SCREEN_W + 64) this.remove();
      return;
    }

    // Chase the player's x with a soft spring aimed slightly ahead of where
    // they are going. The light damping is deliberate: it overshoots and drifts
    // back, which is what sells the lazy floating.
    let target = this.x;
    if (p) target = p.x + (p.facing || 1) * 22 + (p.vx || 0) * 9;
    this.vx += (target - this.x) * 0.0062;
    this.vx *= 0.966;
    if (this.vx > 3.2) this.vx = 3.2;
    if (this.vx < -3.2) this.vx = -3.2;
    this.x += this.vx;
    if (Math.abs(this.vx) > 0.12) this.facing = this.vx > 0 ? 1 : -1;
    this.y = camY + this.hoverY + Math.sin(this.bobT * 0.035) * 4;

    // He gives up either at the level-authored hand-off point or once the
    // player has genuinely outrun him.
    if (p && this.leaveX != null && p.x > this.leaveX) this._flee(p);
    else if (p && p.x > this.x + 112) {
      if (++this.passT > 70) this._flee(p);
    } else if (this.passT > 0) {
      this.passT--;
    }

    this.throwT++;
    if (this.windT >= 0) {
      this.windT++;
      if (this.windT === RELEASE_AT) this._release(p);
      if (this.windT >= WINDUP) this.windT = -1;
      return;
    }

    if (this.throwT >= this.period && this.onScreen(cam, 8)) {
      this.throwT = 0;
      this.windT = 0;
    }
  }

  _release(p) {
    const dir = p && p.centerX < this.centerX ? -1 : 1;
    spawnAt(this.world, 'spiny', this.x, this.y - 4, {
      egg: true,
      vx: dir * 1.15,
      vy: -2.6,
      facing: dir,
      active: true,
    });
    sfx(this.world, 'kick');
    fx(this.world, 'powerupSparkle', this.centerX, this.y);
  }

  _flee(p) {
    this.fleeing = true;
    this.bobT = 0;
    const away = p && p.x > this.x ? -1 : 1;
    this.vx = 3.4 * away;
    this.facing = away;
  }

  draw(ctx, cam) {
    if (this.dead) {
      this.drawSprite(ctx, cam, IDLE);
      return;
    }
    const winding = this.windT >= 0;
    // He rises out of his cloud to throw.
    this.drawSprite(ctx, cam, winding ? THROW : IDLE, { oy: winding ? -2 : 0 });
  }

  onStomp(player) {
    if (this.dead) return false;
    fx(this.world, 'enemyPoof', this.centerX, this.y + 6);
    enemyDie(this, 'shell', player, 0);
    return true;
  }

  onFireball(fb) {
    if (this.dead) return false;
    enemyDie(this, 'fireball', fb, 200);
    return true;
  }

  onShell(shell) {
    enemyDie(this, 'shell', shell, 0);
  }

  onStar(player) {
    enemyDie(this, 'shell', player, 200);
  }

  onBlockBump(tx, ty, by) {
    enemyDie(this, 'shell', by, 100);
  }

  onBumped(from) {
    enemyDie(this, 'shell', from, 100);
  }

  onPlayerTouch(player) {
    if (this.dead) return;
    if (starTouch(this, player, 200)) return;
    hurtPlayer(this);
  }
}

registerEntity(Lakitu);
