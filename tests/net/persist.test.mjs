// Rooms that survive a restart. The scenario, in the user's words: a code from
// five minutes ago should still work. Everything below is that sentence, plus
// the two ways it must not go wrong — a room nobody wants coming back, and a
// broken file taking the server with it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startServer } from '../../server/index.js';
import { Rooms, ROOM_IDLE_MS } from '../../src/net/room.js';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';
import {
  loadState, serializeState, createSaver, roomToJSON, roomFromJSON, STATE_VERSION,
} from '../../server/persist.js';
import { FakeClient } from './helpers.mjs';

const quiet = { info() {}, warn() {}, error() {} };
const tmp = (name) => join(mkdtempSync(join(tmpdir(), 'wom-persist-')), name);

const boot = async (statePath, opts = {}) =>
  startServer({ port: 0, statePath, log: opts.log || quiet, ...opts });

// ---------------------------------------------------------------------------
// The round trip, in memory.

test('a room survives being written and read back', () => {
  const rooms = new Rooms();
  const room = rooms.create({ now: 1000 });
  room.join({ side: 'pilot' }, 1000);
  room.recordDetonate('pilot', 'i-2', ['3,4', '3,5'], 1200);
  const token = room.sides.get('pilot').token;

  const back = roomFromJSON(roomToJSON(room));
  assert.equal(back.code, room.code);
  assert.equal(back.seed, room.seed, 'the same archipelago, or it is a different match');
  assert.deepEqual(back.damage.keys('i-2'), ['3,4', '3,5']);

  // The seat is held, not occupied: nothing has a socket to a process that has
  // only just started.
  assert.equal(back.present('pilot'), false);
  assert.equal(back.sides.get('pilot').token, token);
  // And that token still opens that seat.
  const re = back.join({ token }, 2000);
  assert.deepEqual(
    { ok: re.ok, side: re.side, reconnected: re.reconnected },
    { ok: true, side: 'pilot', reconnected: true }
  );
});

test('a seat restored from a file cannot be taken by a stranger', () => {
  const rooms = new Rooms();
  const room = rooms.create({ now: 1000 });
  room.join({ side: 'mario' }, 1000);
  const back = roomFromJSON(roomToJSON(room));
  assert.deepEqual(back.join({ side: 'mario' }, 2000), { ok: false, reason: 'side taken' });
  assert.deepEqual(back.summary(2000).seats, { mario: 'away', pilot: 'open' });
});

// ---------------------------------------------------------------------------
// A hand-edited or truncated file must never stop the server booting.

test('a corrupt state file costs rooms, never the boot', async (t) => {
  const cases = [
    ['truncated mid-write', '{"v":1,"rooms":[{"code":"ACD'],
    ['not JSON at all', 'this is not json'],
    ['empty', ''],
    ['JSON, but not ours', '"a string"'],
    ['null', 'null'],
    ['an array', '[1,2,3]'],
    ['a version from the future', JSON.stringify({ v: STATE_VERSION + 99, rooms: [] })],
    ['rooms is not a list', JSON.stringify({ v: STATE_VERSION, rooms: 'ACDE' })],
  ];
  for (const [what, text] of cases) {
    const path = tmp('rooms.json');
    writeFileSync(path, text);
    const rooms = loadState(path, { now: 1000, log: quiet });
    assert.equal(rooms.size, 0, `${what}: no rooms`);
    assert.equal(rooms.list(1000).length, 0, `${what}: and nothing to list`);
    // And the whole server comes up on it.
    const server = await boot(path);
    t.after(() => server.close());
    assert.equal((await (await fetch(`http://127.0.0.1:${server.port}/healthz`)).text()), 'ok', what);
  }
});

test('one unreadable room does not take the readable ones with it', () => {
  const path = tmp('rooms.json');
  writeFileSync(path, JSON.stringify({
    v: STATE_VERSION,
    rooms: [
      { code: 'ACDE', seed: 7, createdAt: 900, lastActivity: 900, seats: [], damage: {} },
      null,
      'not a room',
      { code: 'lowercase-is-not-a-code', seed: 7, lastActivity: 900 },
      { code: 'EFGH', seed: 'not a number', lastActivity: 900 },
      { code: 'KMNP', seed: 9, createdAt: 900, lastActivity: 900, seats: 'nope', damage: 'nope' },
    ],
  }));
  const rooms = loadState(path, { now: 1000, log: quiet });
  assert.deepEqual(rooms.list(1000).map((r) => r.code).sort(), ['ACDE', 'KMNP']);
  // The room whose seats and damage were nonsense still came back, with none.
  assert.deepEqual(rooms.get('KMNP').summary(1000).seats, { mario: 'open', pilot: 'open' });
});

