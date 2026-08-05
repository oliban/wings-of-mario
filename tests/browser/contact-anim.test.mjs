import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';
import { CONTACT_WALK } from '../../src/wings/art/contact.js';
import { HOLD_RUN, HOLD_WALK } from '../../src/wings/contact-anim.js';

// contact-anim.test.js proves the pose and the cadence are right. This proves
// they reach the glass: that the man the pilot is looking at actually MOVES HIS
// LEGS, read off the pilot's own framebuffer and nowhere else.
//
// It is written as a frame DIFFERENCE for the reason radar-terrain.test.mjs
// learned the hard way: the pilot's buffer is full of the game's own washes —
// sea, wake, cloud, the crater dust — and no fixed colour or threshold reliably
// separates a twelve-pixel man from them. Rendering the same tick twice, once
// with the contact and once without, leaves exactly the pixels Mario painted.

// Everything a walking Mario's snapshot carries. `grounded` is the flag that
// keeps him out of the jump pose.
const walking = (vx) => ({ vx, vy: 0, grounded: 1, facing: vx < 0 ? -1 : 1 });

async function silhouettes(page, snapshot, ticks) {
  return page.evaluate(([snap, n]) => {
    const W = window.__WINGS;
    const buf = W.renderer.buffer;
    const g = buf.getContext('2d');
    const ss = buf.width / 512;
    const out = [];
    for (let t = 0; t < n; t++) {
      // THE CAMERA IS RECOMPUTED EVERY TICK, because the aeroplane is flying
      // and the view is following it. Parking the contact at a fixed world
      // position would walk him out of the sampled box while we watched.
      // scene.frame() is the same function the renderer itself draws through,
      // so this samples where the contact actually lands rather than where the
      // test guessed it would.
      const f = W.scene.frame(W.sim);
      const wx = f.cam.x + f.vw / 2;
      const wy = f.cam.y + f.vh / 2;
      // World layers are drawn through ctx.scale(f.scale) and the buffer is
      // supersampled on top of that, so a world pixel is scale*ss device
      // pixels. A box 40 world pixels around him covers the 12x16 art, the bob,
      // and any rounding.
      const px = (v) => Math.round(v * f.scale * ss);
      const box = {
        x: px(wx - f.cam.x - 40), y: px(wy - f.cam.y - 40), w: px(80), h: px(80),
      };
      W.scene.remoteMario = { ...snap, x: wx, y: wy, island: '1-1' };
      W.tick(0); // re-render at this tick without advancing the simulation
      const withHim = g.getImageData(box.x, box.y, box.w, box.h).data;
      W.scene.remoteMario = null;
      W.tick(0);
      const without = g.getImageData(box.x, box.y, box.w, box.h).data;
      // The set of pixels he painted, as a string so it compares cheaply.
      const on = [];
      for (let i = 0; i < withHim.length; i += 4) {
        if (withHim[i] !== without[i] || withHim[i + 1] !== without[i + 1]
          || withHim[i + 2] !== without[i + 2]) on.push(i >> 2);
      }
      out.push(on.join(','));
      W.tick(1); // one simulation tick, which is what advances the stride
    }
    W.scene.remoteMario = null;
    return out;
  }, [snapshot, ticks]);
}

test('the contact moves his legs when he walks', async (t) => {
  const ctx = await boot({ path: '/pilot.html', global: '__WINGS' });
  const page = ctx.page;
  t.after(() => shutdown(ctx));

  await page.evaluate(() => {
    window.__WINGS.reset();
    window.__WINGS.tick(2);
  });

  // A full stride at walking pace, plus a tick, so every drawing of the cycle
  // has been on the glass at least once.
  const walk = await silhouettes(page, walking(1.0), 3 * HOLD_WALK + 1);
  const drawn = new Set(walk.filter((s) => s.length));

  assert.ok(walk.some((s) => s.length), 'the contact painted nothing at all');
  // THE WHOLE POINT: he is not one picture sliding along.
  assert.equal(drawn.size, CONTACT_WALK.length,
    `a walking contact showed ${drawn.size} distinct drawings, want ${CONTACT_WALK.length}`);
});

test('a standing contact does not shuffle on the spot', async (t) => {
  const ctx = await boot({ path: '/pilot.html', global: '__WINGS' });
  const page = ctx.page;
  t.after(() => shutdown(ctx));

  await page.evaluate(() => {
    window.__WINGS.reset();
    window.__WINGS.tick(2);
  });

  // Not zero: a 20Hz snapshot interpolated at 60Hz leaves a thousandth of a
  // pixel a frame on a man who has stopped dead, and the STILL_SPEED floor is
  // what stops that reading as a walk. This is that floor, on the glass.
  const still = await silhouettes(page, { ...walking(0), vx: 0.004 }, 3 * HOLD_WALK + 1);
  const drawn = new Set(still.filter((s) => s.length));

  assert.ok(still.some((s) => s.length), 'the contact painted nothing at all');
  assert.equal(drawn.size, 1, 'a man standing still changed drawing');
});

test('running churns the legs faster than walking, on the glass', async (t) => {
  const ctx = await boot({ path: '/pilot.html', global: '__WINGS' });
  const page = ctx.page;
  t.after(() => shutdown(ctx));

  await page.evaluate(() => {
    window.__WINGS.reset();
    window.__WINGS.tick(2);
  });

  // Over the same number of ticks, the run must change drawing more often than
  // the walk — the ROM's whole reason for having three timers.
  const ticks = 3 * HOLD_WALK + 1;
  const changes = (frames) => {
    let n = 0;
    for (let i = 1; i < frames.length; i++) if (frames[i] !== frames[i - 1]) n++;
    return n;
  };

  const slow = changes(await silhouettes(page, walking(1.0), ticks));
  const fast = changes(await silhouettes(page, walking(2.5), ticks));

  assert.ok(fast > slow,
    `a run changed drawing ${fast} times and a walk ${slow} — the gait is not speed-dependent`);
  // And the ratio is the ROM's, within the rounding a finite window imposes.
  assert.ok(fast >= Math.floor(slow * (HOLD_WALK / HOLD_RUN) * 0.5),
    `the run's cadence (${fast}) is nowhere near ${HOLD_WALK / HOLD_RUN}x the walk's (${slow})`);
});
