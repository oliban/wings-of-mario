// Every full-screen state: title (with a live attract demo), the black world
// intro card, pause, game over, the course-clear tally, and options.
//
// All of it paints into the 256x240 buffer with the 8x8 font from hud.js, on
// the HUD layer. Screens never touch gameplay state except where documented
// (the tally converts remaining time into points, the attract demo drives the
// world through the input singleton).
//
// Host contract — main.js drives these four calls:
//
//   screens.attach({ world, renderer, audio });
//   screens.update();                 // once per fixed tick, after input.update()
//   screens.draw(renderer.ctx);       // or screens.submit(renderer)
//   if (!screens.blocksWorld) world.update();
//
// While `screens.hudOwned` is true the active screen paints the status strip
// itself, so the host should not also draw the HUD that frame.

import { SCREEN_W, SCREEN_H, HUD_H, LAYER } from '../core/constants.js';
import { makeSprite } from '../core/gfx.js';
import { Rng } from '../core/rng.js';
import { input, BTN } from '../core/input.js';
import { SKY } from '../data/palette.js';
import { t, cycleLang, getLang, LANG_NAMES } from '../i18n.js';
import { GLYPH, LOGO } from '../data/sprites/font.js';
import * as bossMod from '../data/sprites/boss.js';
import {
  hud,
  drawText,
  drawTextCentered,
  levelLabel,
  pad,
  GLYPH_W,
  PULSE_PALS,
} from './hud.js';

/* --------------------------------------------------------- optional modules */
// Authored in parallel by other agents. A missing module costs one flourish,
// never the screen.

let AUDIO = null;
let SCENERY = null;

if (typeof document !== 'undefined') {
  import('../audio/engine.js')
    .then((m) => {
      AUDIO = AUDIO || m.Audio || m.audio || m.default || null;
    })
    .catch(() => {});
  import('../data/scenery.js')
    .then((m) => {
      SCENERY = m;
    })
    .catch(() => {});
}

function sfx(name) {
  if (!name || !AUDIO) return;
  try {
    if (typeof AUDIO.sfx === 'function') AUDIO.sfx(name);
    else if (typeof AUDIO.play === 'function') AUDIO.play(name);
  } catch (e) {
    /* audio not ready */
  }
}

function music(name) {
  if (!AUDIO) return;
  try {
    if (typeof AUDIO.music === 'function') AUDIO.music(name);
    else if (typeof AUDIO.playMusic === 'function') AUDIO.playMusic(name);
  } catch (e) {
    /* audio not ready */
  }
}

/* ------------------------------------------------------------- persistence */

export const OPTIONS_KEY = 'smb.options.v1';
export const TOPSCORE_KEY = 'smb.topscore.v1';

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null; // Safari private mode throws on access
  }
}

