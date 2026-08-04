import { ARCHIPELAGO, worldIds } from './archipelago.js';

// The match. Island-local in the sense that matters: it holds no pixel
// coordinates at all, only which world, which island, how many lives and how
// many aeroplanes are left. That is the entire authoritative bookkeeping of a
// game, which is why it is small enough to send on join.
//
// PURE AND DETERMINISTIC, deliberately: no clock, no randomness, no I/O, no
// import that reaches the DOM or the engine. Feed two copies the same events in
// the same order and they reach the same verdict, which is the only way a match
// can end on both screens at once.
export const MATCH = {
  // Mario's normal stock. No continues (spec 1).
  LIVES: 3,
  // Per archipelago, replenished when the carrier group sails (spec 3.4).
  SQUADRON: 5,
};

export const WINNER = { NONE: null, PILOT: 'pilot', MARIO: 'mario' };

export class Match {
  constructor(opts = {}) {
    this.seed = (opts.seed >>> 0) || 0x2545f491;
    this.world = opts.world || 1;
    this.island = opts.island || 0; // 0..3 within the world
    this.lives = opts.lives == null ? MATCH.LIVES : opts.lives;
    this.squadron = opts.squadron == null ? MATCH.SQUADRON : opts.squadron;
    this.phase = opts.phase || 'ashore'; // 'ashore' | 'ferry' | 'over'
    this.winner = opts.winner || WINNER.NONE;
    // Mario's stock is spent. A fact rather than a verdict: the verdict is
    // resolve()'s, because a squadron destroyed in the same moment outranks it.
    this.livesGone = !!opts.livesGone;
    this.events = [];
    this.batch = false;
  }

  get over() {
    return this.winner !== WINNER.NONE;
  }

  get islandId() {
    return worldIds(this.world)[this.island];
  }

  get nextIslandId() {
    const ids = worldIds(this.world);
    return this.island + 1 < ids.length ? ids[this.island + 1] : null;
  }

  emit(type, data) {
    this.events.push({ type, ...data });
  }

  drain() {
    const out = this.events;
    this.events = [];
    return out;
  }

  // Apply a batch of events as ONE moment. Everything in the list happened
  // simultaneously; nothing inside it is ordered against anything else inside
  // it, which is what makes the double-loss case below decidable at all.
  //
  // This is also the entry point the network layer wants: one ordered stream of
  // moments in, identical state out on both ends.
  apply(events = []) {
    const nested = this.batch;
    this.batch = true;
    try {
      for (const e of events) this.dispatch(e);
    } finally {
      this.batch = nested;
    }
    if (!nested) this.resolve();
    return this.state();
  }

  dispatch(e) {
    switch (e && e.type) {
      case 'clearLevel': return this.clearLevel();
      case 'arrive': return this.arrive();
      case 'ferrySunk': return this.ferrySunk(e.lives);
      case 'marioDied': return this.marioDied(e.lives);
      case 'outOfLives': return this.outOfLives();
      case 'planeLost': return this.planeLost();
      default:
        // A silently ignored event is a match that disagrees with itself later.
        throw new Error(`match: unknown event "${e && e.type}"`);
    }
  }

  // Who has won, given the facts on the board. Called at the end of a moment,
  // never inside one.
  //
  // THE TIE. Mario's last life and the pilot's last aeroplane can go in the
  // same instant — the pilot's own blast radius is one of the ways he loses a
  // plane (spec 3.4), and that same blast is well placed to kill Mario. Within
  // one moment there is no "first", so the rule is fixed rather than
  // discovered: a destroyed squadron outranks an empty stock, and MARIO WINS
  // THE TIE. A pilot who blows himself out of the sky does not get to take the
  // match with him, and with no aeroplanes left there is nobody to fly against
  // whatever Mario had left. Across separate moments there IS a first, and the
  // first of them ends the match: `over` latches and later events are refused.
  resolve() {
    if (this.over) return this.winner;
    if (this.squadron <= 0) {
      this.winner = WINNER.MARIO;
      this.phase = 'over';
      this.emit('matchOver', { winner: WINNER.MARIO, reason: 'squadron-destroyed' });
    } else if (this.livesGone) {
      this.winner = WINNER.PILOT;
      this.phase = 'over';
      this.emit('matchOver', { winner: WINNER.PILOT, reason: 'no-lives' });
    }
    return this.winner;
  }

