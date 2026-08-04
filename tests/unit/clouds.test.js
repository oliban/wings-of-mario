import test from 'node:test';
import assert from 'node:assert/strict';

import { drawClouds, visibleBanks, cloudScaleFor } from '../../src/wings/art/sky.js';
import { Scene, ZOOM } from '../../src/wings/scene.js';
import { WingsSim } from '../../src/wings/sim.js';
import { MODE } from '../../src/wings/flight.js';
import { VIEW_W, VIEW_H, SEA_Y } from '../../src/wings/geo.js';

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

// A frame narrow enough to hold exactly one bank. The cloud field is a tiled
// layer drawn at its own near-fixed scale, so a full 512-wide frame now carries
// two or three banks — and each bank drifts at its OWN parallax rate, so "every
// lobe moved by the same amount" is only a statement about a single bank. The
// tests below that compare lobes against each other say so by framing one.
const SOLO_W = 160;

// A camera the narrow frame holds exactly one bank at, on both of two
// consecutive ticks. Searched for rather than hard-coded so it survives a
// change to the field's spacing.
function soloCam(tick, camY) {
  for (let x = 0; x < 4000; x += 3) {
    const cam = { x, y: camY };
    if (visibleBanks(SOLO_W, 240, cam, tick).length !== 1) continue;
    if (visibleBanks(SOLO_W, 240, cam, tick + 1).length !== 1) continue;
    return cam;
  }
  throw new Error('no single-bank frame found');
}

