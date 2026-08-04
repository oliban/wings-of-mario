import { Rng } from '../core/rng.js';

// One falling-bomb whistle segment, on our own Web Audio graph.
//
// This does NOT go through src/audio/. The engine's playSfx is a one-shot with
// no live parameters, and src/audio/engine.js documents a `pan` option on
// pulse/triangle/noise that `_out()` never implements — so routing the whistle
// through it would cost an engine edit to obtain the one property the whistle
// exists for. Fifty lines here buys stereo, sample-accurate ramps and zero
// upstream surface.
//
// Every method is total: no AudioContext, a suspended context, a context
// constructor that throws — all of them are silence, never an exception. Audio
// may not take down a frame of gameplay.
export const SYNTH = {
  VOL: 0.09,
  NOISE_VOL: 0.03,
  // Each segment is held past its nominal end by FADE and releases over that
  // tail, so the next segment's attack happens while this one is still
  // sounding. Without the overlap the envelope reaches zero between every
  // segment and the sweep gates at 4 Hz — measured at ~90% depth, which reads
  // as a stutter rather than a fall. Long enough to avoid a click, short
  // enough not to smear the pitch, and it costs the last segment FADE of
  // overhang past impact.
  FADE: 0.006,
  // Deterministic noise, because everything else in this repo is.
  NOISE_SEED: 0x5eed1e,
  NOISE_SECONDS: 1,
};

export class WhistleSynth {
  constructor(opts = {}) {
    this.Ctx =
      opts.AudioContext !== undefined
        ? opts.AudioContext
        : (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ||
          null;
    this.enabled = opts.enabled !== false && !!this.Ctx;
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    // A bounded record of every segment asked for, whether or not it made a
    // sound. The browser test asserts on this rather than on an audio device.
    this.log = [];
    this.logMax = opts.logMax == null ? 256 : opts.logMax;
  }

  ensure() {
    if (this.ctx || !this.enabled || !this.Ctx) return this.ctx;
    try {
      this.ctx = new this.Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
    } catch (e) {
      // One failure is enough. Retrying every segment would throw sixty times
      // a second on a machine with no audio device.
      this.enabled = false;
      this.ctx = null;
      return null;
    }
    return this.ctx;
  }

  // Browsers will not start an AudioContext without a user gesture. Call this
  // from the first keydown or pointerdown; before that, play() records and
  // stays silent, which is exactly what should happen.
  unlock() {
    const ctx = this.ensure();
    if (!ctx) return false;
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      try {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) {
        /* a context that refuses to resume is silence, not a crash */
      }
    }
    return true;
  }

  // A second of white noise, built once, from a seeded generator so two runs
  // of the game are byte-identical.
  noise() {
    if (this.noiseBuffer || !this.ctx) return this.noiseBuffer;
    const len = Math.floor(this.ctx.sampleRate * SYNTH.NOISE_SECONDS);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    const rng = new Rng(SYNTH.NOISE_SEED);
    for (let i = 0; i < len; i++) data[i] = rng.float() * 2 - 1;
    this.noiseBuffer = buf;
    return buf;
  }

  record(opts) {
    this.log.push({ ...opts });
    while (this.log.length > this.logMax) this.log.shift();
  }

  // opts: {freq, to, dur, pan, tag}. Returns true when it actually made a
  // sound, so a test can tell silence apart from a no-op.
  play(opts = {}) {
    this.record(opts);
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running') return false;
    try {
      const t0 = ctx.currentTime;
      const dur = opts.dur == null ? 0.25 : opts.dur;
      const from = Math.max(1, opts.freq == null ? 1200 : opts.freq);
      const to = Math.max(1, opts.to == null ? from * 0.8 : opts.to);

      const pan = ctx.createStereoPanner();
      pan.pan.setValueAtTime(Math.max(-1, Math.min(1, opts.pan || 0)), t0);
      pan.connect(this.master);

      // The whistle proper: a sine sweeping geometrically downward. An
      // exponential ramp is the right curve here for the same reason pitchFor
      // is geometric — a linear one sounds like it stalls.
      // The segment sounds for `dur` and then releases over the overlap, so
      // the following segment's attack covers this one's release.
      const end = t0 + dur + SYNTH.FADE;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(SYNTH.VOL, t0 + SYNTH.FADE);
      gain.gain.setValueAtTime(SYNTH.VOL, t0 + Math.max(SYNTH.FADE, dur));
      gain.gain.linearRampToValueAtTime(0, end);
      gain.connect(pan);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(from, t0);
      osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      osc.connect(gain);
      osc.start(t0);
      osc.stop(end);

      // A breath of air under it, so it reads as something falling rather than
      // as a test tone.
      const buf = this.noise();
      if (buf) {
        const ngain = ctx.createGain();
        ngain.gain.setValueAtTime(0, t0);
        ngain.gain.linearRampToValueAtTime(SYNTH.NOISE_VOL, t0 + SYNTH.FADE);
        ngain.gain.linearRampToValueAtTime(0, end);
        ngain.connect(pan);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(ngain);
        src.start(t0);
        src.stop(end);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // The exact callable WhistleVoice wants, bound so it can be passed around.
  sink() {
    return (opts) => this.play(opts);
  }
}

export default WhistleSynth;
