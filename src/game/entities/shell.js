import { Entity, registerEntity } from '../entity.js';
import * as EA from '../../data/sprites/enemies-a.js';
import {
  pickAnim,
  pickSprite,
  enemyDie,
  frozen,
  hurtPlayer,
  starTouch,
  spawnAt,
  addScore,
  chainScore,
  shellChainScore,
  shellSpeed,
  enemyGravity,
  enemyMaxFall,
  fx,
  sfx,
} from './index.js';

// HandleStompedShellE (smbdis.asm:11499-11510) sets EnemyIntervalTimer from
// RevivalRateData (asm:11496) to $10. EnemyIntervalTimer is $0796, ABOVE the
// frame-timer cut at offset $14, so DecTimers (asm:786-799) only decrements it
// once per 21 frames: 16 * 21 = 336 frames before the koopa climbs back in.
//
// The last WOBBLE_FRAMES of that are the shiver that telegraphs it. The original
// has no wobble — it is ours — so it is spent out of the 336, not added to it.
//
// NOT YET FAITHFUL: RevivalRateData's second entry is $0b (231 frames) under
// PrimaryHardMode, i.e. worlds 5-8. We have no hard-mode flag at all yet — see
// the hard-mode item in agent-reports/enemies.md, which covers enemy walk speed,
// the hammer interval and Bowser's flame timer as well.
// The ROM's own two numbers, kept separate so the total below can never drift
// away from them: $10 ticks of a timer that moves once every 21 frames.
const REVIVE_TICKS = 0x10;
const INTERVAL_FRAMES = 21;
const REVIVE_FRAMES = REVIVE_TICKS * INTERVAL_FRAMES; // 336

const WOBBLE_FRAMES = 80;
const STILL_FRAMES = REVIVE_FRAMES - WOBBLE_FRAMES;

// KickedShellPtsData (smbdis.asm:11325) = $0a, $06, $04, indexed by the shell's
// revival timer when the player kicks it. Those are FloateyNumTileData indices,
// so via chainScore's zero-based view they are 8000 / 1000 / 500 — kicking a
// shell in the last instants before the koopa climbs back in is worth far more
// than the chain formula pays. HandlePECollisions (asm:11366-11373) reads the
// timer, and only falls back to `$03 + StompChainCounter` when it is >= 3.
// chainScore indices for 8000 / 1000 / 500, in timer order 0, 1, 2.
const KICKED_SHELL_PTS = [9, 5, 3];

const ART = {
  green: {
    rest: pickSprite(EA, ['KOOPA_GREEN.shell', 'KOOPA_SHELL'], null),
    spin: pickAnim(EA, ['KOOPA_GREEN.shellSpin', 'SHELL_SPIN'], null, 4),
  },
  red: {
    rest: pickSprite(EA, ['KOOPA_RED.shell', 'KOOPA_GREEN.shell'], null),
    spin: pickAnim(EA, ['KOOPA_RED.shellSpin', 'KOOPA_GREEN.shellSpin'], null, 4),
  },
  buzzy: {
    rest: pickSprite(EA, ['BUZZY.shell', 'KOOPA_GREEN.shell'], null),
    spin: pickAnim(EA, ['BUZZY.shellSpin', 'KOOPA_GREEN.shellSpin'], null, 4),
  },
};

export default class Shell extends Entity {
  static type = 'shell';

  constructor(world, x, y, opts = {}) {
    super(world, x, y, opts);
    this.w = 16;
    this.h = 16;
    this.variant = ART[opts.variant] ? opts.variant : 'green';
    this.art = ART[this.variant];
    this.facing = opts.facing || -1;
    this.speed = opts.speed == null ? shellSpeed() : opts.speed;

    this.sliding = !!opts.kicked;
    this.vx = this.sliding ? this.speed * this.facing : 0;
    this.stillT = 0;
    this.chain = 0;
    // Consecutive frames a sliding shell has failed to move at all. See update().
    this.stuckT = 0;
    // Brief grace so the shell the player just made cannot instantly hurt them.
    this.kickGrace = 8;

    this.isEnemy = true;
    this.isWalker = false;
    this.isShell = true;
  }

