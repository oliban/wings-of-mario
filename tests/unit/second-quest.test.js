import test from 'node:test';
import assert from 'node:assert/strict';
import { PHYS } from '../../src/game/physics.js';
import { secondaryHardMode } from '../../src/game/world.js';
import {
  PRINCESS_MESSAGES,
  RETAINER_MESSAGES,
  PRINCESS_HOLD,
  VICTORY_MUSIC_AT,
  SECOND_QUEST_WALK,
  isNormalWalker,
  hardenSpec,
  hardenEntities,
  guardSecondQuest,
  armSecondQuest,
  disarmSecondQuest,
} from '../../src/wings/second-quest.js';

// The ending scene and the quest that follows it. Everything asserted here is
// read off reference/smbdis.asm, cited in second-quest.js; this file is what
// stops the wording and the timings drifting back to something remembered.

/* ------------------------------------------------------------ what she says */

test('the princess says the original\'s five lines, in the original\'s order', () => {
  assert.deepEqual(
    PRINCESS_MESSAGES.map((m) => m.text),
    [
      'THANK YOU MARIO!',
      'YOUR QUEST IS OVER.',
      'WE PRESENT YOU A NEW QUEST.',
      'PUSH BUTTON B',
      'TO SELECT A WORLD',
    ]
  );
});

test('the world-select prompt is TWO lines, not one', () => {
  // Written as one line it would appear a counter step early and in the wrong
  // place. WorldSelectMessage1 and 2 are separate records (asm:2350, 2357).
  const b = PRINCESS_MESSAGES.filter((m) => /BUTTON B|SELECT A WORLD/.test(m.text));
  assert.equal(b.length, 2);
  assert.equal(b[1].at - b[0].at, 64);
});

test('the princess scene and the toad scene share only the thanks', () => {
  // The two endings are different scenes. Confusing them is the specific bug
  // this file exists to prevent, so assert they do not overlap past line one.
  const princess = new Set(PRINCESS_MESSAGES.map((m) => m.text));
  const shared = RETAINER_MESSAGES.filter((m) => princess.has(m.text)).map((m) => m.text);
  assert.deepEqual(shared, ['THANK YOU MARIO!']);
  assert.ok(RETAINER_MESSAGES.some((m) => m.text === 'ANOTHER CASTLE!'));
  assert.ok(!princess.has('ANOTHER CASTLE!'));
});

test('every line sits where its VRAM address puts it', () => {
  // addr = $2400 + row * 32 + col, from the message records at asm:2306-2361.
  const addr = (m) => 0x2400 + m.row * 32 + m.col;
  assert.deepEqual(PRINCESS_MESSAGES.map(addr), [0x2548, 0x25a7, 0x25e3, 0x264a, 0x2688]);
  assert.deepEqual(RETAINER_MESSAGES.map(addr), [0x2548, 0x25c5, 0x2605]);
  // And the declared length is the string's own.
  assert.deepEqual(
    PRINCESS_MESSAGES.map((m) => m.text.length),
    [0x10, 0x13, 0x1b, 0x0d, 0x11]
  );
});

test('the lines are staggered on the ROM\'s 64-frame counter', () => {
  // PrintVictoryMessages adds 4 to SecondaryMsgCounter every frame and carries
  // into PrimaryMsgCounter: 256/4 = 64 frames a step. World 8 prints on steps
  // 0, 3, 4, 5, 6 — steps 1 and 2 are a pause while Mario is thanked.
  assert.deepEqual(PRINCESS_MESSAGES.map((m) => m.at), [0, 192, 256, 320, 384]);
  assert.equal(VICTORY_MUSIC_AT, 192);
  // Toad's second message is step 2, not step 3.
  assert.deepEqual(RETAINER_MESSAGES.map((m) => m.at), [0, 128, 128]);
  // 448 frames of messages, then WorldEndTimer = 6 interval ticks of 21 frames.
  assert.equal(PRINCESS_HOLD, 574);
});

/* --------------------------------------------------------- the second quest */

test('primary hard mode forces secondary hard mode into every world', () => {
  // The engine's own seam. Off, it is 5-3 onward; on, it is everywhere.
  assert.equal(secondaryHardMode('1-1', false), false);
  assert.equal(secondaryHardMode('5-2', false), false);
  assert.equal(secondaryHardMode('1-1', true), true);
  assert.equal(secondaryHardMode('2-3', true), true);
  assert.equal(secondaryHardMode('5-2', true), true);
});

test('a goomba becomes a buzzy beetle and walks 1.5x as fast', () => {
  const out = hardenSpec({ type: 'goomba', x: 22, y: 12 });
  assert.equal(out.type, 'buzzy');
  assert.equal(out.speed, PHYS.enemyWalkSpeed * SECOND_QUEST_WALK);
  // 0.5 -> 0.75 px/frame, the ROM's $f8 -> $f4 in sixteenths.
  assert.equal(out.speed, 0.75);
  // x/y and the hard-only bit ride along untouched.
  assert.equal(out.x, 22);
  assert.equal(out.y, 12);
});

