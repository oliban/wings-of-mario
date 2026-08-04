import test from 'node:test';
import assert from 'node:assert/strict';
import { bootRoom, shutdownRoom } from './helpers.mjs';

// The milestone: two browsers, one room, each seeing the other move in the
// right place in a shared coordinate space. Every assertion below is on real
// state — a position, an island id, a canvas — and never on a message count,
// because a socket that is busy is not the same thing as a player who is there.
test('two browsers in one room', { timeout: 180000 }, async (t) => {
  const ctx = await bootRoom({ room: 'ACDE' });
  t.after(() => shutdownRoom(ctx));
  const { mario, pilot } = ctx;

  // Drive both halves by hand rather than waiting on frames.
  //
  // Only one browser tab can be in the foreground, and Chromium throttles
  // requestAnimationFrame in the other one to roughly a frame a second. Both
  // sides here are backgrounded as far as the browser is concerned, so a test
  // that slept and hoped would be measuring the throttler. Mario's pump is
  // called directly; the pilot's rides on __WINGS.tick(), which is the scripted
  // control surface stepping the simulation and the network together exactly as
  // the real game loop does.
  //
  // The one thing that DOES need real time is the wire: the messages cross an
  // actual WebSocket on an actual server.
  const settle = async (frames = 45) => {
    await mario.page.evaluate((n) => {
      for (let i = 0; i < n; i++) window.__NET.pump();
    }, frames);
    await mario.page.waitForTimeout(250);
    await pilot.page.evaluate((n) => window.__WINGS.tick(n), frames);
  };

  await t.test('both sides joined the same room with the same seed', async () => {
    const m = await mario.page.evaluate(() => window.__NET.state());
    const p = await pilot.page.evaluate(() => window.__WINGS.net.state());
    assert.equal(m.room, 'ACDE');
    assert.equal(p.room, 'ACDE');
    assert.equal(m.side, 'mario');
    assert.equal(p.side, 'pilot');
    assert.equal(m.peer, true, 'mario should see the pilot');
    assert.equal(p.peer, true, 'the pilot should see mario');
    // The seed is the ocean. Two different seeds is two different
    // archipelagos, and every coordinate below would be meaningless.
    const seeds = await Promise.all([
      mario.page.evaluate(() => window.__NET.session.seed),
      pilot.page.evaluate(() => window.__WINGS.net.session.seed),
    ]);
    assert.equal(seeds[0], seeds[1]);
    assert.equal(typeof seeds[0], 'number');
  });

  await t.test('the pilot sees Mario move', async () => {
    await mario.page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(6, 11);
    });
    await settle();
    const before = await pilot.page.evaluate(() => {
      const r = window.__WINGS.net.remote();
      return r ? { x: r.x, island: r.island } : null;
    });
    assert.ok(before, 'the pilot never received a snapshot of Mario');
    assert.equal(before.island, '1-1');

    await mario.page.evaluate(() => {
      window.__GAME.hold({ right: true, run: true });
      window.__GAME.tick(90);
      window.__GAME.release();
    });
    await settle();
    const after = await pilot.page.evaluate(() => {
      const r = window.__WINGS.net.remote();
      return r ? { x: r.x } : null;
    });
    assert.ok(after, 'the pilot lost Mario mid-run');
    assert.ok(after.x > before.x + 32, `Mario ran but the pilot saw ${before.x} -> ${after.x}`);
  });

  await t.test('the contact is in the right place in world coordinates', async () => {
    // Mario on island 1-1 must appear at THAT ISLAND'S origin plus his local
    // x — not at his local x, and not at the carrier. This is the coordinate
    // contract, and it is the one thing in this task that cannot be fudged.
    const [local, world] = await Promise.all([
      mario.page.evaluate(() => ({
        x: window.__GAME.world.player.x,
        y: window.__GAME.world.player.y,
        level: window.__GAME.stats().level,
      })),
      pilot.page.evaluate(() => {
        const r = window.__WINGS.net.remote();
        const isle = window.__WINGS.sim.islandById(r.island);
        return { x: r.x, y: r.y, originX: isle.originX };
      }),
    ]);
    assert.equal(local.level, '1-1');
    assert.ok(
      Math.abs(world.x - (world.originX + local.x)) < 48,
      `contact at ${world.x}, expected about ${world.originX + local.x} (one interp delay of slack)`
    );
    // And the vertical conversion too, which has no interpolation slack worth
    // speaking of because Mario is standing still on the ground by now.
    assert.ok(
      Math.abs(world.y - (320 + local.y)) < 48,
      `contact at y ${world.y}, expected about ${320 + local.y} (ISLAND_TOP_Y + local y)`
    );
  });

  await t.test('Mario sees the plane move', async () => {
    const before = await mario.page.evaluate(() => {
      for (let i = 0; i < 45; i++) window.__NET.pump();
      const r = window.__NET.remote();
      return r ? r.x : null;
    });
    // A takeoff run, stepped synchronously. __WINGS.tick drives pilot.update(),
    // which is where the network pump hangs, so the snapshots go out with it.
    await pilot.page.evaluate(() => {
      window.__WINGS.hold({ pitch: 1, thrust: 1 });
      window.__WINGS.tick(240);
      window.__WINGS.release();
    });
    await pilot.page.waitForTimeout(250);
    const after = await mario.page.evaluate(() => {
      for (let i = 0; i < 45; i++) window.__NET.pump();
      const r = window.__NET.remote();
      return r ? r.x : null;
    });
    assert.ok(before !== null && after !== null, 'no plane snapshot reached Mario');
    assert.notEqual(Math.round(before), Math.round(after), 'the plane took off and Mario saw nothing');
  });

  await t.test('the plane is actually DRAWN on Mario\'s screen, in pixels', async () => {
    // Everything above this asserts state. This asserts ink: fly the aeroplane
    // to just above Mario's head and count what the overlay actually painted.
    // A coordinate contract that is right in the numbers and wrong on the glass
    // is still a game in which the two players cannot see each other.
    const flown = await pilot.page.evaluate(() => {
      const r = window.__WINGS.net.remote();
      const ok = window.__WINGS.flyTo(r.x + 12, r.y - 48);
      // The bot primitives drive the sim directly and bypass pilot.update(),
      // so nothing has been transmitted yet; these ticks are what send it.
      window.__WINGS.tick(60);
      return ok;
    });
    assert.equal(flown, true, 'the bot could not fly the aeroplane over Mario');
    await pilot.page.waitForTimeout(250);

    const shot = await mario.page.evaluate(() => {
      for (let i = 0; i < 45; i++) window.__NET.pump();
      const c = document.getElementById('net-overlay');
      const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let ink = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 0) ink++;
      const r = window.__NET.remote();
      return { ink, sx: r && Math.round(r.x - r.camX), sy: r && Math.round(r.y - r.camY) };
    });
    assert.ok(
      shot.ink > 100,
      `the overlay is blank: ${shot.ink} lit pixels with the plane at ${shot.sx},${shot.sy}`
    );
  });

  await t.test('the contact is inside the pilot\'s viewport, not culled away', async () => {
    const seen = await pilot.page.evaluate(() => {
      const s = window.__WINGS.scene;
      const r = s.remoteMario;
      if (!r) return null;
      // The same frame the renderer used, so this is the cull drawContact runs.
      const f = s.frame(window.__WINGS.sim);
      return {
        sx: r.x - f.cam.x, sy: r.y - f.cam.y, vw: f.vw, vh: f.vh,
      };
    });
    assert.ok(seen, 'the pilot has no contact at all');
    assert.ok(
      seen.sx > -12 && seen.sx < seen.vw && seen.sy > -16 && seen.sy < seen.vh,
      `contact at ${seen.sx},${seen.sy} is outside the ${seen.vw}x${seen.vh} viewport`
    );
  });

  await t.test('the overlay canvas exists and is the game screen size', async () => {
    const box = await mario.page.evaluate(() => {
      const c = document.getElementById('net-overlay');
      return c ? { w: c.width, h: c.height } : null;
    });
    assert.deepEqual(box, { w: 256, h: 240 });
  });

  await t.test('a peer that leaves is announced and stops being drawn', async () => {
    await pilot.page.evaluate(() => window.__WINGS.net.session.close());
    await mario.page.waitForFunction(() => window.__NET.state().peer === false, null, { timeout: 10000 });
    const remote = await mario.page.evaluate(() => {
      window.__NET.pump();
      return window.__NET.remote();
    });
    assert.equal(remote, null, 'the plane must not hang in the sky after the pilot leaves');
  });

  await t.test('the server logged no desyncs or faults', () => {
    assert.deepEqual(ctx.server.serverErrors, []);
  });

  await t.test('no uncaught page errors on either side', () => {
    assert.deepEqual(ctx.mario.errors, []);
    assert.deepEqual(ctx.pilot.errors, []);
  });
});
