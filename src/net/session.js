import {
  MSG, PROTOCOL_VERSION, RELIABLE_TYPES,
  SNAPSHOT_INTERVAL_TICKS, RESEND_INTERVAL_TICKS, HASH_INTERVAL_TICKS,
  encode, decode,
} from './protocol.js';

// One player's connection to a room. Knows nothing about aeroplanes, tiles or
// Mario: it moves messages and guarantees the reliable ones arrive exactly
// once. Both sides run this identical file.
//
// There is no clock in this file. Everything periodic is driven by `pump(tick)`
// and by the tick the caller passes to `sendSnapshot`, so a stepped client and
// a running one produce byte-identical traffic.
export class Session {
  constructor({ transport, room, side, token } = {}) {
    if (!transport) throw new Error('session: a transport is required');
    this.transport = transport;
    this.room = room;
    this.side = side || null;
    this.token = token || null;
    this.seed = null;
    // The match state that came with the welcome: `{ islandId: [tileKey, …] }`.
    // Task 6 owns folding it back into the islands; the session only carries it.
    this.damage = {};
    this.reconnected = false;
    this.connected = false;
    this.peerPresent = false;

    this._seq = 0;
    // seq -> { msg, lastSentTick }. Survives a disconnect on purpose: an event
    // that was in flight when the wifi died still has to arrive.
    this._outbox = new Map();
    // Every inbound event seq we have already acted on. The peer resends until
    // its ack arrives, so the same event arrives several times routinely — and
    // acting on `detonate` twice would be a double crater.
    this.seen = new Set();
    // Every DAMAGE seq already delivered. The authoritative broadcast is now
    // re-sent whenever the proposer resends its detonate, so the same crater
    // legitimately arrives more than once — and the geometry it carries is
    // what Mario's client resolves a KILL against. Applying the keys twice is
    // harmless (the sets are append-only); running the blast twice would kill
    // Mario a second time for one bomb.
    this.seenDamage = new Set();
    this._listeners = new Map();
    this._lastSnapTick = -Infinity;
    this._lastHashTick = -Infinity;
    this._welcome = null;

    this.transport.onMessage((text) => this._onMessage(text));
    this.transport.onClose(() => {
      if (!this.connected) return;
      this.connected = false;
      this._emit('close', {});
    });
  }

  // ---- listeners -----------------------------------------------------------

