import { bakeAll } from '../core/gfx.js';
import { GameLoop } from '../core/loop.js';
import { PilotRenderer } from './pilot-renderer.js';
import { Scene } from './scene.js';
import { WingsSim, SQUADRON } from './sim.js';
import { ARCHIPELAGO } from './archipelago.js';
import { Sail, SAIL_KIND } from './sail.js';
import { takeoff, flyTo, bombTile, autoLand } from './bot.js';
import {
  SPEED_TUNE, getMaxSpeed, setMaxSpeed, resetMaxSpeed, normalizeAngle,
} from './flight.js';
import { LANDING } from './carrier.js';

const HEADLESS = new URLSearchParams(location.search).has('headless');
if (HEADLESS) document.body.classList.add('headless');

// The pilot owns its own keyboard rather than borrowing core/input.js: that Pad
// is Mario's, its two maps are already spoken for, and a second consumer of the
// same key events is a bug waiting to happen.
const KEYMAP = {
  // DOWN LIFTS. The stick, not the nose: you pull BACK to climb, and back is
  // toward you — down the screen. Every arcade flight game of the era is
  // wired this way and the user asked for it explicitly. There is no attitude
  // in which this flips: pitch is body-relative in flight.js and the stall
  // turn never inverts the aeroplane, so "back" means "climb" facing either
  // way round, upside down or not.
  // The actions are named for what the AEROPLANE does, not for which key does
  // it, so that this table stays the only place the binding lives.
  ArrowDown: 'climb',
  ArrowUp: 'dive',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyG: 'gear',
  KeyR: 'respawn',
  // Ordnance. Space/K drops a bomb, X/J fires the gun — the right hand on the
  // arrows, the left on the weapons, and Space for the one you use most.
  Space: 'drop',
  KeyK: 'drop',
  KeyX: 'fire',
  KeyJ: 'fire',
  // DEBUG, not a game control — live top-speed tuning for playtesting the
  // flight feel without a code change and a reload. See speedTune() and
  // SPEED_TUNE in flight.js.
  //
  // Q/W/E rather than the digits, because the digits now jump worlds on their
  // own (no shift). Three keys together under the left hand, none of them a
  // browser shortcut, and none of them a pilot control — the aeroplane flies
  // on the arrows, Space, X, G and R.
  KeyQ: 'speedDown',
  KeyW: 'speedUp',
  KeyE: 'speedReset',
  // § used to be the reset. It is gone: `event.code` is not layout-independent
  // for that key — macOS swaps the two ISO codes relative to every other
  // platform, so it had to be bound as both IntlBackslash and Backquote, and it
  // still did not fire for the user. E is one key, on every keyboard, and it
  // works.
  //
  // DEBUG, not a game control — step the archipelago one world back or one
  // world on. See jumpTo(). The brackets were unbound, they sit together under
  // the right hand next to the arrows, and they are not a browser shortcut on
  // any platform.
  BracketLeft: 'worldPrev',
  BracketRight: 'worldNext',
};

// DEBUG, not a game control — a digit jumps the archipelago straight to that
// world, which is the only practical way to see worlds 2-8 without playing
// through them.
//
// It briefly needed SHIFT, because 1 and 2 were the speed tuning at the time.
// The tuning moved to Q/W/E precisely so the digits could be the obvious thing.
// Shift still reaches here — a habit formed in the last hour keeps working —
// and the modifier guard in key() runs first regardless, so Cmd-1 goes to the
// browser untouched, shift or no shift.
//
// It stays out of KEYMAP because that table maps a code to a HELD action and
// this is an edge-triggered one-shot; key() checks it before the KEYMAP lookup.
//
// Nine entries rather than eight: ARCHIPELAGO.WORLDS is read from the level
// registry, so a ninth world arriving upstream should be reachable without
// anyone remembering this table exists. jumpTo() clamps to what actually
// exists, so the spare binding is inert until it is not.
const WORLD_KEYS = {
  Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5,
  Digit6: 6, Digit7: 7, Digit8: 8, Digit9: 9,
};

const keys = Object.create(null);
let scripted = null;
let gear = true;

// A press-and-release can easily land entirely between two simulation ticks
// (or several, on a dropped frame). So a keydown LATCHES here and the latch is
// cleared once the tick that saw it has run: a tap is never eaten, however
// briefly it happened.
//
// The latch is only ever a floor. The BOMB is that and nothing else, so
// holding Space spends exactly one bomb — the browser's auto-repeat keydowns
// are filtered out before they reach the latch, and after the first tick the
// flag is false again however long the key stays down. The GUN adds the held
// state on top (see readKeys), because a machine gun you have to tap is not a
// machine gun; the repeat RATE is not decided here but in sim.js, in ticks,
// where the scripted path gets it too.
const pending = { drop: false, fire: false };

