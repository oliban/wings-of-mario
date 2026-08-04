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

  await t.test('a bombed decor tile actually stops being drawn, not just cleared from the tile map', async () => {
    // `w.tileAt(20, 2).decor` (the subtest above) only proves the tile RECORD
    // changed. `drawBackground` never reads the tile map — it renders straight
    // from `w.decor`, a display list snapshotted once at load by `_buildDecor()`.
    // A blast that clears the map but never rebuilds that list leaves the
    // cloud's sprite (and any partial shape it leaves behind) exactly as it
    // was, forever, until the next reload. So rather than guess which pixel
    // coordinates the cloud's decor entry lands at, compare the whole `w.decor`
    // display list — live, right after the blast — against what a fresh load
    // of the same level with the same damage produces. If the live list was
    // never rebuilt, it will still match the UNDAMAGED list, not the damaged
    // one.
    const r = await page.evaluate(async () => {
      const snapshot = (w) => w.decor.map((d) => `${d.x},${d.y}`).sort();
      await window.__GAME.loadLevel('1-1');
      const w = window.__GAME.world;
      const cleanDecor = snapshot(w);
      // Tile 20,2 is a decor cloud ('c') well above 1-1's ground rows.
      const changed = window.__GAME.blast(20 * 16 + 8, 2 * 16 + 8, 1);
      const liveDecor = snapshot(w);
      await window.__GAME.loadLevel('1-1', null, changed);
      const reloadedDecor = snapshot(window.__GAME.world);
      return { changed, cleanDecor, liveDecor, reloadedDecor };
    });
    assert.ok(r.changed.length > 0, 'expected the blast to destroy at least one tile');
    assert.notDeepEqual(r.liveDecor, r.cleanDecor, 'the blast did not change w.decor at all');
    assert.deepEqual(r.liveDecor, r.reloadedDecor, 'a live blast and a reload of the same damage disagree on w.decor');
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

  await t.test('destroying an already-damaged key returns nothing and does not re-fire feedback', async () => {
    const r = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      const w = window.__GAME.world;
      // Destroy 20,13 for real first, so the second call below is a genuine
      // repeat hit rather than relying on damage left over from earlier tests.
      w.destroyTiles(['20,13']);
      let sfxCalls = 0;
      let shakeCalls = 0;
      const origSfx = w.sfx.bind(w);
      const origShake = w.shake.bind(w);
      w.sfx = (...a) => {
        sfxCalls++;
        return origSfx(...a);
      };
      w.shake = (...a) => {
        shakeCalls++;
        return origShake(...a);
      };
      const changed = w.destroyTiles(['20,13']);
      w.sfx = origSfx;
      w.shake = origShake;
      return { changed, sfxCalls, shakeCalls };
    });
    assert.deepEqual(r.changed, [], 'destroying an already-damaged key should destroy nothing');
    assert.equal(r.sfxCalls, 0, 'a no-op destroyTiles should not play the break sound again');
    assert.equal(r.shakeCalls, 0, 'a no-op destroyTiles should not shake the screen again');
  });

  await t.test('malformed and non-string keys are ignored by applyDamage, not thrown or destructive', async () => {
    const r = await page.evaluate(async () => {
      // Tile 3,13 is solid ground on row 13 of 1-1, same row as the very
      // first subtest's tile 20,13 — it is the one well-formed key here.
      const bogus = ['', '0', ' 3,13', 1, null, [1, 2], '3,13'];
      await window.__GAME.loadLevel('1-1', null, bogus);
      const w = window.__GAME.world;
      return {
        originTileSolid: w.tileAt(0, 0).solid,
        realKeyApplied: !w.tileAt(3, 13).solid,
        keys: window.__GAME.damageKeys(),
      };
    });
    // Tile (0,0) of 1-1 is sky — this only proves nothing NEW got destroyed
    // there, since air was already air. The real guard is that loadLevel
    // completed at all: a non-string element used to throw mid-load.
    assert.ok(!r.originTileSolid, 'tile (0,0) unexpectedly reported solid');
    assert.ok(r.realKeyApplied, 'the one well-formed key in the batch was not applied');
    assert.deepEqual(r.keys, ['3,13'], 'only the well-formed key should have been recorded');
  });

  await t.test('Mario falls into a crater blown out ahead of him', async () => {
    const r = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      // Five tiles back from the blast centre below — close enough that the
      // hole reaches him once he walks into it, far enough that the
      // detonation itself doesn't overlap his hitbox (that's covered by the
      // blast-kill tests above; this one is purely about terrain collapse).
      window.__GAME.teleport(15, 11);
      window.__GAME.tick(40); // let him fall the two tiles onto the ground and settle
      const p = window.__GAME.world.player;
      const groundedBefore = p.grounded;
      const yBefore = p.y;
      // Clear a wide, deep hole. Rows 13-14 are the only ground in this
      // stretch of 1-1, so this opens straight through to the pit.
      window.__GAME.blast(20 * 16 + 8, 13 * 16 + 8, 3);
      window.__GAME.hold({ right: true, run: true });
      // Just enough ticks to walk into the crater and start falling — not so
      // many that he reaches the pit-death hazard below, which is a separate,
      // pre-existing mechanic this test has no business exercising.
      window.__GAME.tick(35);
      window.__GAME.release();
      return { groundedBefore, yBefore, groundedAfter: p.grounded, y: p.y, dead: !!p.dead };
    });
    assert.ok(r.groundedBefore, 'Mario was not standing on anything to begin with');
    assert.ok(!r.dead, 'Mario died walking towards the hole — the blast reached him, invalidating this test');
    assert.ok(
      !r.groundedAfter && r.y > r.yBefore,
      `Mario ignored the hole (grounded=${r.groundedAfter}, y=${r.yBefore} -> ${r.y})`
    );
  });

  await t.test('an enemy inside the blast dies', async () => {
    const r = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      const w = window.__GAME.world;
      // Open air well clear of any tile geometry — the goomba only needs to
      // exist here for one tick, not stand on anything.
      const e = w.spawn('goomba', 100, 100);
      const before = { dead: !!e.dead, removed: !!e.removed };
      window.__GAME.blast(e.x + e.w / 2, e.y + e.h / 2, 2);
      return { before, after: { dead: !!e.dead, removed: !!e.removed } };
    });
    assert.ok(!r.before.dead && !r.before.removed, 'goomba was already dead before the blast');
    assert.ok(r.after.dead || r.after.removed, 'goomba survived a blast centred on it');
  });

  await t.test('an enemy outside the blast survives', async () => {
    const r = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      const w = window.__GAME.world;
      const e = w.spawn('goomba', 100, 100);
      // Far enough away, in both x and y, that a radius-1 blast can't reach it.
      window.__GAME.blast(e.x + 400, e.y + 400, 1);
      return { dead: !!e.dead, removed: !!e.removed };
    });
    assert.ok(!r.dead && !r.removed, 'a blast that never reached the goomba killed it anyway');
  });

  await t.test('Mario dies to a blast on him and loses a life', async () => {
    const r = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(20, 11);
      window.__GAME.tick(10); // let him land and settle, well clear of star/invuln windows
      const w = window.__GAME.world;
      const p = w.player;
      const livesBefore = w.lives;
      const stateBefore = p.state;
      window.__GAME.blast(p.x + p.w / 2, p.y + p.h / 2, 2);
      const immediately = { dead: !!p.dead, state: p.state };
      // Run the normal death sequence (rise, freeze, fall off the bottom of
      // the screen) out to completion so onPlayerDeath actually fires.
      window.__GAME.tick(300);
      return { livesBefore, stateBefore, immediately, livesAfter: w.lives };
    });
    assert.equal(r.stateBefore, 'normal', 'Mario was not in his normal state before the blast');
    assert.ok(r.immediately.dead && r.immediately.state === 'dying', 'blast did not run the normal death path');
    assert.equal(r.livesAfter, r.livesBefore - 1, 'blast death did not cost a life');
  });

  // A bomb is lethal at ANY power level. Unlike a Goomba's touch, a blast
  // must not merely demote big/fire Mario to small — it has to kill him
  // outright, the same as falling in a pit does regardless of power.
  for (const power of ['big', 'fire']) {
    await t.test(`a blast kills ${power} Mario outright, not just a power-down`, async () => {
      const r = await page.evaluate(async (pwr) => {
        await window.__GAME.loadLevel('1-1');
        window.__GAME.teleport(20, 11);
        window.__GAME.tick(10);
        const w = window.__GAME.world;
        const p = w.player;
        window.__GAME.setPower(pwr);
        const powerBefore = p.power;
        window.__GAME.blast(p.x + p.w / 2, p.y + p.h / 2, 2);
        return { powerBefore, dead: !!p.dead, state: p.state, powerAfter: p.power };
      }, power);
      assert.notEqual(r.powerBefore, 'small', `setPower('${power}') did not actually power Mario up`);
      assert.ok(
        r.dead && r.state === 'dying',
        `blast demoted ${power} Mario (power ${r.powerBefore} -> ${r.powerAfter}) instead of killing him`
      );
    });
  }

  await t.test('star power is the one deliberate exception — a starred Mario survives a direct blast', async () => {
    const r = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(20, 11);
      window.__GAME.tick(10);
      const w = window.__GAME.world;
      const p = w.player;
      window.__GAME.setPower('star');
      const starBefore = p.starFrames > 0;
      window.__GAME.blast(p.x + p.w / 2, p.y + p.h / 2, 2);
      return { starBefore, dead: !!p.dead, state: p.state };
    });
    assert.ok(r.starBefore, "setPower('star') did not actually grant star power");
    assert.ok(!r.dead && r.state === 'normal', 'a starred Mario died to a blast — star is supposed to survive it');
  });

  await t.test('destroyTiles does not kill — only a live blast does', async () => {
    const r = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      const w = window.__GAME.world;
      const e = w.spawn('goomba', 160, 160); // tile 10,10
      const changed = w.destroyTiles(['10,10', '10,11', '9,10', '11,10']);
      return { changed, dead: !!e.dead, removed: !!e.removed };
    });
    assert.ok(!r.dead && !r.removed, 'destroyTiles killed an entity — that responsibility belongs to blast() alone');
  });

  await t.test('no uncaught page errors', () => {
    assert.deepEqual(ctx.errors, []);
  });
});
