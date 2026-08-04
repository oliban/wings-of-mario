import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, Rooms, ROOM_IDLE_MS, HASH_GRACE_MS } from '../../src/net/room.js';
import { hashKeys } from '../../src/wings/damage.js';
import { isRoomCode } from '../../src/net/protocol.js';

// THESE TESTS ARE ABOUT HASHING, NOT ABOUT LEVELS. Each one hashes a key list
// it wrote itself and compares it against what the room stored — so the two
// must be the same list. recordDetonate() drops keys inside a spawn sanctuary
// (src/wings/sanctuary.js), which makes the stored list shorter than the one
// the test hashed, for a reason that has nothing to do with hashing.
//
// That is not hypothetical: an upstream level regeneration moved 1-2's spawn
// from {x:2,y:12} to {x:2.5,y:2}, and because a sanctuary runs from the spawn
// down to the map floor, the strip grew from rows 11-14 to rows 1-14 and
// swallowed '1,1' — which these tests had been naming since they were written.
// The hash was never wrong; the coordinates drifted underneath it.
//
// So detonate through this helper. It asserts the room stored the whole list,
// which turns the next such drift into a failure that says "sanctuary" instead
// of an unreadable hash diff. Tests that mean to exercise filtering call
// recordDetonate directly.
function detonate(room, island, keys, t) {
  const out = room.recordDetonate('pilot', island, keys, t);
  assert.deepEqual(out.keys, keys,
    `${island} ${JSON.stringify(keys)}: the room dropped a key. These tiles are `
    + 'inside a spawn sanctuary now — pick tiles further from the spawn column.');
  return out;
}

test('the first player picks a side and the second gets the other', () => {
  const r = new Room('ACDE', { seed: 7 });
  const a = r.join({ side: 'pilot' });
  assert.equal(a.ok, true);
  assert.equal(a.side, 'pilot');
  const b = r.join({});
  assert.equal(b.ok, true);
  assert.equal(b.side, 'mario');
});

test('a first player who picks nothing gets mario, and the pilot follows', () => {
  const r = new Room('ACDE', { seed: 7 });
  assert.equal(r.join({}).side, 'mario');
  assert.equal(r.join({}).side, 'pilot');
});

test('a third player is refused', () => {
  const r = new Room('ACDE', { seed: 7 });
  r.join({});
  r.join({});
  const c = r.join({});
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'room full');
});

test('asking for a taken side is refused rather than silently reassigned', () => {
  // Silently handing them the other side is worse: they came to fly.
  const r = new Room('ACDE', { seed: 7 });
  r.join({ side: 'pilot' });
  const b = r.join({ side: 'pilot' });
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'side taken');
});

test('a token reconnects into the same seat, damage and all', () => {
  const r = new Room('ACDE', { seed: 7 });
  const a = r.join({ side: 'pilot' });
  detonate(r, '1-1', ['5,10', '6,10']);
  assert.equal(r.leave(a.token), true);
  assert.equal(r.present('pilot'), false);

  const back = r.join({ token: a.token });
  assert.equal(back.ok, true);
  assert.equal(back.side, 'pilot');
  assert.equal(back.reconnected, true);
  assert.equal(back.token, a.token, 'the token must survive the round trip');
  assert.deepEqual(r.matchState().damage['1-1'], ['5,10', '6,10']);
});

test('a reconnect returns the same seed, so the archipelago does not change under them', () => {
  const r = new Room('ACDE', { seed: 7 });
  const a = r.join({ side: 'mario' });
  const before = r.matchState().seed;
  r.leave(a.token);
  r.join({ token: a.token });
  assert.equal(r.matchState().seed, before);
  assert.equal(before, 7);
});

