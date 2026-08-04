import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS, MatchVerdict, MarioEvents, pilotWireEvent, applyWire, mayEmitFrom,
} from '../../src/net/match-events.js';

// ---------------------------------------------------------------------------
// The verdict. The whole point of this class is that it is CONFLUENT: the same
// set of events reaches the same verdict whatever order it arrives in, because
// the two clients cannot be made to agree on an order.
// ---------------------------------------------------------------------------

test('a fresh verdict is playing and has no winner', () => {
  const v = new MatchVerdict();
  assert.equal(v.status, STATUS.PLAYING);
  assert.equal(v.over, false);
  assert.equal(v.winner(), null);
});

test('mario out of lives is the pilot winning', () => {
  const v = new MatchVerdict();
  v.noteLivesGone();
  assert.equal(v.status, 'pilot-wins');
  assert.equal(v.winner(), 'pilot');
});

test('the squadron destroyed is mario winning', () => {
  const v = new MatchVerdict();
  v.noteSquadronGone();
  assert.equal(v.winner(), 'mario');
});

test('8-4 cleared is mario winning', () => {
  const v = new MatchVerdict();
  v.noteWorldCleared();
  assert.equal(v.winner(), 'mario');
});

test('mario wins the tie, whichever fact arrives first', () => {
  // Spec: a destroyed squadron outranks an empty stock, and this must not
  // depend on which client's news crossed the wire first.
  const a = new MatchVerdict();
  a.noteLivesGone();
  a.noteSquadronGone();
  const b = new MatchVerdict();
  b.noteSquadronGone();
  b.noteLivesGone();
  assert.equal(a.winner(), 'mario');
  assert.equal(b.winner(), 'mario');
});

