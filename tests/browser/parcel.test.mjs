import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

// THE USER'S ASK: "if mario is coming to a chasm too big to jump because of
// destroyed ground, give him a parcel containing 5 coins and a toolbelt".
//
// The decision itself is unit-tested to death in tests/unit/stranded.test.js
// against grids. What can only be proved in a browser is that the rule is
// wired to the RUNNING GAME: that it reads the live tile map the bombs have
// been chewing on, that it fires on the engine's own fixed step, and that what
// comes out the other end is a Mario who is actually wearing the belt with
// actual coins in an actual wallet.
//
// Everything below drives the game through window.__TELEGRAPH.run(), which
// advances the engine and the wings layer in lockstep — the parcel lives on the
// overlay's hook list, so a test that ticked only the engine would tick past it
// and pass with the feature missing.

// 1-1's floor is rows 13 and 14 — the last two rows of a fifteen-row map.
//
// This said 12 and 13, and every crater in the file therefore left row 14
// untouched: the floor still had a course under it and Mario could walk across,
// so the parcel correctly declined to pay for a hole that was not there.
const GROUND_ROWS = [13, 14];

// A crater takes the FLOOR AND WHAT IS STANDING ON IT, which is what a bombing
// run actually does — the blast radius is circular and several tiles across.
// Clearing only the two floor courses left 1-1's own blocks hanging over the
// hole as stepping stones, and a chasm you can hop across is not a chasm: see
// the subtest below, which is that case on purpose.
const CRATER_TOP = GROUND_ROWS[0] - 4;

const craterKeys = (from, width) => {
  const keys = [];
  for (let tx = from; tx < from + width; tx++) {
    for (let ty = CRATER_TOP; ty <= GROUND_ROWS[1]; ty++) keys.push(`${tx},${ty}`);
  }
  return keys;
};

// The same span, floor only: what a single bomb takes out of the ground while
// leaving anything above it standing.
const floorKeys = (from, width) => {
  const keys = [];
  for (let tx = from; tx < from + width; tx++) {
    for (const ty of GROUND_ROWS) keys.push(`${tx},${ty}`);
  }
  return keys;
};

// WHERE TO DIG, found in the level rather than written down.
//
// The first draft cratered a column number picked by eye and got no parcel,
// because 1-1 has blocks hanging over that stretch and one of them is the warp
// zone pipe, which is indestructible. Both are somewhere to land, so the chasm
// was crossable and the rule was right to say so — the point of the run below.
//
// Hard-coded columns are also the recurring way tests in this repo rot: they
// are derived from upstream level data, and upstream regenerates its levels.
// Asking the level is stable across that.

// How much floor Mario needs behind the near lip before this test will use a
// site. Enough to be standing on the level rather than on another hole's edge.
const RUNUP_TILES = 4;

// LONG ENOUGH FOR THE CRATE TO COME DOWN. The goods no longer change hands on
// the tick the chasm is noticed: a supply crate falls for FALL_TICKS (62) under
// a parachute and delivers when it lands, so every assertion about `given` has
// to outlast one scan interval plus the whole fall. Sixty ticks used to be
// plenty and is now half an answer.
const DELIVERED = 140;

const clearRun = (page, width, after) =>
  page.evaluate(([w, a, RUNUP_TILES]) => {
    const lvl = window.__GAME.world.rootLevel;
    const rows = lvl.tiles;
    const floor = rows.length - 2;
    const clear = (tx) => {
      // Solid floor to blow away, and nothing INDESTRUCTIBLE standing on it:
      // the crater takes everything above the floor with it, but a warp zone
      // pipe would survive the bombing and stand there as a stepping stone.
      for (const ty of [floor, floor + 1]) if (rows[ty][tx] !== '#') return false;
      for (let ty = floor - 4; ty < floor; ty++) {
        if ('[]{}<>-'.includes(rows[ty][tx])) return false;
      }
      return true;
    };
    for (let tx = a; tx < lvl.width - w - 2; tx++) {
      let ok = true;
      // RUN-UP ROOM BEHIND IT, not just a lip. The first version asked for one
      // column either side and picked column 72 — whose four tiles of approach
      // are 1-1's own pit at 69. Mario was then standing at the edge of a hole
      // the level shipped with, the scan found that one first, and it is
      // jumpable, so no parcel: right answer, wrong hole.
      for (let i = -RUNUP_TILES; i <= w; i++) if (!clear(tx + i)) { ok = false; break; }
      if (ok) return tx;
    }
    return -1;
  }, [width, after, RUNUP_TILES]);

