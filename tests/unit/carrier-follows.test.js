import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MarioEvents, MatchVerdict, applyWire, mayEmitFrom, repositionWorld, STATUS,
} from '../../src/net/match-events.js';
import { EVENT_OWNER } from '../../src/net/protocol.js';
import { Sail, SAIL_KIND, resetText, sailText, worldOfIsland } from '../../src/wings/sail.js';
import { WingsSim, SQUADRON } from '../../src/wings/sim.js';
import { Match, WINNER } from '../../src/wings/match.js';

// THE CARRIER GROUP FOLLOWS MARIO BACK.
//
// The ocean holds one SMB world at a time and both clients lay it out from the
// match seed and the world number. Mario going FORWARD is the sail, and it
// already worked. This file is every other way his world can change — chiefly
// his run ending and the engine restarting him on 1-1 — and the rule that the
// group follows him there, or the pilot spends the rest of the match bombing an
// archipelago Mario is nowhere near.
//
// Nothing here touches a browser. The transition rules are pure by design:
// MarioEvents decides what happened, repositionWorld decides where the ocean
// goes, and Sail decides what the two screens say about it.

// The engine, as MarioEvents reads it. `lives` is the count BEFORE the death
// being animated is deducted, which is how src/game/world.js keeps it.
const read = (island, lives, extra = {}) => ({
  island, lives, dying: false, gameOver: false, x: 0, y: 0, ...extra,
});

// Play a whole death out: the animation starts (one event), runs (none), and
// the engine then loads whatever comes next.
function die(ev, island, lives) {
  const out = ev.step(read(island, lives, { dying: true }));
  ev.step(read(island, lives, { dying: true }));
  return out;
}

const types = (out) => out.map((e) => e.type);

// ---------------------------------------------------------------------------
// Which transitions are a restart, and which are progress
// ---------------------------------------------------------------------------

test('mario spends his last life and restarts on 1-1: the group is told to follow', () => {
  const ev = new MarioEvents();
  ev.step(read('5-2', 1));
  // The death that ends the run. `lives` still reads 1: world.js decrements at
  // the END of the animation, so the event carries the count that will remain.
  const dying = die(ev, '5-2', 1);
  assert.deepEqual(types(dying), ['marioDeath']);
  assert.equal(dying[0].d.lives, 0);

  // src/main.js endSession() restores three lives and loads 1-1 before this
  // side reads the engine again, so by now nothing in the reading says a death
  // ever happened. The latch is what remembers.
  const out = ev.step(read('1-1', 3));
  assert.deepEqual(types(out), ['worldReset']);
  assert.deepEqual(out[0].d, { island: '5-2', next: '1-1' });
  assert.equal(worldOfIsland(out[0].d.next), 1);
});

test('a restart announces NOTHING cleared: no islandCleared, no worldCleared', () => {
  const ev = new MarioEvents();
  ev.step(read('5-2', 1));
  die(ev, '5-2', 1);
  const out = ev.step(read('1-1', 3));
  // Both would be lies. islandCleared is how the pilot learns where Mario is,
  // so worldReset has to carry that fact instead — and it does, above.
  assert.equal(out.some((e) => e.type === 'islandCleared'), false);
  assert.equal(out.some((e) => e.type === 'worldCleared'), false);
});

test('a death he SURVIVES latches nothing, and the next real clear is still a clear', () => {
  const ev = new MarioEvents();
  ev.step(read('5-3', 3));
  const dying = die(ev, '5-3', 3);
  assert.equal(dying[0].d.lives, 2);
  // The engine reloads the same level: no id change, so nothing is announced.
  assert.deepEqual(ev.step(read('5-3', 2)), []);
  // And he goes on to clear the castle for real.
  ev.step(read('5-4', 2));
  const out = ev.step(read('6-1', 2));
  assert.deepEqual(types(out), ['islandCleared', 'worldCleared']);
  assert.equal(out[1].d.final, false);
});

