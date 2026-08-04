import test from 'node:test';
import assert from 'node:assert/strict';
import { DT } from '../../src/core/constants.js';
import { WHISTLE, pitchFor, WhistleVoice } from '../../src/wings/whistle.js';
import { SYNTH, WhistleSynth } from '../../src/wings/whistle-audio.js';

// A mark as Telegraph.marks() produces it, cut down to what the whistle reads.
function mark(id, ticks, pan) {
  return { id, kind: 'bomb', pan, impact: { ticks } };
}

function collect() {
  const played = [];
  const v = new WhistleVoice((opts) => played.push({ ...opts }));
  return { v, played };
}

test('pitch falls as the bomb does', () => {
  assert.equal(pitchFor(WHISTLE.SPAN_TICKS * 2), WHISTLE.HIGH_HZ, 'far out sits at the top');
  assert.equal(pitchFor(0), WHISTLE.LOW_HZ, 'arrival is the bottom of the sweep');
  const mid = pitchFor(WHISTLE.SPAN_TICKS / 2);
  assert.ok(mid < WHISTLE.HIGH_HZ && mid > WHISTLE.LOW_HZ);
  assert.ok(pitchFor(30) < pitchFor(60), 'closer must always be lower');
});

test('a release starts a whistle immediately', () => {
  const { v, played } = collect();
  v.update([mark('a', 120, 0)]);
  assert.equal(played.length, 1);
  assert.equal(played[0].tag, 'whistle:a');
  assert.equal(played[0].pan, 0);
  assert.equal(played[0].freq, pitchFor(120));
  assert.equal(played[0].to, pitchFor(120 - WHISTLE.SEGMENT_TICKS));
  assert.ok(Math.abs(played[0].dur - WHISTLE.SEGMENT_TICKS * DT) < 1e-12);
});

test('it re-triggers once a segment, not once a tick', () => {
  const { v, played } = collect();
  for (let t = 0; t < WHISTLE.SEGMENT_TICKS * 3; t++) {
    v.update([mark('a', 200 - t, 0)]);
  }
  assert.equal(played.length, 3, `${played.length} calls is one per tick, not one per segment`);
});

test('the pan follows the bomb across Mario', () => {
  const { v, played } = collect();
  v.update([mark('a', 200, -1)]);
  for (let t = 1; t <= WHISTLE.SEGMENT_TICKS; t++) v.update([mark('a', 200 - t, 1)]);
  assert.equal(played.length, 2);
  assert.equal(played[0].pan, -1);
  assert.equal(played[1].pan, 1, 'the second segment must use the CURRENT offset');
});

test('the last segment ends at impact, not after it', () => {
  const { v, played } = collect();
  v.update([mark('a', 4, 0)]);
  assert.ok(Math.abs(played[0].dur - 4 * DT) < 1e-12, 'no whistle may outlive its bomb');
  assert.equal(played[0].to, pitchFor(0));
});

test('a mark with no impact prediction is silent', () => {
  const { v, played } = collect();
  v.update([{ id: 'a', kind: 'bomb', pan: 0, impact: null }]);
  assert.equal(played.length, 0, 'nothing to whistle about yet');
});

test('two bombs get two voices', () => {
  const { v, played } = collect();
  v.update([mark('a', 120, -0.5), mark('b', 60, 0.5)]);
  assert.deepEqual(played.map((p) => p.tag).sort(), ['whistle:a', 'whistle:b']);
  assert.notEqual(played[0].freq, played[1].freq, 'a closer bomb must sound lower');
});

test('a bomb that disappears stops being scheduled', () => {
  const { v, played } = collect();
  v.update([mark('a', 120, 0)]);
  v.stop('a');
  for (let t = 0; t < WHISTLE.SEGMENT_TICKS * 3; t++) v.update([]);
  assert.equal(played.length, 1);
  assert.equal(v.voices.size, 0);
});

test('a mark that vanishes without a stop is reaped anyway', () => {
  const { v } = collect();
  v.update([mark('a', 120, 0)]);
  v.update([]);
  assert.equal(v.voices.size, 0, 'a bomb the tracker dropped must not leak a voice');
});

test('reset silences everything', () => {
  const { v, played } = collect();
  v.update([mark('a', 120, 0), mark('b', 90, 0)]);
  v.reset();
  assert.equal(v.voices.size, 0);
  v.update([]);
  assert.equal(played.length, 2);
});

test('the scheduler reads no clock', () => {
  const run = () => {
    const { v, played } = collect();
    for (let t = 0; t < 200; t++) v.update([mark('a', 200 - t, (t % 40) / 20 - 1)]);
    return JSON.stringify(played);
  };
  assert.equal(run(), run());
});

// ---------------------------------------------------------------------------
// The synth, against a fake AudioContext. This is the whole reason the audio
// lives in src/wings/ rather than behind playSfx: it can be driven from Node.
// ---------------------------------------------------------------------------

function fakeParam(name, log) {
  return {
    value: 0,
    setValueAtTime(v, t) {
      log.push([`${name}.set`, v, t]);
      this.value = v;
    },
    exponentialRampToValueAtTime(v, t) {
      log.push([`${name}.exp`, v, t]);
    },
    linearRampToValueAtTime(v, t) {
      log.push([`${name}.lin`, v, t]);
    },
  };
}

