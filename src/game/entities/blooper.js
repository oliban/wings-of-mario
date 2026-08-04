import { Entity, registerEntity } from '../entity.js';
import * as EB from '../../data/sprites/enemies-b.js';
import { pickSprite, enemyDie, frozen, hurtPlayer, starTouch, playerOf, fx, hardMode } from './index.js';
import rng from '../../core/rng.js';

const THRUST_T = 26;
const DRIFT_T = 34;

const OPEN = pickSprite(EB, ['BLOOPER.open', 'BLOOPER_OPEN', 'BLOOPER'], null);
const CLOSED = pickSprite(EB, ['BLOOPER.closed', 'BLOOPER_CLOSED', 'BLOOPER.open'], null);

export default class Blooper extends Entity {
  static type = 'blooper';

  constructor(world, x, y, opts = {}) {
    super(world, x, y, opts);
    this.w = 16;
    this.h = 24;
    this.facing = opts.facing || -1;
    this.gravity = 0;
    this.underwater = opts.underwater !== false;
    this.power = opts.power == null ? 1.55 : opts.power;
    this.thrusting = false;
    this.phaseT = 0;
    // MoveBloober (asm:9466-9483) does NOT re-aim every stroke. Once a frame it
    // masks the LSFR with BlooberBitmasks — %00111111 normally, %00000011 in
    // secondary hard mode — and only re-points itself at the player when every
    // masked bit comes up clear. That is one chance in 64 a frame against one in
    // four: normally it commits to a heading and drifts, in hard mode it stays
    // on you. In between it keeps whatever Enemy_MovingDir it already had.
    this.chaseDir = this.facing;
    this.isEnemy = true;
    // Bloober ($07) is the third `iny` case in EnemyStomped (asm:11459-11460),
    // so Y=3 and StompedEnemyPtsData[3] = $06 (asm:11436) = "1000". The original
    // can never actually pay it — a water area sends every contact to
    // InjurePlayer (asm:11346-11347) — but the value is unambiguous, and our
    // bloobers can leave the water, where onStomp() allows the squash.
    this.stompPoints = 1000;
  }

  update() {
    if (frozen(this.world)) return;
    this.phaseT++;

    if (this.thrusting) {
      // Squeezed shut, coasting along the vector it committed to.
      this.vx *= 0.962;
      this.vy *= 0.962;
      if (this.phaseT >= THRUST_T) {
        this.thrusting = false;
        this.phaseT = 0;
      }
    } else {
      // Open and sinking, spreading away from where it last struck.
      this.vx *= 0.93;
      this.vy = Math.min(this.vy + 0.055, 0.85);
      if (this.phaseT >= DRIFT_T) this._thrust();
    }

    const col = this.moveAndCollide();
    if (col.hitLeft || col.hitRight) this.vx = -this.vx * 0.4;

    const cam = this.world && this.world.cam;
    const top = (cam ? cam.y : 0) + 8;
    if (this.y < top) {
      this.y = top;
      if (this.vy < 0) this.vy = 0;
    }
    if (Math.abs(this.vx) > 0.08) this.facing = this.vx > 0 ? 1 : -1;

    this._aimStep();
  }

  // The once-a-frame re-aim, with the original's two odds.
  _aimStep() {
    const bits = hardMode(this.world) ? 4 : 64;
    if (!rng.chance(1 / bits)) return;
    const p = playerOf(this.world);
    if (p) this.chaseDir = p.centerX < this.centerX ? -1 : 1;
  }

  _thrust() {
    this.thrusting = true;
    this.phaseT = 0;
    const p = playerOf(this.world);
    let dx = 0;
    let dy = -1;
    if (p) {
      // Horizontally it swims the way it is already pointed — the heading only
      // changes when _aimStep says so. Vertically it always works towards the
      // player, which is what MoveBloober's up/down half does regardless.
      dx = Math.abs(p.centerX - this.centerX) * this.chaseDir;
      dy = p.centerY - this.centerY - 14;
    }
    const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    this.vx = (dx / len) * this.power;
    this.vy = (dy / len) * this.power - 0.55;
    if (this.vy > 0.5) this.vy = 0.5;
    fx(this.world, 'bubble', this.centerX, this.y + this.h);
  }

  draw(ctx, cam) {
    this.drawSprite(ctx, cam, this.thrusting && !this.dead ? CLOSED : OPEN);
  }

  onStomp(player) {
    if (this.dead) return false;
    // Nothing to push off underwater.
    if (this.underwater) return false;
    this.kill('stomp', player);
    this.squashTicks = 24;
    return true;
  }

  onPlayerTouch(player) {
    if (this.dead) return;
    if (starTouch(this, player, 200)) return;
    hurtPlayer(this);
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
}

registerEntity(Blooper);
