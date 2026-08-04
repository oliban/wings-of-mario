// The status strip and the shared 8x8 text layer.
//
// Everything the UI ever prints goes through `drawText()`, which lays out the
// bevelled glyphs from src/data/sprites/font.js on a hard 8px grid. Recolouring
// is done by baking a per-palette glyph set on first use, so a palette swap is
// still one drawImage per character and never an alpha blend — the font keeps
// its authored drop shadow and hard edges in every colour.
//
// Layout follows the NES status bar exactly (all values in buffer pixels):
//
//   y=16   MARIO                      WORLD          TIME
//   y=24   000000    (c)x00            1-1            400
//   x=     24        88 96 104        144/152        200/208
//
// The strip lives entirely inside the top 32px (constants.HUD_H) and never
// touches the play field.

import { SCREEN_W, HUD_H, LAYER } from '../core/constants.js';
// aliased: hud.js already uses a local `t` for the tick counter.
import { t as tr } from '../i18n.js';
import { makeSprite } from '../core/gfx.js';
import { FONT, FONT_PAL_WHITE, FONT_PAL_DARK, GLYPH } from '../data/sprites/font.js';

export const GLYPH_W = 8;
export const GLYPH_H = 8;

/* ------------------------------------------------------------------ colour */

function hex2(v) {
  const n = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  return (n < 16 ? '0' : '') + n.toString(16);
}

// Multiply a '#rgb' / '#rrggbb' / '#rrggbbaa' colour, preserving alpha.
export function shade(css, mul) {
  if (typeof css !== 'string' || css[0] !== '#') return css;
  let s = css.slice(1);
  if (s.length === 3 || s.length === 4) s = s.replace(/./g, (c) => c + c);
  if (s.length !== 6 && s.length !== 8) return css;
  const r = parseInt(s.slice(0, 2), 16) * mul;
  const g = parseInt(s.slice(2, 4), 16) * mul;
  const b = parseInt(s.slice(4, 6), 16) * mul;
  return '#' + hex2(r) + hex2(g) + hex2(b) + (s.length === 8 ? s.slice(6, 8) : '');
}

export function rampPalette(pal, mul) {
  return pal.map((c) => (c == null ? c : shade(c, mul)));
}

/* ---------------------------------------------------------------- palettes */
//  slot 0 = drop shadow   1 = shaded edge   2 = body   3 = lit edge

export const TEXT_PAL = {
  white: FONT_PAL_WHITE,
  dark: FONT_PAL_DARK,
  gold: ['#2a1400', '#a8760c', '#e8c74a', '#fff2b0'],
  amber: ['#2a1000', '#a85010', '#f0a030', '#ffd890'],
  red: ['#2a0400', '#8c1000', '#e0402c', '#ff9c80'],
  green: ['#04200c', '#1a7a2c', '#55c753', '#bdf4ab'],
  blue: ['#020c2a', '#2b4bc4', '#5db3ff', '#d1d8ff'],
  gray: ['#0d0d0d', '#4e4e4e', '#8f8f8f', '#c0c0c0'],
  dim: ['#0a0806', '#3a3a3a', '#6a6a6a', '#909090'],
};

// One breathing cycle of the white face, used for pulsing menu/pause text.
// Stepping the palette keeps the letters solid — no half-alpha pixels.
export const PULSE_PALS = [0.44, 0.58, 0.72, 0.86, 1.0, 0.86, 0.72, 0.58].map((m) =>
  rampPalette(FONT_PAL_WHITE, m)
);

/* ------------------------------------------------------------- glyph sets */

// Characters the font does not carry but that are cheap to stand in for.
const CHAR_ALIAS = {
  '"': "'",
  '’': "'",
  '`': "'",
  '=': '-',
  _: '-',
  '+': '-',
  '–': '-',
  '—': '-',
  '*': 'x',
  '·': '.',
  ';': ':',
};

