import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

// THE END OF 8-4, against the REAL engine.
//
// tests/unit/second-quest.test.js proves the wording, the ROM row of every line,
// the 64-frame stagger and the enemy rewrite against fakes. What only a browser
// can prove is the part the fakes cannot be wrong about on our behalf:
//
//   * that upstream's own castle path (src/main.js:359) reaches our card at all,
//     and reaches TOAD's on any castle that is not 8-4;
//   * that endSession({cleared:true}) starts 1-1 again instead of the title;
//   * that the engine then BUILDS buzzy beetles where 1-1's goombas were,
//     rather than that our copy of the spec list said it would.
//
// The user's ask: "on completing 8-4, there should be peach saying what she
// should be saying that we done it and then up the difficulty for next run".
test('the princess ends the game and starts a harder one', { timeout: 180000 }, async (t) => {
  const ctx = await boot();
  const { page } = ctx;
  t.after(() => shutdown(ctx));

  // The engine's own tick, in batches, yielding to the macrotask queue between
  // them: onLevelComplete is an async IIFE with real awaits in it (the tally,
  // the card, the next loadLevel), and a synchronous run() would never let any
  // of them resolve.
  const tick = (n) =>
    page.evaluate(async (total) => {
      for (let i = 0; i < total; i += 10) {
        window.__TELEGRAPH.run(Math.min(10, total - i));
        await new Promise((r) => setTimeout(r, 0));
      }
    }, n);

  // Straight to the axe, with no time left on the clock so the tally is short.
  const clear = (id) =>
    page.evaluate(async (lvl) => {
      await window.__GAME.loadLevel(lvl);
      window.__GAME.world.time = 0;
      window.__GAME.game.onLevelComplete();
    }, id);

  await t.test('an ordinary castle still gets Toad, not the Princess', async () => {
    await clear('1-4');
    // Past the tally (54 intro + 96 hold) and into the card.
    await tick(200);
    const s = await page.evaluate(() => ({
      state: window.__GAME.screens.state,
      princess: window.__QUEST.card(),
      quest: window.__QUEST.n(),
      hard: window.__QUEST.hard(),
    }));
    assert.equal(s.state, 'castle', 'no castle card came up on 1-4');
    assert.equal(s.princess, null, '1-4 showed the Princess: the two endings are confused');
    assert.equal(s.quest, 1);
    assert.equal(s.hard.primary, false);
    // Let Toad's card run out and 2-1 load, so the next subtest starts clean.
    await tick(700);
  });

  await t.test('8-4 gets the Princess, and her lines arrive on the ROM\'s clock', async () => {
    await clear('8-4');
    await tick(200);
    const opened = await page.evaluate(() => window.__QUEST.card());
    assert.ok(opened, '8-4 did not show the Princess');
    // She thanks him first and says nothing else for three counter steps.
    assert.deepEqual(opened.lines, ['THANK YOU MARIO!']);
    assert.equal(opened.hold, 574);

    // Step 3 of the counter, 192 frames in: the quest line and the ending music.
    await tick(200 - opened.t + 5);
    const mid = await page.evaluate(() => window.__QUEST.card());
    assert.ok(mid, 'the card closed early');
    assert.deepEqual(mid.lines, ['THANK YOU MARIO!', 'YOUR QUEST IS OVER.']);

    // And by the last step, all five, in the original's order and wording.
    await tick(200);
    const full = await page.evaluate(() => window.__QUEST.card());
    assert.ok(full, 'the card closed before the last line');
    assert.deepEqual(full.lines, [
      'THANK YOU MARIO!',
      'YOUR QUEST IS OVER.',
      'WE PRESENT YOU A NEW QUEST.',
      'PUSH BUTTON B',
      'TO SELECT A WORLD',
    ]);
  });

  await t.test('and then 1-1 starts again, as a second quest', async () => {
    // Out of the card, through endSession, into the new run's intro.
    await tick(400);
    const s = await page.evaluate(() => ({
      level: window.__GAME.game.levelId,
      quest: window.__QUEST.n(),
      hard: window.__QUEST.hard(),
      lives: window.__GAME.world.lives,
      state: window.__GAME.screens.state,
    }));
    assert.equal(s.level, '1-1', 'the second quest did not start on 1-1');
    assert.equal(s.quest, 2);
    // Primary hard mode forces SECONDARY hard mode on in world 1, which it is
    // never on for in the first quest (it starts at 5-3).
    assert.equal(s.hard.primary, true);
    assert.equal(s.hard.secondary, true);
    assert.equal(s.lives, 3, 'the new quest did not get a fresh stock');
    assert.notEqual(s.state, 'title', 'the game went back to the title instead');
  });

  await t.test('1-1\'s goombas come back as buzzy beetles, and faster', async () => {
    const w = await page.evaluate(() => window.__QUEST.walkers());
    assert.ok(w.length > 0, '1-1 spawned no walkers at all');
    assert.equal(
      w.filter((e) => e.type === 'goomba').length,
      0,
      'a goomba survived into the second quest'
    );
    const buzzies = w.filter((e) => e.type === 'buzzy');
    assert.ok(buzzies.length > 0, "1-1's goombas did not become buzzy beetles");
    // $f8 -> $f4 in the ROM's sixteenths of a pixel: 0.5 -> 0.75 px/frame.
    for (const e of w) {
      if (!e.winged) assert.equal(e.speed, 0.75, `${e.type} still walks at ${e.speed}`);
    }
  });

  await t.test('a game over ends the quest: the next run from the title is quest 1', async () => {
    await page.evaluate(() => {
      window.__GAME.game.onGameOver();
    });
    await tick(600);
    const s = await page.evaluate(() => ({
      quest: window.__QUEST.n(),
      hard: window.__QUEST.hard(),
      state: window.__GAME.screens.state,
    }));
    assert.equal(s.state, 'title', 'a game over did not return to the title');
    assert.equal(s.quest, 1);
    assert.equal(s.hard.primary, false);
    assert.equal(s.hard.secondary, false, '1-1 is still in secondary hard mode');
  });

  assert.deepEqual(ctx.errors, [], 'the page threw');
});
