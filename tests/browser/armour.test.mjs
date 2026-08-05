import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

// GROUND NO BOMB WILL TAKE, and whether the pilot can SEE that it is.
//
// Two rules make tiles indestructible: the spawn sanctuary, so Mario cannot be
// pre-bombed into a death loop, and the warp pipes, so a door out of the level
// cannot be quietly deleted (both in src/wings/sanctuary.js). Neither was
// visible from the air, so the only way to discover them was to waste twelve
// bombs on ground that never moved — which reads as a broken game rather than
// as a rule.
//
// THE ASSERTION IS A COMPARISON, not a colour. 1-1 carries both kinds of pipe:
// three that hold warps and several that are scenery, drawn from the same art
// with the same materials. If the wash works, the two look different; if it
// does not, they are identical. Pinning an rgb value would break the moment
// anyone retunes the tint, and would not prove the wash landed on the right
// tiles.

// Where a tile of an island lands in the framebuffer. land.js translates by
// (isle.x0 - cam.x, isle.y0 - cam.y) and draws each tile at (tx, ty) * TILE,
// then the world layer is drawn through ctx.scale(f.scale) and the buffer is
// supersampled on top of that.
const sampleTile = (page, tx, ty) =>
  page.evaluate(([x, y]) => {
    const W = window.__WINGS;
    const buf = W.renderer.buffer;
    const ss = buf.width / 512;
    const f = W.scene.frame(W.sim);
    const isle = W.sim.islands[0];
    const vx = isle.x0 - f.cam.x + x * 16;
    const vy = isle.y0 - f.cam.y + y * 16;
    const px = Math.round(vx * f.scale * ss);
    const py = Math.round(vy * f.scale * ss);
    const w = Math.max(1, Math.round(16 * f.scale * ss));
    const g = buf.getContext('2d');
    const d = g.getImageData(px, py, w, w).data;
    // The mean colour of the tile: robust to a pixel of rounding either way,
    // which a single-pixel probe is not.
    let r = 0; let gg = 0; let b = 0; let n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    return { r: r / n, g: gg / n, b: b / n, px, py, w };
  }, [tx, ty]);

test('the pilot can see which ground his bombs will not take', async (t) => {
  const ctx = await boot({ path: '/pilot.html?headless', global: '__WINGS' });
  const page = ctx.page;
  t.after(() => shutdown(ctx));

  // 1-1's pipes, split by the island's OWN predicate — the same function
  // destroyTiles consults, so this can never test a colour the ordnance
  // disagrees with.
  const pipes = await page.evaluate(() => {
    const W = window.__WINGS;
    W.reset();
    W.tick(2);
    const isle = W.sim.islands[0];
    const out = { warp: [], plain: [] };
    for (let ty = 0; ty < isle.h; ty++) {
      for (let tx = 0; tx < isle.w; tx++) {
        if (!'[]{}<>-'.includes(isle.charAt(tx, ty))) continue;
        (isle.destructibleTile(tx, ty) ? out.plain : out.warp).push({ tx, ty });
      }
    }
    return out;
  });

  await t.test('1-1 has both kinds of pipe, so the comparison means something', () => {
    assert.ok(pipes.warp.length > 0, 'no warp pipe was protected');
    assert.ok(pipes.plain.length > 0, 'every pipe was protected; nothing to compare against');
  });

  await t.test('a warp pipe looks exactly like an ordinary one', async () => {
    // THE USER'S CALL, and a reversal of what this first asserted: pipes stay
    // the green they always were and are indestructible anyway. The wash is
    // therefore not a complete account of what a bomb will not take — the
    // ground says so, the pipes do not — and that is a deliberate trade to keep
    // Mario's most recognisable object looking like itself.
    //
    // Pinned rather than left alone, because a wash applied to every protected
    // tile is the obvious implementation and this is the one exception to it.
    const warp = pipes.warp[0];
    const plain = pipes.plain[0];
    await page.evaluate(([a, b]) => {
      const W = window.__WINGS;
      const isle = W.sim.islands[0];
      W.flyTo(isle.x0 + ((a + b) / 2) * 16, 420);
      W.tick(2);
    }, [warp.tx, plain.tx]);

    const armoured = await sampleTile(page, warp.tx, warp.ty);
    const bare = await sampleTile(page, plain.tx, plain.ty);
    const dist = Math.abs(armoured.r - bare.r)
      + Math.abs(armoured.g - bare.g) + Math.abs(armoured.b - bare.b);
    assert.ok(
      dist < 12,
      `a warp pipe is tinted differently from a plain one (distance ${dist.toFixed(1)}): `
      + `${JSON.stringify(armoured)} vs ${JSON.stringify(bare)}`
    );
  });

  await t.test('and it is indestructible regardless of how it looks', async () => {
    // The half that survives the colour being dropped: the protection is real
    // and is the island's own predicate, not a property of the paint.
    const verdicts = await page.evaluate(([warp, plain]) => {
      const isle = window.__WINGS.sim.islands[0];
      return {
        warp: isle.destructibleTile(warp.tx, warp.ty),
        plain: isle.destructibleTile(plain.tx, plain.ty),
      };
    }, [pipes.warp[0], pipes.plain[0]]);
    assert.equal(verdicts.warp, false, 'the warp pipe is bombable');
    assert.equal(verdicts.plain, true, 'a scenery pipe was made indestructible');
  });

  await t.test('the spawn floor is marked too, not just the pipes', async () => {
    // The sanctuary and a stretch of the same ground beyond it. Row 13 of 1-1
    // is floor from end to end, so this compares floor with floor.
    const cmp = await page.evaluate(() => {
      const W = window.__WINGS;
      const isle = W.sim.islands[0];
      const row = 13;
      let inside = null;
      let outside = null;
      for (let tx = 0; tx < 40; tx++) {
        const ch = isle.charAt(tx, row);
        if (ch !== '#') continue;
        if (!isle.destructibleTile(tx, row) && inside == null) inside = tx;
        if (isle.destructibleTile(tx, row) && inside != null && outside == null) outside = tx;
      }
      W.flyTo(isle.x0 + ((inside + outside) / 2) * 16, 420);
      W.tick(2);
      return { inside, outside, row };
    });
    assert.ok(cmp.inside != null && cmp.outside != null, 'no sanctuary/open floor pair on row 13');

    const armoured = await sampleTile(page, cmp.inside, cmp.row);
    const bare = await sampleTile(page, cmp.outside, cmp.row);
    const dist = Math.abs(armoured.r - bare.r)
      + Math.abs(armoured.g - bare.g) + Math.abs(armoured.b - bare.b);
    assert.ok(dist > 24, `the spawn floor looks like open floor (distance ${dist.toFixed(1)})`);
  });

  await t.test('nothing threw', () => {
    assert.deepEqual(ctx.errors, []);
  });
});
