// Frenzy spawner — the original's "area frenzy" objects.
//
// SMB's level data does not hand-place the leaping cheep-cheeps of 2-3 or the
// bullet bills of 5-1/8-1. It places a *frenzy object*: an invisible marker
// that, once the screen scrolls onto it, keeps throwing one enemy kind at the
// player until a "stop frenzy" marker turns it off. The game stores exactly one
// active frenzy at a time (`EnemyFrenzyBuffer`, one byte) and paces it with one
// timer (`FrenzyEnemyTimer`).
//
// Everything below is taken from reference/smbdis.asm; each block names the
// routine it came from. Units are converted out of the NES's fixed point:
//   * Enemy_X_Speed is 1/16 px per frame  (MoveObjectHorizontally, ~line 7541:
//     the low nybble feeds the fractional move force, the high nybble is whole
//     pixels).
//   * The gravity constant handed to ImposeGravity is 1/256 px per frame^2
//     (ImposeGravity, ~line 7704: it is added to Enemy_Y_MoveForce, an 8-bit
//     fraction, and carries into Enemy_Y_Speed which is whole px per frame).
//
// Level usage:  { type: 'frenzy', x, y, kind: 'cheep' | 'bullet' | 'stop' }
// `y` is ignored — a frenzy is a column marker, exactly as in the original,
// where the object's row nybble only selects which frenzy it is.

import { Entity, registerEntity } from '../entity.js';
import { SCREEN_W } from '../../core/constants.js';
import { Rng } from '../../core/rng.js';
import { frozen, playerOf, spawnAt, sfx, hardMode } from './index.js';

// InitFlyingCheepCheep, smbdis.asm ~8419.
// FlyCCTimerData ($10 $60 $20 $48): frames between spawns, picked with two
// pseudorandom bits.
const FLY_CC_TIMERS = [0x10, 0x60, 0x20, 0x48];
// FlyCCXPositionData: how far from the player the fish surfaces, in pixels.
const FLY_CC_X_OFFSETS = [
  0x80, 0x30, 0x40, 0x80, 0x30, 0x50, 0x50, 0x70, 0x20, 0x40, 0x80, 0xa0, 0x70, 0x40, 0x90, 0x68,
];
// FlyCCXSpeedData, in 1/16 px per frame.
const FLY_CC_X_SPEEDS = [
  0x0e, 0x05, 0x06, 0x0e, 0x1c, 0x20, 0x10, 0x0c, 0x1e, 0x22, 0x18, 0x14,
].map((v) => v / 16);
// `lda #$fb / sta Enemy_Y_Speed` — five pixels a frame, straight up.
const FLY_CC_VY = -5;
// MoveFlyingCheepCheep (~9922) runs `ldy #$0d / lda #$05 / jsr SetXMoveAmt`:
// downward force 13/256 px per frame^2, terminal velocity 5 px per frame. The
// arc is therefore ~98 frames up, ~246 px tall — clear over the 2-3 bridges.
const FLY_CC_GRAVITY = 0x0d / 256;
const FLY_CC_MAX_FALL = 5;
// `lda #$f8 / sta Enemy_Y_Position` — spawned 248 px down, below the screen.
const FLY_CC_SPAWN_Y = 0xf8;
// MaxCC: `cpx $00 / bcs ChpChpEx` with $00 = 3 caps the fish to the first three
// enemy slots. InitFlyingCheepCheep (asm:8425-8433) does `ldy #$03 / lda
// SecondaryHardMode / beq MaxCC / iny` first, so hard mode allows a fourth fish
// on screen at once.
const FLY_CC_MAX = 3;
const FLY_CC_MAX_HARD = 4;

// BulletBillCheepCheep, smbdis.asm ~8683.
// Enemy17YPosData: the eight heights a $17 frenzy uses, cycled through a bit
// filter so the same row never repeats until all eight have been used.
const E17_Y = [0x40, 0x30, 0x90, 0x50, 0x20, 0x60, 0xa0, 0x70];
// `lda #$20 / sta FrenzyEnemyTimer` — 32 frames, both variants.
const E17_TIMER = 0x20;
// `cpx #$03 / bcs ExF17` caps the swimming variant at three.
const SWIM_CC_MAX = 3;
// DoBulletBills walks every slot and leaves if a frenzy bullet bill is already
// out, so there is only ever one in the air.
const BULLET_MAX = 1;
// SwimCCXMoveData ($40 grey, $80 red) is subtracted from Enemy_X_MoveForce each
// frame: 0.25 and 0.5 px per frame, leftwards.
const SWIM_CC_SPEED = { grey: 0x40 / 256, red: 0x80 / 256 };
// PutAtRightExtent: `lda ScreenRight_X_Pos / adc #$20`.
const RIGHT_EXTENT = 0x20;