test('the turn passing to a slot in another world repositions, without any death', () => {
  // Two players alternate; the other man is standing in world 2 while this one
  // was in world 5. Nothing was cleared and nobody ran out of lives, but the
  // engine has loaded a level in a different world and the ocean must follow.
  const ev = new MarioEvents();
  ev.step(read('5-1', 2));
  const out = ev.step(read('2-3', 4));
  assert.deepEqual(types(out), ['worldReset']);
  assert.equal(out[0].d.next, '2-3');
});

test('a warp zone still sails: forward is progress, however far it jumps', () => {
  const ev = new MarioEvents();
  ev.step(read('1-2', 3));
  const out = ev.step(read('4-1', 3));
  assert.deepEqual(types(out), ['islandCleared', 'worldCleared']);
  assert.equal(out[1].d.next, '4-1');
  assert.equal(out[1].d.final, false);
});

test('clearing 8-4 is still the win, even though the engine drops him on 1-1', () => {
  // The biggest backwards move in the game is also Mario winning outright, so
  // `final` has to outrank direction or the win reads as a restart.
  const ev = new MarioEvents();
  ev.step(read('8-4', 3));
  const out = ev.step(read('1-1', 3));
  assert.deepEqual(types(out), ['islandCleared', 'worldCleared']);
  assert.equal(out[1].d.final, true);
  const v = new MatchVerdict();
  for (const e of out) applyWire(v, e.type, e.d);
  assert.equal(v.winner(), 'mario');
});

test('dying his LAST life on 8-4 does not hand him the game', () => {
  // Without the latch this restart reads as `from === '8-4'`, which is `final`,
  // which is MARIO WINS — the pilot robbed of a match he had just won.
  const ev = new MarioEvents();
  ev.step(read('8-4', 1));
  const dying = die(ev, '8-4', 1);
  const out = ev.step(read('1-1', 3));
  assert.deepEqual(types(out), ['worldReset']);

  const v = new MatchVerdict();
  for (const e of [...dying, ...out]) applyWire(v, e.type, e.d);
  assert.equal(v.status, STATUS.PILOT);
});

test('a coin room is not a restart any more than it is a clear', () => {
  const ev = new MarioEvents();
  ev.step(read('1-2', 3));
  assert.deepEqual(ev.step(read('coins', 3)), []);
  assert.deepEqual(ev.step(read('1-2', 3)), []);
});

test('worldReset is mario\'s to say, and only his', () => {
  assert.equal(EVENT_OWNER.worldReset, 'mario');
  assert.equal(mayEmitFrom('mario', 'worldReset'), true);
  assert.equal(mayEmitFrom('pilot', 'worldReset'), false);
});

test('a restart is not a terminal fact: it decides nothing about who won', () => {
  const v = new MatchVerdict();
  assert.equal(applyWire(v, 'worldReset', { island: '5-2', next: '1-1' }), STATUS.PLAYING);
  assert.deepEqual(v.facts(), { livesGone: false, squadronGone: false, worldCleared: false });
});

// ---------------------------------------------------------------------------
// Where the pilot's ocean goes
// ---------------------------------------------------------------------------

test('the destination is taken from the event, never counted', () => {
  assert.equal(repositionWorld({ island: '5-2', next: '1-1' }, { over: false }), 1);
  assert.equal(repositionWorld({ island: '2-1', next: '7-4' }, { over: false }), 7);
});

test('a decided match puts to sea all the same', () => {
  // THIS ASSERTED THE OPPOSITE and the opposite was wrong. Spending the last
  // life is both the pilot winning and the engine putting Mario back on 1-1 —
  // it is the ordinary end of a run and the commonest way he ever moves world
  // backwards. Refusing to follow a decided match therefore meant the group
  // followed him almost never, which is the failure the whole mechanism exists
  // to prevent. A stale verdict is a banner; two clients in different oceans is
  // a broken game.
  assert.equal(repositionWorld({ island: '5-2', next: '1-1' }, { over: true }), 1);
  assert.equal(repositionWorld({ island: '5-2', next: '1-1' }), 1);
});

