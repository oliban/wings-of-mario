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
import { createSaver, loadState } from './persist.js';
import { Rooms } from '../src/net/room.js';
import {
  MSG, PROTOCOL_VERSION, OTHER_SIDE, decode, encode, normalizeRoomCode,
} from '../src/net/protocol.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

// Where the room table is kept between runs. Beside the server, because that
// is where the one process that owns it lives; overridable with WOM_STATE for
// a deployment that mounts its writable directory somewhere else.
const DEFAULT_STATE_PATH = process.env.WOM_STATE || resolve(HERE, 'rooms.json');

// Housekeeping only. This interval reaps empty rooms; it is NOT a simulation
// tick and there is deliberately no such thing on this server (spec 7.1).
const REAP_INTERVAL_MS = 60 * 1000;

// THE HEARTBEAT, and why a server that relays nothing still needs one.
//
// Presence was learned from the socket's `close` event alone, which only fires
// on an ORDERLY shutdown: the tab closed, the page navigated away. A laptop
// that sleeps, a phone that backgrounds Safari and a wifi drop all send no FIN
// at all, so the socket sat there open and the seat stayed occupied by nobody.
// TCP's own keepalive would have noticed eventually — the default on macOS is
// two hours.
//
// What that cost was not theoretical. The other player's client goes on
// believing a peer is there, which suppresses nothing it should and refuses
// things it should not: the pilot's debug world jump refuses to move while a
// Mario is in the room, so a Mario who had silently vanished locked the pilot
// into one archipelago for the rest of the session. The lobby also showed the
// seat as `here` when it should read `away`.
//
// A ping every 10 seconds, and a socket that has not ponged since the last one
// is terminated — which raises `close`, which relays PEER present:false down
// the one path that already exists. Detection therefore takes between 10 and 20
// seconds. Browsers answer a protocol-level ping from inside the WebSocket
// stack without waking the page's JavaScript, so this measures the CONNECTION
// and not whether a tab is busy.
const HEARTBEAT_MS = 10 * 1000;

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
  const log = opts.log || console;

  // PERSISTENCE, and the rule for when it is on.
  //
  // A caller that brings its own Rooms is saying it owns the room table — that
  // is every test in this repo, and a test must not write a file into the
  // working tree or inherit rooms from the last run. So: a supplied `rooms`
  // means no persistence unless a path is asked for explicitly, and `statePath:
  // null` turns it off outright. `npm run serve`, which supplies neither, gets
  // the default file and the whole point of this.
  const statePath = opts.statePath !== undefined
    ? opts.statePath
    : (opts.rooms ? null : DEFAULT_STATE_PATH);
  const rooms = opts.rooms || loadState(statePath, { now: Date.now(), log });
  const saver = createSaver({ path: statePath, rooms, log });
  // On by default: this exists so a LAN player can see the room the other one
  // just made. `{ lobby: false }` is the whole of the off switch.
  const lobbyEnabled = opts.lobby !== false;

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
    // GET /rooms lists what is joinable right now. A GET, unlike the mint
    // above: this one creates nothing, so a prefetch of it costs a JSON blob
    // and nothing else.
    //
    // Deliberately cheap and deliberately uncached: rooms appear and fill on
    // the timescale of someone walking to another laptop, and a cached lobby
    // is a lobby that lies. Everything it can say about a room is in
    // Room.summary — no seed, no tokens, no damage.
    if (req.method === 'GET' && (req.url === '/rooms' || req.url.startsWith('/rooms?'))) {
      if (!lobbyEnabled) {
        // The single choke point for "should this deployment show its rooms
        // to anyone who asks". See the exposure note in the report: on a LAN
        // the whole point is that they are visible; on a public host this is
        // where a gate would go, and until one exists a deployment can simply
        // start the server with { lobby: false } and the header quietly falls
        // back to listing nothing.
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      }).end(JSON.stringify({ rooms: rooms.list(Date.now()) }));
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

  // token -> the socket that currently holds that seat.
  //
  // A reload is two sockets for one seat, and their order is not guaranteed:
  // the new page's hello can land before the old page's close does. Without
  // this, the old socket's close would then mark a seat that a LIVE page is
  // sitting in as absent and tell the peer that player had left — the reconnect
  // would succeed and immediately be undone by the ghost of the tab it
  // replaced. Only the socket that still holds the seat may vacate it.
  //
  // Bounded by the number of open sockets: the holder deletes its own entry on
  // close, and a superseded socket has none to delete.
  const holders = new Map();

  wss.on('connection', (ws) => {
    // Answered a ping since the last sweep. Set true here rather than on the
    // first pong, or a socket that connects between two sweeps is terminated
    // before it has ever been asked.
    ws.__alive = true;
    ws.on('pong', () => { ws.__alive = true; });

    // Per-socket state. `seat` is null until a valid hello arrives; nothing
    // else is accepted before then.
    let room = null;
    let seat = null;

    // islandId -> the server hash this socket has already been repaired to.
    // The destroyed-set is the server's (decision D2), so a client that
    // disagrees is simply wrong and gets told what the truth is before it is
    // accused of anything. Keyed on the SERVER's hash rather than a bare flag
    // so a second, later divergence on the same island is repaired too, and
    // only a client that is still wrong AFTER being handed the authoritative
    // set for that exact state counts as a desync.
    const repairedTo = new Map();

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
        // This socket is now the one that speaks for this seat. On a reconnect
        // that displaces whichever socket held it before.
        holders.set(res.token, ws);

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
            // `rec.keys`, not `rec.added`: a resent detonate adds nothing but
            // is still responsible for the same crater, and broadcasting the
            // empty add-list settled the pilot's outbox without delivering a
            // single key. See Room.recordDetonate.
            const dmg = { t: MSG.DAMAGE, island: msg.d.island, keys: rec.keys, seq: msg.seq };
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
          // Real time, and the only place the desync detector uses it: a
          // client is allowed to be one broadcast behind, and how long that
          // is is a question about the wire, not about ticks. See
          // Room.compareHashes and HASH_GRACE_MS.
          const bad = room.compareHashes(msg.h, Date.now());
          for (const m of bad) {
            // REPAIR BEFORE ALARM. The authoritative DAMAGE broadcast is a
            // one-shot: nothing acks it and nothing resends it, so a single
            // dropped frame used to leave a client permanently short a crater
            // with no mechanism anywhere that could put it back. This is that
            // mechanism, and it costs no new timer or message type — the
            // client already tells us its hashes once a second, and a
            // mismatch that has outlived the grace window is precisely a
            // client that has lost something.
            //
            // Idempotent (the client's set is append-only, so re-applying the
            // whole island is a no-op when it is already right) and
            // self-healing (a repair frame that is itself dropped is simply
            // sent again on the next hash a second later). No geometry on it:
            // a repair must never re-run a blast that already killed someone.
            if (repairedTo.get(m.island) !== m.server) {
              repairedTo.set(m.island, m.server);
              log.warn(
                `[REPAIR] room=${room.code} side=${seat.side} island=${m.island} ` +
                  `client=${m.client == null ? 'not-mentioned' : m.client} -> server=${m.server} ` +
                  `(${m.n} keys)`
              );
              send(ws, { t: MSG.DAMAGE, island: m.island, keys: room.damage.keys(m.island) });
              continue;
            }
            // Still disagreeing after being handed this exact state. That is
            // not a client that is behind, it is a client holding something
            // the server's set cannot account for — a real desync.
            //
            // Loudly, in real play — spec 8.4. This is the whole point of the
            // detector: it must be impossible to miss in a server log. The
            // count and the sample are what makes it worth reading: a client
            // that is short one crater and a client that is short a hundred
            // are different bugs.
            log.error(
              `[DESYNC] room=${room.code} side=${seat.side} island=${m.island} ` +
                `server=${m.server} client=${m.client == null ? 'not-mentioned' : m.client} ` +
                `serverKeys=${m.n} sample=${m.sample.join(' ')}`
            );
            send(ws, {
              t: MSG.DESYNC,
              island: m.island,
              server: m.server,
              client: m.client,
              n: m.n,
              sample: m.sample,
            });
          }
          return;
        }

        default:
          return fail(ws, `server does not accept ${msg.t}`);
      }
    });

    ws.on('close', () => {
      if (!room || !seat) return;
      // Superseded: a newer socket already reconnected into this seat and is
      // sitting in it. This close is the old page going away, and it says
      // nothing about whether the player is here.
      if (holders.get(seat.token) !== ws) return;
      holders.delete(seat.token);
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

  // The heartbeat. terminate() rather than close(): a socket whose far end is
  // a sleeping laptop will never complete a closing handshake, and close()
  // would wait for one that is not coming. terminate() raises `close`
  // immediately, which is the path that already vacates the seat and tells the
  // peer — so nothing below this line knows the difference between a player who
  // shut the tab and one whose wifi died.
  // Overridable so a test can run the sweep in milliseconds instead of waiting
  // out two ten-second windows. Nothing else has any business changing it.
  const heartbeatMs = opts.heartbeatMs || HEARTBEAT_MS;
  const heart = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.__alive) {
        if (ws.__side) log.info(`[room ${ws.__room ? ws.__room.code : '????'}] ${ws.__side} stopped answering`);
        ws.terminate();
        continue;
      }
      ws.__alive = false;
      try {
        ws.ping();
      } catch (e) {
        ws.terminate();
      }
    }
  }, heartbeatMs);
  if (heart.unref) heart.unref();

  const port = opts.port != null ? opts.port : Number(process.env.PORT) || 8090;
  await new Promise((done) => http.listen(port, done));

  return {
    http,
    wss,
    rooms,
    statePath,
    // So a test can force the file to be current without waiting two seconds.
    save: () => saver.flush(),
    port: http.address().port,
    async close() {
      // Before the sockets go, not after: an orderly shutdown should lose
      // nothing at all.
      saver.stop();
      clearInterval(reaper);
      clearInterval(heart);
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise((done) => http.close(done));
    },
  };
}

// Started directly rather than imported: `npm run serve`, and the Docker image.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startServer().then((s) => {
    console.log(`wings-of-mario listening on :${s.port} (rooms in ${s.statePath})`);
    // Ctrl-C is how this server is stopped in a playtest, and it is the exact
    // moment the room table is most worth keeping. Without this the saver's
    // two-second tick is the window; with it there is none. Registered only on
    // the directly-started server, so nothing in a test suite installs a
    // process-wide handler.
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.on(sig, () => {
        s.close().then(() => process.exit(0), () => process.exit(1));
      });
    }
  });
}
