import test from 'node:test';
import assert from 'node:assert/strict';

import { Scene, ZOOM, zoomFor, WORLD_SCALE, PLAY_H } from '../../src/wings/scene.js';
import { WingsSim } from '../../src/wings/sim.js';
import { MODE, FLIGHT } from '../../src/wings/flight.js';
import { SEA_Y, CEILING_Y, DECK_Y, PLANE_H, VIEW_W } from '../../src/wings/geo.js';

// The altitude zoom and the framing that goes with it. These pin the RULE —
// the sea line on its row, the aeroplane on its row, the scale being whatever
// makes both true — rather than the aesthetics of any particular curve.

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
  assert.equal(a.zoom, zoomFor(300), 'the scene drew at something other than the curve');
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
  // And it is continuous across the edge of the band rather than stepping off
  // it: the scale that puts the aeroplane on its row at FROM_Y is exactly
  // WORLD_SCALE, which is where the dead band came from in the first place.
  assert.ok(zoomFor(ZOOM.FROM_Y - 1) < WORLD_SCALE, 'the band does not end where it says it does');
  assert.ok(zoomFor(ZOOM.FROM_Y - 1) > WORLD_SCALE * 0.99, 'the scale steps at the edge of the dead band');
});

// THE REQUIREMENT, as arithmetic: "I need to be able to see the island when
// high above it". The island stands in the sea, so the test is whether the sea
// line is inside the play area — at every altitude, not at most of them.
test('the sea line is inside the play area at every altitude', () => {
  const scene = new Scene();
  const sim = new WingsSim();
  sim.plane.mode = MODE.AIR;
  for (let y = DECK_Y; y >= CEILING_Y; y -= 2) {
    sim.plane.y = y;
    sim.tick++;
    scene.consume(sim);
    const f = scene.frame(sim);
    const seaRow = (SEA_Y - f.cam.y) * f.scale;
    assert.ok(seaRow <= PLAY_H, `at y=${y} the sea is ${Math.round(seaRow)} device px down — past the ${PLAY_H}px play area`);
    // And the island's ground rows with it: 1-1's surface is the last four
    // rows before the water.
    const landRow = (SEA_Y - 64 - f.cam.y) * f.scale;
    assert.ok(landRow < PLAY_H, `at y=${y} the island's surface is off the bottom of the play area`);
  }
});

test('the aeroplane keeps its row, and its distance from the sea line, through the whole climb', () => {
  // The composition is the point: the same picture at every altitude, only
  // drawn smaller. It can only break where the scale floor takes over.
  const scene = new Scene();
  const sim = new WingsSim();
  sim.plane.mode = MODE.AIR;
  const rows = [];
  for (let y = ZOOM.FROM_Y; y >= CEILING_Y; y -= 5) {
    sim.plane.y = y;
    sim.tick++;
    scene.consume(sim);
    const f = scene.frame(sim);
    rows.push({
      y,
      plane: (y + PLANE_H / 2 - f.cam.y) * f.scale,
      sea: (SEA_Y - f.cam.y) * f.scale,
      floored: f.scale <= ZOOM.MIN + 1e-9,
    });
  }
  for (const r of rows.filter((r) => !r.floored)) {
    assert.ok(Math.abs(r.plane - rows[0].plane) < 0.5, `the aeroplane drifted to row ${r.plane} at y=${r.y}`);
    assert.ok(Math.abs(r.sea - rows[0].sea) < 0.5, `the sea line drifted to row ${r.sea} at y=${r.y}`);
  }
  // Above the floor the aeroplane rides higher still, never off the top.
  for (const r of rows.filter((r) => r.floored)) {
    assert.ok(r.plane > 8, `the aeroplane is ${r.plane} device px from the top edge at y=${r.y}`);
    assert.ok(r.plane <= rows[0].plane + 0.5, `the aeroplane dropped back down the frame at y=${r.y}`);
  }
});

test('the zoomed-out end is still flyable, not the reference extreme', () => {
  // The user's reference is about a third scale, with the aeroplane at ~1.5%
  // of the frame width. They asked for "maybe not as far out"; this is the
  // measurement of that judgement, so it fails if someone chases the still.
  // The floor is not a taste decision any more, it is the smallest scale that
  // still fits the sea into the play area from the service ceiling. So the
  // test is not "is 0.32 pretty" but "is 0.32 the number the geometry asks
  // for": tight enough to keep the aeroplane as large as it can be, and no
  // larger than the requirement allows.
  const needed = (PLAY_H - ZOOM.TOP_MIN) / (SEA_Y - CEILING_Y - PLANE_H / 2);
  assert.ok(ZOOM.MIN <= needed + 1e-9, `at ${ZOOM.MIN} the sea leaves the screen at the ceiling; it needs ${needed.toFixed(3)}`);
  assert.ok(ZOOM.MIN > needed * 0.85, `${ZOOM.MIN} is smaller than the ${needed.toFixed(3)} the requirement asks for — the aeroplane is being shrunk for nothing`);
  // It is a speck up there, and that is the cost of the requirement rather
  // than an accident. Recorded so the number cannot drift silently.
  const PLANE_LEN = 42;
  assert.ok(Math.abs((PLANE_LEN * ZOOM.MIN) / VIEW_W - 0.026) < 0.004, 'the aeroplane is a different size at the ceiling than the report says');
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

test('the scale moves fastest just above the dead band, and only there', () => {
  // Pinning two points while their separation grows means the scale falls as
  // 1/height, so the steepest part of it is at the BOTTOM of the band, and a
  // vertical dive at MAX_SPEED through that point is the worst case in the
  // game. It is honest to state it rather than to pretend it is gentle: this
  // is the cost of the composition, and it decays as the square of height.
  const rate = (y) => Math.abs(zoomFor(y) - zoomFor(y + FLIGHT.MAX_SPEED));
  const atBand = rate(ZOOM.FROM_Y - FLIGHT.MAX_SPEED);
  assert.ok(atBand < 0.05, `even the worst case moves the scale ${atBand} in a tick`);
  // A hundred pixels higher and it is already four times gentler.
  assert.ok(rate(ZOOM.FROM_Y - 100) < atBand / 3, 'the steepness does not decay with height');
  // And no single tick anywhere is a snap.
  let worst = 0;
  for (let y = CEILING_Y; y <= SEA_Y; y += 0.5) worst = Math.max(worst, rate(y));
  assert.ok(worst < 0.05, `some altitude moves the scale ${worst} in one tick`);
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
