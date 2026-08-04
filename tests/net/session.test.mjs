import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { Session } from '../../src/net/session.js';
import { Transport } from '../../src/net/transport.js';
import { startTestServer } from './helpers.mjs';

// `ws`'s WebSocket is API-compatible with the browser's for everything
// Transport touches (onopen/onmessage/onclose/send/readyState/close), which is
// the whole reason Transport takes the implementation as an option.
//
// The port always comes from startTestServer, which binds 0 and lets the OS
// pick: nothing here can collide with a parallel run, or with 8123/4322/8199.
function makeSession(port, room, side, opts = {}) {
  const transport = new Transport(`ws://127.0.0.1:${port}/ws`, {
    WebSocketImpl: WebSocket,
    seed: opts.seed,
  });
  return { session: new Session({ transport, room, side, token: opts.token }), transport };
}

// Drive both sessions' pump() until `check()` is true or the budget runs out.
// This is the tick loop with no game in it. The 2ms sleep is test pacing, not
// protocol: the session itself only ever counts ticks.
async function spin(sessions, check, ticks = 900) {
  for (let t = 1; t <= ticks; t++) {
    for (const s of sessions) s.pump(t);
    await new Promise((r) => setTimeout(r, 2));
    if (check()) return t;
  }
  return -1;
}