function rawGlyph(ch) {
  return Object.prototype.hasOwnProperty.call(FONT, ch) ? FONT[ch] : null;
}

// Lowercase letters resolve to their capital first so 'x' reads as the letter X
// rather than the font's multiplication sign, which also lives at key 'x'.
function baseGlyph(ch) {
  if (ch === ' ' || ch === '\t' || ch === '\n') return null;
  if (ch >= 'a' && ch <= 'z') {
    const up = rawGlyph(ch.toUpperCase());
    if (up) return up;
  }
  const direct = rawGlyph(ch);
  if (direct) return direct;
  const alias = CHAR_ALIAS[ch];
  if (alias) {
    const g = rawGlyph(alias);
    if (g) return g;
  }
  return null;
}

class GlyphSet {
  constructor(palette, name) {
    this.palette = palette || null;
    this.name = name || 'pal';
    this.cache = Object.create(null);
  }

  get(ch) {
    const hit = this.cache[ch];
    if (hit !== undefined) return hit;
    const base = baseGlyph(ch);
    let out = null;
    if (base) out = this.palette ? base.recolor(this.palette, `text.${this.name}.${ch}`) : base;
    this.cache[ch] = out;
    return out;
  }
}

const SETS = new Map();
SETS.set('white', new GlyphSet(null, 'white'));

const WHITE_KEY = FONT_PAL_WHITE.join('|');

function setKey(palette) {
  if (palette == null) return 'white';
  if (typeof palette === 'string') return TEXT_PAL[palette] ? palette : 'white';
  if (Array.isArray(palette)) {
    const joined = palette.join('|');
    return joined === WHITE_KEY ? 'white' : 'a:' + joined;
  }
  return 'white';
}

// Resolve a palette argument (name, array, or null) to a cached glyph set.
export function glyphSet(palette) {
  const key = setKey(palette);
  let set = SETS.get(key);
  if (set) return set;
  const pal = typeof palette === 'string' ? TEXT_PAL[palette] : palette;
  set = new GlyphSet(pal, key);
  SETS.set(key, set);
  return set;
}

/* --------------------------------------------------------- outlined glyphs */
//
// The strip is painted over the live scene, not over the NES's solid black status
// bar, so white letters are only as legible as whatever happens to be behind
// them. Over a water level's foam crests — pure #ffffff — the contrast ratio is
// literally 1.0 and the score, VÄRLD and TID vanish. The font's own drop shadow
// does not save it: that shadow only runs along the right and bottom edges, so
// the top-left flank of every stroke still meets the scene bare.
//
// The fix is a 1px halo on all eight sides, in the font's own shadow tone. It is
// the cheapest thing that restores the original's black-behind-white reading
// without repainting a status bar over the play field, and being dark it also
// disappears against the night sky in 6-1 rather than drawing a box around the
// text.
//
// It is baked, not blitted nine times: the halo is computed once per glyph as a
// 10x10 sprite with one pixel of padding, so drawing a character stays a single
// drawImage the way the rest of this file assumes. The padding is why the sprite
// is drawn at (x-1, y-1) — the advance is still GLYPH_W.

const OUTLINE_PAD = 1;
const OUTLINE_SLOT = 'e'; // a palette slot the 4-colour font sets never use

// Grow the glyph's opaque footprint by one pixel in every direction. The halo
// wraps the drop shadow as well as the letter, so the ring is uniform all round
// instead of thickening where the font already had ink.
function outlineRows(rows) {
  const w = rows[0].length;
  const h = rows.length;
  const ow = w + OUTLINE_PAD * 2;
  const oh = h + OUTLINE_PAD * 2;
  const solid = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const c = rows[y][x];
    return c !== '.' && c !== ' ';
  };
  const out = [];
  for (let oy = 0; oy < oh; oy++) {
    let row = '';
    for (let ox = 0; ox < ow; ox++) {
      const x = ox - OUTLINE_PAD;
      const y = oy - OUTLINE_PAD;
      if (solid(x, y)) {
        row += rows[y][x];
        continue;
      }
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (solid(x + dx, y + dy)) {
            near = true;
            break;
          }
        }
      }
      row += near ? OUTLINE_SLOT : '.';
    }
    out.push(row);
  }
  return out;
}

