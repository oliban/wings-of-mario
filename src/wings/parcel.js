// THE PARCEL.
//
// The pilot's craters are permanent, and the design says so on purpose: a hole
// too wide to jump is a legitimate way for him to win, and nothing here bridges
// it, regenerates it or rescues Mario out of it. What this does is hand Mario
// the one thing that gives him a CHANCE at his own rescue — five coins and a
// toolbelt — the moment he walks up to a chasm that is only there because he
// was bombed. Whether he then builds his way across is between him and his
// aim.
//
// WHY THAT IS THE PAYLOAD, and why it is exactly five coins: the toolbelt is
// not our invention. It is the game's own Harry-mode power-up
// (src/game/entities/toolbelt.js), and what it grants is SELECT throwing a
// BRICK BOMB (src/game/entities/brickbomb.js) — a grenade that lays a row of
// five bricks where it goes off, in mid-air over a pit if the fuse runs out
// there. That is a bridge, built by the man in the hole, out of the game's own
// mechanic. Each throw costs BRICKBOMB_COST coins out of the Harry-mode wallet,
// so five coins is five throws.
//
// THE DECISION — is that chasm unjumpable, and is it unjumpable because of the
// bombing — is not here. It is in src/wings/stranded.js, which is pure and
// exhaustively unit-tested; this file is the half that knows what a World is:
// it reads the two tile maps, asks, and pays out. Nothing under src/game/ is
// edited, and nothing here is wired into the engine except through the fixed
// timestep hook src/wings/mario-main.js already owns.
//
// OWNERSHIP (spec 7.3): this runs on MARIO'S client and only there. It is his
// level, his position and his physics, and no other client could compute it.
// The pilot needs no wire event to learn about it — the costume Mario is
// wearing is already on his 20Hz snapshot as `power` (src/net/reach.js), so the
// pilot's screen puts him in the work clothes for free, from the one client
// entitled to say so.

import { TILE } from '../core/constants.js';
import { strandedBy, GapLedger, PARCEL_COINS } from './stranded.js';

// WHY THE CHAR TABLE IS INJECTED rather than imported. Reading the pristine
// level means asking whether a legend character is something to stand on, and
// the answer lives in src/data/tiles.js — which builds every sprite in the game
// at module load and therefore needs a canvas. Importing it here would put this
// whole file out of reach of the Tier 1 tests, which are plain Node. So the
// caller passes it in (src/wings/mario-main.js does, from tileForChar) and the
// tests pass their own.

// How often the two maps are scanned, in engine ticks. The scan is cheap — a
// dozen columns — but it is nothing like free, and a chasm ten tiles away does
// not become a different chasm within a sixth of a second. Counted in ticks off
// world.tick, never in milliseconds: everything that decides gameplay in this
// project runs on the fixed 60.0988Hz step.
export const CHECK_INTERVAL_TICKS = 10;

// The world's own solidity, read live, so a tile a bomb cleared this frame is a
// hole this frame. `'down'` counts one-way platforms, which is exactly the
// question a pair of feet asks.
export function currentGrid(world) {
  return {
    w: world.w,
    h: world.h,
    solid: (tx, ty) => world.solidAt(tx * TILE + TILE / 2, ty * TILE + TILE / 2, 'down'),
  };
}

// The map the level SHIPPED with. world.rootLevel is the level object itself
// and level objects never mutate — World copies their rows into its own typed
// array on load (src/data/levels/index.js) — so this is the pristine article
// however much of it has since been blown away. It is the whole reason 1-1's
// own holes cannot pay out a parcel.
export function originalGrid(level, solidChar) {
  const rows = (level && level.tiles) || null;
  if (!rows || !rows.length || typeof solidChar !== 'function') return null;
  const w = (level.width | 0) || rows[0].length;
  const h = (level.height | 0) || rows.length;
  return {
    w,
    h,
    solid: (tx, ty) => {
      const row = rows[ty];
      if (row == null) return false;
      return !!solidChar(row[tx]);
    },
  };
}

export class Parcel {
  constructor(opts = {}) {
    this.ledger = new GapLedger();
    this.coins = opts.coins == null ? PARCEL_COINS : opts.coins;
    // ch -> can a pair of feet rest on it. See the note at the top of the file
    // for why this arrives from outside.
    this.solidChar = opts.solidChar || null;
    // Presentation, wired up by whoever wants to say something about it. The
    // mechanic below does not know a screen exists.
    this.onParcel = null;
    // The last thing decided, for the debug panel and the browser test to read.
    this.last = null;
    this.given = 0;
    // The tick we last saw. World.loadLevel sets world.tick back to 0, so a
    // reading that went BACKWARDS is a level having been rebuilt under us —
    // which is the only reliable in-band signal a hook on the timestep gets,
    // and it costs no wrap of an engine method to read.
    this._lastTick = null;
  }

