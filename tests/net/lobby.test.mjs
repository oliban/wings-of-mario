// Tier 2: GET /rooms against the real server. What a page's header shows is
// whatever this endpoint says, so the assertions worth having are about what it
// says while people arrive, leave and fill the seats.

import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, FakeClient } from './helpers.mjs';
import { joinHref, lobbyEntries } from '../../src/net/lobby.js';

const list = async (port) => {
  const res = await fetch(`http://127.0.0.1:${port}/rooms`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  return (await res.json()).rooms;
};

const byCode = (rooms, code) => rooms.find((r) => r.code === code);

test('the lobby lists what is joinable right now', { timeout: 30000 }, async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { port } = server;

  await t.test('an empty server lists nothing at all', async () => {
    assert.deepEqual(await list(port), []);
  });

  await t.test('a room minted after the page loaded turns up in the list', async () => {
    // This is the user's scenario end to end: the header was already drawn, on
    // a server with no rooms, when the pilot on the other laptop started one.
    const before = await list(port);
    assert.equal(before.length, 0);
    const minted = await (await fetch(`http://127.0.0.1:${port}/room`, { method: 'POST' })).json();
    const after = await list(port);
    assert.deepEqual(after.map((r) => r.code), [minted.room]);
    assert.deepEqual(after[0].seats, { mario: 'open', pilot: 'open' });
    assert.ok(after[0].ageMs >= 0 && after[0].ageMs < 5000);
  });

  await t.test('a room with a pilot in it wants a mario, and says so', async () => {
    const pilot = new FakeClient(port);
    t.after(() => pilot.close());
    await pilot.hello('ACDE', 'pilot');
    const room = byCode(await list(port), 'ACDE');
    assert.deepEqual(room.seats, { mario: 'open', pilot: 'here' });
    // The link a header would render for it.
    assert.equal(joinHref(room), '/?room=ACDE');
  });

  await t.test('and once both seats are taken it offers no link', async () => {
    const mario = new FakeClient(port);
    t.after(() => mario.close());
    await mario.hello('ACDE', 'mario');
    const room = byCode(await list(port), 'ACDE');
    assert.deepEqual(room.seats, { mario: 'here', pilot: 'here' });
    assert.equal(joinHref(room), null);
    // Listed, though: a player who was read the code out loud finds out it is
    // full rather than wondering whether the server is down.
    const [entry] = lobbyEntries([room]);
    assert.equal(entry.joinable, false);
    assert.match(entry.text, /^ACDE FULL/);
  });

  await t.test('a seat kept for a reconnecting player is not offered to a stranger', async () => {
    const mario = new FakeClient(port);
    await mario.hello('EFGH', 'mario');
    await mario.close();
    // The socket is gone but the seat is held (spec 7.4), and join() would
    // answer 'side taken' — so the lobby must not link anyone into it.
    await new Promise((r) => setTimeout(r, 50));
    const room = byCode(await list(port), 'EFGH');
    assert.equal(room.seats.mario, 'away');
    assert.equal(room.seats.pilot, 'open');
    assert.equal(joinHref(room), '/pilot.html?room=EFGH');
  });

  await t.test('the newest room comes first, because that is the one being asked about', async () => {
    const rooms = await list(port);
    const codes = rooms.map((r) => r.code);
    assert.ok(codes.indexOf('EFGH') < codes.indexOf('ACDE'), codes.join(' '));
  });

  await t.test('it hands out nothing but codes, seats and ages', async () => {
    for (const room of await list(port)) {
      assert.deepEqual(Object.keys(room).sort(), ['ageMs', 'code', 'seats']);
    }
  });

  await t.test('a listing is never cached, since a cached lobby is a lobby that lies', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/rooms`);
    assert.match(res.headers.get('cache-control') || '', /no-store/);
  });

  await t.test('nothing but GET reaches it, and it creates no rooms', async () => {
    const n = (await list(port)).length;
    const res = await fetch(`http://127.0.0.1:${port}/rooms`, { method: 'POST' });
    assert.equal(res.status, 404);
    assert.equal((await list(port)).length, n);
  });
});

// The single choke point named in the exposure note: a deployment that should
// not publish its rooms turns the endpoint off, and a page whose fetch 404s
// simply shows no list (tests/unit/lobby.test.js pins that half).
test('a server started with the lobby off has no such endpoint', { timeout: 30000 }, async (t) => {
  const server = await startTestServer({ lobby: false });
  t.after(() => server.close());
  await fetch(`http://127.0.0.1:${server.port}/room`, { method: 'POST' });
  const res = await fetch(`http://127.0.0.1:${server.port}/rooms`);
  assert.equal(res.status, 404);
});
