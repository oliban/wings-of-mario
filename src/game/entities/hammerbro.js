import { Entity, registerEntity } from '../entity.js';
import { makeSprite, Anim } from '../../core/gfx.js';
import rng from '../../core/rng.js';
import * as EB from '../../data/sprites/enemies-b.js';
import {
  pickAnim,
  pickSprite,
  enemyDie,
  frozen,
  hurtPlayer,
  starTouch,
  playerOf,
  spawnAt,
  enemyGravity,
  enemyMaxFall,
  fx,
  sfx,
  hardMode,
  hardPick,
} from './index.js';

// 0 outline 1 shell dark 2 shell mid 3 shell lit 4 shell spec
// 5 skin 6 eye 7 belly 8 helmet 9 white
const BRO_PAL = [
  '#1a1008', '#0d4a12', '#1d8f22', '#55c753', '#bdf4ab',
  '#f8d5ac', '#12080a', '#e8d59a', '#0a2d0c', '#ffffff',
];

// Helmeted brawler: brim, scowl, plated chest, legs that alternate.
const BRO_A = [
  '....00000000....',
  '..088888888880..',
  '.08888888888880.',
  '.00000000000000.',
  '.05555555555550.',
  '.05596555965550.',
  '.05555555555550.',
  '.00000000000000.',
  '0222333333332220',
  '0223337777333220',
  '0233377777733320',
  '0233377777733320',
  '0223337777333220',
  '0112223333322110',
  '.01112222221110.',
  '.00000000000000.',
  '..011122221110..',
  '..011100001110..',
  '..011100001110..',
  '..055500005550..',
  '..055500005550..',
  '.05555000055550.',
  '.05555000055550.',
  '.00000000000000.',
];

const BRO_B = BRO_A.slice(0, 16).concat([
  '..011122221110..',
  '..011111111110..',
  '..011111111110..',
  '..055555555550..',
  '..055555555550..',
  '.05555555555550.',
  '.05555555555550.',
  '.00000000000000.',
]);

const BRO_THROW = BRO_A.slice();
BRO_THROW[6] = '.05500000000550.';

// Stomped: helmet, face and plated chest driven down into a single flat band,
// legs splayed out from under it. Bottom-anchored, so it sits on the ground.
const BRO_FLAT = [
  '....00000000....',
  '..088888888880..',
  '.00555555555500.',
  '.05596555965550.',
  '0022233377733200',
  '0111222222221110',
  '.00000000000000.',
];

const local = (rows, name) => makeSprite(rows, BRO_PAL, { name });

const WALK = pickAnim(
  EB,
  ['HAMMER_BRO.walk', 'HAMMERBRO.walk', 'HAMMERBRO_WALK'],
  () => new Anim([local(BRO_A, 'hammerbro-a'), local(BRO_B, 'hammerbro-b')], 10),
  10
);
const THROW_ANIM = pickAnim(
  EB,
  ['HAMMER_BRO.throwing', 'HAMMERBRO.throw', 'HAMMERBRO_THROW'],
  () => new Anim([local(BRO_THROW, 'hammerbro-throw')], 20, false),
  14
);
const FLAT = pickSprite(
  EB,
  ['HAMMER_BRO.flat', 'HAMMERBRO.flat', 'HAMMERBRO_FLAT'],
  () => local(BRO_FLAT, 'hammerbro-flat')
);
export const HAMMERBRO_ART = { walk: WALK, throw: THROW_ANIM, flat: FLAT };

// Wind-up runs the length of the throw pose; the hammer leaves his hand as the
// second frame comes up.
const WINDUP = Math.max(20, THROW_ANIM.duration);
const RELEASE_AT = Math.max(10, THROW_ANIM.holds[0] || 14);

// Apex of the hop in pixels, which is what the ceiling/floor probes below are
// written against. The launch velocity is solved from it against the shared
// enemy gravity, so the arc survives a change to the physics contract.
const HOP_RISE = 71;

// The thrown hammer itself lives in ./hammer.js and is spawned by type.
export default class HammerBro extends Entity {
  static type = 'hammerbro';

  constructor(world, x, y, opts = {}) {
    super(world, x, y, opts);
    this.w = 16;
    this.h = 24;
    this.facing = opts.facing || -1;

    this.homeX = x;
    this.range = opts.range == null ? 26 : opts.range;
    this.speed = opts.speed == null ? 0.35 : opts.speed;
    this.dir = opts.dir || -1;
    // InitHammerBro (asm:8184-8192) seeds EnemyIntervalTimer from
    // HBroWalkingTimerData = $80, $50 — 128 frames before he starts walking at
    // the player, 80 in secondary hard mode. He comes for you sooner.
    this.walkT = opts.walkT == null ? hardPick(world, 128, 80) : opts.walkT;

    // ProcHammerBro (smbdis.asm:9219-9231): HammerThrowingTimer reloads from
    // HammerThrowTmrData (asm:9207) with $30 and is decremented once per frame,
    // so a hammer leaves his hand every 49 frames — relentlessly, for as long as
    // he is on screen. There is no volley in the original: the bursts-and-gaps
    // pattern this used to have was invention, and it cost him half his output.
    // HammerThrowTmrData is a TWO-entry table, $30 and $1c, indexed by
    // SecondaryHardMode: 49 frames between hammers normally, 29 in hard mode.
    this.throwPeriod =
      opts.throwPeriod == null ? hardPick(world, 49, 0x1c + 1) : opts.throwPeriod;
    this.throwT = Math.floor(this.throwPeriod * (opts.phase == null ? 0.35 : opts.phase));
    this.windT = -1;

    this.hopPeriod = opts.hopPeriod == null ? 170 : opts.hopPeriod;
    this.hopT = 0;
    this.dropT = 0;
    this.isEnemy = true;
    // HammerBro ($05) is the first `iny` case in EnemyStomped (asm:11453-11455),
    // so Y=1 and StompedEnemyPtsData[1] = $06 (asm:11436) = "1000" in
    // FloateyNumTileData (asm:1268). Same value his fireball death already pays.
    this.stompPoints = 1000;
  }

