// Rooms that survive a server restart.
//
// The problem: the room table lives in server memory, so every `npm run serve`
// destroyed every code in existence. A player who was handed a code thirty
// seconds ago found a room that silently re-created itself as an EMPTY room in
// a DIFFERENT archipelago — join is getOrCreate, so nothing anywhere reported
// a fault — and the two players then stood in two different worlds.
//
// This file is a JSON file and nothing else. No database, no dependency: the
// server has exactly one (`ws`) and keeps it.
//
// WHY IT LIVES HERE AND NOT IN src/net/room.js: room.js is a pure, clockless,
// I/O-free description of what a room IS, and it is the file every other agent
// working on this game is also in. Persistence is a fact about a process, not
// about a room, so it reaches into Room from outside rather than growing a
// toJSON onto it. The cost is that this file knows Room's field names; that is
// written down in the two functions below and nowhere else.

import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { Room, Rooms, ROOM_IDLE_MS } from '../src/net/room.js';
import { SIDES, normalizeRoomCode } from '../src/net/protocol.js';

// Bumped if the shape below ever changes. A file from a future version is
// refused whole rather than half-understood.
export const STATE_VERSION = 1;

// ---------------------------------------------------------------------------
// What survives, and what does not.
//
// SURVIVES — the room, its code, its seats and their reconnect tokens, its
// archipelago seed, and its destroyed-tile map. That set is chosen as a whole
// and not piecemeal: the seed decides which islands exist, so a room that came
// back without it would put a reconnecting player in a DIFFERENT world under
// the same code, which is worse than losing the room outright. And once the
// seed survives, the room is claiming the match is still the same match — so
// the craters have to come too, or the two clients and the server would
// disagree about every tile bombed before the restart and the desync detector
// would be right to scream. A restart therefore RESUMES THE MATCH IN PROGRESS,
// deliberately, and the file is bigger for it.
//
// DOES NOT SURVIVE:
//   presence   nobody has a socket to a process that has just started, so
//              every seat comes back 'away' — held for its reconnect, exactly
//              as if both players had closed their tabs.
//   hashHistory  the desync detector's three-second grace window. It is about
//              messages in flight down a wire that no longer exists.
//   lives, squadron, the verdict  none of it is here to begin with: this
//              server runs no simulation (spec 7.1) and each client is the
//              truth about its own half.
//
// The last one is the honest limit worth stating plainly: a restart brings the
// ROOM and the WORLD back, not the score. Both players reconnect into the same
// archipelago with the same craters, and their lives and remaining aeroplanes
// are whatever their own pages say they are — which, if they were reloaded
// too, is a fresh count.

export function roomToJSON(room) {
  const seats = [];
  for (const side of SIDES) {
    const seat = room.sides.get(side);
    // `present` is deliberately not written. See above.
    if (seat) seats.push({ side: seat.side, token: seat.token });
  }
  return {
    code: room.code,
    seed: room.seed,
    createdAt: room.createdAt,
    lastActivity: room.lastActivity,
    seatsMinted: room.seatsMinted,
    seats,
    damage: room.damage.toJSON(),
  };
}

// The inverse, and the only place a room is built from something a human could
// have edited. Returns null for anything it cannot vouch for — see loadState:
// one bad room is dropped, it never takes the file or the boot with it.
export function roomFromJSON(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const code = normalizeRoomCode(raw.code);
  if (!code) return null;
  if (!Number.isFinite(raw.seed)) return null;

  const room = new Room(code, { rand: opts.rand, seed: raw.seed, now: 0 });
  room.createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : 0;
  room.lastActivity = Number.isFinite(raw.lastActivity) ? raw.lastActivity : room.createdAt;
  room.seatsMinted = Number.isFinite(raw.seatsMinted) ? raw.seatsMinted : 0;

  for (const seat of Array.isArray(raw.seats) ? raw.seats : []) {
    if (!seat || !SIDES.includes(seat.side) || typeof seat.token !== 'string' || !seat.token) {
      // A seat we cannot describe is a seat nobody can reconnect into. Dropping
      // it leaves the seat OPEN, which is the safe direction: the worst case is
      // a player takes a fresh seat in a match they were already in, where the
      // other direction is a seat held forever by a token that does not exist.
      continue;
    }
    room.sides.set(seat.side, { side: seat.side, token: seat.token, present: false });
  }

  // Through DamageMap.add rather than by assignment, so a hand-edited file
  // cannot put anything in the destroyed set that a detonate could not have.
  const damage = raw.damage && typeof raw.damage === 'object' ? raw.damage : {};
  for (const [island, keys] of Object.entries(damage)) {
    if (typeof island !== 'string' || !island || !Array.isArray(keys)) continue;
    room.damage.add(island, keys.filter((k) => typeof k === 'string'));
  }
  return room;
}

