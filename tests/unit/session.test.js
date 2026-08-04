import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../../src/net/session.js';
import {
  MSG, PROTOCOL_VERSION, encode, decode,
  SNAPSHOT_INTERVAL_TICKS, RESEND_INTERVAL_TICKS,
} from '../../src/net/protocol.js';

// A transport that goes nowhere: everything sent lands in an array, and
// `deliver` pushes a message back up as if the server had sent it.
class StubTransport {
  constructor() {
    this.sent = [];
    this.raw = [];
    this.connects = 0;
    this.closed = 0;
    this._msg = null;
    this._open = null;
    this._close = null;
  }
  onMessage(cb) { this._msg = cb; }
  onOpen(cb) { this._open = cb; }
  onClose(cb) { this._close = cb; }
  async connect() { this.connects++; if (this._open) this._open(); }
  send(text) { this.raw.push(text); this.sent.push(decode(text).msg); return true; }
  close() { this.closed++; }
  deliver(msg) { this._msg(encode(msg)); }
  deliverRaw(text) { this._msg(text); }
  drop() { if (this._close) this._close(); }
  stats() { return { sent: this.sent.length, received: 0, dropped: 0, delayed: 0 }; }
  lastOf(t) { return [...this.sent].reverse().find((m) => m.t === t) || null; }
  countOf(t) { return this.sent.filter((m) => m.t === t).length; }
}

// `Session.connect()` awaits the transport's own connect before it can send a
// hello, so the hello lands a few microtasks after the call. Tests that inspect
// the wire without awaiting the welcome have to let those microtasks run.
const settle = () => new Promise((r) => setTimeout(r, 0));

function makeSession(over = {}) {
  const transport = new StubTransport();
  const s = new Session({ transport, room: 'ACDE', side: 'pilot', ...over });
  return { s, transport };
}

test('connect sends hello and resolves on welcome', async () => {
  const { s, transport } = makeSession();
  const p = s.connect();
  await settle();
  const hello = transport.lastOf(MSG.HELLO);
  assert.equal(hello.room, 'ACDE');
  assert.equal(hello.side, 'pilot');
  assert.equal(hello.v, PROTOCOL_VERSION);
  transport.deliver({
    t: MSG.WELCOME, v: PROTOCOL_VERSION, room: 'ACDE', side: 'pilot',
    token: 'tok', seed: 99, damage: { '1-1': ['5,10'] }, peer: false,
  });
  const w = await p;
  assert.equal(w.seed, 99);
  assert.equal(s.token, 'tok', 'the token is kept for reconnecting');
  assert.equal(s.side, 'pilot');
  assert.equal(s.seed, 99);
  assert.deepEqual(s.damage['1-1'], ['5,10'], 'the match state arrives with the welcome');
});

test('connect rejects on error', async () => {
  const { s, transport } = makeSession();
  const p = s.connect();
  await settle();
  transport.deliver({ t: MSG.ERROR, reason: 'room full' });
  await assert.rejects(p, /room full/);
});

test('a reconnect sends the token it was given', async () => {
  const { s, transport } = makeSession({ token: 'old-token' });
  s.connect();
  await settle();
  assert.equal(transport.lastOf(MSG.HELLO).token, 'old-token');
});

async function connected(over) {
  const { s, transport } = makeSession(over);
  const p = s.connect();
  await settle();
  transport.deliver({
    t: MSG.WELCOME, v: PROTOCOL_VERSION, room: 'ACDE', side: 'pilot',
    token: 'tok', seed: 1, damage: {}, peer: true,
  });
  await p;
  transport.sent.length = 0;
  return { s, transport };
}

test('snapshots go out at 20Hz, not 60', async () => {
  const { s, transport } = await connected();
  for (let tick = 0; tick < 30; tick++) s.sendSnapshot(tick, { x: tick });
  assert.equal(transport.countOf(MSG.SNAP), 30 / SNAPSHOT_INTERVAL_TICKS);
  const last = transport.lastOf(MSG.SNAP);
  assert.equal(last.tick, 27);
  assert.equal(last.s.x, 27, 'the snapshot must carry the CURRENT state, not a stale one');
});