function loadJSON(key) {
  const ls = storage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveJSON(key, value) {
  const ls = storage();
  if (!ls) return false;
  try {
    ls.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

export function topScore() {
  const v = loadJSON(TOPSCORE_KEY);
  return typeof v === 'number' && isFinite(v) ? Math.max(0, v | 0) : 0;
}

export function submitScore(n) {
  const v = Math.max(0, n | 0);
  if (v > topScore()) saveJSON(TOPSCORE_KEY, v);
  return topScore();
}

/* ------------------------------------------------------------------ options */

export const VIDEO_PRESETS = ['pure', 'crisp', 'crt'];
const VOL_STEPS = 10;

export class Options {
  constructor() {
    this.preset = 'crisp';
    this.music = 0.7;
    this.sfx = 0.9;
    this.refs = {};
    this.load();
  }

  load() {
    const o = loadJSON(OPTIONS_KEY);
    if (o && typeof o === 'object') {
      if (VIDEO_PRESETS.includes(o.preset)) this.preset = o.preset;
      if (typeof o.music === 'number') this.music = clamp01(o.music);
      if (typeof o.sfx === 'number') this.sfx = clamp01(o.sfx);
    }
    return this;
  }

  save() {
    saveJSON(OPTIONS_KEY, { preset: this.preset, music: this.music, sfx: this.sfx });
    return this;
  }

  bind(refs = {}) {
    if (refs.renderer) this.refs.renderer = refs.renderer;
    if (refs.audio) {
      this.refs.audio = refs.audio;
      AUDIO = AUDIO || refs.audio;
    }
    return this.apply();
  }

  _renderer() {
    if (this.refs.renderer) return this.refs.renderer;
    if (typeof window !== 'undefined' && window.__GAME) return window.__GAME.renderer || null;
    return null;
  }

  _audio() {
    return this.refs.audio || AUDIO;
  }

  /** Push the stored settings into the renderer and the audio engine. */
  apply() {
    const r = this._renderer();
    const a = this._audio();
    try {
      if (r && typeof r.setPreset === 'function') r.setPreset(this.preset);
    } catch (e) {
      /* renderer not ready */
    }
    try {
      if (a && typeof a.setMusicVolume === 'function') a.setMusicVolume(this.music);
      if (a && typeof a.setSfxVolume === 'function') a.setSfxVolume(this.sfx);
    } catch (e) {
      /* audio not ready */
    }
    return this;
  }

  set(key, value) {
    if (key === 'preset') {
      this.preset = VIDEO_PRESETS.includes(value) ? value : this.preset;
    } else if (key === 'music' || key === 'sfx') {
      this[key] = clamp01(value);
    } else {
      return this;
    }
    return this.apply().save();
  }

  cyclePreset(dir = 1) {
    const i = VIDEO_PRESETS.indexOf(this.preset);
    const n = VIDEO_PRESETS.length;
    return this.set('preset', VIDEO_PRESETS[(((i + dir) % n) + n) % n]);
  }

  nudge(key, dir) {
    const step = 1 / VOL_STEPS;
    return this.set(key, Math.round((this[key] + dir * step) * VOL_STEPS) / VOL_STEPS);
  }
}

function clamp01(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export const options = new Options();

/* -------------------------------------------------------------- UI chrome */

const CHROME_PAL = ['#1a1008', '#8a8a8a', '#d8d8d8', '#ffffff'];
const GOLD_PAL = ['#2a1400', '#a8760c', '#e8c74a', '#fff2b0'];

// Selector arrow. Drawn mirrored for the left-hand one.
const ARROW = makeSprite(
  [
    '........',
    '.30.....',
    '.320....',
    '.3220...',
    '.32220..',
    '.3220...',
    '.320....',
    '.30.....',
  ],
  CHROME_PAL,
  { name: 'ui.arrow' }
);

// Volume meter cells: a filled bevelled block and its empty socket.
const BAR_ON = makeSprite(
  [
    '........',
    '.33333..',
    '.322220.',
    '.322120.',
    '.321120.',
    '.321110.',
    '.311110.',
    '..00000.',
  ],
  GOLD_PAL,
  { name: 'ui.bar.on' }
);

const BAR_OFF = makeSprite(
  [
    '........',
    '.11111..',
    '.1....0.',
    '.1....0.',
    '.1....0.',
    '.1....0.',
    '.111110.',
    '..00000.',
  ],
  ['#0d0a06', '#4a4a4a', '#8a8a8a', '#c0c0c0'],
  { name: 'ui.bar.off' }
);

function drawMeter(ctx, x, y, value) {
  const on = Math.round(clamp01(value) * VOL_STEPS);
  for (let i = 0; i < VOL_STEPS; i++) {
    (i < on ? BAR_ON : BAR_OFF).draw(ctx, x + i * GLYPH_W, y);
  }
  return VOL_STEPS * GLYPH_W;
}

function fillRect(ctx, color, x, y, w, h) {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
}

// A stepped dim so the veil lands on one of four fixed levels instead of a
// continuously blended wash.
function dim(ctx, amount, y = 0, h = SCREEN_H) {
  const a = Math.round(clamp01(amount) * 8) / 8;
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  fillRect(ctx, '#000000', 0, y, SCREEN_W, h);
  ctx.restore();
}

/* ---------------------------------------------------------------- transition */

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const DITHER_TILES = new Map();

function ditherTile(level, color) {
  if (typeof document === 'undefined') return null;
  const key = `${level}|${color}`;
  let cv = DITHER_TILES.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = 4;
  cv.height = 4;
  const c = cv.getContext('2d');
  c.fillStyle = color;
  for (let i = 0; i < 16; i++) {
    if (BAYER4[i] < level) c.fillRect(i & 3, i >> 2, 1, 1);
  }
  DITHER_TILES.set(key, cv);
  return cv;
}

export const TRANSITION_KINDS = ['fade', 'dither', 'wipe', 'iris', 'curtain'];

/**
 * The reusable cover/reveal used between areas, levels and screens.
 *
 *   await transition.cover('dither', 20);   // k: 0 -> 1, screen ends hidden
 *   world.loadLevel(next);
 *   await transition.reveal('dither', 20);  // k: 1 -> 0
 *
 * `update()` must be pumped once per fixed tick for the promises to settle.
 */
export class Transition {
  constructor() {
    this.kind = 'fade';
    this.color = '#000000';
    this.k = 0;
    this.from = 0;
    this.to = 0;
    this.t = 0;
    this.ticks = 0;
    this.active = false;
    this._resolve = null;
  }

  get covered() {
    return this.k >= 0.999;
  }

  get clear() {
    return this.k <= 0.001 && !this.active;
  }

  get done() {
    return !this.active;
  }

  _settle() {
    const r = this._resolve;
    this._resolve = null;
    if (r) r();
  }

  _begin(kind, from, to, ticks, color) {
    this._settle();
    if (kind) this.kind = TRANSITION_KINDS.includes(kind) ? kind : this.kind;
    if (color) this.color = color;
    this.from = from;
    this.to = to;
    this.k = from;
    this.t = 0;
    this.ticks = Math.max(0, ticks | 0);
    if (this.ticks === 0) {
      this.k = to;
      this.active = false;
      return Promise.resolve();
    }
    this.active = true;
    return new Promise((res) => {
      this._resolve = res;
    });
  }

  /** Hide the frame. Resolves when fully covered. */
  cover(kind, ticks = 24, color) {
    return this._begin(kind, this.k, 1, ticks, color);
  }

  /** Bring the frame back. Resolves when fully clear. */
  reveal(kind, ticks = 24, color) {
    return this._begin(kind, this.k, 0, ticks, color);
  }

  /** cover -> await mid() -> reveal. The classic area swap. */
  async run(mid, opts = {}) {
    const kind = opts.kind || this.kind;
    await this.cover(kind, opts.ticks == null ? 20 : opts.ticks, opts.color);
    if (typeof mid === 'function') await mid();
    if (opts.hold) await this.wait(opts.hold);
    await this.reveal(kind, opts.revealTicks == null ? (opts.ticks == null ? 20 : opts.ticks) : opts.revealTicks);
  }

  /** Hold the current coverage for n ticks. */
  wait(ticks) {
    return this._begin(this.kind, this.k, this.k, ticks, null);
  }

  set(k, kind, color) {
    this._settle();
    if (kind) this.kind = kind;
    if (color) this.color = color;
    this.k = clamp01(k);
    this.active = false;
    this.ticks = 0;
    return this;
  }

  reset() {
    return this.set(0);
  }

  update(n = 1) {
    if (!this.active) return this;
    this.t += n;
    const p = this.ticks > 0 ? Math.min(1, this.t / this.ticks) : 1;
    this.k = this.from + (this.to - this.from) * p;
    if (p >= 1) {
      this.k = this.to;
      this.active = false;
      this._settle();
    }
    return this;
  }

  draw(ctx) {
    const k = this.k;
    if (k <= 0.001) return this;
    switch (this.kind) {
      case 'dither':
        this._drawDither(ctx, k);
        break;
      case 'wipe':
        this._drawWipe(ctx, k);
        break;
      case 'iris':
        this._drawIris(ctx, k);
        break;
      case 'curtain':
        this._drawCurtain(ctx, k);
        break;
      default:
        this._drawFade(ctx, k);
        break;
    }
    return this;
  }

  // Quantised alpha: eight steps, so the fade reads as a console fade rather
  // than a smooth CSS crossfade.
  _drawFade(ctx, k) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.round(k * 8) / 8);
    fillRect(ctx, this.color, 0, 0, SCREEN_W, SCREEN_H);
    ctx.restore();
  }

  // Ordered 4x4 dissolve — hard pixels the whole way across.
  _drawDither(ctx, k) {
    const level = Math.round(clamp01(k) * 16);
    if (level >= 16) {
      fillRect(ctx, this.color, 0, 0, SCREEN_W, SCREEN_H);
      return;
    }
    if (level <= 0) return;
    const tile = ditherTile(level, this.color);
    if (!tile) return this._drawFade(ctx, k);
    const pat = ctx.createPattern(tile, 'repeat');
    if (!pat) return this._drawFade(ctx, k);
    ctx.save();
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    ctx.restore();
    return undefined;
  }

  // Solid edge sweeping right, chased by a 12px dithered fringe.
  _drawWipe(ctx, k) {
    const fringe = 12;
    const edge = Math.round(k * (SCREEN_W + fringe));
    if (edge > 0) fillRect(ctx, this.color, 0, 0, Math.min(edge, SCREEN_W), SCREEN_H);
    for (let i = 0; i < fringe; i += 4) {
      const x = edge + i;
      if (x >= SCREEN_W) break;
      const tile = ditherTile(12 - i, this.color);
      if (!tile) break;
      const pat = ctx.createPattern(tile, 'repeat');
      if (!pat) break;
      ctx.save();
      ctx.fillStyle = pat;
      ctx.fillRect(x, 0, 4, SCREEN_H);
      ctx.restore();
    }
  }

  // Scanline-accurate circle so the iris keeps hard pixel edges.
  _drawIris(ctx, k) {
    const cx = SCREEN_W / 2;
    const cy = SCREEN_H / 2;
    const maxR = Math.ceil(Math.sqrt(cx * cx + cy * cy));
    const r = Math.round((1 - clamp01(k)) * maxR);
    ctx.fillStyle = this.color;
    for (let y = 0; y < SCREEN_H; y++) {
      const dy = y + 0.5 - cy;
      const inner = r * r - dy * dy;
      if (inner <= 0) {
        ctx.fillRect(0, y, SCREEN_W, 1);
        continue;
      }
      const hw = Math.sqrt(inner);
      const x0 = Math.round(cx - hw);
      const x1 = Math.round(cx + hw);
      if (x0 > 0) ctx.fillRect(0, y, x0, 1);
      if (x1 < SCREEN_W) ctx.fillRect(x1, y, SCREEN_W - x1, 1);
    }
  }

  _drawCurtain(ctx, k) {
    const h = Math.round(clamp01(k) * (SCREEN_H / 2 + 1));
    if (h <= 0) return;
    fillRect(ctx, this.color, 0, 0, SCREEN_W, h);
    fillRect(ctx, this.color, 0, SCREEN_H - h, SCREEN_W, h);
  }
}

export const transition = new Transition();

/* ---------------------------------------------------------------- backdrop */

const CLOUD_LAYOUT = [];
{
  const r = new Rng(0x0c10d5a1);
  for (let i = 0; i < 7; i++) {
    CLOUD_LAYOUT.push({
      x: r.int(0, SCREEN_W),
      // Kept in the band the logo covers, so drifting art never fights the
      // menu text for contrast.
      y: r.int(40, 104),
      size: r.int(0, 2),
      speed: 0.05 + r.float() * 0.09,
    });
  }
}

function drawDriftingClouds(ctx, t) {
  const C = SCENERY && SCENERY.CLOUD;
  if (!C) return;
  const bank = [C.small, C.medium, C.large].filter(Boolean);
  if (!bank.length) return;
  for (let i = 0; i < CLOUD_LAYOUT.length; i++) {
    const c = CLOUD_LAYOUT[i];
    const s = bank[c.size % bank.length];
    if (!s) continue;
    const span = SCREEN_W + s.w;
    let x = ((c.x - t * c.speed) % span) - s.w;
    if (x < -s.w) x += span;
    s.draw(ctx, Math.floor(x), c.y);
  }
}

/* ------------------------------------------------------------- title screen */

const TITLE = {
  logoX: Math.floor((SCREEN_W - 176) / 2),
  logoY: 38,
  copyY: 134,
  menuX: 88,
  menuY: 152,
  menuStep: 16,
  cursorX: 72,
  // The last menu row ends at menuY + 3*menuStep + 8. Anything less than a full
  // 8px of clear space below that and the TOP line reads as a fifth, broken menu
  // entry rather than a score.
  topY: 220,
};

export const menuItems = () => [t('onePlayer'), t('twoPlayer'), t('harryMode'), t('options')];
export const MENU_ITEMS = menuItems();
export const MENU_RESULTS = ['start1', 'start2', 'harry', 'options'];

export class TitleScreen {
  constructor(opts = {}) {
    this.world = opts.world || null;
    this.items = menuItems();
    this.index = 0;
    this.t = 0;
    this.idle = 0;
    this.showHud = opts.showHud !== false;
    this.attractDelay = opts.attractDelay == null ? 600 : opts.attractDelay;
    this.attractDuration = opts.attractDuration == null ? 900 : opts.attractDuration;
    this.attract = null;
    this.result = null;
    this.top = topScore();

    this._snap = null;
    this._abortFn = null;
    this._aborted = false;
  }

  enter() {
    this.t = 0;
    this.idle = 0;
    this.result = null;
    this.top = topScore();
    this._stopAttract();
    music('title');
    return this;
  }

  exit() {
    this._stopAttract();
    return this;
  }

  get attracting() {
    return !!this.attract;
  }

  update() {
    this.t++;
    if (this.attract) {
      this._updateAttract();
      return this;
    }

    if (input.anyPressedThisFrame) this.idle = 0;
    else this.idle++;

    if (input.pressed(BTN.UP)) this._move(-1);
    if (input.pressed(BTN.DOWN)) this._move(1);
    if (input.pressed(BTN.START) || input.pressed(BTN.JUMP)) {
      sfx('coin');
      this.result = MENU_RESULTS[this.index] || 'start1';
      this.idle = 0;
    }

    if (this.idle >= this.attractDelay) this._startAttract();
    return this;
  }

  _move(d) {
    const n = this.items.length;
    this.index = (((this.index + d) % n) + n) % n;
    this.idle = 0;
    sfx('bump');
  }

  /* ---- attract mode ---- */

  _bindAbort() {
    if (this._abortFn || typeof window === 'undefined') return;
    this._aborted = false;
    this._abortFn = () => {
      this._aborted = true;
    };
    for (const ev of ['keydown', 'pointerdown', 'mousedown', 'touchstart']) {
      window.addEventListener(ev, this._abortFn, true);
    }
  }

  _unbindAbort() {
    if (!this._abortFn || typeof window === 'undefined') return;
    for (const ev of ['keydown', 'pointerdown', 'mousedown', 'touchstart']) {
      window.removeEventListener(ev, this._abortFn, true);
    }
    this._abortFn = null;
  }

  _startAttract() {
    const w = this.world;
    this.idle = 0;
    if (!w || typeof w.update !== 'function') return false;
    const lvl = w.rootLevel || w.level;
    if (!lvl) return false;
    this._snap = { score: w.score | 0, coins: w.coins | 0, lives: w.lives | 0 };
    try {
      w.loadLevel(lvl, null, { resetTime: true, resetPlayer: true, silent: true });
    } catch (e) {
      this._snap = null;
      return false;
    }
    this.attract = { t: 0, rng: new Rng(0x5a17b0ff), hold: 0, since: 0 };
    this._bindAbort();
    return true;
  }

  _stopAttract() {
    const w = this.world;
    const wasOn = !!this.attract;
    this.attract = null;
    this.idle = 0;
    this._unbindAbort();
    if (!wasOn) {
      this._snap = null;
      return;
    }
    try {
      input.release();
    } catch (e) {
      /* ignore */
    }
    if (w && this._snap) {
      const lvl = w.rootLevel || w.level;
      try {
        if (lvl) w.loadLevel(lvl, null, { resetTime: true, resetPlayer: true, silent: true });
        w.score = this._snap.score;
        w.coins = this._snap.coins;
        w.lives = this._snap.lives;
      } catch (e) {
        /* ignore */
      }
    }
    this._snap = null;
  }

  _updateAttract() {
    const w = this.world;
    const a = this.attract;
    if (!w || !a) return this._stopAttract();
    a.t++;

    if (this._aborted) return this._stopAttract();

    try {
      input.force(this._demoInput(w, a));
    } catch (e) {
      /* ignore */
    }
    try {
      w.update();
    } catch (e) {
      return this._stopAttract();
    }

    const over = w.state === 'gameover' || w.state === 'complete';
    if (over || a.t >= this.attractDuration) this._stopAttract();
    return this;
  }

  // A tiny live driver, not a canned tape: hold right + run, and jump when a
  // gap, a wall or an enemy shows up in the next couple of tiles. Everything is
  // read through the documented world API and seeded from a private Rng, so the
  // demo is identical on every run.
  _demoInput(w, a) {
    const out = { right: true, run: true };
    const p = w.player;
    if (!p || p.dead) {
      a.hold = 0;
      return out;
    }
    try {
      const feet = p.y + p.h + 3;
      const front = p.x + p.w;

      let ground = false;
      for (let d = 2; d <= 44 && !ground; d += 6) {
        if (w.solidAt(front + d, feet, 'down')) ground = true;
      }

      const wall =
        w.solidAt(front + 3, p.y + p.h - 5) ||
        w.solidAt(front + 3, p.y + Math.max(2, p.h - 14));

      let enemy = false;
      const list = w.entities || [];
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e || e.removed || e.dead || e.isItem || e.behind) continue;
        const dx = e.x - front;
        if (dx > -2 && dx < 44 && Math.abs(e.y - p.y) < 26) {
          enemy = true;
          break;
        }
      }

      if (p.grounded && a.hold <= 0 && (!ground || wall || enemy)) {
        a.hold = 15 + a.rng.int(0, 7);
      }
      if (p.grounded && a.hold <= 0 && a.t - a.since > 70 && a.rng.chance(0.02)) {
        a.hold = 9 + a.rng.int(0, 5);
        a.since = a.t;
      }
    } catch (e) {
      /* world shape differs — keep running right */
    }

    if (a.hold > 0) {
      out.jump = true;
      a.hold--;
    }
    return out;
  }

  /* ---- draw ---- */

  draw(ctx) {
    this._drawBackdrop(ctx);
    if (this.attract) dim(ctx, 0.5);

    if (LOGO && LOGO.sprite) LOGO.sprite.draw(ctx, TITLE.logoX, TITLE.logoY);

    drawTextCentered(ctx, t('subtitle'), TITLE.copyY);

    // The menu sits over live scenery — hills and bushes are close in value to
    // grey text and swallow it whole. A dim panel behind the block is the whole
    // fix; without it the front door of the game is unreadable.
    // The panel has to reach past the TOP line too — it sits over the same hills,
    // and backing only the menu left the score stranded on a bush.
    const panelY = TITLE.menuY - 6;
    const panelH = TITLE.topY + 12 - panelY;
    ctx.save();
    ctx.globalAlpha = 0.72;
    fillRect(ctx, '#000000', 0, panelY, SCREEN_W, panelH);
    ctx.restore();

    for (let i = 0; i < this.items.length; i++) {
      const y = TITLE.menuY + i * TITLE.menuStep;
      const sel = i === this.index;
      drawText(ctx, this.items[i], TITLE.menuX, y, sel ? null : 'gray');
    }

    // Mario-head cursor with a two-pixel bob.
    const cy = TITLE.menuY + this.index * TITLE.menuStep;
    const bob = (this.t >> 3) % 4 === 1 ? -1 : (this.t >> 3) % 4 === 3 ? 1 : 0;
    GLYPH.cursor.draw(ctx, TITLE.cursorX, cy + bob);

    drawTextCentered(ctx, 'TOP- ' + pad(Math.max(this.top, 0), 6), TITLE.topY, 'gold');

    if (this.showHud) hud.draw(ctx, this.world);
    return this;
  }

  _drawBackdrop(ctx) {
    const w = this.world;
    if (w && w.level && typeof w.draw === 'function') {
      fillRect(ctx, SKY[w.theme] || SKY.overworld, 0, 0, SCREEN_W, SCREEN_H);
      try {
        w.draw(ctx);
        return;
      } catch (e) {
        /* fall through to the plain sky */
      }
    }
    fillRect(ctx, SKY.overworld, 0, 0, SCREEN_W, SCREEN_H);
    drawDriftingClouds(ctx, this.t);
  }
}

