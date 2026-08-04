import { TILE } from '../core/constants.js';
import { Ferry } from './ferry.js';
import { deckKeys, onDeck, registerFerryLevel, FERRY_LEVEL_ID } from './ferry-level.js';

// The glue between the pure crossing and Mario's engine. Task 7's match state
// machine drives it; window.__FERRY drives it in tests and by hand.
//
// `host` is `window.__GAME`: it needs `loadLevel(id)` and `world`. Nothing
// here reaches further into the engine than that.
//
// This class straddles two coordinate spaces on purpose and is the only place
// they meet: `this.ferry` is WORLD pixels (the ocean, at SEA_Y), while the
// player positions it feeds to onDeck() are island-local level pixels. onDeck
// asserts that, so a swap fails loudly instead of reading as "he drowned".
export class FerryRide {
  constructor(host = null) {
    this.host = host;
    this.ferry = null;
    this.to = null;
    this.onArrive = null;
    this.onLost = null;
    registerFerryLevel();
  }

  // The host arrives later than this object does: window.__GAME is not
  // reliably assigned at module-body time, because src/game/world.js has a
  // top-level await. Same reason mario-main.js polls for it.
  attach(host) {
    this.host = host;
    return this;
  }

  get phase() {
    return this.ferry ? this.ferry.phase : 'ashore';
  }

  // Start a crossing. `to` is the island id Mario is heading for; it is carried
  // rather than acted on, so the caller decides what "arrived" means.
  async board(opts = {}) {
    this.ferry = new Ferry({ fromX: opts.fromX, toX: opts.toX });
    this.to = opts.to || null;
    await this.host.loadLevel(FERRY_LEVEL_ID);
    return this.ferry;
  }

  // One fixed step, called from the same seam the telegraph uses.
  update(world) {
    const f = this.ferry;
    if (!f || f.phase === 'arrived' || f.phase === 'sunk') return;
    f.step();

    // Jumped the gunwale. The sea on this level is water tiles, so he would
    // otherwise swim beside the boat until the clock ran out; drowning him is
    // both quicker and the only outcome that is not a softlock.
    const p = world && world.player;
    if (p && !p.dead && f.phase !== 'boarding' && !onDeck(p.x + (p.w || TILE) / 2, p.y)) {
      return this.drown(world, 'overboard');
    }

    if (f.phase === 'arrived' && this.onArrive) this.onArrive(this.to);
  }

  // A torpedo found her. The deck goes, then Mario goes with it: the crater
  // is what the player SEES, and the death is what the match records.
  sink(world) {
    const f = this.ferry;
    if (!f || !f.sink()) return false;
    if (world && typeof world.destroyTiles === 'function') world.destroyTiles(deckKeys());
    this.drown(world, 'sunk');
    return true;
  }

  // Ends the crossing as well as the life. Without moving the phase, update()
  // would re-run this every tick for as long as the death animation lasts —
  // p.dead guards the second die() but nothing would guard onLost.
  drown(world, cause) {
    if (this.ferry) this.ferry.phase = 'sunk';
    const p = world && world.player;
    if (p && !p.dead && typeof p.die === 'function') p.die(cause);
    if (this.onLost) this.onLost(cause);
    return true;
  }

  clear() {
    this.ferry = null;
    this.to = null;
  }
}

export default FerryRide;
