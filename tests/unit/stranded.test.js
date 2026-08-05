import test from 'node:test';
import assert from 'node:assert/strict';
import {
  strandedBy, gapAhead, gapIsJumpable, jumpReachPx, runupSpeed, landingRow,
  GapLedger, APPROACH_TILES, PARCEL_COINS,
} from '../../src/wings/stranded.js';
import { PHYS, simulateJump } from '../../src/game/physics.js';
import { TILE } from '../../src/core/constants.js';
import LEVEL_1_1 from '../../src/data/levels/1-1.js';

// A parcel is what Mario gets when the bomber has dug a hole he cannot jump.
// Everything here is about the two halves of that sentence: "cannot jump",
// which is the engine's own physics and not a guessed tile count, and "the
// bomber has dug", which is the difference between the level's map and the map
// as it stands now. 1-1's own holes must never pay out.

// A grid from ASCII rows: '#' is anything solid, everything else is air. The
// shape is the one src/wings/stranded.js works in — { w, h, solid(tx, ty) } —
// which is all it ever needs to know about a tile map.
function grid(rows) {
  return {
    w: rows[0].length,
    h: rows.length,
    solid: (tx, ty) => rows[ty] != null && rows[ty][tx] === '#',
  };
}

// The same ground with `n` tiles knocked out of it starting at column `at`.
function bomb(rows, at, n) {
  return rows.map((r) => r.slice(0, at) + ' '.repeat(n) + r.slice(at + n));
}

const FLOOR = (w = 40) => ['#'.repeat(w)];

test('the jump reach is the engine\'s, not a number typed in here', () => {
  // physics.js already simulates a flat jump; this file has to agree with it to
  // within the one frame the two loops differ by at the landing.
  const flat = simulateJump(PHYS.maxRunSpeed);
  const mine = jumpReachPx(PHYS.maxRunSpeed, 0);
  assert.ok(Math.abs(mine - flat.distancePx) <= PHYS.maxRunSpeed + 1e-9,
    `${mine} vs ${flat.distancePx}`);
  // And it is what the constants say it is: a full run clears about eight and a
  // half tiles. If this number moves, the engine's feel moved with it.
  assert.ok(mine / TILE > 8 && mine / TILE < 9, `${mine / TILE} tiles`);
});

test('a jump down carries further, a jump up carries less', () => {
  const flat = jumpReachPx(PHYS.maxRunSpeed, 0);
  assert.ok(jumpReachPx(PHYS.maxRunSpeed, 3 * TILE) > flat, 'landing lower is further');
  assert.ok(jumpReachPx(PHYS.maxRunSpeed, -3 * TILE) < flat, 'landing higher is shorter');
  assert.equal(jumpReachPx(PHYS.maxRunSpeed, -20 * TILE), 0, 'a ledge he cannot reach at all');
});

test('run-up decides the takeoff speed, so a shelf is worth less than a runway', () => {
  assert.equal(runupSpeed(8 * TILE), PHYS.maxRunSpeed, 'eight tiles is a full run');
  const shelf = runupSpeed(TILE);
  assert.ok(shelf < PHYS.maxRunSpeed, 'one tile of ground is not a running start');
  assert.ok(jumpReachPx(shelf) < jumpReachPx(PHYS.maxRunSpeed), 'and it does not go as far');
});

test('a column with nothing under it is a hole; one with a ledge over the pit is not', () => {
  const g = grid([
    '     ##   ',
    '          ',
    '###    ###',
  ]);
  assert.equal(landingRow(g, 0, 2), 2);
  assert.equal(landingRow(g, 8, 2), 2, 'air above floor is still floor');
  assert.equal(landingRow(g, 5, 2), 0, 'a ledge within a jump of his row is a landing');
  assert.equal(landingRow(g, 3, 2), null, 'nothing at all: a hole');
});

// Every legend char whose record in src/data/tiles.js is `solid: true`, plus
// 'P', the one-way platform, which is a thing to land on. Written out rather
// than imported because tiles.js builds sprites at module load and needs a
// canvas; the running game gets its answer from world.solidAt instead (see
// src/wings/parcel.js), and this list only has to be right about 1-1.
const SOLID_CHARS = '#=?M1CBS[]{}<>-XgKkvTP';

test('1-1\'s own holes are jumpable, every one of them', () => {
  const g = grid(LEVEL_1_1.tiles.map((r) =>
    [...r].map((ch) => (SOLID_CHARS.includes(ch) ? '#' : ' ')).join('')));
  // Walk the level the way Mario does and check every hole he meets.
  let seen = 0;
  for (let tx = 1; tx < g.w - 1; tx++) {
    const ty = landingRow(g, tx, 12);
    if (ty == null) continue;
    const gap = gapAhead(g, tx, ty);
    if (!gap || gap.land == null) continue;
    seen++;
    assert.equal(gapIsJumpable(gap), true, `1-1 hole at ${gap.start} is ${gap.width} wide`);
  }
  assert.ok(seen > 0, 'the scan found no holes in 1-1 at all, so it proved nothing');
});

test('an eight-tile hole is a jump and a twelve-tile hole is not', () => {
  const rows = FLOOR(40);
  const eight = grid(bomb(rows, 12, 8));
  const twelve = grid(bomb(rows, 12, 12));
  assert.equal(gapIsJumpable(gapAhead(eight, 6, 0)), true);
  assert.equal(gapIsJumpable(gapAhead(twelve, 6, 0)), false);
});

