import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../src/core/constants.js';
import {
  Telegraph, edgeArrow, bombOnScreen, BOMB_PAD,
} from '../../src/wings/telegraph.js';
import {
  BOMBS, bombFor, drawFallingBomb, TG_ART,
} from '../../src/wings/art/telegraph.js';
import { BombSight, FLASH_TICKS } from '../../src/wings/bomb-sight.js';

const CAM = { x: 0, y: 0, w: 256, h: 240 };
const DIRS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

// A 2D context that only records. drawFallingBomb is pure fillRect, exactly
// like the reticle and the arrow beside it, so this is its whole surface.
function recorder() {
  const rects = [];
  return {
    rects,
    ctx: {
      fillStyle: '',
      fillRect(x, y, w, h) {
        rects.push({ x, y, w, h, fill: this.fillStyle });
      },
    },
  };
}

// The lit box of everything that was drawn, in game pixels.
function bounds(rects) {
  const xs = rects.map((r) => r.x);
  const ys = rects.map((r) => r.y);
  return {
    x0: Math.min(...xs), x1: Math.max(...rects.map((r) => r.x + r.w)),
    y0: Math.min(...ys), y1: Math.max(...rects.map((r) => r.y + r.h)),
  };
}

test('a bomb inside the view gets a screen position, one outside gets none', () => {
  assert.deepEqual(bombOnScreen(40, 30, CAM), { x: 40, y: 30 });
  // The camera is not always at the origin, and forgetting that is the whole
  // class of bug this function exists to make impossible.
  assert.deepEqual(bombOnScreen(300, 30, { x: 256, y: 0, w: 256, h: 240 }), { x: 44, y: 30 });
  assert.equal(bombOnScreen(40, -200, CAM), null, 'a bomb far above the view must not be drawn');
  assert.equal(bombOnScreen(-200, 30, CAM), null);
  assert.equal(bombOnScreen(40, 30, null), null);
});

test('the arrow hands over to the bomb, and they overlap while it happens', () => {
  // Well outside: the arrow is the whole telegraph and there is no bomb to draw.
  assert.ok(edgeArrow(120, -100, CAM), 'no arrow for a bomb above the screen');
  assert.equal(bombOnScreen(120, -100, CAM), null);

  // Straddling the top edge: the sprite is already sliding into view while the
  // arrow is still up. Without this overlap the arrow blinks out and the bomb
  // pops in a frame later, and the eye loses the thing it was tracking.
  const y = -Math.round(BOMB_PAD / 2);
  assert.ok(edgeArrow(120, y, CAM), 'the arrow must still be up at the handover');
  assert.ok(bombOnScreen(120, y, CAM), 'the bomb must already be drawn at the handover');

  // Well inside: the bomb IS the telegraph and the arrow is gone.
  assert.equal(edgeArrow(120, 100, CAM), null);
  assert.ok(bombOnScreen(120, 100, CAM));
});

test('there are eight bombs and they are all square and legal', () => {
  assert.deepEqual(Object.keys(BOMBS).sort(), [...DIRS].sort());
  for (const d of DIRS) {
    const g = BOMBS[d];
    assert.equal(g.length, 9, `${d} is not 9 rows`);
    for (const row of g) {
      assert.equal(row.length, 9, `${d} has a ragged row`);
      assert.match(row, /^[.012]+$/, `${d} uses an illegal pixel char`);
    }
  }
  const seen = new Set(DIRS.map((d) => BOMBS[d].join('|')));
  assert.equal(seen.size, 8, 'two directions render identically');
});

