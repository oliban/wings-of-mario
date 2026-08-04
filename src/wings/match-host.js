import { Match } from './match.js';
import { layoutArchipelago } from './archipelago.js';

// Mario's side of the match, bolted onto the engine through callbacks World
// already owns — it stores onLevelComplete, onLifeLost and onGameOver as
// instance properties (src/game/world.js:635-637) and calls whatever is in them
// (world.js:2432, 2435, 2565), so taking them over needs NO ENGINE EDIT.
//
// It REPLACES world.onLevelComplete rather than chaining it, and that is the
// one place in this plan where taking something over is the right call: the
// upstream handler advances straight to nextLevel('1-1') === '1-2' with a
// tally and an intro card, which is precisely the progression this design
// replaces with a ferry. onLifeLost and onGameOver are CHAINED, because their
// upstream behaviour — respawn, and the game-over card — is still what we
// want; the match only wants to know.
//
// Note the engine's asymmetry, which this relies on: on the death that spends
// the last life, world.js fires onGameOver and RETURNS — onLifeLost does not
// run. So `outOfLives()` and the final `marioDied()` never collide.
//
// This file imports nothing from the engine and touches no DOM, so a server can
// run the same class over the same events and reach the same verdict.
export class MatchHost {
  constructor(host = null, ride = null, opts = {}) {
    this.host = host; // window.__GAME, supplied by attach() once it exists
    this.ride = ride; // FerryRide
    this.match = new Match(opts);
    this.world = null;
    this.prev = {};
  }

  attach(host) {
    this.host = host;
    return this;
  }

  // Where island `index` of the current world sits in world pixels, so a
  // crossing runs between two real places rather than two made-up ones. The
  // layout is the same pure function the pilot uses, from the same seed, so
  // both ends of the wire agree without sending it.
  islandX(index) {
    const slots = layoutArchipelago(this.match.world, this.match.seed);
    const s = slots[Math.max(0, Math.min(slots.length - 1, index))];
    return s.x + s.width / 2;
  }

  install(world) {
    if (!world || this.world === world) return false;
    this.world = world;
    this.prev = {
      levelComplete: world.onLevelComplete,
      lifeLost: world.onLifeLost,
      gameOver: world.onGameOver,
    };
    world.onLevelComplete = (w) => this.levelComplete(w);
    world.onLifeLost = (w) => {
      this.match.marioDied(w ? w.lives : null);
      return this.prev.lifeLost ? this.prev.lifeLost(w) : false;
    };
    world.onGameOver = (w) => {
      this.match.outOfLives();
      return this.prev.gameOver ? this.prev.gameOver(w) : undefined;
    };
    if (this.ride) {
      this.ride.onArrive = () => this.ferryArrived();
      this.ride.onLost = (cause) => this.ferryLost(cause);
    }
    return true;
  }

  levelComplete() {
    const next = this.match.clearLevel();
    if (next === 'ferry') {
      if (this.ride) {
        this.ride.board({
          fromX: this.islandX(this.match.island),
          toX: this.islandX(this.match.island + 1),
          to: this.match.nextIslandId,
        });
      }
      return true;
    }
    if (next === 'sail') {
      if (this.host) this.host.loadLevel(this.match.islandId);
      return true;
    }
    // 'won' or 'over': the match is finished and nothing more loads.
    return true;
  }

  ferryArrived() {
    if (!this.match.arrive()) return false;
    if (this.ride) this.ride.clear();
    if (this.host) this.host.loadLevel(this.match.islandId);
    return true;
  }

  // The boat went down, or he jumped off it. The engine is already killing
  // him — FerryRide called player.die() — so the life is deducted by the
  // engine's own onLifeLost, which the chain above mirrors. All that is left
  // is to put him back on the island he sailed from.
  ferryLost() {
    if (this.ride) this.ride.clear();
    if (this.match.over) return false;
    this.match.phase = 'ashore';
    this.match.emit('ferrySunk', { from: this.match.islandId });
    return true;
  }

  state() {
    return this.match.state();
  }
}

export default MatchHost;