/* --------------------------------------------------------- level intro card */

export class LevelIntroCard {
  constructor(opts = {}) {
    this.label = '1-1';
    this.lives = 3;
    this.ticks = opts.ticks == null ? 150 : opts.ticks;
    this.fadeIn = 20;
    this.fadeOut = 20;
    this.t = 0;
    this.running = false;
    this.showHud = opts.showHud !== false;
    this.world = null;
  }

  /**
   * @param {World|null} world  used for the label, life count and status strip
   * @param {object} opts       { label, lives, ticks }
   */
  show(world, opts = {}) {
    this.world = world || null;
    this.label = opts.label || (world ? levelLabel(world) : this.label);
    this.lives = opts.lives != null ? opts.lives : world ? world.lives | 0 : this.lives;
    if (opts.ticks != null) this.ticks = opts.ticks;
    this.t = 0;
    this.running = true;
    return this;
  }

  get finished() {
    return !this.running;
  }

  skip() {
    this.t = Math.max(this.t, this.ticks - this.fadeOut);
    return this;
  }

  update() {
    if (!this.running) return this;
    this.t++;
    if (this.t > 24 && (input.pressed(BTN.START) || input.pressed(BTN.JUMP))) this.skip();
    if (this.t >= this.ticks) this.running = false;
    return this;
  }

