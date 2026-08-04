import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';
import { SAIL } from '../../src/wings/sail.js';

// The sail, on the real page. Everything about WHEN it happens is covered in
// plain Node (tests/unit/sail.test.js, tests/net/sail-screen.test.mjs); what
// only a browser can answer is whether the scene actually paints — the veil
// really covering the instrument panel, the aeroplane really respotted, and
// the renderer surviving having the ocean swapped underneath it.
//
// ?headless leaves the rAF loop stopped, so the page is driven one fixed
// simulation step at a time by __WINGS.tick(n) and every assertion below is at
// a named tick rather than after a wait.
test('the carrier group sails', async (t) => {
  const ctx = await boot({ path: '/pilot.html?headless', global: '__WINGS' });
  t.after(() => shutdown(ctx));
  const { page, errors } = ctx;

  // The centre of the play area, in the supersampled buffer the renderer
  // presents from. Black there means the veil is over the world; the panel is
  // sampled too, because a lit instrument panel showing through the fade would
  // say the aeroplane was still there to fly.
  const sample = () => page.evaluate(() => {
    const r = window.__WINGS.renderer;
    const c = r.buffer.getContext('2d');
    const px = (x, y) => [...c.getImageData(x * r.ss, y * r.ss, 1, 1).data].slice(0, 3);
    return { world: px(256, 90), panel: px(60, 225) };
  });
  const black = (p) => p[0] + p[1] + p[2] < 12;

  await t.test('takes off, drops a bomb, and puts the group under way', async () => {
    const s = await page.evaluate((total) => {
      const W = window.__WINGS;
      W.takeoff(600);
      W.hold({ thrust: 1, drop: true, gear: false });
      W.tick(2);
      W.hold({ thrust: 1, gear: false });
      W.tick(20);
      const airborne = W.state();
      const started = W.sail(2);
      return { airborne, started, crossing: W.crossing(), total };
    }, SAIL.TOTAL);
    assert.equal(s.airborne.mode, 'air', 'never got off the deck');
    assert.ok(s.airborne.shots.length > 0, 'nothing in the air to be abandoned');
    assert.equal(s.started, true);
    assert.equal(s.crossing.from, 1);
    assert.equal(s.crossing.to, 2);
    assert.equal(s.crossing.world, 1, 'the ocean changed before the fade did');
  });

  await t.test('the world is still the old one while the screen is fading', async () => {
    const s = await page.evaluate((swap) => {
      const W = window.__WINGS;
      W.tick(swap - 1);
      return { crossing: W.crossing(), state: W.state() };
    }, SAIL.SWAP);
    assert.equal(s.crossing.phase, 'fade-out');
    assert.equal(s.crossing.world, 1);
    assert.ok(s.crossing.veil > 0.9, `veil only ${s.crossing.veil} one tick from black`);
    // The stick is neutral for the whole scene, so nothing new goes in the air.
    assert.equal(s.state.mode, 'air');
  });

  await t.test('the ocean is replaced under a fully black screen', async () => {
    const s = await page.evaluate(() => {
      const W = window.__WINGS;
      W.tick(1);
      return { crossing: W.crossing(), state: W.state(), sim: W.sim.islands.map((i) => i.id) };
    });
    assert.equal(s.crossing.veil, 1, 'the swap was visible');
    assert.equal(s.crossing.world, 2);
    assert.deepEqual(s.sim, ['2-1', '2-2', '2-3', '2-4']);
    // The pilot begins again from the deck, as at the start of a match.
    assert.equal(s.state.mode, 'deck');
    assert.equal(s.state.speed, 0);
    assert.equal(s.state.squadron, 5, 'the squadron was not replenished');
    assert.deepEqual(s.state.shots, [], 'ordnance survived the crossing');

    const px = await sample();
    assert.ok(black(px.world), `world showing through the veil: ${px.world}`);
    assert.ok(black(px.panel), `instrument panel showing through the veil: ${px.panel}`);
  });

  await t.test('the information text is on screen, under the black', async () => {
    const s = await page.evaluate(() => {
      const W = window.__WINGS;
      W.tick(40);
      const view = W.scene.sailView;
      return {
        crossing: W.crossing(),
        title: view.title,
        lines: view.lines,
        text: view.text,
        state: W.state(),
      };
    });
    assert.equal(s.crossing.phase, 'hold');
    // The stick is STILL held at full thrust from the first subtest — hold()
    // persists until release() — and the aeroplane has not moved an inch. The
    // crossing takes the controls for its whole duration, so a player leaning
    // on the throttle does not launch himself off the deck under the black.
    assert.equal(s.state.mode, 'deck');
    assert.equal(s.state.speed, 0);
    assert.ok(s.text > 0.9, `text at alpha ${s.text}`);
    assert.match(s.title, /CARRIER GROUP/);
    assert.match(s.lines.join(' | '), /WORLD 1 SECURED/);
    assert.match(s.lines.join(' | '), /WORLD 2 ARCHIPELAGO/);
    assert.match(s.lines.join(' | '), /SQUADRON REPLENISHED/);
    // Something was drawn where the card is: the black is not the whole story.
    const lit = await page.evaluate(() => {
      const r = window.__WINGS.renderer;
      const c = r.buffer.getContext('2d');
      const d = c.getImageData(0, 80 * r.ss, r.buffer.width, 40 * r.ss).data;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i] + d[i + 1] + d[i + 2]);
      return max;
    });
    assert.ok(lit > 200, `nothing was drawn on the card (brightest ${lit})`);
  });

  await t.test('the new ocean comes up, and the scene costs nothing afterwards', async () => {
    const s = await page.evaluate((total) => {
      const W = window.__WINGS;
      // Hands off the stick before the scene ends, or the throttle held since
      // the first subtest taxis him straight off the new deck.
      W.release();
      // Whatever is left of the crossing, plus a little of the new world.
      W.tick(total);
      return {
        crossing: W.crossing(),
        sailView: W.scene.sailView,
        state: W.state(),
        world: W.sim.archipelago.world,
        fatal: W.fatal(),
      };
    }, SAIL.TOTAL);
    assert.equal(s.crossing, null, 'the crossing never ended');
    assert.equal(s.sailView, null, 'the card is still being submitted');
    assert.equal(s.world, 2);
    assert.equal(s.state.mode, 'deck', 'the aeroplane should be waiting on the deck');
    assert.equal(s.fatal, null);

    const px = await sample();
    assert.ok(!black(px.world), 'the new ocean never came up');
    assert.ok(!black(px.panel), 'the instrument panel never came back');
  });

  await t.test('the pilot flies again on the new ocean', async () => {
    const s = await page.evaluate(() => {
      const W = window.__WINGS;
      const ok = W.takeoff(600);
      return { ok, state: W.state(), fatal: W.fatal() };
    });
    assert.equal(s.ok, true, 'could not get off the deck in the new world');
    assert.equal(s.state.mode, 'air');
    assert.equal(s.fatal, null);
  });

  assert.deepEqual(errors, []);
});