function fakeCtx(state = 'running') {
  const log = [];
  const node = (kind, extra = {}) => ({
    kind,
    connect: (dst) => log.push(['connect', kind, dst && dst.kind]),
    disconnect: () => log.push(['disconnect', kind]),
    ...extra,
  });
  return {
    log,
    state,
    currentTime: 10,
    sampleRate: 48000,
    destination: node('destination'),
    resumed: 0,
    resume() {
      this.resumed++;
      this.state = 'running';
      return Promise.resolve();
    },
    createGain: () => node('gain', { gain: fakeParam('gain', log) }),
    createStereoPanner: () => node('panner', { pan: fakeParam('pan', log) }),
    createOscillator: () =>
      node('osc', {
        type: 'sine',
        frequency: fakeParam('freq', log),
        start: (t) => log.push(['osc.start', t]),
        stop: (t) => log.push(['osc.stop', t]),
      }),
    createBufferSource: () =>
      node('noise', {
        buffer: null,
        loop: false,
        start: (t) => log.push(['noise.start', t]),
        stop: (t) => log.push(['noise.stop', t]),
      }),
    createBuffer: (ch, len) => ({
      length: len,
      numberOfChannels: ch,
      getChannelData: () => new Float32Array(len),
    }),
  };
}

const synthWith = (ctx) =>
  new WhistleSynth({
    AudioContext: function () {
      return ctx;
    },
  });

test('a segment becomes an oscillator sweeping to the target pitch', () => {
  const ctx = fakeCtx();
  const s = synthWith(ctx);
  assert.equal(s.play({ freq: 1200, to: 800, dur: 0.25, pan: 0.5, tag: 'whistle:a' }), true);
  const names = ctx.log.map((e) => e[0]);
  assert.ok(names.includes('osc.start'), 'nothing was started');
  assert.ok(names.includes('osc.stop'), 'a voice with no stop leaks');
  const sweep = ctx.log.find((e) => e[0] === 'freq.exp');
  assert.ok(sweep, 'the pitch never swept');
  assert.equal(sweep[1], 800, 'it must sweep to the segment target');
  assert.equal(sweep[2], ctx.currentTime + 0.25, 'and land exactly at the end of the segment');
  const setPitch = ctx.log.find((e) => e[0] === 'freq.set');
  assert.equal(setPitch[1], 1200);
});

test('the pan reaches a real panner and is clamped', () => {
  const ctx = fakeCtx();
  const s = synthWith(ctx);
  s.play({ freq: 900, to: 700, dur: 0.2, pan: -4, tag: 'whistle:a' });
  const pan = ctx.log.find((e) => e[0] === 'pan.set');
  assert.ok(pan, 'no panner — the whistle would be mono, which is the point of it');
  assert.equal(pan[1], -1, 'pan must clamp to -1..1');
});

test('a suspended context schedules nothing but still records', () => {
  const ctx = fakeCtx('suspended');
  const s = synthWith(ctx);
  assert.equal(s.play({ freq: 900, to: 700, dur: 0.2, pan: 0, tag: 'whistle:a' }), false);
  assert.equal(ctx.log.filter((e) => e[0] === 'osc.start').length, 0);
  assert.equal(s.log.length, 1, 'the log is what the browser test asserts on');
  assert.equal(s.log[0].freq, 900);
});

test('unlock resumes a suspended context once it is allowed to', () => {
  const ctx = fakeCtx('suspended');
  const s = synthWith(ctx);
  assert.equal(s.unlock(), true);
  assert.equal(ctx.resumed, 1);
  assert.equal(s.play({ freq: 900, to: 700, dur: 0.2, pan: 0, tag: 'whistle:a' }), true);
});

test('no AudioContext at all is silence, not a crash', () => {
  const s = new WhistleSynth({ AudioContext: null });
  assert.equal(s.play({ freq: 900, to: 700, dur: 0.2, pan: 0, tag: 'x' }), false);
  assert.equal(s.unlock(), false);
  assert.equal(s.log.length, 1, 'a headless run must still be observable');
});

test('a constructor that throws disables the synth for good', () => {
  let tries = 0;
  const s = new WhistleSynth({
    AudioContext: function () {
      tries++;
      throw new Error('no audio device');
    },
  });
  s.play({ freq: 900, to: 700, dur: 0.2, pan: 0, tag: 'x' });
  s.play({ freq: 900, to: 700, dur: 0.2, pan: 0, tag: 'x' });
  assert.equal(tries, 1, 'it must not retry a context that already failed');
  assert.equal(s.enabled, false);
});

test('the log is bounded, so a long match cannot grow it forever', () => {
  const s = new WhistleSynth({ AudioContext: null, logMax: 4 });
  for (let i = 0; i < 20; i++) s.play({ freq: 900 + i, to: 700, dur: 0.1, pan: 0, tag: 'x' });
  assert.equal(s.log.length, 4);
  assert.equal(s.log[3].freq, 919, 'the log must keep the NEWEST calls');
});

test('sink() is the exact shape WhistleVoice wants', () => {
  const s = new WhistleSynth({ AudioContext: null });
  const v = new WhistleVoice(s.sink());
  v.update([mark('a', 120, 0.25)]);
  assert.equal(s.log.length, 1);
  assert.equal(s.log[0].pan, 0.25);
  assert.equal(s.log[0].tag, 'whistle:a');
});

test('the volume is quiet enough to sit under the music', () => {
  assert.ok(SYNTH.VOL > 0 && SYNTH.VOL < 0.2, 'a whistle louder than the game is a klaxon');
  assert.ok(SYNTH.NOISE_VOL < SYNTH.VOL, 'the air noise is a texture, not the sound');
});
