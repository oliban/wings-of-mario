import test from 'node:test';
import assert from 'node:assert/strict';
import { Interp, lerp, lerpState } from '../../src/net/interp.js';
import { INTERP_DELAY_TICKS } from '../../src/net/protocol.js';

test('lerp is the boring one', () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(0, 10, 0.25), 2.5);
  assert.equal(lerp(-10, 10, 0.5), 0);
});

test('lerpState interpolates numbers and snaps everything else', () => {
  const a = { x: 0, y: 0, facing: 1, anim: 'idle', island: '1-1' };
  const b = { x: 10, y: 20, facing: -1, anim: 'run', island: '1-2' };
  const mid = lerpState(a, b, 0.5);
  assert.equal(mid.x, 5);
  assert.equal(mid.y, 10);
  // A half-run animation or a half-island is nonsense; discrete fields take
  // the newer value outright.
  assert.equal(mid.anim, 'run');
  assert.equal(mid.island, '1-2');
  assert.equal(mid.facing, -1);
});

test('lerpState never interpolates a field named in `snap`', () => {
  const mid = lerpState({ x: 0, hp: 3 }, { x: 10, hp: 1 }, 0.5, { snap: ['hp'] });
  assert.equal(mid.x, 5);
  assert.equal(mid.hp, 1);
});

test('an empty buffer samples to nothing rather than to the origin', () => {
  // Returning {x:0,y:0} would draw the peer at the top-left corner of the
  // world for the first fifth of a second of every match.
  const i = new Interp();
  assert.equal(i.sample(100), null);
  assert.equal(i.latest(), null);
  assert.equal(i.size, 0);
});

test('samples are taken one interpolation delay behind the newest', () => {
  const i = new Interp();
  i.push(0, { x: 0 });
  i.push(3, { x: 30 });
  i.push(6, { x: 60 });
  // Local tick 6 renders what the peer looked like at tick 6 - 6 = 0.
  assert.equal(i.sample(6).x, 0);
  assert.equal(i.sample(9).x, 30);
  // Halfway between the tick-0 and tick-3 samples.
  assert.equal(i.sample(7.5).x, 15);
});

test('the delay is the constant, not a magic number', () => {
  const i = new Interp();
  i.push(0, { x: 0 });
  i.push(60, { x: 600 });
  assert.equal(i.sample(INTERP_DELAY_TICKS).x, 0);
});

test('sampling before the oldest sample holds the oldest', () => {
  const i = new Interp();
  i.push(100, { x: 5 });
  assert.equal(i.sample(0).x, 5, 'must not extrapolate backwards into nothing');
});

test('sampling past the newest holds the newest rather than flying off', () => {
  // Extrapolation looks like a teleport-and-snap-back when the next packet
  // lands. Holding still is honest: the peer has genuinely told us nothing.
  const i = new Interp();
  i.push(0, { x: 0 });
  i.push(3, { x: 30 });
  assert.equal(i.sample(1000).x, 30);
});

test('an out-of-order snapshot is inserted, not appended', () => {
  const i = new Interp();
  i.push(0, { x: 0 });
  i.push(6, { x: 60 });
  i.push(3, { x: 30 });
  assert.equal(i.sample(9).x, 30, 'the late packet must take its proper place in time');
});

test('a duplicated tick replaces rather than doubling', () => {
  const i = new Interp();
  i.push(3, { x: 30 });
  i.push(3, { x: 33 });
  assert.equal(i.size, 1);
  assert.equal(i.latest().x, 33);
});

test('the buffer is bounded', () => {
  const i = new Interp({ capacity: 8 });
  for (let t = 0; t < 200; t++) i.push(t, { x: t });
  assert.ok(i.size <= 8, `buffer grew to ${i.size}`);
  assert.equal(i.latest().x, 199, 'the newest must always survive');
});

test('a peer that reconnects with a reset tick counter does not freeze', () => {
  // The peer reloaded: its tick went backwards by thousands. Without a reset
  // the buffer would hold samples from the future forever and the avatar would
  // never move again.
  const i = new Interp();
  for (let t = 0; t < 60; t += 3) i.push(1000 + t, { x: t });
  i.push(0, { x: 999 });
  assert.equal(i.size, 1, 'a backwards jump clears the buffer');
  assert.equal(i.latest().x, 999);
});

