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
    // The lever starts at idle, so Right has to open the throttle before Down
    // does anything; Down is pull-back, and pull-back is what rotates once
    // there is flying speed (rotating off the ground is a climb input on a
    // real elevator too — Down is not special-cased here, it is just pitch>0).
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowDown');
    await page.evaluate(() => window.__WINGS.tick(220));
    await page.keyboard.up('ArrowDown');
    await page.keyboard.up('ArrowRight');
    const after = await page.evaluate(() => window.__WINGS.state());

    assert.equal(after.mode, 'air', 'holding Down never got the plane airborne');
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
  // Uses W.hold({pitch}) directly (a held pull-back, pitch:1), not a real key
  // — the real-key version of "which arrow completes the loop" lives below.
  await t.test('holding pull-back turns the plane by looping it round', async () => {
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

  // Real keydown/keyup, not W.hold() — this is the one test that proves the
  // physical Down arrow, not just a pitch value, is the one that lifts the
  // nose — in level flight, facing either way, across repeated reversals.
  // Down is pull-back; Up is push-forward. Which one used to climb depended
  // on heading (see flight.js's stepAir upright/controlSign machinery); now
  // it must not, once each reversal's roll has landed.
  await t.test('the real Down arrow always lifts the plane in level flight, across repeated reversals', async () => {
    await page.evaluate(() => window.__WINGS.reset());

    // Take off (Down rotates it off, per the new keymap) and climb to a safe
    // altitude, level and facing east, entirely under autopilot — mirrors
    // "holding pull-back turns the plane by looping it round" above, which
    // established this same climb-out. ArrowRight stays physically held
    // throughout so the throttle lever is already open once control is
    // handed to the real keyboard below.
    await page.keyboard.down('ArrowRight');
    await page.evaluate(() => {
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
      W.release();
    });

    // One held pull-back through a half-loop, then coast level long enough
    // for the roll to land (mirrors flight.js's ROLL_SETTLE_TICKS), then hand
    // back to the real keyboard.
    const reverse = () => page.evaluate(() => {
      const W = window.__WINGS;
      W.hold({ pitch: 1, throttle: 1, gear: false });
      let ticks = 0;
      const startCos = Math.sign(Math.cos(W.state().angle)) || 1;
      // Keep pulling until level and facing the OPPOSITE way (not just past
      // the sign flip — that is still mid-loop, nowhere near level).
      while ((Math.sign(Math.cos(W.state().angle)) === startCos || Math.abs(Math.cos(W.state().angle)) < 0.99) && ticks < 200) {
        W.tick(1);
        ticks++;
      }
      W.hold({ pitch: 0, throttle: 1, gear: false });
      for (let i = 0; i < 30; i++) W.tick(1);
      W.release();
    });

    // Two reversals: east -> west -> east again. Down must lift every time.
    for (let i = 0; i < 2; i++) {
      await reverse();
      await page.keyboard.down('ArrowDown');
      const before = await page.evaluate(() => window.__WINGS.state());
      await page.evaluate(() => window.__WINGS.tick(15));
      const after = await page.evaluate(() => window.__WINGS.state());
      assert.ok(Math.abs(Math.cos(before.angle)) > 0.9, `reversal ${i}: test premise, should be level`);
      assert.ok(after.y < before.y, `reversal ${i}: the real Down arrow did not climb (heading cos=${Math.cos(before.angle).toFixed(2)})`);
      await page.keyboard.up('ArrowDown');
    }
    await page.keyboard.up('ArrowRight');
  });

  await t.test('reports no page errors', () => {
    assert.deepEqual(errors, []);
  });

  // The renderer catches exceptions thrown inside a layer callback so one bad
  // frame cannot kill the page — which also means a broken draw is SILENT. This
  // flies a full circuit and then asks. A negative cloud radius shipped once
  // because nothing checked.
  await t.test('nothing in the scene throws across a whole sortie', async () => {
    await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      W.hold({ pitch: 0, throttle: 1 });
      W.tick(60);
      W.hold({ pitch: 1, throttle: 1 });
      W.tick(240);
      W.hold({ pitch: -1, throttle: 1 });
      W.tick(240);
      W.hold({ pitch: 0, throttle: 0 });
      W.tick(400);
      W.release();
    });
    assert.equal(await page.evaluate(() => window.__WINGS.fatal()), null);
    assert.deepEqual(errors, []);
  });
});
