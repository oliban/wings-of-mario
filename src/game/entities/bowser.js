import { Entity, registerEntity } from '../entity.js';
import { SCREEN_H, SCREEN_W } from '../../core/constants.js';
import rng from '../../core/rng.js';
import * as BOSS from '../../data/sprites/boss.js';
import {
  pickAnim,
  pickSprite,
  frozen,
  hurtPlayer,
  isStarPlayer,
  playerOf,
  spawnAt,
  addScore,
  enemyGravity,
  enemyMaxFall,
  fx,
  sfx,
} from './index.js';

const WALK = pickAnim(BOSS, ['BOWSER.walk', 'BOWSER_WALK'], null, 10);
const MOUTH = pickSprite(BOSS, ['BOWSER.mouthOpen', 'BOWSER_MOUTH_OPEN', 'BOWSER.walk'], null);
const ARM_UP = pickSprite(BOSS, ['BOWSER.armUp', 'BOWSER_ARM_UP', 'BOWSER.mouthOpen'], null);
const FALLING = pickSprite(BOSS, ['BOWSER.falling', 'BOWSER_FALLING', 'BOWSER.walk'], null);
const JET = pickAnim(BOSS, ['BOWSER_FLAME.jet', 'BOWSER_FLAME', 'BOWSER_FIRE'], null, 5);

const TRACK_FRAMES = 26;

// Which world are we in? `opts.world` wins if a level ever supplies it; otherwise
// the leading number of the level id ('6-4' -> 6), read the way cannons.js:73
// reads it. Falls back to 1, i.e. the 1-4 arsenal, when nothing is knowable.
function worldNumberOf(world, opts) {
  if (opts && opts.world != null) return opts.world | 0;
  const lvl = world && world.level;
  const m = /^(\d+)/.exec(String((lvl && lvl.id) || ''));
  return m ? m[1] | 0 : 1;
}

// Apex of Bowser's hop, in pixels — three tiles, as on the bridge. The impulse
// is solved from it against the shared enemy gravity so his weight comes from
// the arc, not from a private gravity constant.
const HOP_RISE = 49;

// Two-frame white-out for fireball hits, built on demand and cached.
const whiteCache = new Map();
function whiteOf(spr) {
  if (!spr || typeof spr.shift !== 'function') return spr;
  let w = whiteCache.get(spr);
  if (!w) {
    w = spr.shift(() => '#ffffff', (spr.name || 'bowser') + ':flash');
    whiteCache.set(spr, w);
  }
  return w;
}

export class BowserFire extends Entity {
  static type = 'bowserfire';

  constructor(world, x, y, opts = {}) {
    super(world, x, y, opts);
    this.w = 24;
    this.h = 12;
    this.anchor = 'center';
    this.facing = opts.dir || opts.facing || -1;
    this.speed = opts.speed == null ? 2.0 : opts.speed;
    this.vx = this.speed * this.facing;
    this.vy = 0;
    this.gravity = 0;
    this.noclip = true;
    this.life = opts.life == null ? 220 : opts.life;
    this.isEnemy = false;
    this.projectile = true;
    this.active = true;
    this.alwaysUpdate = true;
  }

  update() {
    if (frozen(this.world)) return;

    // The jet drifts onto the player's height early, then commits to it.
    if (this.tick < TRACK_FRAMES) {
      const p = playerOf(this.world);
      if (p) {
        const d = p.centerY - this.centerY;
        this.vy = Math.max(-1.1, Math.min(1.1, d * 0.08));
      }
    } else {
      this.vy = 0;
    }

    this.x += this.vx;
    this.y += this.vy;
    if ((this.tick & 3) === 0) {
      fx(this.world, 'lavaSpark', this.facing > 0 ? this.x : this.x + this.w, this.centerY);
    }

    const cam = this.world && this.world.cam;
    const camX = cam ? cam.x : 0;
    if (--this.life <= 0 || this.x + this.w < camX - 48 || this.x > camX + SCREEN_W + 48) {
      this.remove();
    }
  }

  draw(ctx, cam) {
    this.drawSprite(ctx, cam, JET.frame(this.tick));
  }

  onPlayerTouch() {
    hurtPlayer(this);
  }

  onStomp() {
    return false;
  }

  onStar() {
    this.remove();
  }

  onFireball() {
    return false;
  }

  onShell() {}
}

export default class Bowser extends Entity {
  static type = 'bowser';