  alpha() {
    const t = this.t;
    let a = 1;
    if (t < this.fadeIn) a = t / this.fadeIn;
    else if (t > this.ticks - this.fadeOut) a = (this.ticks - t) / this.fadeOut;
    return Math.max(0, Math.min(1, Math.round(a * 8) / 8));
  }

  draw(ctx) {
    fillRect(ctx, '#000000', 0, 0, SCREEN_W, SCREEN_H);
    if (this.showHud) hud.draw(ctx, this.world);

    const a = this.alpha();
    if (a <= 0) return this;
    ctx.save();
    ctx.globalAlpha = a;

    drawTextCentered(ctx, t('world') + ' ' + this.label, 88);

    // [head]  x  N   — head, gap, times sign, gap, digits, centred as one unit.
    const lives = String(Math.max(0, Math.min(99, this.lives | 0)));
    const rowW = GLYPH_W * (4 + lives.length);
    let x = Math.floor((SCREEN_W - rowW) / 2);
    GLYPH.marioHead.draw(ctx, x, 120);
    x += GLYPH_W * 2;
    drawText(ctx, '×', x, 120);
    x += GLYPH_W * 2;
    drawText(ctx, lives, x, 120);

    ctx.restore();
    return this;
  }
}

/* ------------------------------------------------------------ pause overlay */

