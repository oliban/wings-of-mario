import test from 'node:test';
import assert from 'node:assert/strict';

import { startTestServer, FakeClient, pair } from './helpers.mjs';
import { MSG } from '../../src/net/protocol.js';

// A PLAYER WHO VANISHES WITHOUT SAYING SO.
//
// Presence used to be learned from the socket's `close` event and nothing else,
// which only fires on an orderly shutdown. A laptop that sleeps, a phone that
// backgrounds Safari and a wifi drop all send no FIN at all — the socket stayed
// open, the seat stayed occupied by nobody, and the other player's client went
// on believing there was somebody there. The pilot's debug world jump refuses
// to move while a Mario is in the room, so a Mario who had silently gone locked
// the pilot into one archipelago for the rest of the session.
//
// The ping runs every ten seconds in the real server; these run it in
// milliseconds, because the behaviour under test is "a silent socket is
// eventually terminated", not how long ten seconds is.
const FAST = { heartbeatMs: 40 };

// Stop the far end answering pings WITHOUT closing anything. Pausing the
// underlying stream means incoming frames are never read, so `ws` never sees
// the ping and never pongs — which is exactly what a sleeping machine looks
// like from here, and is why `close` alone was never enough.
const goSilent = (client) => client.ws._socket.pause();

test('the server notices a player who stopped answering', { timeout: 60000 }, async (t) => {
  const server = await startTestServer(FAST);
  t.after(() => server.close());

  await t.test('a silent socket is reported gone to the peer', async () => {
    const { mario, pilot } = await pair(server.port, 'ACDE');
    goSilent(mario);
    // No close, no error, no goodbye — just silence, and the peer is told.
    const gone = await pilot.next((m) => m.t === MSG.PEER && m.present === false);
    assert.equal(gone.side, 'mario');
    await pilot.close();
  });

  await t.test('and he can reconnect into it when the wifi comes back', async () => {
    const { mario, pilot, marioWelcome } = await pair(server.port, 'EFGH');
    goSilent(mario);
    await pilot.next((m) => m.t === MSG.PEER && m.present === false);

    // A seat the heartbeat vacated is vacated exactly as a closed tab's is:
    // still HELD for the player who was in it, so his token gets him back into
    // the same match rather than a new one. This is the whole reason the
    // heartbeat terminates rather than evicting — everything downstream of
    // `close` already does the right thing.
    const back = new FakeClient(server.port);
    const w = await back.hello('EFGH', 'mario', marioWelcome.token);
    assert.equal(w.t, MSG.WELCOME);
    assert.equal(w.side, 'mario');
    assert.equal(w.reconnected, true, 'a returning player started a new match instead');
    await back.close();
    await pilot.close();
  });

  await t.test('a talkative socket is left alone', async () => {
    const { mario, pilot } = await pair(server.port, 'HJKM');
    // Long enough for several sweeps to have run and terminated anything that
    // was not answering. `ws` pongs from inside the library, so a client that
    // sends nothing at all still survives — which is the point: it measures the
    // connection, not whether the game is busy.
    await new Promise((r) => setTimeout(r, 300));
    const w = await mario.hello('HJKM', 'mario').catch(() => null);
    // Already seated, so the second hello is refused — but a REPLY at all
    // proves the socket is still open and the server still knows it.
    assert.ok(w, 'the heartbeat killed a healthy socket');
    await mario.close();
    await pilot.close();
  });
});