const KINDS = { cheep: 'cheep', bullet: 'bullet', stop: 'stop' };

export default class Frenzy extends Entity {
  static type = 'frenzy';

  constructor(world, x, y, opts = {}) {
    super(world, x, y, opts);
    this.w = 16;
    this.h = 16;
    this.kind = KINDS[opts.kind] || 'cheep';
    this.isFrenzy = true;

    // A marker, not a thing: no art, no hitbox, no tiles.
    this.visible = false;
    this.tangible = false;
    this.noclip = true;
    this.gravity = 0;
    this.despawnOffscreen = true;

    this.running = false;
    this.timer = 0;
    this.brood = [];
    this.yFilter = 0;
    // Deterministic stand-in for the NES LSFR, seeded off the marker's column
    // so a replay or a screenshot capture reproduces the same stream.
    this.rng = new Rng(0x9e3779b1 ^ ((x | 0) * 2654435761) ^ (this.id * 40503));
  }

  // Scrolling onto the marker is what arms it, the way the area parser only
  // reaches a frenzy object when the screen edge reaches its column.
  onActivate() {
    if (this.kind === 'stop') {
      this._stopAll();
      this.remove();
      return;
    }
    // One frenzy at a time: a new one displaces whatever was running.
    this._stopAll();
    this.running = true;
    // Once armed the frenzy outlives its own column — the original keeps it in
    // EnemyFrenzyBuffer until a stop object clears it.
    this.despawnOffscreen = false;
    this.persistent = true;
    this.timer = 0;
  }