  update() {
    if (frozen(this.world)) return;
    if (this.kickGrace > 0) this.kickGrace--;

    this.applyGravity(enemyGravity(), enemyMaxFall());

    if (this.sliding) {
      this.vx = this.speed * this.facing;
      const x0 = this.x;
      const col = this.moveAndCollide();
      if (col.hitLeft || col.hitRight) this._hitWall(col);
      // A shell penned in a gap no wider than itself — 1-2 has a 1-tile slot at
      // column 32, between the pillars at 31 and 33 — reverses every single
      // frame and still travels zero pixels. Reversing is already what the ROM
      // does (DoEnemySideCheck -> InvEnemyDir, asm:12592-12631, and _hitWall
      // below); measured in that slot the shell flips facing and vx between +3
      // and -3 forever while x never leaves 512.00, so no amount of ejection
      // fixes it. The state cannot arise in the original because the original
      // never places an enemy there, and it is poisonous: a shell that is
      // permanently `sliding` never accrues stillT, so the koopa never climbs
      // back in, and a player standing in the same tile has already spent their
      // one Enemy_CollisionBits interaction and can never be hurt by it.
      //
      // So park it. A resting shell is harmless to stand in — which is true of
      // the original too — and the revival clock starts running again. Two
      // frames, because a shell rebounding off a wall legitimately stands still
      // for the single frame it turns around.
      if (this.x === x0) {
        if (++this.stuckT >= 2) this.stop();
      } else {
        this.stuckT = 0;
      }
      this._sweep();
      return;
    }

    this.stuckT = 0;
    this.vx = 0;
    this.moveAndCollide();
    this.stillT++;
    if (this.stillT >= STILL_FRAMES + WOBBLE_FRAMES) this._revert();
  }

  get wobbling() {
    return !this.sliding && this.stillT >= STILL_FRAMES;
  }

  // The ROM's EnemyIntervalTimer for this shell: it starts at $10 and counts
  // DOWN once every 21 frames, where our stillT counts UP once a frame. Zero
  // means the koopa is climbing back out this instant.
  get revivalTimer() {
    if (this.sliding) return REVIVE_TICKS;
    return Math.max(0, REVIVE_TICKS - Math.floor(this.stillT / INTERVAL_FRAMES));
  }

  _hitWall(col) {
    const face = col.hitLeft ? col.left : col.right;
    this.facing = col.hitLeft ? 1 : -1;
    this.vx = this.speed * this.facing;
    sfx(this.world, 'bump');
    fx(this.world, 'lavaSpark', col.hitLeft ? this.x : this.x + this.w, this.centerY);

    // A shell at full tilt shatters brick and pops question blocks.
    if (face && this.world) {
      const rec = face.tile;
      if (rec && rec.breakable && typeof this.world.breakBlock === 'function') {
        this.world.breakBlock(face.tx, face.ty, this);
      } else if (rec && rec.bumpable && typeof this.world.bumpBlock === 'function') {
        this.world.bumpBlock(face.tx, face.ty, this);
      }
    }
  }

