// The wire. This file imports nothing so the Node server can run it byte for
// byte identically to the browser — the same reason src/wings/damage.js
// imports nothing. Anything added here must keep that property.

export const PROTOCOL_VERSION = 1;

export const SIDES = ['mario', 'pilot'];
export const OTHER_SIDE = { mario: 'pilot', pilot: 'mario' };

export const MSG = {
  HELLO: 'hello',     // client -> server: I want into this room
  WELCOME: 'welcome', // server -> client: you are this side, here is the match
  PEER: 'peer',       // server -> client: the other side arrived or left
  SNAP: 'snap',       // either way, 20Hz, unreliable, never rejected
  EV: 'ev',           // either way, reliable, acked, resent until acked
  ACK: 'ack',         // acknowledgement of one EV seq
  DAMAGE: 'damage',   // server -> both: these keys are now destroyed. Authoritative.
  HASH: 'hash',       // client -> server: my destroyed-set hashes
  DESYNC: 'desync',   // server -> client: yours and mine disagree
  ERROR: 'error',     // server -> client: refused, with a reason
};

// Which side is allowed to originate each reliable event, per spec 7.3: hit
// resolution follows ownership. The server drops an event from the wrong side
// rather than relaying it, so "I dodged that" can only ever be argued with the
// client that owns the thing being dodged.
//
// Note the asymmetry with snapshots, which are NEVER rejected. A snapshot is a
// statement about yourself; an event is a claim about the shared world.
//
// `detonate` here is the wire event — a *proposal* that these tile keys be
// destroyed, answered by an authoritative DAMAGE broadcast. It is not the
// local simulation's 'detonation' event, and the two names must not drift
// together.
export const EVENT_OWNER = {
  bombRelease: 'pilot',
  detonate: 'pilot',
  sortieStart: 'pilot',
  landed: 'pilot',
  planeLost: 'pilot',
  ferrySunk: 'pilot',
  marioDeath: 'mario',
  islandCleared: 'mario',
  ferryBoard: 'mario',
  worldCleared: 'mario',
  // Mario's run restarted somewhere else — he spent his last life and the
  // engine put him back on 1-1, or the turn passed to a slot standing in
  // another world. Mario-owned for exactly the reason worldCleared is: only his
  // client can see which level the engine actually loaded, and the pilot must
  // never infer the ocean he is flying over from anything he can see.
  worldReset: 'mario',
};

export const RELIABLE_TYPES = new Set(Object.keys(EVENT_OWNER));

// Room codes are read aloud over a voice call, so the alphabet drops every
// character that is confusable when spoken or seen: O/0, I/1/L, S/5, B/8, Z/2.
export const ROOM_CODE_LEN = 4;
export const ROOM_CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';

