import test from 'node:test';
import assert from 'node:assert/strict';

import { Scene, ZOOM, zoomFor, WORLD_SCALE, PLAY_H } from '../../src/wings/scene.js';
import { WingsSim } from '../../src/wings/sim.js';
import { MODE, FLIGHT } from '../../src/wings/flight.js';
import { SEA_Y, CEILING_Y, DECK_Y, PLANE_H, VIEW_W } from '../../src/wings/geo.js';

// The altitude zoom. These pin the SEAM — that the scale is a curve read off
// altitude and applied by the renderer — rather than the aesthetics of the
// curve, which are a judgement call and are meant to be tuned by flying.

test('the zoom is a pure function of altitude', () => {
  for (const y of [0, 120, 300, 480, 560]) {
    assert.equal(zoomFor(y), zoomFor(y), 'not deterministic');
  }
  // Nothing else can reach it: same altitude, same answer, whatever the rest
  // of the world is doing.
  const a = new Scene();
  const b = new Scene();
  const sim = new WingsSim();
  sim.plane.mode = MODE.AIR;
  sim.plane.y = 300;
  for (let i = 0; i < 200; i++) {
    sim.tick++;
    a.consume(sim);
  }
  for (let i = 0; i < 200; i++) {
    sim.tick++;
    b.consume(sim);
  }
  assert.equal(a.zoom, b.zoom);
  assert.equal(a.zoom, zoomFor(300 + PLANE_H / 2), 'the scene drew at something other than the curve');
});

test('sea level is full scale and the ceiling is the zoomed-out end', () => {
  assert.equal(zoomFor(SEA_Y), WORLD_SCALE);
  assert.equal(zoomFor(SEA_Y + 100), WORLD_SCALE, 'below the sea should not zoom in past full scale');
  assert.equal(zoomFor(CEILING_Y), ZOOM.MIN);
  assert.equal(zoomFor(CEILING_Y - 100), ZOOM.MIN, 'above the ceiling should not keep shrinking');
});

test('climbing never zooms in: the curve is monotone', () => {
  let prev = zoomFor(SEA_Y + 100);
  for (let y = SEA_Y; y >= CEILING_Y; y -= 4) {
    const z = zoomFor(y);
    assert.ok(z <= prev + 1e-12, `zoom grew climbing through y=${y} (${prev} -> ${z})`);
    assert.ok(z >= ZOOM.MIN - 1e-12 && z <= ZOOM.MAX + 1e-12, `out of range at y=${y}: ${z}`);
    prev = z;
  }
});

test('the low-level band, where the bombing happens, is left alone entirely', () => {
  // The attack altitude found by flying is y=420-460. The sea band, the land
  // bias and the aeroplane-to-ship proportions were all tuned there at full
  // scale, and the zoom must not quietly restate them.
  for (const y of [ZOOM.FROM_Y, 460, DECK_Y, SEA_Y]) {
    assert.equal(zoomFor(y), WORLD_SCALE, `y=${y} already zoomed to ${zoomFor(y)}`);
  }
  // And it starts gently above it rather than stepping off the dead band.
  assert.ok(zoomFor(ZOOM.FROM_Y - 20) > WORLD_SCALE * 0.995, 'the zoom steps as soon as it starts');
});

test('the zoomed-out end is still flyable, not the reference extreme', () => {
  // The user's reference is about a third scale, with the aeroplane at ~1.5%
  // of the frame width. They asked for "maybe not as far out"; this is the
  // measurement of that judgement, so it fails if someone chases the still.
  const PLANE_LEN = 42;
  const atCeiling = (PLANE_LEN * ZOOM.MIN) / VIEW_W;
  // 3% of the frame is 15 screen pixels of aeroplane — about where the
  // attitude stops being readable and a bomb release stops being aimable.
  // The reference sits at 1.5%, which is why the user's own hedge was
  // "maybe not as far out"; this fails if someone chases the still.
  assert.ok(atCeiling > 0.03, `the aeroplane is ${(atCeiling * 100).toFixed(1)}% of the frame at the ceiling — too small to fly`);
  assert.ok(ZOOM.MIN < 0.8, 'not enough zoom to be worth having');
  // And it does have to be a real change, not a polite one.
  assert.ok(ZOOM.MAX / ZOOM.MIN > 2, 'the world barely changes size across the whole climb');
});

