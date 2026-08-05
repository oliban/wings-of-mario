import { Transport } from './transport.js';
import { Session } from './session.js';
import { Interp } from './interp.js';
import {
  roomFromLocation, wsUrl, mintRoom, showRoom, banner, bootFailure, lobbyHeader,
  rememberSeat, recallSeat, forgetSeat,
} from './lobby.js';
import pilot from '../wings/pilot-main.js';
import { DamageSync, applyToIsland, applyBuiltToIsland } from './damage-sync.js';
import { noteDesync } from './desync.js';
import {
  MatchVerdict, pilotWireEvent, applyWire, mayEmitFrom, repositionWorld,
} from './match-events.js';
import { contactFrom, REACH_SNAP } from './reach.js';
import { worldOfIsland } from '../wings/sail.js';
import { peerLive } from './presence.js';

// The pilot's half of the match. It reaches into the game only through the
// `pilot` instance that pilot-main.js already exports, exactly as
// debug-panel.js reaches into Mario only through window.__GAME.
//
// THE COORDINATE CONTRACT. Mario's engine works in level-local pixels: (0,0) is
// the top-left of his level. The pilot works in archipelago world pixels. The
// conversion is
//
//     world.x = island.originX + mario.x
//     world.y = ISLAND_TOP_Y   + mario.y
//
// and the whole task turns on both sides agreeing about originX. They agree
// because both derive it from the MATCH SEED in the server's welcome:
// archipelago.js lays the ocean out with seeded gaps, so a fixed-spacing layout
// computed independently on each side would put island 2 onward in different
// places on the two screens — the pilot bombing empty sea while Mario stands
// somewhere else entirely. The pilot's own sim IS that layout, so this file
// reads the origins straight off it rather than recomputing them.
//
// The conversion itself is src/net/reach.js#contactFrom, which is also where
// it refuses to run: the contract holds for the island's own tile map and for
// nothing else, so a Mario in a pipe, a coin room or a warp zone has no world
// position at all and is drawn nowhere.

export class PilotNet {
  constructor(opts = {}) {
    this.host = opts.pilot || pilot;
    this.session = null;
    this.transport = null;
    // Mario's discrete fields must never be interpolated into a blend.
    this.marioInterp = new Interp({
      // `grounded` is a 0/1 flag, not a quantity: blended across a jump it
      // would spend the whole arc at 0.5 and the contact would never leave the
      // walk cycle.
      snap: ['island', 'anim', 'facing', 'power', 'lives', 'state', 'grounded', ...REACH_SNAP],
    });
    this.remote = null;
    this.lastEvent = null;
    this.desyncs = [];
    this.tick = 0;
    // The tick a snapshot of Mario's last arrived on. Null means never.
    this.lastHeard = null;

    // Mario's numbers, mirrored from the client that owns them. The pilot's
    // client never decides that Mario died and never counts his lives.
    this.marioLives = null;
    this.marioIsland = null;
    this.verdict = new MatchVerdict();
    this.damage = new DamageSync();
    // Where we are up to in sim.events. A CURSOR, not a drain: scene.js reads
    // the same array with a cursor of its own (src/wings/scene.js consume()),
    // and emptying it here would take the explosion and splash effects with it.
    this._evCursor = 0;
    this.onMatchOver = null;
  }

  get squadron() {
    const sim = this.host.sim;
    return sim ? sim.squadron : null;
  }

  // Which archipelago this client is flying over. The invariant the sail has to
  // keep is that this and Mario's world number are the same on both screens.
  get world() {
    const sim = this.host.sim;
    return sim ? sim.archipelago.world : null;
  }

  get matchStatus() {
    return this.verdict.status;
  }

  // Is there really a Mario on the other end, or only a socket the server has
  // not yet noticed is dead? The rule and the reasoning are in
  // src/net/presence.js, which is pure so that it can be tested as one.
  peerLive() {
    return peerLive({
      peerPresent: !!(this.session && this.session.peerPresent),
      tick: this.tick,
      lastHeard: this.lastHeard,
    });
  }

  winner() {
    return this.verdict.winner();
  }

