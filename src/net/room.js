// A room, with no sockets in it. Everything that decides who is Mario, who
// reconnects into what, and what the destroyed-tile map contains happens here
// and nowhere else, so all of it is testable in plain Node in milliseconds.
//
// No timers, no wall clock, no I/O: every method that cares about time is
// handed `now`. Transport is a separate layer and calls into this one.

import {
  SIDES, EVENT_OWNER, ROOM_CODE_ALPHABET, ROOM_CODE_LEN, normalizeRoomCode,
} from './protocol.js';
import { DamageMap, hashKeys, destroyKeys, buildKeys } from '../wings/damage.js';
import { parseTileKey } from '../wings/blast.js';
import { filterProtectedForIsland } from '../wings/sanctuary.js';

// How long an empty room is kept before it is thrown away. Long enough that a
// tab crash, a laptop lid or a train tunnel reconnects into the same match
// (spec 7.4), short enough that a forgotten room is not held forever.
export const ROOM_IDLE_MS = 10 * 60 * 1000;

// How long a client is allowed to still be in a state this room has recently
// left. A client's destroyed-tile set is written by this server's own DAMAGE
// broadcast, so it is legitimately behind for one trip down the wire, and it
// hashes on a one-second timer that knows nothing about when craters land.
// Without this window the detector would fire on every bombing run and be
// switched off inside a day.
//
// Three seconds is far past any RTT worth playing over and is paid for by
// nothing: a set that is genuinely wrong stays wrong until the server repairs
// it, so it is still caught on the next quiet second. What the window costs is
// three seconds of delay before that repair goes out, never the repair itself.
export const HASH_GRACE_MS = 3000;

// How many past states are kept per island. A hash is 8 bytes of string; this
// is here so a long match cannot grow the room without bound, not because 64
// is ever reached inside a three-second window.
const HASH_HISTORY_MAX = 64;