export class PauseOverlay {
  constructor(opts = {}) {
    this.shown = false;
    this.t = 0;
    this.dimHud = opts.dimHud === true;
    this.amount = opts.amount == null ? 0.5 : opts.amount;
  }

  show() {
    if (this.shown) return this;
    this.shown = true;
    this.t = 0;
    hud.setPaused(true);
    sfx('pause');
    return this;
  }

  hide() {
    if (!this.shown) return this;
    this.shown = false;
    hud.setPaused(false);
    sfx('unpause');
    return this;
  }

  toggle() {
    return this.shown ? this.hide() : this.show();
  }

  update() {
    if (this.shown) this.t++;
    return this;
  }

  draw(ctx) {
    if (!this.shown) return this;
    const top = this.dimHud ? 0 : HUD_H;
    dim(ctx, this.amount, top, SCREEN_H - top);
    // Soft breathing pulse done by palette step, so the letters stay solid.
    const pal = PULSE_PALS[(this.t >> 3) % PULSE_PALS.length];
    drawTextCentered(ctx, t('pause'), 112, pal);
    return this;
  }
}

/* ------------------------------------------------------------- game over */


// boss.js exports TOAD as { idle } (or a bare Sprite); resolve either shape.
function artOf(mod, names) {
  if (!mod) return null;
  for (const n of names) {
    const v = mod[n];
    if (!v) continue;
    if (typeof v.draw === 'function' || typeof v.frame === 'function') return v;
    for (const k of ['idle', 'sprite', 'still', 'anim']) {
      const c = v[k];
      if (c && (typeof c.draw === 'function' || typeof c.frame === 'function')) return c;
    }
  }
  return null;
}

export class GameOverScreen {
  constructor(opts = {}) {
    this.t = 0;
    this.running = false;
    this.hold = opts.hold == null ? 260 : opts.hold;
    this.showHud = opts.showHud !== false;
    this.world = null;
  }

  show(world) {
    this.world = world || null;
    this.t = 0;
    this.running = true;
    if (world) submitScore(world.score | 0);
    music('game-over');
    return this;
  }

  get finished() {
    return !this.running;
  }

  update() {
    if (!this.running) return this;
    this.t++;
    if (this.t > 60 && (input.pressed(BTN.START) || input.pressed(BTN.JUMP))) this.running = false;
    if (this.t >= this.hold) this.running = false;
    return this;
  }