  // Every outgoing event goes through here, so a claim the pilot does not own
  // is never made. The reducer runs on our own events as well as the peer's:
  // both clients feed the SAME function the SAME set of events, which is what
  // makes the two verdicts one verdict computed twice.
  emit(type, d = {}) {
    if (!this.session || !this.session.connected) return false;
    if (!mayEmitFrom(this.session.side, type)) {
      console.error('[pilot net] refusing to claim', type, '- not ours to say');
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

  // Where an island's left edge is, in world pixels, according to the ocean
  // this client is actually flying over.
  originOf(id) {
    const sim = this.host.sim;
    if (!sim) return null;
    const isle = sim.islandById(id);
    return isle ? isle.originX : null;
  }

  // `token` is the seat we already hold, if this page has been here before.
  // See MarioNet.connect: the two sides do this identically.
  async connect({ room, side = 'pilot', token = null, location = window.location } = {}) {
    this.transport = new Transport(wsUrl(location), {});
    this.session = new Session({ transport: this.transport, room, side, token });

    this.session.on('snapshot', (m) => {
      if (m.side === 'pilot') return; // our own, echoed back: ignore
      this.marioInterp.push(m.tick, m.s);
      // When we last actually HEARD from him — see peerLive() below.
      this.lastHeard = this.tick;
    });
    this.session.on('peer', (m) => {
      // A peer that left has no position. Holding his last one would leave
      // Mario standing on an island for the rest of the match.
      if (!m.present) {
        this.marioInterp.clear();
        this.remote = null;
        this.host.scene.remoteMario = null;
      }
    });
    this.session.on('event', (m) => this.onPeerEvent(m));
    this.session.on('damage', (m) => this.onDamage(m));
    this.session.on('built', (m) => this.onBuilt(m));
    this.session.on('desync', (m) => this.onDesync(m));

    const welcome = await this.session.connect();
    this.seed = welcome.seed;
    for (const [island, keys] of Object.entries(welcome.damage || {})) {
      this.damage.record(island, keys);
    }
    // The bricks Mario has laid, in the same welcome and applied in the same
    // breath: a pilot joining an hour in has to be given the bridges as well as
    // the holes, or he flies over an island whose shape only Mario knows.
    // Recorded after the damage, matching Room#recordBuild's own order.
    for (const [island, keys] of Object.entries(welcome.built || {})) {
      this.damage.recordBuilt(island, keys);
    }
    // Rebuild the ocean on the match seed. Until this line the pilot is flying
    // over the default archipelago, which is a different one.
    this.host.reset({ seed: welcome.seed });
    // The ocean is new, so every crater in it is new too. Applied AFTER the
    // reset for that reason, and silently: an Island has no entities, so there
    // has never been anything for a replayed crater to kill.
    this.applyKnownDamage();
    // A fresh sim is a fresh event list; a stale cursor would skip its first
    // events or read past its end.
    this._evCursor = 0;
    this.host.render();
    return welcome;
  }

  applyKnownDamage() {
    const sim = this.host.sim;
    if (!sim) return 0;
    let n = 0;
    for (const island of this.damage.islands()) {
      const isle = sim.islandById(island);
      if (!isle) continue;
      applyToIsland(isle, this.damage.keys(island));
      n++;
    }
    // The brick rows, over the top of the craters — the same order the server
    // resolves the two sets in, so an island rebuilt from the match state ends
    // up in the state the match is actually in. The two sets are disjoint, so
    // the order cannot matter; doing it in the same order in all three places
    // is what makes that easy to keep true.
    for (const island of this.damage.builtIslands()) {
      const isle = sim.islandById(island);
      if (!isle) continue;
      applyBuiltToIsland(isle, this.damage.builtKeys(island));
      n++;
    }
    return n;
  }

  // ---- Mario's news --------------------------------------------------------

  // Mirrored, never recomputed. Whether that bomb killed Mario was decided on
  // MARIO'S machine against Mario's own hitbox (spec 7.3); all that arrives
  // here is the verdict, and the pilot's client has no business second-guessing
  // it — it does not even have Mario's level loaded.
  onPeerEvent(m) {
    this.lastEvent = m;
    const before = this.verdict.status;
    applyWire(this.verdict, m.type, m.d);
    if (m.type === 'marioDeath') {
      this.marioLives = m.d.lives;
      if (m.d.island) this.marioIsland = m.d.island;
    } else if (m.type === 'islandCleared') {
      this.marioIsland = m.d.next;
    } else if (m.type === 'ferryBoard') {
      // At sea between two islands: he is on no island at all until he lands.
      // The ferry is a later plan; the event is carried now so the torpedo has
      // something to sink when it arrives.
      this.marioIsland = null;
    } else if (m.type === 'worldCleared') {
      this.onWorldCleared(m.d || {});
    } else if (m.type === 'worldReset') {
      this.onWorldReset(m.d || {});
    }
    this._announce(before);
  }

  // THE SAIL, and the whole of this side's part in it: obey.
  //
  // Mario's client owns Mario, so it is the one that declares a world cleared
  // (spec 7.3, and EVENT_OWNER.worldCleared === 'mario'). This side never
  // infers it — there is nothing it could infer it FROM, since it does not
  // have Mario's level loaded and cannot see a flagpole.
  //
  // THE DESTINATION IS TAKEN FROM THE EVENT, not counted. `d.next` is the
  // island Mario has actually stepped onto, so a warp zone that puts him on
  // 4-1 out of 1-2 sails the group to world 4 and the two clients still lay out
  // the same ocean. Counting would put the pilot over world 2 with Mario in
  // world 4 — and the desync detector could not catch it, because it compares
  // destroyed-tile sets and two fresh oceans are both empty.
  //
  // `d.final` is 8-4: the match is over and there is no ninth archipelago, so
  // the group does not move. The verdict is applyWire's business, above.
  onWorldCleared(d) {
    this.marioIsland = d.next || null;
    if (d.final) return false;
    const to = worldOfIsland(d.next);
    if (to == null) return false;
    return this.host.sailTo(to);
  }

  // MARIO'S RUN RESTARTED SOMEWHERE ELSE, and this side's part in it is the
  // same as in a sail: obey. He spent his last life and the engine put him back
  // on 1-1, or the turn passed to a slot standing in another world. Either way
  // the ocean holds ONE world at a time and it has to be HIS, or every crater,
  // radar blip and desync hash after this moment is about an archipelago he is
  // not on. The detector cannot catch that divergence — it compares
  // destroyed-tile sets, and two oceans he has not bombed yet are both empty.
  //
  // Declared by Mario's client for the same reason worldCleared is (spec 7.3,
  // EVENT_OWNER.worldReset === 'mario'): only it can see which level the engine
  // actually loaded. This side never infers a restart, and could not — a man
  // who has stopped sending is a man on a slow connection.
  //
  // THE DESTINATION IS TAKEN FROM THE EVENT, exactly as the sail takes it, so
  // the two clients lay out the same ocean whatever route he took to it.
  //
  // IT MOVES EVEN WHEN THE MATCH IS DECIDED. This once refused to, on the
  // grounds that a finished match has nothing to reposition for — but spending
  // the last life is both the pilot winning AND the engine putting Mario back
  // on 1-1, so refusing there meant the group followed him almost never. See
  // repositionWorld, which holds the reasoning.
  onWorldReset(d) {
    this.marioIsland = d.next || null;
    const to = repositionWorld(d);
    if (to == null) return false;
    return this.host.repositionTo(to);
  }

  // The one tick the ocean is replaced, from src/wings/pilot-main.js. Mario is
  // between two levels and his last snapshot describes an island that no
  // longer exists; interpolating toward it would draw a contact over the new
  // world's water until his next packet arrives.
  onSailSwap() {
    this.marioInterp.clear();
    this.remote = null;
    this.host.scene.remoteMario = null;
    // A fresh sim keeps the same event array, so the cursor is still valid —
    // but every crater the server has told us about is re-applied, because the
    // Islands are new objects built from the archipelago and a DAMAGE that
    // arrived for a new-world island before the swap landed on nothing.
    this.applyKnownDamage();
    return true;
  }

  // The authoritative crater coming back — including for our OWN proposal, so
  // every client's set is written by exactly one code path. An Island holds
  // terrain and nothing else, so this is applyDamage and only applyDamage:
  // there is nobody standing on the pilot's copy of the ground to kill, and
  // killing on this client is Mario's client's job in any case.
  onDamage(m) {
    this.damage.record(m.island, m.keys);
    const sim = this.host.sim;
    if (!sim || !m.island) return;
    applyToIsland(sim.islandById(m.island), m.keys);
  }

  // THE BRIDGE. Mario's client laid it and announced it; this side obeys and
  // never infers — it has no Mario level, no toolbelt and no idea a brick bomb
  // exists (spec 7.3). Everything visible follows from Island#charAt reporting
  // the brick character for these keys: land.js paints it, the aeroplane
  // collides with it, and the ordnance takes it like any other brick.
  onBuilt(m) {
    this.damage.recordBuilt(m.island, m.keys);
    const sim = this.host.sim;
    if (!sim || !m.island) return;
    applyBuiltToIsland(sim.islandById(m.island), m.keys);
  }

  // ---- the alarm -----------------------------------------------------------

  // This side counts in simulation ticks, Mario's side in its own rAF counter.
  // A desync record says when it happened in the terms of the side that saw it.
  tickCount() {
    const sim = this.host.sim;
    return sim ? sim.tick : 0;
  }

  onDesync(m) {
    noteDesync(this.desyncs, m, {
      keys: this.damage.keys(m.island),
      tick: this.tickCount(),
      doc: typeof document === 'undefined' ? null : document,
    });
  }

  // ---- our own news --------------------------------------------------------

  // The pilot's client owns the aeroplane, so it is the one that announces what
  // the aeroplane did. Translation lives in match-events.js; this is the wiring.
  //
  // A CURSOR over sim.events rather than a drain: src/wings/scene.js keeps a
  // cursor of its own over the same array, and emptying it here would silently
  // delete the explosion and splash effects.
  emitOwnEvents() {
    const sim = this.host.sim;
    if (!sim) return [];
    const out = [];
    for (let i = this._evCursor; i < sim.events.length; i++) {
      const wire = pilotWireEvent(sim.events[i], sim);
      if (!wire) continue;
      this.emit(wire.type, wire.d);
      out.push(wire);
    }
    this._evCursor = sim.events.length;
    return out;
  }

  // Called once per simulation tick from pilot-main's update loop.
  pump() {
    if (!this.session || !this.session.connected) return;
    const sim = this.host.sim;
    if (!sim) return;
    this.tick = sim.tick;
    const p = sim.plane;
    // GUNFIRE rides the snapshot rather than the reliable channel: `g` is the
    // most recent round's release, in world pixels, and Mario's client
    // re-derives the round from it (src/wings/gun-rounds.js). Five numbers,
    // only while the gun is actually firing, on a packet that was going out
    // anyway — against ten acked-and-resent events a second if a round were an
    // event. See GUN_TRACE_TICKS for the redundancy that replaces the ack.
    //
    // It is a statement about our own aeroplane, which is the only kind of
    // thing a snapshot is allowed to be (spec 7.1): where a round left the
    // muzzle and how fast. It makes no claim about Mario at all — the pilot's
    // client is not permitted to say his rounds hit anybody, and does not.
    const g = sim.gunTrace ? sim.gunTrace() : null;
    // We are the truth about ourselves (spec 7.1), so this goes out flat, at
    // 20Hz, and is never negotiated. Session throttles it to the interval.
    this.session.sendSnapshot(sim.tick, {
      x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      angle: p.angle, mode: p.mode, gear: p.gear ? 1 : 0, fuel: p.fuel,
      squadron: sim.squadron, status: sim.status,
      ...(g ? { g } : null),
    });
    this.emitOwnEvents();
    this.session.pump(sim.tick);

    // Spec 8.4, and the same set for the same reason as Mario's side: the
    // replica of the server's map, not this client's Islands. The Islands
    // crater OPTIMISTICALLY the moment a bomb lands, a round trip before the
    // server has confirmed anything, so hashing them would report a desync
    // against our own bomb on every bombing run.
    this.session.maybeSendHash(sim.tick, () => this.damage.hashes());

    // Mario's snapshot is in LEVEL-LOCAL pixels. Convert once, here, so the
    // renderer only ever deals in world coordinates. A snapshot that says he
    // is out of reach converts to null and nothing is drawn anywhere: no
    // contact in the world view, and a dark tube on the next sweep. The
    // decision is Mario's client's; this side only obeys it (src/net/reach.js).
    const s = this.marioInterp.sampleLocal(sim.tick);
    this.remote = s ? contactFrom(s, this.originOf(s.island)) : null;
    this.host.scene.remoteMario = this.remote;
    // The radar's true contact (spec 3): the tube does its own timing and
    // fuzzing, and simply wants to be told where he really is.
    if (sim.setFix) {
      sim.setFix(this.remote
        ? { present: true, x: this.remote.x, y: this.remote.y, island: this.remote.island }
        : { present: false });
    }
  }

  state() {
    return {
      connected: !!(this.session && this.session.connected),
      room: this.session ? this.session.room : null,
      side: this.session ? this.session.side : null,
      seed: this.seed == null ? null : this.seed,
      peer: this.session ? this.session.peerPresent : false,
      remote: this.remote ? { ...this.remote } : null,
      marioLives: this.marioLives,
      marioIsland: this.marioIsland,
      world: this.world,
      squadron: this.squadron,
      matchStatus: this.matchStatus,
      winner: this.winner(),
      desyncs: this.desyncs.length,
      stats: this.session ? this.session.stats() : null,
    };
  }
}

// --------------------------------------------------------------------------
// Boot. `?solo` (and `?headless`) skip all of this and the page behaves exactly
// as it did before this plan.
// --------------------------------------------------------------------------

const net = new PilotNet();

// The room we were trying to join when a boot failed. Held out here because
// the catch below needs it to tell the player which code to hand the other
// player, and it is minted inside boot().
let joining = null;

async function boot() {
  await window.__WINGS.ready;
  const { room, solo } = roomFromLocation(location.search);
  if (solo) {
    banner(document, 'SOLO');
    return null;
  }
  // Started here, before the room is minted, and told to read `joining` each
  // time so our own room drops out of the list the moment we have one. It
  // never throws and is never awaited: the match must not wait on the lobby.
  lobbyHeader({ doc: document, win: window, here: () => joining });
  const code = room || (await mintRoom(location.origin));
  joining = code;
  showRoom(window, code, 'pilot');
  // See the same three lines on Mario's side: a page that already holds this
  // seat asks for it back, and says so while it waits.
  const held = recallSeat(window, code, 'pilot');
  banner(document, held ? `ROOM ${code} — PILOT — RECONNECTING` : `ROOM ${code} — PILOT`);
  const welcome = await net.connect({ room: code, side: 'pilot', token: held, location });
  rememberSeat(window, code, 'pilot', welcome.token);
  const say = (present) =>
    banner(document, `ROOM ${code} — PILOT — ${present ? 'MARIO IS HERE' : 'WAITING FOR MARIO'}`);
  say(welcome.peer);
  net.session.on('peer', (m) => say(m.present));
  // One pump per simulation tick, driven by the game loop rather than a timer.
  pilot.onTick = () => net.pump();
  // So the debug world jump can tell 'in a room alone' from 'Mario is here'.
  pilot.peerThere = () => net.peerLive();
  // The moment the archipelago is replaced, half way through the sail.
  pilot.onSailSwap = () => net.onSailSwap();
  return welcome;
}

const ready = boot().catch((e) => {
  // A warning, not an error, whichever cause this was. The commonest by far is
  // this page being served by a plain static server with no room endpoint — the
  // capture tool, the older browser tests — and in that case falling back to
  // one-player is the correct behaviour, not a fault worth reddening a console
  // over. The refusals the server can actually name say so on the banner
  // instead of hiding behind OFFLINE; see bootFailure.
  const fail = bootFailure(e, { room: joining, side: 'pilot' });
  // A named refusal means the token we presented is not in that seat; see the
  // same line on Mario's side for why an unnamed one keeps it.
  if (fail.diagnosed) forgetSeat(window, joining, 'pilot');
  console.warn('[pilot net] offline:', e && e.message ? e.message : e);
  banner(document, fail.text);
  return null;
});

// Attached to the existing API rather than a second global, per spec 8.2.
window.__WINGS.net = {
  ready,
  get session() { return net.session; },
  get transport() { return net.transport; },
  state: () => net.state(),
  remote: () => (net.remote ? { ...net.remote } : null),
  pump: () => net.pump(),
  winner: () => net.winner(),
  damage: (island) => net.damage.keys(island),
  // The bricks Mario has laid, as this client has them. Mario's client answers
  // this question with the same list for the same island.
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