  // One fixed timestep. Called from the hook list in src/wings/mario-main.js,
  // which is the only 60.0988Hz clock that page has.
  step(world) {
    if (!world || !world.level || !world.player) return null;

    // A level rebuilt is every hole back where the tile map says it is, and a
    // Mario who has lost the belt he was given. The chasm the retained craters
    // put back is worth a second parcel: he is walking up to it again with
    // nothing, which is the situation this exists for. Checked before the
    // interval so a load can never fall between two scans.
    const tick = world.tick | 0;
    if (this._lastTick != null && tick < this._lastTick) this.ledger.clear();
    this._lastTick = tick;

    if (tick % CHECK_INTERVAL_TICKS !== 0) return null;

    // A sub-area is a pipe room, a coin room or a warp zone: a different tile
    // map, no bombs have ever fallen on it, and world.rootLevel is not its
    // original. Nothing to decide down there. Same signal src/net/reach.js
    // uses, for the same reason.
    if (world.areaId) return null;
    // 'playing' is what World.loadLevel leaves behind; 'levelend', 'gameover'
    // and 'complete' are all places where handing him tools means nothing.
    if (world.state !== 'playing') return null;

    const p = world.player;
    // Only a man standing on the near lip is approaching anything. Mid-jump or
    // falling he is already committed; 'dying', 'pipe' and the grow animation
    // are all states the engine does not let him walk in.
    if (!p.grounded || p.dead === true || p.state !== 'normal') return null;

    const current = currentGrid(world);
    const original = originalGrid(world.rootLevel, this.solidChar);
    if (!original) return null;

    const tx = Math.floor((p.x + (p.w || TILE) / 2) / TILE);
    // The row he is standing ON: one pixel below his feet, which is the tile
    // the engine's own ground check found.
    const ty = Math.floor((p.y + (p.h || TILE) + 1) / TILE);

    const out = strandedBy({ current, original, tx, ty });
    this.last = out;
    if (!out.parcel) return null;

    // One parcel per chasm. A later bomb that widens the same hole is the same
    // hole; see GapLedger.
    const place = `${(world.level && world.level.id) || '?'}`;
    if (this.ledger.paid(place, out.gap.start, out.gap.land)) return null;
    this.ledger.record(place, out.gap.start, out.gap.land);

    this.deliver(world, out.gap);
    return out;
  }

  // The drop itself. Deliberately not an item entity lying on the ground: the
  // parcel is a rescue, and a rescue he can walk past, or that a second bomb
  // can drop into the very hole it was sent for, is not one. It arrives.
  deliver(world, gap) {
    const p = world.player;

    // The coin counter has to be a WALLET before coins are worth anything: it
    // is world.harryMode that stops the hundredth coin becoming a 1UP and
    // resetting the count (World.addCoin), that shows the three-digit counter
    // in the HUD, and that refunds a brick bomb which found no room. The
    // toolbelt has no meaning without it. Nothing else about Harry mode is
    // retroactive — the toolbelt blocks it seeds are chosen at load, long past
    // — so this turns on the wallet and only the wallet.
    world.harryMode = true;
    if (typeof world.addCoin === 'function') world.addCoin(this.coins);
    else world.coins = (world.coins | 0) + this.coins;

    if (p && typeof p.powerUp === 'function') p.powerUp('toolbelt');
    if (typeof world.sfx === 'function') world.sfx('coin');

    // A word over his head, through the engine's own score popup so it lands in
    // the game's typeface and disappears on the game's clock.
    if (typeof world.spawn === 'function' && p) {
      world.spawn('scorepop', p.x, p.y - TILE, { text: 'PARCEL' });
    }

    this.given++;
    if (this.onParcel) this.onParcel({ gap, coins: this.coins });
  }

  // A level reload puts every hole back where the tile map says it is, so the
  // debts against the old one mean nothing. mario-main.js calls this from the
  // same place the rest of the wings layer notices a load.
  forget(world) {
    const id = world && world.level && world.level.id;
    if (id) this.ledger.forget(`${id}`);
    else this.ledger.clear();
  }
}

export default Parcel;
