import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

// THE TOOLBELT IN THE QUESTION BLOCKS, against the REAL engine.
//
// tests/unit/toolbelt-blocks.test.js proves the rule against a fake whose
// seeding refuses outside Harry mode. What only a browser can prove is that
// upstream's actual BlockSystem behaves that way, that our re-seed lands on
// real '?' blocks in 1-1, and that bumping one hands over a real toolbelt —
// none of which a fake can be wrong about on our behalf.
//
// The user's ask: "they should come from blocks like before AND when
// stranded". The parcel is the second half and has its own file.
test('the toolbelt comes out of the blocks in an ordinary game', { timeout: 120000 }, async (t) => {
  const ctx = await boot();
  const { page } = ctx;
  t.after(() => shutdown(ctx));

  const load = (id) =>
    page.evaluate(async (lvl) => {
      await window.__GAME.loadLevel(lvl);
      // The seeder runs on the overlay's hook list, which is driven off the
      // engine's tick by MarioOverlay#pump — the same clock the parcel uses.
      window.__TELEGRAPH.run(30);
    }, id);

  await t.test('1-1 hides one in real question blocks, with Mario as Mario', async () => {
    await load('1-1');
    const s = await page.evaluate(() => {
      const w = window.__GAME.world;
      return {
        harry: w.harryMode === true,
        blocks: window.__PARCEL.blocks(),
        // Every seeded tile must be a real, visible '?' block: upstream picks
        // from exactly those, and a key pointing at sky would be a toolbelt
        // nobody can ever reach.
        recs: window.__PARCEL.blocks().map(({ tx, ty }) => {
          const rec = w.recAt(tx, ty);
          return {
            k: `${tx},${ty}`,
            question: rec && rec.question === true,
            invisible: rec && rec.invisible === true,
          };
        }),
      };
    });
    assert.equal(s.harry, false, 'the game was left in Harry mode');
    assert.ok(s.blocks.length > 0, 'no block in 1-1 is holding a toolbelt');
    for (const r of s.recs) {
      assert.equal(r.question, true, `${r.k} is not a question block`);
      assert.equal(r.invisible, false, `${r.k} is a hidden block: nobody would find it`);
    }
  });

  await t.test('bumping that block hands over the toolbelt', async () => {
    // THE WHOLE POINT, through the engine's own block bump: the item that comes
    // out is upstream's Toolbelt entity, and taking it puts him in the belt.
    const got = await page.evaluate(() => {
      const w = window.__GAME.world;
      const [{ tx, ty }] = window.__PARCEL.blocks();
      const k = `${tx},${ty}`;
      // Ask the block system what that tile holds, through the same private
      // lookup the bump path itself uses (BlockSystem#_contentsOf) — there is
      // no public one, and asserting on the item rather than only on the
      // entity is what proves the block is the source.
      const item = w.blocks._contentsOf(tx, ty, w.recAt(tx, ty));
      // Stand him under it and hit it.
      window.__GAME.teleport(tx, ty + 2);
      window.__TELEGRAPH.run(20);
      w.blocks.bump(tx, ty, w.player);
      window.__TELEGRAPH.run(200);
      const belt = w.entities.filter((e) => e.type === 'toolbelt' && !e.removed).length;
      return { k, item, belt, power: w.player.power };
    });
    assert.equal(got.item, 'toolbelt', `the block at ${got.k} does not hold a toolbelt`);
    // Either it is still standing there as an item, or he has already walked
    // into it — both prove it came out of the block.
    assert.ok(got.belt > 0 || got.power === 'toolbelt',
      'bumping the block produced no toolbelt at all');
  });

  await t.test('a coin room gets none, and the level keeps its own', async () => {
    // Upstream's rule for the same seeding: a bonus room's coin blocks stay
    // coin blocks. Our re-seed refuses sub-areas for the same reason.
    const s = await page.evaluate(() => {
      const w = window.__GAME.world;
      w.loadArea('1-1b', 3, 3);
      window.__TELEGRAPH.run(30);
      return { areaId: w.areaId, blocks: window.__PARCEL.blocks() };
    });
    assert.equal(s.areaId, '1-1b');
    assert.deepEqual(s.blocks, [], 'the coin room was seeded with a toolbelt');
  });

  await t.test('every level gets one, and the same one each time', async () => {
    // Seeded off the level id, so a player who dies and comes back finds it in
    // the same block — and a second world is not left out.
    const first = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-2');
      window.__TELEGRAPH.run(30);
      return window.__PARCEL.blocks();
    });
    assert.ok(first.length > 0, '1-2 has no toolbelt in it');

    const again = await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__TELEGRAPH.run(30);
      await window.__GAME.loadLevel('1-2');
      window.__TELEGRAPH.run(30);
      return window.__PARCEL.blocks();
    });
    assert.deepEqual(again, first, 'the toolbelt moved between two loads of 1-2');
  });

  await t.test('the page threw nothing', () => {
    assert.deepEqual(ctx.errors, []);
  });
});
