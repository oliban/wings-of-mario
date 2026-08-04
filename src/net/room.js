// A room, with no sockets in it. Everything that decides who is Mario, who
// reconnects into what, and what the destroyed-tile map contains happens here
// and nowhere else, so all of it is testable in plain Node in milliseconds.
//
// No timers, no wall clock, no I/O: every method that cares about time is
// handed `now`. Transport is a separate layer and calls into this one.

import {
  SIDES, EVENT_OWNER, ROOM_CODE_ALPHABET, ROOM_CODE_LEN, normalizeRoomCode,
} from './protocol.js';
import { DamageMap } from '../wings/damage.js';
import { parseTileKey } from '../wings/blast.js';

// How long an empty room is kept before it is thrown away. Long enough that a
// tab crash, a laptop lid or a train tunnel reconnects into the same match
// (spec 7.4), short enough that a forgotten room is not held forever.
export const ROOM_IDLE_MS = 10 * 60 * 1000;

// The one place randomness enters. `rand` is injectable everywhere it is used,
// so a test that pins it pins the room code, the archipelago seed and the seat
// tokens together — nothing else in this file is non-deterministic.
const defaultRand = Math.random;

export class Room {
  constructor(code, opts = {}) {
    this.code = code;
    this.rand = opts.rand || defaultRand;
    // The archipelago seed. Every client derives layout, ferry timing and AA
    // behaviour from it (spec 8.1), so it is minted once, here, and never
    // recomputed — including across a reconnect, or the returning player would
    // land in a different archipelago than the one they left. `opts.seed`
    // exists so tests can pin it.
    this.seed = opts.seed != null ? opts.seed : Math.floor(this.rand() * 0x7fffffff);
    // The entire authoritative shared state of the match (spec 4.3). Nothing
    // else on this server is authoritative about anything.
    this.damage = new DamageMap();
    this.sides = new Map(); // side -> { side, token, present }
    this.lastActivity = opts.now != null ? opts.now : 0;
    this.seatsMinted = 0;
  }

  // A seat token. Not a security credential — spec 11 puts anti-cheat
  // explicitly out of scope — just something unguessable enough that two
  // people in the same cafe do not collide, and unique enough to identify a
  // reconnecting seat. The counter is what guarantees uniqueness; the noise is
  // only there so a token cannot be guessed from a room code.
  _mintToken(side) {
    this.seatsMinted++;
    const noise = Math.floor(this.rand() * 0xffffffff).toString(36);
    return `${this.code}.${side}.${this.seatsMinted}.${noise}`;
  }

  touch(now) {
    if (now != null) this.lastActivity = now;
  }

  present(side) {
    const seat = this.sides.get(side);
    return !!seat && seat.present;
  }

  empty() {
    for (const seat of this.sides.values()) if (seat.present) return false;
    return true;
  }

  idleFor(now) {
    return this.empty() ? Math.max(0, now - this.lastActivity) : 0;
  }

  seatFor(token) {
    if (typeof token !== 'string') return null;
    for (const seat of this.sides.values()) if (seat.token === token) return seat;
    return null;
  }

  // A token reconnects into its own seat. Otherwise the requested side is
  // taken if free; with no request, whichever side is free, mario first.
  join({ side, token } = {}, now) {
    this.touch(now);
    const existing = this.seatFor(token);
    if (existing) {
      existing.present = true;
      return { ok: true, side: existing.side, token: existing.token, reconnected: true };
    }

    let want = SIDES.includes(side) ? side : null;
    if (want && this.sides.has(want)) return { ok: false, reason: 'side taken' };
    if (!want) {
      want = SIDES.find((s) => !this.sides.has(s)) || null;
      if (!want) return { ok: false, reason: 'room full' };
    }

    const seat = { side: want, token: this._mintToken(want), present: true };
    this.sides.set(want, seat);
    return { ok: true, side: seat.side, token: seat.token, reconnected: false };
  }

  // Leaving marks the seat absent but KEEPS it: the whole point of holding
  // match state is that a disconnect reconnects into the same match rather
  // than losing it, and a seat handed to a stranger in the meantime would
  // make that impossible.
  leave(token, now) {
    this.touch(now);
    const seat = this.seatFor(token);
    if (!seat) return false;
    seat.present = false;
    return true;
  }

