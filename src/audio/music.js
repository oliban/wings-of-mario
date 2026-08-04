// Sequencer + original score. Nothing here is transcribed from anyone else's game:
// these are new tunes written in the NES idiom on the synth in engine.js.
//
// Pattern rows are plain strings of `note[:steps]` tokens:
//
//   'e5:3 g5 c6:4 b5:2 g5:2 e5:4'   melodic row, 16 steps of a 4/4 bar
//   '-'  rest        '~'  tie to the previous note      '|' bar separator (ignored)
//   'h:2*8'          repeat a token 8 times
//   's:2!'           accent (louder)
//   percussion rows use k(ick) s(nare) h(at) o(pen hat) t(om) c(lick) x(crash)

import { audio, DUTY, noteToFreq } from './engine.js';

// ---------------------------------------------------------------------------
// Pattern parsing
// ---------------------------------------------------------------------------

const TOKEN_RE = /^([a-gA-G][#b]?-?\d+|[-.~]|[kshotcx])(?::(\d+(?:\.\d+)?))?(?:\*(\d+))?(!?)$/;

function parseRow(str) {
  const events = [];
  let step = 0;
  let last = null;
  const toks = String(str || '')
    .split(/[\s|]+/)
    .filter(Boolean);
  for (const tok of toks) {
    const m = TOKEN_RE.exec(tok);
    if (!m) throw new Error(`music: bad pattern token "${tok}"`);
    const len = m[2] ? parseFloat(m[2]) : 1;
    const reps = m[3] ? parseInt(m[3], 10) : 1;
    const accent = m[4] === '!';
    for (let r = 0; r < reps; r++) {
      const name = m[1];
      if (name === '-' || name === '.') {
        step += len;
        last = null;
      } else if (name === '~') {
        if (last) last.len += len;
        step += len;
      } else {
        last = { step, name, len, accent };
        events.push(last);
        step += len;
      }
    }
  }
  return { events, steps: step };
}

const CHANNEL_KIND = {
  p1: 'pulse',
  p2: 'pulse',
  p3: 'pulse',
  tri: 'triangle',
  bass: 'triangle',
  noise: 'noise',
  dpcm: 'drum',
  drums: 'drum',
};

function compilePattern(pat) {
  const rows = [];
  let steps = 0;
  for (const key of Object.keys(pat)) {
    const raw = pat[key];
    if (!raw) continue;
    const spec = typeof raw === 'string' ? { s: raw } : raw;
    const parsed = parseRow(spec.s == null ? spec.seq : spec.s);
    const byStep = new Map();
    for (const ev of parsed.events) {
      const list = byStep.get(ev.step);
      if (list) list.push(ev);
      else byStep.set(ev.step, [ev]);
    }
    rows.push({
      name: key,
      kind: CHANNEL_KIND[key] || 'pulse',
      opts: spec,
      byStep,
    });
    steps = Math.max(steps, parsed.steps);
  }
  return { rows, steps: Math.max(1, Math.round(steps)) };
}

function compileTrack(track) {
  if (track._compiled) return track._compiled;
  const patterns = {};
  for (const key of Object.keys(track.patterns)) {
    patterns[key] = compilePattern(track.patterns[key]);
  }
  const order = (track.order || Object.keys(track.patterns)).map((k) => {
    const p = patterns[k];
    if (!p) throw new Error(`music: track ${track.name} references missing pattern "${k}"`);
    return p;
  });
  track._compiled = { patterns, order };
  return track._compiled;
}

// ---------------------------------------------------------------------------
// Instrument rendering
// ---------------------------------------------------------------------------

const NOISE_HITS = {
  h: { mode: 'white', clock: 17000, clockTo: 9000, dur: 0.028, vol: 0.055, filter: { type: 'highpass', freq: 4000 } },
  o: { mode: 'white', clock: 16000, clockTo: 6000, dur: 0.13, vol: 0.055, filter: { type: 'highpass', freq: 3000 } },
  s: { mode: 'white', clock: 10500, clockTo: 4200, dur: 0.09, vol: 0.1, filter: { type: 'bandpass', freq: 2400, freqTo: 1100, Q: 0.9 } },
  k: { mode: 'white', clock: 1500, clockTo: 500, dur: 0.075, vol: 0.11, filter: { type: 'lowpass', freq: 900, Q: 1.2 } },
  t: { mode: 'periodic', freq: 220, freqTo: 120, dur: 0.1, vol: 0.09, filter: { type: 'lowpass', freq: 2600 } },
  c: { mode: 'periodic', freq: 900, freqTo: 500, dur: 0.035, vol: 0.07 },
  x: { mode: 'white', clock: 15000, clockTo: 2500, dur: 0.4, vol: 0.09, filter: { type: 'highpass', freq: 1800 } },
};

const DRUM_KIND = {
  k: 'kick',
  s: 'snare',
  h: 'hat',
  o: 'openhat',
  t: 'tom',
  c: 'click',
  x: 'crash',
};

function emitEvent(E, row, ev, time, stepDur, trackVol) {
  const o = row.opts;
  const accent = ev.accent ? 1.38 : 1;

  if (row.kind === 'drum') {
    const kind = DRUM_KIND[ev.name] || 'click';
    E.drum({
      time,
      kind,
      vol: (o.vol == null ? 0.2 : o.vol) * accent * trackVol,
      rate: o.rate == null ? 1 : o.rate,
      bus: 'music',
      channel: 'dpcm',
      tag: '__music',
    });
    return;
  }

  if (row.kind === 'noise') {
    const hit = NOISE_HITS[ev.name] || NOISE_HITS.h;
    E.noise({
      time,
      dur: hit.dur,
      mode: hit.mode,
      clock: hit.clock,
      clockTo: hit.clockTo,
      freq: hit.freq,
      freqTo: hit.freqTo,
      vol: (o.vol == null ? 1 : o.vol) * hit.vol * accent * trackVol * 2,
      attack: 0.001,
      decay: hit.dur * 0.9,
      sustain: 0.08,
      release: 0.015,
      filter: hit.filter,
      bus: 'music',
      channel: 'noise',
      tag: '__music',
    });
    return;
  }

  const gate = o.gate == null ? 0.86 : o.gate;
  const dur = Math.max(0.028, ev.len * stepDur * gate);
  const semis = o.transpose || 0;
  const freq = noteToFreq(ev.name) * Math.pow(2, semis / 12);
  if (!(freq > 0)) return;

  const spec = {
    time,
    dur,
    freq,
    vol: (o.vol == null ? 0.18 : o.vol) * accent * trackVol,
    attack: o.attack == null ? 0.002 : o.attack,
    decay: o.decay == null ? dur * 0.85 : o.decay,
    sustain: o.sustain == null ? 0.62 : o.sustain,
    release: o.release == null ? 0.022 : o.release,
    bus: 'music',
    channel: row.name,
    tag: '__music',
  };
  if (o.vibrato && ev.len * stepDur > 0.35) spec.vibrato = o.vibrato;
  if (o.arp) spec.arp = o.arp;

  if (row.kind === 'triangle') {
    E.triangle(spec);
  } else {
    spec.duty = o.duty == null ? DUTY.D50 : o.duty;
    E.pulse(spec);
  }
}

// ---------------------------------------------------------------------------
// Sequencer
// ---------------------------------------------------------------------------

const HURRY_SCALE = 1.32;

export class Sequencer {
  constructor(engine) {
    this.engine = engine;
    this.track = null;
    this.name = null;
    this.order = null;
    this.state = null;
    this.paused = false;
    this.hurry = false;
    this.endAction = null;
    this._pendingEnd = null;
    this._starSaved = null;
    this._pump = (now, until) => this._schedule(now, until);
    engine.onPump(this._pump);
  }

  get playing() {
    return !!this.track && !this.paused;
  }

  get tempoScale() {
    return this.hurry ? HURRY_SCALE : 1;
  }

  stepDur(step) {
    const t = this.track;
    const spb = t.stepsPerBeat || 4;
    let d = 60 / ((t.bpm || 150) * spb) / this.tempoScale;
    if (t.swing) {
      const k = step % spb;
      d *= k < spb / 2 ? 1 + t.swing : 1 - t.swing;
    }
    return d;
  }

  play(name, opts = {}) {
    const track = getTrack(name);
    if (!track) {
      this.stop();
      return null;
    }
    const key = track.name;
    if (!opts.restart && this.track === track && !this.paused && !this._pendingEnd) return track;

    this.engine.releaseTag('__music', this.engine.now(), 0.03);
    compileTrack(track);
    this.track = track;
    this.name = key;
    this.order = track._compiled.order;
    this.paused = false;
    this._pendingEnd = null;
    this.endAction = opts.then === undefined ? track.then || null : opts.then;
    if (!opts.keepHurry) this.hurry = false;
    this.state = {
      orderIdx: 0,
      step: 0,
      time: this.engine.now() + 0.06,
    };
    return track;
  }

  stop(fade = 0.05) {
    this.track = null;
    this.name = null;
    this.order = null;
    this.state = null;
    this._pendingEnd = null;
    this.paused = false;
    this.engine.releaseTag('__music', this.engine.now(), fade);
  }

  pause() {
    if (!this.track || this.paused) return;
    this.paused = true;
    this.engine.releaseTag('__music', this.engine.now(), 0.03);
  }

  resume() {
    if (!this.track || !this.paused) return;
    this.paused = false;
    this.state.time = this.engine.now() + 0.05;
  }

  setHurry(on) {
    this.hurry = !!on;
  }

  // Star power replaces the level track, then hands it back when it wears off.
  star(on) {
    if (on) {
      if (this._starSaved) return;
      this._starSaved = { name: this.name, hurry: this.hurry };
      this.play('star', { restart: true, keepHurry: true });
    } else {
      const saved = this._starSaved;
      this._starSaved = null;
      if (!saved) return;
      this.hurry = saved.hurry;
      if (saved.name) this.play(saved.name, { restart: true, keepHurry: true });
      else this.stop();
    }
  }

  get starActive() {
    return !!this._starSaved;
  }

  _schedule(now, until) {
    if (this._pendingEnd && now >= this._pendingEnd.at) {
      const end = this._pendingEnd;
      this._pendingEnd = null;
      this.track = null;
      this.name = null;
      this._runEnd(end.action);
    }
    if (!this.track || this.paused || !this.state) return;
    const st = this.state;
    if (st.time < now) st.time = now + 0.03;

    let guard = 0;
    while (st.time < until && this.track && guard++ < 600) {
      const pat = this.order[st.orderIdx];
      if (!pat) {
        this._finish(st.time);
        return;
      }
      const trackVol = this.track.vol == null ? 1 : this.track.vol;
      const sd = this.stepDur(st.step);
      for (const row of pat.rows) {
        const evs = row.byStep.get(st.step);
        if (!evs) continue;
        for (const ev of evs) emitEvent(this.engine, row, ev, st.time, sd, trackVol);
      }
      st.time += sd;
      st.step++;
      if (st.step >= pat.steps) {
        st.step = 0;
        st.orderIdx++;
        if (st.orderIdx >= this.order.length) {
          if (this.track.loop === false) {
            this._finish(st.time);
            return;
          }
          st.orderIdx = this.track.loopIndex || 0;
        }
      }
    }
  }

  _finish(at) {
    this._pendingEnd = { at: at + (this.track && this.track.tail ? this.track.tail : 0.2), action: this.endAction };
    this.state = null;
    this.order = null;
    this.endAction = null;
  }

  _runEnd(action) {
    if (!action) return;
    if (typeof action === 'function') action(this);
    else if (action === 'restore') {
      const saved = this._starSaved;
      this._starSaved = null;
      if (saved && saved.name) this.play(saved.name, { restart: true });
    } else if (typeof action === 'string') {
      this.play(action, { restart: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

const D125 = DUTY.D125;
const D25 = DUTY.D25;
const D50 = DUTY.D50;

const OVER_P2 = {
  a: '-:2 e4:2 -:2 g4:2 -:2 e4:2 -:2 g4:2 | -:2 f4:2 -:2 a4:2 -:2 f4:2 -:2 a4:2 |' +
     '-:2 g4:2 -:2 b4:2 -:2 g4:2 -:2 d5:2 | -:2 e4:2 -:2 g4:2 -:2 e4:2 -:2 c4:2',
  b: '-:2 c4:2 -:2 e4:2 -:2 c4:2 -:2 e4:2 | -:2 a3:2 -:2 c4:2 -:2 a3:2 -:2 c4:2 |' +
     '-:2 b3:2 -:2 d4:2 -:2 b3:2 -:2 d4:2 | -:2 c4:2 -:2 e4:2 -:2 g4:2 -:2 e4:2',
  c: '-:2 f4:2 -:2 a4:2 -:2 f4:2 -:2 a4:2 | -:2 f4:2 -:2 b4:2 -:2 f4:2 -:2 b4:2 |' +
     '-:2 a4:2 -:2 c5:2 -:2 a4:2 -:2 c5:2 | -:2 b4:2 -:2 d5:2 -:2 f4:2 -:2 b4:2',
};

const OVER_NOISE = 'h:2 h:2 s:2 h:2 h:2 h:2 s:2 h:2';
const OVER_DPCM = 'k:4 -:4 k:2 k:2 -:4';

const TRACK_LIST = [
  // -- bright, syncopated, walking triangle bass ---------------------------
  {
    name: 'overworld',
    bpm: 176,
    stepsPerBeat: 4,
    swing: 0.09,
    vol: 1,
    order: ['intro', 'a', 'b', 'a', 'c'],
    loopIndex: 1,
    channels: null,
    patterns: {
      intro: {
        p1: { s: 'c5 d5 e5 f5 g5:2 -:2 g5:2 e5:2 c5:4 | d5:2 e5:2 f5:2 g5:2 a5:4 g5:4', duty: D50, vol: 0.2 },
        p2: { s: '-:8 e4:2 -:2 c4:4 | -:8 c5:4 b4:4', duty: D25, vol: 0.1, gate: 0.7 },
        tri: { s: 'c3:4 c3:4 g2:4 g2:4 | f3:4 f3:4 g3:2 g3:2 g3:4', vol: 0.3 },
        noise: { s: '-:8 h:2*4 | h:2*8', vol: 1 },
      },
      a: {
        p1: {
          s: 'e5:3 g5 c6:4 b5:2 g5:2 e5:4 | f5:3 a5 c6:2 a5:2 g5:4 -:4 |' +
             'd5:3 f5 b5:4 a5:2 f5:2 d5:4 | c5:2 e5:2 g5:2 c6:2 g5:4 -:4',
          duty: D50,
          vol: 0.2,
        },
        p2: { s: OVER_P2.a, duty: D25, vol: 0.095, gate: 0.6 },
        tri: {
          s: 'c3:2 g3:2 c4:2 g3:2 e3:2 g3:2 c4:2 b3:2 | f3:2 c4:2 f4:2 c4:2 a3:2 c4:2 f4:2 e4:2 |' +
             'g3:2 d4:2 g4:2 d4:2 b3:2 d4:2 g4:2 f4:2 | c3:2 g3:2 c4:2 e4:2 g3:2 e3:2 c3:2 g2:2',
          vol: 0.3,
          gate: 0.82,
        },
        noise: { s: OVER_NOISE + '|' + OVER_NOISE + '|' + OVER_NOISE + '|' + OVER_NOISE, vol: 1 },
        dpcm: { s: OVER_DPCM + '|' + OVER_DPCM + '|' + OVER_DPCM + '|' + OVER_DPCM, vol: 0.16 },
      },
      b: {
        p1: {
          s: 'a5:2 - a5 g5:2 e5:2 a5:4 g5:4 | f5:2 - f5 e5:2 c5:2 f5:4 a5:4 |' +
             'g5:2 b5:2 d6:2 b5:2 g5:4 d5:4 | e5:2 g5:2 c6:4 -:2 g5:2 c6:4',
          duty: D50,
          vol: 0.2,
        },
        p2: { s: OVER_P2.b, duty: D25, vol: 0.095, gate: 0.6 },
        tri: {
          s: 'a2:2 e3:2 a3:2 e3:2 c3:2 e3:2 a3:2 g3:2 | f3:2 c4:2 f4:2 c4:2 a3:2 c4:2 f3:2 e3:2 |' +
             'g3:2 d4:2 g4:2 d4:2 b3:2 d4:2 g3:2 f3:2 | c3:2 g3:2 c4:2 g3:2 e4:2 c4:2 g3:2 g2:2',
          vol: 0.3,
          gate: 0.82,
        },
        noise: { s: OVER_NOISE + '|' + OVER_NOISE + '|' + OVER_NOISE + '|' + OVER_NOISE, vol: 1 },
        dpcm: { s: OVER_DPCM + '|' + OVER_DPCM + '|' + OVER_DPCM + '|' + OVER_DPCM, vol: 0.16 },
      },
      c: {
        p1: {
          s: 'd5:2 f5:2 a5:2 f5:2 d5 e5 f5:2 a5:4 | b4:2 d5:2 g5:2 d5:2 b4 c5 d5:2 f5:4 |' +
             'c5:2 f5:2 a5:2 c6:2 a5:4 f5:4 | b5:2 a5:2 g5:2 f5:2 e5:2 d5:2 g5:4',
          duty: D50,
          vol: 0.2,
        },
        p2: { s: OVER_P2.c, duty: D25, vol: 0.095, gate: 0.6 },
        tri: {
          s: 'd3:2 a3:2 d4:2 a3:2 f3:2 a3:2 d4:2 c4:2 | g2:2 d3:2 g3:2 d3:2 b2:2 d3:2 g3:2 f3:2 |' +
             'f3:2 c4:2 f4:2 c4:2 a3:2 c4:2 f3:2 e3:2 | g3:2 d4:2 g3:2 b3:2 d4:2 b3:2 g3:2 g2:2',
          vol: 0.3,
          gate: 0.82,
        },
        noise: { s: OVER_NOISE + '|' + OVER_NOISE + '|' + OVER_NOISE + '|' + 's:2 h:2 s:2 h:2 s:2 s:2 s:2 s:2', vol: 1 },
        dpcm: { s: OVER_DPCM + '|' + OVER_DPCM + '|' + OVER_DPCM + '|' + 'k:4 s:4 k:2 k:2 s:4', vol: 0.16 },
      },
    },
  },

  // -- sparse minor ostinato, sliding down in semitones --------------------
  {
    name: 'underground',
    bpm: 150,
    stepsPerBeat: 4,
    vol: 1,
    order: ['a'],
    loopIndex: 0,
    patterns: {
      a: {
        p1: {
          s: 'a3 e4 a4 - g4:2 -:2 e4 c4 a3 - -:4 | g#3 e4 g#4 - f#4:2 -:2 d#4 b3 g#3 - -:4 |' +
             'g3 d4 g4 - f4:2 -:2 d4 a#3 g3 - -:4 | f#3 c#4 f#4 - e4:2 -:2 c#4 a3 f#3 - -:4',
          duty: D50,
          vol: 0.21,
          gate: 0.8,
          decay: 0.09,
          sustain: 0.4,
        },
        p2: {
          s: 'a3 e4 a4 - g4:2 -:2 e4 c4 a3 - -:4 | g#3 e4 g#4 - f#4:2 -:2 d#4 b3 g#3 - -:4 |' +
             'g3 d4 g4 - f4:2 -:2 d4 a#3 g3 - -:4 | f#3 c#4 f#4 - e4:2 -:2 c#4 a3 f#3 - -:4',
          duty: D125,
          transpose: -12,
          vol: 0.075,
          gate: 0.7,
        },
        tri: {
          s: 'a2:4 -:2 a2:2 -:4 e2:4 | g#2:4 -:2 g#2:2 -:4 d#2:4 |' +
             'g2:4 -:2 g2:2 -:4 d2:4 | f#2:4 -:2 f#2:2 -:4 c#2:4',
          vol: 0.3,
          gate: 0.9,
        },
        noise: { s: '-:4 h:4 -:4 h:4 | -:4 h:4 -:4 h:4 | -:4 h:4 -:4 h:4 | -:4 h:4 -:4 o:4', vol: 0.9 },
      },
    },
  },

  // -- HARRY'S LAVA — the song for the levels built from Harry's paintings --
  //
  // Written for h-1 and whatever follows it: an underground level whose floor
  // is a lava lake. It has to sound HOT rather than merely dark, so it is not a
  // variation on the cave tune:
  //
  //   * D minor, and the phrase falls i - VI - III - V (Dm - Bb - F - A). The
  //     major V at the end of every four bars is the hook — it keeps lifting,
  //     so the tune stays an adventure instead of a dirge. This is a level a
  //     six-year-old drew and should be fun to die to.
  //   * the triangle plays a slow, heavy two-note lurch with an octave kick on
  //     the offbeat: molten, sluggish, moving whether you are or not.
  //   * section B abandons the key and walks down in semitones, then climbs the
  //     whole chromatic scale back up in one bar. That is the "you are over the
  //     lava now" section.
  //   * the noise channel is mostly high ticks with a snare on the third beat,
  //     and opens out to hats at the end of a phrase — bubbling, not marching.
  //
  // Slower than the cave (144 against 150) because the level is a jumping
  // puzzle: the beat lands where you take off.
  {
    name: 'harry-lava',
    bpm: 144,
    stepsPerBeat: 4,
    // 0.88, not 1: five busy channels put this 15% hotter on peak than the
    // loudest existing track. Measured against all four level tunes rather than
    // guessed — see scratchpad/hear.mjs.
    vol: 0.88,
    order: ['a', 'a', 'b', 'a'],
    loopIndex: 0,
    patterns: {
      a: {
        p1: {
          s: 'd5:2 f5:2 a5:3 f5 d5:2 a4:2 d5:4 | a#4:2 d5:2 f5:3 d5 a#4:2 f4:2 a#4:4 |' +
             'c5:2 f5:2 a5:3 g5 f5:2 c5:2 f5:4 | e5:2 a5:2 c#6:2 a5:2 g5:2 e5:2 a5:4',
          duty: D50,
          vol: 0.2,
          gate: 0.84,
        },
        p2: {
          s: '-:2 f4:2 -:2 a4:2 -:2 d5:2 -:2 a4:2 | -:2 d4:2 -:2 f4:2 -:2 a#4:2 -:2 f4:2 |' +
             '-:2 a4:2 -:2 c5:2 -:2 f5:2 -:2 c5:2 | -:2 c#5:2 -:2 e5:2 -:2 a5:2 -:2 e5:2',
          duty: D125,
          vol: 0.085,
          gate: 0.55,
        },
        tri: {
          s: 'd2:4 d2:2 a2:2 d2:4 f2:4 | a#1:4 a#1:2 f2:2 a#1:4 d2:4 |' +
             'f2:4 f2:2 c3:2 f2:4 a2:4 | a2:4 a2:2 e3:2 a2:4 c#3:4',
          vol: 0.32,
          gate: 0.88,
        },
        noise: {
          s: '-:2 h:2 -:2 h:2 s:4 -:2 h:2 | -:2 h:2 -:2 h:2 s:4 -:2 h:2 |' +
             '-:2 h:2 -:2 h:2 s:4 -:2 h:2 | -:2 h:2 -:2 h:2 s:4 o:2 o:2',
          vol: 0.9,
        },
        dpcm: {
          s: 'k:4 k:4 k:2 -:2 k:4 | k:4 k:4 k:2 -:2 k:4 |' +
             'k:4 k:4 k:2 -:2 k:4 | k:4 k:4 k:2 k:2 s:4',
          vol: 0.18,
        },
      },
      b: {
        p1: {
          s: 'a5:2 g#5:2 g5:2 f#5:2 f5:4 -:4 | f5:2 e5:2 d#5:2 d5:2 c#5:4 -:4 |' +
             'd5 d#5 e5 f5 f#5 g5 g#5 a5 a#5:2 a5:2 g5:2 f5:2 | d5:4 a4:4 d5:2 f5:2 a5:4',
          duty: D25,
          vol: 0.2,
          gate: 0.9,
        },
        p2: {
          s: '-:2 c#5:2 -:2 c#5:2 -:2 c5:2 -:2 c5:2 | -:2 b4:2 -:2 b4:2 -:2 a#4:2 -:2 a#4:2 |' +
             '-:4 a4:4 -:4 a4:4 | -:2 a4:2 -:2 f4:2 -:2 d4:2 -:4',
          duty: D125,
          vol: 0.085,
          gate: 0.6,
        },
        tri: {
          s: 'a2:2 a2:2 g#2:2 g#2:2 g2:2 g2:2 f#2:2 f#2:2 |' +
             'f2:2 f2:2 e2:2 e2:2 d#2:2 d#2:2 d2:2 d2:2 |' +
             'a#2:4 a2:4 g2:4 f2:4 | d2:4 d2:4 a1:4 d2:4',
          vol: 0.32,
          gate: 0.9,
        },
        noise: {
          s: 'h:2*6 s:4 | h:2*6 s:4 | h:2*6 s:4 | h:2*4 s:4 x:4',
          vol: 0.9,
        },
        dpcm: {
          s: 'k:2 -:2 k:2 -:2 k:4 k:4 | k:2 -:2 k:2 -:2 k:4 k:4 |' +
             'k:2 -:2 k:2 -:2 k:4 k:4 | k:4 k:4 k:4 x:4',
          vol: 0.18,
        },
      },
    },
  },

  // -- driving chromatic march --------------------------------------------
  {
    name: 'castle',
    bpm: 168,
    stepsPerBeat: 4,
    vol: 1,
    order: ['a', 'b'],
    loopIndex: 0,
    patterns: {
      a: {
        p1: {
          s: 'd4 d#4 e4 f4 d4 d#4 e4 f4 f#4 g4 g#4 a4 f#4 g4 g#4 a4 |' +
             'a#4 b4 c5 c#5 a#4 b4 c5 c#5 d5:2 c#5:2 c5:2 b4:2 |' +
             'a4 g#4 g4 f#4 f4 e4 d#4 d4 c#4 c4 b3 a#3 a3:2 d4:2 |' +
             'd4:2 -:2 d4:2 -:2 a3:2 -:2 d4:4',
          duty: D25,
          vol: 0.19,
          gate: 0.9,
        },
        p2: {
          s: 'a3:4 -:2 a3:2 g#3:4 -:2 g#3:2 | f3:4 -:2 f3:2 e3:4 -:2 e3:2 |' +
             'd#3:4 -:2 d#3:2 d3:4 -:2 d3:2 | a3:2 a3:2 g#3:2 g3:2 f#3:2 f3:2 e3:4',
          duty: D125,
          vol: 0.1,
          gate: 0.75,
        },
        tri: {
          s: 'd2:2*4 f2:2*4 | a#2:2*4 c3:2*2 b2:2*2 | a2:2*2 g2:2*2 f2:2*2 e2:2*2 | d2:2*2 a2:2*2 d2:4 d3:4',
          vol: 0.31,
          gate: 0.78,
        },
        noise: {
          s: 's:2! s:2 s:2 s:2 s:2! s:2 s:2 s:2 | s:2! s:2 s:2 s:2 s:2! s:2 s:2 s:2 |' +
             's:2! s:2 s:2 s:2 s:2! s:2 s:2 s:2 | s:2! s:2 s:2 s:2 s:2! s:2 s:2 s:2',
          vol: 0.85,
        },
        dpcm: { s: 'k:4 s:4 k:2 k:2 s:4 | k:4 s:4 k:2 k:2 s:4 | k:4 s:4 k:2 k:2 s:4 | k:4 s:4 k:2 k:2 s:4', vol: 0.17 },
      },
      b: {
        p1: {
          s: 'f4:2 e4:2 f4:2 g#4:2 a4:2 g#4:2 a4:2 c5:2 |' +
             'c#5:2 c5:2 b4:2 a#4:2 a4:2 g#4:2 g4:2 f#4:2 |' +
             'f4 f#4 g4 g#4 a4 a#4 b4 c5 c#5 d5 d#5 e5 f5:2 e5:2 |' +
             'd5:2 c#5:2 c5:2 b4:2 a#4:4 a4:4',
          duty: D25,
          vol: 0.19,
          gate: 0.9,
        },
        p2: {
          s: 'c3:4 -:2 c3:2 c#3:4 -:2 c#3:2 | d3:4 -:2 d3:2 d#3:4 -:2 d#3:2 |' +
             'e3:4 -:2 e3:2 f3:4 -:2 f3:2 | f#3:2 f3:2 e3:2 d#3:2 d3:4 a2:4',
          duty: D125,
          vol: 0.1,
          gate: 0.75,
        },
        tri: {
          s: 'f2:2*4 g#2:2*4 | a2:2*4 f2:2*4 | d2:2*4 d#2:2*4 | e2:2*4 a2:2*2 a1:2*2',
          vol: 0.31,
          gate: 0.78,
        },
        noise: {
          s: 's:2! s:2 s:2 s:2 s:2! s:2 s:2 s:2 | s:2! s:2 s:2 s:2 s:2! s:2 s:2 s:2 |' +
             's:2! s:2 s:2 s:2 s:2! s:2 s:2 s:2 | s:1*8 s:2! s:2 s:2 s:2',
          vol: 0.85,
        },
        dpcm: { s: 'k:4 s:4 k:2 k:2 s:4 | k:4 s:4 k:2 k:2 s:4 | k:4 s:4 k:2 k:2 s:4 | k:4 k:4 k:4 x:4', vol: 0.17 },
      },
    },
  },

  // -- slow waltz arpeggios, 3/4 (12 steps per bar) ------------------------
  {
    name: 'underwater',
    bpm: 132,
    stepsPerBeat: 4,
    vol: 1,
    order: ['a'],
    loopIndex: 0,
    patterns: {
      a: {
        p1: {
          s: 'g4:2 b4:2 d5:2 g5:2 d5:2 b4:2 | e4:2 g4:2 b4:2 e5:2 b4:2 g4:2 |' +
             'c5:2 e5:2 g5:2 c6:2 g5:2 e5:2 | d5:2 f#5:2 a5:2 d6:2 a5:2 f#5:2 |' +
             'a4:2 c5:2 e5:2 a5:2 e5:2 c5:2 | d5:2 f#5:2 a5:2 d6:2 a5:2 f#5:2 |' +
             'g4:2 b4:2 d5:2 g5:2 d5:2 b4:2 | d5:2 a4:2 f#4:2 d4:2 -:4',
          duty: D125,
          vol: 0.13,
          gate: 0.95,
          sustain: 0.5,
        },
        p2: {
          s: '-:4 d5:4 b4:4 | -:4 b4:4 g4:4 | -:4 g5:4 e5:4 | -:4 a5:8 |' +
             '-:4 c5:4 e5:4 | -:4 f#5:4 a5:4 | -:4 b5:4 g5:4 | -:4 d5:8',
          duty: D50,
          vol: 0.17,
          gate: 0.9,
          sustain: 0.75,
          vibrato: { rate: 5.4, depth: 22, delay: 0.16 },
        },
        tri: {
          s: 'g2:4 d3:4 b2:4 | e2:4 b2:4 g2:4 | c3:4 g3:4 e3:4 | d3:4 a3:4 f#3:4 |' +
             'a2:4 e3:4 c3:4 | d3:4 a3:4 f#3:4 | g2:4 d3:4 b2:4 | d3:4 a3:4 d3:4',
          vol: 0.27,
          gate: 0.72,
        },
      },
    },
  },

  // -- star power: fast and frantic ---------------------------------------
  {
    name: 'star',
    bpm: 250,
    stepsPerBeat: 4,
    vol: 1,
    order: ['a'],
    loopIndex: 0,
    patterns: {
      a: {
        p1: {
          s: 'c5 e5 g5 c6 g5 e5 c5 e5 f5 a5 c6 f6 c6 a5 f5 a5 |' +
             'd5 f#5 a5 d6 a5 f#5 d5 f#5 g5 b5 d6 g6 d6 b5 g5 b5 |' +
             'c6 b5 a#5 a5 g#5 g5 f#5 f5 e5 d#5 d5 c#5 c5 b4 a#4 a4 |' +
             'g4:2 c5:2 e5:2 g5:2 c6:4 -:4',
          duty: D50,
          vol: 0.2,
          gate: 0.9,
        },
        p2: {
          s: 'c5 e5 g5 c6 g5 e5 c5 e5 f5 a5 c6 f6 c6 a5 f5 a5 |' +
             'd5 f#5 a5 d6 a5 f#5 d5 f#5 g5 b5 d6 g6 d6 b5 g5 b5 |' +
             'c6 b5 a#5 a5 g#5 g5 f#5 f5 e5 d#5 d5 c#5 c5 b4 a#4 a4 |' +
             'g4:2 c5:2 e5:2 g5:2 c6:4 -:4',
          duty: D125,
          transpose: -12,
          vol: 0.1,
          gate: 0.8,
        },
        tri: {
          s: 'c3:2 c2:2 c3:2 c2:2 f3:2 f2:2 f3:2 f2:2 | d3:2 d2:2 d3:2 d2:2 g3:2 g2:2 g3:2 g2:2 |' +
             'c3:2 c2:2 a2:2 a1:2 g#2:2 g#1:2 g2:2 g1:2 | g2:2 g3:2 c3:2 c4:2 g3:2 e3:2 c3:4',
          vol: 0.32,
          gate: 0.8,
        },
        noise: {
          s: 's! h h h s h h h s! h h h s h h h | s! h h h s h h h s! h h h s h h h |' +
             's! h h h s h h h s! h h h s h h h | s! h h h s h h h s! s s s s s s s',
          vol: 0.9,
        },
        dpcm: { s: 'k:2 -:2 k:2 -:2 k:2 -:2 k:2 k:2 | k:2 -:2 k:2 -:2 k:2 -:2 k:2 k:2 |' +
                   'k:2 -:2 k:2 -:2 k:2 -:2 k:2 k:2 | k:2 -:2 k:2 -:2 k:2 k:2 k:2 k:2', vol: 0.18 },
      },
    },
  },

  // -- bouncy 6/8 for athletic / sky stages --------------------------------
  {
    name: 'athletic',
    bpm: 200,
    stepsPerBeat: 4,
    vol: 1,
    order: ['a'],
    loopIndex: 0,
    patterns: {
      a: {
        p1: {
          s: 'g4 b4 d5 g5:3 d5:2 b4:2 g4:2 | c5 e5 g5 c6:3 g5:2 e5:2 c5:2 |' +
             'a4 c5 e5 a5:3 e5:2 c5:2 a4:2 | d5 f#5 a5 d6:3 a5:3 f#5:3 |' +
             'b4 d5 g5 b5:3 g5:2 d5:2 b4:2 | c5 e5 a5 c6:3 a5:2 e5:2 c5:2 |' +
             'd5 f#5 a5 d6:3 c6:2 a5:2 f#5:2 | g5:3 d5:3 b4:3 g4:3',
          duty: D50,
          vol: 0.19,
          gate: 0.82,
        },
        p2: {
          s: '-:2 b3:2 -:2 d4:2 -:2 b3:2 | -:2 c4:2 -:2 e4:2 -:2 c4:2 |' +
             '-:2 c4:2 -:2 e4:2 -:2 a3:2 | -:2 a3:2 -:2 d4:2 -:2 a3:2 |' +
             '-:2 d4:2 -:2 g4:2 -:2 d4:2 | -:2 e4:2 -:2 a4:2 -:2 e4:2 |' +
             '-:2 a3:2 -:2 d4:2 -:2 f#4:2 | -:2 b3:2 -:2 d4:2 -:2 g4:2',
          duty: D25,
          vol: 0.09,
          gate: 0.6,
        },
        tri: {
          s: 'g2:2 d3:2 g3:2 d3:2 b2:2 d3:2 | c3:2 g3:2 c4:2 g3:2 e3:2 g3:2 |' +
             'a2:2 e3:2 a3:2 e3:2 c3:2 e3:2 | d3:2 a3:2 d4:2 a3:2 f#3:2 a3:2 |' +
             'g2:2 d3:2 g3:2 d3:2 b2:2 d3:2 | a2:2 e3:2 a3:2 e3:2 c3:2 e3:2 |' +
             'd3:2 a3:2 d4:2 a3:2 f#3:2 a3:2 | g2:2 d3:2 g3:2 g2:2 d3:2 d3:2',
          vol: 0.29,
          gate: 0.8,
        },
        noise: { s: 'h:2 s:2 h:2 h:2 s:2 h:2*43', vol: 0.85 },
        dpcm: { s: 'k:6 s:6 | k:6 s:6 | k:6 s:6 | k:6 s:6 | k:6 s:6 | k:6 s:6 | k:6 s:6 | k:6 s:3 s:3', vol: 0.16 },
      },
    },
  },

  // -- one shots -----------------------------------------------------------
  {
    name: 'level-complete',
    bpm: 150,
    stepsPerBeat: 4,
    loop: false,
    vol: 1.05,
    order: ['a'],
    tail: 0.35,
    patterns: {
      a: {
        p1: {
          s: 'g4:2 c5:2 e5:2 g5:2 c6:4 e6:4 | f6:2 e6:2 d6:2 c6:2 d6:4 g5:4 |' +
             'e6:2 g6:2 c7:4 g6:2 e6:2 c6:4 | c6:16',
          duty: D50,
          vol: 0.22,
          gate: 0.94,
          sustain: 0.8,
          vibrato: { rate: 7, depth: 26, delay: 0.2 },
        },
        p2: {
          s: 'e4:2 g4:2 c5:2 e5:2 g5:4 c6:4 | a5:2 g5:2 f5:2 e5:2 f5:4 d5:4 |' +
             'c6:2 e6:2 g6:4 e6:2 c6:2 g5:4 | e5:16',
          duty: D25,
          vol: 0.12,
          gate: 0.94,
          sustain: 0.75,
        },
        tri: {
          s: 'c3:4 c3:4 c3:4 c3:4 | f2:4 f2:4 g2:4 g2:4 | c3:4 c3:4 g2:4 g2:4 | c2:8 c3:8',
          vol: 0.31,
          gate: 0.85,
        },
        noise: { s: 'h:2*8 | h:2*8 | h:2*8 | x:16', vol: 0.9 },
        dpcm: { s: 'k:4 s:4 k:4 s:4 | k:4 s:4 k:4 s:4 | k:4 s:4 k:4 s:4 | x:16', vol: 0.2 },
      },
    },
  },

  {
    name: 'game-over',
    bpm: 120,
    stepsPerBeat: 4,
    loop: false,
    vol: 1,
    order: ['a'],
    tail: 0.5,
    patterns: {
      a: {
        p1: {
          s: 'e5:4 c5:4 a4:4 e4:4 | f4:4 d4:4 b3:4 g#3:4 | a3:8 -:8',
          duty: D50,
          vol: 0.21,
          gate: 0.9,
          sustain: 0.7,
          vibrato: { rate: 5, depth: 30, delay: 0.25 },
        },
        p2: {
          s: 'c5:4 a4:4 e4:4 c4:4 | d4:4 b3:4 g#3:4 e3:4 | e3:8 -:8',
          duty: D25,
          vol: 0.11,
          gate: 0.9,
          sustain: 0.7,
        },
        tri: { s: 'a2:8 e2:8 | d2:8 e2:8 | a1:12 -:4', vol: 0.3, gate: 0.9 },
      },
    },
  },

  {
    name: 'death',
    bpm: 160,
    stepsPerBeat: 4,
    loop: false,
    vol: 1,
    order: ['a'],
    tail: 0.3,
    patterns: {
      a: {
        p1: {
          s: 'b4:2 b4:2 -:4 b4:2 a#4:2 a4:4 | g#4:2 g4:2 f#4:2 f4:2 e4:8',
          duty: D50,
          vol: 0.22,
          gate: 0.88,
          sustain: 0.6,
        },
        p2: {
          s: '-:8 d4:2 c#4:2 c4:4 | b3:2 a#3:2 a3:2 g#3:2 g3:8',
          duty: D25,
          vol: 0.11,
          gate: 0.88,
        },
        tri: { s: 'e3:4 e3:4 e3:4 d#3:4 | d3:4 c#3:4 c3:8', vol: 0.3, gate: 0.85 },
        noise: { s: '-:12 h:2 h:2 | -:16', vol: 0.7 },
      },
    },
  },

  {
    name: 'title',
    bpm: 152,
    stepsPerBeat: 4,
    vol: 1,
    order: ['a'],
    loopIndex: 0,
    patterns: {
      a: {
        p1: {
          s: 'f4:2 a4:2 c5:2 f5:2 e5:4 c5:4 | d5:2 c5:2 a4:2 f4:2 g4:4 c5:4 |' +
             'a#4:2 d5:2 f5:2 a#5:2 a5:4 f5:4 | g5:2 f5:2 d5:2 a#4:2 c5:8 |' +
             'c5:2 f5:2 a5:2 c6:2 a5:4 f5:4 | g5:2 a5:2 a#5:2 c6:2 d6:4 c6:4 |' +
             'a5:2 g5:2 f5:2 e5:2 f5:4 g5:4 | f5:8 -:8',
          duty: D50,
          vol: 0.2,
          gate: 0.88,
        },
        p2: {
          s: '-:2 c4:2 -:2 f4:2 -:2 c4:2 -:2 a3:2 | -:2 a#3:2 -:2 d4:2 -:2 c4:2 -:2 g3:2 |' +
             '-:2 d4:2 -:2 f4:2 -:2 d4:2 -:2 a#3:2 | -:2 c4:2 -:2 g4:2 -:2 e4:2 -:2 c4:2 |' +
             '-:2 c4:2 -:2 f4:2 -:2 a4:2 -:2 f4:2 | -:2 d4:2 -:2 g4:2 -:2 a#3:2 -:2 g4:2 |' +
             '-:2 c4:2 -:2 a3:2 -:2 c4:2 -:2 d4:2 | -:2 a3:2 -:2 c4:2 -:2 f4:2 -:2 c4:2',
          duty: D25,
          vol: 0.095,
          gate: 0.6,
        },
        tri: {
          s: 'f2:4 c3:4 f3:4 c3:4 | a#2:4 f3:4 c3:4 g2:4 | a#2:4 f3:4 a#3:4 f3:4 | c3:4 g3:4 c4:4 g3:4 |' +
             'f2:4 c3:4 f3:4 a3:4 | g2:4 d3:4 a#2:4 f3:4 | c3:4 g3:4 c3:4 d3:4 | f2:4 c3:4 f2:4 c3:4',
          vol: 0.29,
          gate: 0.82,
        },
        noise: { s: 'h:2*64', vol: 0.75 },
      },
    },
  },

  {
    name: 'bowser-defeated',
    bpm: 144,
    stepsPerBeat: 4,
    loop: false,
    vol: 1.05,
    order: ['a'],
    tail: 0.4,
    patterns: {
      a: {
        p1: {
          s: 'c5:2 e5:2 g5:2 c6:2 e6:2 g6:2 c7:4 | b6:2 a6:2 g6:2 e6:2 g6:8 |' +
             'f6:2 a6:2 c7:2 a6:2 g6:4 e6:4 | d6:2 f6:2 a6:2 d7:2 c7:8 |' +
             'g6:2 f6:2 e6:2 d6:2 c6:8 | c6:16',
          duty: D50,
          vol: 0.22,
          gate: 0.94,
          sustain: 0.8,
          vibrato: { rate: 6.6, depth: 28, delay: 0.22 },
        },
        p2: {
          s: 'c4:2 e4:2 g4:2 c5:2 e5:2 g5:2 c6:4 | g5:2 f5:2 e5:2 c5:2 d5:8 |' +
             'c6:2 f5:2 a5:2 f5:2 e5:4 c5:4 | a5:2 d5:2 f5:2 a5:2 g5:8 |' +
             'e5:2 d5:2 c5:2 b4:2 g4:8 | e5:16',
          duty: D25,
          vol: 0.12,
          gate: 0.94,
          sustain: 0.75,
        },
        tri: {
          s: 'c3:4 c3:4 g2:4 g2:4 | e3:4 e3:4 g2:4 g2:4 | f2:4 f2:4 c3:4 c3:4 |' +
             'd3:4 d3:4 g2:4 g2:4 | g2:4 g2:4 g1:4 g2:4 | c2:8 c3:8',
          vol: 0.31,
          gate: 0.86,
        },
        noise: { s: 'h:2*40 x:16', vol: 0.9 },
        dpcm: { s: 'k:8*10 x:16', vol: 0.2 },
      },
    },
  },
];

const TRACKS = {};
for (const t of TRACK_LIST) TRACKS[t.name] = t;

const TRACK_ALIASES = {
  water: 'underwater',
  underwater: 'underwater',
  swim: 'underwater',
  sea: 'underwater',
  'star-power': 'star',
  starman: 'star',
  invincible: 'star',
  star: 'star',
  sky: 'athletic',
  bonus: 'athletic',
  'course-clear': 'level-complete',
  'level-clear': 'level-complete',
  clear: 'level-complete',
  fanfare: 'level-complete',
  win: 'level-complete',
  gameover: 'game-over',
  'game-over': 'game-over',
  die: 'death',
  dead: 'death',
  lose: 'death',
  menu: 'title',
  intro: 'title',
  boss: 'castle',
  bowser: 'castle',
  'world-clear': 'bowser-defeated',
  'bowser-defeat': 'bowser-defeated',
  victory: 'bowser-defeated',
  ending: 'bowser-defeated',
  overworld: 'overworld',
  underground: 'underground',
  castle: 'castle',
  // Harry's levels ask for their music by any of these
  harry: 'harry-lava',
  lava: 'harry-lava',
  'harry-lava': 'harry-lava',
  athletic: 'athletic',
  title: 'title',
  'level-complete': 'level-complete',
  death: 'death',
  'bowser-defeated': 'bowser-defeated',
};

export function getTrack(name) {
  if (!name) return null;
  const key = TRACK_ALIASES[String(name).toLowerCase()] || String(name).toLowerCase();
  return TRACKS[key] || null;
}

export const MUSIC_NAMES = Object.keys(TRACKS);

// ---------------------------------------------------------------------------
// Facade
// ---------------------------------------------------------------------------

export const sequencer = new Sequencer(audio);

/** Audio.music(name) — `null`/`'none'` stops. opts: { restart, then, keepHurry } */
export function playMusic(name, opts = {}) {
  if (!name || name === 'none' || name === 'off') {
    sequencer.stop(opts.fade == null ? 0.06 : opts.fade);
    return null;
  }
  const track = getTrack(name);
  if (!track) return null;
  // A one-shot (death, fanfare) always interrupts; a level track requested while
  // star power is running just becomes the track we hand back afterwards.
  if (sequencer.starActive && track.loop !== false) {
    sequencer._starSaved.name = track.name;
    return track.name;
  }
  if (sequencer.starActive && track.loop === false) sequencer._starSaved = null;
  sequencer.play(track.name, opts);
  return track.name;
}

export function stopMusic(fade) {
  sequencer.stop(fade);
}

export function pauseMusic() {
  sequencer.pause();
}

export function resumeMusic() {
  sequencer.resume();
}

/** Star power takes over the level track; call with false when it wears off. */
export function starMusic(on) {
  sequencer.star(on !== false);
}

/** Timer dipped under 100: warn, then run the track hot until the level resets. */
export function timeWarning() {
  audio.sfx('time-warning');
  sequencer.setHurry(true);
}

let lastTimeSeen = -1;
let warned = false;

/** Idempotent: feed it world.time every tick and the hurry-up handles itself. */
export function updateTime(seconds) {
  const t = Math.floor(seconds);
  if (t === lastTimeSeen) return;
  lastTimeSeen = t;
  if (t > 100) {
    if (warned) {
      warned = false;
      sequencer.setHurry(false);
    }
    return;
  }
  if (t <= 100 && t > 0 && !warned) {
    warned = true;
    timeWarning();
  }
}

export function setHurry(on) {
  warned = !!on;
  sequencer.setHurry(on);
}

audio.registerMusic(playMusic);

Object.assign(audio, {
  sequencer,
  stopMusic,
  pauseMusic,
  resumeMusic,
  star: starMusic,
  timeWarning,
  updateTime,
  setHurry,
  musicName: () => sequencer.name,
  tracks: MUSIC_NAMES,
});

export const Audio = audio;
export default playMusic;
