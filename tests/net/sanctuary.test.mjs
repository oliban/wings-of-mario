// The spawn sanctuary, enforced by the SERVER.
//
// The pilot's client already refuses to crater the tiles around Mario's spawn
// (src/wings/island.js), but a client is not where this can be decided: the
// server is the sole author of the destroyed set (decision D2), and whatever it
// records it broadcasts to BOTH players as fact. A buggy — or hostile — pilot
// that proposes those keys anyway must be refused here, or Mario falls into a
// hole on arrival, respawns into it, and the match is unwinnable with no
// counterplay available to him at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG } from '../../src/net/protocol.js';
import { getLevel } from '../../src/data/levels/index.js';
import { protectedKeys } from '../../src/wings/sanctuary.js';
import { startTestServer, pair, FakeClient } from './helpers.mjs';

const LVL = getLevel('1-1');
const SPAWN_FLOOR = `${LVL.spawn.x},${LVL.spawn.y + 1}`; // the tile under his feet
const SPAWN_TILE = `${LVL.spawn.x},${LVL.spawn.y}`;
const OPEN_GROUND = '100,13';

test('the server refuses to crater a spawn', { timeout: 60000 }, async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { port } = server;

  await t.test('a detonate naming protected keys has them dropped, not the whole crater', async () => {
    const { mario, pilot } = await pair(port, 'HJKM');
    pilot.send({
      t: MSG.EV,
      seq: 1,
      type: 'detonate',
      d: { island: '1-1', keys: [SPAWN_TILE, SPAWN_FLOOR, OPEN_GROUND], cx: 100, cy: 100, r: 2 },
    });
    // BOTH sides are checked: the fact is what the server says, and it says the
    // same thing to the client that proposed it (D2). A filter that only
    // reached the peer would leave the pilot's map one crater ahead forever.
    const toMario = await mario.ofType(MSG.DAMAGE);
    const toPilot = await pilot.ofType(MSG.DAMAGE);
    assert.deepEqual(toMario.keys, [OPEN_GROUND], 'a protected key reached Mario');
    assert.deepEqual(toPilot.keys, [OPEN_GROUND], 'a protected key reached the pilot');
    // The rest of the bomb still landed: this drops keys, it does not reject
    // the detonate, and the pilot is still settled for the seq he sent.
    const ack = await pilot.ofType(MSG.ACK);
    assert.equal(ack.seq, 1);
    await mario.close();
    await pilot.close();
  });

  await t.test('a protected key never enters the damage map, so a reconnect cannot inherit it', async () => {
    const { mario, pilot, marioWelcome } = await pair(port, 'HJKN');
    pilot.send({
      t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: [SPAWN_FLOOR, OPEN_GROUND] },
    });
    await mario.ofType(MSG.DAMAGE);
    await mario.close();

    // Reconnecting into the seat replays the whole match's damage map, which
    // is the copy a client that was away when the bomb fell ends up with.
    const late = new FakeClient(port);
    const welcome = await late.hello('HJKN', 'mario', marioWelcome.token);
    assert.equal(welcome.t, MSG.WELCOME);
    assert.deepEqual(welcome.damage['1-1'], [OPEN_GROUND]);
    await late.close();
    await pilot.close();
  });

  await t.test('a leading-zero alias of a protected key is refused too', async () => {
    // parseTileKey treats '02,13' as the same tile as '2,13', so a string
    // compare against the protected set would be a one-character bypass.
    const { mario, pilot } = await pair(port, 'HJKP');
    const padded = `0${SPAWN_FLOOR}`;
    pilot.send({
      t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: [padded, OPEN_GROUND] },
    });
    const dmg = await mario.ofType(MSG.DAMAGE);
    assert.deepEqual(dmg.keys, [OPEN_GROUND]);
    await mario.close();
    await pilot.close();
  });

  await t.test('a detonate made entirely of protected keys destroys nothing anywhere', async () => {
    const { mario, pilot } = await pair(port, 'HJKQ');
    const all = [...protectedKeys(LVL)].slice(0, 12);
    assert.ok(all.length === 12, 'the sanctuary should be bigger than a dozen tiles');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: all } });
    const dmg = await mario.ofType(MSG.DAMAGE);
    assert.deepEqual(dmg.keys, [], 'the server recorded a crater in the sanctuary');
    // Still acked: the pilot's outbox must settle or he resends this forever.
    const ack = await pilot.ofType(MSG.ACK);
    assert.equal(ack.seq, 1);
    await mario.close();
    await pilot.close();
  });

  await t.test('the same tile coordinates on a level whose spawn is elsewhere still crater', async () => {
    // Proof the server resolves the sanctuary from the ISLAND, not from a
    // constant: 1-1 spawns at column 2 and 4-1 at column 5.
    const { mario, pilot } = await pair(port, 'HJKR');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '4-1', keys: ['2,13'] } });
    const dmg = await mario.ofType(MSG.DAMAGE);
    assert.deepEqual(dmg.keys, ['2,13'], "4-1's column 2 is ordinary ground");
    await mario.close();
    await pilot.close();
  });
});