test('a stale token from another room is refused, not honoured', () => {
  const r = new Room('ACDE', { seed: 7 });
  const s = r.join({ side: 'mario' });
  const other = new Room('FGHJ', { seed: 7 });
  const bad = other.join({ token: s.token });
  // Unknown token means "treat me as new", and the seat is free, so this
  // succeeds — but as a FRESH seat, not a reconnect.
  assert.equal(bad.ok, true);
  assert.equal(bad.reconnected, false);
  assert.notEqual(bad.token, s.token);
});

test('the seat is held while the peer is away, not handed to a stranger', () => {
  const r = new Room('ACDE', { seed: 7 });
  const a = r.join({ side: 'pilot' });
  r.leave(a.token);
  const stranger = r.join({ side: 'pilot' });
  assert.equal(stranger.ok, false);
  assert.equal(stranger.reason, 'side taken');
});

test('seatFor finds a live seat by token and nothing else', () => {
  const r = new Room('ACDE', { seed: 7 });
  const a = r.join({ side: 'pilot' });
  assert.equal(r.seatFor(a.token).side, 'pilot');
  assert.equal(r.seatFor(a.token).present, true);
  assert.equal(r.seatFor('nope'), null);
  assert.equal(r.seatFor(undefined), null);
  r.leave(a.token);
  assert.equal(r.seatFor(a.token).present, false, 'an absent seat is still a seat');
});

test('leaving with a token nobody holds changes nothing', () => {
  const r = new Room('ACDE', { seed: 7 });
  const a = r.join({ side: 'pilot' });
  assert.equal(r.leave('not-a-token'), false);
  assert.equal(r.present('pilot'), true);
  assert.equal(r.leave(a.token), true);
});

test('detonate is recorded and deduplicated by the SERVER, not the client', () => {
  // Decision D2: DamageMap.add() is the only authority on what is in the set.
  const r = new Room('ACDE', { seed: 7 });
  r.join({ side: 'pilot' });
  const first = detonate(r, '1-1', ['5,10', '6,10']);
  assert.deepEqual(first.added.sort(), ['5,10', '6,10']);
  const second = r.recordDetonate('pilot', '1-1', ['6,10', '7,10']);
  assert.deepEqual(second.added, ['7,10'], 'only genuinely new keys are broadcast');
  const third = r.recordDetonate('pilot', '1-1', ['6,10']);
  assert.deepEqual(third.added, [], 'a repeat adds nothing and is still ok');
  assert.equal(third.ok, true);
});

test('malformed tile keys are dropped before they reach the damage map', () => {
  const r = new Room('ACDE', { seed: 7 });
  r.join({ side: 'pilot' });
  const out = r.recordDetonate('pilot', '1-1', ['5,10', '', 'x,y', '1e3,4', 42, null, '6,10']);
  assert.deepEqual(out.added.sort(), ['5,10', '6,10']);
  assert.deepEqual(r.matchState().damage['1-1'], ['5,10', '6,10']);
});

test('a detonate with a bad island or bad keys is refused, not half-applied', () => {
  const r = new Room('ACDE', { seed: 7 });
  assert.equal(r.recordDetonate('pilot', '', ['5,10']).reason, 'bad island');
  assert.equal(r.recordDetonate('pilot', 7, ['5,10']).reason, 'bad island');
  assert.equal(r.recordDetonate('pilot', '1-1', '5,10').reason, 'bad keys');
  assert.deepEqual(r.matchState().damage, {});
});

test('mario may not detonate terrain', () => {
  const r = new Room('ACDE', { seed: 7 });
  const out = r.recordDetonate('mario', '1-1', ['5,10']);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'not the owner of detonate');
  assert.deepEqual(r.matchState().damage, {}, 'a refused detonate must record nothing');
});

test('event ownership is enforced in both directions', () => {
  const r = new Room('ACDE', { seed: 7 });
  assert.equal(r.mayEmit('pilot', 'detonate'), true);
  assert.equal(r.mayEmit('mario', 'detonate'), false);
  assert.equal(r.mayEmit('mario', 'marioDeath'), true);
  assert.equal(r.mayEmit('pilot', 'marioDeath'), false);
  assert.equal(r.mayEmit('pilot', 'nonsense'), false);
});

