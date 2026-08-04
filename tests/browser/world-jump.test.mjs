import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, bootRoom, shutdownRoom } from './helpers.mjs';
import { SAIL } from '../../src/wings/sail.js';

// The DEBUG world jump on the pilot page: [ and ] step the archipelago, shift
// plus a digit goes straight to that world.
//
// It exists because the ocean holds one SMB world at a time and the only honest
// way to reach world 8 is to play the seven in front of it — so thirty of the
// thirty-two islands the game already draws are unreachable in a playtest.
//
// What is asserted here and nowhere else: that the real keyboard is wired to
// it, that it reuses the SAIL rather than teleporting, that it lands on the
// ocean the seed says it should, that it did not steal the speed keys or the
// browser's Cmd shortcuts — and, the one that matters most, that it REFUSES
// while a match is connected, because a pilot in world 5 with Mario on 1-1 is
// two different oceans and every crater, every radar blip and every hash after
// that is meaningless.

const worldOf = (page) => page.evaluate(() => window.__WINGS.world());
const islandsOf = (page) => page.evaluate(() => window.__WINGS.sim.islands.map((i) => i.id));

test('the debug world jump', async (t) => {
  const ctx = await boot({ path: '/pilot.html?headless', global: '__WINGS' });
  t.after(() => shutdown(ctx));
  const { page, errors } = ctx;

  const badge = () => page.evaluate(() => {
    const el = document.getElementById('wings-debug-world');
    return el ? el.textContent : null;
  });
  // The whole scene, run out on the simulation's clock — which is the only
  // clock it has. Nothing here waits on wall time.
  const finishCrossing = () => page.evaluate((total) => window.__WINGS.tick(total), SAIL.TOTAL);

  await t.test('starts on world 1 with no readout in sight', async () => {
    assert.equal(await worldOf(page), 1);
    assert.deepEqual(await islandsOf(page), ['1-1', '1-2', '1-3', '1-4']);
    assert.equal(await badge(), null, 'the debug badge exists before anyone asks for it');
  });

  await t.test('shift+5 sails the group to world 5', async () => {
    await page.keyboard.down('Shift');
    await page.keyboard.press('Digit5');
    await page.keyboard.up('Shift');
    // Still world 1 at this point: the ocean is replaced under the black, half
    // way through the fade, not on the keystroke.
    assert.equal(await worldOf(page), 1, 'the world changed before the fade covered it');
    await finishCrossing();
    assert.equal(await worldOf(page), 5);
    assert.deepEqual(await islandsOf(page), ['5-1', '5-2', '5-3', '5-4']);
  });

  await t.test('the world is on screen, marked as debug', async () => {
    const text = await badge();
    assert.match(text, /DEBUG/);
    assert.match(text, /WORLD 5 of 8/);
    assert.match(text, /\[ back/);
    assert.match(text, /\] on/);
    assert.match(text, /shift\+1\.\.8 jump/);
  });

  await t.test('it is the real sail, not a teleport', async () => {
    const seen = await page.evaluate((swap) => {
      const W = window.__WINGS;
      W.world(7);
      const at = (n) => {
        const c = W.crossing();
        return c && { tick: n, phase: c.phase, veil: c.veil, to: c.to, debug: c.debug };
      };
      const out = [at(0)];
      W.tick(swap - 1);
      out.push(at(swap - 1));
      W.tick(1);
      out.push({ ...at(swap), world: W.world() });
      return out;
    }, SAIL.SWAP);
    // A fade that is actually a fade: black arrives before the ocean changes.
    assert.equal(seen[0].phase, 'fade-out');
    assert.equal(seen[0].veil, 0);
    assert.equal(seen[1].phase, 'fade-out');
    assert.ok(seen[1].veil > 0.9, `veil only reached ${seen[1].veil} before the swap`);
    // And the swap lands on the SWAP tick sail.js names, under a full veil.
    assert.equal(seen[2].phase, 'hold');
    assert.equal(seen[2].veil, 1);
    assert.equal(seen[2].world, 7, 'the ocean was not replaced on the swap tick');
    assert.equal(seen[2].to, 7);
    assert.equal(seen[2].debug, true);
    await finishCrossing();
    assert.equal(await page.evaluate(() => window.__WINGS.crossing()), null);
  });

  await t.test('the card says it is a debug jump and not a cleared world', async () => {
    const lines = await page.evaluate((hold) => {
      const W = window.__WINGS;
      W.world(3);
      W.tick(hold);
      const v = W.scene.sailView;
      return { title: v.title, lines: v.lines, text: v.text };
    }, SAIL.SWAP + SAIL.TEXT_RAMP + 1);
    assert.match(lines.title, /DEBUG/);
    assert.ok(lines.text > 0, 'the words never became legible');
    assert.ok(
      lines.lines.some((l) => /REPOSITIONING TO WORLD 3/.test(l)),
      `card read: ${JSON.stringify(lines.lines)}`,
    );
    assert.ok(
      lines.lines.some((l) => /NOT CLEARED/.test(l)),
      'a debug jump claimed a world had been secured',
    );
    await finishCrossing();
    assert.equal(await worldOf(page), 3);
  });

  await t.test('the pilot comes out of it on the deck with a full squadron', async () => {
    const after = await page.evaluate((total) => {
      const W = window.__WINGS;
      W.takeoff();
      W.sim.squadron = 1;
      W.world(6);
      W.tick(total);
      return { mode: W.sim.plane.mode, squadron: W.sim.squadron, shots: W.sim.shots.length };
    }, SAIL.TOTAL);
    assert.equal(after.mode, 'deck');
    assert.equal(after.squadron, 5);
    assert.equal(after.shots, 0);
  });

  await t.test('] steps on, [ steps back', async () => {
    await page.keyboard.press('BracketRight');
    await finishCrossing();
    assert.equal(await worldOf(page), 7);
    await page.keyboard.press('BracketLeft');
    await finishCrossing();
    assert.equal(await worldOf(page), 6);
  });

  await t.test('it clamps at both ends instead of sailing off the map', async () => {
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('BracketRight');
      await finishCrossing();
    }
    assert.equal(await worldOf(page), 8);
    // Already there: refused outright, so the fade does not even start.
    assert.equal(await page.evaluate(() => window.__WINGS.world(9)), false);
    assert.equal(await page.evaluate(() => window.__WINGS.crossing()), null);
    assert.equal(await worldOf(page), 8);
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('BracketLeft');
      await finishCrossing();
    }
    assert.equal(await worldOf(page), 1);
  });

  // The point of the whole exercise: the ocean you jump to is the ocean the
  // seed says it is, forwards or backwards, so what a playtester sees at world
  // 4 is what a player who earned world 4 would see.
  await t.test('the ocean is the seed\'s, however you arrived at it', async () => {
    const layoutAt = (world) => page.evaluate((w) => {
      window.__WINGS.reset({ world: w });
      return window.__WINGS.sim.islands.map((i) => ({ id: i.id, x: i.originX }));
    }, world);
    const jumpedTo = (world) => page.evaluate(([w, total]) => {
      const W = window.__WINGS;
      W.world(w);
      W.tick(total);
      return W.sim.islands.map((i) => ({ id: i.id, x: i.originX }));
    }, [world, SAIL.TOTAL]);

    const four = await layoutAt(4);
    await page.evaluate(() => window.__WINGS.reset());
    // Forwards, 1 -> 4.
    assert.deepEqual(await jumpedTo(4), four, 'sailing forward to world 4 built a different ocean');
    // And backwards, 8 -> 4, which is a rebuild rather than a sail.
    await page.evaluate((total) => {
      window.__WINGS.world(8);
      window.__WINGS.tick(total);
    }, SAIL.TOTAL);
    assert.deepEqual(await jumpedTo(4), four, 'jumping back to world 4 built a different ocean');
  });

  // The digits and the speed tuning shared a keyboard for about an hour, told
  // apart by shift. They do not any more: the tuning moved to Q/W/E so a plain
  // digit could be the obvious thing — 1 through 8 for the eight worlds. This
  // proves the two controls stay out of each other's way, in both directions.
  await t.test('Q, W and E tune the speed and never touch the world', async () => {
    await page.evaluate(() => {
      window.__WINGS.reset();
      window.__WINGS.maxSpeed(9.0);
    });
    const world = await worldOf(page);
    await page.keyboard.press('KeyQ');
    assert.equal(await page.evaluate(() => window.__WINGS.maxSpeed()), 7.5, 'Q did not slow it');
    await page.keyboard.press('KeyW');
    await page.keyboard.press('KeyW');
    assert.equal(await page.evaluate(() => window.__WINGS.maxSpeed()), 10.5, 'W did not speed it up');
    await page.keyboard.press('KeyE');
    assert.equal(await page.evaluate(() => window.__WINGS.maxSpeed()), 9.0, 'E did not reset it');
    assert.equal(await worldOf(page), world, 'a speed key moved the archipelago');
  });

  // Runs after the Q/W/E case on purpose: it leaves the archipelago on world 2,
  // which is where the Cmd-shift-3 test below expects to find it.
  await t.test('a digit jumps worlds and never touches the speed', async () => {
    await page.evaluate(() => window.__WINGS.maxSpeed(9.0));
    await page.keyboard.press('Digit2');
    assert.equal(await page.evaluate(() => window.__WINGS.maxSpeed()), 9.0,
      'a digit tuned the speed');
    await finishCrossing();
    assert.equal(await worldOf(page), 2, 'a plain digit did not jump the archipelago');
  });

  // The rule that was added when Cmd-Shift-R stopped reloading the page. Shift
  // is ours; Cmd is never ours, shift or no shift.
  await t.test('Cmd-shift-3 is left entirely to the browser', async () => {
    await page.evaluate(() => {
      window.__cmdDigitDefaultPrevented = null;
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Digit3') window.__cmdDigitDefaultPrevented = e.defaultPrevented;
      });
    });
    await page.keyboard.down('Meta');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Digit3');
    await page.keyboard.up('Shift');
    await page.keyboard.up('Meta');
    assert.equal(await page.evaluate(() => window.__WINGS.crossing()), null, 'Cmd-shift-3 jumped');
    assert.equal(await worldOf(page), 2);
    assert.equal(
      await page.evaluate(() => window.__cmdDigitDefaultPrevented),
      false,
      'Cmd-shift-3 was swallowed instead of being handed to the browser',
    );
  });

  await t.test('no page errors throughout', async () => {
    assert.equal(await page.evaluate(() => window.__WINGS.fatal()), null);
    assert.deepEqual(errors, []);
  });
});

