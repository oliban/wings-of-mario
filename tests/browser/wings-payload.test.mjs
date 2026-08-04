import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

// The integration pass: ordnance, islands and the roll animation, exercised
// through the page the player actually flies. pilot.html?headless leaves the
// rAF loop stopped, so every step below is a fixed simulation tick.
//
// Where a test needs the aeroplane somewhere specific it writes to
// __WINGS.sim.plane directly rather than flying there — the flight model is
// covered elsewhere and a twelve-second approach in a test proves nothing
// about bombs.
test('bombs, islands and the stall-turn roll', { timeout: 120000 }, async (t) => {
  const ctx = await boot({ path: '/pilot.html?headless', global: '__WINGS' });
  t.after(() => shutdown(ctx));
  const { page } = ctx;

  // Put the aeroplane in level flight at a given world point and speed.
  const fly = (opts) => page.evaluate((o) => {
    const W = window.__WINGS;
    W.reset();
    W.release();
    const p = W.sim.plane;
    p.mode = 'air';
    p.gear = false;
    p.angle = 0;
    p.x = o.x;
    p.y = o.y;
    p.speed = o.speed;
    p.vx = o.speed;
    p.vy = 0;
    return true;
  }, opts);

  // DOWN LIFTS, in both directions of flight. The user asked for this
  // explicitly and it has been reverted once already, so it is asserted
  // against the real keyboard rather than against the scripted API: only the
  // KEY BINDING moves, `hold({pitch: 1})` still means nose-up.
  // Fly a real reversal: brake against your own heading until the airspeed
  // hits zero and the stall turn wings the aeroplane onto the other heading.
  // Hand-setting angle = PI would NOT do — the aeroplane would be pointing
  // west without ever having rolled, which is not a state flying produces.
  const reverseWest = () => page.evaluate(() => {
    const W = window.__WINGS;
    W.hold({ pitch: 0, thrust: -1 });
    for (let i = 0; i < 400 && !W.state().turning; i++) W.tick(1);
    while (W.state().turning) W.tick(1);
    W.hold({ pitch: 0, thrust: 0 });
    W.tick(10);
    W.release();
    return W.state();
  });

  for (const heading of ['east', 'west']) {
    await t.test(`Down climbs and Up dives flying ${heading}`, async () => {
      const pull = async (key) => {
        await fly({ x: 900, y: 250, speed: 3 });
        if (heading === 'west') await reverseWest();
        const start = await page.evaluate(() => window.__WINGS.state());
        await page.keyboard.down(key);
        await page.evaluate(() => window.__WINGS.tick(30));
        await page.keyboard.up(key);
        const to = await page.evaluate(() => window.__WINGS.state());
        return { from: start.y, angle: start.angle, to };
      };
      const down = await pull('ArrowDown');
      const up = await pull('ArrowUp');
      assert.ok(
        Math.cos(down.angle) * (heading === 'east' ? 1 : -1) > 0,
        `the test aeroplane set off pointing the wrong way (angle ${down.angle})`
      );
      assert.ok(down.to.y < down.from, `flying ${heading}, holding Down sank ${down.from} -> ${down.to.y} instead of climbing`);
      assert.ok(up.to.y > up.from, `flying ${heading}, holding Up climbed ${up.from} -> ${up.to.y} instead of diving`);
    });
  }

  await t.test('Down still climbs after a second reversal has put it back the way it started', async () => {
    // The sign the keyboard applies toggles per completed stall turn, so two
    // of them have to compose back to where they began. A player crosses the
    // ocean and comes home; that is two reversals, every sortie.
    await fly({ x: 900, y: 250, speed: 3 });
    await reverseWest();
    await page.evaluate(() => {
      const W = window.__WINGS;
      W.hold({ pitch: 0, thrust: 1 });
      for (let i = 0; i < 400 && !W.state().turning; i++) W.tick(1);
      while (W.state().turning) W.tick(1);
      W.release();
    });
    const start = await page.evaluate(() => window.__WINGS.state());
    await page.keyboard.down('ArrowDown');
    await page.evaluate(() => window.__WINGS.tick(30));
    await page.keyboard.up('ArrowDown');
    const end = await page.evaluate(() => window.__WINGS.state());
    assert.ok(Math.cos(start.angle) > 0, `two reversals should point it East again (angle ${start.angle})`);
    assert.ok(end.y < start.y, `after two reversals Down sank ${start.y} -> ${end.y} instead of climbing`);
  });

  await t.test('the scripted API keeps its own convention: hold({pitch}) is raw airframe rotation', async () => {
    // Only the KEY BINDINGS moved, and the mirrored-attitude sign that makes
    // "Down lifts" hold after a reversal belongs to the keyboard. A bot that
    // says pitch: 1 gets the same rotation of the airframe it always got,
    // before and after a reversal — no hidden flip leaked into this path.
    const sweep = async (reversed) => {
      await fly({ x: 900, y: 250, speed: 3 });
      if (reversed) await reverseWest();
      return page.evaluate(() => {
        const W = window.__WINGS;
        const a0 = W.state().angle;
        W.hold({ pitch: 1, thrust: 0 });
        W.tick(10);
        W.release();
        const d = W.state().angle - a0;
        return Math.atan2(Math.sin(d), Math.cos(d));
      });
    };
    const east = await sweep(false);
    const west = await sweep(true);
    assert.ok(east < -0.1, `hold({pitch: 1}) should sweep the airframe one fixed way (got ${east})`);
    assert.ok(west < -0.1, `hold({pitch: 1}) swept the other way after a reversal (${west}) — the key layer's sign leaked in`);
  });

  await t.test('a keypress drops a bomb and the loadout decrements', async () => {
    await fly({ x: 900, y: 200, speed: 2.5 });
    const before = await page.evaluate(() => window.__WINGS.sim.loadout.bomb);
    await page.keyboard.press('Space');
    await page.evaluate(() => window.__WINGS.tick(1));
    const after = await page.evaluate(() => ({
      bombs: window.__WINGS.sim.loadout.bomb,
      shots: window.__WINGS.sim.shots.length,
      kinds: window.__WINGS.sim.shots.map((s) => s.kind),
    }));
    assert.equal(after.bombs, before - 1, 'Space did not spend a bomb');
    assert.equal(after.shots, 1, 'Space did not put a bomb in the air');
    assert.deepEqual(after.kinds, ['bomb']);
  });

  await t.test('holding Space drops one bomb, not one per tick', async () => {
    await fly({ x: 900, y: 200, speed: 2.5 });
    const before = await page.evaluate(() => window.__WINGS.sim.loadout.bomb);
    await page.keyboard.down('Space');
    await page.evaluate(() => window.__WINGS.tick(30));
    await page.keyboard.up('Space');
    const after = await page.evaluate(() => window.__WINGS.sim.loadout.bomb);
    assert.equal(after, before - 1, 'the drop is repeating while held instead of edge-triggered');
  });

  await t.test('X fires the gun off its own counter', async () => {
    await fly({ x: 900, y: 200, speed: 2.5 });
    const before = await page.evaluate(() => ({ ...window.__WINGS.sim.loadout }));
    await page.keyboard.press('KeyX');
    await page.evaluate(() => window.__WINGS.tick(1));
    const after = await page.evaluate(() => ({ ...window.__WINGS.sim.loadout }));
    assert.equal(after.gun, before.gun - 1, 'X did not fire the gun');
    assert.equal(after.bomb, before.bomb, 'X spent a bomb');
  });

  await t.test('a bomb inherits the aeroplane velocity: faster drops land further ahead', async () => {
    const range = async (speed) => {
      await fly({ x: 900, y: 120, speed });
      return page.evaluate(() => {
        const W = window.__WINGS;
        W.hold({ pitch: 0, thrust: 0, drop: true });
        W.tick(1);
        W.hold({ pitch: 0, thrust: 0, drop: false });
        const shot = W.sim.shots[0];
        const x0 = shot.x;
        // Run until it is gone — into the sea, in open ocean short of the
        // first island — and read where it went.
        let last = shot.x;
        for (let i = 0; i < 400 && !shot.dead; i++) {
          W.tick(1);
          if (!shot.dead) last = shot.x;
        }
        W.release();
        return { x0, last, dead: shot.dead };
      });
    };
    const slow = await range(1.0);
    const fast = await range(4.0);
    assert.ok(slow.dead && fast.dead, 'a bomb dropped over open ocean never hit the water');
    assert.ok(
      fast.last - fast.x0 > (slow.last - slow.x0) + 100,
      `a bomb from a fast aeroplane should fall much further ahead (slow ${slow.last - slow.x0}, fast ${fast.last - fast.x0})`
    );
  });

  await t.test('a bomb dropped over an island craters it', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      const isle = W.sim.islands[0];
      const p = W.sim.plane;
      p.mode = 'air';
      p.gear = false;
      p.angle = 0;
      // Above solid ground: 1-1's rows 13/14 are floor across tile column 20.
      p.x = isle.x0 + 20 * 16;
      p.y = 120;
      p.speed = 0;
      p.vx = 0;
      p.vy = 0;
      const before = isle.keys().length;
      W.hold({ pitch: 0, thrust: 0, drop: true });
      W.tick(1);
      W.hold({ pitch: 0, thrust: 0, drop: false });
      const shot = W.sim.shots[0];
      for (let i = 0; i < 400 && !shot.dead; i++) W.tick(1);
      W.release();
      return {
        before,
        after: isle.keys().length,
        keys: isle.keys(),
        dead: shot.dead,
        events: W.events().filter((e) => e.type === 'detonation').length,
      };
    });
    assert.ok(r.dead, 'the bomb never detonated on the island');
    assert.ok(r.after > r.before, `island.keys() did not grow (${r.before} -> ${r.after})`);
    assert.ok(r.events > 0, 'no detonation event was emitted');
  });

  await t.test('the plane crashes on island terrain', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      const isle = W.sim.islands[0];
      const p = W.sim.plane;
      p.mode = 'air';
      p.gear = false;
      p.angle = 0;
      p.speed = 1;
      p.vx = 1;
      p.vy = 0;
      // Straight into the ground row (ty 13) of tile column 20.
      p.x = isle.x0 + 20 * 16 - 12;
      p.y = isle.y0 + 13 * 16 + 2;
      W.tick(1);
      return { mode: W.state().mode, status: W.state().status, events: W.events() };
    });
    assert.equal(r.mode, 'down', 'the plane flew through solid island ground');
    const lost = r.events.filter((e) => e.type === 'planeLost');
    assert.ok(lost.length > 0 && lost[lost.length - 1].reason === 'island', 'crash was not reported as an island hit');
  });

  await t.test('but NOT on a non-blocking tile', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      const isle = W.sim.islands[0];
      const p = W.sim.plane;
      p.mode = 'air';
      p.gear = false;
      p.angle = 0;
      p.speed = 1;
      p.vx = 1;
      p.vy = 0;
      // Tile 20,2 of 1-1 is a decor cloud: destructible, but nothing an
      // aeroplane can hit.
      p.x = isle.x0 + 20 * 16 - 12;
      p.y = isle.y0 + 2 * 16 + 2;
      const blocks = isle.blocksTile(20, 2);
      const destructible = isle.destructibleTile(20, 2);
      W.tick(1);
      return { blocks, destructible, mode: W.state().mode };
    });
    assert.equal(r.blocks, false, 'expected tile 20,2 of 1-1 to be a non-blocking decor cloud');
    assert.equal(r.destructible, true, 'expected that cloud to still be destructible');
    assert.equal(r.mode, 'air', 'the plane exploded against a cloud');
  });

  await t.test('the roll plays through the stall turn, not through a loop', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      const p = W.sim.plane;
      p.mode = 'air';
      p.gear = false;
      p.angle = 0;
      p.x = 900;
      p.y = 120;
      p.speed = 2.5;
      p.vx = 2.5;
      p.vy = 0;
      // Thrust West while flying East: brake to zero, then the stall turn.
      W.hold({ pitch: 0, thrust: -1 });
      const rolls = [];
      let started = null;
      let ticks = 0;
      while (ticks < 400) {
        W.tick(1);
        ticks++;
        const s = W.state();
        if (s.turning) {
          if (started === null) started = W.scene.roll;
          rolls.push({ progress: s.turnProgress, roll: W.scene.roll, dir: s.turnDir });
        } else if (started !== null) break;
      }
      // Let the spring settle.
      for (let i = 0; i < 40; i++) W.tick(1);
      W.release();
      return { started, rolls, settled: W.scene.roll, ticks };
    });
    assert.ok(r.rolls.length > 10, `never got a stall turn to watch (${r.rolls.length} turning ticks)`);
    const swept = r.rolls.map((s) => Math.abs(s.roll - r.started));
    assert.ok(Math.max(...swept) > 1.0, `the aeroplane barely banked during the turn (max ${Math.max(...swept)})`);
    // It ends up half a turn from where it started, and it got there gradually.
    assert.ok(
      Math.abs(Math.abs(r.settled - r.started) - Math.PI) < 0.25,
      `the roll did not settle a half turn from where it began (${r.started} -> ${r.settled})`
    );
    const mid = r.rolls[Math.floor(r.rolls.length / 2)];
    assert.ok(
      Math.abs(mid.roll - r.started) > 0.4 && Math.abs(mid.roll - r.started) < Math.PI - 0.4,
      `the roll snapped rather than animating (half way through the turn it was at ${mid.roll - r.started})`
    );
  });

  await t.test('a loop no longer rolls the aeroplane over on its own', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      const p = W.sim.plane;
      p.mode = 'air';
      p.gear = false;
      p.angle = 0;
      p.x = 900;
      p.y = 120;
      p.speed = 3;
      p.vx = 3;
      p.vy = 0;
      // Thrust released through the loop: held East it would be held AGAINST
      // the heading over the top, which is the stall turn this test is
      // deliberately not about.
      W.hold({ pitch: 1, thrust: 0 });
      let peak = 0;
      let turned = false;
      for (let i = 0; i < 110 && !turned; i++) {
        W.tick(1);
        if (W.state().turning) turned = true;
        peak = Math.max(peak, Math.abs(W.scene.roll));
      }
      W.release();
      return { peak, turned };
    });
    assert.equal(r.turned, false, 'the loop triggered a stall turn — this test no longer isolates the loop');
    assert.ok(r.peak < 1.2, `a loop still barrel-rolls the aeroplane (peak bank ${r.peak})`);
  });

  await t.test('the HUD reads its counters off the loadout', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      return { bombs: W.sim.bombs, rockets: W.sim.rockets, loadout: { ...W.sim.loadout } };
    });
    assert.equal(r.bombs, r.loadout.bomb);
    assert.equal(r.rockets, r.loadout.rocket);
    assert.ok(r.bombs > 0 && r.rockets > 0, 'a fresh sortie should launch with stores aboard');
  });

  // The page must never swallow a browser shortcut. R is bound to `respawn`,
  // so Cmd-Shift-R matched the keymap and was preventDefault()ed before Chrome
  // saw it — the user could not hard-reload the page they were playtesting.
  await t.test('a keystroke carrying a system modifier is left entirely to the browser', async () => {
    await fly({ x: 900, y: 250, speed: 2.5 });
    // Record whether the page cancels the event, from the page's own side.
    await page.evaluate(() => {
      window.__prevented = [];
      window.addEventListener('keydown', (e) => {
        window.__prevented.push([e.code, e.metaKey, e.ctrlKey, e.altKey, e.shiftKey, e.defaultPrevented]);
      });
    });

    const before = await page.evaluate(() => ({ ...window.__WINGS.state(), loadout: { ...window.__WINGS.sim.loadout } }));
    for (const combo of ['Meta+Shift+KeyR', 'Meta+KeyR', 'Control+Shift+KeyR', 'Alt+KeyR', 'Meta+Space', 'Control+KeyX', 'Meta+ArrowDown']) {
      await page.keyboard.press(combo);
    }
    await page.evaluate(() => window.__WINGS.tick(5));
    const after = await page.evaluate(() => ({ ...window.__WINGS.state(), loadout: { ...window.__WINGS.sim.loadout } }));
    const seen = await page.evaluate(() => window.__prevented);

    assert.ok(seen.length >= 7, `only ${seen.length} modified keystrokes reached the page`);
    for (const [code, meta, ctrl, alt, , prevented] of seen) {
      if (!(meta || ctrl || alt)) continue;
      assert.equal(prevented, false, `${code} with a system modifier was preventDefault()ed — the browser shortcut is swallowed`);
    }
    // And none of them flew the aeroplane or spent ammunition.
    assert.deepEqual(after.loadout, before.loadout, 'a modified keystroke fired a weapon');
    assert.equal(after.squadron, before.squadron);
    assert.equal(after.mode, before.mode);
  });

  await t.test('but plain R still puts the next aeroplane on the deck', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      const p = W.sim.plane;
      p.mode = 'air';
      p.gear = false;
      p.y = 700; // straight into the sea on the next tick
      W.tick(1);
      return { mode: W.state().mode, squadron: W.state().squadron };
    });
    assert.equal(r.mode, 'down', 'the aeroplane did not crash as set up');
    await page.keyboard.press('KeyR');
    await page.evaluate(() => window.__WINGS.tick(1));
    const after = await page.evaluate(() => window.__WINGS.state());
    assert.equal(after.mode, 'deck', 'plain R no longer respawns');
    assert.equal(after.squadron, r.squadron, 'respawning cost another aeroplane');
  });

  await t.test('a game key released while a modifier is held does not stay stuck down', async () => {
    // macOS withholds keyup for a key released while Cmd is down, and reaching
    // for Cmd mid-hold would otherwise leave full aileron on forever.
    await fly({ x: 900, y: 250, speed: 2.5 });
    await page.keyboard.down('ArrowRight');
    await page.evaluate(() => window.__WINGS.tick(2));
    await page.keyboard.down('Meta');
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('Meta');
    const throttleAfter = await page.evaluate(() => {
      const W = window.__WINGS;
      W.tick(1);
      return W.state().throttle;
    });
    assert.equal(throttleAfter, 0, 'the aeroplane is still holding thrust after the key was released under Cmd');
  });

  await t.test('no uncaught page errors', () => {
    assert.deepEqual(ctx.errors, []);
  });
});