// WHICH WAY THE STICK TURNS THE AIRFRAME.
//
// `pitch` in flight.js is not "pull back", it is a fixed direction of
// rotation: +1 always sweeps the nose the same way round the compass. Facing
// East that is a climb. Facing West — which is where every stall turn leaves
// you — the same rotation is a DIVE, so a straight key swap would give "Down
// lifts" on the outbound leg only, which is the mental translation step the
// user asked to be rid of.
//
// What decides it is not the heading, it is which side of the aeroplane the
// canopy is on. A stall turn changes ends by rolling half way round the
// fuselage axis (scene.js animates exactly that), so the aeroplane comes out
// mirrored — upright, facing the other way — and the elevator now rotates it
// the other way round in world terms. Two reversals and it is back as it was.
//
// So the sign flips once per COMPLETED stall turn and at no other time. That
// is what keeps a loop clean: a loop does not change ends, does not reverse
// this, and the earlier attempt at "down lifts" — which flipped on heading —
// is precisely what used to leave the aeroplane stuck at the vertical, the
// sign reversing under the player's thumb half way round. Input is ignored
// for the whole duration of a turn anyway, so the flip lands on the exact
// tick control comes back.
//
// This is the KEYBOARD's translation of what the player meant, and it lives
// here rather than in the simulation: __WINGS.hold({pitch}) is the raw
// airframe rotation and is deliberately untouched by it.
let mirrored = false;
let wasTurning = false;

// Hands off. What the simulation is fed for every tick of a sail — see
// Pilot#update. `gear` is READ rather than asserted: the crossing begins with
// the aeroplane wherever it was, and forcing the gear down at 400 feet in the
// first half-second of the fade would be a manoeuvre nobody asked for.
function neutral(sim) {
  return {
    pitch: 0, thrust: 0, drop: false, fire: false, gear: sim.plane.gear,
  };
}

function readKeys() {
  if (scripted) return scripted;
  return {
    // Pitch is body-relative — pulling back always noses up, pushing forward
    // always noses down — and unaffected by which way the aeroplane is
    // facing. `pitch: +1` is nose-up here and everywhere else, including
    // __WINGS.hold(); only which KEY produces it lives in KEYMAP.
    pitch: (mirrored ? -1 : 1) * ((keys.climb ? 1 : 0) + (keys.dive ? -1 : 0)),
    // Thrust is a WORLD-frame direction, not a lever position: Right always
    // means "thrust East", Left "thrust West". See flight.js's stepAir for
    // how that becomes acceleration, deceleration, or a stall turn depending
    // on which way the aeroplane is actually travelling.
    thrust: (keys.right ? 1 : 0) + (keys.left ? -1 : 0),
    drop: pending.drop,
    // The trigger, not a trigger press: true for every tick X is down, so the
    // gun keeps firing while held. The latch is OR'd in so a tap shorter than
    // one tick still gets its round. sim.js meters the rate from this.
    fire: pending.fire || !!keys.fire,
    gear,
  };
}

// ---------------------------------------------------------------------------
// DEBUG speed tuning readout — keys 1 and 2.
// ---------------------------------------------------------------------------
// A DOM badge rather than a box on the canvas HUD: the HUD is the aeroplane's
// instrument panel and this is not an instrument, it is a developer control,
// and it should LOOK like one so it cannot quietly be mistaken for a game
// feature. It does not exist at all until the first press, so a player who
// never touches the digits never sees it, and it says DEBUG on it in red for
// the one who does.
//
// The readout is essential: MAX SPEED is a number you cannot see in the SPEED
// box (which reads current airspeed), and a tuning control with no readout is
// guesswork.
let speedBadge = null;

// The badge itself, made once. It used to appear only when the tuning keys
// were pressed; the attitude line needs it up from the start.
function ensureSpeedBadge() {
  if (typeof document === 'undefined' || speedBadge) return;
  {
    speedBadge = document.createElement('div');
    speedBadge.id = 'wings-debug-speed';
    speedBadge.style.cssText = [
      // Top left, deliberately: #hint in pilot.html is a full-width legend
      // pinned to the bottom of the window, and a narrow window would run its
      // centred text straight through a badge sitting down there.
      'position:fixed', 'left:8px', 'top:8px', 'z-index:50',
      'padding:4px 8px', 'border-radius:4px', 'pointer-events:none',
      'background:rgba(20,0,0,.82)', 'border:1px solid #d34',
      'color:#ffb0b8', 'font:11px/1.4 ui-monospace,Menlo,monospace',
      'letter-spacing:.08em', 'white-space:pre',
    ].join(';');
    document.body.appendChild(speedBadge);
  }
}

