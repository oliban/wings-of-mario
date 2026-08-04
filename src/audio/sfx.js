// Sound effects. Every one is a scheduled envelope + sweep on the APU synth in
// engine.js — there is not a single sample anywhere in this file.

import { audio, DUTY, noteToFreq } from './engine.js';
import rng from '../core/rng.js';

// How hard each effect pushes the music out of the way.
const DUCK = {
  'powerup-collect': 0.45,
  'powerup-appear': 0.28,
  'one-up': 0.42,
  death: 0.7,
  pipe: 0.4,
  flagpole: 0.5,
  'bowser-fall': 0.55,
  firework: 0.34,
  'time-warning': 0.45,
  'brick-break': 0.2,
  'enemy-fire': 0.22,
};

// Rising/falling runs of short blips, the NES workhorse for "something happened!".
function run(E, t, opts) {
  const {
    base = 'c5',
    offsets = [0, 4, 7, 12],
    step = 0.05,
    dur = null,
    duty = DUTY.D50,
    vol = 0.26,
    tag = null,
    bus = 'sfx',
    volCurve = null,
    release = 0.02,
  } = opts;
  const f0 = noteToFreq(base);
  for (let i = 0; i < offsets.length; i++) {
    const v = volCurve ? vol * volCurve(i / Math.max(1, offsets.length - 1)) : vol;
    E.pulse({
      time: t + i * step,
      dur: dur == null ? step * 0.92 : dur,
      freq: f0 * Math.pow(2, offsets[i] / 12),
      duty,
      vol: v,
      attack: 0.001,
      decay: step * 0.8,
      sustain: 0.55,
      release,
      bus,
      tag,
    });
  }
  return t + offsets.length * step;
}

