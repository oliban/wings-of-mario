import test from 'node:test';
import assert from 'node:assert/strict';
import { bootFailure } from '../../src/net/lobby.js';

// The banner used to say OFFLINE for every boot failure, including the one
// with an obvious fix. These pin the mapping from what the wire actually said
// to what the player is told — and, just as importantly, pin the cases that
// must STAY the quiet offline fallback.

test('a taken pilot seat names the seat and where the other player goes', () => {
  const f = bootFailure(new Error('side taken'), { room: 'YJR4', side: 'pilot' });
  assert.equal(f.diagnosed, true);
  assert.equal(f.text, 'ROOM YJR4 — PILOT SEAT TAKEN — MARIO JOINS AT /?room=YJR4');
});

test('a taken mario seat points at the pilot page', () => {
  const f = bootFailure(new Error('side taken'), { room: 'YJR4', side: 'mario' });
  assert.equal(f.diagnosed, true);
  assert.equal(f.text, 'ROOM YJR4 — MARIO SEAT TAKEN — PILOT JOINS AT /pilot.html?room=YJR4');
});

test('a taken seat with no code still says what happened', () => {
  const f = bootFailure(new Error('side taken'), { side: 'pilot' });
  assert.equal(f.diagnosed, true);
  assert.equal(f.text, 'PILOT SEAT TAKEN — MARIO JOINS ON THE OTHER PAGE');
});

test('a full room says both seats are taken', () => {
  const f = bootFailure(new Error('room full'), { room: 'YJR4', side: 'pilot' });
  assert.equal(f.diagnosed, true);
  assert.equal(f.text, 'ROOM YJR4 — FULL — BOTH SEATS ARE TAKEN');
});

test('a code the server will not accept sends the player after a fresh one', () => {
  const f = bootFailure(new Error('bad room code'), { room: 'YJR4', side: 'pilot' });
  assert.equal(f.diagnosed, true);
  assert.equal(f.text, 'ROOM YJR4 — NO SUCH ROOM — START A FRESH ROOM');
});

// The forgiving path. A page served by a plain static server has no /room and
// no /ws, and falling back to one player is correct there — so it must not
// grow a diagnosis, and must not claim a cause the wire never gave.
test('a missing room endpoint is still plain OFFLINE', () => {
  const f = bootFailure(new Error('lobby: could not mint a room (404)'), { side: 'pilot' });
  assert.equal(f.diagnosed, false);
  assert.equal(f.text, 'OFFLINE');
});

test('a socket that never opened is still plain OFFLINE', () => {
  const f = bootFailure(new Error('transport: connect failed (ws://localhost:8199/ws)'), {
    room: 'YJR4', side: 'pilot',
  });
  assert.equal(f.diagnosed, false);
  assert.equal(f.text, 'OFFLINE');
});

test('a thrown non-error, or nothing at all, is OFFLINE rather than a crash', () => {
  assert.equal(bootFailure('boom', { side: 'pilot' }).text, 'OFFLINE');
  assert.equal(bootFailure(null, {}).text, 'OFFLINE');
  assert.equal(bootFailure(new Error('side taken')).text, 'OFFLINE');
});