const OUTLINE_COLOR = FONT_PAL_WHITE[0]; // the font's own shadow tone

// Pad a 4-entry font palette out to the outline slot.
function outlinePalette(pal) {
  const out = pal.slice();
  while (out.length < 14) out.push(null);
  out[14] = OUTLINE_COLOR;
  return out;
}

const OUTLINED = new Map();

// One outlined glyph set per palette, cached the same way GlyphSet caches its
// recolours — a palette swap must not cost more than a lookup.
function outlinedGlyph(ch, palette) {
  const key = setKey(palette);
  let set = OUTLINED.get(key);
  if (!set) {
    set = Object.create(null);
    OUTLINED.set(key, set);
  }
  const hit = set[ch];
  if (hit !== undefined) return hit;
  const base = baseGlyph(ch);
  let out = null;
  if (base) {
    const pal = typeof palette === 'string' ? TEXT_PAL[palette] : palette;
    out = makeSprite(outlineRows(base.rows), outlinePalette(pal || FONT_PAL_WHITE), {
      name: `text.outline.${key}.${ch}`,
    });
  }
  set[ch] = out;
  return out;
}

/**
 * `drawText` with a 1px dark halo, for text painted over the play field.
 * Same signature, same advance, same 8px grid — only the ring is added.
 */
export function drawTextOutlined(ctx, str, x, y, palette) {
  if (str == null) return 0;
  const s = String(str);
  let cx = x | 0;
  const cy = y | 0;
  for (let i = 0; i < s.length; i++) {
    const g = outlinedGlyph(s[i], palette);
    if (g) ctx.drawImage(g.canvas, cx - OUTLINE_PAD, cy - OUTLINE_PAD);
    cx += GLYPH_W;
  }
  return cx - (x | 0);
}

/* ------------------------------------------------------------ text drawing */

export function textWidth(str) {
  return str == null ? 0 : String(str).length * GLYPH_W;
}

/**
 * Lay out a string of 8x8 glyphs. Unknown characters advance the cursor and
 * draw nothing, so a stray symbol leaves a gap instead of throwing or
 * shifting the rest of the line.
 *
 * @returns {number} the advance width in pixels.
 */
export function drawText(ctx, str, x, y, palette) {
  if (str == null) return 0;
  const s = String(str);
  const set = glyphSet(palette);
  let cx = x | 0;
  const cy = y | 0;
  for (let i = 0; i < s.length; i++) {
    const g = set.get(s[i]);
    if (g) ctx.drawImage(g.canvas, cx, cy);
    cx += GLYPH_W;
  }
  return cx - (x | 0);
}

// The signature named in the build brief.
export { drawText as draw };

export function drawTextCentered(ctx, str, y, palette, cx = SCREEN_W / 2) {
  const s = String(str == null ? '' : str);
  const x = Math.floor(cx - (s.length * GLYPH_W) / 2);
  return drawText(ctx, s, x, y, palette);
}

export function drawTextRight(ctx, str, right, y, palette) {
  const s = String(str == null ? '' : str);
  return drawText(ctx, s, (right | 0) - s.length * GLYPH_W, y, palette);
}

// Cheap two-pass emphasis: the same string in a dark palette one pixel down and
// right, then the bright pass on top. Only used over busy backdrops.
export function drawTextShadowed(ctx, str, x, y, palette, shadowPal = 'dark') {
  drawText(ctx, str, x + 1, y + 1, shadowPal);
  return drawText(ctx, str, x, y, palette);
}

export function pad(n, len, ch = '0') {
  let s = String(n);
  while (s.length < len) s = ch + s;
  return s;
}

