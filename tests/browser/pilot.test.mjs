import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

// pilot.html booted with ?headless leaves the rAF loop stopped, so the page is
// driven one fixed step at a time by __WINGS.tick(). Real keydown/keyup events
// go through the page's own listeners on the way in — this is the only place
// that proves the keyboard a player actually uses is wired to the flight model.
test('the pilot page', async (t) => {
  const ctx = await boot({ path: '/pilot.html?headless', global: '__WINGS' });
  t.after(() => shutdown(ctx));
  const { page, errors } = ctx;

  await t.test('boots onto the deck with a 512x240 viewport', async () => {
    const s = await page.evaluate(() => {
      const W = window.__WINGS;
      return {
        state: W.state(),
        view: [W.renderer.viewW, W.renderer.viewH],
        ss: W.renderer.ss,
        buffer: [W.renderer.buffer.width, W.renderer.buffer.height],
        painted: W.renderer.frames > 0,
        fatal: W.fatal(),
      };
    });
    assert.equal(s.state.mode, 'deck');
    assert.equal(s.state.squadron, 5);
    // The pilot's WORLD is still 512x240 world pixels at Mario's scale; the
    // buffer behind it is supersampled so the vector art comes out smooth.
    assert.deepEqual(s.view, [512, 240]);
    assert.deepEqual(s.buffer, [512 * s.ss, 240 * s.ss]);
    assert.ok(s.painted, 'the page never painted a frame');
    assert.equal(s.fatal, null);
  });

  await t.test('the arrow keys fly the plane off the deck', async () => {
    const before = await page.evaluate(() => window.__WINGS.state());
    // The lever starts at idle, so Right has to open the throttle before Up
    // does anything; Up is what rotates once there is flying speed.
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowUp');
    await page.evaluate(() => window.__WINGS.tick(220));
    await page.keyboard.up('ArrowUp');
    await page.keyboard.up('ArrowRight');
    const after = await page.evaluate(() => window.__WINGS.state());

    assert.equal(after.mode, 'air', 'holding Up never got the plane airborne');
    assert.equal(after.gear, false, 'the hook should retract on rotation');
    assert.ok(after.x - before.x > 80, 'used almost no deck');
    assert.ok(after.y < before.y, 'the plane never climbed');
  });

  await t.test('Right advances the throttle and Left retards it, continuously', async () => {
    await page.evaluate(() => window.__WINGS.reset());
    // Fresh plane, lever at idle.
    assert.equal((await page.evaluate(() => window.__WINGS.state())).throttle, 0);

    await page.keyboard.down('ArrowRight');
    await page.evaluate(() => window.__WINGS.tick(30));
    const midClimb = await page.evaluate(() => window.__WINGS.state());
    await page.evaluate(() => window.__WINGS.tick(60));
    const full = await page.evaluate(() => window.__WINGS.state());
    await page.keyboard.up('ArrowRight');

    assert.ok(midClimb.throttle > 0 && midClimb.throttle < 1, 'a partial hold should be a partial advance, not a snap to full');
    assert.ok(full.throttle > midClimb.throttle, 'holding Right longer should keep advancing the throttle');
    assert.equal(full.throttle, 1, 'holding Right long enough should reach full throttle');

    // Release: the lever holds where it is, it does not fall back to idle.
    await page.evaluate(() => window.__WINGS.tick(30));
    const held = await page.evaluate(() => window.__WINGS.state());
    assert.equal(held.throttle, 1, 'the throttle drifted with no key held');

    await page.keyboard.down('ArrowLeft');
    await page.evaluate(() => window.__WINGS.tick(30));
    const midDescent = await page.evaluate(() => window.__WINGS.state());
    await page.evaluate(() => window.__WINGS.tick(90));
    const idle = await page.evaluate(() => window.__WINGS.state());
    await page.keyboard.up('ArrowLeft');

    assert.ok(midDescent.throttle < held.throttle && midDescent.throttle > 0, 'Left should be retarding the lever gradually');
    assert.equal(idle.throttle, 0, 'holding Left long enough should reach idle');
  });

  // Looping straight off the deck brings the plane back down onto the ship with
  // the hook up, which is a crash — correctly. So climb out and level off
  // first, exactly as a pilot would before turning back for the islands.
  await t.test('holding Up turns the plane by looping it round', async () => {
    await page.evaluate(() => window.__WINGS.reset());
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      const norm = (a) => {
        const t = Math.PI * 2;
        let v = a % t;
        if (v > Math.PI) v -= t;
        if (v <= -Math.PI) v += t;
        return v;
      };
      const toward = (tgt) => {
        const d = norm(W.state().angle - tgt);
        W.hold({ pitch: d > 0.02 ? 1 : d < -0.02 ? -1 : 0, throttle: 1, gear: false });
        W.tick(1);
      };
      W.hold({ throttle: 1, pitch: 0 });
      while (W.state().mode !== 'air') W.tick(1);
      while (W.state().y > 260) toward(-0.55);
      for (let i = 0; i < 150; i++) toward(0);

      let sum = 0;
      let prev = W.state().angle;
      let ticks = 0;
      W.hold({ throttle: 1, pitch: 1, gear: false });
      while (Math.abs(sum) < Math.PI * 2 && ticks < 300) {
        W.tick(1);
        const a = W.state().angle;
        sum += norm(a - prev);
        prev = a;
        ticks++;
      }
      return { sum, ticks, mode: W.state().mode };
    });
    assert.equal(r.mode, 'air', 'the plane did not survive the loop');
    assert.ok(Math.abs(r.sum) >= Math.PI * 2, `only turned ${r.sum.toFixed(2)} rad`);
    assert.ok(r.ticks > 40 && r.ticks < 200, `a loop taking ${r.ticks} ticks is not Wings of Fury`);
  });

  await t.test('the plane stays inside the viewport on the way out', async () => {
    await page.evaluate(() => window.__WINGS.reset());
    const worst = await page.evaluate(() => {
      const W = window.__WINGS;
      W.hold({ throttle: 1, pitch: 0 });
      while (W.state().mode !== 'air') W.tick(1);
      W.hold({ throttle: 1, pitch: 0 });
      let maxSx = 0;
      for (let i = 0; i < 600; i++) {
        W.tick(1);
        const s = W.state();
        maxSx = Math.max(maxSx, s.x - s.cam.x);
      }
      return maxSx;
    });
    assert.ok(worst < 512, `the plane reached screen x ${worst.toFixed(0)} and left the view`);
  });

  await t.test('reports no page errors', () => {
    assert.deepEqual(errors, []);
  });
});
