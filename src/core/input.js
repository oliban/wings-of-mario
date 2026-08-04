export const BTN = {
  LEFT: 'left',
  RIGHT: 'right',
  UP: 'up',
  DOWN: 'down',
  JUMP: 'jump',
  RUN: 'run',
  START: 'start',
  SELECT: 'select',
  // Escape's own identity. It used to be an alias of START, which meant that in
  // the options screen it ADJUSTED the highlighted row instead of leaving —
  // pressing Escape on VIDEO cycled the video preset. Nothing on the joypad maps
  // to BACK; it is a keyboard convenience.
  BACK: 'back',
};

// Two independent pads so both brothers can play at once. Up stays a pure
// DIRECTION on both: Mario treats it as a jump during play (player._jumpPressed),
// but menus read JUMP as "confirm", so binding the two together made pressing Up
// to move the cursor also pick the highlighted item.
export const KEYMAP_P1 = {
  ArrowLeft: BTN.LEFT,
  ArrowRight: BTN.RIGHT,
  ArrowUp: BTN.UP,
  ArrowDown: BTN.DOWN,
  Space: BTN.JUMP,
  KeyK: BTN.JUMP,
  KeyX: BTN.RUN,
  KeyJ: BTN.RUN,
  Period: BTN.RUN,
  Enter: BTN.START,
  Escape: BTN.BACK,
  // SELECT throws the toolbelt's brick bomb, so it needs a key a hand can reach
  // during play. Tab nominally works but the browser also moves focus with it.
  KeyC: BTN.SELECT,
  Tab: BTN.SELECT,
};

// Luigi: the ASDF cluster plus Z to run.
export const KEYMAP_P2 = {
  KeyA: BTN.LEFT,
  KeyD: BTN.RIGHT,
  KeyW: BTN.UP,
  KeyS: BTN.DOWN,
  KeyF: BTN.JUMP,
  KeyZ: BTN.RUN,
  ShiftLeft: BTN.RUN,
};

const PADMAP = {
  0: BTN.JUMP,
  1: BTN.RUN,
  2: BTN.RUN,
  3: BTN.JUMP,
  9: BTN.START,
  8: BTN.SELECT,
  12: BTN.UP,
  13: BTN.DOWN,
  14: BTN.LEFT,
  15: BTN.RIGHT,
};

export class Pad {
  constructor(keymap, opts = {}) {
    this.keymap = keymap;
    this.gamepadIndex = opts.gamepad == null ? 0 : opts.gamepad;
    this.useGamepad = opts.gamepad !== false;
    this.state = {};
    this.prev = {};
    this._raw = {};
    this._virtual = {};
    this._forced = null;
    for (const b of Object.values(BTN)) {
      this.state[b] = false;
      this.prev[b] = false;
      this._raw[b] = false;
      this._virtual[b] = false;
    }
    this.anyPressedThisFrame = false;
  }

  handleKey(code, down) {
    const b = this.keymap[code];
    if (!b) return false;
    if (Array.isArray(b)) for (const k of b) this._raw[k] = down;
    else this._raw[b] = down;
    return true;
  }

  // On-screen / touch pad presses. They live in their own layer so a stuck
  // virtual button can be released without wiping the keyboard, and so nothing
  // outside this module has to poke at _raw.
  setVirtual(b, down) {
    if (!(b in this._virtual)) return false;
    this._virtual[b] = !!down;
    return true;
  }

  clearVirtual() {
    for (const k in this._virtual) this._virtual[k] = false;
  }

  clear() {
    for (const k in this._raw) this._raw[k] = false;
    this.clearVirtual();
  }

  // Instantaneous merged input, independent of the fixed-tick cadence and of
  // force(): the on-screen pad lights up from this, so it keeps reflecting the
  // keyboard even while the world is paused, and a scripted run still looks
  // like whatever the human is really holding.
  live() {
    const now = {};
    for (const b of Object.values(BTN)) now[b] = !!(this._raw[b] || this._virtual[b]);
    this._pollGamepad(now);
    return now;
  }

  _pollGamepad(into) {
    if (!this.useGamepad || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    const p = pads && pads[this.gamepadIndex];
    if (!p) return;
    for (const i in PADMAP) {
      if (p.buttons[i] && p.buttons[i].pressed) into[PADMAP[i]] = true;
    }
    const ax = p.axes[0] || 0;
    const ay = p.axes[1] || 0;
    if (ax < -0.4) into[BTN.LEFT] = true;
    if (ax > 0.4) into[BTN.RIGHT] = true;
    if (ay < -0.4) into[BTN.UP] = true;
    if (ay > 0.4) into[BTN.DOWN] = true;
  }

  // Called once per fixed tick, before systems read input.
  update() {
    const now = this.live();

    this.anyPressedThisFrame = false;
    for (const b of Object.values(BTN)) {
      this.prev[b] = this.state[b];
      this.state[b] = this._forced ? !!this._forced[b] : now[b];
      if (this.state[b] && !this.prev[b]) this.anyPressedThisFrame = true;
    }
  }

  down(b) {
    return !!this.state[b];
  }
  pressed(b) {
    return !!this.state[b] && !this.prev[b];
  }
  released(b) {
    return !this.state[b] && !!this.prev[b];
  }

  // Scripted input for demos, cutscenes and automated screenshots.
  force(map) {
    this._forced = map;
  }
  release() {
    this._forced = null;
  }
}

export const input = new Pad(KEYMAP_P1, { gamepad: 0 });
export const pad2 = new Pad(KEYMAP_P2, { gamepad: 1 });
export const pads = [input, pad2];

let attached = false;

// One listener feeds both pads: a key belongs to whichever map claims it.
export function attach(target = window) {
  if (attached) return;
  attached = true;
  const set = (e, down) => {
    let claimed = false;
    for (const p of pads) if (p.handleKey(e.code, down)) claimed = true;
    if (claimed) e.preventDefault();
  };
  target.addEventListener('keydown', (e) => set(e, true));
  target.addEventListener('keyup', (e) => set(e, false));
  target.addEventListener('blur', () => {
    for (const p of pads) p.clear();
  });
}

export function updateAll() {
  for (const p of pads) p.update();
}

// Back-compat: main.js and the screens call input.attach(window).
input.attach = attach;

export default input;
