import test from 'node:test';
import assert from 'node:assert/strict';
import { bootRoom, shutdownRoom } from './helpers.mjs';

// Mario goes down a pipe into 1-1's warp zone. The plane cannot follow him
// there, so for as long as he is down there he is not on the pilot's screen at
// all — no contact drawn over the island, no blip on the tube. This is the
// whole feature, played out through two real browsers and the real engine:
// the level is loaded by src/game/world.js, the flag rides a real WebSocket,
// and the assertions are on what the pilot's client actually holds.
test('Mario down a pipe is off the pilot\'s screen', { timeout: 180000 }, async (t) => {
  const ctx = await bootRoom({ room: 'ACDF' });
  t.after(() => shutdownRoom(ctx));
  const { mario, pilot } = ctx;

  // Both halves driven by hand rather than by frames: a backgrounded tab has
  // its rAF throttled to about a frame a second, so a test that slept would be
  // measuring Chromium's throttler. The wire is the one thing that gets real
  // time. 120 pilot ticks is more than one radar sweep (90), so every settle
  // gives the antenna at least one look.
  const settle = async (frames = 120) => {
    await mario.page.evaluate((n) => {
      for (let i = 0; i < n; i++) window.__NET.pump();
    }, frames);
    await mario.page.waitForTimeout(250);
    await pilot.page.evaluate((n) => window.__WINGS.tick(n), frames);
  };

  // Everything the pilot could use to put Mario on screen.
  const seenByPilot = () =>
    pilot.page.evaluate(() => {
      const s = window.__WINGS.scene;
      return {
        remote: window.__WINGS.net.remote(),
        drawn: s.remoteMario ? { x: s.remoteMario.x, y: s.remoteMario.y } : null,
        blip: window.__WINGS.radar(),
      };
    });

  await t.test('on the island he is visible, on the ground', async () => {
    await mario.page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(30, 12);
      window.__GAME.tick(30);
    });
    await settle();
    const seen = await seenByPilot();
    assert.ok(seen.remote, 'the pilot never saw Mario on the island in the first place');
    assert.equal(seen.remote.island, '1-1');
    assert.ok(seen.drawn, 'the scene had no contact to draw');
    assert.ok(seen.blip, 'the radar never got a fix, so losing one proves nothing');

    // And he is where the terrain is, not floating: the island band runs from
    // ISLAND_TOP_Y (320) down to SEA_Y (560).
    assert.ok(
      seen.remote.y > 320 && seen.remote.y < 560,
      `contact at y ${seen.remote.y} is not on the island band`
    );
  });

  await t.test('the warp zone is a sub-area, and the engine says so', async () => {
    // The signal, read off the real engine rather than assumed. Note that the
    // level id does NOT change — which is exactly why the pilot's side could
    // not have worked this out for itself.
    const inArea = await mario.page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1', '1-1w');
      window.__GAME.tick(10);
      return {
        areaId: window.__GAME.world.areaId,
        level: window.__GAME.stats().level,
      };
    });
    assert.equal(inArea.areaId, '1-1w', 'world.areaId is the signal this feature rides on');
    assert.equal(inArea.level, '1-1', 'the level id is unchanged, so it cannot be the signal');
  });

  await t.test('while he is down there the pilot has nothing to draw or hunt', async () => {
    await settle();
    const seen = await seenByPilot();
    assert.equal(seen.remote, null, 'the pilot still has a world position for a man in a pipe');
    assert.equal(seen.drawn, null, 'the scene would draw a contact floating over the island');
    assert.equal(seen.blip, null, 'the tube still shows a blip the pilot could fly to and bomb');
  });

  await t.test('and the snapshot on the wire carries no position at all', async () => {
    const snap = await mario.page.evaluate(() => {
      const st = window.__NET.state();
      return { island: st.island, reach: window.__NET.snapshot() };
    });
    assert.equal(snap.reach.reach, 0, 'Mario\'s own client is the one that says he is unreachable');
    assert.equal('x' in snap.reach, false, 'a warp-zone x is not a place on the island');
    assert.equal(snap.reach.island, '1-1', 'the island he will come back up on still travels');
  });

  await t.test('he comes back up where he came back up, without sliding in', async () => {
    // Out of the pipe and a long way from where he went in. If the gap were
    // interpolated the pilot would watch him glide across the island — so the
    // FIRST frame the contact exists again must already be at the right place.
    await mario.page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(140, 12);
      window.__GAME.tick(30);
    });
    await settle();

    const [local, seen] = await Promise.all([
      mario.page.evaluate(() => ({
        x: window.__GAME.world.player.x,
        y: window.__GAME.world.player.y,
        areaId: window.__GAME.world.areaId,
      })),
      seenByPilot(),
    ]);
    assert.equal(local.areaId, null, 'Mario is not back on the island');
    assert.ok(seen.remote, 'the pilot never got Mario back');
    assert.ok(seen.blip, 'the tube stayed dark after he came back up');

    const originX = await pilot.page.evaluate(
      (id) => window.__WINGS.sim.islandById(id).originX,
      seen.remote.island
    );
    assert.ok(
      Math.abs(seen.remote.x - (originX + local.x)) < 48,
      `contact at ${seen.remote.x}, expected about ${originX + local.x} — a slide from a stale`
      + ' position would land it hundreds of pixels short'
    );
    assert.ok(
      Math.abs(seen.remote.y - (320 + local.y)) < 48,
      `contact at y ${seen.remote.y}, expected about ${320 + local.y}`
    );
  });

  await t.test('neither page faulted', async () => {
    assert.deepEqual(mario.errors, []);
    assert.deepEqual(pilot.errors, []);
    assert.deepEqual(ctx.server.serverErrors, []);
  });
});
