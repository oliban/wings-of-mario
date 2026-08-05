import { TILE } from '../core/constants.js';
import { MarioOverlay } from './mario-overlay.js';
import { FerryRide } from './ferry-ride.js';
import { Parcel } from './parcel.js';
import { drawSupplyDrop } from './art/parcel.js';
import { ToolbeltSeeder } from './toolbelt-blocks.js';
import { guardThrow } from './flat-throw.js';
import { installPeachEnding, stepSecondQuest } from './peach-ending.js';
import { Wrecked } from './wrecked.js';
import { BRICKBOMB_GRAVITY } from '../game/entities/brickbomb.js';
import { tileForChar } from '../data/tiles.js';
// The networked half of Mario's page (window.__NET). Imported here rather than
// given its own <script> tag because index.html is upstream and this module is
// already the wings layer's entry point on it: the ENTIRE upstream footprint of
// two plans stays at the one tag that loads this file. It polls for __GAME on
// its own and does nothing at all without a `?room=` code.
import net from '../net/mario-side.js';
import { SailScreen } from '../net/sail-screen.js';
import { worldOfIsland, SAIL_KIND } from './sail.js';

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

// THE PARCEL. On the same hook list and for the same reason as the ferry and
// the gun: it is the only fixed 60.0988Hz timestep this page has, and a rule
// about whether Mario can jump something must be evaluated on the clock his
// jump is evaluated on. See src/wings/parcel.js for what it decides and
// src/wings/stranded.js for how — the decision is Mario's client's to make,
// because only this client has his level, his position and his physics.
// tileForChar is handed in rather than imported by parcel.js: src/data/tiles.js
// builds every sprite in the game at module load and needs a canvas, and the
// parcel's own tests are plain Node. This page has a canvas, so this is where
// the two meet.
const parcel = new Parcel({
  solidChar: (ch) => {
    const rec = tileForChar(ch);
    return !!(rec && (rec.solid || rec.platform));
  },
});
overlay.hooks.push((world) => parcel.step(world));

// AND THE CRATE ITSELF, on the overlay's own canvas. This is the one module
// with both a drawing context and the flight state, which is exactly why the
// two halves meet here and nowhere else: src/wings/supply-drop.js is pure so
// the whole flight can be tested in plain Node, and src/wings/art/parcel.js is
// pixels on the engine's gfx.js so it can be looked at with tools/sheet.mjs.
// Neither knows the other exists.
//
// The state is in ISLAND-LOCAL pixels — the frame Mario's camera works in — so
// the camera offset is the whole of the conversion.
overlay.painters.push((ctx, cam) => {
  const s = parcel.drop.state();
  if (s) drawSupplyDrop(ctx, s.x - cam.x, s.y - cam.y, s);
});

// THE TOOLBELT IN THE QUESTION BLOCKS. The parcel above is the emergency — a
// belt handed over once the bombs have already cut him off. This is the other
// half the user asked for: one he can go and FIND, so bridging is something to
// plan a route around rather than only a consolation for being trapped.
//
// Upstream seeds two '?' blocks with it on every level load and gates that on
// Harry mode; src/wings/toolbelt-blocks.js re-runs the engine's own seeding
// with the flag held true across the call, so no engine file is edited and
// nothing else that reads harryMode changes. On the hook list because a level
// is rebuilt by a death and a pipe as well as by a load, and each one clears
// the block system.
const toolbelts = new ToolbeltSeeder();
overlay.hooks.push((world) => toolbelts.step(world));

// WHAT A BOMBED TILE TAKES WITH IT. A cannon whose barrel has been blown off
// went on firing, and a piranha plant kept rising out of the empty air where
// its pipe used to be: both read the tile map once, because upstream's terrain
// never changes under them. See src/wings/wrecked.js.
const wrecked = new Wrecked();
overlay.hooks.push((world) => wrecked.step(world));

// THE STANDING THROW. Upstream's launch is a pure function of how fast Mario is
// moving, so at a standstill the bomb goes straight up and the row of bricks
// forms over his head — useless to the one player who most needs it, the man
// standing on the lip of a chasm who cannot run at it without running into it.
// src/wings/flat-throw.js solves a lob that lands three tiles ahead at the
// level of the ground he is on. A throw with any run behind it is untouched.
//
// On the hook list because it wraps the WORLD instance and the world is not
// there at module time; the wrap is idempotent, so calling it every tick costs
// one property read.
overlay.hooks.push((world) => guardThrow(world, { gravity: BRICKBOMB_GRAVITY, tileSize: TILE }));