function showSpeedBadge(value) {
  ensureSpeedBadge();
  if (!speedBadge) return;
  const at = value === SPEED_TUNE.DEFAULT ? '  (default)'
    : value === SPEED_TUNE.MIN ? '  (min)'
      : value === SPEED_TUNE.MAX ? '  (max)' : '';
  badgeSpeedLine = `DEBUG  MAX SPEED ${value.toFixed(1)}${at}`;
  paintSpeedBadge();
}

// THE LIVE ATTITUDE, in the debug badge rather than on the instrument panel.
//
// Asked for to work out what a landing should tolerate — "I need it to find
// what should be acceptable when landing" — and it has to be LIVE, because the
// aeroplane pitches continuously and the number only means anything at the
// moment the wheels touch. A badge that only redrew when a key was pressed
// would show the angle you had when you last pressed Q.
//
// It went on the HUD's SPEED cell first. That cell is 115 pixels wide and the
// readout ran thirty-seven past its own right edge, off the panel entirely —
// and it was the wrong place regardless: the panel is the game's instruments,
// this is a debug tool.
//
// Signed and normalised to the same +/-PI range landingVerdict tests, so what
// is on screen is what the rule compares against, with the limit printed beside
// it so there is nothing to look up.
let badgeSpeedLine = null;
let badgeAngleLine = '';

function paintSpeedBadge() {
  if (!speedBadge) return;
  const speed = badgeSpeedLine || `DEBUG  MAX SPEED ${getMaxSpeed().toFixed(1)}`;
  speedBadge.textContent = `${speed}\n${badgeAngleLine}\nQ slower   W faster   E default   1-8 world`;
}

// Called once per rendered frame from Pilot#render.
function updateAngleBadge(sim) {
  if (typeof document === 'undefined' || !sim || !sim.plane) return;
  const a = normalizeAngle(sim.plane.angle);
  const ok = Math.abs(a) <= LANDING.MAX_ANGLE && Math.cos(sim.plane.angle) > 0;
  badgeAngleLine = `ANGLE  ${a >= 0 ? ' ' : ''}${a.toFixed(3)} rad`
    + `   (land within ${LANDING.MAX_ANGLE.toFixed(2)})  ${ok ? 'OK' : '--'}`;
  ensureSpeedBadge();
  paintSpeedBadge();
}

// Moves the setting AND the aeroplane currently in the air. The setting is
// what a plane built later (respawn, sail) will be born with; p.maxSpeed is
// what the one you are flying right now uses, and the whole point is to feel
// the change immediately rather than after a crash.
function speedTune(sim, delta) {
  const v = setMaxSpeed(getMaxSpeed() + delta * SPEED_TUNE.STEP);
  if (sim && sim.plane) sim.plane.maxSpeed = v;
  showSpeedBadge(v);
  return v;
}

// E — back to the aeroplane as shipped, in one press. Reaches the setting and
// the aeroplane in the air by exactly the same two steps as speedTune, so a
// reset lands as immediately as a tune does; and it shows the badge, because a
// reset you cannot see is indistinguishable from a key that did nothing.
function speedReset(sim) {
  const v = resetMaxSpeed();
  if (sim && sim.plane) sim.plane.maxSpeed = v;
  showSpeedBadge(v);
  return v;
}

// ---------------------------------------------------------------------------
// DEBUG world jump readout — [ ] and shift+digit.
// ---------------------------------------------------------------------------
// The same shape of thing as the speed badge above, and for the same reason: a
// developer control that LOOKS like one, absent until the first press, red so
// it cannot be mistaken for an instrument.
//
// The readout is not optional here. The ocean holds one world at a time and
// world 5's four islands look like four islands; without the number on screen
// the tool is guesswork. It sits under the speed badge rather than beside it so
// the two never overlap on a narrow window, and once it exists it is refreshed
// on EVERY archipelago change — a real sail as well as a jump — so it cannot
// go stale and quietly report the wrong ocean.
let worldBadge = null;

function showWorldBadge(world, note = '') {
  if (typeof document === 'undefined') return;
  if (!worldBadge) {
    worldBadge = document.createElement('div');
    worldBadge.id = 'wings-debug-world';
    worldBadge.style.cssText = [
      'position:fixed', 'left:8px', 'top:46px', 'z-index:50',
      'padding:4px 8px', 'border-radius:4px', 'pointer-events:none',
      'background:rgba(20,0,0,.82)', 'border:1px solid #d34',
      'color:#ffb0b8', 'font:11px/1.4 ui-monospace,Menlo,monospace',
      'letter-spacing:.08em', 'white-space:pre',
    ].join(';');
    document.body.appendChild(worldBadge);
  }
  const tail = note ? `\n${note}` : '';
  worldBadge.textContent =
    `DEBUG  ARCHIPELAGO  WORLD ${world} of ${ARCHIPELAGO.WORLDS}\n`
    + '[ back   ] on   1..8 jump'
    + tail;
}

