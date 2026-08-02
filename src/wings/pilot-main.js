import { bakeAll } from '../core/gfx.js';
import { GameLoop } from '../core/loop.js';
import { PilotRenderer } from './pilot-renderer.js';
import { Scene } from './scene.js';
import { WingsSim } from './sim.js';

const HEADLESS = new URLSearchParams(location.search).has('headless');
if (HEADLESS) document.body.classList.add('headless');

// The pilot owns its own keyboard rather than borrowing core/input.js: that Pad
// is Mario's, its two maps are already spoken for, and a second consumer of the
// same key events is a bug waiting to happen.
const KEYMAP = {
  ArrowUp: 'up',
  ArrowDown: 'down',
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
};

const keys = Object.create(null);
let scripted = null;
let gear = true;

// Weapon releases are edge-triggered, and a press-and-release can easily land
// entirely between two simulation ticks (or several, on a dropped frame).
// So a keydown LATCHES here and the latch is cleared once the tick that saw
// it has run: a tap is never eaten, and holding the key still spends exactly
// one round, because the browser's auto-repeat keydowns are filtered out
// before they ever reach the latch.
const pending = { drop: false, fire: false };

function readKeys() {
  if (scripted) return scripted;
  return {
    // Pitch is body-relative — Up always noses up, Down always noses down —
    // and unaffected by which way the aeroplane is facing.
    pitch: (keys.up ? 1 : 0) + (keys.down ? -1 : 0),
    // Thrust is a WORLD-frame direction, not a lever position: Right always
    // means "thrust East", Left "thrust West". See flight.js's stepAir for
    // how that becomes acceleration, deceleration, or a stall turn depending
    // on which way the aeroplane is actually travelling.
    thrust: (keys.right ? 1 : 0) + (keys.left ? -1 : 0),
    drop: pending.drop,
    fire: pending.fire,
    gear,
  };
}

class Pilot {
  constructor() {
    this.renderer = null;
    this.sim = null;
    this.scene = null;
    this.loop = null;
    this.fatal = null;
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

  reset(opts = {}) {
    this.sim = new WingsSim({ squadron: opts.squadron });
    this.scene = new Scene();
    gear = true;
    scripted = null;
    pending.drop = false;
    pending.fire = false;
    return this.sim;
  }

  key(e, down) {
    const name = KEYMAP[e.code];
    if (!name) return;
    e.preventDefault();
    if (down && !keys[name]) {
      if (name === 'gear') gear = !gear;
      if (name === 'drop') pending.drop = true;
      if (name === 'fire') pending.fire = true;
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
      // The tick has seen the latch; a second tick must not fire the same
      // press again.
      pending.drop = false;
      pending.fire = false;
      // The model raises the hook on rotation and lowers it again on the wire.
      // Without mirroring that back, the next tick's input would re-assert the
      // player's stale toggle and the hook would never actually come up.
      // Scripted input stays authoritative — hold() means what it says.
      if (!scripted) gear = this.sim.plane.gear;
    } catch (e) {
      this.crash(e);
    }
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

  state() {
    return pilot.sim.state();
  },

  events() {
    return pilot.sim.events.map((e) => ({ ...e }));
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
