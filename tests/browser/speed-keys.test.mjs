import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

// The DEBUG speed knob, Q/W/E on the pilot page. The unit tests cover
// what the numbers do to the aeroplane; this covers the only things they
// cannot — that the real keyboard is wired to it, that the readout appears,
// and that binding them did not steal a browser shortcut.
test('the debug speed keys', async (t) => {
  const ctx = await boot({ path: '/pilot.html?headless', global: '__WINGS' });
  t.after(() => shutdown(ctx));
  const { page, errors } = ctx;

  const badge = () => page.evaluate(() => {
    const el = document.getElementById('wings-debug-speed');
    return el ? el.textContent : null;
  });
  const maxSpeed = () => page.evaluate(() => window.__WINGS.sim.plane.maxSpeed);

  await t.test('starts at the default, with the badge already up', async () => {
    assert.equal(await maxSpeed(), 9.0);
    // THIS ASSERTED THE BADGE WAS ABSENT until a tuning key was pressed, which
    // was right while it only carried MAX SPEED. It now carries the live
    // ATTITUDE as well, and an attitude readout that appears only after you
    // press Q is no use to a pilot lining up an approach — the number matters
    // at the moment the wheels touch.
    const text = await badge();
    assert.ok(text, 'the debug badge is not up');
    assert.match(text, /MAX SPEED 9\.0/);
    assert.match(text, /ANGLE\s+-?\d+\.\d+ rad/, 'no live attitude on the badge');
  });

  await t.test('W goes straight to the top, Q steps back down', async () => {
    // W USED TO STEP, 1.5 at a time, which is eleven presses from 9 to 27 on a
    // key whose whole purpose is saving time in a playtest. It jumps now; Q
    // still steps, because backing off is where fine control is actually
    // wanted.
    await page.keyboard.press('KeyW');
    assert.equal(await maxSpeed(), 27.0, 'W did not go to the maximum');
    await page.keyboard.press('KeyW');
    assert.equal(await maxSpeed(), 27.0, 'and it clamps there');
    await page.keyboard.press('KeyQ');
    assert.equal(await maxSpeed(), 25.5);
    await page.keyboard.press('KeyQ');
    assert.equal(await maxSpeed(), 24.0);
  });

  await t.test('the current maximum is on screen, marked as debug', async () => {
    const text = await badge();
    assert.match(text, /DEBUG/);
    assert.match(text, /MAX SPEED 24\.0/);
    assert.match(text, /Q slower/);
    assert.match(text, /W max/);
    assert.match(text, /E default/);
    assert.match(text, /1-8 world/);
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

  // E — back to the default in one press.
  //
  // This was § until the user reported it simply did not fire for them. That
  // key is a genuine trap: `event.code` is supposed to be layout-independent
  // and for this one it is not, so it had to be bound as BOTH IntlBackslash
  // and Backquote (macOS swaps them relative to every other platform), it has
  // no Playwright key name so it needed raw CDP to test at all, and it does
  // not exist on an ANSI keyboard. E is one key, on every keyboard, next to
  // the Q and W that tune the speed.
  await t.test('E resets to the default', async () => {
    await page.evaluate(() => window.__WINGS.maxSpeed(21.0));
    assert.equal(await maxSpeed(), 21.0);
    await page.keyboard.press('KeyE');
    assert.equal(await maxSpeed(), 9.0, 'E did not reset the aeroplane');
  });

  await t.test('the reset is visible, and says which key did it', async () => {
    const text = await badge();
    assert.match(text, /MAX SPEED 9\.0/);
    assert.match(text, /\(default\)/, 'a reset that does not say it landed on the default');
  });

  await t.test('the reset reaches the aeroplane already in the air, not just the setting', async () => {
    const after = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      W.maxSpeed(27.0);
      W.takeoff();
      const before = W.sim.plane.maxSpeed;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
      return { before, after: W.sim.plane.maxSpeed };
    });
    assert.equal(after.before, 27.0);
    assert.equal(after.after, 9.0, 'the plane in the air kept the old maximum');
  });

  // The rule added when Cmd-Shift-R stopped reloading the page: a keystroke
  // carrying a system modifier belongs to the browser, and binding the digits
  // must not have taken it away from the browser.
  // Cmd-E rather than Cmd-Q or Cmd-W: those two are now speed keys, and under
  // Meta they are "quit the browser" and "close the tab". A test that fires
  // them is a test that ends the run.
  await t.test('Cmd-E is left entirely to the browser', async () => {
    await page.evaluate(() => {
      window.__WINGS.maxSpeed(21.0);
      window.__cmdDefaultPrevented = null;
      window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyE') window.__cmdDefaultPrevented = e.defaultPrevented;
      });
    });
    await page.keyboard.down('Meta');
    await page.keyboard.press('KeyE');
    await page.keyboard.up('Meta');
    assert.equal(await maxSpeed(), 21.0, 'Cmd-E reset the aeroplane');
    assert.equal(
      await page.evaluate(() => window.__cmdDefaultPrevented),
      false,
      'Cmd-E was swallowed instead of being handed to the browser',
    );
  });

  await t.test('no page errors throughout', async () => {
    assert.equal(await page.evaluate(() => window.__WINGS.fatal()), null);
    assert.deepEqual(errors, []);
  });
});
