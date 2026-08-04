import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOCOL_VERSION, SIDES, OTHER_SIDE, MSG, EVENT_OWNER, RELIABLE_TYPES,
  ROOM_CODE_LEN, isRoomCode, normalizeRoomCode,
  encode, decode, validate,
  SNAPSHOT_INTERVAL_TICKS, HASH_INTERVAL_TICKS, MAX_MESSAGE_BYTES,
} from '../../src/net/protocol.js';

test('there are exactly two sides and they are each other', () => {
  assert.deepEqual(SIDES, ['mario', 'pilot']);
  assert.equal(OTHER_SIDE.mario, 'pilot');
  assert.equal(OTHER_SIDE.pilot, 'mario');
});

test('every reliable event has exactly one owner', () => {
  const expected = [
    'bombRelease', 'detonate', 'marioDeath', 'islandCleared', 'ferryBoard',
    'ferrySunk', 'sortieStart', 'landed', 'planeLost', 'worldCleared',
  ];
  assert.deepEqual(Object.keys(EVENT_OWNER).sort(), [...expected].sort());
  for (const type of expected) {
    assert.ok(SIDES.includes(EVENT_OWNER[type]), `${type} has no legal owner`);
    assert.ok(RELIABLE_TYPES.has(type), `${type} is not in RELIABLE_TYPES`);
  }
  // The three that decide the match belong to the side that can see them.
  assert.equal(EVENT_OWNER.detonate, 'pilot');
  assert.equal(EVENT_OWNER.marioDeath, 'mario');
  assert.equal(EVENT_OWNER.planeLost, 'pilot');
});

test('room codes are four characters from an unambiguous alphabet', () => {
  assert.equal(ROOM_CODE_LEN, 4);
  assert.ok(isRoomCode('ACDE'));
  assert.ok(!isRoomCode('ACD'), 'too short');
  assert.ok(!isRoomCode('ACDEF'), 'too long');
  assert.ok(!isRoomCode('AC0E'), 'zero is confusable with O and must not be in the alphabet');
  assert.ok(!isRoomCode('AC1E'), 'one is confusable with I and must not be in the alphabet');
  assert.ok(!isRoomCode(''), 'empty');
  assert.ok(!isRoomCode(null), 'non-string');
});

test('normalizeRoomCode is forgiving about case and whitespace and nothing else', () => {
  assert.equal(normalizeRoomCode(' acde '), 'ACDE');
  assert.equal(normalizeRoomCode('AcDe'), 'ACDE');
  assert.equal(normalizeRoomCode('AC-DE'), null);
  assert.equal(normalizeRoomCode('ABC'), null);
  assert.equal(normalizeRoomCode(undefined), null);
});

test('encode/decode round-trips a snapshot', () => {
  const msg = { t: MSG.SNAP, side: 'mario', tick: 120, s: { x: 1.5, y: 2.5 } };
  const back = decode(encode(msg));
  assert.equal(back.ok, true);
  assert.deepEqual(back.msg, msg);
});

test('decode refuses anything that is not a legal message', () => {
  assert.equal(decode('not json').ok, false);
  assert.equal(decode('[]').ok, false, 'an array is not a message');
  assert.equal(decode('null').ok, false);
  assert.equal(decode('42').ok, false);
  assert.equal(decode(JSON.stringify({ t: 'nonsense' })).ok, false);
  assert.equal(decode(Buffer.alloc(0)).ok, false, 'non-string input');
  const huge = JSON.stringify({ t: MSG.SNAP, side: 'mario', tick: 1, s: { pad: 'x'.repeat(MAX_MESSAGE_BYTES) } });
  assert.equal(decode(huge).ok, false, 'oversized payloads must be refused, not parsed');
});

test('hello must name a room and may name a side', () => {
  assert.equal(validate({ t: MSG.HELLO, v: PROTOCOL_VERSION, room: 'ACDE' }), null);
  assert.equal(validate({ t: MSG.HELLO, v: PROTOCOL_VERSION, room: 'ACDE', side: 'pilot' }), null);
  assert.ok(validate({ t: MSG.HELLO, v: PROTOCOL_VERSION, room: 'zz' }));
  assert.ok(validate({ t: MSG.HELLO, v: PROTOCOL_VERSION, room: 'ACDE', side: 'bowser' }));
  assert.ok(validate({ t: MSG.HELLO, v: PROTOCOL_VERSION + 1, room: 'ACDE' }), 'version mismatch is a reason');
});

test('an event must carry a sequence number and a known type', () => {
  assert.equal(validate({ t: MSG.EV, seq: 1, type: 'detonate', d: {} }), null);
  assert.ok(validate({ t: MSG.EV, type: 'detonate', d: {} }), 'missing seq');
  assert.ok(validate({ t: MSG.EV, seq: 0.5, type: 'detonate', d: {} }), 'seq must be an integer');
  assert.ok(validate({ t: MSG.EV, seq: 1, type: 'nope', d: {} }), 'unknown event type');
  assert.ok(validate({ t: MSG.EV, seq: 1, type: 'detonate' }), 'missing payload');
});

test('a hash frame is a plain object of island to hash', () => {
  assert.equal(validate({ t: MSG.HASH, tick: 60, h: { '1-1': 'deadbeef' } }), null);
  assert.equal(validate({ t: MSG.HASH, tick: 60, h: {} }), null, 'an empty archipelago is legal');
  assert.ok(validate({ t: MSG.HASH, tick: 60, h: [] }), 'an array is not a hash map');
  assert.ok(validate({ t: MSG.HASH, h: {} }), 'missing tick');
});

test('a snapshot is never rejected for its contents, only for its shape', () => {
  // Spec 7.1: you are the truth about yourself. Physically absurd values are
  // still legal messages — this is a game friends play together, not a
  // tournament, and validating gameplay here would be validating it twice.
  assert.equal(validate({ t: MSG.SNAP, side: 'pilot', tick: 3, s: { x: -1e9, fuel: 999 } }), null);
  assert.ok(validate({ t: MSG.SNAP, side: 'pilot', tick: 3 }), 'shape still matters');
  assert.ok(validate({ t: MSG.SNAP, side: 'nobody', tick: 3, s: {} }));
});

test('the cadences are the ones the spec asks for', () => {
  // 60.0988Hz fixed step; 20Hz snapshots is every third tick; hashes once a second.
  assert.equal(SNAPSHOT_INTERVAL_TICKS, 3);
  assert.equal(HASH_INTERVAL_TICKS, 60);
});