  constructor(world, x, y, opts = {}) {
    super(world, x, y, opts);
    this.w = 32;
    this.h = 32;
    this.facing = opts.facing || -1;
    this.persistent = true;
    this.alwaysUpdate = true;
    this.active = true;
    // He stages his own death: the axe drops him into the lava.
    this.autoCorpse = false;

    this.homeX = x;
    this.range = opts.range == null ? 34 : opts.range;
    this.speed = opts.speed == null ? 0.35 : opts.speed;
    this.dir = opts.dir || -1;

    this.maxHp = opts.hp == null ? 5 : opts.hp;
    this.hp = this.maxHp;
    this.flash = 0;

    this.hopPeriod = opts.hopPeriod == null ? 132 : opts.hopPeriod;
    this.hopT = rng.int(0, 60);
    this.firePeriod = opts.firePeriod == null ? 116 : opts.firePeriod;
    this.fireT = rng.int(0, 40);
    this.breatheT = -1;

    // ChkFireB / HammerChk (smbdis.asm, RunBowser) split his arsenal by world and
    // the two halves do NOT overlap:
    //   worlds 1-5  flames, no hammers   (`cmp #World6 / bcc SetHmrTmr`)
    //   worlds 6-7  hammers, NO flames   (`cmp #World6 / bcs BowserGfxHandler`)
    //   world  8    flames AND hammers   (`cmp #World8 / beq SpawnFBr`)
    // The level data carries no `world` option, so it is read off the level id the
    // way cannons.js:73 does. Without this he threw no hammers anywhere and
    // breathed fire everywhere.
    const wn = worldNumberOf(world, opts);
    this.worldNum = wn;
    this.throwsHammers = opts.hammers != null ? !!opts.hammers : wn >= 6;
    this.breathesFire = opts.fire != null ? !!opts.fire : wn < 6 || wn >= 8;
    this.hammerPeriod = opts.hammerPeriod == null ? 84 : opts.hammerPeriod;
    this.hammerT = rng.int(0, 50);
    this.armT = 0;

    this.falling = false;
    this.isEnemy = true;
    this.shellProof = true;
    this.boss = true;
  }

  update() {
    if (frozen(this.world)) return;
    if (this.flash > 0) this.flash--;

    if (this.falling) {
      this._fallStep();
      return;
    }

    const p = playerOf(this.world);
    if (p) this.facing = p.centerX < this.centerX ? -1 : 1;

    this.applyGravity(enemyGravity(), enemyMaxFall());

    if (this.breatheT < 0) {
      if (this.x < this.homeX - this.range) this.dir = 1;
      else if (this.x > this.homeX + this.range) this.dir = -1;
      this.vx = this.speed * this.dir;
    } else {
      this.vx = 0;
    }

    const col = this.moveAndCollide();
    if (col.hitLeft || col.hitRight) this.dir = -this.dir;

    this._hopStep();
    if (this.breathesFire) this._fireStep();
    if (this.throwsHammers) this._hammerStep();
    if (this.armT > 0) this.armT--;
  }

  _hopStep() {
    if (!this.grounded || this.breatheT >= 0) return;
    if (++this.hopT < this.hopPeriod) return;
    this.hopT = 0;
    this.vy = -Math.sqrt(2 * enemyGravity() * HOP_RISE);
    this.grounded = false;
    sfx(this.world, 'jump');
    fx(this.world, 'landingDust', this.centerX, this.y + this.h, 2);
  }

  _fireStep() {
    if (this.breatheT >= 0) {
      this.breatheT++;
      if (this.breatheT === 10) this._breathe();
      if (this.breatheT >= 34) this.breatheT = -1;
      return;
    }
    if (++this.fireT < this.firePeriod) return;
    this.fireT = 0;
    this.breatheT = 0;
  }

  _breathe() {
    const mx = this.facing > 0 ? this.x + this.w - 4 : this.x - 20;
    const my = this.y + 12;
    spawnAt(this.world, 'bowserfire', mx, my, { dir: this.facing });
    sfx(this.world, 'bowserfire');
    if (typeof this.world.shake === 'function') this.world.shake(1, 5);
    fx(this.world, 'lavaSpark', this.facing > 0 ? this.x + this.w : this.x, my + 6);
  }

  _hammerStep() {
    if (this.breatheT >= 0) return;
    if (++this.hammerT < this.hammerPeriod) return;
    this.hammerT = 0;
    this.armT = 16;
    spawnAt(this.world, 'hammer', this.x + (this.facing > 0 ? this.w - 8 : -4), this.y - 6, {
      vx: 1.5 * this.facing,
      vy: -6.4,
      owner: this,
    });
    sfx(this.world, 'kick');
  }

