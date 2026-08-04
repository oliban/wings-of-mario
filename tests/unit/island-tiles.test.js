import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../src/core/constants.js';
import { getLevel, LEVELS } from '../../src/data/levels/index.js';
import { Island } from '../../src/wings/island.js';
import { drawLandmass } from '../../src/wings/art/land.js';
import {
  LOD, PAINT, THEMES, COMPOSITE, lodFor, themeFor, isInvisible, mat,
} from '../../src/wings/art/mario-tiles.js';
import { MARIO, luma } from '../../src/wings/art/palette.js';
import { ZOOM } from '../../src/wings/scene.js';

// The island art had no test of any kind before this file, which is how a
// character that six castle levels use ended up rendering as a grey slab
// hanging in mid air for as long as it did. The guards here are: every
// character a level can contain has a painter, the material ramps copied from
// the Mario side do not drift from it, and the same tick draws the same
// picture.

const ORIGIN = 3000;

// A canvas that records rather than paints. Enough of the 2D API for the tile
// art, and every call is captured in order so two frames can be compared.
function recorder() {
  const ops = [];
  const fmt = (v) => (typeof v === 'number' ? v.toFixed(3) : String(v));
  const push = (name) => (...args) => ops.push(`${name}(${args.map(fmt).join(',')})`);
  const ctx = {
    ops,
    save: push('save'),
    restore: push('restore'),
    translate: push('translate'),
    scale: push('scale'),
    clip: push('clip'),
    beginPath: push('beginPath'),
    closePath: push('closePath'),
    moveTo: push('moveTo'),
    lineTo: push('lineTo'),
    rect: push('rect'),
    arc: push('arc'),
    quadraticCurveTo: push('quadraticCurveTo'),
    fill: push('fill'),
    stroke: push('stroke'),
    fillRect: push('fillRect'),
    strokeRect: push('strokeRect'),
    ellipse: push('ellipse'),
  };
  for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalAlpha']) {
    let v;
    Object.defineProperty(ctx, k, {
      get: () => v,
      set: (nv) => {
        v = nv;
        ops.push(`${k}=${fmt(nv)}`);
      },
    });
  }
  return ctx;
}

const WIDE = { x: ORIGIN, y: 400 };

function render(isle, scale = 1.15, tick = 0, cam = WIDE) {
  const ctx = recorder();
  drawLandmass(ctx, isle, cam, 4000, 260, tick, 560, scale);
  return ctx.ops;
}

// Euclidean RGB distance — the metric src/data/tiles.js states and asserts on
// itself ("mean Euclidean RGB over slots 1-4", `tiles.js:180-186`).
function apart(a, b) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// ---------------------------------------------------------------------------

test('every character any level can contain has a painter of its own', () => {
  const seen = new Set();
  for (const id of Object.keys(LEVELS)) {
    for (const row of getLevel(id).tiles) for (const ch of row) seen.add(ch);
  }
  assert.ok(seen.size > 20, `only found ${seen.size} distinct characters — did the levels load?`);
  const orphans = [...seen].filter(
    (ch) => ch !== '.' && ch !== ' ' && !PAINT[ch] && !COMPOSITE[ch] && !isInvisible(ch)
  );
  assert.deepEqual(orphans, [], `these characters fall through to the generic block: ${orphans}`);
});

test('the invisible blocks are not drawn, because the original never shows them', () => {
  assert.ok(isInvisible('1'), 'the hidden 1-up block');
  assert.ok(isInvisible('C'), 'the hidden coin block');
  assert.ok(!isInvisible('?'), 'a question block is not hidden');
});

// The ramps in palette.js are COPIED out of src/data/tiles.js rather than
// imported — the pilot must not depend on the Mario engine's sprite pipeline.
// These tests are what stops the copy rotting: the same shape, the same
// dark-to-light ordering, and the same separation the Mario side asserts.
const RAMPS = ['EARTH', 'BRICK', 'ASHLAR', 'STONE', 'QUARRY', 'PIPE', 'TIMBER'];