/* --------------------------------------------------------------- HUD chrome */

const CHROME_PAL = ['#1a1008', '#aeaeae', '#e4e4e4', '#ffffff'];

// The small "paused" telltale that sits in the gap between the coin counter and
// the WORLD field. Two bevelled bars with the font's drop-shadow offset.
const PAUSE_BARS = makeSprite(
  [
    '........',
    '.33..33.',
    '.320.320',
    '.320.320',
    '.320.320',
    '.320.320',
    '.310.310',
    '.000.000',
  ],
  CHROME_PAL,
  { name: 'hud.pauseBars' }
);

const PAUSE_BARS_DIM = PAUSE_BARS.shift((c) => shade(c, 0.62), 'hud.pauseBars.dim');

// The HUD coin flashes on a 32-frame cycle, the way the NES cycles its status
// palette. Nothing in this strip is ever completely still.
const COIN_CYCLE = [
  GLYPH.coin,
  GLYPH.coin.shift((c) => shade(c, 1.2), 'hud.coin.bright'),
  GLYPH.coin,
  GLYPH.coin.shift((c) => shade(c, 0.76), 'hud.coin.dim'),
];

export const HUD_LAYOUT = {
  rowLabel: 16,
  rowValue: 24,
  marioX: 24,
  scoreX: 24,
  scoreDigits: 6,
  coinIconX: 88,
  coinTimesX: 96,
  coinNumX: 104,
  worldX: 144,
  worldFieldW: 40,
  timeX: 200,
  timeValueX: 208,
  pauseX: 124,
  livesX: 24,
};

const DEFAULT_STATE = {
  score: 0,
  coins: 0,
  label: '1-1',
  time: 400,
  lives: 3,
  timeUp: false,
};

/** Best-effort "1-1" style label for a world, following sub-areas back to the root. */
export function levelLabel(world) {
  if (!world) return DEFAULT_STATE.label;
  const root = world.rootLevel || world.level || null;
  let id = root && root.id != null ? String(root.id) : '';
  if (!id) id = `${world.worldNum | 0 || 1}-${world.levelNum | 0 || 1}`;
  id = id.toUpperCase().replace(/[^0-9A-Z-]/g, '');
  // '1-1B' is a bonus room of '1-1'; the strip keeps showing the parent.
  const m = id.match(/^(\d+-[\dA-Z])/);
  if (m) id = m[1];
  return id.slice(0, 5) || DEFAULT_STATE.label;
}

/* --------------------------------------------------------------------- Hud */

const SCORE_SNAP = 100; // awards at or below this land instantly
const SCORE_RAMP = 20; // frames a large award takes to roll in, whatever its size

export class Hud {
  constructor(opts = {}) {
    this.world = opts.world || null;
    this.visible = true;
    this.paused = false;
    this.showLives = false;
    this.label = null; // hard override for the WORLD field

    this.tick = 0;
    this.displayScore = 0;
    this.targetScore = 0;
    this.scoreBoost = 0;
    this.timeWarn = 0;

    this._rollStep = 0;
    this._lastTime = null;
    this._explicitUpdate = false;
  }

  attach(world) {
    this.world = world || null;
    return this.reset();
  }

  /** Snap every animated value to the current world state. */
  reset(world) {
    if (world) this.world = world;
    const w = this.world;
    this.displayScore = w ? w.score | 0 : 0;
    this.targetScore = this.displayScore;
    this.scoreBoost = 0;
    this.timeWarn = 0;
    this._rollStep = 0;
    this._lastTime = w ? w.time | 0 : null;
    return this;
  }

  setPaused(on) {
    this.paused = on === undefined ? !this.paused : !!on;
    return this.paused;
  }

  /** Advance one fixed tick. Safe to call with no world. */
  update(world) {
    this._explicitUpdate = true;
    this._step(world || this.world);
    return this;
  }

