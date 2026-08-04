import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

// The DEBUG speed knob, keys 1 and 2 on the pilot page. The unit tests cover
// what the numbers do to the aeroplane; this covers the only things they
// cannot — that the real keyboard is wired to it, that the readout appears,
// and that binding the digits did not steal Cmd-1 from the browser.
test('the debug speed keys', async (t) => {
  const ctx = await boot({ path: '/pilot.html?headless', global: '__WINGS' });
  t.after(() => shutdown(ctx));
  const { page, errors } = ctx;

  const badge = () => page.evaluate(() => {
    const el = document.getElementById('wings-debug-speed');
    return el ? el.textContent : null;
  });
  const maxSpeed = () => page.evaluate(() => window.__WINGS.sim.plane.maxSpeed);

  await t.test('starts at the default with no readout in sight', async () => {
    assert.equal(await maxSpeed(), 9.0);
    assert.equal(await badge(), null, 'the debug badge exists before anyone asks for it');
  });

  await t.test('2 speeds the aeroplane up, 1 slows it down', async () => {
    await page.keyboard.press('Digit2');
    assert.equal(await maxSpeed(), 10.5);
    await page.keyboard.press('Digit2');
    assert.equal(await maxSpeed(), 12.0);
    await page.keyboard.press('Digit1');
    await page.keyboard.press('Digit1');
    await page.keyboard.press('Digit1');
    assert.equal(await maxSpeed(), 7.5);
  });

  await t.test('the current maximum is on screen, marked as debug', async () => {
    const text = await badge();
    assert.match(text, /DEBUG/);
    assert.match(text, /MAX SPEED 7\.5/);
    assert.match(text, /1 slower/);
    assert.match(text, /2 faster/);
  });

  // Ninety ticks of level acceleration off the deck, which is far enough to
  // tell the two settings apart and not so far that the fast one has crossed
  // the archipelago and flown into an island — a real hazard of a tuned-up
  // aeroplane, and not what this test is about.
  const departAt = (v) => page.evaluate((max) => {
    const W = window.__WINGS;
    W.reset();
    W.maxSpeed(max);
    W.takeoff();
    W.hold({ thrust: 1, pitch: 0 });
    W.tick(90);
    const p = W.sim.plane;
    W.release();
    return { speed: p.speed, mode: p.mode };
  }, v);

  await t.test('the change is felt immediately, on the aeroplane already flying', async () => {
    const fast = await departAt(18.0);
    const slow = await departAt(4.5);
    assert.equal(fast.mode, 'air');
    assert.equal(slow.mode, 'air');
    // Not a clamp: at the default neither of these is anywhere near its own
    // MAX_SPEED, so if the keys only moved the clamp both numbers would be the
    // same one.
    assert.ok(fast.speed > slow.speed * 2.5, `18.0 flew at ${fast.speed}, 4.5 at ${slow.speed}`);
  });

  await t.test('the setting survives a respawn', async () => {
    const after = await page.evaluate(() => {
      const W = window.__WINGS;
      W.maxSpeed(15.0);
      W.sim.plane.mode = 'down';
      W.respawn();
      return W.sim.plane.maxSpeed;
    });
    assert.equal(after, 15.0);
  });

  await t.test('it clamps rather than letting the aeroplane be tuned into nonsense', async () => {
    const out = await page.evaluate(() => {
      const W = window.__WINGS;
      const hi = [];
      for (let i = 0; i < 40; i++) hi.push(W.maxSpeed(W.maxSpeed() + 1.5));
      const lo = [];
      for (let i = 0; i < 40; i++) lo.push(W.maxSpeed(W.maxSpeed() - 1.5));
      return { top: hi[hi.length - 1], bottom: lo[lo.length - 1] };
    });
    assert.equal(out.top, 27.0);
    assert.equal(out.bottom, 4.5);
  });

  // The rule added when Cmd-Shift-R stopped reloading the page: a keystroke
  // carrying a system modifier belongs to the browser, and binding the digits
  // must not have taken Cmd-1 (switch to tab 1) away from it.
  await t.test('Cmd-1 is left entirely to the browser', async () => {
    await page.evaluate(() => {
      window.__WINGS.maxSpeed(9.0);
      window.__cmdDigitDefaultPrevented = null;
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Digit1') window.__cmdDigitDefaultPrevented = e.defaultPrevented;
      });
    });
    await page.keyboard.down('Meta');
    await page.keyboard.press('Digit1');
    await page.keyboard.up('Meta');
    assert.equal(await maxSpeed(), 9.0, 'Cmd-1 moved the aeroplane');
    assert.equal(
      await page.evaluate(() => window.__cmdDigitDefaultPrevented),
      false,
      'Cmd-1 was swallowed instead of being handed to the browser',
    );
  });

  await t.test('no page errors throughout', async () => {
    assert.equal(await page.evaluate(() => window.__WINGS.fatal()), null);
    assert.deepEqual(errors, []);
  });
});