test('a bomb points along its velocity — the nose leads, the fins trail', () => {
  // The nose is body ('0'/'1'); the fins are '2'. A bomb reads as pointing
  // somewhere because its fins are BEHIND its nose, so that is what is
  // asserted rather than a bare centre of mass.
  const fins = (g) => {
    let n = 0; let sx = 0; let sy = 0;
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < 9; x++) {
        if (g[y][x] === '2') { n++; sx += x - 4; sy += y - 4; }
      }
    }
    return { x: sx / n, y: sy / n };
  };
  assert.ok(fins(BOMBS.S).y < -0.5, 'a bomb falling straight down trails its fins UP');
  assert.ok(fins(BOMBS.N).y > 0.5);
  assert.ok(fins(BOMBS.E).x < -0.5);
  assert.ok(fins(BOMBS.W).x > 0.5);
  assert.ok(fins(BOMBS.SE).x < -0.3 && fins(BOMBS.SE).y < -0.3);
  assert.ok(fins(BOMBS.NW).x > 0.3 && fins(BOMBS.NW).y > 0.3);

  // atan2(vy, vx) with +Y down, the same convention the pilot's side uses.
  assert.equal(bombFor(Math.atan2(1, 0)), BOMBS.S, 'a bomb with vy>0 falls DOWN');
  assert.equal(bombFor(Math.atan2(-1, 0)), BOMBS.N);
  assert.equal(bombFor(Math.atan2(0, 1)), BOMBS.E);
  assert.equal(bombFor(Math.atan2(1, 1)), BOMBS.SE);
  assert.equal(bombFor(Math.atan2(4, -1)), BOMBS.S, 'nearest of the eight, not truncated');
});

test('the bomb is drawn on whole GAME pixels, centred on where it is', () => {
  const { ctx, rects } = recorder();
  drawFallingBomb(ctx, 100.4, 60.6, Math.PI / 2, { speed: 6 });
  assert.ok(rects.length > 0, 'nothing was drawn');
  for (const r of rects) {
    for (const v of [r.x, r.y, r.w, r.h]) {
      assert.equal(v, Math.round(v), `fractional coordinate ${v}`);
    }
  }
  // The sprite is 9x9 plus a one-pixel shadow, so its box brackets the point.
  // The trail runs backwards from it and is allowed outside.
  const body = rects.filter((r) => r.fill !== TG_ART.shadow);
  const b = bounds(body);
  assert.ok(b.x0 <= 100 && b.x1 >= 101, `bomb box ${b.x0}..${b.x1} does not contain its x`);
  assert.ok(b.y0 <= 61 && b.y1 >= 61, `bomb box ${b.y0}..${b.y1} does not contain its y`);
});

test('a bomb with no speed has no trail, a falling one does', () => {
  const at = (speed) => {
    const { ctx, rects } = recorder();
    drawFallingBomb(ctx, 100, 60, Math.PI / 2, { speed });
    return rects.length;
  };
  assert.ok(at(8) > at(0), 'a fast bomb must streak');
  assert.equal(at(0), at(0.5), 'the trail must not flicker at a standstill');
});

// The assertion the whole task turns on: the drawn bomb and the reticle are
// the SAME prediction, so the gap between them can only close.
test('the drawn bomb converges on the reticle it is warning about', () => {
  const floorY = 13 * TILE;
  const tg = new Telegraph({ floorY, surfaceAt: () => floorY });
  tg.add({ id: 'b', kind: 'bomb', x: 30 * TILE + 8, y: floorY - 220, vx: 0.7, vy: 0 });
  const cam = { x: 25 * TILE, y: 0, w: 256, h: 240 };

  const gaps = [];     // to the predicted impact POINT — the shared prediction
  const drawn = [];    // to the reticle as it is actually painted
  const tiles = new Set();
  for (let i = 0; i < 400 && tg.shots.size; i++) {
    const m = tg.marks(30 * TILE, cam)[0];
    if (m && m.impact) {
      const bomb = bombOnScreen(m.x, m.y, cam, 1e9);
      gaps.push(Math.hypot(bomb.x - (m.impact.x - cam.x), bomb.y - (m.impact.y - cam.y)));
      const rx = m.impact.tx * TILE + TILE / 2 - cam.x;
      const ry = m.impact.ty * TILE - cam.y;
      drawn.push(Math.hypot(bomb.x - rx, bomb.y - ry));
      tiles.add(`${m.impact.tx},${m.impact.ty}`);
    }
    tg.step();
  }

  assert.ok(gaps.length > 30, `only ${gaps.length} frames of flight to check`);
  assert.ok(gaps[0] > 150, 'test premise: the bomb starts a long way from its mark');
  assert.equal(tiles.size, 1, 'the reticle wandered between tiles during the fall');
  for (let i = 1; i < gaps.length; i++) {
    assert.ok(
      gaps[i] < gaps[i - 1],
      `the gap grew, ${gaps[i - 1]} -> ${gaps[i]}: the bomb and the reticle disagree`
    );
  }
  assert.ok(gaps[gaps.length - 1] < 8, `the bomb ended ${gaps.at(-1)}px from its own prediction`);
  // A tile of slack against the PAINTED reticle: it marks the centre of the
  // top edge of the impact tile, and the bomb lands somewhere inside it.
  assert.ok(
    drawn[drawn.length - 1] < TILE,
    `the bomb ended ${drawn.at(-1)}px from its own reticle`
  );
});