test('every ordering of every subset of facts agrees', () => {
  // The convergence proof, run rather than argued. Two clients see the same
  // SET of events in different orders; if any permutation disagreed with any
  // other, a match could end on one screen and not the other.
  const facts = ['livesGone', 'squadronGone', 'worldCleared'];
  const perms = (xs) =>
    xs.length <= 1 ? [xs] : xs.flatMap((x, i) =>
      perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
  const subsets = [];
  for (let mask = 0; mask < 8; mask++) {
    subsets.push(facts.filter((_, i) => mask & (1 << i)));
  }
  for (const subset of subsets) {
    const verdicts = perms(subset).map((order) => {
      const v = new MatchVerdict();
      for (const f of order) {
        if (f === 'livesGone') v.noteLivesGone();
        if (f === 'squadronGone') v.noteSquadronGone();
        if (f === 'worldCleared') v.noteWorldCleared();
      }
      return v.status;
    });
    const first = verdicts[0];
    for (const s of verdicts) {
      assert.equal(s, first, `subset ${subset.join('+')} disagreed with itself`);
    }
  }
});

test('a fact repeated changes nothing', () => {
  const v = new MatchVerdict();
  v.noteLivesGone();
  v.noteLivesGone();
  v.noteLivesGone();
  assert.equal(v.winner(), 'pilot');
});

// ---------------------------------------------------------------------------
// The reducer. BOTH clients run this over BOTH their own and the peer's events,
// which is what makes the two verdicts the same object computed twice.
// ---------------------------------------------------------------------------

test('the reducer turns the wire into facts', () => {
  const v = new MatchVerdict();
  assert.equal(applyWire(v, 'marioDeath', { lives: 2 }), STATUS.PLAYING);
  assert.equal(applyWire(v, 'planeLost', { squadron: 3 }), STATUS.PLAYING);
  assert.equal(applyWire(v, 'islandCleared', { island: '1-1' }), STATUS.PLAYING);
  assert.equal(applyWire(v, 'worldCleared', { final: false }), STATUS.PLAYING);
  assert.equal(applyWire(v, 'marioDeath', { lives: 0 }), 'pilot-wins');
  assert.equal(applyWire(v, 'planeLost', { squadron: 0 }), 'mario-wins');
});

test('the reducer ignores an unknown type rather than guessing', () => {
  const v = new MatchVerdict();
  assert.equal(applyWire(v, 'nonsense', { lives: 0 }), STATUS.PLAYING);
});

test('two clients fed the same events in opposite orders agree', () => {
  const stream = [
    ['marioDeath', { lives: 2 }],
    ['planeLost', { squadron: 4 }],
    ['marioDeath', { lives: 1 }],
    ['planeLost', { squadron: 0 }],
    ['marioDeath', { lives: 0 }],
  ];
  const a = new MatchVerdict();
  for (const [t, d] of stream) applyWire(a, t, d);
  const b = new MatchVerdict();
  for (const [t, d] of [...stream].reverse()) applyWire(b, t, d);
  assert.equal(a.status, b.status);
  assert.equal(a.winner(), 'mario');
});

// ---------------------------------------------------------------------------
// Ownership, client-side. The server refuses a claim from the wrong side; this
// stops it being made at all.
// ---------------------------------------------------------------------------

test('a side may only emit what it owns', () => {
  assert.equal(mayEmitFrom('pilot', 'detonate'), true);
  assert.equal(mayEmitFrom('mario', 'detonate'), false);
  assert.equal(mayEmitFrom('mario', 'marioDeath'), true);
  assert.equal(mayEmitFrom('pilot', 'marioDeath'), false);
  assert.equal(mayEmitFrom('pilot', 'constructor'), false);
  assert.equal(mayEmitFrom(null, 'marioDeath'), false);
});

// ---------------------------------------------------------------------------
// Mario's edge detector. Pure: state in, events out, nothing simulated.
// ---------------------------------------------------------------------------

const step = (m, s) => m.step(s).map((e) => e.type);

test('a death is announced once, not once per frame of the animation', () => {
  const m = new MarioEvents();
  m.step({ island: '1-1', lives: 3, dying: false });
  assert.deepEqual(step(m, { island: '1-1', lives: 3, dying: true }), ['marioDeath']);
  assert.deepEqual(step(m, { island: '1-1', lives: 3, dying: true }), []);
  assert.deepEqual(step(m, { island: '1-1', lives: 3, dying: true }), []);
});

test('the death carries the lives that will REMAIN, not the one being spent', () => {
  // The engine decrements at the end of the animation, so the count visible at
  // `dying` still includes the attempt now being lost. The pilot needs the
  // number that decides the match, not the one on the HUD this frame.
  const m = new MarioEvents();
  m.step({ island: '1-1', lives: 3, dying: false });
  const [e] = m.step({ island: '1-1', lives: 3, dying: true, x: 40, y: 90 });
  assert.equal(e.type, 'marioDeath');
  assert.deepEqual(e.d, { island: '1-1', lives: 2, x: 40, y: 90 });
});

test('the last life leaves zero, and that is what ends the match', () => {
  const m = new MarioEvents();
  m.step({ island: '1-1', lives: 1, dying: false });
  const [e] = m.step({ island: '1-1', lives: 1, dying: true });
  assert.equal(e.d.lives, 0);
  const v = new MatchVerdict();
  applyWire(v, e.type, e.d);
  assert.equal(v.winner(), 'pilot');
});

test('a game over reported by the engine says zero whatever the counter says', () => {
  const m = new MarioEvents();
  m.step({ island: '1-1', lives: 3, dying: false });
  const [e] = m.step({ island: '1-1', lives: 3, dying: true, gameOver: true });
  assert.equal(e.d.lives, 0);
});

test('a second death after a respawn is announced again', () => {
  const m = new MarioEvents();
  m.step({ island: '1-1', lives: 3, dying: false });
  assert.deepEqual(step(m, { island: '1-1', lives: 3, dying: true }), ['marioDeath']);
  assert.deepEqual(step(m, { island: '1-1', lives: 2, dying: false }), []);
  assert.deepEqual(step(m, { island: '1-1', lives: 2, dying: true }), ['marioDeath']);
});

test('clearing an island announces it, with where he went next', () => {
  const m = new MarioEvents();
  m.step({ island: '1-1', lives: 3, dying: false });
  const out = m.step({ island: '1-2', lives: 3, dying: false });
  assert.deepEqual(out, [{ type: 'islandCleared', d: { island: '1-1', next: '1-2' } }]);
});

test('a level that reloads under a dying mario is not a cleared island', () => {
  const m = new MarioEvents();
  m.step({ island: '1-2', lives: 3, dying: false });
  assert.deepEqual(step(m, { island: '1-1', lives: 2, dying: true }), ['marioDeath']);
});

test('crossing into a new world announces worldCleared, not final', () => {
  const m = new MarioEvents();
  m.step({ island: '1-4', lives: 3, dying: false });
  const out = m.step({ island: '2-1', lives: 3, dying: false });
  assert.deepEqual(out.map((e) => e.type), ['islandCleared', 'worldCleared']);
  assert.equal(out[1].d.final, false);
  const v = new MatchVerdict();
  for (const e of out) applyWire(v, e.type, e.d);
  assert.equal(v.status, STATUS.PLAYING);
});

test('clearing 8-4 is final, and it is mario winning', () => {
  const m = new MarioEvents();
  m.step({ island: '8-4', lives: 3, dying: false });
  const out = m.step({ island: '1-1', lives: 3, dying: false });
  const cleared = out.find((e) => e.type === 'worldCleared');
  assert.ok(cleared, '8-4 cleared with no worldCleared');
  assert.equal(cleared.d.final, true);
  const v = new MatchVerdict();
  for (const e of out) applyWire(v, e.type, e.d);
  assert.equal(v.winner(), 'mario');
});

test('the very first step announces nothing: arriving is not clearing', () => {
  const m = new MarioEvents();
  assert.deepEqual(step(m, { island: '1-1', lives: 3, dying: false }), []);
});

test('no player, no island: nothing is invented', () => {
  const m = new MarioEvents();
  assert.deepEqual(step(m, { island: null, lives: null, dying: false }), []);
  assert.deepEqual(step(m, {}), []);
});

// ---------------------------------------------------------------------------
// The pilot's translator: one simulation event in, at most one wire event out.
// ---------------------------------------------------------------------------

const SIM = { squadron: 4, plane: { x: 120, y: 60 } };

test('a detonation on an island proposes a detonate, with its centre', () => {
  const out = pilotWireEvent(
    { type: 'detonation', island: '1-1', keys: ['3,4'], x: 900, y: 210, radius: 2 },
    SIM
  );
  assert.deepEqual(out, {
    type: 'detonate',
    d: { island: '1-1', keys: ['3,4'], cx: 900, cy: 210, r: 2 },
  });
});

test('a detonation in the sea proposes nothing', () => {
  assert.equal(
    pilotWireEvent({ type: 'detonation', island: null, keys: [], water: true, x: 5, y: 5 }, SIM),
    null
  );
});

test('a detonation that removed no tile proposes nothing', () => {
  assert.equal(
    pilotWireEvent({ type: 'detonation', island: '1-1', keys: [], x: 5, y: 5, radius: 2 }, SIM),
    null
  );
});

test('losing a plane carries the reason and what is left of the squadron', () => {
  const out = pilotWireEvent({ type: 'planeLost', reason: 'sea', x: 10, y: 20 }, { squadron: 0 });
  assert.deepEqual(out, { type: 'planeLost', d: { reason: 'sea', x: 10, y: 20, squadron: 0 } });
  const v = new MatchVerdict();
  applyWire(v, out.type, out.d);
  assert.equal(v.winner(), 'mario');
});

test('landing and launching are carried', () => {
  assert.deepEqual(pilotWireEvent({ type: 'landed' }, SIM), {
    type: 'landed', d: { x: 120, squadron: 4 },
  });
  assert.deepEqual(pilotWireEvent({ type: 'sortieStart', squadron: 3 }, SIM), {
    type: 'sortieStart', d: { squadron: 3 },
  });
});

test('the sim\'s own worldCleared is NOT forwarded: that word is mario\'s', () => {
  // The pilot's sim emits worldCleared when the carrier group sails. On the
  // wire, worldCleared is Mario clearing a castle, and it is mario-owned — the
  // server would refuse it, and relaying it would let the pilot announce
  // Mario's progress.
  assert.equal(pilotWireEvent({ type: 'worldCleared', world: 2 }, SIM), null);
  assert.equal(mayEmitFrom('pilot', 'worldCleared'), false);
});

test('noise from the sim is dropped rather than relayed', () => {
  assert.equal(pilotWireEvent({ type: 'released', kind: 'bomb' }, SIM), null);
  assert.equal(pilotWireEvent({ type: 'dryFire' }, SIM), null);
  assert.equal(pilotWireEvent(null, SIM), null);
  assert.equal(pilotWireEvent({}, SIM), null);
});

test('every wire event the pilot can produce is one the pilot owns', () => {
  const produced = [
    { type: 'detonation', island: '1-1', keys: ['1,1'], x: 1, y: 1, radius: 1 },
    { type: 'landed' },
    { type: 'planeLost', reason: 'sea', x: 0, y: 0 },
    { type: 'sortieStart', squadron: 2 },
    { type: 'ferrySunk', x: 3, y: 4 },
  ].map((e) => pilotWireEvent(e, SIM)).filter(Boolean);
  assert.equal(produced.length, 5);
  for (const p of produced) {
    assert.equal(mayEmitFrom('pilot', p.type), true, `pilot may not emit ${p.type}`);
  }
});

test('every wire event mario can produce is one mario owns', () => {
  const m = new MarioEvents();
  m.step({ island: '8-4', lives: 1, dying: false });
  const produced = [
    ...m.step({ island: '1-1', lives: 1, dying: false }),
    ...m.step({ island: '1-1', lives: 1, dying: true }),
  ];
  assert.ok(produced.length >= 3);
  for (const p of produced) {
    assert.equal(mayEmitFrom('mario', p.type), true, `mario may not emit ${p.type}`);
  }
});

test('a level that is not an island of the archipelago clears nothing', () => {
  // The engine will call a title screen, a coin room and one of Harry's
  // painted sequences a "level" too. Walking into a coin room is not clearing
  // 1-1, and coming back out of it is not clearing the coin room.
  const m = new MarioEvents();
  m.step({ island: '1-1', lives: 3, dying: false });
  assert.deepEqual(step(m, { island: 'coins', lives: 3, dying: false }), []);
  assert.deepEqual(step(m, { island: '1-1', lives: 3, dying: false }), []);
  const out = m.step({ island: '1-2', lives: 3, dying: false });
  assert.deepEqual(out, [{ type: 'islandCleared', d: { island: '1-1', next: '1-2' } }]);
});