test('the walkers that go through InitNormalEnemy, and only those', () => {
  assert.ok(isNormalWalker({ type: 'goomba' }));
  assert.ok(isNormalWalker({ type: 'buzzy' }));
  assert.ok(isNormalWalker({ type: 'koopa', variant: 'green' }));
  assert.ok(isNormalWalker({ type: 'koopa', variant: 'red' }));
  // A paratroopa has its own init (ids $0e/$0f/$10) and takes no speed bump.
  assert.ok(!isNormalWalker({ type: 'koopa', variant: 'green', winged: true }));
  for (const t of ['blooper', 'hammerbro', 'bowser', 'piranha', 'lakitu', 'cheep', 'platform']) {
    assert.ok(!isNormalWalker({ type: t }), t);
  }
});

test('a koopa keeps being a koopa; only the goomba mutates', () => {
  const k = hardenSpec({ type: 'koopa', variant: 'red', x: 5, y: 9 });
  assert.equal(k.type, 'koopa');
  assert.equal(k.variant, 'red');
  assert.equal(k.speed, 0.75);
});

test('an explicit speed on the record is not multiplied', () => {
  const out = hardenSpec({ type: 'goomba', x: 1, y: 1, speed: 0.25 });
  assert.equal(out.speed, 0.25);
});

test('hardenEntities returns the same array when nothing changed', () => {
  const list = [{ type: 'blooper', x: 1, y: 1 }, { type: 'firebar', x: 2, y: 2 }];
  assert.equal(hardenEntities(list), list);
  const mixed = [...list, { type: 'goomba', x: 3, y: 3 }];
  const out = hardenEntities(mixed);
  assert.notEqual(out, mixed);
  assert.deepEqual(out.map((s) => s.type), ['blooper', 'firebar', 'buzzy']);
  // The originals are untouched: src/data/levels/*.js are shared singletons and
  // a first quest after a second one has to get its goombas back.
  assert.equal(mixed[2].type, 'goomba');
  assert.equal(mixed[2].speed, undefined);
});

/* ------------------------------------------------------- hanging it on World */

// The two methods and one property of World this touches, and nothing else.
class FakeWorld {
  constructor() {
    this.primaryHardMode = false;
    this.spawned = null;
    this.calls = 0;
  }

  _spawnLevelEntities(lvl) {
    this.calls++;
    this.spawned = lvl.entities;
    return lvl;
  }
}

const LEVEL = Object.freeze({
  id: '1-1',
  entities: Object.freeze([
    Object.freeze({ type: 'goomba', x: 22, y: 12 }),
    Object.freeze({ type: 'koopa', variant: 'green', winged: true, x: 40, y: 4 }),
  ]),
});

test('the guard is inert until the quest is armed', () => {
  const w = new FakeWorld();
  assert.equal(guardSecondQuest(w), true);
  w._spawnLevelEntities(LEVEL);
  assert.equal(w.spawned, LEVEL.entities);
  assert.equal(w.spawned[0].type, 'goomba');
});

test('arming the quest rewrites the enemies of every load', () => {
  const w = new FakeWorld();
  guardSecondQuest(w);
  assert.equal(armSecondQuest(w), 2);
  assert.equal(w.primaryHardMode, true);
  w._spawnLevelEntities(LEVEL);
  assert.equal(w.spawned[0].type, 'buzzy');
  assert.equal(w.spawned[0].speed, 0.75);
  // The paratroopa is left exactly as the level author wrote it.
  assert.equal(w.spawned[1], LEVEL.entities[1]);
  // The level module itself was never mutated.
  assert.equal(LEVEL.entities[0].type, 'goomba');
});

test('disarming puts the first quest back', () => {
  const w = new FakeWorld();
  guardSecondQuest(w);
  armSecondQuest(w);
  assert.equal(disarmSecondQuest(w), 1);
  assert.equal(w.primaryHardMode, false);
  w._spawnLevelEntities(LEVEL);
  assert.equal(w.spawned[0].type, 'goomba');
});

test('the guard is idempotent, so a per-tick hook costs one property read', () => {
  const w = new FakeWorld();
  assert.equal(guardSecondQuest(w), true);
  assert.equal(guardSecondQuest(w), false);
  assert.equal(guardSecondQuest(w), false);
  armSecondQuest(w);
  w._spawnLevelEntities(LEVEL);
  // One wrap, one call through — not three nested ones.
  assert.equal(w.calls, 1);
  assert.equal(w.spawned[0].type, 'buzzy');
});

test('the quest number climbs, so a third run is not a second one', () => {
  const w = new FakeWorld();
  assert.equal(armSecondQuest(w, 2), 2);
  assert.equal(armSecondQuest(w, w.quest + 1), 3);
});