test('the sight lights pixels at the bomb\'s projected position, and only in view', () => {
  const sight = new BombSight();
  const cam = { x: 100, y: 0, w: 256, h: 240 };
  const mark = (x, y) => ([{ id: 'b', x, y, vx: 0, vy: 6, angle: Math.PI / 2, impact: null }]);

  const off = recorder();
  sight.draw(off.ctx, mark(180, -300), cam, 0);
  assert.equal(off.rects.length, 0, 'a bomb far above the view must not be painted');

  const on = recorder();
  sight.draw(on.ctx, mark(180, 90), cam, 1);
  assert.ok(on.rects.length > 10, 'the bomb in view painted nothing');
  const b = bounds(on.rects.filter((r) => r.fill !== TG_ART.shadow));
  // 180 - 100 = 80 on screen, 90 - 0 = 90 down.
  assert.ok(b.x0 <= 80 && b.x1 >= 81, `lit box ${b.x0}..${b.x1} is not at x=80`);
  assert.ok(b.y0 <= 90 && b.y1 >= 91, `lit box ${b.y0}..${b.y1} is not at y=90`);
});

test('a bomb that reaches its mark leaves a flash; one cleared in mid-air does not', () => {
  const sight = new BombSight();
  const cam = { x: 0, y: 0, w: 256, h: 240 };
  const impact = { x: 120, y: 208, ticks: 1, tx: 7, ty: 13 };

  sight.draw(recorder().ctx, [{ id: 'b', x: 120, y: 204, vx: 0, vy: 6, angle: 1.5, impact }], cam, 0);
  assert.equal(sight.busy, false, 'nothing has landed yet');
  sight.draw(recorder().ctx, [], cam, 1);
  assert.equal(sight.busy, true, 'the bomb vanished on the ground and left nothing');

  const flash = recorder();
  sight.draw(flash.ctx, [], cam, 2);
  assert.ok(flash.rects.length > 0, 'the flash painted nothing');
  const b = bounds(flash.rects);
  assert.ok(b.x0 <= 120 && b.x1 >= 120, 'the flash is not where the crater will be');
  assert.ok(b.y0 <= 208 && b.y1 >= 208);

  sight.draw(recorder().ctx, [], cam, 2 + FLASH_TICKS);
  assert.equal(sight.busy, false, 'the flash outstayed its welcome');

  // A shot that disappears while still high up expired, or the level was
  // reset. There is no crater, so there must be no flash.
  const s2 = new BombSight();
  s2.draw(recorder().ctx, [{ id: 'q', x: 120, y: 40, vx: 0, vy: 6, angle: 1.5, impact }], cam, 0);
  s2.draw(recorder().ctx, [], cam, 1);
  assert.equal(s2.busy, false, 'a bomb that never arrived must not flash');
});

test('clearing the sight forgets everything, without flashing on the way out', () => {
  const sight = new BombSight();
  const cam = { x: 0, y: 0, w: 256, h: 240 };
  const impact = { x: 120, y: 208, ticks: 1, tx: 7, ty: 13 };
  sight.draw(recorder().ctx, [{ id: 'b', x: 120, y: 206, vx: 0, vy: 6, angle: 1.5, impact }], cam, 0);
  sight.clear();
  sight.draw(recorder().ctx, [], cam, 1);
  assert.equal(sight.busy, false);
});
