import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';
import { CELLS, HUD_H, RADAR_SCORCH } from '../../src/wings/art/hud.js';
import { VIEW_H, ISLAND_TOP_Y } from '../../src/wings/geo.js';
import { TILE } from '../../src/core/constants.js';

// radar-terrain.test.js proves the profile is right. This proves it reaches the
// glass: that the instrument draws a SHAPE rather than a bar, and that a bombed
// island looks bombed. Both are read off the pilot's own framebuffer.
test('the radar draws terrain, not bars', async (t) => {
  const ctx = await boot({ path: '/pilot.html', global: '__WINGS' });
  const page = ctx.page;
  t.after(() => shutdown(ctx));

  // The radar cell in framebuffer pixels. The pilot's buffer is supersampled,
  // so everything scales by the same factor rather than being hard-coded.
  const rect = await page.evaluate(([cell, hudH, viewH]) => {
    const buf = window.__WINGS.renderer.buffer;
    const ss = buf.width / 512;
    // Inset by the window's 1px bezel, or every column's topmost "non-sky"
    // pixel is the frame and the whole skyline reads flat.
    return {
      ss,
      x: cell[0] * ss + ss,
      w: (cell[1] - cell[0]) * ss - 2 * ss,
      y: (viewH - hudH + 4) * ss + ss,
      h: (hudH - 8) * ss - 2 * ss,
    };
  }, [CELLS.radar, HUD_H, VIEW_H]);

  // The height of the ground in every column of the radar window, counted UP
  // from the horizon. A row of solid bars gives one height per island; terrain
  // gives many.
  //
  // Counted from the horizon rather than down from the top on purpose: a
  // roofed island's topmost mark is its lid, which is flat by construction, so
  // a top-down scan would report 1-2 and 1-4 as bars when their ground is the
  // most interesting on the map.
  const skyline = () =>
    page.evaluate((r) => {
      const buf = window.__WINGS.renderer.buffer;
      const px = buf.getContext('2d').getImageData(r.x, r.y, r.w, r.h).data;
      const at = (cx, cy) => {
        const i = (cy * r.w + cx) * 4;
        return [px[i], px[i + 1], px[i + 2]];
      };
      // The radar's sky is one flat colour; sample it past the last island,
      // above everything, rather than naming it here.
      const sky = at(r.w - 2, 0);
      // The sweep beam and the range graticule are washes of a few per cent
      // over that sky. Terrain is opaque and nothing like it, so a generous
      // threshold reads the land and ignores the instrument's own furniture.
      const land = (cx, cy) => {
        const p = at(cx, cy);
        return Math.max(...p.map((v, i) => Math.abs(v - sky[i]))) > 60;
      };
      // The waterline sits ON the horizon row; the ground stacks above it.
      const horizon = Math.round(r.h / 2);
      const out = [];
      for (let cx = 0; cx < r.w; cx++) {
        let n = 0;
        while (n < horizon && land(cx, horizon - 1 - n)) n++;
        out.push(n);
      }
      return out;
    }, rect);

  const countScorch = () =>
    page.evaluate(([r, hex]) => {
      const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const buf = window.__WINGS.renderer.buffer;
      const px = buf.getContext('2d').getImageData(r.x, r.y, r.w, r.h).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] === rgb[0] && px[i + 1] === rgb[1] && px[i + 2] === rgb[2]) n++;
      }
      return n;
    }, [rect, RADAR_SCORCH]);

  const islands = await page.evaluate(() => {
    window.__WINGS.reset();
    window.__WINGS.tick(2);
    const s = window.__WINGS.sim;
    return {
      bounds: { minX: s.bounds.minX, maxX: s.bounds.maxX },
      list: s.islands.map((i) => ({ id: i.id, x0: i.x0, x1: i.x1 })),
    };
  });

  // Where each island lands in the skyline array.
  const span = islands.bounds.maxX - islands.bounds.minX;
  const cols = (isle) => {
    const to = (wx) => Math.round(((wx - islands.bounds.minX) / span) * rect.w);
    return [to(isle.x0), to(isle.x1)];
  };

  await t.test('each island has a profile, not a single height', async () => {
    const sky = await skyline();
    for (const isle of islands.list) {
      const [a, b] = cols(isle);
      const heights = new Set(sky.slice(a, b));
      assert.ok(heights.size >= 3,
        `${isle.id} draws ${heights.size} distinct height(s) across ${b - a}px — that is a bar, not terrain`);
    }
  });

  await t.test('no two islands draw the same skyline', async () => {
    const sky = await skyline();
    const shape = (isle) => {
      const [a, b] = cols(isle);
      const s = sky.slice(a, b);
      // Resampled to a common length so two islands of different widths are
      // compared on shape rather than on size.
      return Array.from({ length: 12 }, (_, i) => s[Math.floor((i * s.length) / 12)] ?? 0);
    };
    const shapes = islands.list.map(shape);
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        assert.notDeepEqual(shapes[i], shapes[j],
          `${islands.list[i].id} and ${islands.list[j].id} paint the same skyline`);
      }
    }
  });

  await t.test('nothing is scorched before a single bomb is dropped', async () => {
    assert.equal(await countScorch(), 0, 'the map is showing damage nobody did');
  });

  await t.test('a bombed island reads as bombed', async () => {
    const before = await skyline();
    await page.evaluate(([id, topY, tile]) => {
      const W = window.__WINGS;
      const isle = W.sim.islands.find((s) => s.id === id);
      for (let tx = 20; tx < 120; tx += 5) {
        isle.blast(isle.x0 + tx * tile, topY + 13.5 * tile, 4);
      }
      W.tick(1);
    }, [islands.list[0].id, ISLAND_TOP_Y, TILE]);

    assert.ok((await countScorch()) > 0, 'a hundred tiles of crater and not one scorch mark');

    const after = await skyline();
    const [a, b] = cols(islands.list[0]);
    let sank = 0;
    for (let i = a; i < b; i++) if (after[i] < before[i]) sank++;
    assert.ok(sank > 0, 'the silhouette did not fall where the ground was blown away');

    // ...and only there. The other three islands were never touched.
    for (const isle of islands.list.slice(1)) {
      const [c, d] = cols(isle);
      assert.deepEqual(after.slice(c, d), before.slice(c, d),
        `${isle.id} changed on the map without being bombed`);
    }
  });

  await t.test('no uncaught page errors', async () => {
    assert.deepEqual(ctx.errors, []);
  });
});
