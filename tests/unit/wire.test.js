import test from 'node:test';
import assert from 'node:assert/strict';

import { WIRE, wireSag, wireIndexAt } from '../../src/wings/art/carrier.js';
import { DECK_X0 } from '../../src/wings/geo.js';

// THE ARRESTOR WIRE, reacting.
//
// The three cables were painted flat and never moved, whatever happened on
// them, so a trap looked exactly like an aeroplane deciding to stop. The one
// the hook takes now bends, and rings out like the steel it is.
//
// The shape is a decaying cosine rather than a fade, and that is the whole
// point: it springs back THROUGH the flat and overshoots the other way, each
// swing smaller. The recoil is the part that reads as elastic.

test('the catch is at full depth and pulls DOWN', () => {
  assert.equal(wireSag(0), WIRE.DEPTH);
  assert.ok(wireSag(1) > 0, 'the wire is not loaded a tick after the catch');
});

test('it springs back through the flat and overshoots', () => {
  // A wire that only sagged and faded would read as a rope being lowered. The
  // sign change is the recoil, and there has to be more than one.
  const sags = [];
  for (let t = 0; t < WIRE.TICKS; t++) sags.push(wireSag(t));
  let crossings = 0;
  for (let i = 1; i < sags.length; i++) {
    if ((sags[i - 1] < 0) !== (sags[i] < 0)) crossings++;
  }
  assert.ok(crossings >= 2, `the wire crossed the flat ${crossings} times: that is not a spring`);
  assert.ok(Math.min(...sags) < 0, 'the wire never overshot above the deck');
});

test('every swing is smaller than the one before', () => {
  // Damped, not oscillating for ever. Taking the peak of each half-swing and
  // requiring it to shrink is the honest way to say that.
  const peaks = [];
  let run = 0;
  let sign = Math.sign(wireSag(0));
  for (let t = 0; t < WIRE.TICKS; t++) {
    const v = wireSag(t);
    if (Math.sign(v) !== sign && v !== 0) {
      peaks.push(run);
      run = 0;
      sign = Math.sign(v);
    }
    run = Math.max(run, Math.abs(v));
  }
  peaks.push(run);
  for (let i = 1; i < peaks.length; i++) {
    assert.ok(peaks[i] <= peaks[i - 1] + 1e-9,
      `swing ${i} (${peaks[i].toFixed(2)}) is bigger than swing ${i - 1} (${peaks[i - 1].toFixed(2)})`);
  }
});

test('it comes to rest, and stays there', () => {
  assert.equal(wireSag(WIRE.TICKS), 0);
  assert.equal(wireSag(WIRE.TICKS + 500), 0);
  // And it is nearly still well before the end, so the deck is not visibly
  // twitching while the player is being rearmed.
  assert.ok(Math.abs(wireSag(WIRE.TICKS - 4)) < 1);
});

test('nothing before the catch, and nonsense is flat', () => {
  assert.equal(wireSag(-1), 0);
  assert.equal(wireSag(NaN), 0);
  assert.equal(wireSag(undefined), 0);
});

test('the hook takes the cable it stopped nearest', () => {
  // Three wires, 26px apart, the first 62px up the deck. Landing on top of one
  // must pick that one and not its neighbour.
  for (let i = 0; i < WIRE.COUNT; i++) {
    const x = DECK_X0 + WIRE.FIRST + i * WIRE.SPACING;
    assert.equal(wireIndexAt(DECK_X0, x), i, `stopping on wire ${i} picked another`);
    assert.equal(wireIndexAt(DECK_X0, x + 6), i, 'a few pixels past still picks it');
    assert.equal(wireIndexAt(DECK_X0, x - 6), i, 'a few pixels short still picks it');
  }
});

test('stopping beyond the wires clamps to the end one', () => {
  // Short of the first or past the last: there is no fourth cable to bend, and
  // drawing none at all would be a trap with no wire in it.
  assert.equal(wireIndexAt(DECK_X0, DECK_X0), 0);
  assert.equal(wireIndexAt(DECK_X0, DECK_X0 - 400), 0);
  assert.equal(wireIndexAt(DECK_X0, DECK_X0 + 4000), WIRE.COUNT - 1);
  assert.equal(wireIndexAt(DECK_X0, undefined), -1, 'no position must select no wire');
});

test('the ring-down is a fixed number of ticks, not a wall-clock time', () => {
  // Counted on the simulation clock like the sail fade and the supply drop, so
  // a screenshot at tick N is the same picture however many frames the browser
  // managed to draw getting there.
  assert.equal(typeof WIRE.TICKS, 'number');
  assert.ok(WIRE.TICKS > 20 && WIRE.TICKS < 120, `${WIRE.TICKS} ticks is not a ring-down`);
});