// ---------------------------------------------------------------------------
// The file.

// CORRUPTION IS NOT AN OUTAGE. A truncated write, a hand-edited file, a file
// from a newer version, a directory where a file should be: all of them mean
// "no rooms", never "no server". Losing rooms is the annoyance this whole file
// exists to reduce; a server that will not boot is a worse one.
export function loadState(path, { now = Date.now(), rand, log = console, idleMs = ROOM_IDLE_MS } = {}) {
  const rooms = new Rooms(rand ? { rand } : {});
  if (!path) return rooms;

  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    // No file at all is the ordinary first boot, and is not worth a word.
    if (!err || err.code !== 'ENOENT') log.warn(`[rooms] could not read ${path}: ${err && err.message}`);
    return rooms;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    log.warn(`[rooms] ${path} is not JSON — starting with no rooms (${err && err.message})`);
    return rooms;
  }

  if (!parsed || typeof parsed !== 'object' || parsed.v !== STATE_VERSION) {
    log.warn(`[rooms] ${path} is version ${parsed && parsed.v}, not ${STATE_VERSION} — starting with no rooms`);
    return rooms;
  }

  let kept = 0;
  let dropped = 0;
  let expired = 0;
  for (const raw of Array.isArray(parsed.rooms) ? parsed.rooms : []) {
    let room = null;
    try {
      room = roomFromJSON(raw, { rand });
    } catch (err) {
      room = null;
    }
    if (!room) {
      dropped++;
      continue;
    }
    // EXPIRY, by exactly the rule the live reaper uses and not a second one:
    // a room nobody has touched for longer than ROOM_IDLE_MS would have been
    // reaped had the server stayed up, and a restart must not resurrect it.
    // Every restored room is empty by definition, so idleFor is simply the age
    // of its last activity.
    if (room.idleFor(now) > idleMs) {
      expired++;
      continue;
    }
    if (rooms.rooms.has(room.code)) {
      dropped++;
      continue;
    }
    rooms.rooms.set(room.code, room);
    kept++;
  }
  if (kept || dropped || expired) {
    log.info(`[rooms] restored ${kept} from ${path} (${expired} expired, ${dropped} unreadable)`);
  }
  return rooms;
}

export function serializeState(rooms, now = Date.now()) {
  const out = [];
  for (const room of rooms.rooms.values()) {
    // Expired rooms are simply not written. The reaper runs once a minute and
    // a restart can land in between; there is no reason to save something the
    // next load would throw away.
    if (room.idleFor(now) > ROOM_IDLE_MS) continue;
    out.push(roomToJSON(room));
  }
  return JSON.stringify({ v: STATE_VERSION, saved: now, rooms: out });
}

// Write via a temp file and rename, which is atomic on every filesystem this
// runs on. The failure this prevents is the one that matters most: a server
// killed mid-write leaving half a JSON file that the next boot cannot parse.
export function writeState(path, text, { log = console } = {}) {
  const tmp = `${path}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, text);
    renameSync(tmp, path);
    return true;
  } catch (err) {
    log.warn(`[rooms] could not save to ${path}: ${err && err.message}`);
    try { unlinkSync(tmp); } catch { /* nothing to clean up */ }
    return false;
  }
}

// ---------------------------------------------------------------------------

// How often the room table is written, when it has changed. Rooms change on a
// human timescale — somebody joins, somebody bombs an island — and a code that
// survives all but the last couple of seconds before a crash is the whole ask.
export const SAVE_INTERVAL_MS = 2000;

// The saver. It asks "has anything changed" by serializing and comparing the
// string, rather than by being told.
//
// That is a deliberate trade. The alternative is a dirty flag set at every
// call site that mutates a room — five of them, all inside the socket handler
// in index.js, a file two other plans are also editing this week — and every
// future mutation would have to remember to set it, with the failure mode
// being silent data loss. Comparing a few kilobytes of JSON every two seconds
// costs nothing measurable on a server that runs no simulation at all, and it
// cannot be forgotten.
export function createSaver({ path, rooms, intervalMs = SAVE_INTERVAL_MS, log = console, now = Date.now } = {}) {
  if (!path) return { flush: () => false, stop: () => {}, path: null };
  let last = null;

  const flush = () => {
    const text = serializeState(rooms, now());
    if (text === last) return false;
    if (!writeState(path, text, { log })) return false;
    last = text;
    return true;
  };

  const timer = setInterval(flush, intervalMs);
  // Housekeeping must not hold the process open, exactly as the reaper does not.
  if (timer.unref) timer.unref();

  return {
    path,
    flush,
    stop() {
      clearInterval(timer);
      // One last write on the way out, so an orderly shutdown never loses the
      // couple of seconds since the last tick.
      flush();
    },
  };
}
