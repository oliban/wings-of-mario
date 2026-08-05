import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG, EVENT_OWNER } from '../../src/net/protocol.js';
import { MatchVerdict, applyWire } from '../../src/net/match-events.js';
import { startTestServer, pair, FakeClient } from './helpers.mjs';

// The match's reliable events, over a real socket, with no browser and no game
// on either end. What is pinned here is ROUTING and OWNERSHIP (spec 7.3) — who
// is allowed to say what, and that saying it reaches the other side.

const OWNED_BY_PILOT = Object.keys(EVENT_OWNER).filter((t) => EVENT_OWNER[t] === 'pilot');
const OWNED_BY_MARIO = Object.keys(EVENT_OWNER).filter((t) => EVENT_OWNER[t] === 'mario');

test('match events over a real socket', { timeout: 60000 }, async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { port } = server;

  await t.test('the ownership table covers every event this task carries', () => {
    // If an event is added to the wire without an owner, the server refuses it
    // outright and it silently never arrives. Better to fail here.
    for (const type of [
      'marioDeath', 'islandCleared', 'ferryBoard', 'ferrySunk',
      'sortieStart', 'landed', 'planeLost', 'worldCleared', 'worldReset',
      'detonate', 'bombRelease', 'build',
    ]) {
      assert.ok(EVENT_OWNER[type], `${type} has no owner`);
    }
  });

  await t.test('every pilot-owned event reaches Mario and is refused from Mario', async () => {
    const { mario, pilot } = await pair(port, 'ACDE');
    let seq = 0;
    for (const type of OWNED_BY_PILOT) {
      const d = type === 'detonate' ? { island: '1-1', keys: ['3,4'] } : { probe: type };
      pilot.send({ t: MSG.EV, seq: ++seq, type, d });
      // A detonate arrives as an authoritative DAMAGE broadcast, not as a
      // relayed EV: the server consumes the proposal and answers with a fact.
      const got = type === 'detonate'
        ? await mario.next((m) => m.t === MSG.DAMAGE)
        : await mario.next((m) => m.t === MSG.EV && m.type === type);
      assert.ok(got, `${type} never reached Mario`);
      if (type !== 'detonate') assert.equal(got.d.probe, type);
    }

    let since = mario.inbox.length;
    let mseq = 0;
    for (const type of OWNED_BY_PILOT) {
      mario.send({ t: MSG.EV, seq: ++mseq, type, d: { island: '1-1', keys: [] } });
      const err = await mario.next(
        (m) => m.t === MSG.ERROR && m.reason.includes(type), undefined, since
      );
      assert.match(err.reason, new RegExp(`not the owner of ${type}`));
      since = mario.inbox.length;
    }
    await mario.close();
    await pilot.close();
  });

  await t.test('every mario-owned event reaches the pilot and is refused from the pilot', async () => {
    const { mario, pilot } = await pair(port, 'FGHJ');
    let seq = 0;
    for (const type of OWNED_BY_MARIO) {
      // `build` is the mirror of `detonate` and travels the same way: the
      // server CONSUMES the proposal and answers both clients with an
      // authoritative BUILT, so the pilot never sees a relayed EV for it.
      const d = type === 'build' ? { island: '1-1', keys: ['3,4'] } : { probe: type };
      mario.send({ t: MSG.EV, seq: ++seq, type, d });
      const got = type === 'build'
        ? await pilot.next((m) => m.t === MSG.BUILT)
        : await pilot.next((m) => m.t === MSG.EV && m.type === type);
      assert.ok(got, `${type} never reached the pilot`);
      if (type !== 'build') assert.equal(got.d.probe, type);
    }

    let since = pilot.inbox.length;
    let pseq = 0;
    for (const type of OWNED_BY_MARIO) {
      pilot.send({ t: MSG.EV, seq: ++pseq, type, d: {} });
      const err = await pilot.next(
        (m) => m.t === MSG.ERROR && m.reason.includes(type), undefined, since
      );
      assert.match(err.reason, new RegExp(`not the owner of ${type}`));
      since = pilot.inbox.length;
    }
    await mario.close();
    await pilot.close();
  });

  await t.test('a refused event costs the sender nothing else', async () => {
    // A rejection must not tear down the connection or invalidate the seq
    // stream: the next legal event still has to work.
    const { mario, pilot } = await pair(port, 'KMNP');
    mario.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['1,1'] } });
    await mario.ofType(MSG.ERROR);
    mario.send({ t: MSG.EV, seq: 2, type: 'marioDeath', d: { lives: 2 } });
    const got = await pilot.next((m) => m.t === MSG.EV && m.type === 'marioDeath');
    assert.equal(got.d.lives, 2);
    await mario.close();
    await pilot.close();
  });

  await t.test('a refused detonate destroys nothing', async () => {
    // The point of refusing, rather than merely not relaying: Mario must not
    // be able to write the shared destroyed-set at all.
    const { mario, pilot } = await pair(port, 'QRTU');
    mario.send({
      t: MSG.EV, seq: 1, type: 'detonate', d: { island: '4-1', keys: ['7,7'], cx: 1, cy: 1, r: 2 },
    });
    await mario.ofType(MSG.ERROR);
    // The pilot's own legal detonate on the same island comes back with only
    // his key in it, which is only true if Mario's never landed.
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '4-1', keys: ['2,2'] } });
    const dmg = await pilot.next((m) => m.t === MSG.DAMAGE);
    assert.deepEqual(dmg.keys, ['2,2']);
    await mario.close();
    await pilot.close();
  });

  await t.test('the blast that caused the damage reaches BOTH clients unchanged', async () => {
    // Hit resolution follows ownership: Mario's client runs the kill, so it
    // needs the pilot's centre, and it has to be the same centre the pilot
    // used or the two resolve the same bomb against two different circles.
    const { mario, pilot } = await pair(port, 'VWXY');
    pilot.send({
      t: MSG.EV,
      seq: 1,
      type: 'detonate',
      d: { island: '1-1', keys: ['5,6'], cx: 1234.5, cy: 210, r: 2 },
    });
    const [toPilot, toMario] = await Promise.all([
      pilot.next((m) => m.t === MSG.DAMAGE),
      mario.next((m) => m.t === MSG.DAMAGE),
    ]);
    assert.deepEqual(
      { cx: toMario.cx, cy: toMario.cy, r: toMario.r },
      { cx: 1234.5, cy: 210, r: 2 }
    );
    assert.deepEqual(
      { cx: toPilot.cx, cy: toPilot.cy, r: toPilot.r },
      { cx: toMario.cx, cy: toMario.cy, r: toMario.r }
    );
    await mario.close();
    await pilot.close();
  });

  await t.test('a detonate with a nonsense centre still craters, without one', async () => {
    // A bad number must not cost the crater, and must not be passed on: the
    // peer's own validator would refuse the whole broadcast and its tile map
    // would fall behind the server's forever.
    const { mario, pilot } = await pair(port, '3467');
    pilot.send({
      t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['1,2'], cx: '9', cy: 1, r: 2 },
    });
    const got = await mario.next((m) => m.t === MSG.DAMAGE);
    assert.deepEqual(got.keys, ['1,2']);
    assert.equal(got.cx, undefined);
    await mario.close();
    await pilot.close();
  });

  await t.test('a death event survives the pilot disconnecting and arrives on reconnect', async () => {
    // What decision D4's end-to-end acks bought. Mario announces a death into
    // an empty seat; the pilot comes back into the SAME seat with his token and
    // the event is still owed to him.
    const { mario, pilot, pilotWelcome } = await pair(port, '9ACD');
    await pilot.close();
    mario.send({ t: MSG.EV, seq: 1, type: 'marioDeath', d: { lives: 1 } });
    // Nobody is listening. A real Session keeps it in the outbox and resends on
    // the next pump once the peer is back; a FakeClient has no pump, so the
    // resend is done by hand here.
    const again = new FakeClient(port);
    const back = await again.hello('9ACD', undefined, pilotWelcome.token);
    assert.equal(back.side, 'pilot', 'the token must return to the same seat');
    assert.equal(back.reconnected, true);
    mario.send({ t: MSG.EV, seq: 1, type: 'marioDeath', d: { lives: 1 } });
    const got = await again.next((m) => m.t === MSG.EV && m.type === 'marioDeath');
    assert.equal(got.d.lives, 1);
    await again.close();
    await mario.close();
  });

  await t.test('both sides reach the same verdict from the same events', async () => {
    // The end of a match, end to end: each side announces what it owns, each
    // side runs the SAME reducer over its own events and the peer's, and the
    // two agree — even though they see the two facts in opposite orders.
    const { mario, pilot } = await pair(port, 'DEFG');
    const marioVerdict = new MatchVerdict();
    const pilotVerdict = new MatchVerdict();

    // Mario's client owns the life counter and announces his own last death.
    applyWire(marioVerdict, 'marioDeath', { lives: 0 });
    mario.send({ t: MSG.EV, seq: 1, type: 'marioDeath', d: { island: '1-1', lives: 0 } });
    // The pilot's client owns the squadron and announces his own last plane.
    applyWire(pilotVerdict, 'planeLost', { reason: 'sea', squadron: 0 });
    pilot.send({ t: MSG.EV, seq: 1, type: 'planeLost', d: { reason: 'sea', squadron: 0 } });

    // Each side sees its own news first and the peer's second — opposite
    // orders, by construction.
    assert.equal(marioVerdict.winner(), 'pilot');
    assert.equal(pilotVerdict.winner(), 'mario');

    const gotByPilot = await pilot.next((m) => m.t === MSG.EV && m.type === 'marioDeath');
    const gotByMario = await mario.next((m) => m.t === MSG.EV && m.type === 'planeLost');
    applyWire(pilotVerdict, gotByPilot.type, gotByPilot.d);
    applyWire(marioVerdict, gotByMario.type, gotByMario.d);

    assert.equal(marioVerdict.winner(), pilotVerdict.winner());
    assert.equal(marioVerdict.winner(), 'mario', 'mario takes the tie (spec 3.4)');
    assert.deepEqual(marioVerdict.facts(), pilotVerdict.facts());
    await mario.close();
    await pilot.close();
  });
});
