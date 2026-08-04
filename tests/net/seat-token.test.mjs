// The seat token across a reload: where it is kept, what keeps two tabs apart,
// and what happens when it is no longer worth anything.
//
// Reloading as Mario used to be answered with SEAT TAKEN — by the player's own
// previous connection — because the token that proves "I already hold this
// seat" lived in the Session object and died with the document. The browser
// test tests the reload; everything here is the logic underneath it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG } from '../../src/net/protocol.js';
import { rememberSeat, recallSeat, forgetSeat } from '../../src/net/lobby.js';
import { startTestServer, FakeClient, pair } from './helpers.mjs';

// One tab's sessionStorage. A Map, because that is all sessionStorage is.
function fakeTab() {
  const items = new Map();
  return {
    sessionStorage: {
      getItem: (k) => (items.has(k) ? items.get(k) : null),
      setItem: (k, v) => items.set(k, String(v)),
      removeItem: (k) => items.delete(k),
    },
    keys: () => [...items.keys()],
  };
}

test('a seat token survives inside its tab and goes no further', async (t) => {
  await t.test('what was stored is what comes back', () => {
    const tab = fakeTab();
    assert.equal(rememberSeat(tab, 'ACDE', 'mario', 'ACDE.mario.1.xyz'), true);
    assert.equal(recallSeat(tab, 'ACDE', 'mario'), 'ACDE.mario.1.xyz');
  });

  await t.test('a tab that has never been here has nothing to present', () => {
    assert.equal(recallSeat(fakeTab(), 'ACDE', 'mario'), null);
  });

  await t.test('two tabs on one laptop are two players', () => {
    // The way this game is actually tested and often played: both seats on one
    // machine. sessionStorage is per-tab, so the second tab cannot present the
    // first one's token and does not get its seat.
    const first = fakeTab();
    const second = fakeTab();
    rememberSeat(first, 'ACDE', 'mario', 'ACDE.mario.1.xyz');
    assert.equal(recallSeat(second, 'ACDE', 'mario'), null);
  });

  await t.test('a token is filed under the room AND the seat it belongs to', () => {
    // A token only ever works for the seat it was minted for, so presenting it
    // anywhere else is at best noise the server ignores.
    const tab = fakeTab();
    rememberSeat(tab, 'ACDE', 'mario', 'ACDE.mario.1.xyz');
    assert.equal(recallSeat(tab, 'ACDE', 'pilot'), null, 'not the other seat');
    assert.equal(recallSeat(tab, 'EFGH', 'mario'), null, 'not the same seat elsewhere');
    rememberSeat(tab, 'EFGH', 'mario', 'EFGH.mario.1.abc');
    assert.equal(recallSeat(tab, 'ACDE', 'mario'), 'ACDE.mario.1.xyz', 'both are kept');
  });

  await t.test('forgetting one leaves the rest alone', () => {
    const tab = fakeTab();
    rememberSeat(tab, 'ACDE', 'mario', 'a');
    rememberSeat(tab, 'EFGH', 'pilot', 'b');
    assert.equal(forgetSeat(tab, 'ACDE', 'mario'), true);
    assert.equal(recallSeat(tab, 'ACDE', 'mario'), null);
    assert.equal(recallSeat(tab, 'EFGH', 'pilot'), 'b');
  });

  await t.test('nonsense is not stored and not returned', () => {
    const tab = fakeTab();
    assert.equal(rememberSeat(tab, 'nope', 'mario', 'a'), false, 'not a room code');
    assert.equal(rememberSeat(tab, 'ACDE', 'referee', 'a'), false, 'not a seat');
    assert.equal(rememberSeat(tab, 'ACDE', 'mario', ''), false, 'not a token');
    assert.deepEqual(tab.keys(), []);
    assert.equal(recallSeat(tab, null, 'mario'), null);
  });

  await t.test('a page that cannot store anything still plays', () => {
    // Safari's private mode throws on the mere mention of sessionStorage, and a
    // page opened from file:// has none. Neither is a reason not to boot: the
    // page joins fresh, exactly as every page did before this existed.
    const hostile = {
      get sessionStorage() { throw new Error('SecurityError'); },
    };
    assert.equal(rememberSeat(hostile, 'ACDE', 'mario', 'a'), false);
    assert.equal(recallSeat(hostile, 'ACDE', 'mario'), null);
    assert.equal(forgetSeat(hostile, 'ACDE', 'mario'), false);
    assert.equal(recallSeat(undefined, 'ACDE', 'mario'), null, 'and with no window at all');
  });
});