  // A moving shell mows down every enemy it touches, worth more each time.
  _sweep() {
    const list = this.world && this.world.entities;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o || o === this || o.removed || o.dead) continue;
      if (!o.isEnemy || o.shellProof) continue;
      if (typeof o.onShell !== 'function' || !this.hits(o)) continue;
      const pts = shellChainScore(this.chain++);
      o.onShell(this);
      addScore(this.world, pts, o.centerX, o.y);
      sfx(this.world, 'kick');
      if (this.world && typeof this.world.freeze === 'function') this.world.freeze(2);
    }
  }

  kick(dir) {
    this.sliding = true;
    this.facing = dir < 0 ? -1 : 1;
    this.vx = this.speed * this.facing;
    this.stillT = 0;
    this.chain = 0;
    this.kickGrace = 8;
    sfx(this.world, 'kick');
    fx(this.world, 'landingDust', this.centerX, this.y + this.h, 1);
  }

  stop() {
    this.sliding = false;
    this.vx = 0;
    this.stillT = 0;
    this.chain = 0;
  }

  _revert() {
    const type = this.variant === 'buzzy' ? 'buzzy' : 'koopa';
    const h = type === 'buzzy' ? 16 : 24;
    spawnAt(this.world, type, this.x, this.y + this.h - h, {
      variant: this.variant === 'red' ? 'red' : 'green',
      facing: this.facing,
      active: true,
    });
    fx(this.world, 'enemyPoof', this.centerX, this.centerY);
    this.remove();
  }

  draw(ctx, cam) {
    if (this.sliding && !this.dead) {
      this.drawAnim(ctx, cam, this.art.spin);
      return;
    }
    if (this.wobbling && !this.dead) {
      // Shivering shell — telegraphs the koopa climbing back in.
      const t = this.stillT - STILL_FRAMES;
      this.drawSprite(ctx, cam, this.art.rest, { ox: (t >> 2) & 1 ? 1 : -1 });
      return;
    }
    this.drawSprite(ctx, cam, this.art.rest);
  }

  onStomp() {
    if (this.dead) return false;
    // Only a MOVING shell is a stomp. Its d7 is set, so HandlePECollisions sends
    // it through ChkForPlayerInjury (asm:11377) to HandleStompedShellE
    // (asm:11499-11512) — the one path that does `inc StompChainCounter` and
    // sets the #$fc bounce.
    if (this.sliding) {
      this.stop();
      return true;
    }
    // A RESTING shell is NOT a stomp, however fast the player is falling.
    // HandlePECollisions (asm:11355-11376) picks the kick path purely off the
    // enemy state — d7 clear, 3 LSB >= 2 — and never reads Player_Y_Speed at
    // all. That path ends `KSPts: jsr SetupFloateyNumber / ExPEC: rts`: no
    // chain increment and no Player_Y_Speed write, i.e. kicking a shell does
    // not bounce Mario. Returning false hands the contact to onPlayerTouch
    // below, which already models the kick and its `#$03 + StompChainCounter`
    // score.
    //
    // Absorbing it here paid a SECOND chain rung and a SECOND bounce per
    // stop/kick cycle. Against a shell that cannot escape — the 1-tile slot at
    // column 32 of 1-2, where the pillars at 31 and 33 pen it in — that was an
    // unbreakable airborne chain: 99 lives in 89 seconds with the jump button
    // held and the player's feet never once touching the floor.
    return false;
  }

  onPlayerTouch(player) {
    if (this.dead) return;
    // The grace window has to be checked BEFORE the sliding branch. kick() sets
    // `sliding` and `kickGrace` together, so a player who is still overlapping the
    // shell on the frame after kicking it would otherwise be hurt by the very shell
    // they just kicked away.
    if (this.kickGrace > 0) return;
    if (this.sliding) {
      // Star Mario smashes a live shell instead of taking the hit.
      if (starTouch(this, player, 200)) return;
      hurtPlayer(this);
      return;
    }
    let dir = player && player.centerX > this.centerX ? -1 : 1;
    if (player && Math.abs(player.vx || 0) > 0.15) dir = player.vx > 0 ? 1 : -1;

    // Read the revival timer BEFORE kicking — kick() resets stillT, and the
    // original scores off the timer the shell had at the moment of contact.
    const timer = this.revivalTimer;
    this.kick(dir);

    // The kick itself scores. HandlePECollisions (smbdis.asm:11366-11373) does
    // `lda #$03 / adc StompChainCounter`, so a fresh chain pays 400 — but only
    // when the shell is not about to re-animate. `ldy EnemyIntervalTimer,x /
    // cpy #$03 / bcs KSPts` diverts anything under three ticks to
    // KickedShellPtsData instead, paying 8000, 1000 or 500 for catching it in
    // the last moments. Only the side-kick pays at all: a shell kicked by
    // landing on it is already covered by the stomp chain the world awards.
    const idx = timer < KICKED_SHELL_PTS.length ? KICKED_SHELL_PTS[timer] : 2 + (player ? player.stompChain | 0 : 0);
    addScore(this.world, chainScore(idx), this.centerX, this.y);
  }

  onFireball(fb) {
    if (this.dead) return false;
    // The buzzy beetle's armour shrugs fire off even as a shell.
    if (this.variant === 'buzzy') return false;
    enemyDie(this, 'fireball', fb, 200);
    return true;
  }

  onShell(other) {
    enemyDie(this, 'shell', other, 0);
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

registerEntity(Shell);
