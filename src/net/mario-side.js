import { Transport } from './transport.js';
import { Session } from './session.js';
import { Interp } from './interp.js';
import { NetOverlay } from './mario-overlay.js';
import { roomFromLocation, wsUrl, mintRoom, showRoom, banner } from './lobby.js';
import { ISLAND_TOP_Y } from '../wings/geo.js';
import { layoutArchipelago } from '../wings/archipelago.js';

// Mario's half of the match. Like src/wings/debug-panel.js, this file talks to
// the game ONLY through window.__GAME and builds any DOM it needs itself, so
// src/main.js is not touched and index.html gains nothing at all.
//
// See the coordinate contract in pilot-side.js. This is the same conversion run
// the other way: the pilot's snapshot arrives in WORLD pixels and has to be put
// into the level-local frame Mario's camera lives in.

export class MarioNet {
  constructor(opts = {}) {
    this.game = opts.game || (typeof window !== 'undefined' ? window.__GAME : null);
    this.session = null;
    this.transport = null;
    this.seed = null;
    this.pilotInterp = new Interp({ snap: ['mode', 'gear', 'status', 'squadron'] });
    this.overlay = new NetOverlay(opts.doc || document);
    this.remote = null;
    this.desyncs = [];
    // Our own counter. The engine's loop tick is Mario's; this one paces the
    // snapshot stream, and starting it at zero on every connect is what the
    // peer's Interp reads as "he reloaded".
    this.tick = 0;
    this._layout = null;
  }

  // Which island Mario is on. The engine calls it a level id; the network calls
  // it an island id; they are the same string.
  islandId() {
    if (!this.game || !this.game.stats) return null;
    const stats = this.game.stats();
    return stats.level || null;
  }

  // Where that island's left edge is in the pilot's world, from the MATCH SEED.
  //
  // NOT a fixed-spacing layout: archipelago.js puts seeded ocean between the
  // islands, so computing spacing independently here would agree with the pilot
  // about island one and about nothing after it.
  originOf(id) {
    if (!id || this.seed == null) return null;
    const world = Number(String(id).split('-')[0]);
    if (!Number.isFinite(world)) return null;
    if (!this._layout || this._layout.world !== world) {
      try {
        this._layout = { world, slots: layoutArchipelago(world, this.seed) };
      } catch {
        // A level in no world of the archipelago — Harry's painted sequence,
        // say. There is no island for the pilot to see him on.
        this._layout = { world, slots: [] };
      }
    }
    const slot = this._layout.slots.find((s) => s.id === id);
    return slot ? slot.x : null;
  }

  async connect({ room, side = 'mario', location = window.location } = {}) {
    this.transport = new Transport(wsUrl(location), {});
    this.session = new Session({ transport: this.transport, room, side });

    this.session.on('snapshot', (m) => {
      if (m.side === 'mario') return;
      this.pilotInterp.push(m.tick, m.s);
    });
    this.session.on('peer', (m) => {
      if (!m.present) {
        this.pilotInterp.clear();
        this.remote = null;
        this.overlay.set(null);
        this.overlay.draw();
      }
    });
    this.session.on('desync', (m) => {
      this.desyncs.push(m);
      console.error('[DESYNC]', m.island, 'server', m.server, 'client', m.client);
    });

    const welcome = await this.session.connect();
    this.seed = welcome.seed;
    this._layout = null;
    this.overlay.attach();
    return welcome;
  }

  pump() {
    if (!this.session || !this.session.connected) return;
    this.tick++;
    const world = this.game && this.game.world;
    const p = world && world.player;
    if (p) {
      this.session.sendSnapshot(this.tick, {
        island: this.islandId(),
        x: p.x, y: p.y, vx: p.vx, vy: p.vy,
        facing: p.facing, power: p.power, state: p.state,
        grounded: p.grounded ? 1 : 0, lives: world.lives,
      });
    }
    this.session.pump(this.tick);

    // The pilot's snapshot is in WORLD pixels. Convert into this island's local
    // frame, which is the frame Mario's camera lives in.
    const s = this.pilotInterp.sampleLocal(this.tick);
    const originX = this.originOf(this.islandId());
    if (!s || originX == null || !world) {
      this.remote = null;
    } else {
      // rcam is the RENDER camera — the sub-pixel-smoothed one the engine
      // actually draws with. Using world.cam instead makes the aeroplane
      // shimmer against a scrolling background by up to a pixel a frame.
      const cam = world.rcam || world.cam || { x: 0, y: 0 };
      this.remote = {
        x: s.x - originX,
        y: s.y - ISLAND_TOP_Y,
        angle: s.angle,
        camX: cam.x,
        camY: cam.y,
      };
    }
    this.overlay.set(this.remote);
    this.overlay.draw();
  }