test('a snapshot is never queued for resend', async () => {
  const { s, transport } = await connected();
  s.sendSnapshot(0, { x: 1 });
  assert.equal(s.pending(), 0, 'snapshots are unreliable by design');
  for (let t = 1; t <= RESEND_INTERVAL_TICKS * 5; t++) s.pump(t);
  assert.equal(transport.countOf(MSG.SNAP), 1, 'a late snapshot is worthless, so it is never resent');
});

test('events get consecutive sequence numbers starting at 1', async () => {
  const { s, transport } = await connected();
  assert.equal(s.sendEvent('detonate', { island: '1-1', keys: [] }), 1);
  assert.equal(s.sendEvent('landed', {}), 2);
  assert.deepEqual(transport.sent.filter((m) => m.t === MSG.EV).map((m) => m.seq), [1, 2]);
});

test('an unacked event is resent, and a peer-acked one is not', async () => {
  const { s, transport } = await connected();
  s.sendEvent('landed', {});
  assert.equal(s.pending(), 1);
  for (let t = 1; t <= RESEND_INTERVAL_TICKS; t++) s.pump(t);
  assert.equal(transport.countOf(MSG.EV), 2, 'should have gone out once more');

  transport.deliver({ t: MSG.ACK, seq: 1, peer: true });
  assert.equal(s.pending(), 0);
  for (let t = 1; t <= RESEND_INTERVAL_TICKS * 3; t++) s.pump(t);
  assert.equal(transport.countOf(MSG.EV), 2, 'an acked event must never go out again');
});

test("the server's own ack is not the peer's, and does not stop the resend", async () => {
  // The server acks an EV the moment it relays it. That says the message
  // reached the server, not that it reached the other player — and clearing
  // the outbox on it would lose the event outright if the peer were in a
  // tunnel at that instant. Only `peer: true` means it landed where it was
  // aimed.
  const { s, transport } = await connected();
  s.sendEvent('landed', {});
  transport.deliver({ t: MSG.ACK, seq: 1 });
  assert.equal(s.pending(), 1, 'still in flight as far as the peer is concerned');
  for (let t = 1; t <= RESEND_INTERVAL_TICKS; t++) s.pump(t);
  assert.equal(transport.countOf(MSG.EV), 2, 'so it goes out again');

  transport.deliver({ t: MSG.ACK, seq: 1, peer: true });
  assert.equal(s.pending(), 0);
});

test('an event is not shouted into an empty room, and flushes when the peer arrives', async () => {
  const { s, transport } = await connected({ });
  transport.deliver({ t: MSG.PEER, side: 'mario', present: false });
  s.sendEvent('sortieStart', {});
  transport.deliver({ t: MSG.ACK, seq: 1 });
  for (let t = 1; t <= RESEND_INTERVAL_TICKS * 4; t++) s.pump(t);
  assert.equal(transport.countOf(MSG.EV), 1, 'the server has it; there is nobody to relay it to');
  assert.equal(s.pending(), 1, 'and it is still owed to whoever takes that seat');

  transport.deliver({ t: MSG.PEER, side: 'mario', present: true });
  s.pump(100);
  assert.equal(transport.countOf(MSG.EV), 2, 'the other seat filled, so out it goes at once');
});

test('a detonate is settled by the authoritative damage, not by an ack', async () => {
  // The server consumes a detonate rather than relaying it, so the peer never
  // sees an EV to ack. The DAMAGE broadcast carrying our seq is the only
  // possible terminator.
  const { s, transport } = await connected();
  const seq = s.sendEvent('detonate', { island: '1-1', keys: ['5,10'] });
  assert.equal(s.pending(), 1);
  transport.deliver({ t: MSG.DAMAGE, island: '1-1', keys: ['5,10'], seq });
  assert.equal(s.pending(), 0, 'the craters are recorded; the proposal is done');
  for (let t = 1; t <= RESEND_INTERVAL_TICKS * 3; t++) s.pump(t);
  assert.equal(transport.countOf(MSG.EV), 1, 'and it must never be proposed twice');
});