const EFFECTS = {
  'jump-small'(E, t, tag) {
    E.pulse({
      time: t,
      dur: 0.16,
      freq: 340,
      duty: DUTY.D125,
      vol: 0.3,
      attack: 0.001,
      decay: 0.14,
      sustain: 0.22,
      release: 0.05,
      sweep: { to: 1180, time: 0.13, mode: 'step', steps: 20 },
      tag,
    });
    E.pulse({
      time: t,
      dur: 0.05,
      freq: 170,
      duty: DUTY.D25,
      vol: 0.1,
      decay: 0.05,
      sustain: 0.1,
      release: 0.02,
      sweep: { to: 560, time: 0.05, mode: 'step', steps: 8 },
      tag,
    });
  },

  'jump-big'(E, t, tag) {
    E.pulse({
      time: t,
      dur: 0.24,
      freq: 205,
      duty: DUTY.D25,
      vol: 0.33,
      attack: 0.001,
      decay: 0.22,
      sustain: 0.24,
      release: 0.06,
      sweep: { to: 820, time: 0.21, mode: 'step', steps: 26 },
      tag,
    });
    E.triangle({
      time: t,
      dur: 0.1,
      freq: 110,
      vol: 0.16,
      decay: 0.1,
      sustain: 0.2,
      release: 0.03,
      sweep: { to: 300, time: 0.1, mode: 'step', steps: 10 },
      tag,
    });
  },

  stomp(E, t, tag) {
    E.noise({
      time: t,
      dur: 0.075,
      clock: 8200,
      clockTo: 2100,
      vol: 0.3,
      decay: 0.07,
      sustain: 0.15,
      release: 0.02,
      filter: { type: 'lowpass', freq: 5200, freqTo: 900, time: 0.08 },
      tag,
    });
    E.pulse({
      time: t,
      dur: 0.085,
      freq: 880,
      duty: DUTY.D50,
      vol: 0.2,
      decay: 0.08,
      sustain: 0.1,
      release: 0.02,
      sweep: { to: 130, time: 0.08, mode: 'step', steps: 12 },
      tag,
    });
    E.drum({ time: t, kind: 'click', vol: 0.2, tag });
  },

  bump(E, t, tag) {
    E.triangle({
      time: t,
      dur: 0.07,
      freq: 190,
      vol: 0.3,
      decay: 0.06,
      sustain: 0.12,
      release: 0.02,
      sweep: { to: 74, time: 0.06, mode: 'step', steps: 8 },
      tag,
    });
    E.noise({
      time: t,
      dur: 0.05,
      clock: 2400,
      clockTo: 900,
      vol: 0.14,
      decay: 0.05,
      sustain: 0.05,
      release: 0.015,
      filter: { type: 'lowpass', freq: 1600, Q: 0.7 },
      tag,
    });
  },

  'brick-break'(E, t, tag) {
    E.noise({
      time: t,
      dur: 0.3,
      clock: 15000,
      clockTo: 3200,
      vol: 0.3,
      decay: 0.28,
      sustain: 0.06,
      release: 0.06,
      filter: { type: 'bandpass', freq: 3400, freqTo: 700, time: 0.3, Q: 1.1 },
      tag,
    });
    // four tumbling shards
    const spread = [0, 0.045, 0.085, 0.14];
    for (let i = 0; i < spread.length; i++) {
      const f = 620 * Math.pow(0.82, i) * (1 + rng.range(-0.05, 0.05));
      E.pulse({
        time: t + spread[i],
        dur: 0.09,
        freq: f,
        duty: DUTY.D125,
        vol: 0.13 - i * 0.02,
        decay: 0.08,
        sustain: 0.1,
        release: 0.02,
        sweep: { to: f * 0.45, time: 0.09, mode: 'step', steps: 8 },
        tag,
      });
    }
    E.drum({ time: t, kind: 'click', vol: 0.22, rate: 1.4, tag });
  },

  coin(E, t, tag) {
    E.pulse({
      time: t,
      dur: 0.055,
      note: 'b5',
      duty: DUTY.D50,
      vol: 0.24,
      attack: 0.001,
      release: 0.008,
      tag,
    });
    E.pulse({
      time: t + 0.055,
      dur: 0.42,
      note: 'e6',
      duty: DUTY.D50,
      vol: 0.26,
      attack: 0.001,
      decay: 0.4,
      sustain: 0.08,
      release: 0.05,
      tag,
    });
  },

  'powerup-appear'(E, t, tag) {
    run(E, t, {
      base: 'c4',
      offsets: [0, 7, 12, 16, 19, 24, 19, 24],
      step: 0.075,
      duty: DUTY.D125,
      vol: 0.17,
      tag,
    });
  },

  'powerup-collect'(E, t, tag) {
    const offsets = [0, 4, 7, 12, 7, 12, 16, 19, 16, 19, 24, 28, 24, 31];
    run(E, t, {
      base: 'g3',
      offsets,
      step: 0.046,
      duty: DUTY.D25,
      vol: 0.28,
      tag,
      volCurve: (u) => 0.75 + 0.25 * u,
    });
    E.triangle({
      time: t,
      dur: 0.62,
      freq: noteToFreq('g2'),
      vol: 0.2,
      decay: 0.6,
      sustain: 0.3,
      release: 0.06,
      sweep: { to: noteToFreq('g4'), time: 0.6, mode: 'step', steps: 32 },
      tag,
    });
  },

  'one-up'(E, t, tag) {
    const notes = ['e5', 'g5', 'c6', 'e6'];
    for (let i = 0; i < notes.length; i++) {
      E.pulse({
        time: t + i * 0.09,
        dur: 0.085,
        note: notes[i],
        duty: DUTY.D50,
        vol: 0.24,
        attack: 0.001,
        release: 0.012,
        tag,
      });
    }
    E.pulse({
      time: t + 0.36,
      dur: 0.34,
      note: 'g6',
      duty: DUTY.D50,
      vol: 0.24,
      decay: 0.3,
      sustain: 0.35,
      release: 0.08,
      vibrato: { rate: 7.5, depth: 30, delay: 0.09 },
      tag,
    });
  },

  fireball(E, t, tag) {
    E.pulse({
      time: t,
      dur: 0.13,
      freq: 1500,
      duty: DUTY.D125,
      vol: 0.24,
      decay: 0.12,
      sustain: 0.12,
      release: 0.03,
      sweep: { to: 300, time: 0.12, mode: 'step', steps: 14 },
      tag,
    });
    E.noise({
      time: t,
      dur: 0.09,
      clock: 9000,
      clockTo: 1600,
      vol: 0.14,
      decay: 0.085,
      sustain: 0.08,
      release: 0.02,
      filter: { type: 'highpass', freq: 900 },
      tag,
    });
  },

  'kick-shell'(E, t, tag) {
    E.noise({
      time: t,
      dur: 0.075,
      clock: 4200,
      clockTo: 13000,
      vol: 0.26,
      decay: 0.07,
      sustain: 0.12,
      release: 0.02,
      filter: { type: 'bandpass', freq: 1800, freqTo: 5200, time: 0.07, Q: 1.3 },
      tag,
    });
    E.pulse({
      time: t,
      dur: 0.085,
      freq: 260,
      duty: DUTY.D25,
      vol: 0.2,
      decay: 0.08,
      sustain: 0.14,
      release: 0.02,
      sweep: { to: 960, time: 0.08, mode: 'step', steps: 10 },
      tag,
    });
  },

  pipe(E, t, tag) {
    E.pulse({
      time: t,
      dur: 0.46,
      freq: 1250,
      duty: DUTY.D50,
      vol: 0.26,
      decay: 0.44,
      sustain: 0.3,
      release: 0.05,
      sweep: { to: 118, time: 0.44, mode: 'step', steps: 40 },
      tag,
    });
    E.noise({
      time: t,
      dur: 0.46,
      clock: 9000,
      clockTo: 900,
      vol: 0.14,
      decay: 0.44,
      sustain: 0.2,
      release: 0.05,
      filter: { type: 'lowpass', freq: 6000, freqTo: 500, time: 0.45 },
      tag,
    });
    E.triangle({
      time: t + 0.04,
      dur: 0.4,
      freq: 300,
      vol: 0.14,
      decay: 0.38,
      sustain: 0.25,
      release: 0.05,
      sweep: { to: 60, time: 0.4, mode: 'step', steps: 28 },
      tag,
    });
  },

  flagpole(E, t, tag) {
    const offsets = [];
    for (let i = 0; i < 18; i++) offsets.push([0, 4, 7, 12][i % 4] + Math.floor(i / 4) * 12);
    run(E, t, {
      base: 'c4',
      offsets,
      step: 0.058,
      dur: 0.05,
      duty: DUTY.D25,
      vol: 0.2,
      tag,
      volCurve: (u) => 0.8 + 0.2 * Math.sin(u * Math.PI),
    });
    E.noise({
      time: t,
      dur: 1.05,
      clock: 1400,
      clockTo: 7000,
      vol: 0.06,
      decay: 1.0,
      sustain: 0.7,
      release: 0.08,
      filter: { type: 'bandpass', freq: 1200, freqTo: 4200, time: 1.0, Q: 2 },
      tag,
    });
  },

  death(E, t, tag) {
    E.pulse({
      time: t,
      dur: 0.1,
      note: 'b4',
      duty: DUTY.D50,
      vol: 0.26,
      release: 0.02,
      tag,
    });
    E.pulse({
      time: t + 0.1,
      dur: 0.12,
      note: 'f4',
      duty: DUTY.D50,
      vol: 0.26,
      release: 0.02,
      tag,
    });
    E.pulse({
      time: t + 0.24,
      dur: 0.7,
      freq: 780,
      duty: DUTY.D25,
      vol: 0.26,
      decay: 0.65,
      sustain: 0.3,
      release: 0.1,
      sweep: { to: 92, time: 0.66, mode: 'step', steps: 44 },
      tag,
    });
  },

  pause(E, t, tag) {
    E.pulse({
      time: t,
      dur: 0.06,
      note: 'c6',
      duty: DUTY.D50,
      vol: 0.2,
      release: 0.01,
      tag,
    });
    E.pulse({
      time: t + 0.075,
      dur: 0.11,
      note: 'g5',
      duty: DUTY.D50,
      vol: 0.2,
      decay: 0.1,
      sustain: 0.4,
      release: 0.03,
      tag,
    });
  },

  firework(E, t, tag) {
    E.pulse({
      time: t,
      dur: 0.32,
      freq: 380,
      duty: DUTY.D125,
      vol: 0.14,
      decay: 0.3,
      sustain: 0.55,
      release: 0.03,
      sweep: { to: 2050, time: 0.3, mode: 'step', steps: 30 },
      vibrato: { rate: 11, depth: 40, delay: 0.05 },
      tag,
    });
    E.noise({
      time: t + 0.33,
      dur: 0.42,
      clock: 14000,
      clockTo: 700,
      vol: 0.34,
      attack: 0.002,
      decay: 0.4,
      sustain: 0.05,
      release: 0.08,
      filter: { type: 'lowpass', freq: 9000, freqTo: 400, time: 0.42 },
      tag,
    });
    E.drum({ time: t + 0.33, kind: 'kick', vol: 0.3, rate: 0.7, tag });
  },

  'time-warning'(E, t, tag) {
    for (let i = 0; i < 3; i++) {
      E.pulse({
        time: t + i * 0.135,
        dur: 0.075,
        note: 'g6',
        duty: DUTY.D50,
        vol: 0.24,
        attack: 0.001,
        release: 0.015,
        tag,
      });
      E.pulse({
        time: t + i * 0.135,
        dur: 0.075,
        note: 'c6',
        duty: DUTY.D25,
        vol: 0.1,
        attack: 0.001,
        release: 0.015,
        tag,
      });
    }
  },

  // The end-of-level bonus tally tick. Authored, not sampled — like everything
  // else in this file — to match the CHARACTER of the original's tally blip.
  //
  // Its constraints come from how it is played, not from how it sounds alone:
  // AwardGameTimerPoints queues it on `FrameCounter AND #%00000100`
  // (smbdis.asm:10493-10497), so world.js fires it four frames out of every eight
  // for the length of the tally — up to thirty times a second, for several
  // seconds. Anything with body, low end or a tail becomes a drill at that rate.
  // So: one pulse, very short, very high, very quiet, on the thinnest duty, with
  // no entry in DUCK — a tick that pumped the fanfare down thirty times a second
  // would be worse than the wrong sound. playSfx's releaseTag voice-stealing then
  // makes a fast run of these read as one rattle instead of a stack of blips.
  'timer-tick'(E, t, tag) {
    E.pulse({
      time: t,
      dur: 0.016,
      note: 'e7',
      duty: DUTY.D125,
      vol: 0.075,
      attack: 0.001,
      release: 0.005,
      tag,
    });
  },

  'enemy-fire'(E, t, tag) {
    E.noise({
      time: t,
      dur: 0.34,
      clock: 3400,
      clockTo: 800,
      vol: 0.24,
      decay: 0.3,
      sustain: 0.35,
      release: 0.06,
      filter: { type: 'lowpass', freq: 2600, freqTo: 600, time: 0.33, Q: 1.4 },
      tag,
    });
    E.triangle({
      time: t,
      dur: 0.3,
      freq: 165,
      vol: 0.2,
      decay: 0.28,
      sustain: 0.3,
      release: 0.05,
      sweep: { to: 88, time: 0.29, mode: 'step', steps: 18 },
      tag,
    });
    E.pulse({
      time: t + 0.02,
      dur: 0.26,
      freq: 330,
      duty: DUTY.D125,
      vol: 0.1,
      decay: 0.24,
      sustain: 0.2,
      release: 0.04,
      sweep: { to: 150, time: 0.25, mode: 'step', steps: 16 },
      tag,
    });
  },

  'bowser-fall'(E, t, tag) {
    E.pulse({
      time: t,
      dur: 0.85,
      freq: 520,
      duty: DUTY.D25,
      vol: 0.22,
      decay: 0.8,
      sustain: 0.45,
      release: 0.08,
      sweep: { to: 62, time: 0.82, mode: 'step', steps: 52 },
      tag,
    });
    E.triangle({
      time: t,
      dur: 0.9,
      freq: 260,
      vol: 0.24,
      decay: 0.85,
      sustain: 0.4,
      release: 0.08,
      sweep: { to: 41, time: 0.86, mode: 'step', steps: 52 },
      tag,
    });
    E.noise({
      time: t,
      dur: 0.95,
      clock: 2600,
      clockTo: 500,
      vol: 0.12,
      decay: 0.9,
      sustain: 0.3,
      release: 0.1,
      filter: { type: 'lowpass', freq: 1800, freqTo: 260, time: 0.9 },
      tag,
    });
    E.drum({ time: t + 0.93, kind: 'kick', vol: 0.36, rate: 0.6, tag });
    E.noise({
      time: t + 0.93,
      dur: 0.5,
      clock: 6000,
      clockTo: 700,
      vol: 0.26,
      decay: 0.48,
      sustain: 0.05,
      release: 0.1,
      filter: { type: 'lowpass', freq: 5000, freqTo: 300, time: 0.5 },
      tag,
    });
  },

  swim(E, t, tag) {
    E.noise({
      time: t,
      dur: 0.19,
      clock: 5200,
      clockTo: 1500,
      vol: 0.14,
      attack: 0.012,
      decay: 0.17,
      sustain: 0.15,
      release: 0.05,
      filter: { type: 'bandpass', freq: 1500, freqTo: 520, time: 0.19, Q: 1.6 },
      tag,
    });
    E.pulse({
      time: t,
      dur: 0.14,
      freq: 430,
      duty: DUTY.D125,
      vol: 0.16,
      attack: 0.004,
      decay: 0.13,
      sustain: 0.2,
      release: 0.04,
      sweep: { to: 900, time: 0.13, mode: 'step', steps: 12 },
      tag,
    });
  },

  // -- extras the game systems tend to want ---------------------------------

  vine(E, t, tag) {
    const offsets = [];
    for (let i = 0; i < 14; i++) offsets.push(i * 2);
    run(E, t, {
      base: 'c4',
      offsets,
      step: 0.07,
      dur: 0.06,
      duty: DUTY.D125,
      vol: 0.16,
      tag,
    });
  },

  axe(E, t, tag) {
    E.pulse({
      time: t,
      dur: 0.5,
      note: 'c6',
      duty: DUTY.D50,
      vol: 0.24,
      decay: 0.46,
      sustain: 0.2,
      release: 0.08,
      vibrato: { rate: 8, depth: 34, delay: 0.08 },
      tag,
    });
    E.pulse({
      time: t,
      dur: 0.5,
      note: 'g6',
      duty: DUTY.D25,
      vol: 0.12,
      decay: 0.46,
      sustain: 0.15,
      release: 0.08,
      tag,
    });
    E.noise({
      time: t,
      dur: 0.16,
      clock: 12000,
      clockTo: 4000,
      vol: 0.14,
      decay: 0.15,
      sustain: 0.05,
      release: 0.03,
      filter: { type: 'highpass', freq: 2200 },
      tag,
    });
  },

  thwomp(E, t, tag) {
    E.triangle({
      time: t,
      dur: 0.22,
      freq: 150,
      vol: 0.32,
      decay: 0.2,
      sustain: 0.1,
      release: 0.05,
      sweep: { to: 48, time: 0.2, mode: 'step', steps: 14 },
      tag,
    });
    E.noise({
      time: t,
      dur: 0.26,
      clock: 3200,
      clockTo: 600,
      vol: 0.26,
      decay: 0.24,
      sustain: 0.05,
      release: 0.05,
      filter: { type: 'lowpass', freq: 2400, freqTo: 300, time: 0.25 },
      tag,
    });
    E.drum({ time: t, kind: 'kick', vol: 0.32, rate: 0.75, tag });
  },
};