  // Scripted plunge into the lava once the bridge is gone: collision is off and
  // the body is already dead, so this is animation timing rather than enemy
  // locomotion, and it deliberately falls faster than PHYS.enemyGravity.
  _fallStep() {
    this.vy = Math.min(this.vy + 0.28, 6);
    this.y += this.vy;
    if ((this.tick & 7) === 0) fx(this.world, 'lavaSpark', this.centerX, this.y + this.h);
    const cam = this.world && this.world.cam;
    if (this.y > (cam ? cam.y : 0) + SCREEN_H + 32) this.remove();
  }

  // Five fireballs, exactly as in the original.
  onFireball(fb) {
    if (this.dead) return true;
    this.hp--;
    this.flash = 2;
    sfx(this.world, 'bump');
    if (typeof this.world.freeze === 'function') this.world.freeze(2);
    fx(this.world, 'fireballBurst', this.centerX, this.centerY);
    // The fifth fireball is the ONLY thing that unmasks him — the axe just drops
    // the bridge, and the plunge hides whatever he really was.
    if (this.hp <= 0) this.defeat(fb, true);
    return true;
  }

  // BowserIdentities (smbdis.asm:11120) — indexed by WorldNumber, which is
  // zero-based, so world 1 unmasks as a goomba and only world 8 is the real
  // thing. HurtBowser (asm:11128-11145) rewrites Enemy_ID in place, gives it
  // `lda #$fe` of upward speed and a defeated state, and THAT is the body that
  // falls. Our roster's names, in the same order.
  _revealType() {
    const ROSTER = ['goomba', 'koopa', 'buzzy', 'spiny', 'lakitu', 'blooper', 'hammerbro'];
    if (this.worldNum < 1 || this.worldNum > ROSTER.length) return null;
    return ROSTER[this.worldNum - 1];
  }

  // Swap the boss for the little enemy he always was and let that tumble away.
  // Returns true when the reveal happened and Bowser himself is gone.
  _reveal(by) {
    const type = this._revealType();
    if (!type) return false;
    const e = spawnAt(this.world, type, this.x, this.y, {
      variant: type === 'koopa' ? 'green' : undefined,
      active: true,
    });
    if (!e) return false;
    // Seat it where his feet were, not where his shoulders were.
    e.x = this.centerX - e.w * 0.5;
    e.y = this.y + this.h - e.h;
    e.facing = this.facing;
    if (typeof e.kill === 'function') e.kill('shell', by || null);
    e.vy = -2.4;
    return true;
  }

  // The axe drops the bridge out from under him. `unmask` is set only by the
  // fireball path; everything else takes the plunge as Bowser.
  defeat(by, unmask) {
    if (this.dead) return;
    this.dead = true;
    this.tangible = false;
    this.falling = true;
    this.noclip = true;
    this.vx = 0;
    this.vy = -2.4;
    this.killStyle = 'fall';
    this.killedBy = by || null;
    if (typeof this.world.freeze === 'function') this.world.freeze(10);
    if (typeof this.world.shake === 'function') this.world.shake(3, 20);
    sfx(this.world, 'bowserfall');
    addScore(this.world, 5000, this.centerX, this.y);
    fx(this.world, 'enemyPoof', this.centerX, this.centerY);
    // Worlds 1-7, killed by fire: the disguise comes off and the impostor falls
    // in his place, so Bowser's own body must not also be drawn plunging.
    if (unmask && this._reveal(by)) this.remove();
  }

  onAxe() {
    this.defeat(null);
  }

  fallIntoLava() {
    this.defeat(null);
  }

  kill(style, by) {
    // Nothing gets to delete the boss outright — he always takes the plunge.
    this.defeat(by);
    return true;
  }

  draw(ctx, cam) {
    let spr;
    if (this.falling) spr = FALLING;
    else if (this.breatheT > 4 && this.breatheT < 30) spr = MOUTH;
    else if (this.armT > 0) spr = ARM_UP;
    else spr = WALK.frame(this.tick);
    if (this.flash > 0) spr = whiteOf(spr);
    this.drawSprite(ctx, cam, spr, { flipY: this.falling });
  }

  onStomp() {
    return false;
  }

  onPlayerTouch(player) {
    if (this.dead) return;
    // Star Mario barges straight through him.
    if (isStarPlayer(player)) {
      this.defeat(player);
      return;
    }
    hurtPlayer(this);
  }

  onStar(player) {
    this.defeat(player);
  }

  onShell() {}

  onBlockBump() {}

  onBumped() {}
}

registerEntity(Bowser);
registerEntity(BowserFire);
