import { Transport } from './transport.js';
import { Session } from './session.js';
import { Interp } from './interp.js';
import { roomFromLocation, wsUrl, mintRoom, showRoom, banner, bootFailure } from './lobby.js';
import { ISLAND_TOP_Y } from '../wings/geo.js';
import pilot from '../wings/pilot-main.js';

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

export class PilotNet {
  constructor(opts = {}) {
    this.host = opts.pilot || pilot;
    this.session = null;
    this.transport = null;
    // Mario's discrete fields must never be interpolated into a blend.
    this.marioInterp = new Interp({
      snap: ['island', 'anim', 'facing', 'power', 'lives', 'state'],
    });
    this.remote = null;
    this.lastEvent = null;
    this.desyncs = [];
    this.tick = 0;
  }

  // Where an island's left edge is, in world pixels, according to the ocean
  // this client is actually flying over.
  originOf(id) {
    const sim = this.host.sim;
    if (!sim) return null;
    const isle = sim.islandById(id);
    return isle ? isle.originX : null;
  }

  async connect({ room, side = 'pilot', location = window.location } = {}) {
    this.transport = new Transport(wsUrl(location), {});
    this.session = new Session({ transport: this.transport, room, side });

    this.session.on('snapshot', (m) => {
      if (m.side === 'pilot') return; // our own, echoed back: ignore
      this.marioInterp.push(m.tick, m.s);
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
    this.session.on('event', (m) => {
      this.lastEvent = m;
    });
    this.session.on('desync', (m) => {
      this.desyncs.push(m);
      console.error('[DESYNC]', m.island, 'server', m.server, 'client', m.client);
    });

    const welcome = await this.session.connect();
    this.seed = welcome.seed;
    // Rebuild the ocean on the match seed. Until this line the pilot is flying
    // over the default archipelago, which is a different one.
    this.host.reset({ seed: welcome.seed });
    this.host.render();
    return welcome;
  }

  // Called once per simulation tick from pilot-main's update loop.
  pump() {
    if (!this.session || !this.session.connected) return;
    const sim = this.host.sim;
    if (!sim) return;
    this.tick = sim.tick;
    const p = sim.plane;
    // We are the truth about ourselves (spec 7.1), so this goes out flat, at
    // 20Hz, and is never negotiated. Session throttles it to the interval.
    this.session.sendSnapshot(sim.tick, {
      x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      angle: p.angle, mode: p.mode, gear: p.gear ? 1 : 0, fuel: p.fuel,
      squadron: sim.squadron, status: sim.status,
    });
    this.session.pump(sim.tick);

    // Mario's snapshot is in LEVEL-LOCAL pixels. Convert once, here, so the
    // renderer only ever deals in world coordinates.
    const s = this.marioInterp.sampleLocal(sim.tick);
    if (!s) {
      this.remote = null;
    } else {
      const originX = this.originOf(s.island);
      this.remote = originX == null
        ? null // an island this pilot has not laid out; nothing to draw
        : {
          x: originX + s.x,
          y: ISLAND_TOP_Y + s.y,
          facing: s.facing,
          island: s.island,
        };
    }
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
  const code = room || (await mintRoom(location.origin));
  joining = code;
  showRoom(window, code, 'pilot');
  banner(document, `ROOM ${code} — PILOT`);
  const welcome = await net.connect({ room: code, side: 'pilot', location });
  const say = (present) =>
    banner(document, `ROOM ${code} — PILOT — ${present ? 'MARIO IS HERE' : 'WAITING FOR MARIO'}`);
  say(welcome.peer);
  net.session.on('peer', (m) => say(m.present));
  // One pump per simulation tick, driven by the game loop rather than a timer.
  pilot.onTick = () => net.pump();
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
  latency: (ms) => (net.transport ? net.transport.latency(ms) : 0),
  drop: (pct) => (net.transport ? net.transport.drop(pct) : 0),
  disconnect: () => (net.transport ? net.transport.disconnect() : false),
  reconnect: () => (net.transport ? net.transport.reconnect() : false),
  desyncs: () => net.desyncs.map((d) => ({ ...d })),
};

export default net;
