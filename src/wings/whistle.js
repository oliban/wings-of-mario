import { DT } from '../core/constants.js';

// The falling whistle: layer 1 of the telegraph, and the layer that has to
// arrive before anything is on screen.
//
// There is no audio in this file. It decides WHAT to play and WHEN, and hands
// each decision to a sink — WhistleSynth.sink() in the game, an array in the
// tests. Everything it reads comes from Telegraph.marks().
export const WHISTLE = {
  // A one-shot cannot track a moving object, so the whistle is re-triggered in
  // short segments, each starting where the last one ended. A quarter of a
  // second is short enough that the pan keeps up with a bomb crossing the
  // screen and long enough that it is a sweep rather than a stutter.
  SEGMENT_TICKS: 15,
  // The pitch band, and how far out the top of it sits. Beyond SPAN_TICKS the
  // whistle is at HIGH_HZ and stays there, so a long rocket flight does not
  // start inaudibly high.
  HIGH_HZ: 1500,
  LOW_HZ: 260,
  SPAN_TICKS: 180,
};

// Ticks-to-impact -> Hz. Geometric rather than linear, because pitch is heard
// geometrically: a linear ramp from 1500 to 260 spends most of its time in the
// bottom octave and sounds like it stops falling half way down.
export function pitchFor(ticks) {
  if (!(ticks > 0)) return WHISTLE.LOW_HZ;
  if (ticks >= WHISTLE.SPAN_TICKS) return WHISTLE.HIGH_HZ;
  const t = ticks / WHISTLE.SPAN_TICKS;
  return WHISTLE.LOW_HZ * Math.pow(WHISTLE.HIGH_HZ / WHISTLE.LOW_HZ, t);
}

export class WhistleVoice {
  // `sink({freq, to, dur, pan, tag})` plays one segment. It must never throw:
  // a broken sound may not take down a frame of gameplay.
  constructor(sink) {
    this.sink = sink;
    this.voices = new Map(); // id -> ticks until the next segment is due
  }

  // Call once per fixed step with the current Telegraph.marks(). A mark with
  // no `impact` has no predicted arrival, so there is no pitch to give it and
  // nothing is played; it will start whistling on the tick it acquires one.
  update(marks) {
    const seen = new Set();
    for (const m of marks) {
      if (!m.impact) continue;
      seen.add(m.id);
      const due = this.voices.get(m.id);
      if (due != null && due > 0) {
        this.voices.set(m.id, due - 1);
        continue;
      }
      this.play(m);
    }
    // A bomb the tracker has dropped — it landed, or expired, or the match
    // reset — leaves no voice behind.
    for (const id of [...this.voices.keys()]) if (!seen.has(id)) this.voices.delete(id);
  }

  play(m) {
    const ticks = m.impact.ticks;
    // Never schedule past the bang. The last segment is short and ends on it.
    const len = Math.max(1, Math.min(WHISTLE.SEGMENT_TICKS, ticks));
    this.sink({
      freq: pitchFor(ticks),
      to: pitchFor(ticks - len),
      dur: len * DT,
      pan: m.pan,
      // Per-bomb, so two bombs in the air are two voices rather than one
      // stealing the other.
      tag: `whistle:${m.id}`,
    });
    this.voices.set(m.id, len - 1);
  }

  stop(id) {
    return this.voices.delete(id);
  }

  reset() {
    this.voices.clear();
  }
}

export default WhistleVoice;