  // A terminal condition became true. Inside a batch it waits for the end of
  // the moment; outside one it decides immediately.
  settle() {
    if (this.batch) return this.winner;
    return this.resolve();
  }

  // Mario reached the flagpole or the axe. Returns what happens next:
  // 'ferry' (a crossing to the next island), 'sail' (the group weighs anchor
  // for the next world), 'won' (8-4 is behind him), or 'over'.
  clearLevel() {
    if (this.over) return 'over';
    this.emit('islandCleared', { world: this.world, island: this.islandId });
    if (this.island + 1 < ARCHIPELAGO.ISLANDS_PER_WORLD) {
      this.phase = 'ferry';
      this.emit('ferryBoard', { from: this.islandId, to: this.nextIslandId });
      return 'ferry';
    }
    // A castle has fallen. Past world 8 there is nothing left to sail to,
    // which is Mario winning the whole thing.
    if (this.world >= ARCHIPELAGO.WORLDS) {
      this.winner = WINNER.MARIO;
      this.phase = 'over';
      this.emit('matchOver', { winner: WINNER.MARIO, reason: 'cleared-8-4' });
      return 'won';
    }
    this.world++;
    this.island = 0;
    this.phase = 'ashore';
    // The group sails with a fresh squadron. The pilot is not punished for
    // the last world's losses in the next one.
    this.squadron = MATCH.SQUADRON;
    this.emit('worldCleared', { world: this.world });
    return 'sail';
  }

  // The ferry docked. `clearLevel` already chose the destination; this is the
  // moment he steps ashore on it.
  arrive() {
    if (this.over || this.phase !== 'ferry') return false;
    this.island++;
    this.phase = 'ashore';
    return true;
  }

  // A torpedo got the boat. He pays a life and sails again from the island he
  // left: the crossing is not skipped, and the pilot has to do it twice.
  ferrySunk(livesLeft) {
    if (this.over) return false;
    this.phase = 'ashore';
    this.marioDied(livesLeft);
    this.emit('ferrySunk', { from: this.islandId, to: this.nextIslandId });
    return true;
  }

  // Mario's lives are the ENGINE's count, mirrored here rather than tracked
  // twice — two counters for one fact is how they drift apart. Losing the last
  // one is not the end of the match on its own; the engine says that, through
  // onGameOver, and outOfLives() is where it lands.
  marioDied(livesLeft) {
    if (this.over) return false;
    if (livesLeft != null) this.lives = livesLeft;
    this.emit('marioDeath', { lives: this.lives });
    return true;
  }

  outOfLives() {
    if (this.over) return false;
    this.lives = 0;
    this.livesGone = true;
    this.emit('livesGone', {});
    this.settle();
    return true;
  }

  // The pilot wrote off an aeroplane. Returns true when that was the last one.
  planeLost() {
    if (this.over) return false;
    this.squadron = Math.max(0, this.squadron - 1);
    this.emit('planeLost', { squadron: this.squadron });
    if (this.squadron > 0) return false;
    this.settle();
    return true;
  }

  state() {
    return {
      seed: this.seed,
      world: this.world,
      island: this.island,
      islandId: this.islandId,
      lives: this.lives,
      squadron: this.squadron,
      phase: this.phase,
      winner: this.winner,
    };
  }

  toJSON() {
    return {
      seed: this.seed,
      world: this.world,
      island: this.island,
      lives: this.lives,
      squadron: this.squadron,
      phase: this.phase,
      winner: this.winner,
      livesGone: this.livesGone,
    };
  }

  static fromJSON(json) {
    return new Match(json || {});
  }
}

export default Match;
