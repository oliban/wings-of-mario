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

  await t.test('a decor tile hanging in mid-air is destroyed by a blast', async () => {
    const r = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      const w = window.__GAME.world;
      // Tile 20,2 is a decor cloud ('c') — not solid, not platform, not climb —
      // sitting well above 1-1's ground rows. Section 4.1 of the design spec
      // says no material is immune, clouds included.
      const before = w.tileAt(20, 2).decor;
      const changed = window.__GAME.blast(20 * 16 + 8, 2 * 16 + 8, 1);
      const survivedLiveBlast = w.tileAt(20, 2).decor;
      return { before, changed, survivedLiveBlast };
    });
    assert.ok(r.before, 'expected decor cloud at tile 20,2 of 1-1');
    assert.ok(r.changed.includes('20,2'), 'blast did not destroy the decor cloud');
    assert.ok(!r.survivedLiveBlast, 'the decor cloud survived the blast');
  });

  await t.test('a free-standing coin is destroyed by a blast', async () => {
    const r = await page.evaluate(async () => {
      // 1-1's bonus room (1-1b) has a row of free-standing coins at y=5,
      // x=5..9 — 'o' tiles, solid:false, not platform, not climb.
      await window.__GAME.loadLevel('1-1', '1-1b');
      const w = window.__GAME.world;
      const before = w.tileAt(5, 5).coin;
      const changed = window.__GAME.blast(5 * 16 + 8, 5 * 16 + 8, 1);
      const survivedLiveBlast = w.tileAt(5, 5).coin;
      return { before, changed, survivedLiveBlast };
    });
    assert.ok(r.before, 'expected a free-standing coin at tile 5,5 of 1-1b');
    assert.ok(r.changed.includes('5,5'), 'blast did not destroy the free-standing coin');
    assert.ok(!r.survivedLiveBlast, 'the free-standing coin survived the blast');
  });

  await t.test('a live blast and a reload agree on a mixed solid/non-solid region', async () => {
    const r = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      const w = window.__GAME.world;
      // Column 2, rows 10-13 of 1-1 stack decor hill ('h', not solid) directly
      // on top of ground ('#', solid) — a blast here hits both kinds at once.
      const changed = window.__GAME.blast(2 * 16 + 8, 12 * 16 + 8, 2);
      const keys = window.__GAME.damageKeys();
      const liveTiles = keys.map((k) => {
        const [tx, ty] = k.split(',').map(Number);
        return { k, name: w.tileAt(tx, ty).name };
      });
      await window.__GAME.loadLevel('1-1', null, keys);
      const w2 = window.__GAME.world;
      const reloadedTiles = keys.map((k) => {
        const [tx, ty] = k.split(',').map(Number);
        return { k, name: w2.tileAt(tx, ty).name };
      });
      const reloadedKeys = window.__GAME.damageKeys();
      return { changed, keys, liveTiles, reloadedTiles, reloadedKeys };
    });
    assert.ok(r.changed.length > 1, 'expected the blast to hit more than one tile');
    assert.ok(r.liveTiles.every((t) => t.name === 'air'), 'live blast left a non-air tile in its own damage set');
    assert.deepEqual(r.reloadedKeys, r.keys, 'reload recorded a different damage set than the live blast');
    assert.deepEqual(
      r.reloadedTiles.map((t) => t.name),
      r.liveTiles.map((t) => t.name),
      'reload produced a different map than the live blast'
    );
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
