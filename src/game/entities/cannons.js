// Bullet bill cannons — ProcessCannons / FireCannon, smbdis.asm 6763-6817.
//
// The cannons themselves are TILES, not objects: the level draws metatiles $64
// (barrel), $65 (middle) and $66 (base) and, in the same breath, files the
// cannon's coordinates into a six-entry table (BulletBillCannon, asm:4095-4121).
// That table is a RING — `inx / cpx #$06 / bcc StrCOffset / ldx #$00` — so a
// level with ten cannons only ever has the six most recently scrolled-onto ones
// loaded, and a cannon far behind the player quietly drops out of the game.
//
// ProcessCannons then runs once per frame over the first three enemy slots and,
// for each FREE one, rolls the LSFR for a table index. That is the whole of the
// pacing: there is no per-cannon countdown running in the background. A cannon's
// timer only moves on a frame where the dice picked it, which is why cannons in
// SMB fire in ragged bursts rather than on a metronome.
//
// Everything below names the routine it came from. Units are already NES units:
// the screen is 256x240 and a tile is 16px here as it is there.

import { TILE, SCREEN_W } from '../../core/constants.js';
import { Rng } from '../../core/rng.js';
import { frozen, playersOf, spawnAt } from './index.js';

// Cannon_PageLoc/X/Y/Timer are six bytes apiece (asm:411-414).
const TABLE_SIZE = 6;
// `ldx #$02 / ThreeSChk ... dex / bpl ThreeSChk` — slots 2, 1, 0 only, so three
// cannon bullet bills can be in the air at once and no more.
const MAX_BILLS = 3;
// CannonBitmasks (asm:6760): %00001111 normally, %00000111 in secondary hard
// mode. The masked roll must come out below 6 to name a table entry, so a given
// cannon is looked at with probability 1/16 per free slot per frame — but in
// secondary hard mode the narrower mask leaves only 0-7, and six of those eight
// values name a table entry, so a cannon is looked at 6/8 of the time instead of
// 6/16. Twice the fire rate, from the same fourteen-selection timer.
const ROLL_MASK = 0x0f;
const ROLL_MASK_HARD = 0x07;
// `lda #$0e / sta Cannon_Timer,y` — fourteen selections between shots. At three
// free slots that is 14 / (3/16) ~= 75 frames, a shade over a second.
const FIRE_TIMER = 0x0e;
// BulletBillXSpdData ($18 / $e8): 24/16 px per frame, either way.
const BILL_SPEED = 0x18 / 16;
// BulletBillHandler (asm:6844-6848): `lda $00 / adc #$28 / cmp #$50 / bcc
// KillBB`. $00 is the bill's x minus the player's x, so the bill is erased on
// the very frame it is born whenever the player is within forty pixels of the
// muzzle — the cannon will not shoot someone standing on top of it.
const POINT_BLANK = 0x28;
// OffscreenBoundsCheck (asm:11006) erases an enemy 72px outside either screen
// edge, and BulletBillHandler kills a bill whose offscreen bits say it is fully
// gone before it ever moves. Matching BulletBill's own despawn window keeps a
// cannon the player has long left behind from firing rounds nobody can see.
const SCREEN_MARGIN = 48;

export class Cannons {
  constructor(world) {
    this.world = world;
    this.all = [];
    this.table = new Array(TABLE_SIZE).fill(null);
    this.next = 0; // Cannon_Offset
    this.scanned = 0; // how far down `all` the level has been "rendered"
    this.live = [];
    this.rng = new Rng(0x1f123bb5);
  }

  // Called from loadLevel. The area parser files a cannon the moment it renders
  // its column; we cannot hook a renderer that does not exist, so the columns
  // are found once here and handed to the table as the camera reaches them.
  reset(lvl) {
    const w = this.world;
    this.all = [];
    this.table.fill(null);
    this.next = 0;
    this.scanned = 0;
    this.live.length = 0;
    // `lda AreaType / beq ExCannon` — water areas never process cannons.
    this.enabled = w.theme !== 'water';
    // Deterministic stand-in for the LSFR, seeded off the level so a replay or
    // a screenshot capture reproduces the same volley.
    const id = String((lvl && lvl.id) || (w.level && w.level.id) || '');
    let h = 0x9e3779b1;
    for (let i = 0; i < id.length; i++) h = (Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0) || 1;
    this.rng = new Rng(h);
    if (!this.enabled) return;

    // A cannon is the TOP tile of a vertical run of cannon tiles: metatile $64
    // is the barrel and the muzzle sits at the object's own row, which is what
    // GetAreaObjYPosition hands to Cannon_Y_Position.
    for (let tx = 0; tx < w.w; tx++) {
      let above = false;
      for (let ty = 0; ty < w.h; ty++) {
        const rec = w.recByCode[w.map[ty * w.w + tx]];
        const here = !!(rec && rec.cannon);
        if (here && !above) this.all.push({ tx, ty, x: tx * TILE, y: ty * TILE, timer: 0 });
        above = here;
      }
    }
    // `all` is built column by column, which is the order the area parser meets
    // them in; the ring depends on that order being the scroll order.
    this.all.sort((a, b) => a.x - b.x);
    this._register();
  }