  draw(ctx) {
    fillRect(ctx, '#000000', 0, 0, SCREEN_W, SCREEN_H);
    if (this.showHud) hud.draw(ctx, this.world);

    // Toad's "the game is yet to be built" line lives on the castle ending, which
    // is where SMB puts him; a game over is just a game over.
    const toad = artOf(bossMod, ['TOAD']);
    const s = toad && (toad.frame ? toad.frame(this.t) : toad);
    if (s && typeof s.draw === 'function') {
      s.draw(ctx, (SCREEN_W - s.w) >> 1, 76);
    }
    drawTextCentered(ctx, t('gameOver'), 120);
    if (this.t > 110 && this.t % 48 < 30) {
      drawTextCentered(ctx, t('pushStart'), 150, 'gray');
    }
    return this;
  }
}

/* --------------------------------------------------- level complete tally */

export class LevelCompleteTally {
  constructor(opts = {}) {
    this.world = null;
    this.label = '1-1';
    this.time = 0;
    this.startTime = 0;
    this.points = 0;
    this.t = 0;
    this.phase = 'intro';
    this.running = false;
    this.showHud = opts.showHud !== false;
    this.introTicks = opts.introTicks == null ? 54 : opts.introTicks;
    this.holdTicks = opts.holdTicks == null ? 96 : opts.holdTicks;
    this._ticks = 0;
  }

  /**
   * `opts.time` overrides the reading taken from the world, which matters when
   * the host already ran World's own end-of-level countdown.
   */
  show(world, opts = {}) {
    this.world = world || null;
    this.time = Math.max(0, (opts.time != null ? opts.time : world ? world.time : 0) | 0);
    this.startTime = this.time;
    this.label = opts.label || (world ? levelLabel(world) : this.label);
    this.points = 0;
    this.t = 0;
    this._ticks = 0;
    this.phase = 'intro';
    this.running = true;
    music('level-complete');
    return this;
  }

  get finished() {
    return !this.running;
  }

  skip() {
    while (this.time > 0) this._convert();
    this.phase = 'hold';
    this.t = 0;
    return this;
  }

  // 50 points per remaining unit, mirrored into the world so the strip agrees.
  _convert() {
    if (this.time <= 0) return false;
    this.time--;
    this.points += 50;
    const w = this.world;
    if (w) {
      w.score = (w.score | 0) + 50;
      if ((w.time | 0) > 0) w.time = (w.time | 0) - 1;
    }
    return true;
  }

  update() {
    if (!this.running) return this;
    this.t++;
    if (this.phase !== 'hold' && (input.pressed(BTN.START) || input.pressed(BTN.JUMP))) {
      this.skip();
      return this;
    }

    if (this.phase === 'intro') {
      if (this.t >= this.introTicks) {
        this.phase = 'count';
        this.t = 0;
      }
      return this;
    }

    if (this.phase === 'count') {
      const step = this.time > 150 ? 2 : 1;
      let moved = false;
      for (let i = 0; i < step; i++) moved = this._convert() || moved;
      if (moved && this._ticks++ % 2 === 0) sfx('coin');
      if (this.time <= 0) {
        this.phase = 'hold';
        this.t = 0;
      }
      return this;
    }

    if (this.t >= this.holdTicks) this.running = false;
    return this;
  }

  draw(ctx) {
    fillRect(ctx, '#000000', 0, 0, SCREEN_W, SCREEN_H);
    if (this.showHud) hud.draw(ctx, this.world);

    drawTextCentered(ctx, t('courseClear'), 72, 'gold');
    drawTextCentered(ctx, t('world') + ' ' + this.label, 90);

    if (this.phase !== 'intro') {
      drawTextCentered(ctx, 'TIME ' + pad(this.time, 3) + ' × 50', 130);
      const counting = this.phase === 'count';
      const pal = counting ? (this.t & 4 ? 'gold' : 'amber') : 'gold';
      drawTextCentered(ctx, 'POINTS ' + pad(this.points, 5), 150, pal);
    }
    return this;
  }
}

/* ------------------------------------------------------------ options screen */

const OPT_ROWS = ['video', 'music', 'sfx', 'lang', 'back'];
// A FUNCTION, not a table. The old `{ video: t('video'), ... }` was evaluated
// once at module load, so every label froze in whatever language booted first —
// invisible until this screen grew a language row, and then the one row you
// cannot read is the one telling you how to change the language.
const optLabel = (row) =>
  ({ video: t('video'), music: t('music'), sfx: t('sound'), lang: t('language'), back: t('back') })[row];
// Tightened from 18px to 16px spacing to fit a fifth row: the glyphs are 8px,
// so the last row now ends at 128 and still clears the divider at 136.
const OPT_Y = [56, 72, 88, 104, 120];
const OPT_LABEL_X = 48;
const OPT_VALUE_X = 144;
const OPT_CURSOR_X = 32;

const CONTROL_HELP = [
  'MOVE    ARROWS / A D',
  'JUMP    Z / SPACE',
  'RUN     X / SHIFT',
  'PAUSE   ENTER',
  'FILTER  F',
];

export class OptionsScreen {
  constructor(opts = {}) {
    this.index = 0;
    this.t = 0;
    this.running = false;
    this.options = opts.options || options;
  }

  enter() {
    this.index = 0;
    this.t = 0;
    this.running = true;
    return this;
  }

  get finished() {
    return !this.running;
  }

  close() {
    this.running = false;
    this.options.save();
    return this;
  }

  update() {
    if (!this.running) return this;
    this.t++;
    const n = OPT_ROWS.length;
    if (input.pressed(BTN.UP)) {
      this.index = (this.index + n - 1) % n;
      sfx('bump');
    }
    if (input.pressed(BTN.DOWN)) {
      this.index = (this.index + 1) % n;
      sfx('bump');
    }
    if (input.pressed(BTN.LEFT)) this._adjust(-1);
    if (input.pressed(BTN.RIGHT)) this._adjust(1);
    if (input.pressed(BTN.START) || input.pressed(BTN.JUMP)) {
      if (OPT_ROWS[this.index] === 'back') this.close();
      else this._adjust(1);
    }
    // SELECT and BACK both leave, from any row. BACK is Escape, which used to be
    // an alias of START and so ADJUSTED whatever row was highlighted — pressing
    // Escape on VIDEO cycled the video preset instead of backing out, which is
    // the opposite of what Escape means everywhere else.
    if (input.pressed(BTN.SELECT) || input.pressed(BTN.BACK)) this.close();
    return this;
  }