// The other screen. Mario's page has no canvas of its own to draw into — the
// engine's is upstream-owned — so the same scene is a plain element stacked
// over #stage, stepped on the ENGINE'S fixed clock through the overlay hook
// list. __TELEGRAPH.run(n) drives the engine and that hook list in lockstep,
// which is why the assertions below are at named ticks and not after a wait.
test('mario is told the group is sailing too', async (t) => {
  const ctx = await boot({ path: '/index.html', global: '__GAME' });
  t.after(() => shutdown(ctx));
  const { page, errors } = ctx;

  // Onto an island and off the title screen — screens.blocksWorld gates
  // world.update(), so a page left on the title never advances at all — then
  // pause the rAF loop so the page moves exactly as far as __TELEGRAPH.run()
  // says and no further.
  await page.evaluate(async () => {
    await window.__GAME.loadLevel('1-1');
    window.__GAME.pause();
  });

  const read = () => page.evaluate(() => {
    const el = document.getElementById('sail-screen');
    const card = el && el.querySelector('.sail-card');
    const world = window.__GAME.world;
    return {
      mounted: !!el,
      opacity: el ? Number(el.style.opacity) : null,
      visibility: el ? el.style.visibility : null,
      text: card ? Number(card.style.opacity) : null,
      said: card ? card.textContent : '',
      frozen: !!(world && world.isFrozen && world.isFrozen()),
      state: window.__SAIL.state(),
    };
  });

  await t.test('nothing is on screen until a world is cleared', async () => {
    const s = await page.evaluate(() => ({
      wired: typeof window.__SAIL === 'object' && window.__SAIL !== null,
      state: window.__SAIL.state(),
      el: !!document.getElementById('sail-screen'),
    }));
    assert.equal(s.wired, true, '__SAIL never came up');
    assert.equal(s.state.active, false);
    assert.equal(s.state.crossings, 0);
    assert.equal(s.el, false, 'the screen mounted before there was anything to say');
  });

  await t.test('the screen goes black and the level is held still', async () => {
    await page.evaluate((swap) => {
      window.__SAIL.begin({ from: 1, to: 2 });
      window.__TELEGRAPH.run(swap + 20);
    }, SAIL.SWAP);
    const s = await read();
    assert.equal(s.mounted, true);
    assert.equal(s.opacity, 1, 'the veil never reached full black');
    assert.equal(s.visibility, 'visible');
    assert.ok(s.text > 0, 'the text never came up');
    assert.match(s.said, /THE CARRIER GROUP IS UNDER WAY/);
    assert.match(s.said, /WORLD 2 ARCHIPELAGO/);
    // Three seconds of black over a live level is three seconds of a goomba
    // walking into a man who cannot see it coming.
    assert.equal(s.frozen, true, 'the level ran on underneath the black');
  });

  await t.test('the level comes back, live, when the veil lifts', async () => {
    await page.evaluate((total) => window.__TELEGRAPH.run(total), SAIL.TOTAL);
    const s = await read();
    assert.equal(s.state.active, false);
    assert.equal(s.opacity, 0);
    assert.equal(s.visibility, 'hidden');
    assert.equal(s.frozen, false, 'the level is still frozen after the crossing');
    assert.equal(s.state.crossings, 1);
  });

  assert.deepEqual(errors, []);
});