  // BulletBillCannon (asm:4110-4121): file the cannon and advance the ring.
  _register() {
    const cam = this.world.cam;
    const edge = (cam ? cam.x : 0) + SCREEN_W + TILE * 2;
    while (this.scanned < this.all.length && this.all[this.scanned].x <= edge) {
      const c = this.all[this.scanned++];
      c.timer = 0;
      this.table[this.next] = c;
      this.next = (this.next + 1) % TABLE_SIZE;
    }
  }

  _liveCount() {
    let n = 0;
    let w = 0;
    for (let i = 0; i < this.live.length; i++) {
      const e = this.live[i];
      if (!e || e.removed || e.dead) continue;
      this.live[w++] = e;
      n++;
    }
    this.live.length = w;
    return n;
  }

  // ProcessCannons, once per frame.
  update() {
    if (!this.enabled || !this.all.length) return;
    const world = this.world;
    if (!world || world.state !== 'playing') {
      // FlagpoleCollision (asm:12177) runs `lda #BulletBill_CannonVar / jsr
      // KillEnemies`: touching the pole clears the sky of cannon fire, so the
      // walk to the castle is never ended by a shot from behind.
      for (const e of this.live) if (e && !e.removed) e.remove();
      this.live.length = 0;
      return;
    }
    // `lda TimerControl / bne Chk_BB` inside FireCannon: a cannon still counts
    // its timer down while the engine is halted, it just cannot fire.
    const halted = frozen(world);

    this._register();

    const free = MAX_BILLS - this._liveCount();
    for (let slot = 0; slot < free; slot++) {
      // `lda PseudoRandomBitReg+1,x / and CannonBitmasks,y / cmp #$06 / bcs`.
      const roll = this.rng.int(0, 255) & (this.world && this.world.hardMode ? ROLL_MASK_HARD : ROLL_MASK);
      if (roll >= TABLE_SIZE) continue;
      const c = this.table[roll];
      // `lda Cannon_PageLoc,y / beq Chk_BB` — an entry never filled in is page
      // zero and is skipped.
      if (!c) continue;
      if (c.timer > 0) {
        c.timer--;
        continue;
      }
      if (halted) continue;
      // FireCannon resets the timer before anything else, so a cannon that
      // refuses the shot below still waits its full fourteen selections rather
      // than emptying itself into the player's back the frame he steps clear.
      c.timer = FIRE_TIMER;
      this._fire(c);
    }
  }

  _fire(c) {
    const world = this.world;
    const cam = world.cam;
    const camX = cam ? cam.x : 0;
    // The bill's first update kills it outright if it is already fully
    // offscreen; refusing here means no muzzle blast for a shot nobody sees.
    if (c.x + TILE < camX - SCREEN_MARGIN || c.x > camX + SCREEN_W + SCREEN_MARGIN) return;

    const muzzle = c.x + TILE * 0.5;
    let target = null;
    let best = Infinity;
    for (const p of playersOf(world)) {
      if (!p || p.dead || p.out || p.state === 'dying') continue;
      // PlayerEnemyDiff measures from coordinate to coordinate, both of which
      // are sprite left edges; centres are the same measurement here.
      const d = Math.abs(p.x + p.w * 0.5 - muzzle);
      // KillBB: inside forty pixels this shot is stillborn. With two brothers
      // on screen either one standing on the muzzle is enough to smother it,
      // which is the same courtesy single-player gets.
      if (d < POINT_BLANK) return;
      if (d < best) {
        best = d;
        target = p;
      }
    }
    if (!target) return;

    // `ldy #$01 / jsr PlayerEnemyDiff / bmi SetupBB / iny` — a bill born to the
    // left of the player flies right, otherwise left. It never turns again.
    const dir = muzzle < target.x + target.w * 0.5 ? 1 : -1;
    const e = spawnAt(world, 'bulletbill', c.x, c.y, {
      dir,
      speed: BILL_SPEED,
      active: true,
      cannon: true,
    });
    if (e) {
      // `lda #$01 / sta Enemy_Y_HighPos,x` and the -8 nudge put the bill's
      // 24px sprite over the muzzle row; ours is 16px, so the barrel tile is
      // already the right box.
      e.y = c.y;
      this.live.push(e);
    }
    return e;
  }
}

export default Cannons;
