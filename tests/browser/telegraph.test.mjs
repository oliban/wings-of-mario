import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

test('the telegraph on Mario\'s screen', async (t) => {
  const ctx = await boot();
  const page = ctx.page;
  t.after(() => shutdown(ctx));

  // Column 30 of 1-1 is open ground down to row 13 — the same column the
  // tier-1 tests use, so the two suites agree about the fixture.
  const COL = 30;

  await page.evaluate(async () => {
    await window.__GAME.loadLevel('1-1');
    // Stop the rAF loop. Everything below then advances exactly as far as
    // __GAME.tick() says and no further, which is the only way these
    // assertions can be about numbers rather than about timing.
    window.__GAME.pause();
    window.__TELEGRAPH.clear();
  });

  // Count the reticle's own colour on the overlay canvas. It is drawn with
  // whole-pixel fillRects under an integer scale transform, so the match is
  // exact rather than approximate.
  const countReticle = () =>
    page.evaluate(() => {
      const c = document.getElementById('wings-overlay');
      if (!c || !c.width) return -1;
      const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] === 0xff && px[i + 1] === 0x3b && px[i + 2] === 0x2f && px[i + 3] > 200) n++;
      }
      return n;
    });

  await t.test('the overlay canvas exists and matches the game canvas', async () => {
    const r = await page.evaluate(() => {
      window.__TELEGRAPH.pump();
      const c = document.getElementById('wings-overlay');
      const src = window.__GAME.renderer.canvas;
      return c
        ? {
          found: true,
          w: c.width, h: c.height,
          srcW: src.width, srcH: src.height,
          left: c.style.left, srcLeft: `${src.offsetLeft}px`,
          z: c.style.zIndex,
        }
        : { found: false };
    });
    assert.equal(r.found, true, 'the wings overlay was never mounted');
    assert.equal(r.w, r.srcW, 'the overlay is not the same size as the screen');
    assert.equal(r.h, r.srcH);
    assert.equal(r.left, r.srcLeft, 'the overlay is not aligned with the screen');
    assert.equal(r.z, '3', 'it must sit above #overlay, which is 2');
  });

  await t.test('the engine still owns #overlay, and we did not take it', async () => {
    const r = await page.evaluate(() => {
      const harry = document.getElementById('overlay');
      return { present: !!harry, id: harry && harry.id };
    });
    assert.deepEqual(r, { present: true, id: 'overlay' });
  });

  await t.test('a bomb acquires a mark on the tile it will hit', async () => {
    const r = await page.evaluate((col) => {
      window.__TELEGRAPH.clear();
      window.__GAME.teleport(col, 12);
      window.__TELEGRAPH.drop({ tx: col, ty: 13, height: 200 });
      window.__TELEGRAPH.run(1);
      return window.__TELEGRAPH.marks();
    }, COL);
    assert.equal(r.length, 1);
    assert.ok(r[0].impact, 'no impact prediction');
    assert.equal(r[0].impact.tx, COL);
    assert.equal(r[0].impact.ty, 13, 'the reticle must sit on the ground row');
    assert.ok(r[0].impact.ticks > 30, 'a bomb 200px up should give real warning');
  });

  await t.test('the reticle paints before impact, and tightens', async () => {
    const first = await page.evaluate((col) => {
      window.__TELEGRAPH.clear();
      window.__GAME.teleport(col, 12);
      window.__TELEGRAPH.drop({ tx: col, ty: 13, height: 200 });
      window.__TELEGRAPH.run(1);
      return window.__TELEGRAPH.marks()[0].radius;
    }, COL);
    const painted = await countReticle();
    const later = await page.evaluate(() => {
      window.__TELEGRAPH.run(20);
      return window.__TELEGRAPH.marks()[0].radius;
    });
    assert.ok(painted > 8, `${painted} reticle pixels is not a reticle`);
    assert.ok(later < first, `radius went ${first} -> ${later}, it must shrink`);
  });

  await t.test('the whistle is scheduled from the moment of release', async () => {
    const s = await page.evaluate((col) => {
      window.__TELEGRAPH.clear();
      window.__GAME.teleport(col, 12);
      window.__TELEGRAPH.drop({ tx: col, ty: 13, height: 200 });
      window.__TELEGRAPH.run(1);
      return window.__TELEGRAPH.sounds();
    }, COL);
    assert.equal(s.length, 1);
    assert.ok(s[0].dur > 0);
    assert.ok(s[0].freq > s[0].to, 'a falling whistle must fall');
    // Not exactly zero: small Mario is 12px wide, so his centre sits 2px left
    // of the centre of the tile the bomb is dropped over. 2/PAN_RANGE is
    // 0.006 — inaudible, and the point of the assertion is that a bomb
    // overhead is not pushed to either ear.
    assert.ok(Math.abs(s[0].pan) < 0.05, `a bomb straight overhead is centred, got ${s[0].pan}`);
  });

  await t.test('a bomb off to the side pans, and is off camera', async () => {
    const r = await page.evaluate((col) => {
      window.__TELEGRAPH.clear();
      window.__GAME.teleport(col, 12);
      // Twelve tiles to the right and well up: off camera vertically.
      window.__TELEGRAPH.drop({ tx: col + 12, ty: 13, height: 600 });
      window.__TELEGRAPH.run(1);
      const m = window.__TELEGRAPH.marks()[0];
      return { pan: m.pan, y: m.y, camY: window.__GAME.world.rcam.y };
    }, COL);
    assert.ok(r.pan > 0, 'a bomb to the right must pan right');
    assert.ok(r.y < r.camY, 'test premise: the bomb is above the top of the camera');
  });

  await t.test('the mark disappears when the bomb lands, and the overlay clears', async () => {
    const left = await page.evaluate((col) => {
      window.__TELEGRAPH.clear();
      window.__GAME.teleport(col, 12);
      window.__TELEGRAPH.drop({ tx: col, ty: 13, height: 200 });
      window.__TELEGRAPH.run(160);
      return window.__TELEGRAPH.marks().length;
    }, COL);
    assert.equal(left, 0, 'the bomb is still being telegraphed after it landed');
    assert.equal(await countReticle(), 0, 'the overlay never cleared itself');
  });

  await t.test('the reticle lands ON-SCREEN for a known bomb and known Mario position', async () => {
    // The explicit acceptance check for the coordinate-seam guard added in
    // Step 5a: for a bomb at a known tile and Mario at a known position, the
    // painted reticle pixels must fall inside the visible canvas. The classic
    // failure mode is a forgotten world->local conversion, which does not
    // crash anything — it silently offsets the reticle by ISLAND_TOP_Y (320)
    // px, which for a 240px-tall canvas means every reticle pixel lands
    // outside it. Asserting "it is somewhere on screen" is therefore already
    // an assertion that the seam was crossed correctly, not just that
    // something was drawn.
    const r = await page.evaluate((col) => {
      window.__TELEGRAPH.clear();
      window.__GAME.teleport(col, 12);
      window.__TELEGRAPH.drop({ tx: col, ty: 13, height: 200 });
      window.__TELEGRAPH.run(1);
      const c = document.getElementById('wings-overlay');
      return { w: c.width, h: c.height };
    }, COL);
    const painted = await countReticle();
    assert.ok(painted > 8, `${painted} reticle pixels is not a reticle`);
    assert.ok(r.w > 0 && r.h > 0, 'the overlay canvas has no area to have painted into');
    // countReticle() only scans [0, c.width) x [0, c.height): a nonzero count
    // is already proof every lit pixel is within those bounds, i.e. on
    // screen, not ISLAND_TOP_Y (320px) below it.
  });

  await t.test('a crater under the bomb drops the reticle to the next surface', async () => {
    const r = await page.evaluate((col) => {
      window.__TELEGRAPH.clear();
      window.__GAME.teleport(col, 12);
      // Blow the ground out from under the column first, then aim at it.
      window.__GAME.blast(col * 16 + 8, 13 * 16 + 8, 2);
      window.__TELEGRAPH.drop({ tx: col, ty: 13, height: 200 });
      window.__TELEGRAPH.run(1);
      const m = window.__TELEGRAPH.marks()[0];
      return { ty: m.impact.ty, h: window.__GAME.world.h };
    }, COL);
    assert.ok(r.ty >= r.h, 'the reticle must fall through a hole, exactly as the bomb will');
  });

  await t.test('no uncaught page errors', async () => {
    assert.deepEqual(ctx.errors, []);
  });
});