test('a hand-edited file cannot smuggle a key a detonate could not make', () => {
  const path = tmp('rooms.json');
  writeFileSync(path, JSON.stringify({
    v: STATE_VERSION,
    rooms: [{
      code: 'ACDE', seed: 7, createdAt: 900, lastActivity: 900, seats: [],
      damage: { 'i-1': ['1,2', 42, null, { x: 1 }, '3,4'] },
    }],
  }));
  const rooms = loadState(path, { now: 1000, log: quiet });
  assert.deepEqual(rooms.get('ACDE').damage.keys('i-1'), ['1,2', '3,4']);
});

// ---------------------------------------------------------------------------
// Expiry.

test('a room nobody has touched in hours does not come back', () => {
  const now = 10_000_000;
  const path = tmp('rooms.json');
  writeFileSync(path, JSON.stringify({
    v: STATE_VERSION,
    rooms: [
      { code: 'ACDE', seed: 1, createdAt: 0, lastActivity: now - 60_000, seats: [], damage: {} },
      { code: 'EFGH', seed: 2, createdAt: 0, lastActivity: now - ROOM_IDLE_MS - 1, seats: [], damage: {} },
    ],
  }));
  const rooms = loadState(path, { now, log: quiet });
  assert.deepEqual(rooms.list(now).map((r) => r.code), ['ACDE'],
    'a minute old is joinable; past the reaper\'s window is clutter');
});

test('an expired room is not written out either', () => {
  const now = 10_000_000;
  const rooms = new Rooms();
  const live = rooms.create({ now: now - 1000 });
  const stale = rooms.create({ now: now - ROOM_IDLE_MS - 1 });
  const written = JSON.parse(serializeState(rooms, now));
  assert.deepEqual(written.rooms.map((r) => r.code), [live.code]);
  assert.ok(stale.code !== live.code);
});

// ---------------------------------------------------------------------------
// The saver.

test('the saver writes only when something changed, and atomically', () => {
  const path = tmp('rooms.json');
  const rooms = new Rooms();
  let clock = 1000;
  const saver = createSaver({ path, rooms, log: quiet, now: () => clock });

  assert.equal(saver.flush(), true, 'the first write is a change');
  assert.equal(saver.flush(), false, 'nothing changed, nothing written');
  rooms.create({ now: clock });
  assert.equal(saver.flush(), true);
  assert.equal(saver.flush(), false);
  // The temp file is never left lying around.
  assert.equal(existsSync(`${path}.tmp`), false);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).v, STATE_VERSION);
  saver.stop();
});

test('a directory that cannot be written to is a warning, not a crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wom-persist-'));
  // A path whose parent is a FILE: mkdir and write both fail.
  const blocked = join(dir, 'a-file', 'rooms.json');
  writeFileSync(join(dir, 'a-file'), 'in the way');
  const warned = [];
  const saver = createSaver({
    path: blocked, rooms: new Rooms(), log: { ...quiet, warn: (m) => warned.push(m) },
  });
  assert.equal(saver.flush(), false);
  assert.equal(warned.length, 1);
  assert.match(warned[0], /could not save/);
  saver.stop();
});

// ---------------------------------------------------------------------------
// End to end: the actual complaint. Restart the server, use the old code.

