import test from 'node:test';
import assert from 'node:assert/strict';
import { bootRoom, shutdownRoom } from './helpers.mjs';

// THE USER'S BUG, in the user's terms: "when underground, bombs should not
// reach. Currently I bomb ground on 1-1 but bombs ALSO affect underground level
// warp zone."
//
// The engine keeps `levelId` at '1-1' for the whole of 1-1 INCLUDING its
// sub-areas — loadArea reloads the root level with an areaId rather than
// changing the id — so the network's islandId() said '1-1' while Mario stood in
// the underground coin room. The key '40,9' names one tile on the surface and a
// completely different tile down there, so every crater the pilot made was
// replayed into a map it was never dropped on.
//
// Asserted on Mario's own tile map, never on a message: a message that arrives
// and changes the wrong thing is the bug.
test('bombs do not reach down a pipe', { timeout: 180000 }, async (t) => {
  const ctx = await bootRoom({ room: 'ACDE' });
  t.after(() => shutdownRoom(ctx));
  const { mario, pilot } = ctx;

  const settle = async (frames = 45) => {
    await pilot.page.evaluate((n) => window.__WINGS.tick(n), frames);
    await mario.page.evaluate((n) => {
      for (let i = 0; i < n; i++) window.__NET.pump();
    }, frames);
    await mario.page.waitForTimeout(250);
    await pilot.page.evaluate((n) => window.__WINGS.tick(n), frames);
    await mario.page.evaluate((n) => {
      for (let i = 0; i < n; i++) window.__NET.pump();
    }, frames);
  };

  const bombRun = async (island, tx, ty) => {
    const released = await pilot.page.evaluate(
      ({ id, x, y }) => {
        window.__WINGS.takeoff(900);
        return window.__WINGS.bombTile(id, x, y, 12000);
      },
      { id: island, x: tx, y: ty }
    );
    assert.equal(released, true, `the pilot could not bomb ${island} ${tx},${ty}`);
    await settle(120);
  };

  // The surface craters, so there is something for the sub-area to be wrongly
  // given. Everything below turns on this list being non-empty.
  let surfaceKeys = [];

  await t.test('the pilot craters the surface of 1-1 while Mario is on it', async () => {
    await mario.page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(6, 11);
      window.__GAME.tick(30);
    });
    await settle();
    await bombRun('1-1', 20, 13);

    surfaceKeys = await mario.page.evaluate(() => window.__GAME.damageKeys());
    assert.ok(surfaceKeys.length > 0, 'nothing was cratered, so this proves nothing');
  });

  await t.test('down the pipe, the surface craters are not in the tile map', async () => {
    // 1-1b is 1-1's underground coin room: the same levelId, a different map.
    const underground = await mario.page.evaluate(() => {
      const w = window.__GAME.world;
      w.loadArea('1-1b', 3, 3);
      // PUMPED, which is the whole point. syncLevelDamage runs on the net pump,
      // once per frame in a real game, and the sub-area's load emptied
      // world.damage — so it is exactly here that the retained surface craters
      // used to be pushed into the wrong map. Without these frames this asserts
      // nothing and passes with the bug in.
      for (let i = 0; i < 30; i++) {
        window.__GAME.tick(1);
        window.__NET.pump();
      }
      return {
        areaId: w.areaId,
        level: window.__GAME.stats().level,
        damage: window.__GAME.damageKeys(),
      };
    });
    // The premise of the whole bug: the id did NOT change.
    assert.equal(underground.level, '1-1', 'the sub-area changed levelId; this test is moot');
    assert.equal(underground.areaId, '1-1b');
    assert.deepEqual(underground.damage, [], 'THE USER\'S BUG: surface craters were applied underground');
  });

  await t.test('and a bomb dropped while he is down there does not reach him', async () => {
    await bombRun('1-1', 24, 13);
    const after = await mario.page.evaluate(() => ({
      areaId: window.__GAME.world.areaId,
      damage: window.__GAME.damageKeys(),
    }));
    assert.equal(after.areaId, '1-1b', 'he came up on his own; the run below is not a test');
    assert.deepEqual(after.damage, [], 'a live bomb cratered the underground map');
  });

  await t.test('the craters are still there when he climbs back out', async () => {
    // They were never lost — the server holds them, and this side re-applies
    // the whole set the moment the surface is the map again. That is the half
    // of the fix that a bare "do not apply underground" would have broken.
    await mario.page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.tick(10);
    });
    await settle();

    const back = await mario.page.evaluate(() => window.__GAME.damageKeys());
    assert.ok(back.length > 0, 'the surface came back undamaged: the craters were lost');
    for (const k of surfaceKeys) {
      assert.ok(back.includes(k), `crater ${k} did not survive the trip underground`);
    }
    // And the two clients still agree, which is what the desync detector
    // compares and what the whole split-authority design turns on.
    const theirs = await pilot.page.evaluate(
      () => window.__WINGS.sim.islandById('1-1').keys()
    );
    assert.deepEqual(back, theirs.slice().sort(), 'the two clients hold different craters');
  });

  await t.test('nothing faulted on either side', () => {
    assert.deepEqual(pilot.errors, []);
    assert.deepEqual(mario.errors, []);
    assert.deepEqual(ctx.server.serverErrors, []);
  });
});
