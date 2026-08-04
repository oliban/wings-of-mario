// Two fake players and a real server, with no browser and no game in either.
// Everything here is a socket and a promise; the whole suite runs in under a
// second.

import { WebSocket } from 'ws';
import { startServer } from '../../server/index.js';
import { MSG, PROTOCOL_VERSION, encode, decode } from '../../src/net/protocol.js';
import { Rooms } from '../../src/net/room.js';

// Port 0 lets the OS pick a free one, which is the only reliable way to run
// these in parallel — and it sidesteps 8123, 4322 and 8199 by construction.
export async function startTestServer(opts = {}) {
  const quiet = { info() {}, warn() {}, error() {} };
  const logs = [];
  const log = opts.captureLogs
    ? {
        info: (...a) => logs.push(['info', a.join(' ')]),
        warn: (...a) => logs.push(['warn', a.join(' ')]),
        error: (...a) => logs.push(['error', a.join(' ')]),
      }
    : quiet;
  const server = await startServer({
    port: 0,
    rooms: new Rooms(opts.codeGen ? { codeGen: opts.codeGen } : {}),
    log,
    // Only passed when a test says so, so every other test exercises the
    // default the real server runs with.
    ...(opts.lobby === undefined ? {} : { lobby: opts.lobby }),
  });
  server.logs = logs;
  return server;
}

// A player, with no game in it: send a message, await the reply you want.
export class FakeClient {
  constructor(port) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.inbox = [];
    this.waiters = [];
    this.ws.on('message', (data) => {
      const parsed = decode(data.toString('utf8'));
      if (!parsed.ok) throw new Error(`client received illegal message: ${parsed.reason}`);
      this.inbox.push(parsed.msg);
      this.waiters = this.waiters.filter((w) => {
        if (!w.match(parsed.msg)) return true;
        w.resolve(parsed.msg);
        return false;
      });
    });
    this.open = new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
    });
  }

  send(msg) {
    this.ws.send(encode(msg));
    return this;
  }

  // Resolve on the first message matching `match`, past OR future — a reply
  // that arrived before the caller got round to waiting must still count, or
  // every test is a race. `since` is an inbox index for the other half of that
  // problem: a test that already provoked an ERROR must not have the next wait
  // satisfied by that same old ERROR.
  next(match, ms = 3000, since = 0) {
    const found = this.inbox.slice(since).find(match);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for a message after ${ms}ms`)),
        ms
      );
      this.waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  ofType(t, ms, since) {
    return this.next((m) => m.t === t, ms, since);
  }

  async hello(room, side, token) {
    await this.open;
    const since = this.inbox.length;
    this.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, room, side, token });
    return this.next((m) => m.t === MSG.WELCOME || m.t === MSG.ERROR, undefined, since);
  }

  close() {
    return new Promise((res) => {
      if (this.ws.readyState === this.ws.CLOSED) return res();
      this.ws.on('close', res);
      this.ws.close();
    });
  }
}

export async function pair(port, room = 'ACDE') {
  const mario = new FakeClient(port);
  const pilot = new FakeClient(port);
  const a = await mario.hello(room, 'mario');
  const b = await pilot.hello(room, 'pilot');
  return { mario, pilot, marioWelcome: a, pilotWelcome: b };
}
