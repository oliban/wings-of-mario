import test from 'node:test';
import assert from 'node:assert/strict';

import { peerLive, PEER_SILENCE_TICKS } from '../../src/net/presence.js';

const live = (peerPresent, tick, lastHeard) => peerLive({ peerPresent, tick, lastHeard });

test('nobody in the other seat is nobody there', () => {
  assert.equal(live(false, 0, null), false);
  assert.equal(peerLive({}), false);
  assert.equal(peerLive(), false);
  // Even if we heard from him a tick ago: the server has since said he left,
  // and the server is the authority on who is in the room.
  assert.equal(live(false, 10, 9), false);
});

test('present but not yet heard from is believed', () => {
  // He is joining: the seat is taken and the first snapshot has not landed.
  // Refusing here would make the world jump fail for a fraction of a second
  // after every join, which is a worse tool than one that works.
  assert.equal(live(true, 0, null), true);
  assert.equal(live(true, 9999, null), true);
});

test('a Mario heard from recently is live', () => {
  assert.equal(live(true, 100, 100), true);
  assert.equal(live(true, 100 + PEER_SILENCE_TICKS - 1, 100), true);
});

test('a Mario who has said nothing for five seconds is not', () => {
  // THE BUG THIS EXISTS FOR: his laptop slept, so no FIN was ever sent and the
  // server's socket stayed open. peerPresent is still true and stays true until
  // the heartbeat notices, and until then the pilot was locked out of the debug
  // world jump — refusing to leave behind a Mario who was not there.
  assert.equal(live(true, 100 + PEER_SILENCE_TICKS, 100), false);
  assert.equal(live(true, 100000, 100), false);
});

test('the window is generous enough to survive a level load', () => {
  // A sail freezes Mario's level for three seconds at the centre of the fade,
  // and a level load stops the flow for a beat. Calling a live Mario dead in
  // the middle of either would be worse than the bug being fixed.
  const seconds = PEER_SILENCE_TICKS / 60.0988;
  assert.ok(seconds > 4, `${seconds.toFixed(1)}s is too tight for a level load`);
});