test('the parcel goes out for a hole the bombs made, and not for one that shipped', () => {
  const rows = FLOOR(40);
  const pristine = grid(rows);
  const cratered = grid(bomb(rows, 12, 12));

  const yes = strandedBy({ current: cratered, original: pristine, tx: 6, ty: 0 });
  assert.equal(yes.parcel, true);
  assert.equal(yes.reason, 'cratered');
  assert.equal(yes.gap.start, 12);
  assert.equal(yes.gap.land, 24);

  // The same map, but the level always looked like that: the pilot did nothing
  // and gets none of the blame.
  const always = strandedBy({ current: cratered, original: cratered, tx: 6, ty: 0 });
  assert.equal(always.parcel, false);
  assert.equal(always.reason, 'always-unjumpable');
});

test('a hole the bombs widened but left jumpable pays nothing', () => {
  const rows = ['#'.repeat(12) + '  ' + '#'.repeat(26)];
  const pristine = grid(rows);
  const wider = grid(bomb(rows, 12, 6));
  const out = strandedBy({ current: wider, original: pristine, tx: 6, ty: 0 });
  assert.equal(out.parcel, false);
  assert.equal(out.reason, 'jumpable');
});

test('a hole that runs off the end of the map has no far side and is not a jump', () => {
  const rows = FLOOR(30);
  const g = grid(bomb(rows, 20, 10));
  const gap = gapAhead(g, 14, 0);
  assert.equal(gap.land, null);
  assert.equal(gap.width, Infinity);
  assert.equal(gapIsJumpable(gap), false);
});

test('nothing fires while he is safely elsewhere on the map', () => {
  const rows = FLOOR(80);
  const cratered = grid(bomb(rows, 60, 12));
  const pristine = grid(rows);
  const far = strandedBy({ current: cratered, original: pristine, tx: 6, ty: 0 });
  assert.equal(far.parcel, false, 'the chasm is fifty tiles away; he is not approaching it');
  assert.equal(far.reason, 'no-gap');

  const near = strandedBy({ current: cratered, original: pristine, tx: 60 - APPROACH_TILES, ty: 0 });
  assert.equal(near.parcel, true, 'and at APPROACH_TILES away he is');
});

test('the shelf he is left standing on counts: same hole, no run-up, no jump', () => {
  // Eight tiles of ground, a hole, and the ground behind him blown away as
  // well, so he cannot back up and take a run at it.
  const wide = grid(['#'.repeat(20) + ' '.repeat(7) + '#'.repeat(20)]);
  const shelf = grid([' '.repeat(19) + '#' + ' '.repeat(7) + '#'.repeat(20)]);
  assert.equal(gapIsJumpable(gapAhead(wide, 14, 0)), true, 'with a runway it is a jump');
  assert.equal(gapIsJumpable(gapAhead(shelf, 19, 0)), false, 'off one tile it is not');
});

test('a lower far side is reachable where a level one would not be', () => {
  // The same nine-tile hole twice. Landing two rows DOWN buys him the frames he
  // spends falling them, and nine tiles is the width where that is the
  // difference between a jump and a parcel.
  const blank = ' '.repeat(40);
  const flat = grid(['#'.repeat(12) + ' '.repeat(9) + '#'.repeat(19)]);
  const stepped = grid([
    '#'.repeat(12) + ' '.repeat(9) + ' '.repeat(19),
    blank,
    ' '.repeat(12) + ' '.repeat(9) + '#'.repeat(19),
  ]);

  const level = gapAhead(flat, 6, 0);
  assert.equal(level.width, 9);
  assert.equal(gapIsJumpable(level), false, 'nine tiles on the level is past his reach');

  const down = gapAhead(stepped, 6, 0);
  assert.equal(down.width, 9);
  assert.equal(down.landTy, 2, 'the far side is two rows lower');
  assert.equal(gapIsJumpable(down), true, 'and the extra fall time carries him over');
});

test('he gets one parcel per chasm, however many bombs widen it', () => {
  const led = new GapLedger();
  assert.equal(led.paid('1-1', 12, 24), false);
  led.record('1-1', 12, 24);
  assert.equal(led.paid('1-1', 12, 24), true);
  assert.equal(led.paid('1-1', 10, 26), true, 'the same chasm, widened both ways');
  assert.equal(led.paid('1-1', 40, 50), false, 'a second chasm elsewhere is a second parcel');
  assert.equal(led.paid('1-2', 12, 24), false, 'and another level is another place');

  led.record('1-1', 10, 26);
  assert.equal(led.paid('1-1', 12, 24), true, 'widening does not split it into two debts');

  led.forget('1-1');
  assert.equal(led.paid('1-1', 12, 24), false, 'a reloaded level owes nothing');
});

test('a bottomless chasm and a finite one are the same debt to the ledger', () => {
  const led = new GapLedger();
  led.record('1-1', 30, Infinity);
  assert.equal(led.paid('1-1', 30, 40), true);
});

test('the parcel is five coins, which is five brick bombs', () => {
  assert.equal(PARCEL_COINS, 5);
});