  _adjust(dir) {
    const row = OPT_ROWS[this.index];
    const o = this.options;
    if (row === 'video') {
      o.cyclePreset(dir);
      sfx('coin');
    } else if (row === 'music') {
      o.nudge('music', dir);
      sfx('bump');
    } else if (row === 'sfx') {
      o.nudge('sfx', dir);
      sfx('coin'); // audition the new level
    } else if (row === 'lang') {
      cycleLang(dir);
      sfx('coin');
    } else if (row === 'back' && dir > 0) {
      this.close();
    }
    return this;
  }

  draw(ctx) {
    fillRect(ctx, '#000000', 0, 0, SCREEN_W, SCREEN_H);
    drawTextCentered(ctx, t('options'), 24, 'gold');

    const o = this.options;
    for (let i = 0; i < OPT_ROWS.length; i++) {
      const row = OPT_ROWS[i];
      const y = OPT_Y[i];
      const sel = i === this.index;
      drawText(ctx, optLabel(row), OPT_LABEL_X, y, sel ? null : 'gray');

      if (row === 'video') {
        drawText(ctx, o.preset.toUpperCase(), OPT_VALUE_X, y, sel ? 'gold' : 'gray');
      } else if (row === 'music' || row === 'sfx') {
        drawMeter(ctx, OPT_VALUE_X, y, o[row]);
      } else if (row === 'lang') {
        drawText(ctx, LANG_NAMES[getLang()], OPT_VALUE_X, y, sel ? 'gold' : 'gray');
      }

      if (sel) {
        GLYPH.cursor.draw(ctx, OPT_CURSOR_X, y);
        if (row !== 'back') {
          const pulse = (this.t >> 3) & 1 ? 1 : 0;
          ARROW.draw(ctx, 128 - pulse, y, true);
          ARROW.draw(ctx, 232 + pulse, y);
        }
      }
    }

    drawText(ctx, '--------------------------', 24, 136, 'dim');
    drawTextCentered(ctx, t('controls'), 150, 'gold');
    for (let i = 0; i < CONTROL_HELP.length; i++) {
      drawText(ctx, CONTROL_HELP[i], OPT_LABEL_X, 168 + i * 12, 'gray');
    }
    return this;
  }
}


/* ------------------------------------------------- castle end (Toad scene) */

// SMB's castle ending: Toad thanks Mario and points him at the next castle.
// Here it doubles as the honest end-of-content card, since World 1 is all the
// game currently has.
export class CastleEndScreen {
  constructor(opts = {}) {
    this.t = 0;
    this.running = false;
    this.hold = opts.hold == null ? 420 : opts.hold;
    this.showHud = opts.showHud !== false;
    this.world = null;
    this.lines = null;
  }

  show(world, opts = {}) {
    this.world = world || null;
    this.lines = opts.lines || null;
    this.t = 0;
    this.running = true;
    music('level-complete');
    return this;
  }

  get finished() {
    return !this.running;
  }

  update() {
    if (!this.running) return this;
    this.t++;
    if (this.t > 90 && (input.pressed(BTN.START) || input.pressed(BTN.JUMP))) this.running = false;
    if (this.t >= this.hold) this.running = false;
    return this;
  }

  draw(ctx) {
    fillRect(ctx, '#000000', 0, 0, SCREEN_W, SCREEN_H);
    if (this.showHud) hud.draw(ctx, this.world);

    const toad = artOf(bossMod, ['TOAD']);
    const s = toad && (toad.frame ? toad.frame(this.t) : toad);
    if (s && typeof s.draw === 'function') s.draw(ctx, (SCREEN_W - s.w) >> 1, 72);

    const lines = this.lines || [
      t('thankYou'),
      'BUT THE GAME IS YET',
      'TO BE COMPLETELY BUILT',
    ];
    for (let i = 0; i < lines.length; i++) {
      drawTextCentered(ctx, lines[i], 116 + i * 12, i === 0 ? 'gold' : 'white');
    }
    if (this.t > 150 && this.t % 48 < 30) {
      drawTextCentered(ctx, t('pushStart'), 176, 'gray');
    }
    return this;
  }
}

/* --------------------------------------------------------------- manager */

const BLOCKING = new Set(['title', 'intro', 'options', 'gameover', 'tally', 'pause', 'castle']);

export class Screens {
  constructor(opts = {}) {
    this.title = new TitleScreen(opts.title);
    this.intro = new LevelIntroCard(opts.intro);
    this.pause = new PauseOverlay(opts.pause);
    this.gameOver = new GameOverScreen(opts.gameOver);
    this.tally = new LevelCompleteTally(opts.tally);
    this.castle = new CastleEndScreen(opts.castle);
    this.options = new OptionsScreen({ options });
    this.settings = options;
    this.transition = transition;

    this.state = 'none';
    this.world = null;
    this.renderer = null;
    this.audio = null;

    // The menu row the cursor is ON right now, before anything is confirmed:
    // 'start1' | 'start2' | 'harry' | 'options', or null when the title menu is
    // not the screen in front of you. The page chrome outside the canvas reads
    // this — the key legend reveals the toolbelt controls while HARRY MODE is
    // highlighted — so it is a deliberate public accessor, not internals anyone
    // should be reaching past.
    Object.defineProperty(this, 'menuChoice', {
      get: () => (this.state === 'title' ? MENU_RESULTS[this.title.index] || null : null),
    });

    /** Fired with 'start1' | 'start2' when the title menu is confirmed. */
    this.onSelect = null;
    /** Fired when the pause overlay is dismissed with START. */
    this.onResume = null;

    this._resolvers = Object.create(null);
    this._returnTo = null;
    this._prePause = null;
  }

