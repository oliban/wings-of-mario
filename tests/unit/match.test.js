import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIPELAGO } from '../../src/wings/archipelago.js';
import { MATCH, WINNER, Match } from '../../src/wings/match.js';

const fresh = (over = {}) => new Match({ seed: 1234, ...over });

// Clear every level of the current world, taking the ferry each time.
function clearWorld(m) {
  for (let i = 0; i < ARCHIPELAGO.ISLANDS_PER_WORLD; i++) {
    m.clearLevel();
    m.arrive();
  }
}

test('a match starts on 1-1 with a full stock and a full squadron', () => {
  const m = fresh();
  assert.equal(m.world, 1);
  assert.equal(m.island, 0);
  assert.equal(m.islandId, '1-1');
  assert.equal(m.lives, MATCH.LIVES);
  assert.equal(m.squadron, MATCH.SQUADRON);
  assert.equal(m.winner, WINNER.NONE);
  assert.equal(m.phase, 'ashore');
});

test('clearing a level puts him on a ferry to the next island', () => {
  const m = fresh();
  assert.equal(m.clearLevel(), 'ferry');
  assert.equal(m.phase, 'ferry');
  assert.equal(m.nextIslandId, '1-2', 'the ferry has to be going somewhere');
  assert.equal(m.islandId, '1-1', 'he has not landed yet');
  m.arrive();
  assert.equal(m.phase, 'ashore');
  assert.equal(m.islandId, '1-2');
});

test('clearing x-4 sails the group instead of running a ferry', () => {
  const m = fresh();
  for (let i = 0; i < 3; i++) {
    m.clearLevel();
    m.arrive();
  }
  assert.equal(m.islandId, '1-4');
  assert.equal(m.clearLevel(), 'sail', 'a castle is not a ferry ride');
  assert.equal(m.world, 2);
  assert.equal(m.islandId, '2-1');
  assert.equal(m.phase, 'ashore', 'the group sails; Mario does not swim');
  assert.equal(m.squadron, MATCH.SQUADRON, 'a new archipelago is a new squadron');
});

test('a sail replenishes a squadron the pilot had already spent', () => {
  const m = fresh();
  m.planeLost();
  m.planeLost();
  assert.equal(m.squadron, MATCH.SQUADRON - 2);
  for (let i = 0; i < 4; i++) {
    m.clearLevel();
    m.arrive();
  }
  assert.equal(m.squadron, MATCH.SQUADRON);
});

test('clearing 8-4 is Mario winning', () => {
  const m = fresh({ world: 8, island: 3 });
  assert.equal(m.islandId, '8-4');
  assert.equal(m.clearLevel(), 'won');
  assert.equal(m.winner, WINNER.MARIO);
  assert.equal(m.over, true);
  assert.equal(m.world, 8, 'there is no ninth world to sail to');
});

test('running out of lives is the pilot winning, with no continues', () => {
  const m = fresh();
  m.marioDied(2);
  assert.equal(m.lives, 2);
  assert.equal(m.winner, WINNER.NONE);
  m.marioDied(0);
  assert.equal(m.lives, 0);
  assert.equal(m.winner, WINNER.NONE, 'zero lives left is not yet game over');
  m.outOfLives();
  assert.equal(m.winner, WINNER.PILOT);
  assert.equal(m.over, true);
});

test('destroying the squadron is Mario winning', () => {
  const m = fresh();
  for (let i = 1; i < MATCH.SQUADRON; i++) {
    assert.equal(m.planeLost(), false, `plane ${i} should not end it`);
    assert.equal(m.winner, WINNER.NONE);
  }
  assert.equal(m.planeLost(), true, 'the last aeroplane ends the match');
  assert.equal(m.squadron, 0);
  assert.equal(m.winner, WINNER.MARIO);
});

test('a finished match refuses to keep playing', () => {
  const m = fresh();
  m.outOfLives();
  assert.equal(m.winner, WINNER.PILOT);
  assert.equal(m.clearLevel(), 'over');
  assert.equal(m.planeLost(), false);
  assert.equal(m.islandId, '1-1', 'nothing moves after the whistle');
  assert.equal(m.squadron, MATCH.SQUADRON, 'a decided match cannot be un-decided');
  assert.equal(m.winner, WINNER.PILOT);
});

test('a ferry that sinks costs a life and puts him back where he sailed from', () => {
  const m = fresh();
  m.clearLevel();
  assert.equal(m.phase, 'ferry');
  m.ferrySunk(2);
  assert.equal(m.lives, 2);
  assert.equal(m.phase, 'ashore');
  assert.equal(m.islandId, '1-1', 'a sunk crossing is re-sailed, not skipped');
  assert.equal(m.nextIslandId, '1-2');
});

