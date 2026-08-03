import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown } from './helpers.mjs';

// The altitude zoom, through the page. These are about the SEAM, not the look:
// the zoom is a render transform, and the day it leaks into the simulation is
// the day bombs stop landing where the physics says — and, once Mario's client
// is on the other end of it, the day the desync hash starts firing.
test('the altitude zoom is a render transform and nothing else', { timeout: 120000 }, async (t) => {
  const ctx = await boot({ path: '/pilot.html?headless', global: '__WINGS' });
  t.after(() => shutdown(ctx));
  const { page } = ctx;

  // Fly one fixed tape of inputs with the world drawn at a forced scale, and
  // report everything the simulation ended up believing. The scale is pinned
  // after every render, so the zoom the renderer uses is genuinely different
  // between the two runs and genuinely used — the frame is rebuilt from it.
  const tape = (zoom) => page.evaluate((z) => {
    const W = window.__WINGS;
    W.reset();
    const p = W.sim.plane;
    const pin = () => { W.scene.zoom = z; };
    pin();
    const state = [];
    const inputs = [
      { n: 200, in: { pitch: 1, thrust: 1 } },
      { n: 120, in: { pitch: -1, thrust: 1 } },
      { n: 60, in: { pitch: 0, thrust: 1, drop: true } },
      { n: 240, in: { pitch: 0, thrust: 1 } },
      { n: 40, in: { pitch: 1, thrust: -1 } },
      { n: 120, in: { pitch: 0, thrust: -1 } },
    ];
    for (const leg of inputs) {
      W.hold(leg.in);
      for (let i = 0; i < leg.n; i++) {
        W.tick(1);
        pin();
        state.push([p.x, p.y, p.vx, p.vy, p.angle, p.speed, p.mode]);
      }
    }
    W.release();
    return {
      zoom: W.scene.zoom,
      trace: state,
      shots: W.sim.shots.map((s) => [s.kind, s.x, s.y, s.vx, s.vy, s.age]),
      loadout: { ...W.sim.loadout },
      damage: W.sim.islands.map((i) => i.keys()),
      events: W.events().map((e) => `${e.tick}:${e.type}:${Math.round(e.x || 0)},${Math.round(e.y || 0)}`),
      tick: W.sim.tick,
    };
  }, zoom);

  await t.test('the same tape flown at two zoom levels gives an identical simulation', async () => {
    const wide = await tape(0.62);
    const close = await tape(1.15);
    assert.equal(wide.zoom, 0.62, 'the forced zoom did not stick');
    assert.equal(close.zoom, 1.15);
    assert.equal(wide.tick, close.tick);
    assert.deepEqual(wide.trace, close.trace, 'the aeroplane flew a different path at a different zoom');
    assert.deepEqual(wide.shots, close.shots, 'ordnance in the air differs by zoom');
    assert.deepEqual(wide.loadout, close.loadout);
    assert.deepEqual(wide.events, close.events, 'the sim emitted different events at a different zoom');
  });

  await t.test('a bomb craters the same tiles however far the world is zoomed out', async () => {
    const bomb = (zoom) => page.evaluate((z) => {
      const W = window.__WINGS;
      W.reset();
      const isle = W.sim.islands[0];
      const p = W.sim.plane;
      p.mode = 'air';
      p.gear = false;
      p.angle = 0;
      p.x = isle.x0 + 40 * 16;
      p.y = 180;
      p.speed = 3;
      p.vx = 3;
      p.vy = 0;
      W.scene.zoom = z;
      W.hold({ pitch: 0, thrust: 1, drop: true });
      W.tick(1);
      W.scene.zoom = z;
      W.hold({ pitch: 0, thrust: 1, drop: false });
      const shot = W.sim.shots[0];
      const path = [];
      for (let i = 0; i < 400 && !shot.dead; i++) {
        W.tick(1);
        W.scene.zoom = z;
        path.push([Math.round(shot.x * 1000), Math.round(shot.y * 1000)]);
      }
      const det = W.events().filter((e) => e.type === 'detonation').pop();
      return { path, keys: isle.keys(), det: det && [det.x, det.y, det.radius] };
    }, zoom);
    const wide = await bomb(0.62);
    const close = await bomb(1.15);
    assert.ok(wide.keys.length > 0, 'the bomb never hit the island');
    assert.deepEqual(wide.keys, close.keys, 'the crater moved when the world was zoomed');
    assert.deepEqual(wide.det, close.det, 'the detonation landed somewhere else');
    assert.deepEqual(wide.path, close.path, 'the bomb flew a different arc');
  });

  await t.test('a shot is drawn at its simulated position, transformed — never recomputed', async () => {
    // The drawn position must be exactly (world - camera) * scale. Anything
    // else is a second physics model, and the pilot would be aiming with the
    // wrong one.
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      const p = W.sim.plane;
      p.mode = 'air';
      p.gear = false;
      p.angle = 0;
      p.x = 900;
      p.y = 200;
      p.speed = 3;
      p.vx = 3;
      p.vy = 0;
      W.hold({ pitch: 0, thrust: 1, drop: true });
      W.tick(1);
      W.hold({ pitch: 0, thrust: 1, drop: false });
      W.tick(20);
      const shot = W.sim.shots[0];
      const scene = W.scene;
      const f = scene.frame(W.sim);
      return {
        shot: { x: shot.x, y: shot.y },
        f: { x: f.cam.x, y: f.cam.y, scale: f.scale },
        zoom: scene.zoom,
      };
    });
    // Device position the renderer will put it at, derived here independently.
    const dx = (r.shot.x - r.f.x) * r.f.scale;
    const dy = (r.shot.y - r.f.y) * r.f.scale;
    assert.equal(r.f.scale, r.zoom, 'the frame drew at a scale other than the scene zoom');
    assert.ok(dx > 0 && dx < 512, `the bomb is not on screen (${dx})`);
    assert.ok(dy > 0 && dy < 240, `the bomb is not on screen (${dy})`);
  });

  await t.test('the instrument panel is the same size at every altitude', async () => {
    // The panel is drawn outside the world transform, so its top edge — the
    // bright green bezel that runs the full width — must land on the same
    // device row whatever the aeroplane is doing. Measured off the actual
    // pixels, since that is the thing the user sees.
    const panelTop = (y) => page.evaluate((py) => {
      const W = window.__WINGS;
      W.reset();
      const p = W.sim.plane;
      p.mode = 'air';
      p.gear = false;
      p.angle = 0;
      p.y = py;
      p.x = 900;
      p.speed = 2.5;
      p.vx = 2.5;
      W.tick(1);
      const r = W.renderer;
      const ss = r.ss;
      const px = r.ctx.getImageData(8 * ss, 0, 1, r.buffer.height).data;
      // Scan up from the bottom for the first row that is NOT panel-dark.
      let top = null;
      for (let row = r.buffer.height - 1; row >= 0; row--) {
        const i = row * 4;
        const [rr, gg, bb] = [px[i], px[i + 1], px[i + 2]];
        // The bezel is #7dbf35 — the only strongly green thing on screen.
        if (gg > 120 && gg > rr + 40 && gg > bb + 60) top = row / ss;
      }
      return { top, zoom: W.scene.zoom, y: W.state().y };
    }, y);

    const low = await panelTop(500);
    const high = await panelTop(20);
    assert.ok(low.top != null && high.top != null, 'never found the panel bezel');
    assert.ok(high.zoom < low.zoom - 0.2, `the two samples were at the same zoom (${low.zoom} vs ${high.zoom})`);
    assert.equal(high.top, low.top, 'the instrument panel moved with the zoom');
  });

  await t.test('flying up and down again returns to exactly the scale it started at', async () => {
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      const p = W.sim.plane;
      p.mode = 'air';
      p.gear = false;
      p.angle = 0;
      p.x = 900;
      p.y = 460;
      p.speed = 2.5;
      p.vx = 2.5;
      W.tick(1);
      const before = W.scene.zoom;
      const seen = [before];
      for (let i = 0; i < 120; i++) { p.y -= 3; W.tick(1); seen.push(W.scene.zoom); }
      const top = W.scene.zoom;
      for (let i = 0; i < 120; i++) { p.y += 3; W.tick(1); seen.push(W.scene.zoom); }
      let worst = 0;
      for (let i = 1; i < seen.length; i++) worst = Math.max(worst, Math.abs(seen[i] - seen[i - 1]));
      return { before, top, after: W.scene.zoom, worst };
    });
    assert.ok(r.top < r.before - 0.3, `never zoomed out on the way up (${r.before} -> ${r.top})`);
    assert.equal(r.after, r.before, 'came back to a different scale than it left at');
    assert.ok(r.worst < 0.01, `the zoom stepped by ${r.worst} in a single tick`);
  });

  await t.test('no uncaught page errors', () => {
    assert.deepEqual(ctx.errors, []);
  });
});