  _stopAll() {
    const list = this.world && this.world.entities;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e && e !== this && e.isFrenzy && e.running) e.stop();
    }
  }

  // EndFrenzy (~8852): empty the buffer and retire the object. Enemies already
  // on the field are left alone to fly out on their own.
  stop() {
    this.running = false;
    this.brood.length = 0;
    this.remove();
  }

  _liveCount() {
    let n = 0;
    let w = 0;
    for (let i = 0; i < this.brood.length; i++) {
      const e = this.brood[i];
      if (!e || e.removed || e.dead) continue;
      this.brood[w++] = e;
      n++;
    }
    this.brood.length = w;
    return n;
  }

  update() {
    if (!this.running) return;
    if (frozen(this.world)) return;
    const world = this.world;
    if (!world || world.state !== 'playing') return;
    const player = playerOf(world);
    if (!player || player.dead) return;

    this._liveCount();
    // Every frenzy routine opens with `lda FrenzyEnemyTimer / bne <leave>`.
    if (this.timer > 0) {
      this.timer--;
      return;
    }
    if (this.kind === 'cheep') this._flyingCheepCheep(player);
    else this._bulletBillCheepCheep(player);
  }

  // InitFlyingCheepCheep, smbdis.asm 8419-8499.
  _flyingCheepCheep(player) {
    const rng = this.rng;

    // `and #%00000011` on the second LSFR part picks the reload.
    this.timer = FLY_CC_TIMERS[rng.int(0, 3)];

    // The slot cap is tested *after* the timer is reloaded, so a full screen
    // costs you a fish rather than shifting the cadence.
    if (this._liveCount() >= (hardMode(this.world) ? FLY_CC_MAX_HARD : FLY_CC_MAX)) return;

    const seedLow = rng.int(0, 3); // `lda PseudoRandomBitReg,x / and #%11` -> $00 and $01

    // GSeed: how hard the player is running biases the offset table.
    // Player_X_Speed is 1/16 px per frame and the compare is unsigned, so any
    // leftward motion also lands in the fast bucket.
    const speedByte = Math.round((player.vx || 0) * 16) & 0xff;
    let adder = 0;
    if (speedByte !== 0) adder = speedByte >= 0x19 ? 8 : 4;

    // $00 is the direction seed; a second LSFR read can replace it wholesale.
    let dirSeed = adder + seedLow;
    if (rng.int(0, 3) !== 0) dirSeed = rng.int(0, 15);

    // Y (the table offset) is adder + $01 while the player is moving; when the
    // player is standing still the routine overwrites it with $00.
    let idx = adder + seedLow;
    let vx = FLY_CC_X_SPEEDS[idx % FLY_CC_X_SPEEDS.length];
    let dir = 1; // `lda #$01 / sta Enemy_MovingDir` — rightwards by default.
    if (speedByte === 0) {
      idx = dirSeed;
      if (idx & 0b10) {
        vx = -vx; // two's complement of the speed: swim the other way
        dir = -1;
      }
    }

    // D2XPos1 / D2XPos2: d1 of the offset decides which side of Mario it
    // surfaces on.
    const off = FLY_CC_X_OFFSETS[idx & 0x0f];
    const x = (idx & 0b10) === 0 ? player.x - off : player.x + off;

    const cam = this.world.cam;
    const y = (cam ? cam.y || 0 : 0) + FLY_CC_SPAWN_Y;

    const e = spawnAt(this.world, 'cheep', x, y, {
      variant: 'red',
      leap: true,
      dir,
      vx,
      vy: FLY_CC_VY,
      gravity: FLY_CC_GRAVITY,
      maxFall: FLY_CC_MAX_FALL,
      silent: true,
      active: true,
      // OffscreenBoundsCheck exempts FlyingCheepCheep — see cheep.js. Without
      // this the fish that surface behind Mario die on their first frame and
      // the barrage collapses to one fish at a time.
      offscreenCull: false,
    });
    if (e) this.brood.push(e);
  }

  // BulletBillCheepCheep, smbdis.asm 8683-8750. Water levels get swimming
  // cheep-cheeps; everywhere else the same object fires bullet bills.
  _bulletBillCheepCheep(player) {
    const world = this.world;
    const lvl = world.level || null;
    const water = !!lvl && (lvl.theme === 'water' || lvl.underwater === true);

    const cap = water ? SWIM_CC_MAX : BULLET_MAX;
    if (this._liveCount() >= cap) {
      // DoBulletBills leaves without touching the timer when one is still out,
      // so it retries on the very next frame.
      if (!water) return;
      this.timer = E17_TIMER;
      return;
    }

    const cam = world.cam;
    const camX = cam ? cam.x || 0 : 0;
    const camY = cam ? cam.y || 0 : 0;
    const x = camX + SCREEN_W + RIGHT_EXTENT;
    const y = camY + this._nextY();
    this.timer = E17_TIMER;

    let e;
    if (water) {
      // Get17ID: world 2 keeps the offset, every other world bumps it — the two
      // worlds get opposite grey/red bias out of the same coin flip.
      let sel = this.rng.float() >= 0xaa / 256 ? 1 : 0;
      if (!this._isWorld2(lvl)) sel += 1;
      const variant = (sel & 1) === 0 ? 'grey' : 'red';
      e = spawnAt(world, 'cheep', x, y, {
        variant,
        leap: false,
        swim: true,
        facing: -1,
        speed: SWIM_CC_SPEED[variant],
        active: true,
      });
    } else {
      // FireBulletBill queues Sfx_Blast before creating the object.
      sfx(world, 'firework');
      e = spawnAt(world, 'bulletbill', x, y, { dir: -1, active: true, silent: true });
    }
    if (e) this.brood.push(e);
  }

  _isWorld2(lvl) {
    const id = lvl && lvl.id;
    return typeof id === 'string' && id.charAt(0) === '2';
  }

  // GetRBit / ChkRBit / AddFBit: pick a random one of the eight rows, walk
  // forward to the first one not yet used, and reset the filter once all eight
  // have been handed out.
  _nextY() {
    if (this.yFilter === 0xff) this.yFilter = 0;
    let i = this.rng.int(0, 7);
    for (let n = 0; n < 8; n++) {
      if ((this.yFilter & (1 << i)) === 0) break;
      i = (i + 1) & 7;
    }
    this.yFilter |= 1 << i;
    return E17_Y[i];
  }

  draw() {}
}

registerEntity(Frenzy);