test('a sinking that takes the last life still ends the match', () => {
  const m = fresh();
  m.clearLevel();
  m.ferrySunk(0);
  m.outOfLives();
  assert.equal(m.winner, WINNER.PILOT);
});

test('the whole game can be played through', () => {
  const m = fresh();
  for (let w = 1; w <= ARCHIPELAGO.WORLDS - 1; w++) {
    assert.equal(m.world, w);
    clearWorld(m);
  }
  assert.equal(m.world, 8);
  assert.equal(m.islandId, '8-1');
  for (let i = 0; i < 3; i++) {
    m.clearLevel();
    m.arrive();
  }
  assert.equal(m.clearLevel(), 'won');
  assert.equal(m.winner, WINNER.MARIO);
});

test('the state is plain data and round-trips', () => {
  const m = fresh();
  m.clearLevel();
  m.planeLost();
  const clone = Match.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
  assert.deepEqual(clone.state(), m.state());
  assert.equal(clone.seed, m.seed, 'the seed must survive a reconnect, or the ocean moves');
});

test('every event is recorded, in order, and drains', () => {
  const m = fresh();
  m.clearLevel();
  m.arrive();
  m.planeLost();
  const types = m.drain().map((e) => e.type);
  assert.deepEqual(types, ['islandCleared', 'ferryBoard', 'planeLost'],
    'the level is cleared before the boat is boarded');
  assert.deepEqual(m.drain(), [], 'drain must empty the queue');
});

// --- determinism: the same events in the same order give the same verdict ---

test('two independent copies replaying one event log agree', () => {
  const log = [
    { type: 'clearLevel' }, { type: 'arrive' },
    { type: 'planeLost' }, { type: 'planeLost' },
    { type: 'marioDied', lives: 2 },
    { type: 'clearLevel' }, { type: 'arrive' },
    { type: 'planeLost' }, { type: 'planeLost' }, { type: 'planeLost' },
  ];
  const a = fresh();
  const b = fresh();
  for (const e of log) a.apply([e]);
  b.apply(log);
  assert.deepEqual(a.state(), b.state());
  assert.equal(a.winner, WINNER.MARIO, 'the fifth plane ends it either way');
});

test('a match is decided by the events alone, with no clock and no randomness', () => {
  const m = fresh();
  const before = m.state();
  m.apply([]);
  assert.deepEqual(m.state(), before, 'an empty batch changes nothing');
});

// --- the tie ---

test('a plane and the last life lost in the same moment goes to Mario', () => {
  const m = fresh({ squadron: 1 });
  m.apply([{ type: 'planeLost' }, { type: 'outOfLives' }]);
  assert.equal(m.winner, WINNER.MARIO, 'the squadron is gone; nobody is left to fly');
  assert.equal(m.over, true);
});

test('the tie goes to Mario whichever way round the two events sit', () => {
  const m = fresh({ squadron: 1 });
  m.apply([{ type: 'outOfLives' }, { type: 'planeLost' }]);
  assert.equal(m.winner, WINNER.MARIO, 'one moment has no order inside it');
  assert.equal(m.squadron, 0);
  assert.equal(m.lives, 0);
});

test('two separate moments are still decided by the first of them', () => {
  const m = fresh({ squadron: 1 });
  m.apply([{ type: 'outOfLives' }]);
  assert.equal(m.winner, WINNER.PILOT);
  m.apply([{ type: 'planeLost' }]);
  assert.equal(m.winner, WINNER.PILOT, 'a later moment cannot reopen a finished match');
  assert.equal(m.squadron, 1);
});

test('a tie that is not a tie: a plane lost beside a non-final death', () => {
  const m = fresh({ squadron: 1 });
  m.apply([{ type: 'marioDied', lives: 1 }, { type: 'planeLost' }]);
  assert.equal(m.winner, WINNER.MARIO);
  assert.equal(m.lives, 1, 'he was not out of lives; he just lost one');
});

test('apply routes every event the host can produce', () => {
  const m = fresh();
  m.apply([{ type: 'clearLevel' }, { type: 'ferrySunk', lives: 2 }]);
  assert.equal(m.islandId, '1-1');
  assert.equal(m.lives, 2);
  assert.equal(m.phase, 'ashore');
  m.apply([{ type: 'clearLevel' }, { type: 'arrive' }]);
  assert.equal(m.islandId, '1-2');
  assert.throws(() => m.apply([{ type: 'nonsense' }]), /nonsense/,
    'an event the match does not know must not be silently dropped');
});
