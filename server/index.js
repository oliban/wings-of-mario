// The transport. It serves the static game and it carries messages between two
// sockets in a room. It runs NO game simulation (spec 7.1): it never asks where
// a plane is, whether a bomb hit or whether Mario died, because each client is
// the truth about what it owns. The single fact this process is authoritative
// about is the per-island destroyed-tile set, and even that is decided in
// src/net/room.js — everything here is plumbing.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WebSocketServer } from 'ws';

import { serveStatic } from './static.js';
import { Rooms } from '../src/net/room.js';
import {
  MSG, PROTOCOL_VERSION, OTHER_SIDE, decode, encode, normalizeRoomCode,
} from '../src/net/protocol.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

// Housekeeping only. This interval reaps empty rooms; it is NOT a simulation
// tick and there is deliberately no such thing on this server (spec 7.1).
const REAP_INTERVAL_MS = 60 * 1000;

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(encode(msg));
}

function fail(ws, reason) {
  send(ws, { t: MSG.ERROR, reason });
}

// Strict, unlike the global isFinite: '900' off a socket is not a coordinate.
function num(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export async function startServer(opts = {}) {
  const root = resolve(opts.root || REPO_ROOT);
  const rooms = opts.rooms || new Rooms();
  const log = opts.log || console;

  const http = createServer(async (req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      return;
    }
    // POST /room mints a code. A GET would let a link preview or a prefetch
    // create rooms nobody asked for.
    if (req.method === 'POST' && req.url === '/room') {
      const room = rooms.create({ now: Date.now() });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ room: room.code })
      );
      return;
    }
    try {
      if ((req.method === 'GET' || req.method === 'HEAD') && (await serveStatic(req, res, root))) {
        return;
      }
    } catch (err) {
      log.error('[static]', err);
      res.writeHead(500).end('server error');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  });

  const wss = new WebSocketServer({ server: http, path: '/ws' });

  wss.on('connection', (ws) => {
    // Per-socket state. `seat` is null until a valid hello arrives; nothing
    // else is accepted before then.
    let room = null;
    let seat = null;

    // Every open socket sitting in the other seat of this room. Normally one;
    // a reconnect can briefly leave a stale socket on the same side, and
    // sending to both is harmless where picking the wrong one is not.
    const peers = () => {
      if (!room || !seat) return [];
      const want = OTHER_SIDE[seat.side];
      const out = [];
      for (const client of wss.clients) {
        if (client !== ws && client.__room === room && client.__side === want) out.push(client);
      }
      return out;
    };

    const relay = (msg) => {
      for (const other of peers()) send(other, msg);
    };

    ws.on('message', (data) => {
      const parsed = decode(typeof data === 'string' ? data : data.toString('utf8'));
      if (!parsed.ok) return fail(ws, parsed.reason);
      const msg = parsed.msg;

      if (msg.t === MSG.HELLO) {
        if (seat) return fail(ws, 'already joined');
        const code = normalizeRoomCode(msg.room);
        // getOrCreate, not get: a player who types a code their friend read
        // out should land in a room whether or not the friend arrived first.
        const target = rooms.getOrCreate(code, { now: Date.now() });
        if (!target) return fail(ws, 'bad room code');
        const res = target.join({ side: msg.side, token: msg.token }, Date.now());
        if (!res.ok) return fail(ws, res.reason);

        room = target;
        seat = res;
        ws.__room = room;
        ws.__side = res.side;
        ws.__token = res.token;

        const state = room.matchState();
        send(ws, {
          t: MSG.WELCOME,
          v: PROTOCOL_VERSION,
          room: room.code,
          side: res.side,
          token: res.token,
          reconnected: !!res.reconnected,
          seed: state.seed,
          damage: state.damage,
          peer: room.present(OTHER_SIDE[res.side]),
        });
        relay({ t: MSG.PEER, side: res.side, present: true });
        return;
      }

      if (!seat) return fail(ws, 'hello first');
      room.touch(Date.now());

      switch (msg.t) {
        case MSG.SNAP:
          // Never rejected, never inspected, never stored. Spec 7.1: you are
          // the truth about yourself, so this is a relay and nothing else.
          // The `side` on the wire is overwritten with the seat's own side so
          // a client cannot narrate the other player's position.
          relay({ ...msg, side: seat.side });
          return;

        case MSG.EV: {
          if (!room.mayEmit(seat.side, msg.type)) {
            // Refused, not relayed. Hit resolution follows ownership (7.3).
            log.warn(`[room ${room.code}] ${seat.side} tried to emit ${msg.type}`);
            return fail(ws, `not the owner of ${msg.type}`);
          }
          if (msg.type === 'detonate') {
            const rec = room.recordDetonate(seat.side, msg.d.island, msg.d.keys, Date.now());
            if (!rec.ok) return fail(ws, rec.reason);
            // The server's added-key list is the fact (decision D2). It goes
            // to BOTH clients, including the one that proposed it, so every
            // client's set is written by exactly one code path.
            const dmg = { t: MSG.DAMAGE, island: msg.d.island, keys: rec.added, seq: msg.seq };
            // The blast's centre, carried through untouched. The server does
            // not simulate and does not check it against the keys: it is the
            // pilot's statement about his own bomb (spec 7.1), and Mario's
            // client is the one that resolves a kill from it (spec 7.3). Both
            // clients get the SAME numbers, which is the only thing this hop
            // is for. Non-numbers are dropped rather than relayed, so a client
            // cannot make the peer's protocol validator reject the broadcast.
            const g = msg.d;
            if (num(g.cx) && num(g.cy) && num(g.r)) {
              dmg.cx = g.cx;
              dmg.cy = g.cy;
              dmg.r = g.r;
            }
            send(ws, dmg);
            relay(dmg);
          } else {
            relay(msg);
          }
          // Acked once the server has done its part. The sender stops resending.
          send(ws, { t: MSG.ACK, seq: msg.seq });
          return;
        }

        case MSG.ACK:
          relay(msg);
          return;

        case MSG.HASH: {
          const bad = room.compareHashes(msg.h);
          for (const m of bad) {
            // Loudly, in real play — spec 8.4. This is the whole point of the
            // detector: it must be impossible to miss in a server log.
            log.error(
              `[DESYNC] room=${room.code} side=${seat.side} island=${m.island} ` +
                `server=${m.server} client=${m.client}`
            );
            send(ws, { t: MSG.DESYNC, island: m.island, server: m.server, client: m.client });
          }
          return;
        }

        default:
          return fail(ws, `server does not accept ${msg.t}`);
      }
    });

    ws.on('close', () => {
      if (!room || !seat) return;
      room.leave(seat.token, Date.now());
      relay({ t: MSG.PEER, side: seat.side, present: false });
    });

    ws.on('error', (err) => log.error('[ws]', err && err.message));
  });

  const reaper = setInterval(() => {
    for (const code of rooms.reap(Date.now())) log.info(`[room ${code}] reaped`);
  }, REAP_INTERVAL_MS);
  // Do not hold the process open for housekeeping.
  if (reaper.unref) reaper.unref();

  const port = opts.port != null ? opts.port : Number(process.env.PORT) || 8090;
  await new Promise((done) => http.listen(port, done));

  return {
    http,
    wss,
    rooms,
    port: http.address().port,
    async close() {
      clearInterval(reaper);
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise((done) => http.close(done));
    },
  };
}

// Started directly rather than imported: `npm run serve`, and the Docker image.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startServer().then((s) => console.log(`wings-of-mario listening on :${s.port}`));
}
