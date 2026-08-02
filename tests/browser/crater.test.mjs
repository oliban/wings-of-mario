import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

test('destructible terrain', { timeout: 120000 }, async (t) => {
  const ctx = await boot();
  const { page } = ctx;
  t.after(() => shutdown(ctx));

  await t.test('a bomb clears solid ground', async () => {
    await page.evaluate(() => window.__GAME.loadLevel('1-1'));
    const r = await page.evaluate(() => {
      const w = window.__GAME.world;
      const before = w.tileAt(20, 13).solid;
      const changed = window.__GAME.blast(20 * 16 + 8, 13 * 16 + 8, 2);
      return { before, changed, after: w.tileAt(20, 13).solid };
    });
    assert.ok(r.before, 'expected solid ground at tile 20,13 of 1-1');
    assert.ok(r.changed.length > 0, 'blast destroyed nothing');
    assert.ok(!r.after, 'tile survived the blast');
  });

  await t.test('damage is reported back as sorted tile keys', async () => {
    const keys = await page.evaluate(() => window.__GAME.damageKeys());
    assert.ok(keys.includes('20,13'));
    assert.deepEqual(keys, [...keys].sort());
  });

  await t.test('the crater survives a reload of the same level', async () => {
    const keys = await page.evaluate(() => window.__GAME.damageKeys());
    const after = await page.evaluate(async (damage) => {
      await window.__GAME.loadLevel('1-1', null, damage);
      return {
        solid: window.__GAME.world.tileAt(20, 13).solid,
        keys: window.__GAME.damageKeys(),
      };
    }, keys);
    assert.ok(!after.solid, 'reloading the level healed the crater');
    assert.deepEqual(after.keys, keys);
  });

  await t.test('a clean reload restores the ground', async () => {
    const solid = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      return window.__GAME.world.tileAt(20, 13).solid;
    });
    assert.ok(solid, 'damage leaked into an undamaged load');
  });

  await t.test('a splash into open air destroys nothing and records nothing', async () => {
    const r = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      const before = window.__GAME.damageKeys();
      // Rows 0-1 of 1-1 are pure sky; tile 5,1 and its neighbours are all air.
      const changed = window.__GAME.blast(5 * 16 + 8, 1 * 16 + 8, 1);
      return { changed, before, after: window.__GAME.damageKeys() };
    });
    assert.deepEqual(r.changed, [], 'a blast into open air should destroy nothing');
    assert.deepEqual(r.after, r.before, 'a blast into open air should record nothing');
  });

  await t.test('a tile the live blast left alone does not vanish on reload', async () => {
    const r = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      const w = window.__GAME.world;
      // Tile 20,2 is a decor cloud ('c') — not solid, not platform, not climb —
      // sitting well above 1-1's ground rows, so a small blast centred on it
      // never touches solid tile.
      const before = w.tileAt(20, 2).decor;
      window.__GAME.blast(20 * 16 + 8, 2 * 16 + 8, 1);
      const survivedLiveBlast = w.tileAt(20, 2).decor;
      const damage = window.__GAME.damageKeys();
      await window.__GAME.loadLevel('1-1', null, damage);
      const survivedReload = window.__GAME.world.tileAt(20, 2).decor;
      return { before, survivedLiveBlast, survivedReload };
    });
    assert.ok(r.before, 'expected decor cloud at tile 20,2 of 1-1');
    assert.ok(r.survivedLiveBlast, 'the live blast destroyed a tile it should have left alone');
    assert.ok(r.survivedReload, 'the tile vanished on reload though the live blast left it alone');
  });

  await t.test('Mario falls into a crater blown out beneath him', async () => {
    const r = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(20, 11);
      window.__GAME.tick(40); // let him fall the two tiles onto the ground and settle
      const p = window.__GAME.world.player;
      const groundedBefore = p.grounded;
      const yBefore = p.y;
      // Clear a wide, deep hole directly under him. Rows 13-14 are the only
      // ground in this stretch of 1-1, so this opens straight through to the pit.
      window.__GAME.blast(20 * 16 + 8, 13 * 16 + 8, 3);
      window.__GAME.tick(30);
      return { groundedBefore, yBefore, groundedAfter: p.grounded, y: p.y };
    });
    assert.ok(r.groundedBefore, 'Mario was not standing on anything to begin with');
    assert.ok(
      !r.groundedAfter && r.y > r.yBefore,
      `Mario ignored the hole (grounded=${r.groundedAfter}, y=${r.yBefore} -> ${r.y})`
    );
  });

  await t.test('no uncaught page errors', () => {
    assert.deepEqual(ctx.errors, []);
  });
});