const ALIASES = {
  jump: 'jump-small',
  'jump-super': 'jump-big',
  jumpbig: 'jump-big',
  break: 'brick-break',
  brick: 'brick-break',
  blockbreak: 'brick-break',
  'block-break': 'brick-break',
  'block-bump': 'bump',
  blockbump: 'bump',
  head: 'bump',
  fire: 'fireball',
  shoot: 'fireball',
  shell: 'kick-shell',
  kick: 'kick-shell',
  warp: 'pipe',
  'pipe-enter': 'pipe',
  powerup: 'powerup-collect',
  mushroom: 'powerup-collect',
  flower: 'powerup-collect',
  grow: 'powerup-collect',
  'item-appear': 'powerup-appear',
  sprout: 'powerup-appear',
  '1up': 'one-up',
  oneup: 'one-up',
  'extra-life': 'one-up',
  die: 'death',
  'player-down': 'death',
  hurry: 'time-warning',
  'time-up': 'time-warning',
  timertick: 'timer-tick',
  timerTick: 'timer-tick',
  tick: 'timer-tick',
  tally: 'timer-tick',
  bowserfire: 'enemy-fire',
  'bowser-fire': 'enemy-fire',
  flame: 'enemy-fire',
  'bowser-defeat': 'bowser-fall',
  bowserfall: 'bowser-fall',
  stroke: 'swim',
  paddle: 'swim',
  unpause: 'pause',
  flag: 'flagpole',
  rocket: 'firework',
};

export const SFX_NAMES = Object.keys(EFFECTS);

export function hasSfx(name) {
  const key = ALIASES[name] || name;
  return Object.prototype.hasOwnProperty.call(EFFECTS, key);
}

/**
 * Play a named effect.
 * opts: { time (absolute audio clock), vol (0..1 scale, applied via the sfx bus is
 *         global so per-call use `duck`), duck (0..1 multiplier on the music duck) }
 */
export function playSfx(name, opts = {}) {
  const key = ALIASES[name] || name;
  const fn = EFFECTS[key];
  if (!fn) return null;
  const E = audio;
  if (!E.isReady()) return null;
  const t = E.when(opts.time);
  // Polite voice stealing: a retriggered effect fades its previous instance out
  // instead of stacking, so twenty coins in a row never clip the limiter.
  E.releaseTag(key, t, 0.018);
  const d = DUCK[key];
  if (d && opts.duck !== 0) E.duck(d * (opts.duck == null ? 1 : opts.duck), 0.1, 0.02, 0.3);
  fn(E, t, key, opts);
  return key;
}

audio.registerSfx(playSfx);

export const Audio = audio;
export default playSfx;
