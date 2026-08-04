// Tier 2: the real server, two fake clients, no browser. Everything the
// transport layer decides — seats, ownership, relay, damage, desync — proved
// over an actual socket in well under a second.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';
import { hashKeys } from '../../src/wings/damage.js';
import { startTestServer, FakeClient, pair } from './helpers.mjs';

test('two clients, one room', { timeout: 30000 }, async (t) => {
  const server = await startTestServer({ captureLogs: true });
  t.after(() => server.close());
  const { port } = server;

  await t.test('the static files are served with module-safe MIME types', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/src/net/protocol.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    const html = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /text\/html/);
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(await health.text(), 'ok');
  });

  await t.test('a traversal out of the repo root is refused', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/../../../etc/passwd`);
    assert.ok(res.status === 403 || res.status === 404, `got ${res.status}`);
    // fetch() normalises the plain form before it leaves the process, so the
    // percent-encoded one is what actually reaches resolveSafe().
    const enc = await fetch(`http://127.0.0.1:${port}/..%2f..%2f..%2fetc/passwd`);
    assert.equal(enc.status, 403);
  });

  await t.test('a missing file is a 404, not a crash', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/no/such/file.js`);
    assert.equal(res.status, 404);
  });

  await t.test('POST /room mints a joinable code, GET /room does not', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/room`, { method: 'POST' });
    const { room } = await res.json();
    const c = new FakeClient(port);
    const w = await c.hello(room, 'mario');
    assert.equal(w.t, MSG.WELCOME);
    assert.equal(w.room, room);
    await c.close();
    // A GET would let a link preview or a prefetch mint rooms nobody asked for.
    const get = await fetch(`http://127.0.0.1:${port}/room`);
    assert.equal(get.status, 404);
  });

  await t.test('sides are assigned and the peer is announced', async () => {
    const { mario, pilot, marioWelcome, pilotWelcome } = await pair(port, 'FGHJ');
    assert.equal(marioWelcome.side, 'mario');
    assert.equal(marioWelcome.peer, false, 'mario arrived first');
    assert.equal(pilotWelcome.side, 'pilot');
    assert.equal(pilotWelcome.peer, true, 'pilot arrived second and should see mario');
    const announced = await mario.ofType(MSG.PEER);
    assert.equal(announced.side, 'pilot');
    assert.equal(announced.present, true);
    assert.equal(typeof marioWelcome.seed, 'number');
    assert.equal(marioWelcome.seed, pilotWelcome.seed, 'both sides must share the seed');
    await mario.close();
    await pilot.close();
  });

  await t.test('a third client is refused', async () => {
    const { mario, pilot } = await pair(port, 'KMNP');
    const third = new FakeClient(port);
    const res = await third.hello('KMNP', undefined);
    assert.equal(res.t, MSG.ERROR);
    assert.equal(res.reason, 'room full');
    await third.close();
    await mario.close();
    await pilot.close();
  });

  await t.test('snapshots relay verbatim and are never rejected', async () => {
    const { mario, pilot } = await pair(port, 'QRTU');
    mario.send({ t: MSG.SNAP, side: 'mario', tick: 42, s: { x: -99999, lives: 3, junk: 'ok' } });
    const got = await pilot.ofType(MSG.SNAP);
    assert.equal(got.tick, 42);
    assert.equal(got.s.x, -99999);
    assert.equal(got.s.junk, 'ok');
    await mario.close();
    await pilot.close();
  });

  await t.test('a client cannot narrate the other side', async () => {
    const { mario, pilot } = await pair(port, 'VWXY');
    mario.send({ t: MSG.SNAP, side: 'pilot', tick: 1, s: { x: 0 } });
    const got = await pilot.ofType(MSG.SNAP);
    assert.equal(got.side, 'mario', 'the server stamps the sender, not the claim');
    await mario.close();
    await pilot.close();
  });

  await t.test('a detonate from the pilot is recorded, broadcast and acked', async () => {
    const { mario, pilot } = await pair(port, 'ACDE');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['5,10', '6,10'] } });
    const toMario = await mario.ofType(MSG.DAMAGE);
    const toPilot = await pilot.ofType(MSG.DAMAGE);
    assert.deepEqual([...toMario.keys].sort(), ['5,10', '6,10']);
    assert.deepEqual([...toPilot.keys].sort(), ['5,10', '6,10'], 'the proposer is told too');
    assert.equal(toMario.island, '1-1');
    const ack = await pilot.ofType(MSG.ACK);
    assert.equal(ack.seq, 1);
    await mario.close();
    await pilot.close();
  });

  await t.test('the server drops unparseable tile keys before they reach the wire', async () => {
    const { mario, pilot } = await pair(port, 'RTUV');
    pilot.send({
      t: MSG.EV,
      seq: 1,
      type: 'detonate',
      d: { island: '1-1', keys: ['3,11', ' 3,11', '0x3,2', '1e1,2', '0', '', 7, null, '03,11'] },
    });
    const dmg = await mario.ofType(MSG.DAMAGE);
    // '03,11' survives on purpose: parseTileKey documents a leading zero as an
    // alias, not a forgery. Everything else is not a `<int>,<int>` at all.
    assert.deepEqual(dmg.keys, ['3,11', '03,11'], 'only plain `<int>,<int>` keys survive');
    await mario.close();
    await pilot.close();
  });

  await t.test('a detonate from mario is refused and records nothing', async () => {
    const { mario, pilot } = await pair(port, 'WXY3');
    mario.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['9,9'] } });
    const err = await mario.ofType(MSG.ERROR);
    assert.equal(err.reason, 'not the owner of detonate');
    // And nothing reached the pilot.
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(pilot.inbox.some((m) => m.t === MSG.DAMAGE), false);
    await mario.close();
    await pilot.close();
  });

  await t.test('marioDeath goes the other way and pilot may not send it', async () => {
    const { mario, pilot } = await pair(port, 'Y346');
    mario.send({ t: MSG.EV, seq: 1, type: 'marioDeath', d: { island: '1-1', lives: 2 } });
    const got = await pilot.ofType(MSG.EV);
    assert.equal(got.type, 'marioDeath');
    assert.equal(got.d.lives, 2);

    pilot.send({ t: MSG.EV, seq: 1, type: 'marioDeath', d: { lives: 0 } });
    const err = await pilot.ofType(MSG.ERROR);
    assert.equal(err.reason, 'not the owner of marioDeath');
    await mario.close();
    await pilot.close();
  });

  await t.test('matching hashes are silent and a divergent one is caught', async () => {
    const { mario, pilot } = await pair(port, '3467');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['5,10', '6,10'] } });
    await mario.ofType(MSG.DAMAGE);

    // Agreement first, then a lie about a second island in the same message.
    // If agreement produced a DESYNC too, the island below would not be the
    // first one back.
    const since = mario.inbox.length;
    mario.send({
      t: MSG.HASH,
      tick: 60,
      h: { '1-1': hashKeys(['5,10', '6,10']), '1-2': 'deadbeef' },
    });
    // The first answer to a disagreement is the authoritative set, not an
    // alarm — and only for the island that disagrees.
    const repair = await mario.ofType(MSG.DAMAGE, 3000, since);
    assert.equal(repair.island, '1-2', 'only the island that disagrees is repaired');

    // Unmoved on the next hash, so the repair did not take and this is real.
    mario.send({
      t: MSG.HASH,
      tick: 120,
      h: { '1-1': hashKeys(['5,10', '6,10']), '1-2': 'deadbeef' },
    });
    const bad = await mario.ofType(MSG.DESYNC);
    assert.equal(bad.island, '1-2', 'only the island that disagrees is reported');
    assert.equal(bad.client, 'deadbeef');
    assert.equal(bad.server, hashKeys([]), 'an island the server never damaged hashes as empty');
    assert.ok(
      server.logs.some(([lvl, line]) => lvl === 'error' && line.includes('[DESYNC]')),
      'and it is impossible to miss in the server log'
    );
    await mario.close();
    await pilot.close();
  });

  await t.test('a reconnect returns to the same seat with the damage intact', async () => {
    const { mario, pilot, pilotWelcome } = await pair(port, 'CDEF');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['1,1', '2,1'] } });
    await mario.ofType(MSG.DAMAGE);
    await pilot.close();

    const again = new FakeClient(port);
    const back = await again.hello('CDEF', undefined, pilotWelcome.token);
    assert.equal(back.t, MSG.WELCOME);
    assert.equal(back.side, 'pilot');
    assert.equal(back.reconnected, true);
    assert.deepEqual(back.damage['1-1'], ['1,1', '2,1'], 'the match survived the disconnect');
    assert.equal(back.seed, pilotWelcome.seed, 'and so did the seed');
    await again.close();
    await mario.close();
  });

  await t.test('the peer is told when somebody drops', async () => {
    const { mario, pilot } = await pair(port, 'EFGH');
    await pilot.close();
    const gone = await mario.next((m) => m.t === MSG.PEER && m.present === false);
    assert.equal(gone.side, 'pilot');
    await mario.close();
  });

  await t.test('a malformed frame gets a reason, not a dropped connection', async () => {
    const c = new FakeClient(port);
    await c.open;
    c.ws.send('{not json');
    const err = await c.ofType(MSG.ERROR);
    assert.equal(err.reason, 'bad json');
    // The socket is still usable.
    const w = await c.hello('HJKM', 'mario');
    assert.equal(w.t, MSG.WELCOME);
    await c.close();
  });

  await t.test('anything before hello is refused', async () => {
    const c = new FakeClient(port);
    await c.open;
    c.send({ t: MSG.SNAP, side: 'mario', tick: 1, s: {} });
    const err = await c.ofType(MSG.ERROR);
    assert.equal(err.reason, 'hello first');
    await c.close();
  });

  await t.test('a second hello on the same socket is refused', async () => {
    const c = new FakeClient(port);
    const w = await c.hello('NPQR', 'mario');
    assert.equal(w.t, MSG.WELCOME);
    c.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, room: 'NPQR', side: 'pilot' });
    const err = await c.ofType(MSG.ERROR);
    assert.equal(err.reason, 'already joined');
    await c.close();
  });

  await t.test('a version mismatch is refused with a legible reason', async () => {
    const c = new FakeClient(port);
    await c.open;
    c.ws.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION + 1, room: 'MNPQ' }));
    const err = await c.ofType(MSG.ERROR);
    assert.match(err.reason, /protocol version/);
    await c.close();
  });
});