test('a cloud keeps its shape from tick to tick — it only moves', () => {
  const cam = soloCam(1000, 300);
  const a = shot(cam, 1000, SOLO_W);
  const b = shot(cam, 1001, SOLO_W);
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
  // The view is passed in DEVICE pixels and the world's scale alongside it;
  // neither panning nor zooming may restyle a cloud, and a
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
    const banks = visibleBanks(SOLO_W, 240, cam, tick);
    if (banks.length !== 1) continue;
    frames++;
    const ctx = recorder();
    drawClouds(ctx, SOLO_W, 240, cam, tick);
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

// ---------------------------------------------------------------------------
// THE CLOUDS ARE NOT IN THE WORLD.
//
// They used to be drawn through the altitude zoom, which shrank them by a
// factor of three over the climb while the same transform held their place on
// screen. The user read that as being chased: a thing that keeps its position
// in your view while everything around it moves is not sky, it is attached to
// you. These pin the fix — apparent size nearly constant, position responding
// to height — against the real Scene framing rather than against invented
// camera numbers, because it is the framing that changes underneath them.

function frameAt(planeY) {
  const sim = new WingsSim();
  sim.plane.mode = MODE.AIR;
  sim.plane.y = planeY;
  const scene = new Scene();
  scene.consume(sim);
  return scene.frame(sim);
}

// Where a bank actually lands on screen, scale included.
function onScreen(f, tick = 0) {
  const s = cloudScaleFor(f.scale);
  return visibleBanks(VIEW_W, VIEW_H, f.cam, tick, f.scale)
    .map((b) => ({ id: b.id, x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s }));
}

test('a cloud is very nearly the same size at the ceiling as on the deck', () => {
  const deck = onScreen(frameAt(SEA_Y - 6));
  const ceil = onScreen(frameAt(0));
  const byId = new Map(deck.map((b) => [b.id, b]));
  let compared = 0;
  for (const b of ceil) {
    const d = byId.get(b.id);
    if (!d) continue;
    compared++;
    const ratio = b.w / d.w;
    // The world's own ratio across the same climb is 0.32/1.15 = 0.28. The
    // clouds must be nowhere near that — but not at 1.0 either: a layer that
    // ignores the zoom completely reads as a decal on the canopy glass.
    assert.ok(ratio > 0.75, `bank ${b.id} shrank to ${ratio.toFixed(2)} of its deck size`);
    assert.ok(ratio < 0.98, `bank ${b.id} at ${ratio.toFixed(3)} takes no part in the zoom at all`);
  }
  assert.ok(compared >= 2, `only ${compared} banks were on screen at both ends`);
});

test('climbing moves the clouds DOWN the screen, and only down', () => {
  // The cue that sells height. Every bank must sink monotonically as the
  // aeroplane climbs, and the deeper banks — larger parallax multiplier — must
  // sink further than the far ones.
  const last = new Map();
  const travel = new Map();
  for (let y = SEA_Y - 6; y >= 0; y -= 10) {
    for (const b of onScreen(frameAt(y))) {
      const prev = last.get(b.id);
      if (prev != null) {
        assert.ok(b.y >= prev - 1e-9, `bank ${b.id} rose from ${prev} to ${b.y} while climbing`);
        travel.set(b.id, (travel.get(b.id) ?? 0) + (b.y - prev));
      }
      last.set(b.id, b.y);
    }
  }
  const moved = [...travel.values()].filter((d) => d > 20);
  assert.ok(moved.length >= 2, `only ${moved.length} banks descended a useful amount: ${[...travel.values()]}`);
});

test('a cloud never sinks into the sea, at any altitude', () => {
  // Out of the transform there is nothing scaling the layer back up the screen,
  // so the deepest bank's descent has to stay clear of the water on its own.
  for (let y = SEA_Y; y >= -20; y -= 5) {
    const f = frameAt(y);
    const horizon = (SEA_Y - f.cam.y) * f.scale;
    for (const b of onScreen(f)) {
      assert.ok(b.y < horizon, `bank ${b.id} at ${b.y.toFixed(0)} is below the sea line ${horizon.toFixed(0)}`);
    }
  }
});

test('the sky is never empty and never crowded, at any altitude or heading', () => {
  // The old field was seven banks spread over 5300 world pixels and relied on
  // the zoom to bring several into frame at once; at a fixed scale that is an
  // empty sky. The layer is tiled instead, so this holds everywhere.
  let min = Infinity;
  let max = 0;
  for (const y of [SEA_Y - 6, 400, 260, 120, 0]) {
    const f = frameAt(y);
    for (let camX = -300; camX < 9000; camX += 37) {
      for (const tick of [0, 3600, 60000]) {
        const n = visibleBanks(VIEW_W, VIEW_H, { x: camX, y: f.cam.y }, tick, f.scale).length;
        min = Math.min(min, n);
        max = Math.max(max, n);
      }
    }
  }
  assert.ok(min >= 1, 'the sky went completely empty somewhere');
  assert.ok(max <= 7, `${max} banks in one frame is a solid overcast`);
});

test('the zoom reaches the clouds only through cloudScaleFor', () => {
  // The whole bug in one assertion: at the two ends of the climb the world is
  // drawn 3.6x apart and the clouds 1.2x apart.
  const world = ZOOM.MAX / ZOOM.MIN;
  const cloud = cloudScaleFor(ZOOM.MAX) / cloudScaleFor(ZOOM.MIN);
  assert.ok(world > 3.5, `the world only spans ${world.toFixed(2)}`);
  assert.ok(cloud < 1.3, `the clouds still span ${cloud.toFixed(2)} of the world's ${world.toFixed(2)}`);
  assert.ok(cloud > 1.05, 'the clouds take no part in the zoom at all');
});

test('the tiling wraps off screen: a bank on screen never jumps', () => {
  // The field repeats, so a bank's position is taken modulo the period — and a
  // modulo is a discontinuity. It is only invisible because the period is wider
  // than the frame plus a bank's reach, so the seam always falls outside. If
  // that ever stops being true a cloud teleports across the sky mid-flight,
  // which is the loudest artefact this layer could produce.
  for (const scale of [1.15, 0.62, 0.32]) {
    for (let camX = 0; camX < 12000; camX += 11) {
      const cam = { x: camX, y: 200 };
      const a = visibleBanks(VIEW_W, VIEW_H, cam, 500, scale);
      const b = visibleBanks(VIEW_W, VIEW_H, { x: camX + 3, y: 200 }, 501, scale);
      for (const one of a) {
        // Same id can appear twice, so match the nearest copy: a wrap would
        // still show up as every copy of that bank being a period away.
        const near = b.filter((t) => t.id === one.id)
          .sort((p, q) => Math.abs(p.x - one.x) - Math.abs(q.x - one.x))[0];
        if (!near) continue;
        assert.ok(Math.abs(near.x - one.x) < 6,
          `bank ${one.id} jumped ${(near.x - one.x).toFixed(0)}px at cam ${camX}, scale ${scale}`);
      }
    }
  }
});