test('a code minted before a restart still joins the same match', { timeout: 30000 }, async (t) => {
  const path = tmp('rooms.json');

  const first = await boot(path);
  const origin = `http://127.0.0.1:${first.port}`;
  const { room: code } = await (await fetch(`${origin}/room`, { method: 'POST' })).json();

  // Two players, a bombing run, and the seed they are both flying in.
  const pilot = new FakeClient(first.port);
  const welcome = await pilot.hello(code, 'pilot');
  assert.equal(welcome.t, MSG.WELCOME);
  const seed = welcome.seed;
  const token = welcome.token;
  pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: 'i-3', keys: ['9,9', '9,10'] } });
  await pilot.ofType(MSG.DAMAGE);
  await pilot.close();
  await first.close();

  // The process dies. The file is what is left.
  assert.ok(existsSync(path), 'and there had better be a file');

  const second = await boot(path);
  t.after(() => second.close());
  assert.notEqual(second.port, first.port, 'a genuinely new server');

  // The code from a moment ago is still listed, and still says what it needs.
  const listed = (await (await fetch(`http://127.0.0.1:${second.port}/rooms`)).json()).rooms;
  assert.deepEqual(listed.map((r) => r.code), [code]);
  assert.deepEqual(listed[0].seats, { mario: 'open', pilot: 'away' },
    'the pilot seat is held for the pilot, not handed to the next arrival');

  // Mario joins it fresh and is put in the SAME archipelago with the SAME
  // craters. Without the seed he would be flying over different islands under
  // the same code, and nothing would have reported a fault.
  const mario = new FakeClient(second.port);
  const marioWelcome = await mario.hello(code, 'mario');
  assert.equal(marioWelcome.t, MSG.WELCOME);
  assert.equal(marioWelcome.seed, seed);
  assert.deepEqual(Object.keys(marioWelcome.damage), ['i-3']);
  assert.deepEqual([...marioWelcome.damage['i-3']].sort(), ['9,10', '9,9']);

  // And the pilot's own token reconnects into his own seat, across the restart.
  const back = new FakeClient(second.port);
  const backWelcome = await back.hello(code, null, token);
  assert.equal(backWelcome.side, 'pilot');
  assert.equal(backWelcome.reconnected, true);

  await mario.close();
  await back.close();
});

test('a server given its own Rooms writes no file at all', { timeout: 30000 }, async (t) => {
  // Which is every test in this repo: a suite must not litter the working tree
  // or inherit rooms from the run before it.
  const server = await startServer({ port: 0, rooms: new Rooms(), log: quiet });
  t.after(() => server.close());
  assert.equal(server.statePath, null);
  assert.equal(server.save(), false, 'there is nothing to flush to');
});

test('statePath: null turns persistence off outright', { timeout: 30000 }, async (t) => {
  const server = await startServer({ port: 0, statePath: null, log: quiet });
  t.after(() => server.close());
  assert.equal(server.statePath, null);
  await (await fetch(`http://127.0.0.1:${server.port}/room`, { method: 'POST' })).json();
  assert.equal(server.save(), false);
});

test('the lobby list after a restart is the list of rooms worth joining', {
  timeout: 30000,
}, async (t) => {
  const path = tmp('rooms.json');
  const now = Date.now();
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify({
    v: STATE_VERSION,
    rooms: [
      { code: 'ACDE', seed: 1, createdAt: now - 2000, lastActivity: now - 2000, seats: [], damage: {} },
      { code: 'EFGH', seed: 2, createdAt: now - 1000, lastActivity: now - ROOM_IDLE_MS - 1, seats: [], damage: {} },
    ],
  }));
  const server = await boot(path);
  t.after(() => server.close());
  const rooms = (await (await fetch(`http://127.0.0.1:${server.port}/rooms`)).json()).rooms;
  assert.deepEqual(rooms.map((r) => r.code), ['ACDE'], 'no dead codes in the front door');
  assert.ok(rooms[0].ageMs >= 2000);
});

test('joining a persisted code does not silently re-create it', { timeout: 30000 }, async (t) => {
  // The failure this whole file exists to remove. Before it, a restart left
  // getOrCreate to make a fresh EMPTY room under the old code, in a different
  // archipelago, and report nothing.
  const path = tmp('rooms.json');
  const one = await boot(path);
  const code = (await (await fetch(`http://127.0.0.1:${one.port}/room`, { method: 'POST' })).json()).room;
  const a = new FakeClient(one.port);
  const seed = (await a.hello(code, 'mario')).seed;
  await a.close();
  await one.close();

  const two = await boot(path);
  t.after(() => two.close());
  const b = new FakeClient(two.port);
  const w = await b.hello(code, 'pilot');
  assert.equal(w.t, MSG.WELCOME);
  assert.equal(w.v, PROTOCOL_VERSION);
  assert.equal(w.seed, seed, 'the same world, which is the whole promise of a code');
  await b.close();
});
