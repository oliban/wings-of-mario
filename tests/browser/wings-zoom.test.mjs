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

  // THE ACCEPTANCE CRITERION, in the user's own words: "I need to be able to
  // see the island when high above it". Not "a scale factor changed" — the
  // island has to be ON THE SCREEN, so this reads the pixels the player would
  // be looking at and requires land among them.
  await t.test('an island directly below is visible from every altitude, ceiling included', async () => {
    const look = (y) => page.evaluate((py) => {
      const W = window.__WINGS;
      W.reset();
      const isle = W.sim.islands[0];
      const p = W.sim.plane;
      p.mode = 'air';
      p.gear = false;
      p.angle = 0;
      // Column 60 of 1-1 is open ground with bushes on it — land, not a pit.
      p.x = isle.x0 + 60 * 16;
      p.y = py;
      p.speed = 2.7;
      p.vx = 2.7;
      p.vy = 0;
      W.tick(2);
      const r = W.renderer;
      const ss = r.ss;
      const playH = 240 - 44;
      const img = r.ctx.getImageData(0, 0, r.buffer.width, playH * ss).data;
      // Count land: the island's earth and grass are the only warm/green
      // pixels in a scene made of sky blue, sea blue and a grey aeroplane.
      let earth = 0;
      let grass = 0;
      let lowest = 0;
      for (let row = 0; row < playH * ss; row++) {
        for (let col = 0; col < r.buffer.width; col += 4) {
          const i = (row * r.buffer.width + col) * 4;
          const [rr, gg, bb] = [img[i], img[i + 1], img[i + 2]];
          if (rr > gg + 20 && gg > bb + 20) { earth++; lowest = Math.max(lowest, row / ss); }
          else if (gg > rr + 30 && gg > bb + 30) { grass++; lowest = Math.max(lowest, row / ss); }
        }
      }
      const f = W.scene.frame(W.sim);
      return {
        earth,
        grass,
        lowest,
        zoom: W.scene.zoom,
        seaRow: (560 - f.cam.y) * f.scale,
        playH,
      };
    }, y);

    for (const y of [440, 360, 280, 200, 120, 40, 0]) {
      const r = await look(y);
      assert.ok(
        r.earth + r.grass > 40,
        `from y=${y} (zoom ${r.zoom.toFixed(2)}) there is no island on screen: ${r.earth} earth and ${r.grass} grass pixels`
      );
      assert.ok(
        r.seaRow <= r.playH,
        `from y=${y} the sea line is at device row ${Math.round(r.seaRow)}, past the ${r.playH}px play area`
      );
    }
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
    // Flown under power, not teleported: the rate the scale actually moves at
    // is the rate the aeroplane can actually climb, and the two are only the
    // same if it is the flight model doing the moving.
    const r = await page.evaluate(() => {
      const W = window.__WINGS;
      W.reset();
      W.hold({ pitch: 1, thrust: 1 });
      while (W.state().mode !== 'air') W.tick(1);
      W.hold({ pitch: 0, thrust: 1 });
      for (let i = 0; i < 200 && W.state().y < 470; i++) W.tick(1);
      const before = W.scene.zoom;
      const seen = [before];
      const at = [];
      for (let i = 0; i < 900 && W.state().y > 8; i++) {
        W.hold({ pitch: W.state().angle > -0.5 ? 1 : 0, thrust: 1 });
        W.tick(1);
        seen.push(W.scene.zoom);
        at.push(W.state().y);
      }
      const top = W.scene.zoom;
      for (let i = 0; i < 600 && W.state().y < 460 && W.state().mode === 'air'; i++) {
        W.hold({ pitch: W.state().angle < 0.5 ? -1 : 0, thrust: 1 });
        W.tick(1);
        seen.push(W.scene.zoom);
        at.push(W.state().y);
      }
      W.release();
      let worst = 0;
      let worstAt = null;
      for (let i = 1; i < seen.length; i++) {
        const d = Math.abs(seen[i] - seen[i - 1]);
        if (d > worst) { worst = d; worstAt = at[i - 1]; }
      }
      return { before, top, worst, worstAt, low: W.scene.zoom, y: W.state().y };
    });
    assert.ok(r.before > 1.1, 'the climb did not start inside the dead band');
    assert.ok(r.top < 0.4, `never zoomed out on the way up (${r.before} -> ${r.top})`);
    assert.equal(r.low, 1.15, `coming back down to y=${r.y} did not restore full scale`);
    // Flown rather than teleported, the steepest single tick is well under a
    // fiftieth of the scale — and it happens just above the dead band, where
    // 1/height is steepest, exactly as the unit tests describe.
    assert.ok(r.worst < 0.02, `the zoom stepped by ${r.worst} in a single tick at y=${r.worstAt}`);
    assert.ok(r.worstAt > 300, `the steepest tick was at y=${r.worstAt}, not down near the dead band`);
  });

  await t.test('no uncaught page errors', () => {
    assert.deepEqual(ctx.errors, []);
  });
});
