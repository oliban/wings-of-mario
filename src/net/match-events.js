import { EVENT_OWNER } from './protocol.js';

// The match, as it crosses the wire. Everything in this file is PURE — no DOM,
// no engine, no clock, no randomness — for one reason: both clients run it, and
// a match that ends on one screen and not the other is unfixable after the
// fact. Pure means it can be tested at tier 1, in plain Node, exhaustively.
//
// src/net/mario-side.js and src/net/pilot-side.js are the wiring. The decisions
// are here, once, so there is exactly one thing to be right about.
//
// OWNERSHIP (spec 7.3) is the rule that governs the whole file:
//
//   * Mario's client decides what happened to Mario and announces it.
//   * The pilot's client decides what happened to the aeroplane and announces
//     that.
//   * Neither ever decides anything about the other; each mirrors what it is
//     told rather than recomputing it.

export const STATUS = {
  PLAYING: 'playing',
  MARIO: 'mario-wins',
  PILOT: 'pilot-wins',
};

// May `side` originate `type`? The server enforces this too and refuses what it
// must, but a client that never makes the claim is better than one that makes
// it and is told off: the refusal costs a round trip and puts a warning in the
// server log for something that was never legal.
//
// Own property only, so 'constructor' and 'toString' are not event types.
export function mayEmitFrom(side, type) {
  if (!Object.prototype.hasOwnProperty.call(EVENT_OWNER, type)) return false;
  return EVENT_OWNER[type] === side;
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

// WHY THIS IS A SET OF FLAGS AND NOT A STATE MACHINE.
//
// The two clients cannot be made to agree on an ORDER. Mario's client hears its
// own death instantly and the pilot's crash a network hop later; the pilot's
// client hears exactly the reverse. Any rule of the form "the first terminal
// fact wins" therefore ends the match differently on the two screens whenever
// the two facts land close together — and the pilot's own blast radius is one
// of the ways he loses a plane (spec 3.4), so "close together" is not a corner
// case, it is the dramatic ending the design is aiming at.
//
// So the verdict is a pure function of the SET of facts, with a fixed
// precedence rather than a discovered one, and the facts only ever go from
// false to true. That makes it confluent: same set, same verdict, any order,
// any number of repeats. src/wings/match.js reaches the same precedence for the
// same reason ("a destroyed squadron outranks an empty stock, and MARIO WINS
// THE TIE") — this is that rule made order-independent for the wire.
export class MatchVerdict {
  constructor() {
    this.livesGone = false;
    this.squadronGone = false;
    this.worldCleared = false;
  }

  noteLivesGone() {
    this.livesGone = true;
    return this.status;
  }

  noteSquadronGone() {
    this.squadronGone = true;
    return this.status;
  }

  noteWorldCleared() {
    this.worldCleared = true;
    return this.status;
  }

  get status() {
    if (this.squadronGone || this.worldCleared) return STATUS.MARIO;
    if (this.livesGone) return STATUS.PILOT;
    return STATUS.PLAYING;
  }

  get over() {
    return this.status !== STATUS.PLAYING;
  }

  winner() {
    return this.over ? this.status.replace('-wins', '') : null;
  }

  facts() {
    return {
      livesGone: this.livesGone,
      squadronGone: this.squadronGone,
      worldCleared: this.worldCleared,
    };
  }
}

// The one reducer, run by BOTH clients over BOTH their own events and the
// peer's. That is the whole convergence argument: the reliable-event layer
// guarantees each side eventually sees the same SET of events, and this
// function makes the verdict a function of the set alone.
//
// Note what it does NOT do: recompute anything. `d.lives` is Mario's client's
// number and `d.squadron` is the pilot's, and each is read exactly as sent.
export function applyWire(verdict, type, d = {}) {
  if (!verdict) return STATUS.PLAYING;
  if (type === 'marioDeath') {
    if (Number(d.lives) <= 0) verdict.noteLivesGone();
  } else if (type === 'planeLost') {
    if (Number(d.squadron) <= 0) verdict.noteSquadronGone();
  } else if (type === 'worldCleared') {
    if (d.final) verdict.noteWorldCleared();
  }
  return verdict.status;
}

// ---------------------------------------------------------------------------
// Mario's side: engine state in, wire events out
// ---------------------------------------------------------------------------

const worldOf = (id) => {
  const n = Number(String(id).split('-')[0]);
  return Number.isFinite(n) ? n : null;
};

// An island of the archipelago, as opposed to the other things the engine will
// happily call a level: a title screen, a coin room, one of Harry's painted
// sequences. Only an archipelago island can be cleared, so only one of these is
// allowed to move the match on.
const isIslandId = (id) => typeof id === 'string' && /^\d+-\d+$/.test(id);

// Edge-triggered off state the engine already maintains. NOTHING HERE IS
// SIMULATED to produce an event: every number sent is one the engine computed,
// which is what stops Mario's client and the pilot's client keeping two
// counters for one fact and watching them drift.
export class MarioEvents {
  constructor() {
    this._deathSent = false;
    this._lastLevel = null;
    this._seen = false;
  }

  // `s` is a flat reading of the engine, taken once per frame:
  //   { island, lives, dying, gameOver, x, y }
  // Returns the wire events this reading produced, in order.
  step(s = {}) {
    const out = [];
    const island = isIslandId(s.island) ? s.island : null;
    const dying = !!s.dying;
    const lives = s.lives == null ? null : Number(s.lives);

    // A death. `state === 'dying'` latches for the whole death animation, so
    // the send is guarded rather than levelled: one death, one event.
    if (dying && !this._deathSent) {
      this._deathSent = true;
      // THE LIVES THAT WILL REMAIN. The engine decrements at the END of the
      // animation (world.js onPlayerDeath: `this.lives--` then test), so the
      // counter visible right now still includes the attempt being lost. The
      // pilot needs the number that decides the match, and sending the stale
      // one would mean the last death never reads as the last death.
      const left = s.gameOver || lives == null ? 0 : Math.max(0, lives - 1);
      out.push({ type: 'marioDeath', d: { island, lives: left, x: s.x, y: s.y } });
    }
    if (!dying) this._deathSent = false;

    // Clearing an island: the level id changed under us, and the level it
    // changed from was not one a dying Mario was being taken off.
    if (this._seen && this._lastLevel && island && island !== this._lastLevel && !dying) {
      const from = this._lastLevel;
      out.push({ type: 'islandCleared', d: { island: from, next: island } });
      // 8-4 is the end of the archipelago, and there is nothing past it to
      // sail to: that is Mario winning outright (spec 3.4). Any other castle
      // is the group weighing anchor, which is progress, not a verdict.
      const final = from === '8-4';
      if (final || worldOf(from) !== worldOf(island)) {
        out.push({ type: 'worldCleared', d: { island: from, next: island, final } });
      }
    }
    if (island) this._lastLevel = island;
    if (island || lives != null) this._seen = true;
    return out;
  }
}

// ---------------------------------------------------------------------------
// The pilot's side: one simulation event in, at most one wire event out
// ---------------------------------------------------------------------------

// The sim's local event names and the wire's event names are DELIBERATELY not
// the same vocabulary, and this is the only place that translates between them.
// Two of them collide outright:
//
//   'detonation'   local, a bomb went off here    ->  'detonate', a PROPOSAL
//                                                     that these keys be
//                                                     destroyed, answered by
//                                                     an authoritative DAMAGE
//   'worldCleared' local, the carrier group sails ->  nothing. On the wire that
//                                                     word means Mario cleared
//                                                     a castle, and it is HIS
//                                                     to say.
export function pilotWireEvent(e, sim = {}) {
  const type = e && e.type;
  const plane = sim.plane || {};
  switch (type) {
    case 'detonation': {
      // Water, or a splash into open air that removed nothing: there is no
      // crater to agree about and nothing for Mario's client to resolve.
      if (!e.island || !Array.isArray(e.keys) || !e.keys.length) return null;
      // The CENTRE rides along with the keys. Mario's client needs it to run
      // the kill against his own hitbox, and it has to be the pilot's centre
      // rather than one inferred from the key list, or the two clients resolve
      // the same bomb against two different circles.
      return {
        type: 'detonate',
        d: { island: e.island, keys: e.keys, cx: e.x, cy: e.y, r: e.radius },
      };
    }
    case 'landed':
      return { type: 'landed', d: { x: plane.x, squadron: sim.squadron } };
    case 'planeLost':
      // `sim.squadron` is already decremented by lose(); this is what is LEFT.
      return {
        type: 'planeLost',
        d: { reason: e.reason, x: e.x, y: e.y, squadron: sim.squadron },
      };
    case 'sortieStart':
      return { type: 'sortieStart', d: { squadron: e.squadron } };
    case 'ferrySunk':
      // The torpedo is a later plan and nothing emits this yet. The routing is
      // here and tested so the ferry has a wire to arrive on.
      return { type: 'ferrySunk', d: { x: e.x, y: e.y } };
    default:
      return null;
  }
}

export default MatchVerdict;
