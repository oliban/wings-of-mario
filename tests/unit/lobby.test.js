import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bootFailure, openSeat, joinHref, lobbyEntries, shortAge, watchLobby,
} from '../../src/net/lobby.js';

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

// ---------------------------------------------------------------------------
// The lobby list. The one that matters is which seat a link offers: a link that
// lands the clicker on "SEAT TAKEN" reproduces the exact confusion the list
// exists to remove.
// ---------------------------------------------------------------------------

const summary = (code, seats, ageMs = 0) => ({ code, seats, ageMs });
const OPEN = { mario: 'open', pilot: 'open' };

test('a room holding a pilot offers the mario page', () => {
  const s = summary('FXJX', { mario: 'open', pilot: 'here' });
  assert.equal(openSeat(s), 'mario');
  assert.equal(joinHref(s), '/?room=FXJX');
});

test('a room holding a mario offers the pilot page', () => {
  const s = summary('FXJX', { mario: 'here', pilot: 'open' });
  assert.equal(openSeat(s), 'pilot');
  assert.equal(joinHref(s), '/pilot.html?room=FXJX');
});

test('an empty room offers mario, which is the side the server itself picks', () => {
  assert.equal(joinHref(summary('FXJX', OPEN)), '/?room=FXJX');
});

test('a full room offers nothing at all rather than a seat that is taken', () => {
  const s = summary('FXJX', { mario: 'here', pilot: 'here' });
  assert.equal(openSeat(s), null);
  assert.equal(joinHref(s), null);
});

// The bug this pins: a seat whose player closed the tab is still theirs to
// reconnect into (Room.leave keeps it), so join() answers 'side taken'. A list
// that read "present" instead of "taken" would link straight into that refusal.
test('a seat held for a reconnect is not on offer', () => {
  const s = summary('FXJX', { mario: 'away', pilot: 'here' });
  assert.equal(openSeat(s), null);
  assert.equal(joinHref(s), null);
  assert.equal(lobbyEntries([s])[0].joinable, false);
});

test('entries name the seat the room is waiting for', () => {
  const rows = lobbyEntries([
    summary('AAAA', { mario: 'open', pilot: 'here' }, 0),
    summary('KKKK', { mario: 'here', pilot: 'open' }, 120000),
    summary('CCCC', { mario: 'here', pilot: 'here' }, 0),
    summary('DDDD', OPEN, 0),
    summary('EEEE', { mario: 'away', pilot: 'away' }, 0),
  ], { limit: 9 });
  assert.deepEqual(rows.map((r) => r.text), [
    'AAAA NEEDS MARIO NEW',
    'KKKK NEEDS PILOT 2M',
    'CCCC FULL NEW',
    'DDDD OPEN NEW',
    'EEEE HELD NEW',
  ]);
  assert.deepEqual(rows.map((r) => r.joinable), [true, true, false, true, false]);
});

// A full room is LISTED and not linked: hiding it would leave a player who was
// read the code out loud wondering whether the server was down.
test('a full room is listed but has no link', () => {
  const [row] = lobbyEntries([summary('FXJX', { mario: 'here', pilot: 'here' })]);
  assert.equal(row.href, null);
  assert.equal(row.joinable, false);
  assert.match(row.text, /FULL/);
});

test('the page does not offer you the room you are already in', () => {
  const rooms = [summary('AAAA', OPEN), summary('KKKK', OPEN)];
  assert.deepEqual(lobbyEntries(rooms, { here: 'aaaa' }).map((r) => r.code), ['KKKK']);
});

test('the list is capped and survives junk from the wire', () => {
  const rooms = [summary('AAAA', OPEN), summary('KKKK', OPEN), summary('CCCC', OPEN)];
  assert.equal(lobbyEntries(rooms, { limit: 2 }).length, 2);
  assert.deepEqual(lobbyEntries(null), []);
  assert.deepEqual(lobbyEntries([null, {}, summary('!!', OPEN)]), []);
});