test('mayEmit cannot be talked into yes by a prototype key', () => {
  const r = new Room('ACDE', { seed: 7 });
  assert.equal(r.mayEmit('pilot', 'toString'), false);
  assert.equal(r.mayEmit('pilot', 'constructor'), false);
  assert.equal(r.mayEmit(undefined, undefined), false);
});

test('hash comparison names every island that disagrees and nothing else', () => {
  const r = new Room('ACDE', { seed: 7 });
  r.join({ side: 'pilot' });
  detonate(r, '1-1', ['5,10', '6,10']);
  detonate(r, '1-2', ['40,9']);

  const agreeing = { '1-1': hashKeys(['6,10', '5,10']), '1-2': hashKeys(['40,9']) };
  assert.deepEqual(r.compareHashes(agreeing), [], 'order must not matter');

  const wrong = { '1-1': hashKeys(['5,10']), '1-2': hashKeys(['40,9']) };
  const bad = r.compareHashes(wrong);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].island, '1-1');
  assert.equal(bad[0].server, hashKeys(['5,10', '6,10']));
});

test('an island the client has never touched must still match the empty hash', () => {
  const r = new Room('ACDE', { seed: 7 });
  assert.deepEqual(r.compareHashes({ '3-4': hashKeys([]) }), []);
  assert.equal(r.compareHashes({ '3-4': 'ffffffff' }).length, 1);
});

// THE FALSE POSITIVE THIS DETECTOR LIVES OR DIES BY. A client's replica is
// written by the server's own DAMAGE broadcast, so between the tick the server
// records a crater and the tick that broadcast lands, the client is legitimately
// one state behind — and it hashes once a second regardless. Accusing it then
// would fire the alarm on every bombing run, and an alarm that cries wolf is
// worse than no alarm at all. So the room remembers the states it has recently
// been in, and a client sitting in one of them is simply behind, not diverged.
test('a client one broadcast behind the server is not accused of a desync', () => {
  const r = new Room('ACDE', { seed: 7 });
  r.join({ side: 'pilot' });
  detonate(r, '1-1', ['5,10'], 1000);
  // Hashed before the crater reached it: the client still holds the empty set.
  assert.deepEqual(r.compareHashes({ '1-1': hashKeys([]) }, 1100), []);
  detonate(r, '1-1', ['6,10'], 1200);
  assert.deepEqual(r.compareHashes({ '1-1': hashKeys(['5,10']) }, 1300), [],
    'one crater behind, mid-run, is the normal case and must be silent');
  assert.deepEqual(r.compareHashes({ '1-1': hashKeys(['5,10', '6,10']) }, 1300), []);
});

test('a state the server has never been in is caught even mid-bombing-run', () => {
  const r = new Room('ACDE', { seed: 7 });
  r.join({ side: 'pilot' });
  detonate(r, '1-1', ['5,10'], 1000);
  const bad = r.compareHashes({ '1-1': hashKeys(['9,9']) }, 1050);
  assert.equal(bad.length, 1, 'lag is an excuse for being behind, not for being wrong');
  assert.equal(bad[0].island, '1-1');
});

test('a replica that is still behind long after the wire went quiet IS a desync', () => {
  const r = new Room('ACDE', { seed: 7 });
  r.join({ side: 'pilot' });
  detonate(r, '1-1', ['5,10'], 1000);
  const late = 1000 + HASH_GRACE_MS + 1;
  const bad = r.compareHashes({ '1-1': hashKeys([]) }, late);
  assert.equal(bad.length, 1, 'a crater that never arrived is exactly what this detects');
  assert.equal(bad[0].server, hashKeys(['5,10']));
  assert.equal(bad[0].client, hashKeys([]));
});

