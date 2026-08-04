import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

// The same sortie tests/unit/bot.test.js flies with no canvas at all, this
// time through a real Chromium tab and the same window.__WINGS a human
// plays through. If the bots only work against the bare WingsSim and not
// against the page's own instance of it, they are not the primitives the
// networking tests can build on.
test('a full sortie flies through __WINGS in a real browser', { timeout: 60000 }, async (t) => {
  const ctx = await boot({ path: '/pilot.html?headless', global: '__WINGS' });
  const { page, errors } = ctx;
  t.after(() => shutdown(ctx));

  await t.test('boots onto the deck with a full squadron', async () => {
    const s = await page.evaluate(() => window.__WINGS.state());
    assert.equal(s.mode, 'deck');
    assert.equal(s.squadron, 5);
    assert.equal(s.fuel, 100);
    assert.equal(s.status, 'ready');
  });

  await t.test('takeoff gets it off the deck', async () => {
    const r = await page.evaluate(() => ({
      ok: window.__WINGS.takeoff(),
      state: window.__WINGS.state(),
    }));
    assert.equal(r.ok, true, 'the bot never got airborne');
    assert.equal(r.state.mode, 'air');
  });

  await t.test('bombTile flies out and craters the requested tile', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      const dropped = W.bombTile('1-1', 20, 13);
      for (let i = 0; i < 12000 && W.sim.shots.length; i++) W.tick(1);
      return {
        dropped,
        detonation: W.events().find((e) => e.type === 'detonation') || null,
        blocking: W.sim.islandById('1-1').blocksTile(20, 13),
        crater: W.sim.islandById('1-1').keys(),
        mode: W.state().mode,
      };
    });
    assert.equal(r.dropped, true, 'the bomb run never released');
    assert.ok(r.detonation, 'the bomb never detonated');
    assert.equal(r.detonation.island, '1-1');
    assert.ok(r.detonation.keys.includes('20,13'), `crater missed: ${r.detonation.keys}`);
    assert.equal(r.blocking, false, 'the tile survived the bomb');
    assert.ok(r.crater.length > 0, 'the island recorded no damage');
    assert.equal(r.mode, 'air', 'the bomb run killed the pilot');
  });

  await t.test('autoLand gets the aircraft home, refuelled and rearmed', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      // A couple of seconds heading away from the island first, exactly like
      // the tier-1 sortie test, so the landing pattern is a real return leg
      // and not a U-turn straight off the bomb run.
      for (let i = 0; i < 200; i++) W.tick(1);
      const landed = W.land();
      return { landed, state: W.state(), events: W.events().map((e) => e.type) };
    });
    assert.equal(r.landed, true, 'the plane never got home');
    assert.equal(r.state.mode, 'deck');
    assert.equal(r.state.squadron, 5, 'lost an aircraft on a clean sortie');
    assert.equal(r.state.fuel, 100, 'landing did not refuel');
    assert.equal(r.state.loadout.bomb, 12, 'landing did not rearm');
    assert.deepEqual(r.events, ['released', 'detonation', 'landed']);
  });

  await t.test('no uncaught page errors across the whole sortie', async () => {
    assert.equal(await page.evaluate(() => window.__WINGS.fatal()), null);
    assert.deepEqual(errors, []);
  });
});