// The decision this control turns on, tested against a real match rather than a
// simulated one: two clients, one server, one seed.
test('the debug world jump is refused in a match', async (t) => {
  const ctx = await bootRoom({ room: 'WJMP', seed: 0x51ced0de });
  t.after(() => shutdownRoom(ctx));
  const { pilot, mario } = ctx;

  await t.test('both players start in the same ocean', async () => {
    assert.equal(await worldOf(pilot.page), 1);
    assert.deepEqual(await islandsOf(pilot.page), ['1-1', '1-2', '1-3', '1-4']);
  });

  await t.test('shift+5 does nothing at all to the archipelago', async () => {
    await pilot.page.keyboard.down('Shift');
    await pilot.page.keyboard.press('Digit5');
    await pilot.page.keyboard.up('Shift');
    assert.equal(await pilot.page.evaluate(() => window.__WINGS.crossing()), null);
    await pilot.page.evaluate((total) => window.__WINGS.tick(total), SAIL.TOTAL);
    assert.equal(await pilot.page.evaluate(() => window.__WINGS.crossing()), null);
    assert.equal(await worldOf(pilot.page), 1, 'the pilot left Mario behind in world 1');
  });

  await t.test('the brackets are refused too, and the API with them', async () => {
    await pilot.page.keyboard.press('BracketRight');
    assert.equal(await worldOf(pilot.page), 1);
    assert.equal(await pilot.page.evaluate(() => window.__WINGS.world(8)), false);
    assert.equal(await worldOf(pilot.page), 1);
  });

  await t.test('and it says why, rather than looking broken', async () => {
    const text = await pilot.page.evaluate(() => {
      const el = document.getElementById('wings-debug-world');
      return el ? el.textContent : null;
    });
    assert.match(text, /WORLD 1 of 8/);
    assert.match(text, /REFUSED — MULTIPLAYER/);
  });

  await t.test('neither client faulted', async () => {
    assert.equal(await pilot.page.evaluate(() => window.__WINGS.fatal()), null);
    assert.deepEqual(pilot.errors, []);
    assert.deepEqual(mario.errors, []);
    assert.deepEqual(ctx.server.serverErrors, []);
  });
});