test('what the server does with the token a reloaded page presents', { timeout: 30000 }, async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { port } = server;

  await t.test('the token gets the seat back; nothing gets it without one', async () => {
    const { mario, marioWelcome } = await pair(port, 'ACDE');
    await mario.close();

    // What a reloaded page used to do — arrive with no token — and what it was
    // told. The seat is held for its player (spec 7.4), so this is correct.
    const stranger = new FakeClient(port);
    const refused = await stranger.hello('ACDE', 'mario');
    assert.equal(refused.t, MSG.ERROR);
    assert.equal(refused.reason, 'side taken');
    await stranger.close();

    // What it does now.
    const back = await new FakeClient(port);
    const welcome = await back.hello('ACDE', 'mario', marioWelcome.token);
    assert.equal(welcome.t, MSG.WELCOME);
    assert.equal(welcome.side, 'mario');
    assert.equal(welcome.reconnected, true);
    assert.equal(welcome.seed, marioWelcome.seed);
    await back.close();
  });

  await t.test('a stale token is not an error: it joins fresh', async () => {
    // The room expired, the server restarted, the seat was let go. The token is
    // worth nothing and must cost nothing — a page holding one has to fall into
    // an ordinary join, never into a dead page.
    const c = new FakeClient(port);
    const welcome = await c.hello('EFGH', 'mario', 'EFGH.mario.1.gone');
    assert.equal(welcome.t, MSG.WELCOME);
    assert.equal(welcome.side, 'mario');
    assert.equal(welcome.reconnected, false, 'a fresh seat, honestly reported');
    assert.notEqual(welcome.token, 'EFGH.mario.1.gone', 'with a token of its own');
    await c.close();
  });

  await t.test('a stale token does not open a seat somebody else is in', async () => {
    // The one thing reconnect must never become: a way past seat protection.
    const { mario } = await pair(port, 'HJKM');
    const other = new FakeClient(port);
    const refused = await other.hello('HJKM', 'mario', 'HJKM.mario.1.forged');
    assert.equal(refused.t, MSG.ERROR);
    assert.equal(refused.reason, 'side taken');
    await other.close();
    await mario.close();
  });

  await t.test('the old socket closing does not empty the seat the new one took', async () => {
    // A reload is two sockets for one seat and their order is not guaranteed:
    // the new page's hello can beat the old page's close. The old socket's
    // close must then say nothing — it used to mark the seat absent and tell
    // the peer that player had left, undoing the reconnect it raced.
    const { mario, pilot, marioWelcome } = await pair(port, 'NPQR');

    const reloaded = new FakeClient(port);
    const welcome = await reloaded.hello('NPQR', 'mario', marioWelcome.token);
    assert.equal(welcome.reconnected, true);
    // Only now does the page that was replaced go away.
    await mario.close();

    // The pilot is told Mario is BACK and never told he left.
    await pilot.next((m) => m.t === MSG.PEER && m.side === 'mario' && m.present === true);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(
      pilot.inbox.some((m) => m.t === MSG.PEER && m.side === 'mario' && m.present === false),
      false,
      'the ghost of the replaced tab must not report the player gone'
    );
    // And the room agrees: the seat is occupied, not held-for-a-reconnect.
    assert.equal(server.rooms.get('NPQR').summary().seats.mario, 'here');

    await reloaded.close();
    await pilot.close();
  });
});