test('a gap too wide to be motion is snapped, not slid across', () => {
  // The peer changed level, respawned, or was flown somewhere by a script that
  // does not transmit. Lerping across it would walk the avatar over three
  // thousand pixels at a twentieth speed, for twenty seconds, having invented
  // every frame of the journey.
  const i = new Interp();
  i.push(0, { x: 112 });
  i.push(1200, { x: 3171 });
  assert.equal(i.sample(600).x, 3171, 'must take the newer end of the discontinuity');
  // A gap inside the limit is ordinary motion and is still interpolated.
  const j = new Interp({ maxSpan: 60 });
  j.push(0, { x: 0 });
  j.push(30, { x: 300 });
  assert.equal(j.sample(21).x, 150);
});

// --------------------------------------------------------------------------
// sampleLocal: the bridge between two clocks that were never synchronised.
// `sample()` above is expressed on the PEER's tick counter. Nothing on this
// client owns that counter — the two pages booted minutes apart — so the sides
// call sampleLocal() with their own, and this is what relates the two.
// --------------------------------------------------------------------------

test('sampleLocal works off a local counter unrelated to the peer\'s', () => {
  const i = new Interp();
  // The peer has been up for a while; we have just started counting.
  i.push(9000, { x: 0 });
  i.push(9003, { x: 30 });
  i.push(9006, { x: 60 });
  // Anchored on the first call: local tick 4 means "the peer is at 9006 now",
  // so we render the peer as it was one delay ago, at 9000.
  assert.equal(i.sampleLocal(4).x, 0);
  // Three local ticks later, with no new packet, playback has advanced three
  // ticks along the peer's timeline rather than sitting still.
  assert.equal(i.sampleLocal(7).x, 30);
  assert.equal(i.sampleLocal(5.5).x, 15);
});

test('sampleLocal keeps gliding as new snapshots arrive', () => {
  const i = new Interp();
  let peer = 5000;
  i.push(peer, { x: 0 });
  i.push((peer += 3), { x: 30 });
  i.push((peer += 3), { x: 60 });
  assert.equal(i.sampleLocal(100).x, 0);
  // A steady 20Hz stream against a steady 60Hz local clock: playback keeps a
  // constant distance behind the newest packet instead of pinning to it.
  i.push((peer += 3), { x: 90 });
  assert.equal(i.sampleLocal(103).x, 30);
  i.push((peer += 3), { x: 120 });
  assert.equal(i.sampleLocal(106).x, 60);
});

test('sampleLocal re-anchors rather than freezing when the stream dies and returns', () => {
  const i = new Interp();
  i.push(1000, { x: 0 });
  i.push(1003, { x: 30 });
  assert.equal(i.sampleLocal(50).x, 0);
  // Nothing arrives for ten seconds of local time. Playback holds at the
  // newest thing we were told rather than extrapolating into the void.
  assert.equal(i.sampleLocal(650).x, 30);
  // The peer comes back, still counting from where it was. Without a
  // re-anchor the local estimate is 600 ticks ahead and the avatar would be
  // pinned to `newest` forever, never interpolating again.
  i.push(1006, { x: 60 });
  i.push(1009, { x: 90 });
  // One delay behind the newest packet (1009 - 6 = 1003), not pinned to it.
  assert.equal(i.sampleLocal(653).x, 30, 'must resume one delay behind the newest');
  // And gliding again from there, three local ticks at a time.
  assert.equal(i.sampleLocal(656).x, 60);
});

test('clear() forgets the clock relationship as well as the samples', () => {
  const i = new Interp();
  i.push(1000, { x: 0 });
  i.push(1003, { x: 30 });
  assert.equal(i.sampleLocal(10).x, 0);
  i.clear();
  assert.equal(i.sampleLocal(11), null);
  // A different peer, counting from somewhere else entirely.
  i.push(7, { x: 700 });
  i.push(10, { x: 730 });
  assert.equal(i.sampleLocal(12).x, 700);
});