test('with no clock at all the grace window is not applied', () => {
  // room.js never asks what time it is; `now` is always handed in. A caller
  // that hands in nothing gets the strict comparison, which is what every
  // in-process test wants and what the server never does.
  const r = new Room('ACDE', { seed: 7 });
  r.join({ side: 'pilot' });
  detonate(r, '1-1', ['5,10'], 1000);
  assert.equal(r.compareHashes({ '1-1': hashKeys([]) }).length, 1);
});

test('an island the server has damaged that the client never mentions is caught', () => {
  const r = new Room('ACDE', { seed: 7 });
  r.join({ side: 'pilot' });
  detonate(r, '1-2', ['40,9'], 1000);
  const late = 1000 + HASH_GRACE_MS + 1;
  // Silence about an island is a claim of an empty set, not an abstention: a
  // client that lost the whole island would otherwise never be caught.
  const bad = r.compareHashes({ '1-1': hashKeys([]) }, late);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].island, '1-2');
  assert.equal(bad[0].client, null, 'null says it never mentioned the island at all');
  // ...but not while the broadcast that would tell it could still be in flight.
  assert.deepEqual(r.compareHashes({ '1-1': hashKeys([]) }, 1100), []);
});

test('an island nobody has damaged is never reported against a silent client', () => {
  const r = new Room('ACDE', { seed: 7 });
  r.join({ side: 'pilot' });
  // Every filtered-out key: the island exists in the map with an empty set.
  r.recordDetonate('pilot', '4-2', ['not a key'], 1000);
  assert.deepEqual(r.compareHashes({}, 1000 + HASH_GRACE_MS + 1), [],
    'a client that has never heard of an undamaged island agrees about it');
});

test('the state history cannot grow without bound', () => {
  const r = new Room('ACDE', { seed: 7 });
  r.join({ side: 'pilot' });
  for (let i = 0; i < 5000; i++) r.recordDetonate('pilot', '1-1', [`${i},1`], 1000 + i);
  const held = r.hashHistory.get('1-1').length;
  assert.ok(held > 0 && held <= 64, `history should stay bounded, held ${held}`);
});

test('compareHashes survives junk instead of a hash map', () => {
  const r = new Room('ACDE', { seed: 7 });
  assert.deepEqual(r.compareHashes(null), []);
  assert.deepEqual(r.compareHashes('nope'), []);
  assert.deepEqual(r.compareHashes(undefined), []);
});

test('matchState carries the whole match, which is what a reconnect is restored from', () => {
  const r = new Room('ACDE', { seed: 7 });
  const a = r.join({ side: 'pilot' });
  r.join({ side: 'mario' });
  detonate(r, '1-1', ['5,10']);
  r.leave(a.token);

  const st = r.matchState();
  assert.equal(st.seed, 7);
  assert.deepEqual(st.damage['1-1'], ['5,10']);
  assert.deepEqual(st.sides.sort(), ['mario', 'pilot'], 'a held seat is still a side in the match');
});

test('a room reports how long it has been idle and when it is empty', () => {
  const r = new Room('ACDE', { seed: 7, now: 1000 });
  const a = r.join({ side: 'mario' }, 1000);
  assert.equal(r.empty(), false);
  assert.equal(r.idleFor(5000), 0, 'a room with somebody in it is never idle');
  r.leave(a.token, 2000);
  assert.equal(r.empty(), true);
  assert.equal(r.idleFor(5000), 3000);
});

test('the registry mints legal, unique codes and reaps idle rooms', () => {
  // Injected generator: deterministic, and it collides on purpose the first time.
  const feed = ['ACDE', 'ACDE', 'FGHJ'];
  let i = 0;
  const rooms = new Rooms({ codeGen: () => feed[i++] });
  const a = rooms.create({ now: 0 });
  const b = rooms.create({ now: 0 });
  assert.equal(a.code, 'ACDE');
  assert.equal(b.code, 'FGHJ', 'a collision must be retried, not overwritten');
  assert.ok(isRoomCode(a.code) && isRoomCode(b.code));
  assert.equal(rooms.get('ACDE'), a);
  assert.equal(rooms.get('acde'), a, 'lookup normalizes');
  assert.equal(rooms.get('nope'), null);

  const reaped = rooms.reap(ROOM_IDLE_MS + 1);
  assert.deepEqual(reaped.sort(), ['ACDE', 'FGHJ']);
  assert.equal(rooms.size, 0);
});