// Refresh it if — and only if — the player has already asked for it. A world
// number appearing on screen the first time Mario clears a world would be a
// debug tool switching itself on in a real match.
function refreshWorldBadge(world, note = '') {
  if (worldBadge) showWorldBadge(world, note);
}

class Pilot {
  constructor() {
    this.renderer = null;
    this.sim = null;
    this.scene = null;
    this.loop = null;
    this.fatal = null;
    // A per-tick hook for the network layer to attach itself to
    // (src/net/pilot-side.js). Null when playing offline, which is what the
    // capture tool and every pre-network test run as.
    this.onTick = null;
    // Set by the net layer alongside onTick — see hasPeer().
    this.peerThere = null;
    // THE CROSSING between archipelagos (src/wings/sail.js). Started by
    // sailTo() when Mario's client says he has cleared a world, stepped on the
    // SIMULATION clock below, and the owner of the one tick on which the ocean
    // is replaced.
    this.crossing = new Sail();
    // Fired on the one tick the ocean is replaced, so the network layer can
    // drop everything it was holding about the old one (src/net/pilot-side.js).
    this.onSailSwap = null;
    // DEBUG. The world a jump in progress is bound for, or null when the
    // crossing under way is a real sail. See jumpTo(); read by stepCrossing on
    // the swap tick, and it is what makes ONE crossing serve both.
    this.jump = null;
  }

  async boot() {
    bakeAll();
    this.renderer = new PilotRenderer(document.getElementById('screen'));
    this.reset();

    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => {
      for (const k of Object.keys(keys)) keys[k] = false;
      pending.drop = false;
      pending.fire = false;
    });