test('sessions over a real socket', { timeout: 60000 }, async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { port } = server;

  await t.test('two sessions join and exchange an event', async () => {
    const a = makeSession(port, 'ACDE', 'mario');
    const b = makeSession(port, 'ACDE', 'pilot');
    await a.session.connect();
    await b.session.connect();

    const seen = [];
    a.session.on('event', (e) => seen.push(e));
    b.session.sendEvent('planeLost', { reason: 'sea' });

    const at = await spin([a.session, b.session], () => seen.length > 0);
    assert.ok(at > 0, 'the event never arrived');
    assert.equal(seen[0].type, 'planeLost');
    assert.equal(seen[0].d.reason, 'sea');
    assert.equal(b.session.pending(), 0, 'it should have been acked');
    a.session.close();
    b.session.close();
  });

  await t.test('a reliable event survives 50% packet loss', async () => {
    // Half of everything, in both directions, on both sockets. If the resend
    // logic is wrong this hangs; if it is right this costs a few resends.
    const a = makeSession(port, 'FGHJ', 'mario', { seed: 11 });
    const b = makeSession(port, 'FGHJ', 'pilot', { seed: 22 });
    await a.session.connect();
    await b.session.connect();
    a.transport.drop(50);
    b.transport.drop(50);

    const seen = [];
    a.session.on('event', (e) => seen.push(e.type));
    b.session.sendEvent('bombRelease', { kind: 'bomb' });

    const at = await spin([a.session, b.session], () => seen.length > 0 && b.session.pending() === 0);
    assert.ok(at > 0, `never delivered and acked; transport=${JSON.stringify(b.transport.stats())}`);
    assert.deepEqual(seen, ['bombRelease'], 'delivered exactly once despite the resends');
    assert.ok(b.transport.stats().dropped > 0, 'the loss injector should actually have lost something');
    a.session.close();
    b.session.close();
  });

  await t.test('a snapshot is never resent, however much is lost', async () => {
    // The counterpart of the test above, and the whole reason the two message
    // classes are separate: a resent snapshot would be stale by the time it
    // landed, and 20Hz of them retried would drown the socket.
    const a = makeSession(port, 'KMNP', 'mario', { seed: 3 });
    await a.session.connect();
    a.transport.drop(100);
    for (let tick = 0; tick < 60; tick += 3) a.session.sendSnapshot(tick, { x: tick });
    assert.equal(a.session.pending(), 0, 'nothing about a snapshot is queued');
    await spin([a.session], () => false, 30);
    assert.equal(a.session.pending(), 0, 'and no amount of pumping invents a retry');
    a.session.close();
  });

  await t.test('injected latency delays but does not lose', async () => {
    const a = makeSession(port, 'QRTU', 'mario');
    const b = makeSession(port, 'QRTU', 'pilot');
    await a.session.connect();
    await b.session.connect();
    a.transport.latency(150);
    b.transport.latency(150);

    const seen = [];
    a.session.on('event', (e) => seen.push(e.type));
    b.session.sendEvent('landed', {});
    const at = await spin([a.session, b.session], () => seen.length > 0);
    assert.ok(at > 0);
    assert.deepEqual(seen, ['landed']);
    a.session.close();
    b.session.close();
  });

  await t.test('a severed wire delivers nothing, and healing it delivers the resend', async () => {
    const a = makeSession(port, 'VWXY', 'mario');
    const b = makeSession(port, 'VWXY', 'pilot');
    const welcome = await a.session.connect();
    await b.session.connect();

    a.transport.disconnect();
    const seen = [];
    a.session.on('event', (e) => seen.push(e.type));
    b.session.sendEvent('landed', {});
    await spin([b.session], () => false, 40);
    assert.deepEqual(seen, [], 'a severed wire must deliver nothing');

    a.transport.reconnect();
    const at = await spin([a.session, b.session], () => seen.length > 0);
    assert.ok(at > 0, 'the resend should reach a reconnected client');
    assert.deepEqual(seen, ['landed']);
    assert.equal(a.session.token, welcome.token);
    a.session.close();
    b.session.close();
  });

  await t.test('a dropped socket reconnects into the same match, not a new one', async () => {
    // Spec 7.4, end to end: the wifi dies mid-sortie and the returning player
    // gets the same seat, the same archipelago seed and every crater that was
    // made while they were away.
    const a = makeSession(port, 'W347', 'mario');
    const b = makeSession(port, 'W347', 'pilot');
    const first = await a.session.connect();
    await b.session.connect();

    b.session.sendEvent('detonate', { island: '1-1', keys: ['5,10', '6,10'] });
    const damage = [];
    b.session.on('damage', (m) => damage.push(m));
    await spin([a.session, b.session], () => damage.length > 0);
    assert.deepEqual(damage[0].keys.sort(), ['5,10', '6,10'], 'the server recorded the craters');

    // Pull the plug: a real socket close, not the fault injector.
    a.transport.ws.close();
    await spin([b.session], () => a.session.connected === false, 100);
    assert.equal(a.session.connected, false);

    // Same Session object, so it still holds its token, its seq counter and
    // anything unacked. connect() is the reconnect.
    const again = await a.session.connect();
    assert.equal(again.reconnected, true, 'the server recognised the seat');
    assert.equal(again.side, first.side, 'same side');
    assert.equal(again.token, first.token, 'same seat');
    assert.equal(again.seed, first.seed, 'same archipelago');
    assert.deepEqual(again.damage['1-1'].sort(), ['5,10', '6,10'], 'the craters came back with us');

    // And the resumed session is a working one.
    const seen = [];
    a.session.on('event', (e) => seen.push(e.type));
    b.session.sendEvent('landed', {});
    const at = await spin([a.session, b.session], () => seen.length > 0);
    assert.ok(at > 0, 'the resumed session still carries events');
    a.session.close();
    b.session.close();
  });

  await t.test('a malformed frame is refused without killing the session', async () => {
    const a = makeSession(port, 'Y679', 'mario');
    await a.session.connect();
    const errors = [];
    a.session.on('error', (e) => errors.push(e.reason));
    a.transport.send('{ this is not json');
    await spin([a.session], () => errors.length > 0, 200);
    assert.match(errors[0], /bad json/);

    // Still up: a good message on the same socket goes through.
    const b = makeSession(port, 'Y679', 'pilot');
    await b.session.connect();
    const seen = [];
    b.session.on('event', (e) => seen.push(e.type));
    a.session.sendEvent('marioDeath', { lives: 2 });
    const at = await spin([a.session, b.session], () => seen.length > 0);
    assert.ok(at > 0, 'the session died on a junk frame');
    assert.deepEqual(seen, ['marioDeath']);
    a.session.close();
    b.session.close();
  });

  await t.test('the server refuses an event the session should not have sent', async () => {
    const a = makeSession(port, 'X449', 'mario');
    await a.session.connect();
    const errors = [];
    a.session.on('error', (e) => errors.push(e.reason));
    // Bypass sendEvent's own guard to prove the server is the backstop.
    a.transport.send(JSON.stringify({ t: 'ev', seq: 1, type: 'detonate', d: { island: '1-1', keys: [] } }));
    await spin([a.session], () => errors.length > 0, 200);
    assert.match(errors[0], /not the owner of detonate/);
    a.session.close();
  });
});