test('an occupied room is never reaped', () => {
  const rooms = new Rooms({ codeGen: () => 'ACDE' });
  const r = rooms.create({ now: 0 });
  r.join({ side: 'mario' }, 0);
  assert.deepEqual(rooms.reap(ROOM_IDLE_MS * 10), []);
  assert.equal(rooms.size, 1);
});

test('a room whose players have all left is kept for the idle window, then reaped', () => {
  // This IS the reconnect guarantee: leave, come back inside the window, and
  // the match is still there.
  const rooms = new Rooms({ codeGen: () => 'ACDE' });
  const r = rooms.create({ now: 0 });
  const a = r.join({ side: 'pilot' }, 0);
  detonate(r, '1-1', ['5,10'], 0);
  r.leave(a.token, 0);

  assert.deepEqual(rooms.reap(ROOM_IDLE_MS), [], 'not yet');
  const back = rooms.get('ACDE').join({ token: a.token }, ROOM_IDLE_MS);
  assert.equal(back.reconnected, true);
  assert.deepEqual(rooms.get('ACDE').matchState().damage['1-1'], ['5,10']);

  // Rejoining touched the room, so the window restarts from there.
  assert.deepEqual(rooms.reap(ROOM_IDLE_MS * 2), [], 'still occupied');
  rooms.get('ACDE').leave(back.token, ROOM_IDLE_MS * 2);
  assert.deepEqual(rooms.reap(ROOM_IDLE_MS * 3 + 1), ['ACDE']);
});

test('getOrCreate normalizes, reuses and refuses illegal codes', () => {
  const rooms = new Rooms();
  const r = rooms.getOrCreate('acde', { seed: 7, now: 0 });
  assert.equal(r.code, 'ACDE');
  assert.equal(rooms.getOrCreate('ACDE'), r, 'a second call joins, it does not replace');
  assert.equal(rooms.getOrCreate('OOPS'), null, 'O is not in the alphabet');
  assert.equal(rooms.getOrCreate(''), null);
  assert.equal(rooms.size, 1);
  assert.equal(rooms.drop('acde'), true);
  assert.equal(rooms.drop('acde'), false);
  assert.equal(rooms.size, 0);
});

test('the default code generator produces legal codes', () => {
  const rooms = new Rooms();
  for (let i = 0; i < 50; i++) assert.ok(isRoomCode(rooms.create({ now: 0 }).code));
});

test('randomness enters through one injectable source, so a run can be replayed', () => {
  // The only unseeded values in the room are the code, the seed and the seat
  // tokens. All three come from `rand`, so a test that pins `rand` pins them.
  const mk = () => {
    let i = 0;
    const rand = () => ((i = (i * 1103515245 + 12345) % 2147483648), i / 2147483648);
    return new Rooms({ rand });
  };
  const a = mk().create({ now: 0 });
  const b = mk().create({ now: 0 });
  assert.equal(a.code, b.code);
  assert.equal(a.seed, b.seed);
  assert.equal(a.join({ side: 'pilot' }).token, b.join({ side: 'pilot' }).token);
  assert.ok(isRoomCode(a.code));
  assert.ok(Number.isInteger(a.seed) && a.seed >= 0);
});

test('two seats in the same room never share a token', () => {
  const r = new Room('ACDE', { seed: 7, rand: () => 0.5 });
  const a = r.join({ side: 'mario' });
  const b = r.join({ side: 'pilot' });
  assert.notEqual(a.token, b.token, 'even with a constant random source');
});
