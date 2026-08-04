import test from 'node:test';
import assert from 'node:assert/strict';
import { bootRoom, shutdownRoom } from './helpers.mjs';

// THE USER'S TEST, in the user's terms: "bomb had no effect on mario".
//
// Everything here is asserted on Mario's own tile map and his own life count —
// never on a message having been sent, because a message that arrives and
// changes nothing is exactly the bug this file exists to catch.
//
// The pilot flies a real bombing run with the bot primitives, the same call the
// user typed. Nothing below reaches into the network layer to make a crater
// happen by hand.
test('the pilot\'s bombs reach Mario', { timeout: 180000 }, async (t) => {
  const ctx = await bootRoom({ room: 'ACDE' });
  t.after(() => shutdownRoom(ctx));
  const { mario, pilot } = ctx;

  // Both tabs are backgrounded as far as Chromium is concerned, so its rAF
  // throttle would be what we were measuring if we slept and hoped. Mario's
  // pump is called directly; the pilot's rides on __WINGS.tick(), which steps
  // the simulation and the network together exactly as the real loop does.
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

  // Fly the run the user flew, then keep the simulation moving until the bomb
  // has actually fallen: bombTile returns on RELEASE, not on impact.
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
    const cratered = await pilot.page.evaluate(
      (id) => window.__WINGS.sim.islandById(id).keys().length,
      island
    );
    assert.ok(cratered > 0, 'the bomb never cratered the island on the PILOT\'s screen');
    return cratered;
  };

  await t.test('1. a bomb craters the level Mario is standing in', async () => {
    await mario.page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(6, 11);
      window.__GAME.tick(30);
    });
    await settle();
    assert.equal(
      await mario.page.evaluate(() => window.__GAME.damageKeys().length),
      0,
      'Mario started with damage he should not have'
    );

    // Well away from where Mario is standing: this outcome is about terrain.
    await bombRun('1-1', 20, 13);

    const keys = await mario.page.evaluate(() => window.__GAME.damageKeys());
    assert.ok(keys.length > 0, 'THE USER\'S BUG: the bomb had no effect on Mario');

    // The same tiles, not merely some tiles.
    const theirs = await pilot.page.evaluate(
      () => window.__WINGS.sim.islandById('1-1').keys()
    );
    assert.deepEqual(keys, theirs.slice().sort(), 'the two clients cratered different tiles');
  });

  await t.test('2. a bomb on Mario kills him, and it counts', async () => {
    const livesBefore = await mario.page.evaluate(() => window.__GAME.world.lives);
    const at = await mario.page.evaluate(() => {
      const p = window.__GAME.world.player;
      // The tile he is standing in, which is what the pilot would aim at.
      return { tx: Math.floor((p.x + p.w / 2) / 16), ty: Math.floor((p.y + p.h / 2) / 16) };
    });
    await bombRun('1-1', at.tx, at.ty);

    // Decided on MARIO's machine: _blastKill is what calls die('bomb'), and
    // nothing else in the engine passes that cause. Asserting the cause rather
    // than the death matters — dropping the ground out from under him kills him
    // a second later by pit fall, which would pass with the kill deleted.
    await mario.page.waitForFunction(
      () => {
        const p = window.__GAME.world.player;
        return (p.state === 'dying' || p.dead) && p._deathCause === 'bomb';
      },
      null,
      { timeout: 15000 }
    );

    // And it counts toward the pilot winning: the life is spent, and the pilot
    // hears it from Mario rather than deciding it himself.
    await mario.page.evaluate(() => {
      for (let i = 0; i < 240; i++) {
        window.__GAME.tick(1);
        window.__NET.pump();
      }
    });
    await mario.page.waitForTimeout(300);
    const lives = await mario.page.evaluate(() => window.__GAME.world.lives);
    assert.equal(lives, livesBefore - 1, 'the bomb did not cost Mario a life');
    const seen = await pilot.page.evaluate(() => window.__WINGS.net.state().marioLives);
    assert.equal(seen, livesBefore - 1, `the pilot saw marioLives=${seen}`);
  });

  await t.test('3. an island pre-bombed before Mario arrives is still cratered', async () => {
    // The strategy the whole archipelago exists for, and the case a naive
    // "apply it to the level that happens to be loaded" implementation drops on
    // the floor: Mario has ONE level loaded, the server holds the whole map.
    await mario.page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.tick(10);
    });
    await settle();

    await bombRun('1-2', 18, 13);
    const expected = await pilot.page.evaluate(
      () => window.__WINGS.sim.islandById('1-2').keys()
    );
    assert.ok(expected.length > 0);

    // Mario was nowhere near 1-2 and must not have been given its craters yet.
    const onWrongLevel = await mario.page.evaluate(() => window.__GAME.damageKeys());
    for (const k of expected) {
      assert.ok(!onWrongLevel.includes(k), `1-2's crater ${k} was applied to 1-1`);
    }

    // He walks the flagpole and arrives. The craters have to be waiting.
    await mario.page.evaluate(async () => {
      await window.__GAME.loadLevel('1-2');
      window.__GAME.tick(10);
    });
    await settle();

    const onArrival = await mario.page.evaluate(() => window.__GAME.damageKeys());
    for (const k of expected) {
      assert.ok(
        onArrival.includes(k),
        `1-2 was pre-bombed but arrived intact: ${k} is missing of ${expected.length}`
      );
    }
  });

  await t.test('the server logged no desyncs or faults', () => {
    assert.deepEqual(ctx.server.serverErrors, []);
  });

  await t.test('no uncaught page errors on either side', () => {
    assert.deepEqual(ctx.mario.errors, []);
    assert.deepEqual(ctx.pilot.errors, []);
  });
});