test('the zoom is driven by simulation ticks, not by rendered frames', () => {
  // Same trajectory, one scene rendered every tick and one dropping four
  // frames in five. A screenshot at tick N has to be reproducible.
  const a = new Scene();
  const b = new Scene();
  const simA = new WingsSim();
  const simB = new WingsSim();
  for (const s of [simA, simB]) {
    s.plane.mode = MODE.AIR;
    s.plane.y = DECK_Y;
  }
  for (let i = 0; i < 120; i++) {
    simA.tick++;
    simA.plane.y -= 3;
    a.consume(simA);
    simB.tick++;
    simB.plane.y -= 3;
    if (i % 5 === 4) b.consume(simB);
  }
  assert.equal(a.zoom, b.zoom, 'dropped frames changed the scale the world is drawn at');
});

test('the zoom never snaps in the air, however hard the aeroplane is flown', () => {
  const scene = new Scene();
  const sim = new WingsSim();
  while (sim.plane.mode !== MODE.AIR) sim.step({ pitch: 1, thrust: 1 });
  let prev = scene.zoom;
  let worst = 0;
  // Climb to the ceiling, hold there, then dive back to the water.
  for (let i = 0; i < 900; i++) {
    sim.step({ pitch: sim.plane.angle > -0.45 ? 1 : 0, thrust: 1 });
    scene.consume(sim);
    worst = Math.max(worst, Math.abs(scene.zoom - prev));
    prev = scene.zoom;
    if (sim.plane.mode !== MODE.AIR) break;
  }
  assert.ok(worst > 0, 'the zoom never moved at all');
  assert.ok(worst < 0.01, `the zoom jumped ${worst} in one tick`);
});

test('a full-speed dive still moves the scale gently — no spring needed', () => {
  // What makes the spring unnecessary: altitude is speed-limited, so the
  // steepest the curve can ever be walked is a vertical dive at MAX_SPEED.
  let worst = 0;
  for (let y = CEILING_Y; y <= SEA_Y; y += 0.5) {
    worst = Math.max(worst, Math.abs(zoomFor(y) - zoomFor(y + FLIGHT.MAX_SPEED)));
  }
  assert.ok(worst < 0.01, `the steepest possible dive moves the scale ${worst} in one tick`);
});

test('a respawn starts the next sortie at deck scale rather than easing into it', () => {
  const scene = new Scene();
  const sim = new WingsSim();
  sim.plane.mode = MODE.AIR;
  sim.plane.y = 40;
  for (let i = 0; i < 200; i++) {
    sim.tick++;
    scene.consume(sim);
  }
  assert.ok(scene.zoom < 0.8, 'never zoomed out up high');
  sim.lose('sea');
  sim.respawn();
  sim.tick++;
  scene.consume(sim);
  assert.equal(scene.zoom, zoomFor(sim.plane.y + PLANE_H / 2));
  assert.ok(scene.zoom > WORLD_SCALE * 0.99, 'the deck is not at deck scale');
});

test('the frame widens as the world shrinks, and the play area with it', () => {
  const scene = new Scene();
  const sim = new WingsSim();
  sim.plane.mode = MODE.AIR;
  sim.plane.y = DECK_Y;
  scene.consume(sim);
  const low = scene.frame(sim);
  scene.zoom = ZOOM.MIN;
  const high = scene.frame(sim);
  assert.ok(high.vw > low.vw * 1.5, `the view barely widened (${low.vw} -> ${high.vw})`);
  // The frame publishes the scale it was built at, so every layer draws
  // through one number rather than each reaching for the constant.
  assert.equal(high.scale, ZOOM.MIN);
  assert.ok(low.scale > high.scale);
  // The play area in WORLD pixels is what decides how much of an island you
  // can see at once, and it is what the zoom exists to grow.
  const lowPlay = PLAY_H / low.scale;
  const highPlay = PLAY_H / high.scale;
  assert.ok(highPlay > lowPlay * 1.5, `play area ${lowPlay} -> ${highPlay}`);
});