test('the parcel', { timeout: 120000 }, async (t) => {
  const ctx = await boot();
  const { page } = ctx;
  t.after(() => shutdown(ctx));

  const state = () =>
    page.evaluate(() => {
      const w = window.__GAME.world;
      return {
        given: window.__PARCEL.given(),
        last: window.__PARCEL.last(),
        power: w.player.power,
        coins: w.coins,
        wallet: w.harryMode === true,
      };
    });

  await t.test('walking 1-1 as it shipped earns nothing, holes and all', async () => {
    await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(6, 11);
      window.__TELEGRAPH.run(60);
    });
    // Every one of 1-1's own pits, walked past. They are the level being the
    // level and the pilot has done nothing; a parcel here would be the feature
    // paying out for the wrong reason.
    for (const tx of [60, 68, 86, 118, 122, 152]) {
      await page.evaluate((x) => {
        window.__GAME.teleport(x, 11);
        window.__TELEGRAPH.run(40);
      }, tx);
    }
    const s = await state();
    assert.equal(s.given, 0, `a shipped hole paid out: ${JSON.stringify(s.last)}`);
    assert.notEqual(s.power, 'toolbelt', 'he was given the belt for 1-1 as authored');
  });

  await t.test('blocks left hanging over the hole mean no parcel', async () => {
    // THE USER'S RULE: "if there are blocks in the air that can be used even
    // though harder, no parcel reward." A crossing that is merely difficult is
    // still a crossing, and this feature is for a man with nowhere to go.
    //
    // 1-1 supplies the case without any help: the stretch around column 20 has
    // a row of blocks above it and the warp zone pipe standing in it, and the
    // pipe cannot be bombed at all. Blow the whole floor out from under it and
    // he still has a route, so nothing is owed.
    const s = await page.evaluate(([keys, DELIVERED]) => {
      window.__GAME.teleport(14, 11);
      window.__TELEGRAPH.run(20);
      window.__GAME.destroyTiles(keys);
      window.__TELEGRAPH.run(DELIVERED);
      return { given: window.__PARCEL.given(), last: window.__PARCEL.last() };
    }, [floorKeys(20, 12), DELIVERED]);
    assert.equal(s.given, 0, `a chasm with stepping stones over it paid out: ${JSON.stringify(s.last)}`);
  });

  await t.test('a chasm the bombs dug pays out five coins and the toolbelt', async () => {
    const before = await state();
    // A stretch with nothing overhead, found in the level: see clearRun.
    const at = await clearRun(page, 12, 30);
    assert.ok(at > 0, '1-1 has no twelve-tile stretch of open floor to crater');

    const destroyed = await page.evaluate(([keys, tx, DELIVERED]) => {
      window.__GAME.teleport(tx - 2, 11);
      window.__TELEGRAPH.run(20);
      const gone = window.__GAME.destroyTiles(keys);
      window.__TELEGRAPH.run(DELIVERED);
      return gone.length;
    }, [craterKeys(at, 12), at, DELIVERED]);
    assert.ok(destroyed > 0, 'nothing was cratered, so this proves nothing');

    const s = await state();
    assert.equal(s.given, 1, `no parcel: ${JSON.stringify(s.last)}`);
    assert.equal(s.last.reason, 'cratered');
    assert.equal(s.last.gap.start, at, 'the chasm the bombs made starts where they landed');
    assert.equal(s.power, 'toolbelt', 'he is not wearing the belt');
    assert.equal(s.coins - before.coins, 5, 'five coins, one per brick bomb');
    assert.equal(s.wallet, true, 'the coins are not a spendable wallet');
  });

  await t.test('the toolbelt he was given is the toolbelt the game already had', async () => {
    // Not a new power invented for this feature: SELECT throws a BRICK BOMB
    // that lays a row of bricks, out of src/game/entities/brickbomb.js. Proved
    // by throwing one and finding the row, which is also the only reason the
    // parcel is worth anything to a stranded man.
    const r = await page.evaluate(() => {
      const w = window.__GAME.world;
      const p = w.player;
      p.fireCooldown = 0;
      p._throwBrickBomb();
      const inFlight = w.entities.filter((e) => e.isBrickBomb === true && !e.removed).length;
      window.__TELEGRAPH.run(180);
      return {
        inFlight,
        gone: w.entities.filter((e) => e.isBrickBomb === true && !e.removed).length,
      };
    });
    assert.equal(r.inFlight, 1, 'SELECT with the belt on threw no brick bomb');
    assert.equal(r.gone, 0, 'the bomb never went off');
  });

  await t.test('a second bomb into the same chasm is not a second parcel', async () => {
    const at = await clearRun(page, 12, 30);
    const s = await page.evaluate(([keys, tx, DELIVERED]) => {
      window.__GAME.destroyTiles(keys);
      window.__GAME.teleport(tx - 2, 11);
      window.__TELEGRAPH.run(DELIVERED);
      return window.__PARCEL.given();
    }, [craterKeys(at + 12, 6), at, DELIVERED]);
    assert.equal(s, 1, 'widening the same chasm handed out a second parcel');
  });

  await t.test('a fresh chasm somewhere else is a second parcel', async () => {
    // Well clear of the first, and again somewhere with nothing overhead.
    const first = await clearRun(page, 12, 30);
    const at = await clearRun(page, 12, first + 40);
    assert.ok(at > 0, '1-1 has no second clear stretch to crater');

    const s = await page.evaluate(([keys, tx, DELIVERED]) => {
      window.__GAME.destroyTiles(keys);
      window.__GAME.teleport(tx - 2, 11);
      window.__TELEGRAPH.run(DELIVERED);
      return { given: window.__PARCEL.given(), last: window.__PARCEL.last() };
    }, [craterKeys(at, 12), at, DELIVERED]);
    assert.equal(s.given, 2, `no parcel for the second chasm: ${JSON.stringify(s.last)}`);
  });

  await t.test('the parcel arrives as a crate you can watch coming down', async () => {
    // THE USER'S COMPLAINT: "the parcel drops on the character so I can't even
    // see it." The goods used to be handed over on the tick the chasm was
    // noticed, with nothing on screen at all. Everything below is about there
    // being an OBJECT, falling, for long enough to read, beside him.
    //
    // A CLEAN 1-1 rather than a third clear stretch to crater: reloading puts
    // every hole back where the tile map says it is and takes the belt off him,
    // so the first site works again and this subtest does not depend on the
    // level having yet another twelve tiles of open floor left over.
    await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__TELEGRAPH.run(30);
    });
    const before = await state();
    const at = await clearRun(page, 12, 30);
    assert.ok(at > 0, '1-1 has no twelve-tile stretch of open floor to crater');

    const flight = await page.evaluate(([keys, tx]) => {
      // TELEPORT AND LAND FIRST, then crater — the same order as the subtest
      // above, and it matters: teleport drops him in two tiles above the floor
      // and the scan ignores a man who is not standing on anything, so a crater
      // laid while he was still falling would not be noticed for as long as it
      // took him to come down.
      window.__GAME.teleport(tx - 2, 11);
      window.__TELEGRAPH.run(20);
      window.__GAME.destroyTiles(keys);
      // One scan interval and a couple of frames: enough for the chasm to be
      // noticed and the crate to be in the air, nowhere near enough for it to
      // have landed.
      window.__TELEGRAPH.run(14);
      const p = window.__GAME.world.player;
      const early = window.__PARCEL.drop();
      const sampled = [];
      for (let i = 0; i < 5; i++) {
        window.__TELEGRAPH.run(6);
        const s = window.__PARCEL.drop();
        if (s) sampled.push({ x: s.x, y: s.y, phase: s.phase });
      }
      return {
        early,
        sampled,
        given: window.__PARCEL.given(),
        coins: window.__GAME.world.coins,
        marioX: p.x + p.w / 2,
        marioFeet: p.y + p.h,
      };
    }, [craterKeys(at, 12), at]);

    assert.ok(flight.early, 'no crate was ever put in the air');
    assert.equal(flight.early.phase, 'fall');
    // Nothing has been handed over yet — the counter has not moved and the
    // wallet is untouched — which is the difference between a delivery and the
    // flash this replaces.
    assert.equal(flight.given, before.given, 'the goods arrived before the crate did');
    assert.equal(flight.coins, before.coins, 'the coins arrived before the crate did');

    // It came from above the top of the screen — the view is 240 tall — rather
    // than appearing in mid-air next to him.
    assert.ok(
      flight.early.y < flight.marioFeet - 180,
      `the crate started only ${Math.round(flight.marioFeet - flight.early.y)}px up`
    );
    // It is falling, and it is BESIDE him rather than behind his own sprite,
    // which is the whole of the complaint.
    const ys = flight.sampled.map((s) => s.y);
    assert.ok(ys.length >= 4, 'the crate vanished mid-flight');
    for (let i = 1; i < ys.length; i++) {
      assert.ok(ys[i] > ys[i - 1], `the crate stopped falling at sample ${i}`);
    }
    for (const s of flight.sampled) {
      assert.ok(
        Math.abs(s.x - flight.marioX) > 8,
        `the crate is coming down on top of him (${Math.round(s.x - flight.marioX)}px away)`
      );
      assert.ok(s.x < flight.marioX, 'the crate is coming down on the chasm side of him');
    }

    // And when it lands, THEN he is paid. Forty more ticks is past the landing
    // and well inside the time the crate then sits there being looked at.
    const landed = await page.evaluate(() => {
      window.__TELEGRAPH.run(40);
      const w = window.__GAME.world;
      return {
        given: window.__PARCEL.given(),
        drop: window.__PARCEL.drop(),
        power: w.player.power,
        coins: w.coins,
      };
    });
    assert.equal(landed.given, before.given + 1, 'the crate landed and nothing was handed over');
    assert.equal(landed.power, 'toolbelt');
    assert.equal(landed.coins - before.coins, 5, 'five coins, one per brick bomb');
    assert.ok(landed.drop, 'the crate vanished the instant it landed');
    assert.equal(landed.drop.phase, 'rest', 'it is still falling long after it should be down');

    // And it does not lie there for ever: it has already given him everything
    // it holds, and a crate that stayed on screen would be litter.
    const gone = await page.evaluate(() => {
      window.__TELEGRAPH.run(200);
      return window.__PARCEL.drop();
    });
    assert.equal(gone, null, 'the crate is still lying there two hundred ticks later');
  });

  await t.test('the page threw nothing while all of that happened', () => {
    assert.deepEqual(ctx.errors, []);
  });
});