  _step(w) {
    this.tick++;
    if (w) {
      const s = w.score | 0;
      if (s < this.displayScore) this.displayScore = s;
      this.targetScore = s;

      const t = w.time | 0;
      if (this._lastTime != null && this._lastTime >= 100 && t < 100) this.timeWarn = 44;
      this._lastTime = t;
    }
    if (this.timeWarn > 0) this.timeWarn--;
    if (this.scoreBoost > 0) this.scoreBoost--;
    this._rollScore();
  }

  // Small awards land instantly; anything bigger rolls in at a fixed rate, so a
  // 1000 and an 8000 both take about SCORE_RAMP frames to arrive. Locking the
  // step when the roll starts keeps it linear — an ease-out reads as a stall.
  _rollScore() {
    const gap = this.targetScore - this.displayScore;
    if (gap <= 0) {
      this._rollStep = 0;
      return;
    }
    if (gap <= SCORE_SNAP) {
      this.displayScore = this.targetScore;
      this._rollStep = 0;
      this.scoreBoost = Math.max(this.scoreBoost, 3);
      return;
    }
    const want = Math.ceil(gap / SCORE_RAMP / 10) * 10;
    if (want > this._rollStep) this._rollStep = want; // a second award mid-roll speeds it up
    this.displayScore += Math.min(gap, Math.max(10, this._rollStep));
    this.scoreBoost = 8;
  }

  get rolling() {
    return this.displayScore !== this.targetScore || this.scoreBoost > 0;
  }

  /** Normalise a World (or nothing) into the plain values the strip prints. */
  snapshot(world) {
    const w = world || this.world;
    if (!w) return { ...DEFAULT_STATE, label: this.label || DEFAULT_STATE.label };
    return {
      score: this.displayScore,
      coins: w.coins | 0,
      label: this.label || levelLabel(w),
      time: w.time | 0,
      lives: w.lives | 0,
      timeUp: (w.time | 0) <= 0 && w.deathCause === 'timeup',
      // Harry mode and two-player both rename the left-hand label.
      name: w.playerName || null,
      // In Harry mode the coins are a wallet, not a countdown to a 1-up, so the
      // field has to hold three digits.
      wallet: w.harryMode === true,
      // Set by player.js when a brick bomb was refused for want of coins, and
      // left to expire on its own. `until` is a world tick, so a paused game
      // holds the flash rather than running it out.
      denyCost: w.coinDeny && (w.tick | 0) < w.coinDeny.until ? w.coinDeny.cost | 0 : 0,
    };
  }

  /** Draw the strip. `world` is optional; the attached world is used otherwise. */
  draw(ctx, world) {
    if (!this.visible) return this;
    if (!this._explicitUpdate) this._step(world || this.world);
    this.drawStrip(ctx, this.snapshot(world));
    return this;
  }

  /** Queue the strip on the HUD layer of a renderer. */
  submit(renderer, world) {
    renderer.draw(LAYER.HUD, (ctx) => this.draw(ctx, world));
    return this;
  }