    this.loop = new GameLoop(() => this.update(), () => this.render());
    this.render();
    if (!HEADLESS) this.loop.start();
    return this;
  }

  // `opts.seed` is the MATCH seed, which arrives in the server's welcome and
  // decides the archipelago layout (archipelago.js lays the ocean out from it,
  // with seeded gaps). Both players must build the same ocean or the pilot
  // bombs one island and Mario is standing on another, so the network resets
  // the sim with it the moment it knows it.
  reset(opts = {}) {
    this.sim = new WingsSim({ squadron: opts.squadron, seed: opts.seed, world: opts.world });
    this.scene = new Scene();
    this.crossing.cancel();
    this.jump = null;
    gear = true;
    scripted = null;
    pending.drop = false;
    pending.fire = false;
    mirrored = false;
    wasTurning = false;
    return this.sim;
  }

  key(e, down) {
    // A system modifier means the keystroke belongs to the browser, not to the
    // aeroplane: leave it entirely alone — no handling and, above all, no
    // preventDefault. R is bound to `respawn`, so Cmd-Shift-R matched the
    // keymap and was swallowed before Chrome ever saw it, and the user could
    // not hard-reload the page they were playtesting.
    //
    // The rule is general on purpose rather than a special case for R: it
    // rescues Cmd-R, Cmd-T, Cmd-W, Ctrl-Shift-I and every other shortcut at
    // once, and the next binding that collides with one will not need a second
    // fix. Mario's own Pad has the same preventDefault pattern and has never
    // shown the bug only because its maps happen to claim no key a browser
    // wants.
    //
    // SHIFT IS NOT ON THIS LIST. Shift-plus-a-game-key is not a browser
    // shortcut, and shift is a plausible binding of its own one day.
    if (e.metaKey || e.ctrlKey || e.altKey) {
      // One thing still has to happen: a key going UP has to be released.
      // Otherwise reaching for Cmd mid-hold — or the browser withholding the
      // keyup for a key released while Cmd is down, which macOS does — leaves
      // the aeroplane holding full aileron forever.
      const held = KEYMAP[e.code];
      if (!down && held) keys[held] = false;
      return;
    }
    // DEBUG. A plain digit jumps the archipelago to that world. It needed shift
    // while 1 and 2 were the speed tuning; the tuning moved to Q/W/E precisely
    // so the digits could be what they obviously should be — 1 through 8 for
    // the eight worlds. Shift still works, so a habit formed in the last hour
    // does not break.
    if (WORLD_KEYS[e.code]) {
      e.preventDefault();
      if (down) this.jumpTo(WORLD_KEYS[e.code]);
      return;
    }
    const name = KEYMAP[e.code];
    if (!name) return;
    e.preventDefault();
    if (down && !keys[name]) {
      if (name === 'gear') gear = !gear;
      if (name === 'drop') pending.drop = true;
      if (name === 'fire') pending.fire = true;
      if (name === 'speedDown') speedTune(this.sim, -1);
      if (name === 'speedUp') speedTune(this.sim, +1);
      if (name === 'speedReset') speedReset(this.sim);
      if (name === 'worldPrev') this.jumpTo(this.sim.archipelago.world - 1);
      if (name === 'worldNext') this.jumpTo(this.sim.archipelago.world + 1);
      // Parked on an island: R abandons the airframe and puts a fresh one on
      // the deck. Without it a pilot who lands on a strip with a dry tank is
      // stuck there for the rest of the match — an island landing does not
      // refuel, by design, and no fuel means no power.
      if (name === 'respawn' && this.sim.canScuttle && this.sim.canScuttle()) {
        this.sim.scuttle();
      } else if (name === 'respawn' && this.sim.plane.mode === 'down') {
        this.sim.respawn();
      }
    }
    keys[name] = down;
  }

  update() {
    if (this.fatal) return;
    try {
      // THE CROSSING TAKES THE CONTROLS. Once the carrier group is under way
      // whatever the pilot was doing is over — he may be mid-sortie, in a
      // stall turn, half way through a landing — so the stick goes neutral for
      // the whole scene and the latched bomb and gun presses below are eaten
      // as usual. The simulation is still STEPPED, which matters: the network
      // pump is paced by sim.tick, and freezing it would stall the reliable
      // channel's acks for four seconds under the black.
      this.sim.step(this.crossing.active ? neutral(this.sim) : readKeys());
      // The tick has seen the latch; a second tick must not re-fire the same
      // press. What keeps the gun going after this is the held key itself,
      // not the latch.
      pending.drop = false;
      pending.fire = false;
      this.trackAttitude();
      // Before the network pump, so the snapshot this tick puts on the wire is
      // of the aeroplane on the NEW deck rather than the last position it held
      // over the old ocean.
      this.stepCrossing();
      // The network layer, if one attached itself (src/net/pilot-side.js).
      // Called from update() rather than from a timer so it advances at the
      // simulation's rate and is driven correctly by __WINGS.tick(n) in tests.
      //
      // Caught separately from the simulation: crash() stops the loop for good,
      // and a dropped socket must not ground the aeroplane. A network fault
      // costs you the other player, never your own game.
      if (this.onTick) {
        try {
          this.onTick();
        } catch (e) {
          console.error('[pilot net]', e);
        }
      }
      // The model raises the hook on rotation and lowers it again on the wire.
      // Without mirroring that back, the next tick's input would re-assert the
      // player's stale toggle and the hook would never actually come up.
      // Scripted input stays authoritative — hold() means what it says.
      if (!scripted) gear = this.sim.plane.gear;
    } catch (e) {
      this.crash(e);
    }
  }

  // MARIO CLEARED A WORLD. His client owns Mario, so his client says so and
  // this side obeys (src/net/pilot-side.js hears the reliable `worldCleared`
  // and calls this); the pilot never infers it from anything he can see.
  //
  // Refused when a crossing is already running or when `toWorld` is not ahead
  // of where the group already is, which is what makes a resent event a no-op
  // rather than a second sail.
  sailTo(toWorld) {
    const from = this.sim.archipelago.world;
    return this.crossing.begin({
      from,
      to: toWorld,
      note: `SQUADRON REPLENISHED — ${SQUADRON} AIRCRAFT ON DECK`,
    });
  }

  // MARIO'S RUN RESTARTED IN ANOTHER WORLD. Same ownership rule as sailTo and
  // the same obedience: his client says so (src/net/pilot-side.js hears the
  // reliable `worldReset`), this one moves.
  //
  // It is the SAME CROSSING as a sail — same fade, same durations, same card
  // layout — because it is the same carrier group doing the same thing for a
  // different reason, and a second transition would be a second thing to keep
  // right. Only two things differ, and both live in src/wings/sail.js: the
  // words (resetText: nothing was secured) and the fact that it may go BACK.
  //
  // Refused when the group is already on that world, which is what makes a
  // resent worldReset a no-op. Clamped rather than rejected at the ends, so an
  // island id from an eventual ninth world cannot throw the ocean away.
  repositionTo(toWorld) {
    const from = this.sim.archipelago.world;
    const n = Math.round(Number(toWorld));
    if (!Number.isFinite(n)) return false;
    const to = Math.max(1, Math.min(ARCHIPELAGO.WORLDS, n));
    return this.crossing.begin({
      from,
      to,
      kind: SAIL_KIND.RESET,
      note: `SQUADRON REPLENISHED — ${SQUADRON} AIRCRAFT ON DECK`,
    });
  }

  // Is the network layer attached? It hooks itself on here once, and only once
  // it has actually joined a room (src/net/pilot-side.js, at the end of boot);
  // `?solo`, the capture tool and a failed connect all leave it null. Read
  // rather than imported, so pilot-main.js still knows nothing about the net.
  connected() {
    return !!this.onTick;
  }

  // Is there actually a MARIO on the other end? Being in a room is not the same
  // thing: the pilot mints the room and flies alone in it until somebody joins,
  // which is most of a playtest. The net layer sets this the same way it sets
  // onTick, so this file still knows nothing about sessions; null means nobody
  // is there, which is also the honest answer offline.
  hasPeer() {
    return !!(this.peerThere && this.peerThere());
  }

  // ---------------------------------------------------------------------------
  // DEBUG — jump the archipelago to any world. [ ] and shift+1..8.
  // ---------------------------------------------------------------------------
  // Not a game control. The ocean holds one world at a time and the only honest
  // way to reach world 8 is for Mario to clear the twenty-eight levels in front
  // of it, so without this a playtester cannot see thirty of the thirty-two
  // islands the game already draws.
  //
  // REFUSED IN MULTIPLAYER, deliberately, and this is the important decision in
  // the whole control. The two clients share one ocean and nothing tells them
  // so — they each lay it out from the match seed and the world number, and the
  // desync detector compares destroyed-tile SETS, which would be empty and
  // equal on both sides of exactly this divergence. A pilot who jumped to world
  // 5 while Mario stood on 1-1 would have craters landing nowhere, a radar
  // plotting the wrong islands, and a screen full of plausible-looking rubbish.
  //
  // The two alternatives were both worse. Carrying Mario along would mean this
  // side declaring a world cleared, and worldCleared is Mario's client's event
  // to send (spec 7.3, EVENT_OWNER) precisely because only it can actually load
  // a level; the pilot inventing one would be a second authority for the one
  // fact the whole match hangs off. And it cannot go BACKWARDS at all — Mario's
  // engine progresses, so "jump to world 2" from world 5 is not a thing the
  // other side can obey even in principle. Refusing keeps the tool honest about
  // what it is: a way to look at the pilot's own thirty-two islands.
  //
  // Multiplayer has the real thing anyway. Clearing a world sails the group for
  // both players, and that path is untouched by any of this.
  jumpTo(toWorld) {
    const from = this.sim.archipelago.world;
    // Refused only when a MARIO is actually on the other end. Being in a room
    // alone is the normal state of a playtest — the pilot mints the room and
    // flies in it until somebody joins — and refusing there made the tool
    // unusable for exactly the person it was built for.
    if (this.hasPeer()) {
      showWorldBadge(from, 'REFUSED — MARIO IS HERE AND WOULD BE LEFT BEHIND');
      return false;
    }
    // Clamped rather than rejected, so holding ] at world 8 parks there instead
    // of doing something surprising, and so shift-9 is inert until a ninth
    // world exists upstream.
    const to = Math.max(1, Math.min(ARCHIPELAGO.WORLDS, Math.round(Number(toWorld))));
    if (!Number.isFinite(to)) return false;
    if (to === from) {
      // Still show the badge: a key that appears to do nothing is worse than a
      // key that says "you are already here".
      showWorldBadge(from);
      return false;
    }
    // ONE CROSSING SERVES BOTH. The scene the player sees is the real sail from
    // src/wings/sail.js — same fade, same durations, same card — because a
    // debug jump that skipped it would be testing a transition the players
    // never experience, which is the opposite of useful.
    //
    // The from/to handed to Sail#begin are a CLOCK, not the destination: begin
    // refuses anything that is not strictly forward (that refusal is what makes
    // a resent worldCleared a no-op, and it is worth more than this), and a
    // debug jump is allowed to go back. So `this.jump` carries the real
    // destination and the words on the card are supplied below. Nothing in
    // sail.js needed changing for it.
    if (!this.crossing.begin({ from, to: from + 1 })) return false;
    this.jump = to;
    showWorldBadge(from, `MAKING FOR WORLD ${to}…`);
    return true;
  }

  // What a debug jump says on the card, in place of sailText(). It must not
  // read "WORLD 4 SECURED" — nobody secured anything, and on a backwards jump
  // that sentence would be an outright lie about the state of the match.
  jumpText(from, to) {
    return {
      title: 'DEBUG — ARCHIPELAGO JUMP',
      lines: [
        `THE CARRIER GROUP IS REPOSITIONING TO WORLD ${to}`,
        `WORLD ${from} WAS NOT CLEARED — TESTING ONLY`,
        `SQUADRON REPLENISHED — ${SQUADRON} AIRCRAFT ON DECK`,
      ],
    };
  }

  // One tick of the crossing, on the simulation's clock. The swap is an EDGE
  // reported by Sail#step and happens exactly once, under a fully opaque veil.
  stepCrossing() {
    if (!this.crossing.active) {
      this.scene.sailView = null;
      return null;
    }
    const from = this.crossing.from;
    const jump = this.jump;
    const to = jump == null ? this.crossing.to : jump;
    const f = this.crossing.step();
    if (f.swap) {
      // The whole of the changeover: a new ocean from the seed, a full
      // squadron, the aeroplane respotted, and nothing left in the air.
      //
      // Anything moving FORWARDS is exactly that, unaltered — the real sail,
      // whether a cleared world, a debug jump or a restart in a further world.
      // Only going BACK needs anything else, because Archipelago#sail refuses
      // to run the group's world number down and must go on refusing it: that
      // guard is what makes a resent worldCleared idempotent. Going back is
      // therefore a REBUILD from the same match seed rather than a sail, which
      // lands on the identical ocean seedFor(seed, world) would have given —
      // the layout is a pure function of the two, so there is no third way for
      // world 2 to look.
      //
      // Decided off the DESTINATION rather than off which caller asked, so the
      // debug jump and Mario's restart go back down the one path. A forward
      // sail can never take it: its `to` is always past the current world.
      if (to <= this.sim.archipelago.world) {
        this.sim = new WingsSim({ seed: this.sim.archipelago.seed, world: to });
        // A whole new Scene rather than clearFx: every cached thing in it —
        // craters, wakes, the camera — belongs to a sim that no longer exists.
        // (reset() is not used here: it would cancel the crossing we are
        // standing inside, and the fade has two seconds still to run.)
        this.scene = new Scene();
      } else {
        this.sim.sail(to);
        // Explosions and splashes from the last world would otherwise finish
        // burning at world pixels that are now somewhere else entirely.
        this.scene.clearFx(this.sim);
      }
      mirrored = false;
      wasTurning = false;
      gear = this.sim.plane.gear;
      refreshWorldBadge(this.sim.archipelago.world);
      if (this.onSailSwap) {
        try {
          this.onSailSwap(to);
        } catch (e) {
          console.error('[pilot net]', e);
        }
      }
    }
    // Null the moment the scene ends, so a finished crossing costs the
    // renderer nothing at all.
    const text = jump == null ? this.crossing.text() : this.jumpText(from, jump);
    this.scene.sailView = f.done ? null : { ...f, ...text };
    if (f.finished) this.jump = null;
    return f;
  }

  // One completed stall turn leaves the aeroplane mirrored; two put it back.
  // On the deck it is upright by definition, which is also what makes a
  // respawn or a landing hand the player back a normal stick.
  trackAttitude() {
    const p = this.sim.plane;
    if (p.mode === 'deck' || p.mode === 'roll') {
      mirrored = false;
      wasTurning = false;
      return;
    }
    const turning = this.sim.turnState().turning;
    if (wasTurning && !turning) mirrored = !mirrored;
    wasTurning = turning;
  }

  render() {
    if (this.fatal) return;
    try {
      updateAngleBadge(this.sim);
      this.scene.consume(this.sim);
      this.renderer.beginFrame();
      this.scene.submit(this.renderer, this.sim);
      this.renderer.present();
    } catch (e) {
      this.crash(e);
    }
  }

  crash(e) {
    if (this.fatal) return;
    this.fatal = e;
    console.error('[pilot fatal]', e);
    if (this.loop) this.loop.stop();
  }
}