// THE SECOND QUEST'S ENEMIES. On the hook list for the same reason as the
// toolbelt seeder: a world is rebuilt by a death and a pipe as well as by a
// load, and the wrap has to be on the instance the engine is actually using.
// It is idempotent and does nothing until 8-4 has been cleared once. See
// src/wings/second-quest.js — the scene itself is installed in boot(), because
// it wraps the Game and the Screens manager rather than the World.
overlay.hooks.push((world) => stepSecondQuest(world));

// THE CARRIER GROUP SAILING, on Mario's screen. On the same hook list as the
// ferry and the gun, and for the same reason: it is the only fixed 60.0988Hz
// timestep this page has, and the fade must be counted in ticks so that the
// two screens agree and a screenshot at tick N is reproducible.
//
// The trigger is this client's OWN worldCleared — Mario's client owns Mario,
// so it declares the world cleared and the pilot's client obeys the same
// event. Nothing here waits on the network to come back: the fade and the wire
// event leave the same line of mario-side.js.
const sailScreen = new SailScreen();
overlay.hooks.push((world) => sailScreen.step(world));
net.onSail = (d) => sailScreen.begin({
  from: worldOfIsland(d.island),
  to: worldOfIsland(d.next),
  note: `MARIO GOES ASHORE ON ${d.next}`,
});

// AND THE SAME SCENE THE OTHER WAY. A run that restarts moves the ocean too —
// the carrier group has to follow Mario back to world 1 or the pilot spends the
// rest of the match over an archipelago Mario is not on. Same screen, same
// clock, same card; only src/wings/sail.js's words differ, because nothing was
// cleared. See MarioEvents in src/net/match-events.js for how a restart is told
// apart from progress.
net.onReset = (d) => sailScreen.begin({
  from: worldOfIsland(d.island),
  to: worldOfIsland(d.next),
  kind: SAIL_KIND.RESET,
  note: `MARIO STARTS AGAIN ON ${d.next}`,
});

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
  // THE PRINCESS AND THE NEW QUEST. Wraps window.__GAME's own Game and Screens
  // instances, so it needs both to exist — which is what ready() above is for.
  installPeachEnding(g);
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

// The parcel's scripted surface. Read-only on purpose: there is no method here
// that hands Mario a toolbelt, because a test that could ask for one would
// never prove that walking up to a cratered chasm gets him one.
window.__PARCEL = {
  // How many have been delivered this session, and what the last scan decided —
  // `{ parcel, gap, reason }`, the shape strandedBy() returns.
  given: () => parcel.given,
  last: () => (parcel.last ? { ...parcel.last } : null),
  // The crate in the air right now, in island-local pixels, or null. A browser
  // test asserts on this to prove the drop is a DROP — that it starts above the
  // top of the screen, comes down beside Mario rather than on him, and takes
  // about a second doing it.
  drop: () => parcel.drop.state(),
  // The other way to a toolbelt: which '?' blocks are holding one. Returned as
  // {tx, ty}, because the block system's own keys are PACKED NUMBERS
  // ((ty << 12) | tx, src/game/blocks.js) and not the "tx,ty" strings the
  // damage map uses — a difference that has already cost this project one bug
  // (see MODS.md on world.contents).
  blocks: () => {
    const w = window.__GAME && window.__GAME.world;
    const set = w && w.blocks && w.blocks.toolTiles;
    if (!set) return [];
    return [...set].map((k) => ({ tx: k & 0xfff, ty: k >> 12 }));
  },
  seeded: () => toolbelts.seeded,
};

// The sail's scripted surface. `begin()` is what a test calls to put the group
// under way without playing through a whole world; in a match nothing on this
// page calls it — net.onSail above does, off the wire event this client sends.
window.__SAIL = {
  screen: sailScreen,
  begin(opts = {}) {
    const to = opts.to == null ? 2 : opts.to;
    return sailScreen.begin({
      from: opts.from == null ? to - 1 : opts.from,
      to,
      // Defaulted rather than required, so every existing caller means a sail.
      kind: opts.kind || SAIL_KIND.SAIL,
      note: opts.note == null ? `MARIO GOES ASHORE ON ${to}-1` : opts.note,
    });
  },
  state() {
    return sailScreen.state();
  },
  // The text on screen right now, as one string, for a test that would rather
  // assert what it says than where it is.
  text() {
    return sailScreen.card ? sailScreen.card.textContent : '';
  },
  cancel() {
    return sailScreen.cancel();
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
