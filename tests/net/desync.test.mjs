import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG } from '../../src/net/protocol.js';
import { hashKeys } from '../../src/wings/damage.js';
import { startTestServer, pair } from './helpers.mjs';

// The desync detector end to end: a real server, real sockets, no browser and
// no game. Most of this file asserts the ABSENCE of an alarm, which is the
// half that decides whether anybody will still be listening to it next week.
const quiet = (ms = 200) => new Promise((r) => setTimeout(r, ms));

test('the desync detector', { timeout: 30000 }, async (t) => {
  const server = await startTestServer({ captureLogs: true });
  t.after(() => server.close());
  const { port } = server;

  // THE REGRESSION. A `detonate` is reliable and is resent until it is
  // settled, but the thing that settles it is the DAMAGE carrying its seq —
  // and DAMAGE is a one-shot broadcast that nothing acks and nothing resends.
  // So a single dropped broadcast used to leave that client permanently short
  // a crater, and the retry D4 promises could not put it back: the server
  // answered a resent detonate with DamageMap.add()'s newly-added keys, which
  // on a resend is EMPTY. The retry settled the proposer's outbox and
  // delivered nothing. Two players then stood on different ground forever.
  await t.test('a resent detonate re-delivers the crater, not an empty list', async () => {
    const { mario, pilot } = await pair(port, 'RTVW');
    const ev = { t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['5,10', '6,10'] } };
    pilot.send(ev);
    const first = await mario.ofType(MSG.DAMAGE);
    assert.deepEqual([...first.keys].sort(), ['5,10', '6,10']);

    // Byte-identical resend, exactly as Session.pump would put it back on the
    // wire when the broadcast that should have settled it never arrived.
    const since = mario.inbox.length;
    pilot.send(ev);
    const again = await mario.ofType(MSG.DAMAGE, 3000, since);
    assert.deepEqual([...again.keys].sort(), ['5,10', '6,10'],
      'the resend must carry the crater again, or a lost broadcast is lost for good');
    assert.equal(again.seq, 1, 'and still settle the proposal it belongs to');
    await mario.close();
    await pilot.close();
  });

  // The other half of the same hole: the peer's copy. The proposer's resend
  // cannot help a client whose broadcast was dropped once the proposer has
  // been settled, so the server repairs from the one place that knows the
  // truth (decision D2) — it already hears every client's hashes once a
  // second, and a mismatch that has outlived the grace window IS a client
  // that has lost something.
  await t.test('a client short a crater is handed it back, and then goes quiet', async () => {
    const { mario, pilot } = await pair(port, 'VWXY');
    // Column 40, not column 2: the tiles around a level's spawn are the
    // sanctuary (src/wings/sanctuary.js) and never enter the damage map at all.
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-4', keys: ['40,9'] } });
    await mario.ofType(MSG.DAMAGE);
    // Past the grace window, so "still in flight" is not an available excuse.
    await quiet(3100);

    const since = mario.inbox.length;
    mario.send({ t: MSG.HASH, tick: 300, h: { '1-4': hashKeys([]) } });
    const repair = await mario.ofType(MSG.DAMAGE, 3000, since);
    assert.deepEqual(repair.keys, ['40,9'], 'the server hands back what this client is missing');
    assert.equal(repair.cx, undefined, 'a repair carries no geometry: it must not re-run a blast');

    // Having applied it, this client agrees — and the alarm never fires. A
    // repair that still ended in a DESYNC would be no repair at all.
    mario.send({ t: MSG.HASH, tick: 360, h: { '1-4': hashKeys(['40,9']) } });
    await quiet();
    assert.equal(mario.inbox.some((m) => m.t === MSG.DESYNC), false,
      'a client that took the repair is not desynced');
    await mario.close();
    await pilot.close();
  });

  await t.test('an agreeing hash gets no reply at all', async () => {
    const { mario, pilot } = await pair(port, 'ACDE');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['5,10', '6,10'] } });
    await mario.ofType(MSG.DAMAGE);
    // Deliberately the other order: the hash sorts its own input, so two
    // clients that cratered the same tiles in a different order agree.
    mario.send({ t: MSG.HASH, tick: 60, h: { '1-1': hashKeys(['6,10', '5,10']) } });
    await quiet();
    assert.equal(mario.inbox.some((m) => m.t === MSG.DESYNC), false);
    await mario.close();
    await pilot.close();
  });

  await t.test('sixty agreeing intervals produce sixty silences', async () => {
    // The false positive case, hammered. A detector that fires once an hour
    // for no reason is a detector nobody reads.
    const { mario, pilot } = await pair(port, 'CDEF');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['5,10'] } });
    await mario.ofType(MSG.DAMAGE);
    for (let i = 0; i < 60; i++) {
      mario.send({ t: MSG.HASH, tick: 60 * (i + 1), h: { '1-1': hashKeys(['5,10']) } });
      pilot.send({ t: MSG.HASH, tick: 60 * (i + 1), h: { '1-1': hashKeys(['5,10']) } });
    }
    await quiet(300);
    assert.equal(mario.inbox.some((m) => m.t === MSG.DESYNC), false);
    assert.equal(pilot.inbox.some((m) => m.t === MSG.DESYNC), false);
    await mario.close();
    await pilot.close();
  });

  await t.test('a client one crater behind mid-bombing-run is not accused', async () => {
    // THE RACE THIS DETECTOR HAS TO SURVIVE. The client's replica is written
    // by the server's own broadcast, so between the tick the server records a
    // crater and the tick that broadcast lands, the client is legitimately
    // behind — and its hash timer knows nothing about when bombs fall.
    const { mario, pilot } = await pair(port, 'DEFG');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['5,10'] } });
    await mario.ofType(MSG.DAMAGE);
    pilot.send({ t: MSG.EV, seq: 2, type: 'detonate', d: { island: '1-1', keys: ['6,10'] } });
    // Hashed from the state before that second crater, without waiting for it.
    mario.send({ t: MSG.HASH, tick: 120, h: { '1-1': hashKeys(['5,10']) } });
    await quiet();
    assert.equal(mario.inbox.some((m) => m.t === MSG.DESYNC), false,
      'being one broadcast behind is the normal case, not a fault');
    await mario.close();
    await pilot.close();
  });

  await t.test('a disagreeing hash comes back named, with both values', async () => {
    const { mario, pilot } = await pair(port, 'FGHJ');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['5,10', '6,10'] } });
    await mario.ofType(MSG.DAMAGE);
    // A state this room has never been in, so lag is no excuse for it. The
    // first answer is the authoritative set; only a client still disagreeing
    // after that is called desynced.
    const since = mario.inbox.length;
    mario.send({ t: MSG.HASH, tick: 60, h: { '1-1': hashKeys(['9,9']) } });
    await mario.ofType(MSG.DAMAGE, 3000, since);
    mario.send({ t: MSG.HASH, tick: 120, h: { '1-1': hashKeys(['9,9']) } });
    const d = await mario.ofType(MSG.DESYNC);
    assert.equal(d.island, '1-1');
    assert.equal(d.server, hashKeys(['5,10', '6,10']));
    assert.equal(d.client, hashKeys(['9,9']));
    assert.equal(d.n, 2, 'the count is half the diagnosis');
    assert.deepEqual(d.sample, ['5,10', '6,10'], 'and a sample is the other half');
    await mario.close();
    await pilot.close();
  });

  await t.test('and exactly once, not once per island in the room', async () => {
    const seen = server.logs.filter(
      ([level, line]) => level === 'error' && line.includes('[DESYNC]') && line.includes('room=FGHJ')
    );
    assert.equal(seen.length, 1);
  });

  await t.test('the server logs it loudly', async () => {
    const shouted = server.logs.filter(
      ([level, line]) => level === 'error' && line.includes('[DESYNC]')
    );
    assert.ok(shouted.length > 0, 'a desync must be impossible to miss in the server log');
    const line = shouted.find((l) => l[1].includes('room=FGHJ'))[1];
    assert.match(line, /room=FGHJ/);
    assert.match(line, /island=1-1/);
    assert.match(line, /side=mario/);
    assert.match(line, /serverKeys=2/);
    assert.match(line, /sample=5,10 6,10/);
  });

  await t.test('a client claiming damage on an island the server never touched is caught', async () => {
    const { mario, pilot } = await pair(port, 'KMNP');
    // A client that INVENTED damage is the one case a repair cannot fix: the
    // sets are append-only, so handing it the server's (empty) set for 4-2
    // cannot take a key away again. It is offered the truth once anyway —
    // the server cannot tell "invented a key" from "lost one" out of a hash —
    // and escalates on the next hash when it is still wrong.
    mario.send({ t: MSG.HASH, tick: 60, h: { '4-2': hashKeys(['1,1']) } });
    const repair = await mario.ofType(MSG.DAMAGE);
    assert.equal(repair.island, '4-2');
    assert.deepEqual(repair.keys, [], "the server's set for an untouched island is empty");
    assert.equal(repair.seq, undefined, 'a repair is not a detonate and settles nobody');

    mario.send({ t: MSG.HASH, tick: 120, h: { '4-2': hashKeys(['1,1']) } });
    const d = await mario.ofType(MSG.DESYNC);
    assert.equal(d.island, '4-2');
    assert.equal(d.server, hashKeys([]));
    assert.equal(d.n, 0);
    await mario.close();
    await pilot.close();
  });

  await t.test('an island a client has never loaded is not reported against it', async () => {
    // Mario is on 1-1 and has never seen 1-2; the pilot cratered neither. The
    // detector must have nothing to say about an island nobody has touched,
    // or every match would open with an alarm.
    const { mario, pilot } = await pair(port, 'MNPQ');
    mario.send({ t: MSG.HASH, tick: 60, h: { '1-1': hashKeys([]) } });
    await quiet();
    assert.equal(mario.inbox.some((m) => m.t === MSG.DESYNC), false);
    await mario.close();
    await pilot.close();
  });

  await t.test('a client that never mentions a cratered island is still caught', async () => {
    // Silence about an island is a claim that it is undamaged. A client that
    // lost 1-2's craters entirely would otherwise be invisible to a detector
    // that only ever compares what it was told about.
    const { mario, pilot } = await pair(port, 'NPQR');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-2', keys: ['3,4'] } });
    await mario.ofType(MSG.DAMAGE);
    // Past the grace window, so the crater cannot still be in flight.
    await quiet(3100);
    // Silence about 1-2 is a claim that it is undamaged, so the server hands
    // back the crater this client is missing. This is the REPAIR path proper:
    // a client short a key is exactly what a dropped broadcast produces, and
    // re-applying an append-only set puts it right.
    const since = mario.inbox.length;
    mario.send({ t: MSG.HASH, tick: 300, h: { '1-1': hashKeys([]) } });
    const repair = await mario.ofType(MSG.DAMAGE, 3000, since);
    assert.equal(repair.island, '1-2');
    assert.deepEqual(repair.keys, ['3,4'], 'the repair carries the authoritative set');

    // Still silent about it on the next hash, so the repair did not take.
    mario.send({ t: MSG.HASH, tick: 360, h: { '1-1': hashKeys([]) } });
    const d = await mario.ofType(MSG.DESYNC);
    assert.equal(d.island, '1-2');
    assert.equal(d.client, null, 'null says it never mentioned the island at all');
    assert.equal(d.n, 1);
    await mario.close();
    await pilot.close();
  });

  await t.test('the out-of-bounds case decision D1 exists for', async () => {
    // A key no client can place on its own map must STILL be hashed, or the
    // client that could not place it reports desync forever. This is exactly
    // what world.applyDamage's recorded-but-not-drawn key guarantees.
    const { mario, pilot } = await pair(port, 'QRTU');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['5,10', '99999,99999'] } });
    const dmg = await mario.ofType(MSG.DAMAGE);
    assert.deepEqual([...dmg.keys].sort(), ['5,10', '99999,99999']);
    mario.send({ t: MSG.HASH, tick: 60, h: { '1-1': hashKeys(['5,10', '99999,99999']) } });
    await quiet();
    assert.equal(mario.inbox.some((m) => m.t === MSG.DESYNC), false,
      'the wide key must be in both sets');
    await mario.close();
    await pilot.close();
  });

  await t.test('a malformed key is in nobody set, so hashing without it agrees', async () => {
    // The server drops keys parseTileKey rejects before they ever reach the
    // map, so a client that never heard of them hashes the same set.
    const { mario, pilot } = await pair(port, 'RTUV');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['5,10', ' 3,11', ''] } });
    await mario.ofType(MSG.DAMAGE);
    mario.send({ t: MSG.HASH, tick: 60, h: { '1-1': hashKeys(['5,10']) } });
    await quiet();
    assert.equal(mario.inbox.some((m) => m.t === MSG.DESYNC), false);
    await mario.close();
    await pilot.close();
  });
});
