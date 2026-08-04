import { Transport } from './transport.js';
import { Session } from './session.js';
import { Interp } from './interp.js';
import { NetOverlay } from './mario-overlay.js';
import { roomFromLocation, wsUrl, mintRoom, showRoom, banner, bootFailure } from './lobby.js';
import { ISLAND_TOP_Y } from '../wings/geo.js';
import { layoutArchipelago } from '../wings/archipelago.js';
import { DamageSync, applyToWorld } from './damage-sync.js';
import { noteDesync } from './desync.js';
import { MatchVerdict, MarioEvents, applyWire, mayEmitFrom } from './match-events.js';

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

    // Match bookkeeping. Each number is mirrored from whichever side owns it
    // and NEVER recomputed here: `lives` is ours, `squadron` is the pilot's.
    this.lives = null;
    this.squadron = null;
    this.verdict = new MatchVerdict();
    this.events = new MarioEvents();
    // This client's replica of the server's destroyed-tile map (decision D3).
    this.damage = new DamageSync();
    // The last blast that landed on the island Mario is standing on, for the
    // shadow marker and the whistle to hang off (spec 4.2, Plan 4).
    this.lastBlast = null;
    this.lastBombRelease = null;
    // Callbacks for whatever wants to draw the end of a match. Presentation,
    // not state: the verdict above is the state.
    this.onDeath = null;
    this.onCleared = null;
    this.onMatchOver = null;
    // Which level our retained craters have been pushed into, and how much
    // damage that level held when we did it. `world.damage` is CLEARED by
    // world.loadLevel on every load, sub-areas included, so a shrinking set is
    // how this side notices a level has been rebuilt under it.
    this._syncedLevel = null;
    this._syncedSize = 0;
    this._prevLoadLevel = null;
  }

  get matchStatus() {
    return this.verdict.status;
  }

  winner() {
    return this.verdict.winner();
  }

  // Every outgoing event goes through here, so ownership is checked before a
  // claim is made rather than after the server has refused it. The reducer runs
  // on our own events too: both clients feed the SAME function the SAME set of
  // events, which is what makes the two verdicts one verdict computed twice.
  emit(type, d = {}) {
    if (!this.session || !this.session.connected) return false;
    if (!mayEmitFrom(this.session.side, type)) {
      console.error('[mario net] refusing to claim', type, '- not ours to say');
      return false;
    }
    const before = this.verdict.status;
    applyWire(this.verdict, type, d);
    this.session.sendEvent(type, d);
    this._announce(before);
    return true;
  }

  _announce(before) {
    if (this.verdict.status === before || !this.verdict.over) return;
    if (this.onMatchOver) this.onMatchOver(this.verdict.winner(), this.verdict.facts());
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
    this.session.on('desync', (m) => this.onDesync(m));
    this.session.on('event', (m) => this.onPeerEvent(m));
    this.session.on('damage', (m) => this.onDamage(m));

    const welcome = await this.session.connect();
    this.seed = welcome.seed;
    this._layout = null;
    // Everything already destroyed in this match, from the welcome. Recorded,
    // not applied: the tiles of a level that is not loaded have nowhere to go,
    // and the engine subtracts them itself on the next load.
    for (const [island, keys] of Object.entries(welcome.damage || {})) {
      this.damage.record(island, keys);
    }
    // Installed on connect rather than at module load: __GAME is assigned by a
    // module with a top-level await and is not reliably there before this.
    this.installLevelHook();
    // Whatever level is already loaded gets its share at once, rather than
    // waiting for Mario to leave and come back.
    this._syncedLevel = null;
    this.syncLevelDamage();
    this.overlay.attach();
    return welcome;
  }

  // ---- the pilot's news ----------------------------------------------------

  // Read, never recomputed. The squadron is the pilot's number and the plane's
  // fate is the pilot's client's decision (spec 7.3); this side mirrors both.
  onPeerEvent(m) {
    const before = this.verdict.status;
    applyWire(this.verdict, m.type, m.d);
    if (m.type === 'planeLost') {
      this.squadron = m.d.squadron;
    } else if (m.type === 'sortieStart' || m.type === 'landed') {
      this.squadron = m.d.squadron;
    } else if (m.type === 'bombRelease') {
      // Telegraphing (spec 4.2) is Plan 4. Recorded so the whistle and the
      // shadow marker have something to hang off when it lands.
      this.lastBombRelease = m.d;
    }
    this._announce(before);
  }

  // THE HIT RESOLUTION, and the reason this method is on Mario's side of the
  // wire and not the pilot's.
  //
  // The pilot PROPOSED a detonation; the server recorded it and this is the
  // fact coming back. `keys` is authoritative and identical on both clients.
  // Whether it KILLED anything is decided here, on Mario's machine, against
  // Mario's own hitbox, his own power state and the engine's own star
  // exception — which is why the pilot's client never calls anything that can
  // kill Mario, and could not do so correctly if it tried.
  onDamage(m) {
    // The replica first, and unconditionally: it is a copy of the server's set,
    // not a record of what this client managed to draw (decision D1).
    this.damage.record(m.island, m.keys);

    const world = this.game && this.game.world;
    if (!world || !m.island || m.island !== this.islandId()) return;
    const originX = this.originOf(m.island);
    const live = originX != null
      && typeof m.cx === 'number' && typeof m.cy === 'number' && typeof m.r === 'number';

    if (live) {
      // Into the level-local frame Mario's engine works in.
      const cx = m.cx - originX;
      const cy = m.cy - ISLAND_TOP_Y;
      this.lastBlast = { island: m.island, cx, cy, r: m.r, tick: this.tick };
      // world.blast() = destroyTiles() + _blastKill(). The KILL is the half
      // that only a live detonation is allowed to run, and only on the client
      // that owns the thing being killed.
      world.blast(cx, cy, m.r);
    }
    // The server's key list is the fact, so it is applied whatever the local
    // radius arithmetic reached. SILENT — applyDamage, not destroyTiles or
    // blast — because a second pass over the same crater must not be a second
    // chance to kill anything standing in it.
    applyToWorld(world, m.keys);
  }

  // ---- the alarm -----------------------------------------------------------

  // The two sides count ticks in different places — Mario's is this class's own
  // rAF counter, the pilot's is the simulation's — so a desync record says when
  // it happened in this side's own terms rather than in a shared one that does
  // not exist.
  tickCount() {
    return this.tick;
  }

  onDesync(m) {
    noteDesync(this.desyncs, m, {
      keys: this.damage.keys(m.island),
      tick: this.tickCount(),
      doc: typeof document === 'undefined' ? null : document,
    });
  }

  // ---- craters made while Mario was somewhere else -------------------------

  // THE PRE-BOMBED ISLAND. The pilot can crater 1-2 an hour before Mario walks
  // into it, and that is the strategy the archipelago exists for — so damage
  // for an island he is not on must be RETAINED and applied when he arrives,
  // never dropped because no level was loaded to take it.
  //
  // The server holds the whole archipelago's map and Mario holds one level, so
  // arrival is the moment the rest of it becomes his. This takes over
  // Game#loadLevel to hand the craters in through the options bag the engine
  // already has for exactly this — `world.loadLevel` subtracts `opts.damage`
  // after the tile map is built and BEFORE the decor, the contents, the
  // landmarks, the player and the entities read it, so a bombed cloud stops
  // drawing and a bombed flagpole stands at the right height. Applying it a
  // frame later, as the safety net below has to, gets the tiles right and
  // leaves those snapshots stale.
  //
  // Taking over an instance method rather than editing one: the same technique
  // src/wings/match-host.js uses on world.onLevelComplete, and it touches no
  // file under src/game.
  installLevelHook() {
    const game = this.game && this.game.game;
    if (!game || typeof game.loadLevel !== 'function' || this._prevLoadLevel) return false;
    const prev = game.loadLevel.bind(game);
    this._prevLoadLevel = prev;
    game.loadLevel = (id, areaId = null, opts = {}) => {
      // Islands only, and never into a sub-area: a coin room is a different
      // tile map, and 1-1's craters punched into it would be holes in the
      // wrong wall.
      const keys = areaId == null ? this.damage.keys(id) : [];
      const merged = keys.length
        ? { ...opts, damage: [...(opts.damage || []), ...keys] }
        : opts;
      return prev(id, areaId, merged);
    };
    return true;
  }

  // The safety net, run once a frame. The hook above covers every load that
  // goes through the game object, but `world.damage` is cleared by EVERY
  // world.loadLevel — including paths that reach it directly — and a level that
  // came back without its craters is a level where Mario is standing on ground
  // the pilot destroyed and the two clients disagree about the map.
  syncLevelDamage() {
    const world = this.game && this.game.world;
    const island = this.islandId();
    if (!world || !world.damage || !island) return 0;
    const size = world.damage.size;
    if (island === this._syncedLevel && size >= this._syncedSize) {
      // Nothing was rebuilt; a live crater arriving only ever grows the set.
      this._syncedSize = size;
      return 0;
    }
    const missing = this.damage.keys(island).filter((k) => !world.damage.has(k));
    // SILENT — applyDamage, not destroyTiles and certainly not blast. These
    // craters were made minutes ago and somewhere else: replaying them must not
    // be a second chance to kill whatever is standing in them now, and a level
    // must not open with a hundred simultaneous explosions.
    if (missing.length) applyToWorld(world, missing);
    this._syncedLevel = island;
    this._syncedSize = world.damage.size;
    return missing.length;
  }

  // ---- our own news --------------------------------------------------------

  // Mario's client owns Mario, so it is the one that announces what happened to
  // him. Everything is edge-triggered off state the engine already maintains;
  // nothing new is simulated to produce an event.
  emitOwnEvents() {
    const world = this.game && this.game.world;
    const p = world && world.player;
    if (!p) return [];
    this.lives = world.lives;
    const out = this.events.step({
      island: this.islandId(),
      lives: world.lives,
      dying: p.state === 'dying' || !!p.dead,
      gameOver: world.state === 'gameover',
      x: p.x,
      y: p.y,
    });
    for (const e of out) {
      this.emit(e.type, e.d);
      if (e.type === 'marioDeath' && this.onDeath) this.onDeath(e.d);
      if (e.type === 'islandCleared' && this.onCleared) this.onCleared(e.d);
    }
    return out;
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
    this.emitOwnEvents();
    this.syncLevelDamage();
    this.session.pump(this.tick);

    // Spec 8.4: the detector runs in real play, not only under test. What is
    // hashed is THE REPLICA of the server's set, never world.damage. The
    // replica holds keys for islands Mario has not walked into and keys his
    // tile map could not place (decision D1), and world.damage holds neither —
    // so a hash taken off what this client managed to draw would differ from
    // the server's for reasons that are not desyncs, and an alarm that cries
    // wolf is worse than no alarm at all.
    this.session.maybeSendHash(this.tick, () => this.damage.hashes());

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
      lives: this.lives,
      squadron: this.squadron,
      matchStatus: this.matchStatus,
      winner: this.winner(),
      lastBlast: this.lastBlast ? { ...this.lastBlast } : null,
      desyncs: this.desyncs.length,
      stats: this.session ? this.session.stats() : null,
    };
  }
}

