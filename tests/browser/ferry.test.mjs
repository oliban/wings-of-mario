import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

test('the crossing', async (t) => {
  const ctx = await boot();
  const page = ctx.page;
  t.after(() => shutdown(ctx));

  // Stop the rAF loop so `tick(n)` then `pump()` advances the ride by exactly
  // n steps. The ride rides on the overlay's hooks, so pump() is what moves
  // the boat — there is no engine seam doing it.
  await page.evaluate(() => window.__GAME.pause());

  await t.test('boarding loads the ferry and puts Mario on the planking', async () => {
    const r = await page.evaluate(async () => {
      await window.__FERRY.board({ fromX: 3000, toX: 4200 });
      window.__TELEGRAPH.run(2);
      const w = window.__GAME.world;
      return {
        level: w.level.id,
        w: w.w,
        h: w.h,
        onSolid: !!w.tileAtPixel(w.player.x + 8, w.player.y + 20).solid,
        phase: window.__FERRY.state().phase,
      };
    });
    assert.equal(r.level, 'ferry');
    assert.equal(r.w, 16, 'the boat level must be exactly one screen wide');
    assert.equal(r.h, 15);
    assert.equal(r.onSolid, true, 'Mario is not standing on anything');
    assert.equal(r.phase, 'boarding');
  });

  await t.test('she gets under way and arrives', async () => {
    const r = await page.evaluate(async () => {
      await window.__FERRY.board({ fromX: 3000, toX: 3600, to: '1-2' });
      const total = window.__FERRY.ride.ferry.total;
      window.__TELEGRAPH.run(total + 2);
      return { total, state: window.__FERRY.state() };
    });
    assert.ok(r.total > 60, 'a crossing you can miss has to take some time');
    assert.equal(r.state.phase, 'arrived');
    assert.equal(r.state.progress, 1);
  });

  await t.test('a torpedo takes the deck out from under him', async () => {
    const r = await page.evaluate(async () => {
      await window.__FERRY.board({ fromX: 3000, toX: 6000 });
      window.__TELEGRAPH.run(60); // under way
      const before = window.__GAME.world.tileAt(7, 9).solid;
      window.__FERRY.sink();
      window.__TELEGRAPH.run(1);
      const w = window.__GAME.world;
      return {
        before: !!before,
        after: !!w.tileAt(7, 9).solid,
        phase: window.__FERRY.state().phase,
        damage: window.__GAME.damageKeys().length,
        dead: !!(w.player && w.player.dead),
      };
    });
    assert.equal(r.before, true, 'test premise: there was a deck there');
    assert.equal(r.after, false, 'the deck survived the torpedo');
    assert.equal(r.phase, 'sunk');
    assert.ok(r.damage >= 12, `only ${r.damage} tiles went, the whole deck should`);
    assert.equal(r.dead, true, 'a sunk ferry has to cost a life');
  });

  await t.test('the ferry level did not leak into the level roster', async () => {
    const inOrder = await page.evaluate(async () => {
      const m = await import('/src/data/levels/index.js');
      return { order: m.ORDER.includes('ferry'), registered: !!m.LEVELS.ferry };
    });
    assert.deepEqual(inOrder, { order: false, registered: true },
      'the ferry must be loadable but must never be a level you can advance INTO');
  });

  await t.test('no uncaught page errors', async () => {
    assert.deepEqual(ctx.errors, []);
  });
});
