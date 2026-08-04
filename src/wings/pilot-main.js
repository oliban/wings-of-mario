import { bakeAll } from '../core/gfx.js';
import { GameLoop } from '../core/loop.js';
import { PilotRenderer } from './pilot-renderer.js';
import { Scene } from './scene.js';
import { WingsSim } from './sim.js';
import { takeoff, flyTo, bombTile, autoLand } from './bot.js';
import { SPEED_TUNE, getMaxSpeed, setMaxSpeed } from './flight.js';

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
  // SPEED_TUNE in flight.js. Digits were unbound before this, and they stay
  // out of the browser's way because the modifier guard in key() hands
  // Cmd-1 (tab switching) straight back to Chrome untouched.
  Digit1: 'speedDown',
  Digit2: 'speedUp',
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

function showSpeedBadge(value) {
  if (typeof document === 'undefined') return;
  if (!speedBadge) {
    speedBadge = document.createElement('div');
    speedBadge.id = 'wings-debug-speed';
    speedBadge.style.cssText = [
      'position:fixed', 'left:8px', 'bottom:8px', 'z-index:50',
      'padding:4px 8px', 'border-radius:4px', 'pointer-events:none',
      'background:rgba(20,0,0,.82)', 'border:1px solid #d34',
      'color:#ffb0b8', 'font:11px/1.4 ui-monospace,Menlo,monospace',
      'letter-spacing:.08em', 'white-space:pre',
    ].join(';');
    document.body.appendChild(speedBadge);
  }
  const at = value === SPEED_TUNE.DEFAULT ? '  (default)'
    : value === SPEED_TUNE.MIN ? '  (min)'
      : value === SPEED_TUNE.MAX ? '  (max)' : '';
  speedBadge.textContent = `DEBUG  MAX SPEED ${value.toFixed(1)}${at}\n1 slower   2 faster`;
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
    const name = KEYMAP[e.code];
    if (!name) return;
    e.preventDefault();
    if (down && !keys[name]) {
      if (name === 'gear') gear = !gear;
      if (name === 'drop') pending.drop = true;
      if (name === 'fire') pending.fire = true;
      if (name === 'speedDown') speedTune(this.sim, -1);
      if (name === 'speedUp') speedTune(this.sim, +1);
      if (name === 'respawn' && this.sim.plane.mode === 'down') {
        this.sim.respawn();
      }
    }
    keys[name] = down;
  }

  update() {
    if (this.fatal) return;
    try {
      this.sim.step(readKeys());
      // The tick has seen the latch; a second tick must not re-fire the same
      // press. What keeps the gun going after this is the held key itself,
      // not the latch.
      pending.drop = false;
      pending.fire = false;
      this.trackAttitude();
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