test('an unreadable island moves nothing', () => {
  for (const next of [null, undefined, '', 'coins', 'title', 42]) {
    assert.equal(repositionWorld({ island: '5-2', next }, { over: false }), null, String(next));
  }
});

test('both clients end on the same world, whatever route mario took', () => {
  // Mario's client declares; the pilot's obeys. The only number that crosses is
  // the island id, and both sides read the world out of it with one function.
  for (const [from, to] of [['5-2', '1-1'], ['8-4', '1-1'], ['5-1', '2-3'], ['1-2', '4-1']]) {
    const ev = new MarioEvents();
    ev.step(read(from, 1));
    if (from !== '1-2' && from !== '8-4') die(ev, from, 1);
    const out = ev.step(read(to, 3));
    const move = out.find((e) => e.type === 'worldReset' || e.type === 'worldCleared');
    assert.ok(move, `${from} -> ${to} moved nothing`);
    const pilotWorld = move.type === 'worldReset'
      ? repositionWorld(move.d, { over: false })
      : worldOfIsland(move.d.next);
    assert.equal(pilotWorld, worldOfIsland(to), `${from} -> ${to} split the ocean`);
  }
});

// ---------------------------------------------------------------------------
// The crossing itself: one scene, two reasons
// ---------------------------------------------------------------------------

test('a sail may only go forward; a reset may go back', () => {
  const forward = new Sail();
  assert.equal(forward.begin({ from: 5, to: 1 }), false, 'a sail went backwards');

  const back = new Sail();
  assert.equal(back.begin({ from: 5, to: 1, kind: SAIL_KIND.RESET }), true);
  assert.equal(back.to, 1);
  assert.equal(back.kind, SAIL_KIND.RESET);
});

test('a reset to the world the group is already on is refused', () => {
  // Which is what makes a resent worldReset a no-op rather than a second fade.
  const s = new Sail();
  assert.equal(s.begin({ from: 3, to: 3, kind: SAIL_KIND.RESET }), false);
});

test('a resent worldReset does not restart a crossing already running', () => {
  const s = new Sail();
  assert.equal(s.begin({ from: 5, to: 1, kind: SAIL_KIND.RESET }), true);
  s.step();
  s.step();
  assert.equal(s.begin({ from: 5, to: 1, kind: SAIL_KIND.RESET }), false);
  assert.equal(s.elapsed, 2, 'the scene was restarted under the player');
});

test('a reset runs the same scene, tick for tick, as a sail', () => {
  const a = new Sail();
  const b = new Sail();
  a.begin({ from: 1, to: 2 });
  b.begin({ from: 5, to: 1, kind: SAIL_KIND.RESET });
  const strip = (f) => ({ phase: f.phase, veil: f.veil, swap: f.swap, finished: f.finished });
  for (let i = 0; i < 300; i++) assert.deepEqual(strip(a.step()), strip(b.step()), `tick ${i}`);
  assert.equal(a.active, false);
  assert.equal(b.active, false);
});

test('the card never claims a world was secured on a run that ended', () => {
  const t = resetText(5, 1, 'SQUADRON REPLENISHED');
  const all = [t.title, ...t.lines].join(' | ');
  assert.equal(/SECURED/.test(all), false, all);
  assert.match(all, /WORLD 5 IS OVER/);
  assert.match(all, /WORLD 1 ARCHIPELAGO/);
  assert.equal(t.lines[t.lines.length - 1], 'SQUADRON REPLENISHED');
  // The same title as a sail: the same group making the same crossing.
  assert.equal(t.title, sailText(1, 2).title);
});

test('a reset that happens to go forward says so, and still claims nothing', () => {
  const t = resetText(2, 5);
  assert.match(t.lines[0], /REPOSITIONING TO WORLD 5/);
  assert.equal(/SECURED/.test(t.lines.join(' ')), false);
});

