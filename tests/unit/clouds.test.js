import test from 'node:test';
import assert from 'node:assert/strict';

import { drawClouds, visibleBanks } from '../../src/wings/art/sky.js';

// The clouds boiled: their lobe layout was hashed from their SCREEN position,
// which drifts every tick, so all six lobes jumped to new offsets and radii
// sixty times a second. These tests are on the geometry rather than on pixels,
// because that is where the bug was — a cloud that is the wrong SHAPE this
// frame is not something a pixel threshold can be trusted to catch, but a
// radius that changed between two ticks is unambiguous.

// A canvas stand-in that records the path a bank draws.
function recorder() {
  const arcs = [];
  const rects = [];
  const ctx = {
    arcs,
    rects,
    save() {}, restore() {}, beginPath() {}, moveTo() {}, fill() {}, stroke() {}, clip() {},
    translate() {}, scale() {},
    arc(x, y, r) { arcs.push([+x.toFixed(6), +y.toFixed(6), +r.toFixed(6)]); },
    rect(x, y, w, h) { rects.push([+x.toFixed(6), +y.toFixed(6), w, h]); },
    createLinearGradient() { return { addColorStop() {} }; },
    set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}, set globalAlpha(v) {},
  };
  return ctx;
}

const shot = (cam, tick, viewW = 512, viewH = 240) => {
  const ctx = recorder();
  drawClouds(ctx, viewW, viewH, cam, tick);
  return ctx.arcs;
};

test('a cloud keeps its shape from tick to tick — it only moves', () => {
  const cam = { x: 300, y: 300 };
  const a = shot(cam, 1000);
  const b = shot(cam, 1001);
  assert.ok(a.length > 0, 'no clouds were drawn at all');
  assert.equal(a.length, b.length, 'a different number of lobes between two ticks');
  for (let i = 0; i < a.length; i++) {
    // Radius is pure shape. If this moves, the cloud is boiling.
    assert.equal(a[i][2], b[i][2], `lobe ${i} changed radius between two consecutive ticks`);
    // And every lobe must move by the SAME amount — the bank drifting — rather
    // than each wandering off on its own.
    const dx = b[i][0] - a[i][0];
    const dx0 = b[0][0] - a[0][0];
    assert.ok(Math.abs(dx - dx0) < 1e-9, `lobe ${i} drifted ${dx} while lobe 0 drifted ${dx0}`);
    assert.equal(a[i][1], b[i][1], `lobe ${i} moved vertically on a still camera`);
  }
});

test('a cloud keeps its shape as the camera pans and as the world zooms', () => {
  // The view is passed in WORLD pixels, so zooming out hands drawClouds a
  // bigger viewW/viewH. Neither that nor panning may restyle a cloud, and a
  // bank's SEED — the thing its shape is hashed from — must be a property of
  // the bank rather than of where the camera happens to be.
  const seeds = new Map();
  // The parallax multiplier is 0.13-0.3, so the camera has to travel several
  // times the world's width to bring every bank past.
  for (let camX = -2000; camX <= 40000; camX += 1700) {
    for (const camY of [-40, 120, 300, 460]) {
      for (const [vw, vh] of [[512, 240], [1024, 480], [1600, 750]]) {
        for (const tick of [0, 91, 4000]) {
          for (const b of visibleBanks(vw, vh, { x: camX, y: camY }, tick)) {
            const seen = seeds.get(b.id);
            if (seen == null) seeds.set(b.id, b.seed);
            else assert.equal(b.seed, seen, `bank ${b.id} changed seed at cam ${camX},${camY} view ${vw} tick ${tick}`);
          }
        }
      }
    }
  }
  assert.equal(seeds.size, 7, `saw ${seeds.size} of the 7 banks`);
});

test('over a long flight every bank draws exactly one shape, ever', () => {
  // The strongest form: collect the radius signature of each bank across a
  // whole sortie's worth of ticks and camera positions. One bank, one shape.
  const shapes = new Map();
  let frames = 0;
  for (let tick = 0; tick < 6000; tick += 3) {
    const cam = { x: tick * 2.7, y: 400 - tick * 0.06 };
    // Only frames showing exactly one bank, so every arc recorded belongs to
    // it and no attribution guesswork is needed.
    const banks = visibleBanks(512, 240, cam, tick);
    if (banks.length !== 1) continue;
    frames++;
    const ctx = recorder();
    drawClouds(ctx, 512, 240, cam, tick);
    const mine = ctx.arcs.map((a) => a[2].toFixed(6)).join(',');
    // Keyed on the bank's IDENTITY, never on its seed — the bug made the seed
    // itself move, so a test keyed on it would quietly compare nothing.
    const seen = shapes.get(banks[0].id);
    if (seen == null) shapes.set(banks[0].id, mine);
    else assert.equal(mine, seen, `bank ${banks[0].id} changed shape at tick ${tick}`);
  }
  assert.ok(shapes.size >= 4, `only ${shapes.size} banks were ever seen`);
  assert.ok(frames > 200, `only ${frames} frames were usable`);
});

test('the cull never drops a bank while any of it is still on screen', () => {
  // Culling is a performance optimisation and has to be invisible. A bank
  // dropped while its lobes still reach into the frame pops, and a pop at the
  // edge of the frame is indistinguishable from a flicker.
  const viewW = 512;
  const viewH = 240;
  for (let camX = -400; camX < 6000; camX += 13) {
    for (let camY = -60; camY <= 560; camY += 17) {
      const cam = { x: camX, y: camY };
      const tick = camX * 3;
      const drawn = new Set(visibleBanks(viewW, viewH, cam, tick).map((b) => b.id));
      const ctx = recorder();
      // Draw with an enormous view so nothing is culled, then check that every
      // mark landing inside the real viewport belongs to a bank the cull kept.
      drawClouds(ctx, 100000, 100000, cam, tick);
      for (const [x, y, r] of ctx.arcs) {
        const onScreen = x + r > 0 && x - r < viewW && y + r > 0 && y - r < viewH;
        if (!onScreen) continue;
        const owner = [...visibleBanks(100000, 100000, cam, tick)]
          .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
        assert.ok(
          drawn.has(owner.id),
          `bank ${owner.id} was culled at cam ${camX},${camY} with a lobe on screen at ${x},${y} r${r}`
        );
      }
    }
  }
});

test('the same tick and camera always draw the same sky', () => {
  // Determinism: no clock, no unseeded randomness, so a screenshot at tick N
  // is reproducible.
  for (const tick of [0, 137, 5000]) {
    const cam = { x: 812.5, y: 190.25 };
    assert.deepEqual(shot(cam, tick), shot(cam, tick));
  }
});
