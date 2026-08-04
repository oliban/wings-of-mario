import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

// Layer 4: the bomb Mario can actually see coming.
//
// Every assertion here is about LIT PIXELS ON THE OVERLAY CANVAS — that the
// bomb is painted, where it is painted, and that where it is painted closes on
// the reticle. A test that only asserted a draw call would pass just as
// happily with the sprite 320px below the screen, which is the exact bug the
// island-local seam invites.
test('the falling bomb on Mario\'s screen', async (t) => {
  const ctx = await boot();
  const page = ctx.page;
  t.after(() => shutdown(ctx));

  // Column 30 of 1-1 is open ground down to row 13, the same fixture the rest
  // of the telegraph suite uses.
  const COL = 30;
  const HEIGHT = 300; // px above the impact tile: well off the top of a 240px view

  await page.evaluate(async () => {
    await window.__GAME.loadLevel('1-1');
    window.__GAME.pause();
    window.__TELEGRAPH.clear();
  });

  // The centroid of the bomb's own inks, in GAME pixels, plus a count. The
  // sprite is whole-pixel fillRects under an integer scale transform, so the
  // colour match is exact rather than approximate.
  const INKS = {
    body: [0x4a, 0x51, 0x60],
    lit: [0xcf, 0xd6, 0xe2],
    fin: [0x20, 0x24, 0x2e],
    flash: [0xff, 0xf3, 0xc4],
    core: [0xff, 0xd2, 0x4a],
  };
  const scan = (names) =>
    page.evaluate(({ inks, names: want }) => {
      const c = document.getElementById('wings-overlay');
      if (!c || !c.width) return { n: -1 };
      const k = c.width / 256;
      const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const wanted = want.map((w) => inks[w]);
      let n = 0; let sx = 0; let sy = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 200) continue;
        for (const [r, g, b] of wanted) {
          if (px[i] === r && px[i + 1] === g && px[i + 2] === b) {
            const p = i / 4;
            n++;
            sx += (p % c.width) / k;
            sy += Math.floor(p / c.width) / k;
            break;
          }
        }
      }
      return n ? { n, x: sx / n, y: sy / n } : { n: 0 };
    }, { inks: INKS, names });
  const scanBomb = () => scan(['body', 'lit', 'fin']);

  const drop = (extra = 0) =>
    page.evaluate(({ col, height, extra: n }) => {
      window.__TELEGRAPH.clear();
      window.__GAME.teleport(col, 12);
      window.__TELEGRAPH.drop({ tx: col, ty: 13, height });
      window.__TELEGRAPH.run(1 + n);
      const m = window.__TELEGRAPH.marks()[0];
      const cam = window.__GAME.world.rcam;
      return m ? { m, cam: { x: cam.x, y: cam.y, w: cam.w, h: cam.h } } : null;
    }, { col: COL, height: HEIGHT, extra });

  const advance = (n) =>
    page.evaluate((steps) => {
      window.__TELEGRAPH.run(steps);
      const m = window.__TELEGRAPH.marks()[0];
      const cam = window.__GAME.world.rcam;
      return m ? { m, cam: { x: cam.x, y: cam.y, w: cam.w, h: cam.h } } : null;
    }, n);

  await t.test('a bomb still above the view is not drawn — that is the arrow\'s job', async () => {
    const r = await drop(20);
    assert.ok(r, 'the bomb was never telegraphed');
    assert.ok(r.m.y < r.cam.y - 8, `test premise: the bomb is above the camera, y=${r.m.y}`);
    const bomb = await scanBomb();
    assert.equal(bomb.n, 0, `${bomb.n} bomb pixels painted for a bomb off the top of the screen`);
  });

  await t.test('once in view it is painted, at the position it is actually at', async () => {
    const r = await advance(25);
    assert.ok(r, 'the bomb landed before it was ever in view');
    assert.ok(r.m.y > r.cam.y, `test premise: the bomb is inside the view, y=${r.m.y}`);
    const bomb = await scanBomb();
    assert.ok(bomb.n > 10, `${bomb.n} lit pixels is not a bomb`);
    // The centroid of a symmetric sprite is its centre. A forgotten
    // world->local conversion puts this 320px out; a forgotten camera
    // conversion puts it hundreds of px out. Two pixels of slack covers the
    // sprite's own asymmetry and nothing else.
    const ex = r.m.x - r.cam.x;
    const ey = r.m.y - r.cam.y;
    assert.ok(Math.abs(bomb.x - ex) < 3, `painted at x=${bomb.x}, the bomb is at ${ex}`);
    assert.ok(Math.abs(bomb.y - ey) < 3, `painted at y=${bomb.y}, the bomb is at ${ey}`);
  });

  await t.test('the painted bomb closes on the painted reticle', async () => {
    // Restart the fall so this sub-test owns its own arc.
    let r = await drop(45);
    const gapNow = async (state) => {
      const bomb = await scanBomb();
      assert.ok(bomb.n > 10, `${bomb.n} lit pixels is not a bomb`);
      const rx = state.m.impact.tx * 16 + 8 - state.cam.x;
      const ry = state.m.impact.ty * 16 - state.cam.y;
      return Math.hypot(bomb.x - rx, bomb.y - ry);
    };
    const first = await gapNow(r);
    r = await advance(15);
    const mid = await gapNow(r);
    // Still airborne: a 300px fall under 0.11 px/frame^2 takes 74 ticks.
    r = await advance(11);
    const last = await gapNow(r);
    assert.ok(first > 100, `test premise: the bomb starts far from its mark, got ${first}`);
    assert.ok(mid < first, `the gap went ${first} -> ${mid}`);
    assert.ok(last < mid, `the gap went ${mid} -> ${last}`);
    assert.ok(last < 40, `the bomb was still ${last}px from its own reticle just before impact`);
  });

  await t.test('it flashes where the crater will be, then leaves the screen clean', async () => {
    const r = await page.evaluate(({ col, height }) => {
      window.__TELEGRAPH.clear();
      window.__GAME.teleport(col, 12);
      window.__TELEGRAPH.drop({ tx: col, ty: 13, height });
      window.__TELEGRAPH.run(1);
      let impact = null;
      // One tick at a time until the bomb leaves the air, so the frame under
      // the assertion is the frame of arrival and not a guess.
      for (let i = 0; i < 400; i++) {
        const m = window.__TELEGRAPH.marks()[0];
        if (!m) break;
        impact = m.impact;
        window.__TELEGRAPH.run(1);
      }
      const cam = window.__GAME.world.rcam;
      return {
        gone: window.__TELEGRAPH.marks().length,
        impact,
        cam: { x: cam.x, y: cam.y },
      };
    }, { col: COL, height: HEIGHT });
    assert.equal(r.gone, 0, 'the bomb is still in the air');
    const flash = await scan(['flash', 'core']);
    assert.ok(flash.n > 4, `${flash.n} pixels of arrival flash`);
    assert.ok(
      Math.abs(flash.x - (r.impact.x - r.cam.x)) < 4,
      `the flash is at x=${flash.x}, the crater will be at ${r.impact.x - r.cam.x}`
    );

    // And it does not linger: a few frames later the overlay is empty again.
    await advance(20);
    const after = await scan(['body', 'lit', 'fin', 'flash', 'core']);
    assert.equal(after.n, 0, 'the overlay never cleared itself after the bomb landed');
  });

  await t.test('no uncaught page errors', async () => {
    assert.deepEqual(ctx.errors, []);
  });
});
