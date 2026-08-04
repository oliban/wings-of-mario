import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

test('the radar contact', async (t) => {
  const ctx = await boot({ path: '/pilot.html', global: '__WINGS' });
  const page = ctx.page;
  t.after(() => shutdown(ctx));

  // Count the blip's exact colour, #b7ff5a, on the pilot's framebuffer.
  const countBlip = () =>
    page.evaluate(() => {
      const c = window.__WINGS.renderer.buffer;
      const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] === 0xb7 && px[i + 1] === 0xff && px[i + 2] === 0x5a) n++;
      }
      return n;
    });

  await t.test('the tube is dark before the first sweep', async () => {
    await page.evaluate(() => {
      window.__WINGS.reset();
      window.__WINGS.tick(1);
    });
    assert.equal(await page.evaluate(() => window.__WINGS.radar()), null);
    assert.equal(await countBlip(), 0, 'a blip with no contact is a cheat');
  });

  await t.test('a contact appears, fuzzed, and paints', async () => {
    const c = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      W.setFix({ x: 6000, y: 400, present: true });
      W.tick(120);
      return W.radar();
    });
    assert.ok(c, 'no contact after two sweeps');
    assert.ok(Math.abs(c.x - 6000) <= 260, 'the fuzz must be bounded');
    assert.notEqual(c.x, 6000, 'an exact fix is not a hunt');
    assert.ok((await countBlip()) > 0, 'the contact never reached the panel');
  });

  await t.test('losing the contact goes dark again', async () => {
    const c = await page.evaluate(() => {
      const W = window.__WINGS;
      W.setFix({ present: false });
      W.tick(400);
      return W.radar();
    });
    assert.equal(c, null);
    assert.equal(await countBlip(), 0);
  });

  await t.test('no uncaught page errors', async () => {
    assert.equal(await page.evaluate(() => window.__WINGS.fatal()), null);
    assert.deepEqual(ctx.errors, []);
  });
});