const net = new MarioNet();

// The room we were trying to join when a boot failed. Held out here because
// the catch below needs it to tell the player which code to hand the other
// player, and it is minted inside boot().
let joining = null;

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
  joining = code;
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
  // A warning, not an error, whichever cause this was. The commonest by far is
  // this page being served by a plain static server with no room endpoint — the
  // capture tool, the older browser tests — and in that case falling back to
  // one-player is the correct behaviour, not a fault worth reddening a console
  // over. The refusals the server can actually name say so on the banner
  // instead of hiding behind OFFLINE; see bootFailure.
  const fail = bootFailure(e, { room: joining, side: 'mario' });
  console.warn('[mario net] offline:', e && e.message ? e.message : e);
  banner(document, fail.text);
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
  winner: () => net.winner(),
  damage: (island) => net.damage.keys(island),
  latency: (ms) => (net.transport ? net.transport.latency(ms) : 0),
  drop: (pct) => (net.transport ? net.transport.drop(pct) : 0),
  disconnect: () => (net.transport ? net.transport.disconnect() : false),
  reconnect: () => (net.transport ? net.transport.reconnect() : false),
  desyncs: () => net.desyncs.map((d) => ({ ...d })),
  // Exactly what goes on the wire once a second. Two clients in the same match
  // must return deeply equal objects; that is the whole invariant.
  hashes: () => net.damage.hashes(),
};

export default net;
