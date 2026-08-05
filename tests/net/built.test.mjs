import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';
import { startTestServer, pair, FakeClient } from './helpers.mjs';

// THE BRIDGE, over a real socket, with no browser and no game on either end.
//
// Mario's toolbelt lays a row of bricks; the pilot has to see it, be able to
// bomb it, and — the part only a server can provide — still see it after his
// tab has crashed, or if he walks into the match an hour late. What is pinned
// here is that the SERVER holds the built set, that the two sets stay disjoint
// through it, and that a client is written by the authoritative broadcast and
// never by its own proposal.

const build = (client, seq, island, keys) =>
  client.send({ t: MSG.EV, seq, type: 'build', d: { island, keys } });
const bomb = (client, seq, island, keys) =>
  client.send({ t: MSG.EV, seq, type: 'detonate', d: { island, keys } });

test('brick rows over a real socket', { timeout: 60000 }, async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { port } = server;

  await t.test('a row Mario lays reaches the pilot, and Mario himself', async () => {
    const { mario, pilot } = await pair(port, 'ACDE');
    build(mario, 1, '1-1', ['20,11', '21,11', '22,11', '23,11', '24,11']);

    // BOTH clients, including the one that proposed it: every client's built
    // set is written by exactly one code path, which is the whole of decision
    // D2 applied to the other direction.
    const toPilot = await pilot.ofType(MSG.BUILT);
    const toMario = await mario.ofType(MSG.BUILT);
    assert.equal(toPilot.island, '1-1');
    assert.deepEqual(toPilot.keys, ['20,11', '21,11', '22,11', '23,11', '24,11']);
    assert.deepEqual(toMario.keys, toPilot.keys, 'the two clients were told different things');
    assert.equal(toMario.seq, 1, 'the proposal is settled by the broadcast carrying its seq');

    await mario.close();
    await pilot.close();
  });

  await t.test('the pilot cannot claim a brick', async () => {
    // The mirror of "Mario cannot claim a crater". Ownership is enforced, not
    // described: the pilot has no toolbelt and no Mario level, so a build from
    // him is a claim about something he cannot see.
    const { mario, pilot } = await pair(port, 'FGHJ');
    build(pilot, 1, '1-1', ['9,9']);
    const err = await pilot.ofType(MSG.ERROR);
    assert.match(err.reason, /not the owner of build/);

    // And it built nothing: Mario's own legal build on the same island comes
    // back with only his key in it.
    build(mario, 1, '1-1', ['3,3']);
    const built = await mario.ofType(MSG.BUILT);
    assert.deepEqual(built.keys, ['3,3']);

    await mario.close();
    await pilot.close();
  });

  await t.test('a bomb into a brick row takes the bricks, and the row takes the crater', async () => {
    const { mario, pilot } = await pair(port, 'KMNP');

    // Crater first, then bridge it: the key leaves the destroyed set.
    bomb(pilot, 1, '2-1', ['40,12']);
    await pilot.ofType(MSG.DAMAGE);
    build(mario, 1, '2-1', ['40,12']);
    await mario.ofType(MSG.BUILT);

    const room = server.rooms.get('KMNP');
    assert.deepEqual(room.built.keys('2-1'), ['40,12']);
    assert.deepEqual(room.damage.keys('2-1'), [], 'the crater it filled is still recorded');

    // Now bomb the bridge: the key changes sides again, with no timestamp and
    // no ordering rule anywhere in it — last action wins.
    // `since` matters: the first bomb's DAMAGE is still in the inbox and names
    // the same key, so a wait without it is satisfied by the old message and
    // asserts against a server that has not read the second bomb yet.
    const since = pilot.inbox.length;
    bomb(pilot, 2, '2-1', ['40,12']);
    await pilot.next((m) => m.t === MSG.DAMAGE && m.keys.includes('40,12'), undefined, since);
    assert.deepEqual(room.built.keys('2-1'), []);
    assert.deepEqual(room.damage.keys('2-1'), ['40,12']);

    await mario.close();
    await pilot.close();
  });

  await t.test('a pilot who joins an hour late is given the bridges as well as the holes', async () => {
    const mario = new FakeClient(port);
    await mario.hello('QRTU', 'mario');
    build(mario, 1, '3-1', ['12,9', '13,9']);
    await mario.ofType(MSG.BUILT);

    // Nobody was flying when that row went down. The whole reason the server
    // holds this set rather than the two clients gossiping about it.
    const latecomer = new FakeClient(port);
    const welcome = await latecomer.hello('QRTU', 'pilot');
    assert.deepEqual(welcome.built['3-1'], ['12,9', '13,9']);
    assert.deepEqual(welcome.damage, {}, 'nothing was bombed, and nothing is claimed to be');

    await mario.close();
    await latecomer.close();
  });

  await t.test('a pilot whose tab crashed reconnects onto the same island', async () => {
    const { mario, pilot } = await pair(port, 'VWXY');
    bomb(pilot, 1, '1-2', ['55,10']);
    await pilot.ofType(MSG.DAMAGE);
    build(mario, 1, '1-2', ['56,10']);
    await mario.ofType(MSG.BUILT);
    const token = (await pilot.next((m) => m.t === MSG.WELCOME)).token;
    await pilot.close();

    const back = new FakeClient(port);
    const welcome = await back.hello('VWXY', 'pilot', token);
    assert.equal(welcome.reconnected, true);
    assert.deepEqual(welcome.damage['1-2'], ['55,10']);
    assert.deepEqual(welcome.built['1-2'], ['56,10'], 'the bridge did not survive the reconnect');

    await mario.close();
    await back.close();
  });

  await t.test('a resent build delivers the whole row, not an empty list', async () => {
    // Exactly the bug recordDetonate carries a comment about: the broadcast is
    // what settles the proposer's outbox, so answering a retry with the
    // newly-added keys settles it while delivering nothing at all, and the
    // retry that was supposed to repair a dropped row guarantees it stays lost.
    const { mario, pilot } = await pair(port, 'W347');
    build(mario, 7, '4-1', ['1,1', '2,1']);
    await pilot.ofType(MSG.BUILT);
    // From HERE, or the wait is satisfied by the first broadcast still sitting
    // in the inbox and the resend is never examined at all.
    const since = pilot.inbox.length;
    build(mario, 7, '4-1', ['1,1', '2,1']);
    const again = await pilot.next((m) => m.t === MSG.BUILT, undefined, since);
    assert.deepEqual(again.keys, ['1,1', '2,1']);
    await mario.close();
    await pilot.close();
  });

  await t.test('a malformed key is not a tile and never reaches the peer', async () => {
    const { mario, pilot } = await pair(port, 'Y679');
    build(mario, 1, '5-1', ['7,7', '', ' 3,11', '0x3,2', 'nonsense']);
    const built = await pilot.ofType(MSG.BUILT);
    assert.deepEqual(built.keys, ['7,7']);
    await mario.close();
    await pilot.close();
  });

  await t.test('a client that never says hello cannot build', async () => {
    const stranger = new FakeClient(port);
    await stranger.open;
    stranger.send({ t: MSG.EV, seq: 1, type: 'build', d: { island: '1-1', keys: ['1,1'] } });
    const err = await stranger.ofType(MSG.ERROR);
    assert.match(err.reason, /hello first/);
    await stranger.close();
  });

  await t.test('the welcome always carries a built map, empty or not', async () => {
    // Optional on the wire (see protocol.js) but always sent by this server, so
    // a client can read it without a fallback in the ordinary case.
    const c = new FakeClient(port);
    const welcome = await c.hello('34679'.slice(0, 4), 'mario');
    assert.equal(welcome.v, PROTOCOL_VERSION);
    assert.deepEqual(welcome.built, {});
    await c.close();
  });
});