test('a resent event keeps its sequence number', async () => {
  const { s, transport } = await connected();
  s.sendEvent('planeLost', { reason: 'sea' });
  for (let t = 1; t <= RESEND_INTERVAL_TICKS * 2; t++) s.pump(t);
  const seqs = new Set(transport.sent.filter((m) => m.t === MSG.EV).map((m) => m.seq));
  assert.deepEqual([...seqs], [1], 'a resend is the same event, not a new one');
});

test('a duplicated inbound event is delivered exactly once', async () => {
  const { s, transport } = await connected();
  const seen = [];
  s.on('event', (e) => seen.push(e));
  const ev = { t: MSG.EV, seq: 7, type: 'marioDeath', d: { lives: 2 } };
  transport.deliver(ev);
  transport.deliver(ev);
  transport.deliver(ev);
  assert.equal(seen.length, 1, 'the peer resent it; we must not act on it three times');
  assert.equal(seen[0].type, 'marioDeath');
  assert.equal(transport.countOf(MSG.ACK), 3, 'every copy is acked, or the peer resends forever');
  assert.equal(transport.lastOf(MSG.ACK).peer, true, 'and it says so, so the peer can tell it apart');
});

test('out-of-order inbound events are all delivered', async () => {
  // Reliability is exactly-once, NOT in-order: the events are independent and
  // holding event 3 hostage to event 2 would stall the match on one lost frame.
  const { s, transport } = await connected();
  const seen = [];
  s.on('event', (e) => seen.push(e.type));
  transport.deliver({ t: MSG.EV, seq: 3, type: 'landed', d: {} });
  transport.deliver({ t: MSG.EV, seq: 2, type: 'sortieStart', d: {} });
  assert.deepEqual(seen, ['landed', 'sortieStart']);
});

test('damage, peer and desync are routed to their own listeners', async () => {
  const { s, transport } = await connected();
  const got = { damage: [], peer: [], desync: [] };
  s.on('damage', (m) => got.damage.push(m));
  s.on('peer', (m) => got.peer.push(m));
  s.on('desync', (m) => got.desync.push(m));
  transport.deliver({ t: MSG.DAMAGE, island: '1-1', keys: ['5,10'] });
  transport.deliver({ t: MSG.PEER, side: 'mario', present: true });
  transport.deliver({ t: MSG.DESYNC, island: '1-1', server: 'aaaa', client: 'bbbb' });
  assert.deepEqual(got.damage[0].keys, ['5,10']);
  assert.equal(got.peer[0].present, true);
  assert.equal(s.peerPresent, true);
  assert.equal(got.desync[0].island, '1-1');
});

