import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';
import { SAIL } from '../../src/wings/sail.js';
import { WingsSim } from '../../src/wings/sim.js';

// THE CARRIER GROUP FOLLOWING MARIO BACK, on the real page.
//
// Everything about WHEN this happens — which level changes are a restart, which
// are progress, which are a match ending — is decided in plain Node
// (tests/unit/carrier-follows.test.js), because it is pure. What only a browser
// can answer is whether the group actually ARRIVES: the ocean really rebuilt
// for world 1, the aeroplane really back on the deck with a full squadron, and
// the card really saying that nothing was cleared.
//
// ?headless leaves the rAF loop stopped, so the page is driven one fixed
// simulation step at a time by __WINGS.tick(n) and every assertion is at a
// named tick rather than after a wait.
test('the carrier group follows mario back', async (t) => {
  const ctx = await boot({ path: '/pilot.html?headless', global: '__WINGS' });
  t.after(() => shutdown(ctx));
  const { page, errors } = ctx;

  await t.test('starts over world 5, with the ocean bombed and the squadron down', async () => {
    const s = await page.evaluate(() => {
      const W = window.__WINGS;
      // Where a match would be after Mario had cleared four worlds.
      W.world(5);
      W.tick(400);
      W.takeoff(600);
      W.hold({ thrust: 1, drop: true, gear: false });
      W.tick(2);
      W.hold({ thrust: 1, gear: false });
      W.tick(20);
      return { world: W.world(), state: W.state(), islands: W.sim.islands.map((i) => i.id) };
    });
    assert.equal(s.world, 5);
    assert.deepEqual(s.islands, ['5-1', '5-2', '5-3', '5-4']);
    assert.equal(s.state.mode, 'air');
    assert.ok(s.state.shots.length > 0, 'nothing in the air to be abandoned');
  });

  await t.test('mario restarts on 1-1 and the group puts to sea after him', async () => {
    const s = await page.evaluate(() => {
      const W = window.__WINGS;
      // What src/net/pilot-side.js#onWorldReset does when Mario's client says
      // his run has restarted on 1-1. It is a REPOSITION, not a sail: the
      // crossing is going backwards, which a sail refuses outright.
      const started = W.reposition(1);
      return { started, crossing: W.crossing(), world: W.world() };
    });
    assert.equal(s.started, true, 'the group refused to follow him back');
    assert.equal(s.crossing.from, 5);
    assert.equal(s.crossing.to, 1);
    assert.equal(s.crossing.world, 5, 'the ocean changed before the fade did');
  });

  await t.test('the ocean is rebuilt for world 1 under a fully black screen', async () => {
    const s = await page.evaluate((swap) => {
      const W = window.__WINGS;
      W.tick(swap);
      return {
        crossing: W.crossing(),
        state: W.state(),
        islands: W.sim.islands.map((i) => i.id),
      };
    }, SAIL.SWAP);
    assert.equal(s.crossing.veil, 1, 'the swap was visible');
    assert.equal(s.crossing.world, 1);
    assert.deepEqual(s.islands, ['1-1', '1-2', '1-3', '1-4']);
    // The pilot begins again from the deck with everything he had at the start
    // of a world, exactly as on a sail forward.
    assert.equal(s.state.mode, 'deck');
    assert.equal(s.state.speed, 0);
    assert.equal(s.state.squadron, 5, 'the squadron was not replenished');
    assert.deepEqual(s.state.shots, [], 'ordnance survived the crossing');

    // Black over the play area AND over the instrument panel: a lit panel
    // showing through would say the aeroplane was still there to fly.
    const px = await page.evaluate(() => {
      const r = window.__WINGS.renderer;
      const c = r.buffer.getContext('2d');
      const at = (x, y) => [...c.getImageData(x * r.ss, y * r.ss, 1, 1).data].slice(0, 3);
      return { world: at(256, 90), panel: at(60, 225) };
    });
    assert.ok(px.world[0] + px.world[1] + px.world[2] < 12, `world showing: ${px.world}`);
    assert.ok(px.panel[0] + px.panel[1] + px.panel[2] < 12, `panel showing: ${px.panel}`);
  });

  await t.test('the card says the run ended, and never that a world was secured', async () => {
    const s = await page.evaluate(() => {
      const W = window.__WINGS;
      W.tick(40);
      const view = W.scene.sailView;
      return { crossing: W.crossing(), title: view.title, lines: view.lines, text: view.text };
    });
    assert.equal(s.crossing.phase, 'hold');
    assert.ok(s.text > 0.9, `text at alpha ${s.text}`);
    const card = [s.title, ...s.lines].join(' | ');
    // The lie this whole transition exists to avoid. "WORLD 5 SECURED" over a
    // run that just ended tells the player he won the world he just lost.
    assert.equal(/SECURED/.test(card), false, card);
    assert.match(card, /CARRIER GROUP/);
    assert.match(card, /WORLD 5 IS OVER/);
    assert.match(card, /WORLD 1 ARCHIPELAGO/);
    assert.match(card, /SQUADRON REPLENISHED/);
  });

  await t.test('the world 1 ocean comes up, and it is the seed\'s own', async () => {
    const s = await page.evaluate((total) => {
      const W = window.__WINGS;
      W.release();
      W.tick(total);
      return {
        crossing: W.crossing(),
        sailView: W.scene.sailView,
        world: W.world(),
        seed: W.sim.archipelago.seed,
        islands: W.sim.islands.map((i) => ({ id: i.id, x: i.originX })),
        fatal: W.fatal(),
      };
    }, SAIL.TOTAL);
    assert.equal(s.crossing, null, 'the crossing never ended');
    assert.equal(s.sailView, null, 'the card is still being submitted');
    assert.equal(s.world, 1);
    assert.ok(!s.fatal, `the renderer did not survive the rebuild: ${s.fatal}`);

    // The ocean a client that had never left world 1 would be flying over,
    // computed OUT of the browser from the same seed. The layout is a pure
    // function of (seed, world), so the two must be identical — that is the
    // invariant keeping Mario's client and this one on one sea, and a rebuild
    // that drifted from it would be undetectable in play.
    const fresh = new WingsSim({ seed: s.seed, world: 1 })
      .islands.map((i) => ({ id: i.id, x: i.originX }));
    assert.deepEqual(s.islands, fresh);
  });

  await t.test('nothing threw', () => {
    assert.deepEqual(errors, []);
  });
});
