// A WebSocket with a fault injector strapped to it (spec 8.2:
// `net: { latency(ms), drop(pct), disconnect() }`). Everything here is
// transport, never simulation, which is why it is allowed the two things
// simulation is not: a wall-clock timer and a random number generator.
//
// The wall clock is confined to `_later` below and is used for exactly one
// thing: holding an injected-latency frame back by real milliseconds. Nothing
// in the agreed state of a match is computed from it — the session's resend
// clock is `pump(tick)`, a simulation tick counter, precisely so that a paused
// or stepped client behaves identically to a running one.

// The RNG is nonetheless SEEDED, and deliberately not the engine's: sharing
// Mario's rng would make packet loss consume draws from the stream gameplay
// depends on, so injecting loss would silently change the match — the exact
// coupling the determinism rule exists to prevent. Mulberry32, six lines,
// no import.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Transport {
  constructor(url, opts = {}) {
    this.url = url;
    this.WS = opts.WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    if (!this.WS) throw new Error('transport: no WebSocket implementation available');
    this.ws = null;
    this._msg = () => {};
    this._open = () => {};
    this._close = () => {};

    // Fault injection, all off by default.
    this._latencyMs = 0;
    this._dropPct = 0;
    this._severed = false;
    this._rand = mulberry32(opts.seed != null ? opts.seed : 0x5eed);
    this._timers = new Set();

    this._stats = { sent: 0, received: 0, dropped: 0, delayed: 0 };
  }

  onMessage(cb) { this._msg = cb; }
  onOpen(cb) { this._open = cb; }
  onClose(cb) { this._close = cb; }

  // Re-callable: a session that lost its socket calls this again to get back
  // into the same room with the token it is still holding. Any previous socket
  // is dropped first so a zombie cannot deliver into the new connection.
  connect() {
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try { old.close(); } catch { /* already gone */ }
    }
    this._severed = false;
    return new Promise((resolve, reject) => {
      const ws = new this.WS(this.url);
      this.ws = ws;
      let settled = false;
      ws.onopen = () => {
        settled = true;
        this._open();
        resolve();
      };
      ws.onerror = () => {
        // After open, an error is not a failed connect; the close handler is
        // what the session cares about by then.
        if (!settled) {
          settled = true;
          reject(new Error(`transport: connect failed (${this.url})`));
        }
      };
      ws.onclose = () => {
        if (this.ws === ws) this._close();
      };
      ws.onmessage = (e) => this._receive(typeof e.data === 'string' ? e.data : String(e.data));
    });
  }

  _receive(text) {
    if (this._severed) return;
    if (this._dropPct > 0 && this._rand() * 100 < this._dropPct) {
      this._stats.dropped++;
      return;
    }
    this._stats.received++;
    if (this._latencyMs > 0) this._later(() => this._msg(text));
    else this._msg(text);
  }

  send(text) {
    if (this._severed) return false;
    if (!this.ws || this.ws.readyState !== 1) return false;
    if (this._dropPct > 0 && this._rand() * 100 < this._dropPct) {
      this._stats.dropped++;
      // Deliberately reported as sent: the application believes it went, which
      // is what makes the reliable layer's resend the thing under test.
      return true;
    }
    this._stats.sent++;
    if (this._latencyMs > 0) this._later(() => this.ws && this.ws.readyState === 1 && this.ws.send(text));
    else this.ws.send(text);
    return true;
  }

  // The one wall-clock timer in the client. Named, so a grep for setTimeout in
  // src/ has exactly one hit to explain. Real time is correct here and only
  // here: injected latency is measured in milliseconds of wire delay, and
  // nothing downstream of it feeds the simulation's agreed state.
  _later(fn) {
    this._stats.delayed++;
    const id = setTimeout(() => {
      this._timers.delete(id);
      fn();
    }, this._latencyMs);
    this._timers.add(id);
  }

  latency(ms) {
    this._latencyMs = Math.max(0, ms | 0);
    return this._latencyMs;
  }

  drop(pct) {
    this._dropPct = Math.max(0, Math.min(100, Number(pct) || 0));
    return this._dropPct;
  }

  // Sever the wire without closing the socket: the peer sees nothing at all,
  // which is what a train tunnel looks like. reconnect() puts it back.
  disconnect() {
    this._severed = true;
    return true;
  }

  reconnect() {
    this._severed = false;
    return true;
  }

  get open() {
    return !!this.ws && this.ws.readyState === 1 && !this._severed;
  }

  stats() {
    return { ...this._stats };
  }

  close() {
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onmessage = ws.onclose = ws.onerror = ws.onopen = null;
      try { ws.close(); } catch { /* already gone */ }
    }
  }
}

export default Transport;