  state() {
    return {
      connected: !!(this.session && this.session.connected),
      room: this.session ? this.session.room : null,
      side: this.session ? this.session.side : null,
      seed: this.seed,
      peer: this.session ? this.session.peerPresent : false,
      island: this.islandId(),
      remote: this.remote ? { ...this.remote } : null,
      desyncs: this.desyncs.length,
      stats: this.session ? this.session.stats() : null,
    };
  }
}

const net = new MarioNet();

// DO NOT TRUST SCRIPT ORDER on this page. src/game/world.js has a top-level
// await, so window.__GAME is not reliably assigned by the time this module body
// runs — mario-main.js carries the same warning, and the debug panel had a real
// intermittent "sometimes does not appear" bug before it polled. So: poll.
const POLL_MS = 30;

function waitForGame() {
  if (window.__GAME) return Promise.resolve(window.__GAME);
  return new Promise((resolve) => {
    const id = setInterval(() => {
      if (!window.__GAME) return;
      clearInterval(id);
      resolve(window.__GAME);
    }, POLL_MS);
  });
}

async function boot() {
  const game = await waitForGame();
  await game.ready;
  net.game = game;
  const { room, solo } = roomFromLocation(location.search);
  if (solo) {
    banner(document, 'SOLO');
    return null;
  }
  const code = room || (await mintRoom(location.origin));
  showRoom(window, code, 'mario');
  banner(document, `ROOM ${code} — MARIO`);
  const welcome = await net.connect({ room: code, side: 'mario', location });
  const say = (present) =>
    banner(document, `ROOM ${code} — MARIO — ${present ? 'PILOT IS UP' : 'WAITING FOR PILOT'}`);
  say(welcome.peer);
  net.session.on('peer', (m) => say(m.present));
  // rAF rather than the engine's loop: __GAME exposes no per-tick hook and
  // adding one would be an edit to src/main.js for no gain — the overlay is
  // presentation, and presentation runs at frame rate by definition. This is
  // the one place on Mario's side that real time enters, and nothing in the
  // agreed state of the match is computed from it.
  const frame = () => {
    try {
      net.pump();
    } catch (e) {
      console.error('[mario net]', e);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return welcome;
}

const ready = boot().catch((e) => {
  // A warning, not an error. The commonest cause by far is this page being
  // served by a plain static server with no room endpoint — the capture tool,
  // the older browser tests — and in that case falling back to one-player is
  // the correct behaviour, not a fault worth reddening a console over.
  console.warn('[mario net] offline:', e && e.message ? e.message : e);
  banner(document, 'OFFLINE');
  return null;
});

// A second global rather than a member of __GAME: __GAME is upstream-owned
// (ARCHITECTURE.md section 10) and tools/shot.mjs drives it. Adding to it would
// be an engine edit; adding beside it is not.
window.__NET = {
  ready,
  get session() { return net.session; },
  get transport() { return net.transport; },
  state: () => net.state(),
  remote: () => (net.remote ? { ...net.remote } : null),
  pump: () => net.pump(),
  latency: (ms) => (net.transport ? net.transport.latency(ms) : 0),
  drop: (pct) => (net.transport ? net.transport.drop(pct) : 0),
  disconnect: () => (net.transport ? net.transport.disconnect() : false),
  reconnect: () => (net.transport ? net.transport.reconnect() : false),
  desyncs: () => net.desyncs.map((d) => ({ ...d })),
};

export default net;