export function isRoomCode(s) {
  if (typeof s !== 'string' || s.length !== ROOM_CODE_LEN) return false;
  for (const ch of s) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

export function normalizeRoomCode(s) {
  if (typeof s !== 'string') return null;
  const up = s.trim().toUpperCase();
  return isRoomCode(up) ? up : null;
}

// Cadences, in fixed 60.0988Hz ticks. 20Hz snapshots is every third tick;
// hashes once a second (spec 8.4); the interpolation delay is two snapshot
// intervals, so one dropped snapshot still has a successor to interpolate to.
export const SNAPSHOT_INTERVAL_TICKS = 3;
export const HASH_INTERVAL_TICKS = 60;
export const INTERP_DELAY_TICKS = 6;
export const RESEND_INTERVAL_TICKS = 12;

// A snapshot is under 200 bytes and the biggest legal message is a full damage
// dump on join. 256KB is far past anything real and far short of anything that
// can exhaust the server, and refusing at the decoder means a hostile payload
// is never even parsed.
export const MAX_MESSAGE_BYTES = 256 * 1024;

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

// Strict, unlike the global isFinite, which says yes to the string '900'. A
// coordinate off the wire that arrives as a string would land a crater at NaN
// on one client and nowhere on the other.
function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// null means valid. A string is the reason it is not, and that reason is what
// the server puts in its ERROR reply, so it has to be safe to say out loud.
export function validate(msg) {
  if (!isPlainObject(msg)) return 'not an object';
  switch (msg.t) {
    case MSG.HELLO:
      if (msg.v !== PROTOCOL_VERSION) return `protocol version ${msg.v} != ${PROTOCOL_VERSION}`;
      if (!isRoomCode(msg.room)) return 'bad room code';
      if (msg.side != null && !SIDES.includes(msg.side)) return 'bad side';
      if (msg.token != null && typeof msg.token !== 'string') return 'bad token';
      return null;
    case MSG.WELCOME:
      if (!SIDES.includes(msg.side)) return 'bad side';
      if (!isRoomCode(msg.room)) return 'bad room code';
      if (typeof msg.token !== 'string') return 'bad token';
      if (!isInt(msg.seed)) return 'bad seed';
      if (!isPlainObject(msg.damage)) return 'bad damage map';
      return null;
    case MSG.PEER:
      if (!SIDES.includes(msg.side)) return 'bad side';
      if (typeof msg.present !== 'boolean') return 'bad presence';
      return null;
    case MSG.SNAP:
      // Deliberately shape-only. Spec 7.1: never rejected — you are the truth
      // about yourself, so the contents of `s` are not this layer's business.
      if (!SIDES.includes(msg.side)) return 'bad side';
      if (!isInt(msg.tick)) return 'bad tick';
      if (!isPlainObject(msg.s)) return 'bad snapshot body';
      return null;
    case MSG.EV:
      if (!isInt(msg.seq) || msg.seq < 0) return 'bad seq';
      if (!RELIABLE_TYPES.has(msg.type)) return `unknown event type ${msg.type}`;
      if (!isPlainObject(msg.d)) return 'bad event payload';
      return null;
    case MSG.ACK:
      if (!isInt(msg.seq) || msg.seq < 0) return 'bad seq';
      return null;
    case MSG.DAMAGE:
      // `keys` is only checked to be an array here: this file cannot import
      // parseTileKey from src/wings/blast.js without pulling in
      // src/core/constants.js and losing the no-imports property the server
      // depends on. Every consumer must run each key through parseTileKey and
      // skip the nulls.
      if (typeof msg.island !== 'string' || !msg.island) return 'bad island';
      if (!Array.isArray(msg.keys)) return 'bad keys';
      // The blast that caused it, in WORLD pixels plus a radius in tiles.
      // Optional: a catch-up dump on join carries keys and no geometry. When it
      // IS present, Mario's client resolves the kill against it (spec 7.3), so
      // it travels on the authoritative broadcast rather than on the pilot's
      // proposal — the server consumes a `detonate` instead of relaying it, so
      // this frame is the only thing Mario's client ever sees of that bomb.
      if (msg.cx != null || msg.cy != null || msg.r != null) {
        if (!isNum(msg.cx) || !isNum(msg.cy) || !isNum(msg.r)) return 'bad blast centre';
      }
      return null;
    case MSG.HASH:
      if (!isInt(msg.tick)) return 'bad tick';
      if (!isPlainObject(msg.h)) return 'bad hash map';
      return null;
    case MSG.DESYNC:
      if (typeof msg.island !== 'string') return 'bad island';
      return null;
    case MSG.ERROR:
      if (typeof msg.reason !== 'string') return 'bad reason';
      return null;
    default:
      return `unknown message type ${msg && msg.t}`;
  }
}

export function encode(msg) {
  return JSON.stringify(msg);
}

// Never throws. The server feeds this whatever arrived on the socket, so a
// malformed frame has to be a return value, not an exception to be caught at
// every call site.
export function decode(text) {
  if (typeof text !== 'string') return { ok: false, reason: 'not text' };
  if (text.length > MAX_MESSAGE_BYTES) return { ok: false, reason: 'too large' };
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'bad json' };
  }
  const bad = validate(msg);
  if (bad) return { ok: false, reason: bad };
  return { ok: true, msg };
}