test('every material has a whole ramp in every area, ordered dark to light', () => {
  for (const name of RAMPS) {
    for (const theme of THEMES) {
      const r = mat(MARIO[name], theme);
      assert.equal(r.length, 5, `${name}.${theme} is not a five-slot ramp`);
      for (const hex of r) assert.match(hex, /^#[0-9a-f]{6}$/i, `${name}.${theme}`);
      for (let i = 1; i < r.length; i++) {
        assert.ok(luma(r[i]) > luma(r[i - 1]), `${name}.${theme} slot ${i} is not lighter`);
      }
    }
  }
  assert.equal(themeFor('castle'), 'castle');
  assert.equal(themeFor(undefined), 'overworld', 'an unlabelled level is an overworld one');
  assert.equal(themeFor('nonsense'), 'overworld');
});

test('no two materials in one area are the same paint', () => {
  for (const theme of THEMES) {
    for (let i = 0; i < RAMPS.length; i++) {
      for (let j = i + 1; j < RAMPS.length; j++) {
        const a = mat(MARIO[RAMPS[i]], theme);
        const b = mat(MARIO[RAMPS[j]], theme);
        let sum = 0;
        for (let k = 1; k < 5; k++) sum += apart(a[k], b[k]);
        const d = sum / 4;
        assert.ok(d >= 45,
          `${RAMPS[i]} and ${RAMPS[j]} are only ${d.toFixed(1)} apart in ${theme}`);
      }
    }
  }
});

test('the question block stays gold, and its glyph stays legible on it', () => {
  const gold = MARIO.GOLD;
  assert.equal(gold.length, 4);
  assert.ok(luma(MARIO.GLYPH[1]) - luma(gold[1]) > 60,
    'the cream glyph must carry against the gold face');
  // Gold shares more screen with brick than with anything else in the game.
  for (const theme of THEMES) {
    const d = apart(gold[1], mat(MARIO.BRICK, theme)[2]);
    assert.ok(d >= 45, `gold is only ${d.toFixed(1)} from the ${theme} brick`);
  }
});

test('the ground and the brick are two different materials from the air', () => {
  // What the pilot is choosing bomb targets off: the floor he cannot break and
  // the block he can. On the Mario side these are EARTH and BRICK and they are
  // deliberately different paint; the pilot used to draw both in one brown.
  for (const theme of THEMES) {
    const d = apart(mat(MARIO.EARTH, theme)[2], mat(MARIO.BRICK, theme)[2]);
    assert.ok(d >= 45, `ground and brick are only ${d.toFixed(1)} apart in ${theme}`);
  }
});

test('the level of detail is chosen for the zoom range the game actually flies', () => {
  assert.equal(lodFor(ZOOM.MAX), LOD.FULL, 'the attack altitude gets the full face');
  assert.equal(lodFor(ZOOM.MIN), LOD.COARSE, 'the service ceiling cannot afford ornament');
  // Monotone: climbing never ADDS detail.
  let prev = lodFor(ZOOM.MIN);
  for (let s = ZOOM.MIN; s <= ZOOM.MAX; s += 0.01) {
    const lod = lodFor(s);
    assert.ok(lod >= prev, `detail went backwards at scale ${s.toFixed(2)}`);
    prev = lod;
  }
});

// ---------------------------------------------------------------------------

test('an island draws identically for the same tick, and differs by tick only where it animates', () => {
  const isle = new Island(getLevel('1-1'), ORIGIN);
  assert.deepEqual(render(isle, 1.15, 40), render(isle, 1.15, 40), 'not deterministic at one tick');
  assert.notDeepEqual(
    render(isle, 1.15, 0),
    render(isle, 1.15, 12),
    'nothing on the island animates — the question blocks should cycle'
  );
});

test('a bombed tile leaves a hole rather than being redrawn', () => {
  const isle = new Island(getLevel('1-1'), ORIGIN);
  const before = render(isle).length;
  isle.applyDamage(['20,13', '21,13', '22,13', '20,14', '21,14', '22,14']);
  assert.ok(render(isle).length < before, 'destroying six ground tiles drew no less work');
});

// The row of identical green domes was the loudest thing wrong with the old
// island: a five-tile bush is ONE object in the original, not five copies of a
// one-tile one. This is the guard on that, and it is worth having because the
// run finder is the only clever code in land.js.
test('a run of scenery is one shape at the run’s full width', () => {
  const calls = [];
  const original = COMPOSITE.b;
  COMPOSITE.b = (c, x, y, w, h) => calls.push({ x, y, w, h });
  try {
    render({
      level: { theme: 'overworld' },
      w: 30,
      h: 15,
      x0: ORIGIN,
      x1: ORIGIN + 30 * TILE,
      y0: 400,
      charAt: (tx, ty) => (ty === 12 && tx >= 11 && tx <= 15 ? 'b' : '.'),
      blocksTile: () => false,
    });
  } finally {
    COMPOSITE.b = original;
  }
  assert.equal(calls.length, 1, 'a five-tile bush should be drawn exactly once');
  assert.equal(calls[0].w, 5 * TILE, 'and at the full width of its run');
  assert.equal(calls[0].x, 11 * TILE);
  assert.equal(calls[0].h, TILE);
});

// The ground's joints course THROUGH the tile seam, which is what makes a row
// of ground tiles read as one wall rather than a row of squares. The pattern
// is therefore a function of the tile's place in the world, and two tiles an
// odd number of columns apart must not draw the same marks.
test('the ground courses across tile seams instead of repeating per tile', () => {
  const at = (tx) => render({
    level: { theme: 'overworld' },
    w: 40,
    h: 15,
    x0: ORIGIN,
    x1: ORIGIN + 40 * TILE,
    y0: 400,
    charAt: (x, y) => (x === tx && y === 13 ? '#' : '.'),
    blocksTile: () => false,
  }).filter((o) => o.startsWith('fillRect'));
  assert.ok(at(10).length > 4, 'a ground tile should draw its courses');
  assert.notDeepEqual(at(10), at(11), 'every ground tile drew the identical pattern');
});