  update() {
    if (frozen(this.world)) return;

    const p = playerOf(this.world);
    if (p) this.facing = p.centerX < this.centerX ? -1 : 1;

    this.applyGravity(enemyGravity(), enemyMaxFall());

    // Short nervous shuffle around the spawn point.
    this.walkT--;
    if (this.walkT <= 0) {
      this.dir = rng.chance(0.5) ? 1 : -1;
      this.walkT = rng.int(36, 84);
    }
    if (this.x < this.homeX - this.range) this.dir = 1;
    else if (this.x > this.homeX + this.range) this.dir = -1;
    this.vx = this.speed * this.dir;

    if (this.dropT > 0) {
      this.dropT--;
      this.colOpts.dropThrough = true;
    } else {
      this.colOpts.dropThrough = false;
    }

    const col = this.moveAndCollide();
    if (col.hitLeft || col.hitRight) this.dir = -this.dir;

    this._hopStep();
    this._throwStep();
  }

  _hopStep() {
    if (!this.grounded || this.dropT > 0) return;
    if (++this.hopT < this.hopPeriod) return;
    this.hopT = 0;

    const w = this.world;
    const solid = (px, py) => !!(w && typeof w.solidAt === 'function' && w.solidAt(px, py));
    const cx = this.centerX;
    const above = solid(cx, this.y - 34) || solid(cx, this.y - 50);
    const below = solid(cx, this.y + this.h + 40) || solid(cx, this.y + this.h + 72);

    if (above || !below || !rng.chance(0.45)) {
      // HammerBroJumpLData = $20, $37 (asm:9238) is how long he stays in the
      // air. Outside hard mode HJump forces the offset to 0 and he always gets
      // the short $20 hop; in hard mode the offset comes off the LSFR, so half
      // his hops are the long $37 one (asm:9262-9271).
      const long = hardMode(this.world) && rng.chance(0.5);
      this.vy = -Math.sqrt(2 * enemyGravity() * (long ? HOP_RISE * (0x37 / 0x20) : HOP_RISE));
      this.grounded = false;
      fx(this.world, 'landingDust', cx, this.y + this.h, 0.8);
    } else {
      // Duck down through the platform to the row below.
      this.dropT = 14;
      this.vy = 1.2;
      this.grounded = false;
    }
  }

  // The wind-up pose already shows the hammer cocked over his head, so the
  // thrown entity only appears at the moment of release.
  _throwStep() {
    // The throw clock runs through the wind-up as well, so release-to-release is
    // throwPeriod exactly rather than throwPeriod + WINDUP. The wind-up pose is
    // ours — the original spawns the hammer the instant the timer expires — so it
    // has to be paid for out of the interval, not added on top of it.
    this.throwT++;
    if (this.windT >= 0) {
      this.windT++;
      if (this.windT === RELEASE_AT) this._release();
      if (this.windT >= WINDUP) this.windT = -1;
      return;
    }
    if (this.throwT < this.throwPeriod) return;
    this.throwT = 0;
    this.windT = 0;
  }

  _release() {
    sfx(this.world, 'kick');
    spawnAt(this.world, 'hammer', this.x + (this.facing > 0 ? 10 : -6), this.y - 10, {
      vx: 1.7 * this.facing,
      vy: -6.6,
      owner: this,
    });
  }

  draw(ctx, cam) {
    // A stomp flattens him for squashTicks frames, the way it does a goomba.
    if (this.dead && this.killStyle === 'stomp') {
      this.drawSprite(ctx, cam, FLAT);
      return;
    }
    if (this.windT >= 0 && !this.dead) {
      // Driven off the wind-up clock so the pose plays from its first frame.
      this.drawSprite(ctx, cam, THROW_ANIM.frame(this.windT));
      return;
    }
    this.drawAnim(ctx, cam, WALK);
  }

  onStomp(player) {
    if (this.dead) return false;
    this.kill('stomp', player);
    this.squashTicks = 26;
    fx(this.world, 'enemyPoof', this.centerX, this.centerY);
    return true;
  }

  onFireball(fb) {
    if (this.dead) return false;
    enemyDie(this, 'fireball', fb, 1000);
    return true;
  }

  onShell(shell) {
    enemyDie(this, 'shell', shell, 0);
  }

  onStar(player) {
    enemyDie(this, 'shell', player, 1000);
  }

  onBlockBump(tx, ty, by) {
    enemyDie(this, 'shell', by, 1000);
  }

  onBumped(from) {
    enemyDie(this, 'shell', from, 1000);
  }

  onPlayerTouch(player) {
    if (this.dead) return;
    if (starTouch(this, player, 1000)) return;
    hurtPlayer(this);
  }
}

registerEntity(HammerBro);