  /** Low-level strip painter — takes plain values, so menus can fake a state. */
  drawStrip(ctx, data) {
    const L = HUD_LAYOUT;
    const d = data || DEFAULT_STATE;
    const t = this.tick;

    drawTextOutlined(ctx, d.name || tr('mario'), L.marioX, L.rowLabel);
    drawTextOutlined(ctx, tr('world'), L.worldX, L.rowLabel);
    drawTextOutlined(ctx, tr('time'), L.timeX, L.rowLabel);

    // Score. While a big award rolls in the digits sit in the gold palette so
    // the eye is pulled to them, then settle back to white.
    const score = Math.max(0, d.score | 0);
    let digits = String(score);
    if (digits.length < L.scoreDigits) digits = pad(digits, L.scoreDigits);
    else if (digits.length > 8) digits = '99999999';
    const scorePal = this.rolling ? (t & 4 ? 'gold' : 'amber') : null;
    drawTextOutlined(ctx, digits, L.scoreX, L.rowValue, scorePal);

    // Coin counter — HARRY MODE ONLY.
    //
    // DELIBERATE DEVIATION FROM SMB, NOT AN OVERSIGHT. The original always shows
    // the coin counter; the user asked for it to appear only in Harry mode,
    // where coins are a wallet you spend on brick bombs. In normal play this
    // part of the strip is simply empty. Delete the `if` to restore the
    // original behaviour — everything inside it already handles both modes.
    //
    // Nothing else on the row moves: MARIO/score, WORLD and TIME are all drawn
    // at fixed x from HUD_LAYOUT and none of them is centred on the space this
    // frees. A strip that reflowed between modes would read as broken.
    if (d.wallet === true) {
      const denyPal = (d.denyCost | 0) > 0 ? ((t >> 3) & 1 ? 'red' : 'amber') : null;
      const coinSprite = COIN_CYCLE[(t >> 3) % COIN_CYCLE.length];
      coinSprite.draw(ctx, L.coinIconX, L.rowValue);
      drawTextOutlined(ctx, '×', L.coinTimesX, L.rowValue, denyPal);
      // Two digits is the SMB width: the counter never reaches 100 there because
      // the hundredth coin is a 1-up. A Harry-mode wallet does reach it, and
      // there is room — the field ends at 128 and WORLD starts at 144.
      const wide = d.wallet === true;
      const coins = Math.max(0, Math.min(wide ? 999 : 99, d.coins | 0));
      const coinDigits = wide ? 3 : 2;

      // A dud thrown for want of coins flashes the group red and amber. The
      // NUMBER ITSELF NEVER CHANGES — it is always the wallet.
      //
      // This used to alternate the wallet with the PRICE on the same beat, my
      // idea, and it was wrong: a counter that swaps between 019 and 005 twice a
      // second does not read as "that costs 5", it reads as a broken counter,
      // and it was reported as one. A value that flickers between two numbers is
      // never legible, however sound the intent. Colour carries the alarm;
      // the digits stay still and keep meaning one thing.
      drawTextOutlined(ctx, pad(coins, coinDigits), L.coinNumX, L.rowValue, denyPal);
    }

    // World label, centred inside the WORLD field.
    const label = String(d.label || DEFAULT_STATE.label);
    const lx = L.worldX + Math.floor((L.worldFieldW - label.length * GLYPH_W) / 2);
    drawTextOutlined(ctx, label, lx, L.rowValue);

    // Timer. Below 100 the digits alternate white/amber; the moment it crosses
    // the threshold they strobe twice as fast for ~44 frames.
    const time = Math.max(0, Math.min(999, d.time | 0));
    let timePal = null;
    if (time <= 0) {
      timePal = t & 8 ? 'red' : 'amber';
    } else if (time < 100) {
      const period = this.timeWarn > 0 ? 4 : time < 50 ? 8 : 16;
      timePal = t % period < period / 2 ? 'amber' : null;
    }
    drawTextOutlined(ctx, pad(time, 3), L.timeValueX, L.rowValue, timePal);

    if (this.showLives) {
      GLYPH.marioHead.draw(ctx, L.livesX, L.rowLabel - 8);
      drawTextOutlined(ctx, '×' + Math.max(0, Math.min(99, d.lives | 0)), L.livesX + 8, L.rowLabel - 8);
    }

    if (this.paused) {
      const bright = t % 48 < 34;
      (bright ? PAUSE_BARS : PAUSE_BARS_DIM).draw(ctx, L.pauseX, L.rowLabel);
    }
    return this;
  }
}

export const hud = new Hud();

/** One-liner for hosts that do not want to hold on to the instance. */
export function drawHud(ctx, world) {
  return hud.draw(ctx, world);
}

export { HUD_H, LAYER };
export default hud;
