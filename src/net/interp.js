import { INTERP_DELAY_TICKS } from './protocol.js';

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Fields that are numbers on the wire but discrete in meaning, and so are
// never blended however plainly numeric they look. `facing` is ±1: halfway
// between the two is 0, which is not a direction any sprite can be drawn in —
// exactly the same objection as a half-way animation name, and easier to miss
// because the arithmetic quietly succeeds.
export const DEFAULT_SNAP = ['facing'];

// The widest gap between two snapshots that is still worth interpolating
// across, in ticks. One second.
//
// Beyond it, blending is not smoothing, it is invention: a peer that jumped
// three thousand pixels between two packets did not glide there, and lerping
// says it did — at a twentieth of the real speed, for twenty seconds. That is
// exactly what a level change, a respawn, a scripted bot flight or a long
// stall looks like from the other side, and in every one of those cases the
// honest picture is the new position, now.
export const MAX_INTERP_SPAN_TICKS = 60;

// Numbers are interpolated; everything else takes the NEWER value. A half-way
// animation name or a half-way island id is not a thing, and guessing one is
// worse than being one snapshot stale.
//
// `opts.snap` ADDS to DEFAULT_SNAP rather than replacing it: a caller naming
// its own discrete field is not thereby asking for `facing` to start blending.
export function lerpState(a, b, t, opts = {}) {
  const snap = new Set([...DEFAULT_SNAP, ...(opts.snap || [])]);
  const out = {};
  for (const key of Object.keys(b)) {
    const av = a[key];
    const bv = b[key];
    if (!snap.has(key) && typeof av === 'number' && typeof bv === 'number') {
      out[key] = lerp(av, bv, t);
    } else {
      out[key] = bv;
    }
  }
  return out;
}

// A small ring of the peer's recent snapshots, replayed one interpolation delay
// behind. Two snapshot intervals of delay means a single lost packet still has
// a successor to interpolate toward, which is the difference between a peer
// that glides and a peer that stutters on every 20th frame.
//
// Everything here is measured in TICKS, never milliseconds: the peer's tick
// counter arrives in the snapshot, so interpolation stays as deterministic as
// the simulation it is showing. There is no clock in this file.
export class Interp {
  constructor(opts = {}) {
    this.capacity = opts.capacity || 32;
    this.delay = opts.delay != null ? opts.delay : INTERP_DELAY_TICKS;
    this.snapFields = opts.snap || [];
    this.maxSpan = opts.maxSpan != null ? opts.maxSpan : MAX_INTERP_SPAN_TICKS;
    this.buf = []; // ascending by tick
    // How far the peer's counter is ahead of ours. Null until the first
    // sampleLocal() establishes it. See sampleLocal for why it is not a
    // constant of the match.
    this._offset = null;
    // The newest tick we held when playback ran out of stream, or null when it
    // has not. Distinguishes "the peer is quiet" from "the peer is back".
    this._starvedAt = null;
  }

  get size() {
    return this.buf.length;
  }

  clear() {
    this.buf.length = 0;
    // The relationship between the two clocks belongs to the peer we were
    // talking to. Whoever fills this buffer next is counting from somewhere
    // else, and keeping the old offset would put playback minutes off.
    this._offset = null;
    this._starvedAt = null;
  }

  push(tick, state) {
    const newest = this.buf.length ? this.buf[this.buf.length - 1].tick : -Infinity;
    // A peer that reloaded starts counting from zero again. Keeping the old
    // samples would leave the avatar interpolating toward a tick that will not
    // arrive for another few minutes, i.e. frozen.
    if (tick < newest - this.capacity * 8) this.clear();

    let at = this.buf.length;
    while (at > 0 && this.buf[at - 1].tick > tick) at--;
    if (at > 0 && this.buf[at - 1].tick === tick) this.buf[at - 1].state = state;
    else this.buf.splice(at, 0, { tick, state });

    while (this.buf.length > this.capacity) this.buf.shift();
  }

  latest() {
    return this.buf.length ? this.buf[this.buf.length - 1].state : null;
  }

  // `peerTick` is a point on the PEER's own timeline — the counter that arrives
  // inside its snapshots. What comes back is the peer as it was one delay
  // earlier, so there is always a later sample to interpolate toward.
  //
  // Outside the buffer it HOLDS rather than extrapolates: guessing forward
  // looks like a teleport and a snap back when the next packet lands, whereas
  // holding still is honest — the peer has genuinely told us nothing.
  sample(peerTick) {
    if (!this.buf.length) return null;
    const oldest = this.buf[0].tick;
    const newest = this.buf[this.buf.length - 1].tick;
    const at = Math.min(newest, Math.max(oldest, peerTick - this.delay));

    if (at <= oldest) return this.buf[0].state;
    if (at >= newest) return this.buf[this.buf.length - 1].state;

    for (let i = 1; i < this.buf.length; i++) {
      const b = this.buf[i];
      if (b.tick < at) continue;
      const a = this.buf[i - 1];
      const span = b.tick - a.tick;
      // A gap this wide is a discontinuity, not a movement. Take the newer end
      // of it outright rather than sliding across it for the next minute.
      if (span > this.maxSpan) return b.state;
      const t = span === 0 ? 1 : (at - a.tick) / span;
      return lerpState(a.state, b.state, t, { snap: this.snapFields });
    }
    return this.buf[this.buf.length - 1].state;
  }

  // The same sample, expressed on OUR tick counter instead of the peer's.
  //
  // The two counters are unrelated: the pages booted at different times and
  // neither client is allowed to correct the other's clock any more than it is
  // allowed to correct its position. So the first call simply records the
  // offset between them — "when I was at local tick L the peer had reached P" —
  // and from then on our own counter carries playback forward smoothly between
  // packets, at the local frame rate, which is what makes 20Hz look like 60.
  //
  // The offset is re-taken only when the estimate has wandered clean out of the
  // window we actually hold: a peer that vanished for ten seconds, or one whose
  // frame rate has drifted far enough that we would otherwise be pinned to the
  // newest packet forever and never interpolate again.
  sampleLocal(localTick) {
    if (!this.buf.length) return null;
    const oldest = this.buf[0].tick;
    const newest = this.buf[this.buf.length - 1].tick;

    if (this._offset == null) this._offset = newest - localTick;
    let est = localTick + this._offset;
    const reanchor = () => {
      this._offset = newest - localTick;
      this._starvedAt = null;
      est = newest;
    };

    if (est - this.delay < oldest) {
      // We have fallen off the back of the buffer — the peer is running much
      // faster than we are, or we have only just started. Catch up.
      reanchor();
    } else if (est > newest + this.delay) {
      // Ahead of the stream: nothing has arrived for a while. Re-anchoring NOW
      // would drag playback backwards to a tick we have already shown, so
      // instead hold — sample() clamps to the newest thing we were told, which
      // is the honest picture of a peer that has gone quiet.
      if (this._starvedAt == null) this._starvedAt = newest;
      // ...but once the stream comes back, re-anchor on the spot. Without this
      // the estimate stays permanently ahead, playback pins to the newest
      // packet forever and the peer moves in 20Hz steps for the rest of the
      // match.
      if (newest !== this._starvedAt) reanchor();
    } else {
      this._starvedAt = null;
    }
    return this.sample(est);
  }
}

export default Interp;