  on(type, cb) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(cb);
    return this;
  }

  off(type, cb) {
    const set = this._listeners.get(type);
    if (set) set.delete(cb);
    return this;
  }

  _emit(type, payload) {
    const set = this._listeners.get(type);
    if (!set) return;
    for (const cb of set) cb(payload);
  }

  // ---- connecting ----------------------------------------------------------

  // Also the reconnect path (spec 7.4). Called a second time on the same
  // Session it keeps the token, the seq counter, the outbox and the seen set,
  // which is the difference between resuming a match and starting a new one:
  // the token puts us back in our own seat and the welcome brings the seed and
  // the destroyed-tile map back with it.
  async connect() {
    await this.transport.connect();
    return new Promise((resolve, reject) => {
      this._welcome = { resolve, reject };
      this._send({
        t: MSG.HELLO,
        v: PROTOCOL_VERSION,
        room: this.room,
        side: this.side || undefined,
        token: this.token || undefined,
      });
    });
  }

  // ---- sending -------------------------------------------------------------

  _send(msg) {
    this.transport.send(encode(msg));
  }

  // Unreliable and rate-limited: a snapshot that is late is worthless, so a
  // dropped one is simply never mentioned again — it is never queued, never
  // acked and never resent. `body` is built fresh by the caller each tick, so
  // what goes out is always current state.
  sendSnapshot(tick, body) {
    this._requireConnected();
    if (tick - this._lastSnapTick < SNAPSHOT_INTERVAL_TICKS) return false;
    this._lastSnapTick = tick;
    this._send({ t: MSG.SNAP, side: this.side, tick, s: body });
    return true;
  }

  // Reliable: kept in the outbox and resent on a tick timer until the PEER
  // acknowledges it — see `_onMessage`'s ACK case for why the server's own ack
  // is not enough.
  sendEvent(type, data = {}) {
    this._requireConnected();
    if (!RELIABLE_TYPES.has(type)) throw new Error(`session: unknown event type "${type}"`);
    const seq = ++this._seq;
    const msg = { t: MSG.EV, seq, type, d: data };
    this._outbox.set(seq, { msg, lastSentTick: 0, reachedServer: false });
    this._send(msg);
    return seq;
  }

  sendHash(tick, hashes) {
    this._requireConnected();
    this._send({ t: MSG.HASH, tick, h: hashes });
    return true;
  }

  // The desync detector's clock, driven by the tick counter like everything
  // else here. `buildHashes` is a callback rather than a value so the hash is
  // computed only on the tick it is actually sent — FNV-1a over every
  // destroyed key, sixty times a second, for one useful frame in sixty, is
  // real work for nothing.
  maybeSendHash(tick, buildHashes) {
    if (!this.connected) return false;
    if (tick - this._lastHashTick < HASH_INTERVAL_TICKS) return false;
    this._lastHashTick = tick;
    this.sendHash(tick, buildHashes());
    return true;
  }

  // Call once per simulation tick. The only thing it does is resend: it is
  // driven by the TICK COUNTER, not a clock, so a paused or stepped client
  // behaves exactly like a running one.
  pump(tick) {
    if (!this.connected) return 0;
    let resent = 0;
    for (const entry of this._outbox.values()) {
      if (tick - entry.lastSentTick < RESEND_INTERVAL_TICKS) continue;
      // The server has it and there is nobody in the other seat to relay it
      // to. Resending would be shouting into an empty room; the entry stays
      // put and goes out the moment a PEER arrives.
      if (entry.reachedServer && !this.peerPresent) continue;
      entry.lastSentTick = tick;
      this._send(entry.msg);
      resent++;
    }
    return resent;
  }

  // Everything unacked goes out on the very next pump. Used when the wire has
  // just come back — a new socket, or the other seat refilling — so a waiting
  // event is not held for a further resend interval.
  _flushOutbox() {
    for (const entry of this._outbox.values()) entry.lastSentTick = -Infinity;
  }

  _requireConnected() {
    if (!this.connected) throw new Error('session: not connected');
  }

  // ---- receiving -----------------------------------------------------------

  _onMessage(text) {
    const parsed = decode(text);
    if (!parsed.ok) {
      // Reported, not thrown, and the session stays up: one malformed frame
      // is not a reason to end a match.
      this._emit('error', { reason: `undecodable message: ${parsed.reason}` });
      return;
    }
    const msg = parsed.msg;

    switch (msg.t) {
      case MSG.WELCOME:
        this.connected = true;
        this.side = msg.side;
        this.token = msg.token;
        this.room = msg.room;
        this.seed = msg.seed;
        this.damage = msg.damage || {};
        this.reconnected = !!msg.reconnected;
        this.peerPresent = !!msg.peer;
        // Anything still unacked when the wire died goes out on the very next
        // pump rather than waiting out a resend interval on the new socket.
        this._flushOutbox();
        this._emit('welcome', msg);
        if (this._welcome) {
          this._welcome.resolve(msg);
          this._welcome = null;
        }
        return;

      case MSG.ERROR:
        this._emit('error', msg);
        if (this._welcome) {
          this._welcome.reject(new Error(msg.reason));
          this._welcome = null;
        }
        return;

      case MSG.PEER:
        this.peerPresent = msg.present;
        // The other seat just filled. Anything we were holding for want of
        // somebody to deliver it to goes out now.
        if (msg.present) this._flushOutbox();
        this._emit('peer', msg);
        return;

      case MSG.SNAP:
        // Never rejected, never second-guessed (spec 7.1). The peer is the
        // truth about itself; this layer hands the body straight on.
        this._emit('snapshot', msg);
        return;

      case MSG.EV:
        // Ack first, unconditionally: the peer resends because it did not
        // hear us, and an event we have already acted on still needs its ack
        // or it will be resent forever.
        //
        // `peer: true` is what makes this ack distinguishable from the
        // server's own hop ack when the server relays it back. The protocol's
        // validator checks only `seq` on an ACK, so the flag rides along
        // untouched and the server needs to know nothing about it.
        this._send({ t: MSG.ACK, seq: msg.seq, peer: true });
        if (this.seen.has(msg.seq)) return;
        this.seen.add(msg.seq);
        this._emit('event', msg);
        return;

      case MSG.ACK: {
        // Two different acks arrive on this socket and they mean different
        // things. The server acks an EV the moment it relays it — that only
        // says the message reached the server, and clearing the outbox on it
        // would lose the event outright if the peer happened to be in a tunnel
        // at that moment. Only the peer's own ack, relayed back, means the
        // event has actually landed where it was aimed.
        if (msg.peer === true) {
          this._outbox.delete(msg.seq);
          return;
        }
        const entry = this._outbox.get(msg.seq);
        if (entry) entry.reachedServer = true;
        return;
      }

      case MSG.DAMAGE:
        // Authoritative (decision D2). Whoever proposed it, this is the fact.
        // A DAMAGE carrying the `seq` of our own detonate also settles it, and
        // is the ONLY thing that can: the server consumes a detonate rather
        // than relaying it, so the peer never sees an EV to ack. Once the
        // craters are recorded the proposal is done.
        if (typeof msg.seq === 'number') {
          this._outbox.delete(msg.seq);
          // A repeat of a crater already applied: the keys still go in, but
          // this is a catch-up and not a live detonation. A repair frame from
          // the server carries no seq and no geometry at all, so it is
          // silent for the same reason without needing to be marked.
          if (this.seenDamage.has(msg.seq)) msg.replay = true;
          else this.seenDamage.add(msg.seq);
        }
        this._emit('damage', msg);
        return;

      case MSG.DESYNC:
        this._emit('desync', msg);
        return;

      default:
        return;
    }
  }

  pending() {
    return this._outbox.size;
  }

  stats() {
    return {
      side: this.side,
      room: this.room,
      connected: this.connected,
      peer: this.peerPresent,
      pending: this._outbox.size,
      seen: this.seen.size,
      transport: this.transport.stats ? this.transport.stats() : null,
    };
  }

  close() {
    this.connected = false;
    this.transport.close();
  }
}

export default Session;
