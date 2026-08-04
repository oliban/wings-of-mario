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
    assert.equal(s.state.turning, false, 'should not start mid-turn');
  });

  await t.test('the arrow keys fly the plane off the deck', async () => {
    const before = await page.evaluate(() => window.__WINGS.state());
    // Right thrusts East, which is the way the plane starts pointed, so it
    // builds speed; DOWN is pull-back, and pull-back is what rotates once
    // there is flying speed.
    //
    // 165 ticks, not the 220 this used to hold for: rotation is at tick 133
    // and the climb is established well before 165, whereas by 220 an
    // unreleased stick has flown a whole loop and is on its way round a second
    // one — which is a loop test, not a takeoff test.
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowDown');
    await page.evaluate(() => window.__WINGS.tick(165));
    await page.keyboard.up('ArrowDown');
    await page.keyboard.up('ArrowRight');
    const after = await page.evaluate(() => window.__WINGS.state());

    assert.equal(after.mode, 'air', 'holding Right+Down never got the plane airborne');
    assert.equal(after.gear, false, 'the hook should retract on rotation');
    assert.ok(after.x - before.x > 80, 'used almost no deck');
    assert.ok(after.y < before.y, 'the plane never climbed');
  });

  // Thrust is a world-frame direction now, not a lever: there is no position
  // to hold once a key is released, only whichever way the aeroplane happens
  // to be travelling under drag. This replaces the old lever tests.
  await t.test('Right accelerates and Left decelerates directly — no lever position to hold', async () => {
    await page.evaluate(() => window.__WINGS.reset());
    // Get airborne and level, facing East, under autopilot.
    await page.evaluate(() => {
      const W = window.__WINGS;
      W.hold({ throttle: 1, thrust: 1, pitch: 0 });
      while (W.state().mode !== 'air') W.tick(1);
      W.release();
    });

    await page.keyboard.down('ArrowRight');
    const before = await page.evaluate(() => window.__WINGS.state());
    await page.evaluate(() => window.__WINGS.tick(60));
    const accelerated = await page.evaluate(() => window.__WINGS.state());
    assert.ok(accelerated.speed > before.speed, 'holding Right facing East should build speed');
    await page.keyboard.up('ArrowRight');

    // Release: no key held, no lever holding position — it just coasts under drag.
    await page.evaluate(() => window.__WINGS.tick(10));
    const coasting = await page.evaluate(() => window.__WINGS.state());
    assert.ok(coasting.speed < accelerated.speed, 'with nothing held it should coast down under drag, not hold speed like the old lever');

    // Same tick count as the coast above, so the comparison is fair.
    await page.keyboard.down('ArrowLeft');
    await page.evaluate(() => window.__WINGS.tick(10));
    const braking = await page.evaluate(() => window.__WINGS.state());
    await page.keyboard.up('ArrowLeft');
    const dCoast = accelerated.speed - coasting.speed;
    const dBrake = coasting.speed - braking.speed;
    assert.ok(dBrake > dCoast, 'holding Left against the heading should decelerate faster than just coasting');
  });

  // Looping straight off the deck brings the plane back down onto the ship with
  // the hook up, which is a crash — correctly. So climb out and level off
  // first, exactly as a pilot would before turning back for the islands.
  // Uses W.hold({pitch}) directly, not a real key — pitch is body-relative and
  // unaffected by the new thrust mechanic, so a full loop still works exactly
  // as before; reversing direction no longer NEEDS one. Thrust here tracks
  // whichever way the nose currently points, the way a player actually flying
  // the loop would hold it, rather than braking itself on the far side.
  await t.test('a loop is still a loop: holding pull-back turns the plane all the way round', async () => {
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
      const facingThrust = () => (Math.cos(W.state().angle) >= 0 ? 1 : -1);
      const toward = (tgt) => {
        const d = norm(W.state().angle - tgt);
        W.hold({ pitch: d > 0.02 ? 1 : d < -0.02 ? -1 : 0, thrust: facingThrust(), gear: false });
        W.tick(1);
      };
      W.hold({ thrust: 1, pitch: 0 });
      while (W.state().mode !== 'air') W.tick(1);
      while (W.state().y > 260) toward(-0.55);
      for (let i = 0; i < 150; i++) toward(0);

      let sum = 0;
      let prev = W.state().angle;
      let ticks = 0;
      let turnTripped = false;
      while (Math.abs(sum) < Math.PI * 2 && ticks < 300) {
        W.hold({ pitch: 1, thrust: facingThrust(), gear: false });
        W.tick(1);
        if (W.state().turning) turnTripped = true;
        const a = W.state().angle;
        sum += norm(a - prev);
        prev = a;
        ticks++;
      }
      return {
        sum, ticks, mode: W.state().mode, turnTripped,
      };
    });
    assert.equal(r.mode, 'air', 'the plane did not survive the loop');
    assert.equal(r.turnTripped, false, 'a powered loop should not trip the stall turn');
    assert.ok(Math.abs(r.sum) >= Math.PI * 2, `only turned ${r.sum.toFixed(2)} rad`);
    assert.ok(r.ticks > 40 && r.ticks < 300, `a loop taking ${r.ticks} ticks is not Wings of Fury`);
  });

  await t.test('the plane stays inside the viewport on the way out', async () => {
    await page.evaluate(() => window.__WINGS.reset());
    const worst = await page.evaluate(() => {
      const W = window.__WINGS;
      W.hold({ thrust: 1, pitch: 0 });
      while (W.state().mode !== 'air') W.tick(1);
      W.hold({ thrust: 1, pitch: 0 });
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
  // actual mechanic the user asked for is wired to the keyboard: build speed
  // East holding Right, hold Left, and the aeroplane should bleed off,
  // stall-turn, and pick up speed West under the same held Left key — twice
  // in a row, reversing back East the second time.
  //
  // WAIT FOR THE MANOEUVRE, DO NOT COUNT TICKS AT IT. This used to tick a flat
  // 100 and assert the aeroplane had come out the far side, which stopped being
  // true the moment the stall turn was lengthened (a reversal is now ~48 ticks
  // of speed bleed plus a 70-tick sweep). A fixed number here is a second copy
  // of the manoeuvre's duration living in a browser test, and it would go stale
  // again the next time the turn is retuned. So: run until the sim says the
  // turn has armed AND cleared, under a generous bounded cap — which still
  // fails loudly, and with a better message, if a turn never arms or never
  // ends.
  const reverse = () =>
    page.evaluate(() => {
      const W = window.__WINGS;
      let armed = false;
      // `calls` is the whole reversal, bleed included; `sweep` is only the
      // part the simulation calls a turn. They are different questions — the
      // bleed depends on how much speed you happened to arrive with, the sweep
      // should not depend on anything at all.
      let sweep = 0;
      for (let i = 1; i <= 600; i++) {
        W.tick(1);
        if (W.state().turning) { armed = true; sweep++; }
        else if (armed) return { calls: i, sweep, armed: true, ended: true };
      }
      return { calls: 600, sweep, armed, ended: false };
    });

  await t.test('holding the opposite arrow to zero triggers a real stall turn, repeatably, in both directions', async () => {
    await page.evaluate(() => window.__WINGS.reset());
    // CLIMB FIRST. This used to run the aeroplane off the bow and reverse twice
    // at deck height, which left ~60px of water underneath it. A stall turn
    // sweeps through straight-down at its midpoint and sinks ~31px doing it, so
    // two reversals in a row now put the aeroplane in the sea and the test was
    // failing on a drowning, not on the mechanic. Get some sky first, exactly
    // as a pilot would before practising a manoeuvre that costs height.
    await page.evaluate(() => {
      const W = window.__WINGS;
      const until = (map, done, cap = 900) => {
        for (let i = 0; i < cap; i++) {
          W.hold(map());
          W.tick(1);
          if (done()) return true;
        }
        return false;
      };
      const s = () => W.state();
      until(() => ({ thrust: 1, pitch: s().speed >= 2.2 ? 1 : 0 }), () => s().mode === 'air');
      until(() => ({ thrust: 1, pitch: s().angle > -0.6 ? 1 : 0 }), () => s().y <= 240);
      until(() => ({ thrust: 1, pitch: -1 }), () => s().angle >= -0.01);
      // hold() persists across tick(), so the nose-down input above has to be
      // cancelled explicitly or these settling ticks fly it into a dive.
      W.hold({ thrust: 1, pitch: 0 });
      W.tick(30);
      W.release();
    });
    const aloft = await page.evaluate(() => window.__WINGS.state());
    // Two reversals cost ~62px of altitude between them; anything under y=400
    // leaves more than twice that in hand before the sea at 560.
    assert.ok(aloft.mode === 'air' && aloft.y < 400, `test premise: should be well clear of the sea, y=${aloft.y}`);

    await page.keyboard.down('ArrowRight');
    await page.evaluate(() => window.__WINGS.tick(120)); // build to cruise, facing East
    const cruiseEast = await page.evaluate(() => window.__WINGS.state());
    assert.ok(Math.cos(cruiseEast.angle) > 0.9, 'test premise: should be level, facing East');
    await page.keyboard.up('ArrowRight');

    // Reversal 1: East -> West.
    await page.keyboard.down('ArrowLeft');
    const r1 = await reverse();
    assert.ok(r1.armed, 'holding the opposite arrow never triggered a stall turn at all');
    assert.ok(r1.ended, 'the stall turn armed but never finished');
    const west = await page.evaluate(() => window.__WINGS.state());
    assert.ok(Math.cos(west.angle) < -0.9, 'should now be facing West');
    assert.equal(west.turning, false, `the turn should have finished (took ${r1.calls} ticks)`);
    assert.ok(west.speed > 0, 'should exit already moving, not dead in the air');
    const beforeAccel1 = west.speed;
    await page.evaluate(() => window.__WINGS.tick(30));
    const accelWest = await page.evaluate(() => window.__WINGS.state());
    assert.ok(accelWest.speed > beforeAccel1, 'holding the same Left key should now accelerate West');
    await page.keyboard.up('ArrowLeft');

    // Reversal 2: West -> East, proving it is not a one-shot special case.
    await page.keyboard.down('ArrowRight');
    const r2 = await reverse();
    assert.ok(r2.armed, 'the second reversal never triggered a stall turn');
    assert.ok(r2.ended, 'the second stall turn armed but never finished');
    const east = await page.evaluate(() => window.__WINGS.state());
    assert.ok(Math.cos(east.angle) > 0.9, 'should be facing East again');
    assert.equal(east.turning, false, `the second turn should also have finished (took ${r2.calls} ticks)`);
    // Both directions, the same manoeuvre. The SWEEP is a fixed-length sweep
    // whichever way it started — that is the whole design of it — so the two
    // must match closely. Compared instead of the full reversal on purpose:
    // the reversals legitimately differ in total length here because the first
    // one enters from full cruise and the second from a shorter acceleration,
    // and that is the speed bleed, not the turn. This is the assertion the old
    // fixed tick count could never make, because it measured nothing.
    assert.ok(
      Math.abs(r1.sweep - r2.sweep) <= 4,
      `the sweep took ${r1.sweep} ticks one way and ${r2.sweep} the other — the turn is not symmetric`
    );
    await page.keyboard.up('ArrowRight');
  });

  await t.test('reports no page errors', () => {
    assert.deepEqual(errors, []);
  });

  // The renderer catches exceptions thrown inside a layer callback so one bad
  // frame cannot kill the page — which also means a broken draw is SILENT. This
  // flies a full circuit, including a stall turn, and then asks. A negative
  // cloud radius shipped once because nothing checked.
  await t.test('nothing in the scene throws across a whole sortie, stall turn included', async () => {
    await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      W.hold({ pitch: 0, thrust: 1 });
      W.tick(60);
      W.hold({ pitch: 1, thrust: 1 });
      W.tick(240);
      // Reverse under thrust, riding out however long the stall turn takes.
      W.hold({ pitch: 0, thrust: -1 });
      W.tick(240);
      W.hold({ pitch: 0, thrust: 0 });
      W.tick(400);
      W.release();
    });
    assert.equal(await page.evaluate(() => window.__WINGS.fatal()), null);
    assert.deepEqual(errors, []);
  });
});
