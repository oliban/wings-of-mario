import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { boot, shutdown } from './helpers.mjs';
import { GUN_INTERVAL, ORDNANCE } from '../../src/wings/ordnance.js';

const SHOT_DIR = process.env.WOM_SHOT_DIR || null;

// Holding X is a machine gun, through the real keyboard and through the
// scripted API alike. The rate itself is unit-tested against the sim
// (tests/unit/gun-auto.test.js); what only a browser can show is that the KEY
// reaches it — the keyboard latch in pilot-main.js used to guarantee exactly
// one round per press, and that is the thing that changed.
test('holding X is a machine gun', { timeout: 120000 }, async (t) => {
  const ctx = await boot({ path: '/pilot.html?headless', global: '__WINGS' });
  t.after(() => shutdown(ctx));
  const { page } = ctx;

  const fly = (opts = {}) => page.evaluate((o) => {
    const W = window.__WINGS;
    W.reset();
    W.release();
    const p = W.sim.plane;
    p.mode = 'air';
    p.gear = false;
    p.angle = 0;
    p.x = o.x == null ? 900 : o.x;
    p.y = o.y == null ? 200 : o.y;
    p.speed = o.speed == null ? 2.7 : o.speed;
    p.vx = p.speed;
    p.vy = 0;
    return true;
  }, opts);

  const gun = () => page.evaluate(() => window.__WINGS.sim.loadout.gun);
  const tick = (n) => page.evaluate((k) => window.__WINGS.tick(k), n);

  await t.test('the key held down keeps firing', async () => {
    await fly();
    const before = await gun();
    await page.keyboard.down('KeyX');
    await tick(60);
    await page.keyboard.up('KeyX');
    const spent = before - (await gun());
    assert.equal(spent, Math.floor(59 / GUN_INTERVAL) + 1,
      `holding X for 60 ticks spent ${spent} rounds`);
    // And it stops when the key comes up.
    const after = await gun();
    await tick(60);
    assert.equal(await gun(), after, 'the gun kept firing after the key came up');
  });

  await t.test('a tap is still exactly one round', async () => {
    await fly();
    const before = await gun();
    await page.keyboard.press('KeyX');
    await tick(1);
    assert.equal(before - (await gun()), 1, 'a tap of X is no longer one round');
  });

  await t.test('hold({fire: true}) repeats at the same rate as the key', async () => {
    await fly();
    const before = await gun();
    await page.evaluate(() => window.__WINGS.hold({ pitch: 0, thrust: 0, fire: true }));
    await tick(60);
    await page.evaluate(() => window.__WINGS.release());
    assert.equal(before - (await gun()), Math.floor(59 / GUN_INTERVAL) + 1,
      'the scripted trigger and the keyboard trigger disagree');
  });

  await t.test('holding Space still drops exactly one bomb', async () => {
    await fly();
    const before = await page.evaluate(() => window.__WINGS.sim.loadout.bomb);
    await page.keyboard.down('Space');
    await tick(60);
    await page.keyboard.up('Space');
    const after = await page.evaluate(() => window.__WINGS.sim.loadout.bomb);
    assert.equal(after, before - 1, 'the gun change made the bomb repeat too');
  });

  await t.test('the magazine lasts the expected sortie, then the gun goes quiet', async () => {
    await fly();
    await page.keyboard.down('KeyX');
    // Long enough to empty it several times over.
    await tick(ORDNANCE.gun.load * GUN_INTERVAL + 200);
    const state = await page.evaluate(() => ({
      gun: window.__WINGS.sim.loadout.gun,
      dry: window.__WINGS.events().filter((e) => e.type === 'dryFire').length,
      fatal: window.__WINGS.fatal(),
    }));
    await page.keyboard.up('KeyX');
    assert.equal(state.fatal, null);
    assert.equal(state.gun, 0, 'the magazine did not empty');
    assert.equal(state.dry, 1, `a held empty trigger clicked ${state.dry} times`);
  });

  // Not an assertion — a picture of a burst in the air, for the eyeball check.
  await t.test('a burst in flight', async () => {
    await fly({ x: 700, y: 190 });
    await page.keyboard.down('KeyX');
    await tick(45);
    await page.keyboard.up('KeyX');
    const inAir = await page.evaluate(
      () => window.__WINGS.sim.shots.filter((s) => s.kind === 'gun').length
    );
    assert.ok(inAir >= 5, `only ${inAir} rounds in the air at once — that is not a stream`);
    if (SHOT_DIR) {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const png = await page.evaluate(() => window.__WINGS.snapshot('image/png'));
      fs.writeFileSync(`${SHOT_DIR}/burst.png`, Buffer.from(png.split(',')[1], 'base64'));
    }
    assert.equal(await page.evaluate(() => window.__WINGS.fatal()), null);
  });

  assert.deepEqual(ctx.errors, [], 'the page logged errors');
});