  attach(refs = {}) {
    if (refs.world !== undefined) this.setWorld(refs.world);
    if (refs.renderer) this.renderer = refs.renderer;
    if (refs.audio) {
      this.audio = refs.audio;
      AUDIO = AUDIO || refs.audio;
    }
    options.bind({ renderer: this.renderer, audio: this.audio });
    return this;
  }

  setWorld(world) {
    this.world = world || null;
    this.title.world = this.world;
    return this;
  }

  get active() {
    return this.state;
  }

  /** True while the host should not run world.update() itself. */
  get blocksWorld() {
    return BLOCKING.has(this.state);
  }

  /** True while the active screen paints the status strip on the host's behalf. */
  get hudOwned() {
    switch (this.state) {
      case 'title':
        return this.title.showHud;
      case 'intro':
        return this.intro.showHud;
      case 'gameover':
        return this.gameOver.showHud;
      case 'tally':
        return this.tally.showHud;
      case 'options':
        return false;
      default:
        return false;
    }
  }

  _promise(key) {
    const prev = this._resolvers[key];
    this._resolvers[key] = null;
    if (prev) prev();
    return new Promise((res) => {
      this._resolvers[key] = res;
    });
  }

  _settle(key) {
    const r = this._resolvers[key];
    this._resolvers[key] = null;
    if (r) r();
  }

  /** Drop straight back to gameplay, settling anything the host was awaiting. */
  hide() {
    if (this.state === 'title') this.title.exit();
    if (this.state === 'pause') this.pause.hide();
    this.intro.running = false;
    this.gameOver.running = false;
    this.tally.running = false;
    this.options.running = false;
    this._returnTo = null;
    this._prePause = null;
    this.state = 'none';
    for (const key of Object.keys(this._resolvers)) this._settle(key);
    return this;
  }

  /* ---- entry points ---- */

  /** Enter the title state. Resolves as soon as the screen is up. */
  showTitle(opts = {}) {
    if (opts.world !== undefined) this.setWorld(opts.world);
    this.state = 'title';
    this.title.enter();
    return Promise.resolve(this);
  }

  /** The black WORLD n-m card. Resolves when it has faded out. */
  showIntro(world, opts) {
    this.intro.show(world === undefined ? this.world : world, opts);
    this.state = 'intro';
    return this._promise('intro');
  }

  /** Resolves when the game-over hold ends or START is pressed. */
  /** Resolves when the castle ending is dismissed or its hold expires. */
  showCastleEnd(world, opts = {}) {
    this.castle.show(world === undefined ? this.world : world, opts);
    this.state = 'castle';
    return this._promise('castle');
  }

  showGameOver(world, opts = {}) {
    this.gameOver.show(world === undefined ? this.world : world);
    if (opts.hold != null) this.gameOver.hold = opts.hold;
    this.state = 'gameover';
    return this._promise('gameover');
  }

  /** Resolves once every remaining time unit has been converted and held. */
  showTally(world, opts) {
    this.tally.show(world === undefined ? this.world : world, opts);
    this.state = 'tally';
    return this._promise('tally');
  }

  /** Resolves when the player backs out of the options menu. */
  showOptions() {
    this.options.enter();
    this.state = 'options';
    return this._promise('options');
  }

  setPaused(on) {
    const want = on === undefined ? this.state !== 'pause' : !!on;
    if (want) {
      if (this.state === 'pause') return this;
      this._prePause = this.state;
      this.pause.show();
      this.state = 'pause';
    } else {
      if (this.state !== 'pause') return this;
      this.pause.hide();
      this.state = this._prePause === 'pause' ? 'none' : this._prePause || 'none';
      this._prePause = null;
      if (typeof this.onResume === 'function') this.onResume();
    }
    return this;
  }

  togglePause() {
    return this.setPaused();
  }

  /* ---- loop ---- */

  update() {
    this.transition.update();
    switch (this.state) {
      case 'title': {
        this.title.update();
        const r = this.title.result;
        if (r) {
          this.title.result = null;
          if (r === 'options') {
            this._returnTo = 'title';
            this.title.exit();
            this.showOptions();
          } else {
            this.title.exit();
            this.state = 'none';
            if (typeof this.onSelect === 'function') this.onSelect(r);
          }
        }
        break;
      }
      case 'options':
        this.options.update();
        if (this.options.finished) {
          this._settle('options');
          if (this._returnTo === 'title') {
            this._returnTo = null;
            this.showTitle();
          } else {
            this.state = 'none';
          }
        }
        break;
      case 'intro':
        this.intro.update();
        if (this.intro.finished) {
          this.state = 'none';
          this._settle('intro');
        }
        break;
      case 'gameover':
        this.gameOver.update();
        if (this.gameOver.finished) {
          this.state = 'none';
          this._settle('gameover');
        }
        break;
      case 'castle':
        this.castle.update();
        if (this.castle.finished) {
          this.state = 'none';
          this._settle('castle');
        }
        break;
      case 'tally':
        this.tally.update();
        if (this.tally.finished) {
          this.state = 'none';
          this._settle('tally');
        }
        break;
      case 'pause':
        this.pause.update();
        if (input.pressed(BTN.START)) this.setPaused(false);
        break;
      default:
        break;
    }
    return this;
  }

  draw(ctx) {
    switch (this.state) {
      case 'title':
        this.title.draw(ctx);
        break;
      case 'intro':
        this.intro.draw(ctx);
        break;
      case 'options':
        this.options.draw(ctx);
        break;
      case 'gameover':
        this.gameOver.draw(ctx);
        break;
      case 'castle':
        this.castle.draw(ctx);
        break;
      case 'tally':
        this.tally.draw(ctx);
        break;
      case 'pause':
        this.pause.draw(ctx);
        break;
      default:
        break;
    }
    this.transition.draw(ctx);
    return this;
  }

  /** Queue draw() on the renderer's HUD layer. */
  submit(renderer) {
    const r = renderer || this.renderer;
    if (!r) return this;
    r.draw(LAYER.HUD, (ctx) => this.draw(ctx));
    return this;
  }
}

export const screens = new Screens();
export default screens;
