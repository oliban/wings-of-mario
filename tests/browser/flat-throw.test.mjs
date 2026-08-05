import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';
import { REACH_TILES } from '../../src/wings/flat-throw.js';

// THE STANDING THROW, against the real brick bomb.
//
// The user's words: "standing still should throw the grenade so it creates a
// bridge a bit to the right of the player on ground level."
//
// Upstream's launch is a pure function of how fast Mario is MOVING, so at a
// standstill the bomb goes straight up and the fuse ends at the apex: the row
// of bricks forms in the air over his head. That is the one throw the man this
// feature exists for can actually make — he is standing on the lip of a chasm
// and cannot run at it without running into it.
//
// tests/unit/flat-throw.test.js solves the arithmetic. Only a browser can say
// whether the row comes out on the floor row, three tiles along, in the real
// engine with the real bomb.

// A stretch of 1-1 with solid floor and nothing indestructible standing on it,
// found in the level rather than written down — hard-coded columns derived from
// upstream level data are the recurring way tests here rot.
const site = (page, span) =>
  page.evaluate((n) => {
    const w = window.__GAME.world;
    const rows = w.rootLevel.tiles;
    const floor = rows.length - 2;
    const clear = (tx) => {
      for (const ty of [floor, floor + 1]) if (rows[ty][tx] !== '#') return false;
      for (let ty = floor - 4; ty < floor; ty++) if ('[]{}<>-'.includes(rows[ty][tx])) return false;
      return true;
    };
    for (let tx = 30; tx < w.rootLevel.width - n - 2; tx++) {
      let ok = true;
      for (let i = 0; i < n; i++) if (!clear(tx + i)) { ok = false; break; }
      if (ok) return { at: tx, floor };
    }
    return { at: -1, floor };
  }, span);

test('a standing throw bridges ahead at ground level', { timeout: 120000 }, async (t) => {
  const ctx = await boot();
  const { page } = ctx;
  t.after(() => shutdown(ctx));

  let where = null;

  await t.test('he stands on the lip of a chasm with the belt on', async () => {
    await page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__TELEGRAPH.run(30);
    });
    where = await site(page, 18);
    assert.ok(where.at > 0, '1-1 has no clear stretch to stand a chasm in');

    const s = await page.evaluate(({ at, floor }) => {
      const w = window.__GAME.world;
      const p = w.player;
      // Everything from two tiles ahead of him onward, floor and all, so there
      // is genuinely nowhere to go and nothing overhead to hop across.
      const keys = [];
      for (let tx = at + 2; tx <= at + 15; tx++) {
        for (let ty = floor - 4; ty <= floor + 1; ty++) keys.push(`${tx},${ty}`);
      }
      w.destroyTiles(keys);
      window.__GAME.teleport(at, floor - 1);
      window.__TELEGRAPH.run(40);
      w.harryMode = true;
      w.addCoin(5);
      p.powerUp('toolbelt');
      window.__TELEGRAPH.run(60);
      return { grounded: p.grounded, power: p.power, facing: p.facing,
        feetRow: Math.floor((p.y + p.h) / 16), col: Math.floor((p.x + p.w / 2) / 16) };
    }, where);

    assert.equal(s.grounded, true, 'he is not standing on anything');
    assert.equal(s.power, 'toolbelt', 'he has no belt to throw with');
    assert.equal(s.facing, 1, 'he is not facing the chasm');
    assert.equal(s.feetRow, where.floor, 'he is not standing on the floor row');
    assert.equal(s.col, where.at, 'he is not on the lip');
  });

  await t.test('the row lands on the floor row, three tiles to his right', async () => {
    const r = await page.evaluate(({ at, floor }) => {
      const w = window.__GAME.world;
      const p = w.player;
      p.vx = 0; // standing still: the whole point
      p.fireCooldown = 0;
      p._throwBrickBomb();
      window.__TELEGRAPH.run(220);
      const bricks = [];
      for (let ty = floor - 5; ty <= floor + 1; ty++) {
        for (let tx = at - 2; tx <= at + 18; tx++) {
          const rec = w.recAt(tx, ty);
          if (rec && rec.name === 'brick') bricks.push({ tx, ty });
        }
      }
      return bricks;
    }, where);

    assert.ok(r.length > 0, 'the standing throw built nothing at all');
    // ON THE GROUND, not over his head — the whole complaint.
    for (const b of r) {
      assert.equal(b.ty, where.floor, `a brick landed on row ${b.ty}, not the floor row`);
    }
    // AHEAD OF HIM, and about three tiles along.
    const first = Math.min(...r.map((b) => b.tx));
    assert.ok(first > where.at, 'the row starts behind him or under his feet');
    assert.ok(Math.abs(first - (where.at + REACH_TILES)) <= 1,
      `the row starts ${first - where.at} tiles out, want about ${REACH_TILES}`);
    // A row, not a single brick: it has to be worth crossing.
    assert.ok(r.length >= 4, `only ${r.length} bricks: that is not a bridge`);
  });

  await t.test('and he can walk out onto it', async () => {
    // The point of the whole feature. Put him on the first brick and see that
    // it holds him up.
    const held = await page.evaluate(({ at, floor }) => {
      const w = window.__GAME.world;
      window.__GAME.teleport(at + 3, floor - 1);
      window.__TELEGRAPH.run(40);
      const p = w.player;
      return { grounded: p.grounded, feetRow: Math.floor((p.y + p.h) / 16), dead: !!p.dead };
    }, where);
    assert.equal(held.dead, false, 'he fell through his own bridge');
    assert.equal(held.grounded, true, 'the bridge does not hold him up');
    assert.equal(held.feetRow, where.floor, 'he is not standing on the row he built');
  });

  await t.test('a throw with a run behind it is still upstream\'s', async () => {
    // The fifteen-tile flat throw is good and is not this rule's business: it
    // must still go far, and further than the standing one.
    const far = await page.evaluate(({ at, floor }) => {
      const w = window.__GAME.world;
      const p = w.player;
      window.__GAME.teleport(at, floor - 1);
      window.__TELEGRAPH.run(30);
      p.vx = 2.5625; // flat out
      p.fireCooldown = 0;
      p._throwBrickBomb();
      const b = w.entities.find((e) => e.isBrickBomb && !e.removed);
      return b ? { vx: b.vx, fuse: b.fuse } : null;
    }, where);
    assert.ok(far, 'the running throw spawned no bomb');
    assert.ok(Math.abs(far.vx) > 3, `a running throw left the hand at ${far.vx.toFixed(2)}px/frame`);
  });

  await t.test('the page threw nothing', () => {
    assert.deepEqual(ctx.errors, []);
  });
});
