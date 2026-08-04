import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE } from '../../src/core/constants.js';
import { getLevel, LEVELS } from '../../src/data/levels/index.js';
import { Island } from '../../src/wings/island.js';
import { drawLandmass } from '../../src/wings/art/land.js';
import {
  LOD, PAINT, THEME, COMPOSITE, lodFor, themeFor, isInvisible,
} from '../../src/wings/art/mario-tiles.js';
import { SMB, luma } from '../../src/wings/art/palette.js';
import { ZOOM } from '../../src/wings/scene.js';

// The island art had no test of any kind before this file, which is how a
// character that six castle levels use ended up rendering as a grey slab
// hanging in mid air for as long as it did. These are the three cheap guards:
// every character a level can contain has a painter, the pilot can still tell
// his targets apart by colour, and the same tick draws the same picture.

const ORIGIN = 3000;

// A canvas that records rather than paints. Enough of the 2D API for the tile
// art, and every call is captured in order so two frames can be compared.
function recorder() {
  const ops = [];
  const push = (name) => (...args) => ops.push(`${name}(${args.map(fmt).join(',')})`);
  const fmt = (v) => (typeof v === 'number' ? v.toFixed(3) : String(v));
  const ctx = {
    ops,
    _style: '',
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

test('every theme supplies a whole palette', () => {
  for (const [name, pal] of Object.entries(THEME)) {
    for (const slot of ['body', 'lit', 'dark', 'mortar']) {
      assert.match(pal[slot], /^#[0-9a-f]{6}$/i, `THEME.${name}.${slot}`);
    }
    assert.ok(luma(pal.lit) > luma(pal.body), `${name}: the lit tone must be lighter`);
    assert.ok(luma(pal.dark) < luma(pal.body), `${name}: the shaded tone must be darker`);
  }
  assert.equal(themeFor('castle'), THEME.castle);
  assert.equal(themeFor(undefined), THEME.overworld, 'an unlabelled level is an overworld one');
  assert.equal(themeFor('nonsense'), THEME.overworld);
});

// The pilot picks bomb targets off these colours, so the ones that mean
// different things have to stay apart. Deliberately NOT on this list: ground
// versus brick. In the original they are the SAME orange and are told apart by
// pattern alone, and matching that was the point of the rewrite.
test('the materials a pilot must tell apart stay apart', () => {
  const dist = (a, b) => {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return (Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2])) / 3;
  };
  const pairs = [
    ['gold', 'orange'], ['gold', 'green'], ['green', 'orange'],
    ['orange', 'stone'], ['green', 'stone'], ['gold', 'stone'],
    ['lava', 'green'], ['iron', 'orange'],
  ];
  for (const [a, b] of pairs) {
    const d = dist(SMB[a], SMB[b]);
    assert.ok(d >= 45, `${a} vs ${b} is only ${d.toFixed(1)} apart; the pilot cannot tell them apart`);
  }
  // And the underground/castle repaints must not collide with the pipe, which
  // keeps its green in every area exactly as the original does.
  for (const name of ['underground', 'castle', 'water']) {
    const d = dist(THEME[name].body, SMB.green);
    assert.ok(d >= 40, `${name} blocks are only ${d.toFixed(1)} from a pipe`);
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
    'nothing on the island animates — the question blocks should pulse'
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
