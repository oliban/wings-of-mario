import { Entity, registerEntity } from '../entity.js';
import * as EA from '../../data/sprites/enemies-a.js';
import {
  pickAnim,
  walkStep,
  enemyBump,
  enemyDie,
  frozen,
  hurtPlayer,
  starTouch,
  spawnAt,
  fx,
  walkSpeed,
  enemyGravity,
} from './index.js';

// Apex of the green paratroopa's hop, in pixels. The impulse is solved from it
// against the shared enemy gravity so the arc is fixed, not the velocity.
const HOP_RISE = 38;

const GREEN = {
  walk: pickAnim(EA, ['KOOPA_GREEN.walk', 'KOOPA_WALK'], null, 10),
  fly: pickAnim(EA, ['KOOPA_GREEN.fly', 'KOOPA_GREEN.walk'], null, 6),
};
const RED = {
  walk: pickAnim(EA, ['KOOPA_RED.walk', 'KOOPA_GREEN.walk'], null, 10),
  fly: pickAnim(EA, ['KOOPA_RED.fly', 'KOOPA_GREEN.fly'], null, 6),
};

export default class Koopa extends Entity {
  static type = 'koopa';

  constructor(world, x, y, opts = {}) {
    super(world, x, y, opts);
    this.w = 16;
    this.h = 24;
    this.facing = opts.facing || -1;
    this.variant = opts.variant === 'red' ? 'red' : 'green';
    this.art = this.variant === 'red' ? RED : GREEN;
    this.speed = opts.speed == null ? walkSpeed() : opts.speed;

    this.winged = !!(opts.winged || opts.wing || opts.para);
    // The original has THREE winged koopas and gives each its own movement sub
    // (EnemyMovementSubs, smbdis.asm:9086-9106):
    //
    //   $0e green, MoveJumpingEnemy      — walks and hops, on the ground
    //   $0f red,   ProcMoveRedPTroopa    — springs straight up and down, no
    //                                      horizontal movement whatsoever
    //   $10 green, MoveFlyGreenPTroopa   — shuttles left and right on the
    //                                      XMove counters, with a shallow wave
    //
    // so `winged` alone does not say how one moves.
    this.flyMode =
      opts.fly === 'horizontal'
        ? 'horizontal'
        : opts.fly === true || (this.winged && opts.fly !== false && this.variant === 'red')
          ? 'vertical'
          : null;
    this.flying = this.flyMode != null;
    this.homeY = y;
    // InitRedPTroopa (asm:8214-8226) keeps the written row as the TOP of the
    // travel and puts the centre 48 pixels BELOW it — or, for one written low on
    // the screen, 32 pixels above. The bob is around that centre, not around the
    // written row.
    this.flyDrop = opts.flyDrop != null ? opts.flyDrop : opts.range != null ? opts.range : y < 128 ? 48 : -32;
    this.flyRate = opts.flyRate == null ? 0.042 : opts.flyRate;
    // MoveFlyGreenPTroopa sways one pixel every fourth frame and turns the sway
    // over on bit 6 of the frame counter, i.e. every 64 frames.
    this.swayRate = opts.swayRate == null ? Math.PI / 64 : opts.swayRate;
    this.cruiseRange = opts.cruiseRange == null ? 64 : opts.cruiseRange;
    this.homeX = x;
    this.hopPower =
      opts.hopPower == null ? Math.sqrt(2 * enemyGravity() * HOP_RISE) : opts.hopPower;

    // Green koopas walk straight off a ledge; red ones turn at the edge.
    this.turnAtLedge = opts.turnAtLedge != null ? !!opts.turnAtLedge : this.variant === 'red';

    this.anim = this.winged ? this.art.fly : this.art.walk;
    this.isWalker = !this.winged;
    this.isEnemy = true;
    this.flyT = 0;
  }

  update() {
    if (frozen(this.world)) return;

    if (this.winged && this.flyMode === 'vertical') {
      // ProcMoveRedPTroopa moves on ONE axis. The old code drifted it sideways
      // as well, which no red paratroopa in the original does.
      this.flyT++;
      const prev = this.y;
      const centre = this.homeY + this.flyDrop;
      this.y = centre - Math.cos(this.flyT * this.flyRate) * this.flyDrop;
      this.vy = this.y - prev;
      this.vx = 0;
      return;
    }

    if (this.winged && this.flyMode === 'horizontal') {
      this.flyT++;
      const prev = this.x;
      this.x = this.homeX + Math.sin(this.flyT * this.flyRate) * this.cruiseRange;
      this.vx = this.x - prev;
      if (this.vx !== 0) this.facing = this.vx < 0 ? -1 : 1;
      // The wave is a pixel at a time and shallow enough that it never carries
      // the troopa into anything; it is decoration on top of the cruise.
      this.y = this.homeY + Math.sin(this.flyT * this.swayRate) * 4;
      this.vy = 0;
      return;
    }

    const col = walkStep(this, {
      speed: this.speed,
      turnAtLedge: this.turnAtLedge && !this.winged,
    });
    if (this.winged && col.hitBottom) {
      this.vy = -this.hopPower;
      this.grounded = false;
      fx(this.world, 'landingDust', this.centerX, this.y + this.h, 0.7);
    }
    enemyBump(this);
  }

  draw(ctx, cam) {
    const anim = this.winged && !this.dead ? this.art.fly : this.art.walk;
    this.drawAnim(ctx, cam, anim);
  }

  _toShell(dir) {
    const shell = spawnAt(this.world, 'shell', this.x, this.y + this.h - 16, {
      variant: this.variant,
      facing: dir || this.facing,
      active: true,
    });
    fx(this.world, 'enemyPoof', this.centerX, this.y + this.h - 8);
    this.remove();
    return shell;
  }

  onStomp(player) {
    if (this.dead) return false;
    if (this.winged) {
      // The first stomp only strips the wings. ChkForDemoteKoopa
      // (smbdis.asm:11480-11493) rewrites the id, then `lda #$03 / jsr
      // SetupFloateyNumber` awards a flat 400 ("400" is index $03 of
      // FloateyNumTileData, asm:1265) and jumps to SBnce — it never touches
      // StompChainCounter either, so losing the wings is worth 400 whatever the
      // chain was doing.
      this.winged = false;
      this.flying = false;
      this.flyMode = null;
      this.isWalker = true;
      this.vy = 0;
      this.grounded = false;
      this.stompPoints = 400;
      fx(this.world, 'powerupSparkle', this.centerX, this.y + 6);
      return true;
    }
    // Stomping the demoted troopa into its shell IS a chain stomp
    // (HandleStompedShellE, asm:11497), so hand the score back to the chain.
    this.stompPoints = 0;
    this._toShell(player && player.facing ? player.facing : this.facing);
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

registerEntity(Koopa);
