import { Entity, registerEntity } from '../entity.js';
import { makeSprite, Anim } from '../../core/gfx.js';
import * as EA from '../../data/sprites/enemies-a.js';
import {
  pickAnim,
  walkStep,
  enemyBump,
  enemyDie,
  frozen,
  hurtPlayer,
  starTouch,
  playerOf,
  fx,
  sfx,
  walkSpeed,
  enemyGravity,
  enemyMaxFall,
} from './index.js';

// 0 outline  1 shell dark  2 shell mid  3 shell lit  4 shell spec
// 5 face      6 eye/mouth   7 foot
const SPINY_PAL = [
  '#1a1008', '#7a2408', '#b8500e', '#e8892c', '#f8d5ac', '#ffffff', '#12080a', '#c05a12',
];

// Spiked carapace over a pale body, eyes toward the front. Authored facing
// RIGHT, like every other sprite in the game.
const SPINY_A = [
  '..0..0..0..0..0.',
  '..3..3..3..3..3.',
  '0333333333333330',
  '0443333333322220',
  '0443333332222210',
  '0433333222221110',
  '0333332222211110',
  '0333222221111110',
  '0000000000000000',
  '.05555555555550.',
  '.05555556655660.',
  '.05555556655660.',
  '.05555555000050.',
  '.05555555555550.',
  '..000000000000..',
  '..000......000..',
];

const SPINY_B = SPINY_A.slice(0, 15).concat(['.000........000.']);

// The egg tumbles: frame A shows the spikes edge-on, frame B rolls them away.
const EGG_A = [
  '.....0....0.....',
  '..0..00..00..0..',
  '...0000000000...',
  '..044433322210..',
  '.04443333222110.',
  '0444333322221110',
  '0433333222211110',
  '0333332222111110',
  '0333222221111110',
  '.03322222111110.',
  '.03222211111110.',
  '..022211111110..',
  '...0000000000...',
  '..0..00..00..0..',
  '.....0....0.....',
  '................',
];

const EGG_B = [
  '................',
  '....00....00....',
  '...0000000000...',
  '..011122233340..',
  '.01112223333440.',
  '0111222233334440',
  '0111222233333440',
  '0111122223333340',
  '0111112222233340',
  '.01111222233340.',
  '.01111122233340.',
  '..011112223340..',
  '...0000000000...',
  '....00....00....',
  '................',
  '................',
];

const local = (rows, name) => makeSprite(rows, SPINY_PAL, { name });

const WALK = pickAnim(
  EA,
  ['SPINY.walk', 'SPINY_WALK', 'SPINY_ANIM'],
  () => new Anim([local(SPINY_A, 'spiny-a'), local(SPINY_B, 'spiny-b')], 8),
  8
);

const EGG = pickAnim(
  EA,
  ['SPINY.egg', 'SPINY_EGG', 'SPINY_EGG_ANIM'],
  () => new Anim([local(EGG_A, 'spiny-egg-a'), local(EGG_B, 'spiny-egg-b')], 6),
  6
);

export const SPINY_ART = { walk: WALK, egg: EGG };

export default class Spiny extends Entity {
  static type = 'spiny';

  constructor(world, x, y, opts = {}) {
    super(world, x, y, opts);
    this.w = 16;
    this.h = 16;
    this.facing = opts.facing || -1;
    this.speed = opts.speed == null ? walkSpeed() : opts.speed;
    this.isEgg = !!(opts.egg || opts.form === 'egg');
    if (this.isEgg) {
      this.vx = opts.vx == null ? 0 : opts.vx;
      this.vy = opts.vy == null ? 0 : opts.vy;
    }
    this.isWalker = !this.isEgg;
    this.isEnemy = true;
  }

  update() {
    if (frozen(this.world)) return;
    if (this.isEgg) {
      this._eggStep();
      return;
    }
    walkStep(this, { speed: this.speed });
    enemyBump(this);
  }

  // The egg cracks open on the frame it LANDS. LandEnemyInitState
  // (smbdis.asm:12555-12563) clears the enemy state the moment the egg touches
  // down — "note this will also turn spiny's egg into spiny" — with no bounce in
  // between. The bounce this used to take was ours and it bought the player an
  // extra ~40 frames of warning that the original never gave.
  _eggStep() {
    this.applyGravity(enemyGravity(), enemyMaxFall());
    const col = this.moveAndCollide();
    if (col.hitLeft || col.hitRight) this.vx = -this.vx;
    if (!col.hitBottom) return;
    this._hatch();
  }

  _hatch() {
    this.isEgg = false;
    this.isWalker = true;
    this.vx = 0;
    this.vy = 0;
    const p = playerOf(this.world);
    this.facing = p && p.centerX < this.centerX ? -1 : 1;
    sfx(this.world, 'bump');
    fx(this.world, 'enemyPoof', this.centerX, this.centerY);
  }

  draw(ctx, cam) {
    if (this.isEgg && !this.dead) {
      this.drawAnim(ctx, cam, EGG, { flipX: this.vx > 0 });
      return;
    }
    this.drawAnim(ctx, cam, WALK);
  }

  // Spikes all the way over the top: there is nowhere safe to land.
  onStomp() {
    return false;
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

registerEntity(Spiny);
