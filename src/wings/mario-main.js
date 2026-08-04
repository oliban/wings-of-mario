import { TILE } from '../core/constants.js';
import { MarioOverlay } from './mario-overlay.js';
import { FerryRide } from './ferry-ride.js';
// The networked half of Mario's page (window.__NET). Imported here rather than
// given its own <script> tag because index.html is upstream and this module is
// already the wings layer's entry point on it: the ENTIRE upstream footprint of
// two plans stays at the one tag that loads this file. It polls for __GAME on
// its own and does nothing at all without a `?room=` code.
import net from '../net/mario-side.js';

// Loaded from index.html. This module and the one <script> tag that loads it
// are the ENTIRE upstream footprint of the telegraph.
//
// DO NOT TRUST SCRIPT ORDER. src/game/world.js has a top-level await, so
// module execution order on this page is not reliable — debug-panel.js hit a
// real intermittent "sometimes does not appear" bug before it polled for the
// global instead of assuming it. So: poll.

const POLL_MS = 30;

const overlay = new MarioOverlay();

// The crossing between islands. It takes no host here — window.__GAME is not
// reliably assigned at module-body time, for the same reason the overlay polls
// — so it is attached inside boot(). The overlay's hook list is the only fixed
// timestep anything on this page gets; the ride needs one, so it takes that.
const ride = new FerryRide();
overlay.hooks.push((world) => ride.update(world));

// The pilot's gun rounds, on the ENGINE'S fixed clock. They are learned about
// on the network's rAF pump but they must be flown and hit-tested here, at the
// same 60.0988Hz Mario himself runs at: a bullet whose travel per hit test
// depended on the frame rate would pass through a man on a slow machine and
// shove him twice on a fast one. The overlay's hook list is the only fixed
// timestep this page has, which is why the ferry is already on it.
overlay.hooks.push((world) => net.stepGun(world));

// Being shot should be audible. One short, hard, falling chirp per round —
// through the whistle's own synth rather than the engine's playSfx, because
// that graph is already here and takes live parameters. It is deliberately not
// the whistle: a bomb coming down and a round landing on you must not sound
// alike, so this is short, low and dry where the whistle is long and swept.
net.onGunHit = () => overlay.synth.play({ freq: 300, to: 90, dur: 0.05, tag: 'gun-hit' });


// A bounded log of everything the overlay asked to be played, so a browser
// test can assert the whistle without an audio device. The synth keeps its own
// (see WhistleSynth.log); this is the same list, exposed by name.
function sounds() {
  return overlay.synth.log.map((s) => ({ ...s }));
}

let auto = 0;
let running = false;

function frame() {
  overlay.pump();
  requestAnimationFrame(frame);
}

function ready(g) {
  return !!(g && g.game && g.game.loop && g.renderer);
}

function boot() {
  const g = window.__GAME;
  if (!ready(g)) return false;
  overlay.attach(g);
  ride.attach(g);
  if (!running) {
    running = true;
    requestAnimationFrame(frame);
    // An AudioContext may not start without a gesture. The first key or click
    // the player makes unlocks the whistle; until then it records and stays
    // silent, which is the correct behaviour and not a failure.
    const unlock = () => overlay.synth.unlock();
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });
  }
  return true;
}

if (!boot()) {
  const id = setInterval(() => {
    if (boot()) clearInterval(id);
  }, POLL_MS);
}

// The scripted control surface, mirroring window.__GAME. It is assigned
// immediately — not inside boot() — so a test can wait on it and every method
// copes with the game not being up yet. Task 8 replaces drop() with the
// network's `bombRelease`; the payload shape is identical, which is the point
// of building it this way round.
window.__TELEGRAPH = {
  overlay,

  // Put a bomb in the air above a tile. `height` is how far above the tile's
  // top edge it starts, `vx` its horizontal velocity in px/frame. This is the
  // local stand-in for the pilot: it constructs the same {kind,x,y,vx,vy} a
  // release produces, in island-local pixels.
  drop(opts = {}) {
    const tx = opts.tx == null ? 0 : opts.tx;
    const ty = opts.ty == null ? 13 : opts.ty;
    const id = opts.id == null ? `local${++auto}` : opts.id;
    return overlay.add({
      id,
      kind: opts.kind || 'bomb',
      x: tx * TILE + TILE / 2,
      y: ty * TILE - (opts.height == null ? 200 : opts.height),
      vx: opts.vx == null ? 0 : opts.vx,
      vy: opts.vy == null ? 0 : opts.vy,
    }).id;
  },

  marks() {
    return overlay.marks.map((m) => ({ ...m, impact: m.impact ? { ...m.impact } : null }));
  },

  sounds,

  // Catch up with the engine right now, synchronously.
  pump() {
    return overlay.pump();
  },

  // Advance the engine and the wings layer together, in lockstep, n fixed
  // steps. THIS is what tests should call. `pump()` caps its catch-up at
  // MAX_CATCHUP — deliberately, so a backgrounded tab cannot run a thousand
  // steps in one frame — so handing it a thousand engine ticks at once would
  // silently drop most of them.
  // It drives `game.update()` and the loop's tick counter directly rather than
  // calling `__GAME.tick(1)` n times, because that helper renders the whole
  // 256x240 frame on every call — a thousand-tick ferry crossing would be a
  // thousand full renders. The overlay still redraws itself each step (a
  // clear and a handful of rects), so a pixel assertion after run() is
  // looking at the current frame.
  run(n = 1) {
    const g = window.__GAME;
    if (!g || !g.game || !g.game.loop) return 0;
    for (let i = 0; i < n; i++) {
      g.game.update();
      g.game.loop.tick++;
      overlay.pump();
    }
    g.game.render(1);
    return overlay.frame;
  },

  clear() {
    overlay.reset();
    overlay.synth.log.length = 0;
    return true;
  },
};

// The ferry's scripted surface, alongside the telegraph's and assigned at the
// same moment and for the same reason. The crossing itself is stepped by the
// overlay hook above, so a test drives it with __TELEGRAPH.run(n) — there is
// no separate clock here to keep in sync.
window.__FERRY = {
  ride,

  // fromX/toX are WORLD pixels: the boat is on the ocean between two islands,
  // which is the pilot's coordinate space. The defaults are two plausible
  // island x's, so board() with no arguments gives a crossing you can watch.
  async board(opts = {}) {
    await ride.board({
      fromX: opts.fromX == null ? 3000 : opts.fromX,
      toX: opts.toX == null ? 6000 : opts.toX,
      to: opts.to || null,
    });
    return true;
  },

  state() {
    return ride.ferry ? ride.ferry.state() : null;
  },

  sink() {
    const g = window.__GAME;
    return ride.sink(g && g.world);
  },

  clear() {
    ride.clear();
    return true;
  },
};

export default overlay;