test('the crossing reads its words off its kind, so neither screen can choose', () => {
  const s = new Sail();
  s.begin({ from: 5, to: 1, kind: SAIL_KIND.RESET });
  assert.deepEqual(s.text(), resetText(5, 1, ''));
  const t = new Sail();
  t.begin({ from: 1, to: 2 });
  assert.deepEqual(t.text(), sailText(1, 2, ''));
});

// ---------------------------------------------------------------------------
// What the pilot lands on
// ---------------------------------------------------------------------------

test('the ocean the group repositions onto is the one the seed dictates', () => {
  // Going BACK is a rebuild rather than a sail, because Archipelago#sail must go
  // on refusing to run the world number down. The rebuild has to land on the
  // identical ocean the pilot would have had if he had never left world 1.
  const seed = 0x2545f491;
  const original = new WingsSim({ seed, world: 1 });
  const rebuilt = new WingsSim({ seed, world: 1 });
  const shape = (sim) => sim.archipelago.slots.map((s) => [s.id, s.x, s.width]);
  assert.deepEqual(shape(rebuilt), shape(original));
  assert.equal(rebuilt.archipelago.world, 1);
});

test('the pilot comes back on the deck with a full squadron', () => {
  const sim = new WingsSim({ seed: 0x2545f491, world: 5 });
  sim.squadron = 1;
  // The rebuild is a new simulation from the same seed, which is where the
  // replenishment comes from: the pilot is not made to fly world 1 again on
  // whatever he had left of world 5.
  const after = new WingsSim({ seed: sim.archipelago.seed, world: 1 });
  assert.equal(after.squadron, SQUADRON);
  assert.equal(after.plane.mode, 'deck');
});

// ---------------------------------------------------------------------------
// A match that is over ends, and does not sail
// ---------------------------------------------------------------------------

test('running out of lives is the pilot winning, and that is a match ENDING', () => {
  const m = new Match({ world: 5, island: 1 });
  m.outOfLives();
  assert.equal(m.winner, WINNER.PILOT);
  assert.equal(m.phase, 'over');
  // And the group STILL follows the restart that comes after it: the verdict
  // decides who won, not where the ocean is. See repositionWorld.
  assert.equal(repositionWorld({ island: '5-2', next: '1-1' }, { over: true }), 1);
});

test('the death that ends the match is announced BEFORE the restart it causes', () => {
  // The wire is ordered: the death leaves at the start of the animation and the
  // level change cannot happen until the end of it, so both clients see the
  // same two events in the same order.
  const ev = new MarioEvents();
  ev.step(read('5-2', 1));
  const dying = die(ev, '5-2', 1);
  const restart = ev.step(read('1-1', 3));
  const stream = [...dying, ...restart];
  assert.deepEqual(types(stream), ['marioDeath', 'worldReset']);

  const v = new MatchVerdict();
  applyWire(v, stream[0].type, stream[0].d);
  assert.equal(v.over, true, 'the match was not decided before the restart arrived');
  // THE WHOLE POINT OF THE PAIR: the pilot learns he won AND follows Mario to
  // world 1. This is the exact sequence a real game over produces, and it is
  // the one that used to leave the group stranded.
  assert.equal(repositionWorld(stream[1].d, { over: v.over }), 1);
});

test('a forward sail is untouched by any of this', () => {
  const ev = new MarioEvents();
  ev.step(read('1-4', 3));
  const out = ev.step(read('2-1', 3));
  assert.deepEqual(types(out), ['islandCleared', 'worldCleared']);
  assert.deepEqual(out[1].d, { island: '1-4', next: '2-1', final: false });
  const v = new MatchVerdict();
  assert.equal(applyWire(v, out[1].type, out[1].d), STATUS.PLAYING);

  const s = new Sail();
  assert.equal(s.begin({ from: 1, to: 2 }), true);
  assert.equal(s.kind, SAIL_KIND.SAIL);
  assert.deepEqual(s.text(), sailText(1, 2, ''));
});