  // Ownership, per spec 7.3, enforced rather than merely described: a detonate
  // proposal from the side that does not fly the plane is not relayed. Own
  // property only, so 'toString' and 'constructor' are not event types.
  mayEmit(side, type) {
    if (!Object.prototype.hasOwnProperty.call(EVENT_OWNER, type)) return false;
    return EVENT_OWNER[type] === side;
  }

  // The one place the destroyed-tile map is written. Decision D2: this
  // function's return value — DamageMap.add()'s newly-added keys — is the
  // fact. What a client's own destroyTiles() thought it removed is not.
  recordDetonate(side, islandId, keys, now) {
    if (!this.mayEmit(side, 'detonate')) return { ok: false, reason: 'not the owner of detonate' };
    if (typeof islandId !== 'string' || !islandId) return { ok: false, reason: 'bad island' };
    if (!Array.isArray(keys)) return { ok: false, reason: 'bad keys' };
    this.touch(now);
    // parseTileKey returns null for anything that is not `<int>,<int>`. Drop
    // those here rather than at the client: a key that reached the map would
    // be broadcast to a peer that cannot parse it, and the two would then
    // disagree forever with no way to tell which one was right.
    const clean = keys.filter((k) => parseTileKey(k) !== null);
    return { ok: true, added: this.damage.add(islandId, clean) };
  }

  // Every island the client mentions is compared against the server's set for
  // that island — including islands the server has never damaged, which must
  // hash as empty rather than be skipped, or a client that invented damage
  // out of nowhere would never be caught.
  compareHashes(hashes) {
    const out = [];
    if (!hashes || typeof hashes !== 'object') return out;
    for (const island of Object.keys(hashes)) {
      const server = this.damage.hash(island);
      if (hashes[island] !== server) out.push({ island, server, client: hashes[island] });
    }
    return out;
  }

  // Everything a joining or reconnecting client needs to rebuild the match it
  // was in: the seed the archipelago came from and every tile already gone.
  matchState() {
    // Spread rather than pass DamageMap.toJSON() straight through: that object
    // has a null prototype, which is right for it and surprising here, where
    // callers compare and merge it like an ordinary map. Spread still defines
    // own properties, so a '__proto__' island id stays a plain key.
    return {
      seed: this.seed,
      damage: { ...this.damage.toJSON() },
      sides: SIDES.filter((s) => this.sides.has(s)),
    };
  }
}

// ---------------------------------------------------------------------------

// Room codes are read aloud, so they come from the protocol's deliberately
// unconfusable alphabet and nothing else.
function makeCodeGen(rand) {
  return function codeGen() {
    let out = '';
    for (let i = 0; i < ROOM_CODE_LEN; i++) {
      out += ROOM_CODE_ALPHABET[Math.floor(rand() * ROOM_CODE_ALPHABET.length)];
    }
    return out;
  };
}

export class Rooms {
  constructor(opts = {}) {
    this.rooms = new Map();
    this.rand = opts.rand || defaultRand;
    this.codeGen = opts.codeGen || makeCodeGen(this.rand);
  }

  get size() {
    return this.rooms.size;
  }

  create(opts = {}) {
    // Retry on collision. With a 25-character alphabet there are 390625 codes,
    // so this loop effectively never runs twice; the bound is there so a
    // broken generator fails loudly instead of hanging the process.
    for (let i = 0; i < 200; i++) {
      const code = this.codeGen();
      if (!code || this.rooms.has(code)) continue;
      const room = new Room(code, { rand: this.rand, ...opts });
      this.rooms.set(code, room);
      return room;
    }
    throw new Error('rooms: could not mint a free code');
  }

  get(code) {
    const norm = normalizeRoomCode(code);
    return norm ? this.rooms.get(norm) || null : null;
  }

  // Joining by code: the first arrival makes the room, the second finds it.
  getOrCreate(code, opts = {}) {
    const norm = normalizeRoomCode(code);
    if (!norm) return null;
    let room = this.rooms.get(norm);
    if (!room) {
      room = new Room(norm, { rand: this.rand, ...opts });
      this.rooms.set(norm, room);
    }
    return room;
  }

  drop(code) {
    const norm = normalizeRoomCode(code);
    return norm ? this.rooms.delete(norm) : false;
  }

  // Called by whatever owns the clock; this file never asks what time it is.
  reap(now) {
    const dropped = [];
    for (const [code, room] of this.rooms) {
      if (room.idleFor(now) > ROOM_IDLE_MS) {
        this.rooms.delete(code);
        dropped.push(code);
      }
    }
    return dropped;
  }
}

export default Room;
