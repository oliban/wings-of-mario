import test from 'node:test';
import assert from 'node:assert/strict';
import { bootRoom, shutdownRoom } from './helpers.mjs';

// THE USER'S ASK: "I want the brick bridges created by the grenade to be
// visible and bombable by the plane."
//
// Asserted on the PILOT'S OWN ISLAND — what his renderer is handed, and what
// his ordnance is allowed to take — never on a message having been sent. A
// message that arrives and changes nothing is the bug this file exists to
// catch, which is the same reason craters-cross-the-wire.test.mjs asserts on
// Mario's tile map rather than on the wire.
//
// The unit tests own the rule (tests/unit/built.test.js); the net tests own the
// server (tests/net/built.test.mjs). What can only be proved in two real
// browsers is the chain: Mario's engine writes a tile, his client notices
// without a line of src/game/ being edited, and the pilot ends up with a brick
// he can bomb.

// Columns 30-37 of 1-1 are seven rows of clear sky over the floor at rows
// 13/14 — read off src/data/levels/1-1.js, not guessed. A row of bricks laid
// here lands on nothing and takes nothing with it.
const CLEAR_TX = 32;
const CLEAR_TY = 10;

test('the bridges the toolbelt builds', { timeout: 180000 }, async (t) => {
  const ctx = await bootRoom({ room: 'ACDE' });
  t.after(() => shutdownRoom(ctx));
  const { mario, pilot } = ctx;

  // Both tabs are backgrounded as far as Chromium is concerned, so its rAF
  // throttle would be what we were measuring if we slept and hoped. Mario's
  // pump is called directly; the pilot's rides on __WINGS.tick().
  const settle = async (frames = 45) => {
    await pilot.page.evaluate((n) => window.__WINGS.tick(n), frames);
    await mario.page.evaluate((n) => {
      for (let i = 0; i < n; i++) window.__NET.pump();
    }, frames);
    await mario.page.waitForTimeout(250);
    await pilot.page.evaluate((n) => window.__WINGS.tick(n), frames);
    await mario.page.evaluate((n) => {
      for (let i = 0; i < n; i++) window.__NET.pump();
    }, frames);
  };

  const pilotSees = (tx, ty) =>
    pilot.page.evaluate(
      ({ x, y }) => {
        const isle = window.__WINGS.sim.islandById('1-1');
        return {
          ch: isle.charAt(x, y),
          blocks: isle.blocksTile(x, y),
          bombable: isle.destructibleTile(x, y),
          built: isle.builtKeys(),
          net: window.__WINGS.net.built('1-1'),
        };
      },
      { x: tx, y: ty }
    );

  await t.test('a tile Mario turns solid arrives on the pilot as a brick', async () => {
    // Through world.setTile, which is the engine call the brick bomb itself
    // makes (src/game/entities/brickbomb.js:538) and the one src/wings/bricks.js
    // wraps. No network call is made by hand anywhere in this test.
    const before = await pilotSees(CLEAR_TX, CLEAR_TY);
    assert.equal(before.ch, '.', 'the test site is not empty sky on the pilot\'s island');

    await mario.page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(30, 11);
      window.__GAME.tick(30);
    });
    await settle();
    await mario.page.evaluate(
      ({ x, y }) => window.__GAME.world.setTile(x, y, '='),
      { x: CLEAR_TX, y: CLEAR_TY }
    );
    await settle();

    const seen = await pilotSees(CLEAR_TX, CLEAR_TY);
    assert.equal(seen.ch, '=', 'the pilot cannot see the brick');
    assert.equal(seen.blocks, true, 'the aeroplane would fly straight through it');
    assert.equal(seen.bombable, true, 'the pilot could not bomb it');
    assert.deepEqual(seen.built, [`${CLEAR_TX},${CLEAR_TY}`]);
    assert.deepEqual(seen.net, [`${CLEAR_TX},${CLEAR_TY}`], 'the replica of the server\'s set');

    const ours = await mario.page.evaluate(() => window.__NET.built('1-1'));
    assert.deepEqual(ours, seen.net, 'the two clients hold different bridges');
  });

  await t.test('and the pilot can bomb it back off the map', async () => {
    const released = await pilot.page.evaluate(
      ({ x, y }) => {
        window.__WINGS.takeoff(900);
        return window.__WINGS.bombTile('1-1', x, y, 12000);
      },
      { x: CLEAR_TX, y: CLEAR_TY }
    );
    assert.equal(released, true, 'the pilot could not fly the run');
    await settle(120);

    const after = await pilotSees(CLEAR_TX, CLEAR_TY);
    assert.equal(after.ch, '.', 'the brick survived a bombing run');
    assert.deepEqual(after.built, [], 'a bombed brick is still listed as built');
    const gone = await pilot.page.evaluate(
      (key) => window.__WINGS.net.damage('1-1').includes(key),
      `${CLEAR_TX},${CLEAR_TY}`
    );
    assert.equal(gone, true, 'the destroyed set never learned about it');

    // And Mario agrees: the key changed sides on his client too, so the two
    // hash the same set a second later.
    const ours = await mario.page.evaluate(() => ({
      built: window.__NET.built('1-1'),
      damage: window.__NET.damage('1-1'),
    }));
    assert.deepEqual(ours.built, []);
    assert.ok(ours.damage.includes(`${CLEAR_TX},${CLEAR_TY}`));
  });

  await t.test('a real brick bomb, thrown by a real toolbelt, crosses the wire', async () => {
    // The whole chain, with nothing set by hand but the power-up: the toolbelt
    // is the game's own (src/game/entities/toolbelt.js), SELECT throws the
    // game's own brick bomb, and the row it lays is what the pilot ends up
    // holding.
    // WELL CLEAR OF THE SUBTESTS ABOVE. They laid a brick at column 32 and then
    // bombed it off, and those craters are RETAINED — reloading the level
    // re-applies them, so a row thrown here would land in the hole they left and
    // the bomb would have nothing to build on. The subtests share one room and
    // one match on purpose; each has to pick its own ground.
    const THROW_TX = 100;
    await mario.page.evaluate(async (tx) => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(tx, 11);
      window.__GAME.tick(30);
      const w = window.__GAME.world;
      w.harryMode = true;
      w.addCoin(5);
      w.player.powerUp('toolbelt');
      // The grow animation locks him for growFrames; a throw during it would
      // be swallowed.
      window.__GAME.tick(60);
      w.player.fireCooldown = 0;
      w.player._throwBrickBomb();
      // Long enough for the arc, the fuse and the whole five-tile sweep.
      window.__GAME.tick(240);
    }, THROW_TX);
    await settle(120);

    const ours = await mario.page.evaluate(() => window.__NET.built('1-1'));
    assert.ok(ours.length > 0, 'the throw laid no bricks at all — a dud, so this proves nothing');

    const theirs = await pilot.page.evaluate(() => ({
      net: window.__WINGS.net.built('1-1'),
      isle: window.__WINGS.sim.islandById('1-1').builtKeys(),
    }));
    assert.deepEqual(theirs.net, ours, 'the pilot holds a different row than Mario laid');
    assert.deepEqual(theirs.isle, ours, 'the row never reached the island he is looking at');

    // Every one of them is a brick on his screen and a target for his bombs.
    const drawn = await pilot.page.evaluate((keys) => {
      const isle = window.__WINGS.sim.islandById('1-1');
      return keys.map((k) => {
        const [x, y] = k.split(',').map(Number);
        return { k, ch: isle.charAt(x, y), bombable: isle.destructibleTile(x, y) };
      });
    }, ours);
    for (const tile of drawn) {
      assert.equal(tile.ch, '=', `${tile.k} is not a brick on the pilot's island`);
      assert.equal(tile.bombable, true, `${tile.k} is not bombable`);
    }
  });

  await t.test('neither page threw while all of that happened', () => {
    assert.deepEqual(mario.errors, []);
    assert.deepEqual(pilot.errors, []);
  });
});