const pilot = new Pilot();
const ready = pilot.boot().catch((e) => {
  console.error('[pilot boot] failed:', e);
  pilot.crash(e);
  throw e;
});

// ---------------------------------------------------------------------------
// Scripted control API — design spec section 8.2. Mirrors window.__GAME, which
// lives on index.html and is not touched by any of this.
// ---------------------------------------------------------------------------
window.__WINGS = {
  ready,
  get sim() {
    return pilot.sim;
  },
  get renderer() {
    return pilot.renderer;
  },
  get scene() {
    return pilot.scene;
  },

  // Persists across ticks until release(). Unspecified fields default off, so
  // hold({pitch: 1}) also cuts thrust — say what you mean.
  hold(map = {}) {
    scripted = {
      pitch: map.pitch || 0,
      thrust: map.thrust == null ? 0 : map.thrust,
      drop: !!map.drop,
      fire: !!map.fire,
      gear: map.gear == null ? pilot.sim.plane.gear : !!map.gear,
    };
    return true;
  },

  release() {
    scripted = null;
    return true;
  },

  // Advance n fixed steps and render once, ignoring rAF.
  tick(n = 1) {
    for (let i = 0; i < n; i++) {
      pilot.update();
      pilot.loop.tick++;
    }
    pilot.render();
    return pilot.sim.tick;
  },

  // Bot primitives (src/wings/bot.js). Each drives pilot.sim directly —
  // bypassing the keyboard latch and pilot.update() entirely, the same way
  // tick() drives it through pilot.update() — and renders once when done so a
  // screenshot after the call shows where it ended up, not where it started.
  takeoff(budget = 600) {
    const ok = takeoff(pilot.sim, budget);
    pilot.render();
    return ok;
  },

  // `opts` is bot.js's own seek options — {near, speed, floor, dead, gear}.
  // Passed through rather than swallowed because `speed` is the only way a
  // caller can ask the autopilot to ARRIVE SLOWLY, and a scripted flight that
  // has to loiter somewhere needs that: at cruise the aeroplane crosses a
  // 256px screen in under a second, so "fly there and look at it" is not a
  // thing you can express without it.
  flyTo(x, y, budget = 6000, opts = {}) {
    const ok = flyTo(pilot.sim, x, y, budget, opts);
    pilot.render();
    return ok;
  },

  bombTile(island, tx, ty, budget = 8000) {
    const ok = bombTile(pilot.sim, island, tx, ty, budget);
    pilot.render();
    return ok;
  },

  land(budget = 8000) {
    const ok = autoLand(pilot.sim, budget);
    pilot.render();
    return ok;
  },

  state() {
    return pilot.sim.state();
  },

  // The true contact, as the network will supply it from Mario's snapshot.
  setFix(fix) {
    const out = pilot.sim.setFix(fix);
    pilot.render();
    return out;
  },

  radar() {
    return pilot.sim.radarContact();
  },

  events() {
    return pilot.sim.events.map((e) => ({ ...e }));
  },

  // DEBUG speed tuning, the same thing keys 1 and 2 do — exposed so a test can
  // drive it without synthesising key events. No argument reads the setting.
  maxSpeed(v) {
    if (v != null) {
      const out = setMaxSpeed(v);
      pilot.sim.plane.maxSpeed = out;
      showSpeedBadge(out);
      return out;
    }
    return getMaxSpeed();
  },

  respawn() {
    const ok = pilot.sim.respawn();
    pilot.render();
    return ok;
  },

  // THE SAIL, driven by hand. In a match this is started by Mario's client
  // clearing a world and never by anything on this page; the scripted entry
  // point exists so a test — and a solo player, who has no Mario to clear one
  // — can put the group under way. `sail()` with no argument goes to the next
  // world along.
  sail(toWorld) {
    const ok = pilot.sailTo(toWorld == null ? pilot.sim.archipelago.world + 1 : toWorld);
    pilot.render();
    return ok;
  },

  // THE SAME CROSSING, run because Mario's run restarted somewhere else. In a
  // match this is started by his client's `worldReset` and never by anything on
  // this page (src/net/pilot-side.js#onWorldReset); the scripted entry point is
  // here for the same reason sail() has one.
  //
  // NOT the debug world jump below. That refuses to move while a Mario is on
  // the other end, because nothing would carry him along; this is the case
  // where he has ALREADY moved and the group is catching up.
  reposition(toWorld) {
    const ok = pilot.repositionTo(toWorld);
    pilot.render();
    return ok;
  },

  // DEBUG world jump, the same thing [ ] and shift+1..8 do — exposed so a test
  // can drive it without synthesising key events. Refused in multiplayer, for
  // the reasons written out at Pilot#jumpTo. No argument reads the world the
  // archipelago is currently laid out for.
  world(toWorld) {
    if (toWorld == null) return pilot.sim.archipelago.world;
    const ok = pilot.jumpTo(toWorld);
    pilot.render();
    return ok;
  },

  // The crossing as it stands: null when there is none. `world` is where the
  // group is now, which after the swap is the destination. `to` is the real
  // destination whether this is a sail or a debug jump — a jump's Sail carries
  // a clock rather than a course, see Pilot#jumpTo — and `debug` says which.
  crossing() {
    const c = pilot.crossing;
    if (!c.active) return null;
    const f = c.frame();
    return {
      from: c.from,
      to: pilot.jump == null ? c.to : pilot.jump,
      debug: pilot.jump != null,
      world: pilot.sim.archipelago.world,
      phase: f.phase, veil: f.veil, text: f.text, elapsed: f.elapsed,
    };
  },

  reset(opts) {
    pilot.reset(opts);
    pilot.render();
    return true;
  },

  pause() {
    pilot.loop.stop();
    return true;
  },

  resume() {
    pilot.loop.start();
    return true;
  },

  snapshot(type) {
    return pilot.renderer.snapshot(type);
  },

  fatal() {
    return pilot.fatal ? String(pilot.fatal.message || pilot.fatal) : null;
  },
};

export default pilot;