test('an age is readable at a glance, and a missing one is simply absent', () => {
  assert.equal(shortAge(0), 'NEW');
  assert.equal(shortAge(59999), 'NEW');
  assert.equal(shortAge(60000), '1M');
  assert.equal(shortAge(59 * 60000), '59M');
  assert.equal(shortAge(60 * 60000), '1H');
  assert.equal(shortAge(undefined), '');
  assert.equal(shortAge(null), '');
  assert.equal(lobbyEntries([summary('FXJX', OPEN, null)])[0].text, 'FXJX OPEN');
});

// --- the watcher ------------------------------------------------------------

// A fake clock, so a five-second poll is tested in microseconds.
function fakeTimers() {
  let next = 1;
  const due = new Map();
  return {
    set: (fn) => { const id = next++; due.set(id, fn); return id; },
    clear: (id) => due.delete(id),
    pending: () => due.size,
    async fire() {
      const fns = [...due.values()];
      due.clear();
      for (const fn of fns) await fn();
    },
  };
}

const jsonRes = (rooms) => ({ ok: true, status: 200, json: async () => ({ rooms }) });

test('a room created after the page loaded turns up in the list', async () => {
  const timers = fakeTimers();
  let live = [];
  const seen = [];
  const watch = watchLobby({
    origin: '',
    fetchImpl: async () => jsonRes(live),
    setTimeoutImpl: timers.set,
    clearTimeoutImpl: timers.clear,
    onEntries: (e) => seen.push(e.map((r) => r.code)),
  });
  await watch.first;
  assert.deepEqual(seen, [[]]);
  // The pilot starts one on the other laptop.
  live = [summary('FXJX', { mario: 'open', pilot: 'here' })];
  await timers.fire();
  assert.deepEqual(seen[1], ['FXJX']);
  watch.stop();
  assert.equal(timers.pending(), 0);
});

// The offline path. A page served by a plain static server has no /rooms, and
// falling back to one player is correct there — so it must ask exactly once.
test('a 404 stops the polling instead of hammering a server that has no lobby', async () => {
  const timers = fakeTimers();
  let calls = 0;
  const seen = [];
  const watch = watchLobby({
    origin: '',
    fetchImpl: async () => { calls++; return { ok: false, status: 404 }; },
    setTimeoutImpl: timers.set,
    clearTimeoutImpl: timers.clear,
    onEntries: (e) => seen.push(e),
  });
  await watch.first;
  assert.equal(calls, 1);
  assert.equal(timers.pending(), 0, 'nothing scheduled after the endpoint said it is not there');
  assert.deepEqual(seen, [], 'and nothing was rendered');
});

test('a thrown fetch is retried a few times and then given up on, quietly', async () => {
  const timers = fakeTimers();
  let calls = 0;
  const watch = watchLobby({
    origin: '',
    fetchImpl: async () => { calls++; throw new Error('ECONNREFUSED'); },
    setTimeoutImpl: timers.set,
    clearTimeoutImpl: timers.clear,
  });
  await watch.first;
  assert.equal(calls, 1);
  await timers.fire();
  await timers.fire();
  assert.equal(calls, 3);
  assert.equal(timers.pending(), 0);
});

test('a hidden tab keeps its timer but does not ask', async () => {
  const timers = fakeTimers();
  let calls = 0;
  let showing = false;
  const watch = watchLobby({
    origin: '',
    visible: () => showing,
    fetchImpl: async () => { calls++; return jsonRes([]); },
    setTimeoutImpl: timers.set,
    clearTimeoutImpl: timers.clear,
  });
  await watch.first;
  assert.equal(calls, 0);
  assert.equal(timers.pending(), 1);
  showing = true;
  await timers.fire();
  assert.equal(calls, 1);
  watch.stop();
});

// The code is minted DURING boot, after the watcher has started.
test('our own room drops out of the list as soon as we have one', async () => {
  const timers = fakeTimers();
  let mine = null;
  const seen = [];
  const watch = watchLobby({
    origin: '',
    here: () => mine,
    fetchImpl: async () => jsonRes([summary('FXJX', OPEN)]),
    setTimeoutImpl: timers.set,
    clearTimeoutImpl: timers.clear,
    onEntries: (e) => seen.push(e.map((r) => r.code)),
  });
  await watch.first;
  assert.deepEqual(seen[0], ['FXJX']);
  mine = 'FXJX';
  await timers.fire();
  assert.deepEqual(seen[1], []);
  watch.stop();
});
