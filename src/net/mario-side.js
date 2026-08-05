import { Transport } from './transport.js';
import { Session } from './session.js';
import { Interp } from './interp.js';
import { NetOverlay } from './mario-overlay.js';
import {
  roomFromLocation, wsUrl, mintRoom, showRoom, banner, bootFailure, lobbyHeader,
  rememberSeat, recallSeat, forgetSeat,
} from './lobby.js';
import { openFrontDoor } from './lobby-screen.js';
import { TILE } from '../core/constants.js';
import { ISLAND_TOP_Y } from '../wings/geo.js';
import { layoutArchipelago } from '../wings/archipelago.js';
import { GunRounds } from '../wings/gun-rounds.js';
import { DamageSync, applyToWorld, applyBuiltToWorld } from './damage-sync.js';
import { keepWatchingBuilds } from '../wings/bricks.js';
import { noteDesync } from './desync.js';
import { MatchVerdict, MarioEvents, applyWire, mayEmitFrom } from './match-events.js';
import { marioSnapshot, isReachable } from './reach.js';
import { guardWorld } from '../wings/sanctuary.js';

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
    // THE PILOT'S GUNFIRE, on our machine. The rounds are re-derived here from
    // the release on his snapshot, and whether one of them hits MARIO is
    // decided here too, against Mario's own hitbox — spec 7.3, the same rule
    // that keeps the bomb kill on this side of the wire. See
    // src/wings/gun-rounds.js. `_gunIsland` is which island the rounds in the
    // air belong to; a round is a position on one tile map and means nothing on
    // any other. `onGunHit` is presentation, wired up by mario-main.js.
    this.gun = new GunRounds({ solidAt: (x, y) => this.solidAt(x, y) });
    this._gunIsland = null;
    this.onGunHit = null;
    // Callbacks for whatever wants to draw the end of a match. Presentation,
    // not state: the verdict above is the state.
    this.onDeath = null;
    this.onCleared = null;
    this.onMatchOver = null;
    // THE SAIL. Fired when this client declares a world cleared and the
    // carrier group is therefore weighing anchor — not on 8-4, which is Mario
    // winning outright and not a crossing (see MarioEvents in match-events.js
    // for where `final` is decided). src/wings/mario-main.js hangs the fade off
    // it; this class does not know a screen exists.
    this.onSail = null;
    // THE SAME CROSSING, run because this client's own run RESTARTED somewhere
    // else rather than because a world was cleared. Fired from the same place
    // and on the same tick as the wire event the pilot's client obeys, so the
    // two fades come from one decision. Not fired once the match is decided:
    // then it ends, and a decided match does not put to sea.
    this.onReset = null;
    // Which level our retained craters have been pushed into, and how much
    // damage that level held when we did it. `world.damage` is CLEARED by
    // world.loadLevel on every load, sub-areas included, so a shrinking set is
    // how this side notices a level has been rebuilt under it.
    this._syncedLevel = null;
    this._syncedSize = 0;
    this._prevLoadLevel = null;
    // THE BRICK ROWS the toolbelt has laid, on their way to the server. The
    // watcher (src/wings/bricks.js) fills this from inside world.setTile, which
    // is mid-frame and mid-engine; the wire send happens on the next pump, so
    // one row of five is one event rather than five.
    this._pendingBuilds = [];
    // Which island's tile map we last pushed the built set back into, and the
    // tick we did it on. world.loadLevel rebuilds the map from the level data
    // and sets world.tick back to 0, so a reading that went BACKWARDS is a
    // rebuild and the bridge has to be laid again. See syncLevelBuilds.
    this._builtLevel = null;
    this._builtTick = null;
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

  // `token` is the seat we already hold, if this page has been here before. The
  // server puts a token back in its own seat and ignores one it does not know,
  // so passing a stale one costs nothing and passing none is a fresh join.
  async connect({ room, side = 'mario', token = null, location = window.location } = {}) {
    this.transport = new Transport(wsUrl(location), {});
    this.session = new Session({ transport: this.transport, room, side, token });

    this.session.on('snapshot', (m) => {
      if (m.side === 'mario') return;
      this.pilotInterp.push(m.tick, m.s);
    });
    this.session.on('peer', (m) => {
      if (!m.present) {
        this.pilotInterp.clear();
        // Rounds outlive the aeroplane that fired them by up to 45 ticks, but
        // not the pilot leaving the room: nobody is left to have fired them.
        this.gun.clear();
        this.remote = null;
        this.overlay.set(null);
        this.overlay.draw();
      }
    });
    this.session.on('desync', (m) => this.onDesync(m));
    this.session.on('event', (m) => this.onPeerEvent(m));
    this.session.on('damage', (m) => this.onDamage(m));
    this.session.on('built', (m) => this.onBuilt(m));

    const welcome = await this.session.connect();
    this.seed = welcome.seed;
    this._layout = null;
    // Everything already destroyed in this match, from the welcome. Recorded,
    // not applied: the tiles of a level that is not loaded have nowhere to go,
    // and the engine subtracts them itself on the next load.
    for (const [island, keys] of Object.entries(welcome.damage || {})) {
      this.damage.record(island, keys);
    }
    // And every brick already laid in this match. AFTER the damage, so that a
    // key the server holds in both — which it never should, but a welcome is
    // two independent maps on the wire — ends up built, matching the server's
    // own resolution order in Room#recordBuild.
    for (const [island, keys] of Object.entries(welcome.built || {})) {
      this.damage.recordBuilt(island, keys);
    }
    // Installed on connect rather than at module load: __GAME is assigned by a
    // module with a top-level await and is not reliably there before this.
    this.installLevelHook();
    this.installSanctuaryGuard();
    this.installBrickWatch();
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
    // A BOMB CANNOT REACH DOWN A PIPE. The engine keeps `levelId` at '1-1' for
    // the whole of 1-1 including its sub-areas, so islandId() says '1-1' while
    // Mario is standing in the underground coin room or a warp zone — and the
    // key '40,9' means one tile on the surface and an entirely different tile
    // down there. Applying the surface's craters to a sub-area's tile map ate
    // blocks nothing was ever dropped on.
    //
    // Same test the snapshot uses to decide he has no position the pilot can
    // draw (src/net/reach.js): if the aeroplane cannot fly to it, its bombs
    // cannot land in it. The craters are not lost — the server holds them, and
    // syncLevelDamage puts them back the moment he climbs out.
    if (!isReachable(world)) return;
    const originX = this.originOf(m.island);
    // `m.replay` marks a crater this client has already applied once, arriving
    // again because the pilot resent the detonate it proposed it with. The
    // keys below are re-applied regardless — that is a no-op on an append-only
    // set — but the blast is NOT re-run: the kill is the half that must happen
    // exactly once per bomb.
    const live = originX != null && !m.replay
      && typeof m.cx === 'number' && typeof m.cy === 'number' && typeof m.r === 'number';

    // Idempotent, and repeated here because `connect()` runs before __GAME is
    // guaranteed to have a world: a live blast that arrived through an
    // unguarded destroyTiles would crater the spawn floor on this client and
    // on no other, which is a divergence nothing detects.
    this.installSanctuaryGuard();

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

  // THE SANCTUARY on this side. The server never sends a protected key, so this
  // is not about the wire: it is about `world.blast()`, which Mario's client
  // runs itself for a live detonation and which computes its own key list from
  // the blast centre. Wrapping the world instance's destroyTiles() — never
  // editing src/game/world.js — puts the shared predicate in front of every
  // path the engine has to remove a tile. See src/wings/sanctuary.js.
  installSanctuaryGuard() {
    return guardWorld(this.game && this.game.world);
  }

  // THE BRICK ROWS, on this side. Mario's toolbelt lays five bricks by writing
  // to world.setTile, and the pilot's island — static level data plus two key
  // sets — cannot possibly know that happened. So this client watches its own
  // tile map and announces what it built, exactly as the pilot's client
  // proposes his craters and never Mario's.
  //
  // Wrapped on the world INSTANCE (src/wings/bricks.js), like the sanctuary
  // guard above and for the same reason: no file under src/game/ is edited.
  // Idempotent, and called from the pump as well as from connect(), because
  // __GAME's world is not guaranteed to exist at connect time.
  installBrickWatch() {
    return keepWatchingBuilds(this.game && this.game.world, (key) => this.onLocalBuild(key));
  }

  // A tile just turned solid on this client. Called from inside setTile, so it
  // does the least possible: decide whether it is news, and queue it.
  onLocalBuild(key) {
    const world = this.game && this.game.world;
    const island = this.islandId();
    if (!world || !island) return;
    // A BRICK CANNOT BE LAID DOWN A PIPE, in the sense that matters here: the
    // key '40,9' names one tile on 1-1's surface and an entirely different one
    // in its coin room, so announcing a sub-area's tile would put a brick in
    // the wrong wall on the pilot's island. Same signal, same reason as
    // onDamage and syncLevelDamage (src/net/reach.js).
    if (!isReachable(world)) return;
    // Already ours: either the server has confirmed this brick, or this is
    // syncLevelBuilds laying it back down after a level reload. Announcing it
    // again would be a second event for one brick.
    if (this.damage.hasBuilt(island, key)) return;
    if (this._pendingBuilds.includes(key)) return;
    this._pendingBuilds.push(key);
  }

  // One event per pump rather than one per brick: a row is five setTile calls
  // inside a handful of frames, and the server answers each event with a
  // broadcast to both clients.
  flushBuilds() {
    if (!this._pendingBuilds.length) return 0;
    const island = this.islandId();
    if (!island || !this.session || !this.session.connected) {
      // Not connected, or nowhere to put them. Dropped rather than held: the
      // server is the authority on what is built (D2), and a queue that
      // survived a disconnect would announce a level's worth of bricks as
      // brand new after a reconnect that already carried them in the welcome.
      this._pendingBuilds.length = 0;
      return 0;
    }
    const keys = this._pendingBuilds.slice();
    this._pendingBuilds.length = 0;
    return this.emit('build', { island, keys }) ? keys.length : 0;
  }

  // The authoritative brick row coming back — ours included, so every client's
  // built set is written by exactly one code path (D2). Applied to the tile map
  // as well as recorded: on THIS client the tiles are usually already there
  // (we laid them), and re-writing the same character over the same tile is a
  // no-op, but a brick the server holds and this map lost to a reload is not.
  onBuilt(m) {
    this.damage.recordBuilt(m.island, m.keys);
    const world = this.game && this.game.world;
    if (!world || !m.island || m.island !== this.islandId()) return;
    if (!isReachable(world)) return;
    applyBuiltToWorld(world, m.keys);
  }

  // The bridge, put back after the tile map was rebuilt under it. The mirror of
  // syncLevelDamage, and it has to exist for the same reason: every
  // world.loadLevel rebuilds the map from the level data, so a Mario who died
  // and respawned would walk up to a chasm his bridge had vanished from while
  // the pilot could still see it.
  //
  // ONLY ON A REBUILD, never every frame. Mario can bump a brick out of his own
  // bridge from below — it is a real brick — and a per-frame restore would put
  // it straight back, which is a worse bug than the one this fixes. The
  // rebuild is detected by world.tick going backwards (world.loadLevel sets it
  // to 0) or by the island changing under us.
  syncLevelBuilds() {
    const world = this.game && this.game.world;
    const island = this.islandId();
    if (!world || !island) return 0;
    if (!isReachable(world)) return 0;
    const tick = world.tick | 0;
    const rebuilt = island !== this._builtLevel
      || this._builtTick == null || tick < this._builtTick;
    this._builtTick = tick;
    if (!rebuilt) return 0;
    this._builtLevel = island;
    const keys = this.damage.builtKeys(island);
    return keys.length ? applyBuiltToWorld(world, keys) : 0;
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
    // Not into a sub-area — see onDamage for why. The guard is BEFORE the
    // bookkeeping below so that going down a pipe leaves `_syncedLevel` and
    // `_syncedSize` describing the surface, which is what makes climbing back
    // out re-apply the whole set: the sub-area's load emptied world.damage, so
    // the size test fails and every key is missing again.
    if (!isReachable(world)) return 0;
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

  // ---- the pilot's guns ----------------------------------------------------

  // Is this island-local pixel blocking? The LIVE tile map, so a crater the
  // pilot already made is a hole his own tracer flies through — exactly as
  // MarioOverlay#surfaceAt reads it for the telegraph reticle.
  // OFF THE MAP IS NOT TERRAIN. world.recAt answers EDGE_REC — solid — for any
  // column outside the level, which is right for a man who must not walk out of
  // the world and wrong for a bullet: the pilot's Island is bounded, his sim
  // lets a round fly over open sea, and an invisible wall here would stop every
  // round fired from beyond the island's edge on THIS screen and no other. A
  // round approaching from off-island is exactly how a strafing run starts.
  solidAt(x, y) {
    const w = this.game && this.game.world;
    if (!w || !w.level || typeof w.tileAtPixel !== 'function') return false;
    if (y < 0 || x < 0 || x >= w.w * TILE) return false;
    const rec = w.tileAtPixel(x, y);
    return !!(rec && (rec.solid || rec.platform));
  }

  // A sampled pilot snapshot may carry a gun round's release, in WORLD pixels.
  // Convert into the island-local frame Mario's engine works in — the same
  // conversion `remote` gets, and the same reason it cannot be skipped — and
  // hand it to the round list, which dedupes the repeats.
  //
  // Fed from the network pump (rAF) because that is when we LEARN of a round;
  // STEPPED from the engine's fixed clock because that is when it moves and
  // when it can hit somebody. Learning about it a frame early or late changes
  // where the tracer is drawn and nothing else.
  feedGun(s, originX) {
    const world = this.game && this.game.world;
    const island = this.islandId();
    if (!world || !island || originX == null) return null;
    // Down a pipe or in a coin room there is no aeroplane overhead and no
    // shared tile map to be shot on: the same boundary reach.js draws for the
    // snapshot, drawn once more for the thing that could hurt him. Rounds
    // already in the air are dropped rather than held, because he will come
    // back up somewhere else and three quarters of a second will have passed.
    if (!isReachable(world)) {
      this.gun.clear();
      return null;
    }
    // A different island is a different tile map; a round's coordinates mean
    // nothing on it.
    if (island !== this._gunIsland) {
      this.gun.clear();
      this._gunIsland = island;
    }
    const g = s && s.g;
    if (!g) return null;
    return this.gun.feed({
      t: g.t,
      owner: g.owner,
      x: g.x - originX,
      y: g.y - ISLAND_TOP_Y,
      vx: g.vx,
      vy: g.vy,
    });
  }

  // One fixed 60.0988Hz step of the rounds in the air, and THE HIT: called from
  // MarioOverlay's hook list, which is the engine's own timestep. Nothing about
  // how far a bullet travels between hit tests may depend on the frame rate.
  stepGun(world) {
    const w = world || (this.game && this.game.world);
    const p = w && w.player;
    if (!p || !w.level) {
      this.gun.clear();
      return [];
    }
    if (!isReachable(w) || this.islandId() !== this._gunIsland) {
      this.gun.clear();
      return [];
    }
    const hits = this.gun.step(p);
    for (const h of hits) if (this.onGunHit) this.onGunHit(h, p);
    return hits;
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
      // The group sails. Announced from HERE — the same place, on the same
      // tick, as the wire event the pilot's client obeys — so the two fades
      // start from one decision rather than from two clients each noticing
      // something. `final` is 8-4: the match is over, nothing sails.
      if (e.type === 'worldCleared' && !e.d.final && this.onSail) this.onSail(e.d);
      // The group repositioning behind a restarted run. Announced from the same
      // place as the wire event for the same reason as the sail above — one
      // decision, two screens — and refused once the match has a winner. The
      // death that ends the match is emitted strictly BEFORE this (it leaves at
      // the start of the death animation, seconds before the engine reloads),
      // so `over` is already latched here and on the pilot's client alike.
      if (e.type === 'worldReset' && !this.verdict.over && this.onReset) this.onReset(e.d);
    }
    return out;
  }

  pump() {
    if (!this.session || !this.session.connected) return;
    this.tick++;
    const world = this.game && this.game.world;
    // Mario's client owns Mario, so it is this side that says whether he is
    // somewhere the aeroplane could reach — down a pipe, in a coin room or in
    // a warp zone, he goes out of the snapshot's position entirely rather than
    // being projected into a place on the island he is not standing on. See
    // src/net/reach.js for the signal and why the decision lives here.
    const snap = marioSnapshot(world, this.islandId());
    if (snap) this.session.sendSnapshot(this.tick, snap);
    this.emitOwnEvents();
    this.syncLevelDamage();
    // The watch has to be re-pointed at a world this class may only now have
    // got hold of, and the bridge has to go back into a map a reload rebuilt —
    // both before anything this frame laid is flushed, so a brick restored by
    // syncLevelBuilds is recognised as one we already own rather than
    // announced a second time.
    this.installBrickWatch();
    this.syncLevelBuilds();
    this.flushBuilds();
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
    // rcam is the RENDER camera — the sub-pixel-smoothed one the engine
    // actually draws with. Using world.cam instead makes the aeroplane
    // shimmer against a scrolling background by up to a pixel a frame.
    const cam = (world && (world.rcam || world.cam)) || { x: 0, y: 0 };
    if (!s || originX == null || !world) {
      this.remote = null;
    } else {
      this.remote = {
        x: s.x - originX,
        y: s.y - ISLAND_TOP_Y,
        angle: s.angle,
        camX: cam.x,
        camY: cam.y,
      };
    }
    // Any round on that snapshot, before the overlay is told what to draw.
    this.feedGun(s, originX);
    this.overlay.set(this.remote);
    this.overlay.setRounds(this.gun.rounds, this.gun.sparks, cam);
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
      gunRounds: this.gun.rounds.length,
      gunHits: this.gun.hits,
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
  // THE FRONT DOOR, and the reason this page no longer mints a room the
  // instant it loads. Somebody who just typed the server's address has not
  // chosen anything yet; minting for them is what made the room code a thing
  // you had to read out loud. Every button on that screen navigates to a URL
  // this page already understood, so if it goes up we are done here — the next
  // load of this file is the one that joins something.
  //
  // It returns null, and we fall straight through to the old behaviour, for
  // every case where there is nothing to choose from: a `?room=` in the URL, a
  // `?solo`, a page served with no /rooms endpoint at all.
  if (!room && (await openFrontDoor({ doc: document, win: window }))) return null;
  // Started here, before the room is minted, and told to read `joining` each
  // time so our own room drops out of the list the moment we have one. It
  // never throws and is never awaited: the match must not wait on the lobby.
  lobbyHeader({ doc: document, win: window, here: () => joining });
  const code = room || (await mintRoom(location.origin));
  joining = code;
  showRoom(window, code, 'mario');
  // A page that already holds this seat says so while it asks for it back. The
  // one thing that must never be on screen during a reconnect is SEAT TAKEN.
  const held = recallSeat(window, code, 'mario');
  banner(document, held ? `ROOM ${code} — MARIO — RECONNECTING` : `ROOM ${code} — MARIO`);
  const welcome = await net.connect({ room: code, side: 'mario', token: held, location });
  // From the welcome, not from `held`: a stale token is answered with a FRESH
  // seat and a fresh token, and storing the one we asked with would leave the
  // tab holding a token for a seat it no longer has.
  rememberSeat(window, code, 'mario', welcome.token);
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
  // A refusal the SERVER named is proof the token we presented is not in that
  // seat: a token it recognises is always let in. Dropping it here is what
  // stops a tab that lost its seat from re-presenting a dead token on every
  // future reload. A refusal it did not name — no server, no endpoint, a socket
  // that never opened — keeps the token, because that server may yet come back
  // still holding the seat.
  if (fail.diagnosed) forgetSeat(window, joining, 'mario');
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
  // Exactly what the next snapshot would put on the wire, reachability flag
  // and all. Built fresh rather than remembered: pump() builds its own from
  // the same function, so there is only ever one answer to this question.
  snapshot: () => marioSnapshot(net.game && net.game.world, net.islandId()),
  pump: () => net.pump(),
  winner: () => net.winner(),
  // The pilot's rounds as this client has them: what is in the air, and how
  // many have connected. `stepGun` advances them one fixed tick by hand, for a
  // test that drives the page rather than watching it.
  gun: () => ({
    hits: net.gun.hits,
    rounds: net.gun.rounds.map((r) => ({ ...r })),
    sparks: net.gun.sparks.map((k) => ({ ...k })),
  }),
  stepGun: () => net.stepGun().length,
  damage: (island) => net.damage.keys(island),
  // The other half of this client's terrain delta: the bricks the toolbelt has
  // laid. The pilot's client answers the same question about the same island
  // with the same list, which is the whole invariant of the feature.
  built: (island) => net.damage.builtKeys(island),
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
