import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TG_ART, ARROWS, arrowFor, drawReticle, drawEdgeArrow,
} from '../../src/wings/art/telegraph.js';

const DIRS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

test('there are eight arrows and they are all square', () => {
  assert.deepEqual(Object.keys(ARROWS).sort(), [...DIRS].sort());
  for (const d of DIRS) {
    const g = ARROWS[d];
    assert.equal(g.length, 7, `${d} is not 7 rows`);
    for (const row of g) {
      assert.equal(row.length, 7, `${d} has a ragged row`);
      assert.match(row, /^[.0]+$/, `${d} uses an illegal pixel char`);
    }
  }
});

test('every arrow is distinct — nothing is a copy of its neighbour', () => {
  const seen = new Set(DIRS.map((d) => ARROWS[d].join('|')));
  assert.equal(seen.size, 8, 'two directions render identically');
});

test('the arrows point where they say they point', () => {
  // Centre of mass of the lit pixels, relative to the middle of the grid.
  const com = (g) => {
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        if (g[y][x] === '0') {
          n++;
          sx += x - 3;
          sy += y - 3;
        }
      }
    }
    return { x: sx / n, y: sy / n };
  };
  assert.ok(com(ARROWS.E).x > 0.3 && Math.abs(com(ARROWS.E).y) < 1e-9);
  assert.ok(com(ARROWS.W).x < -0.3 && Math.abs(com(ARROWS.W).y) < 1e-9);
  assert.ok(com(ARROWS.S).y > 0.3 && Math.abs(com(ARROWS.S).x) < 1e-9);
  assert.ok(com(ARROWS.N).y < -0.3 && Math.abs(com(ARROWS.N).x) < 1e-9);
  assert.ok(com(ARROWS.NE).x > 0.2 && com(ARROWS.NE).y < -0.2);
  assert.ok(com(ARROWS.SW).x < -0.2 && com(ARROWS.SW).y > 0.2);
});

test('an angle picks the nearest of the eight, +Y being DOWN', () => {
  assert.equal(arrowFor(0), ARROWS.E);
  assert.equal(arrowFor(Math.PI), ARROWS.W);
  assert.equal(arrowFor(-Math.PI), ARROWS.W, 'the seam must not fall through');
  assert.equal(arrowFor(Math.PI / 2), ARROWS.S, '+Y is down, so +PI/2 points DOWN');
  assert.equal(arrowFor(-Math.PI / 2), ARROWS.N);
  assert.equal(arrowFor(-Math.PI / 4), ARROWS.NE);
  assert.equal(arrowFor(Math.PI * 0.74), ARROWS.SW, 'nearest, not truncated');
});

test('the palette is hex and the reticle contrasts with its core', () => {
  for (const c of [TG_ART.reticle, TG_ART.core, TG_ART.arrow, TG_ART.shadow]) {
    assert.match(c, /^#[0-9a-f]{6}$/i);
  }
  assert.notEqual(TG_ART.reticle, TG_ART.core);
});

// A 2D context that only records. Both draw functions are pure fillRect, so
// this is the whole surface they touch.
function recorder() {
  const rects = [];
  return {
    rects,
    ctx: {
      fillStyle: '',
      fillRect(x, y, w, h) {
        rects.push([x, y, w, h]);
      },
    },
  };
}

test('the drawing calls land on whole GAME pixels', () => {
  // The overlay applies the display scale as a canvas transform, so everything
  // in this module works in 256x240 game pixels and must stay on integers —
  // that is what keeps the marker on the same grid as the world under it. The
  // fractional inputs below are deliberate: the caller has a camera and a
  // sub-pixel radius, and rounding is this module's job.
  const { ctx, rects } = recorder();
  drawReticle(ctx, 100.4, 60.6, 12.3, { urgent: false, frame: 0 });
  drawReticle(ctx, 40, 40, 4, { urgent: true, frame: 1 });
  drawEdgeArrow(ctx, 10.5, 120.2, 0);
  drawEdgeArrow(ctx, 200, 8, -Math.PI / 2);
  assert.ok(rects.length > 0, 'nothing was drawn');
  for (const r of rects) {
    for (const v of r) assert.equal(v, Math.round(v), `fractional coordinate ${v}`);
  }
});

test('the urgent blink actually blinks', () => {
  const lit = (frame) => {
    const { ctx, rects } = recorder();
    drawReticle(ctx, 50, 50, 10, { urgent: true, frame });
    return rects.length;
  };
  // The core pip is drawn on half the frames and nothing else changes, so the
  // rect count alternates between two values as the frame counter advances.
  assert.notEqual(lit(0), lit(4), 'the pip never went out');
  assert.equal(lit(0), lit(8), 'the blink must be periodic');
});

test('a non-urgent reticle always shows its core', () => {
  const { ctx, rects } = recorder();
  drawReticle(ctx, 50, 50, 10, { urgent: false, frame: 4 });
  const { ctx: c2, rects: r2 } = recorder();
  drawReticle(c2, 50, 50, 10, { urgent: false, frame: 5 });
  assert.equal(rects.length, r2.length, 'only the last half-second may blink');
});