test('an inbound snapshot reaches the snapshot listener untouched', async () => {
  const { s, transport } = await connected();
  const seen = [];
  s.on('snapshot', (m) => seen.push(m));
  transport.deliver({ t: MSG.SNAP, side: 'mario', tick: 9, s: { x: 5, anim: 'run' } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tick, 9);
  assert.equal(seen[0].s.anim, 'run');
});

test('a malformed frame is reported and the session survives it', async () => {
  const { s, transport } = await connected();
  const errors = [];
  const snaps = [];
  s.on('error', (e) => errors.push(e.reason));
  s.on('snapshot', (m) => snaps.push(m));
  transport.deliverRaw('{not json');
  transport.deliverRaw(encode({ t: 'nonsense' }));
  assert.equal(errors.length, 2);
  assert.match(errors[0], /bad json/);
  assert.equal(s.connected, true, 'a junk frame must not tear the session down');
  transport.deliver({ t: MSG.SNAP, side: 'mario', tick: 1, s: { x: 0 } });
  assert.equal(snaps.length, 1, 'and the next good frame still arrives');
});

test('hashes go out with the tick they describe', async () => {
  const { s, transport } = await connected();
  s.sendHash(60, { '1-1': 'abcd' });
  const h = transport.lastOf(MSG.HASH);
  assert.equal(h.tick, 60);
  assert.deepEqual(h.h, { '1-1': 'abcd' });
  assert.equal(s.pending(), 0, 'a hash is unreliable too: the next one is a second away');
});

test('sending before connect throws rather than silently dropping', async () => {
  const { s } = makeSession();
  assert.throws(() => s.sendEvent('landed', {}), /not connected/);
});

test('an unknown event type throws at the SENDER', async () => {
  // Catching a typo here is worth an exception; catching it on the server
  // means the round trip already happened and the event is simply gone.
  const { s } = await connected();
  assert.throws(() => s.sendEvent('explode', {}), /unknown event type/);
});

test('a dropped socket leaves the session disconnected but keeps its token', async () => {
  const { s, transport } = await connected();
  const closes = [];
  s.on('close', (m) => closes.push(m));
  transport.drop();
  assert.equal(s.connected, false);
  assert.equal(closes.length, 1);
  assert.equal(s.token, 'tok', 'the token is what gets us back into this same match');
  assert.equal(s.pump(1), 0, 'a disconnected session resends nothing into the void');
});

test('reconnecting resends the events the old connection never got acked', async () => {
  const { s, transport } = await connected();
  s.sendEvent('landed', {});
  transport.drop();
  assert.equal(s.pending(), 1, 'an unacked event survives the disconnect');

  const p = s.connect();
  await settle();
  assert.equal(transport.lastOf(MSG.HELLO).token, 'tok', 'the same seat, not a new one');
  transport.deliver({
    t: MSG.WELCOME, v: PROTOCOL_VERSION, room: 'ACDE', side: 'pilot',
    token: 'tok', seed: 1, damage: { '1-1': ['5,10'] }, peer: true, reconnected: true,
  });
  const w = await p;
  assert.equal(w.reconnected, true);
  assert.deepEqual(s.damage['1-1'], ['5,10'], 'the match state comes back with us');

  transport.sent.length = 0;
  s.pump(1);
  assert.equal(transport.countOf(MSG.EV), 1, 'the pending event flushes at once, not 12 ticks later');
  assert.equal(transport.lastOf(MSG.EV).seq, 1, 'and keeps its seq across the reconnect');
});

test('sequence numbers keep counting across a reconnect', async () => {
  const { s, transport } = await connected();
  s.sendEvent('landed', {});
  transport.drop();
  const p = s.connect();
  await settle();
  transport.deliver({
    t: MSG.WELCOME, v: PROTOCOL_VERSION, room: 'ACDE', side: 'pilot',
    token: 'tok', seed: 1, damage: {}, peer: true, reconnected: true,
  });
  await p;
  // Restarting at 1 would collide with an event the peer has already seen and
  // deduped, and the second one would be silently swallowed.
  assert.equal(s.sendEvent('planeLost', { reason: 'sea' }), 2);
});

test('hashes go out once a second and are computed only when sent', async () => {
  const { s, transport } = await connected();
  let built = 0;
  const build = () => {
    built++;
    return { '1-1': 'deadbeef' };
  };
  for (let tick = 0; tick < 181; tick++) s.maybeSendHash(tick, build);
  assert.equal(transport.countOf(MSG.HASH), 4, 'ticks 0, 60, 120 and 180');
  assert.equal(built, 4, 'the hash must not be computed on the 177 ticks it is not sent');
  assert.deepEqual(transport.lastOf(MSG.HASH).h, { '1-1': 'deadbeef' });
});

test('a disconnected session neither sends a hash nor builds one', () => {
  const { s } = makeSession();
  let built = 0;
  assert.equal(s.maybeSendHash(60, () => { built++; return {}; }), false);
  assert.equal(built, 0, 'hashing an unsendable set is pure waste');
});