const EMPTY_HASH = hashKeys([]);

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
    // The other half of that state: tiles Mario's brick bombs have ADDED to a
    // level that never had them. Held here for the same reason the destroyed
    // set is (D2) — a pilot who reconnects, or who joins an hour into the
    // match, has to be given the bridge as well as the crater, and neither
    // client can be asked to remember what the other one built. The two sets
    // are kept disjoint by destroyKeys/buildKeys; see src/wings/damage.js.
    this.built = new DamageMap();
    // islandId -> [{ hash, until }]: the states this island's set has been in
    // and the moment it stopped being in each of them. Only the desync
    // detector reads it; see compareHashes.
    this.hashHistory = new Map();
    this.sides = new Map(); // side -> { side, token, present }
    this.lastActivity = opts.now != null ? opts.now : 0;
    // When this room came into being, kept only so a lobby list can put the
    // newest room first — the one a player who just heard "I started a room"
    // is looking for. Nothing in the match reads it.
    this.createdAt = opts.now != null ? opts.now : 0;
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
    // THE SANCTUARY, enforced here and not merely on the pilot's client: this
    // function is the sole author of the destroyed set (D2), so a buggy or
    // hostile client that proposes the tiles under Mario's feet must be
    // refused HERE or the server would dutifully broadcast the death loop to
    // both players. Dropped silently rather than rejecting the whole detonate:
    // the rest of that bomb's crater is legitimate and belongs on both maps.
    const clean = filterProtectedForIsland(
      islandId,
      keys.filter((k) => parseTileKey(k) !== null)
    );
    // The state we are about to leave, remembered BEFORE the change and only
    // when there is a change, so a client still holding it is recognised as
    // one broadcast behind rather than accused of a desync.
    const before = this.damage.hash(islandId);
    // A bomb into a brick row takes the bricks back out of the built set in the
    // same breath. Last action wins, and the two sets never overlap.
    const { destroyed: added } = destroyKeys(this.damage, this.built, islandId, clean);
    if (added.length) this._rememberState(islandId, before, now);
    // What this detonate is authoritatively responsible for: every key it
    // proposed that is in fact destroyed. On first delivery that is exactly
    // `added`; on a RESEND `added` is empty and this is still the whole
    // crater.
    //
    // The difference is the whole point. `detonate` is a reliable event, and
    // the proposer's outbox is settled by the DAMAGE carrying its seq — so
    // broadcasting `added` on a resend settled the retry while delivering an
    // EMPTY key list, and the retry that D4 promises would repair a dropped
    // crater instead guaranteed it stayed lost. Re-delivering the full set is
    // safe because every client's set is append-only.
    const authoritative = clean.filter((k) => this.damage.has(islandId, k));
    return { ok: true, added, keys: authoritative };
  }

  // The mirror of recordDetonate, for the tiles the toolbelt's brick bomb ADDS.
  // Same shape, same ownership check, same parse filter — and the same D2 rule:
  // what comes back from here is the fact, and what Mario's engine thought it
  // laid is not.
  //
  // NO SANCTUARY FILTER, deliberately. The sanctuary exists so the ground under
  // a spawning Mario cannot be taken away from him; putting a brick down near
  // his spawn takes nothing from anybody, and refusing it here would silently
  // eat part of a row he paid a coin for. Note the consequence, which is
  // correct rather than merely tolerable: a brick laid inside the strip is
  // protected exactly like the ground it stands on, because isProtected is a
  // question about the RECTANGLE and not about what is in it.
  recordBuild(side, islandId, keys, now) {
    if (!this.mayEmit(side, 'build')) return { ok: false, reason: 'not the owner of build' };
    if (typeof islandId !== 'string' || !islandId) return { ok: false, reason: 'bad island' };
    if (!Array.isArray(keys)) return { ok: false, reason: 'bad keys' };
    this.touch(now);
    const clean = keys.filter((k) => parseTileKey(k) !== null);
    const before = this.damage.hash(islandId);
    const { built: added, repaired } = buildKeys(this.damage, this.built, islandId, clean);
    // A brick laid in a crater CHANGES THE DESTROYED SET, which is the set the
    // desync detector compares — so the state we just left has to be remembered
    // here too, or a client still holding it for one trip down the wire is
    // accused of a desync it does not have.
    if (repaired.length) this._rememberState(islandId, before, now);
    // Every key this build is responsible for, not merely the new ones: a
    // RESEND adds nothing and must still deliver the whole row, exactly as
    // recordDetonate re-delivers the whole crater and for the same reason.
    const authoritative = clean.filter((k) => this.built.has(islandId, k));
    return { ok: true, added, repaired, keys: authoritative };
  }

  _rememberState(islandId, hash, until) {
    let hist = this.hashHistory.get(islandId);
    if (!hist) {
      hist = [];
      this.hashHistory.set(islandId, hist);
    }
    hist.push({ hash, until });
    if (hist.length > HASH_HISTORY_MAX) hist.splice(0, hist.length - HASH_HISTORY_MAX);
  }

  // Was `hash` a state this island was in recently enough that a client could
  // still be holding it? `now` of null means the caller has no clock, and gets
  // the strict comparison with no window at all.
  _recentlyHeld(islandId, hash, now) {
    if (typeof now !== 'number' || !Number.isFinite(now)) return false;
    const hist = this.hashHistory.get(islandId);
    if (!hist) return false;
    for (const entry of hist) {
      if (entry.hash === hash && typeof entry.until === 'number' && entry.until >= now - HASH_GRACE_MS) {
        return true;
      }
    }
    return false;
  }

  // Every island the client mentions is compared against the server's set for
  // that island — including islands the server has never damaged, which must
  // hash as empty rather than be skipped, or a client that invented damage
  // out of nowhere would never be caught.
  //
  // And every island the server HAS damaged, whether the client mentioned it
  // or not: silence about an island is a claim that it is undamaged, not an
  // abstention, so a client that lost a whole island's craters is caught too.
  //
  // `now` buys the one excuse a client is allowed: being one broadcast behind.
  // See HASH_GRACE_MS. Omit it and the comparison is strict.
  compareHashes(hashes, now = null) {
    const out = [];
    if (!hashes || typeof hashes !== 'object') return out;
    const claimed = new Map(Object.entries(hashes));
    for (const [island, set] of this.damage.islands) {
      if (set.size && !claimed.has(island)) claimed.set(island, null);
    }
    for (const [island, client] of claimed) {
      const keys = this.damage.keys(island);
      const server = hashKeys(keys);
      // A client that never mentioned the island is claiming it is untouched.
      const effective = client === null ? EMPTY_HASH : client;
      if (effective === server) continue;
      if (this._recentlyHeld(island, effective, now)) continue;
      // What to look at, not just that something is wrong: how many keys this
      // server holds and a handful of them. The client logs its own count and
      // sample beside these, and the difference between them is the diagnosis.
      out.push({ island, server, client, n: keys.length, sample: keys.slice(0, 8) });
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
      // The bridges as well as the holes. A pilot who joins an hour in has to
      // be given both or he flies over an island whose shape only Mario knows.
      built: { ...this.built.toJSON() },
      sides: SIDES.filter((s) => this.sides.has(s)),
    };
  }

  // What a stranger is allowed to know about this room: its code, how old it
  // is, and which seats they could actually sit in. No seed, no tokens, no
  // damage — a lobby listing is an invitation, not match state.
  //
  // The three seat states are the three answers join() will give, and they are
  // deliberately not "present"/"absent". A seat whose player closed the tab is
  // 'away', NOT free: leave() keeps the seat so the player can reconnect into
  // the match they left (spec 7.4), so join() would refuse it with 'side
  // taken'. Reporting it as open would send a clicker straight into the
  // SEAT TAKEN banner, which is the one outcome this listing exists to avoid.
  summary(now) {
    const seats = {};
    for (const side of SIDES) {
      const seat = this.sides.get(side);
      seats[side] = !seat ? 'open' : seat.present ? 'here' : 'away';
    }
    return {
      code: this.code,
      seats,
      ageMs: typeof now === 'number' && Number.isFinite(now)
        ? Math.max(0, now - this.createdAt)
        : null,
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

  // Every live room, newest first, as summaries. Newest first because the
  // question a player is actually asking is "which one did they just start" —
  // and capped, because a header with thirty codes in it answers nobody.
  //
  // Rooms this list may show are rooms that still exist: reap() has already
  // thrown away anything idle past ROOM_IDLE_MS, so a code here is one a
  // client can still join into a live match rather than silently re-create.
  list(now, { limit = 8 } = {}) {
    const out = [];
    for (const room of this.rooms.values()) out.push(room);
    out.sort((a, b) => b.createdAt - a.createdAt || (a.code < b.code ? -1 : 1));
    return out.slice(0, Math.max(0, limit)).map((r) => r.summary(now));
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
