import test from 'node:test';
import assert from 'node:assert/strict';
import { Parcel, currentGrid, originalGrid, CHECK_INTERVAL_TICKS } from '../../src/wings/parcel.js';
import { PARCEL_COINS } from '../../src/wings/stranded.js';
import { FALL_TICKS, FALL_HEIGHT_PX, SIDE_TILES, PHASE } from '../../src/wings/supply-drop.js';
import { TILE } from '../../src/core/constants.js';

// The half of the parcel that knows what a World is. The rule it applies is
// tested in stranded.test.js; what is tested here is the wiring — that it reads
// the LIVE map against the level's ORIGINAL one, that it only looks at a man
// who is standing still on the ground in the level proper, that what it hands
// over is five coins and the toolbelt in a wallet that can spend them, and that
// it hands them over exactly once per chasm.

// A stand-in for the engine's World, in the same spirit as the one in
// out-of-reach.test.js. Only the members src/wings/parcel.js actually touches.
// `rows` is the pristine level; `gone` is the set of tile keys the bombs have
// taken out of it, which is exactly the relationship world.damage has with
// world.rootLevel in the real thing.
function fakeWorld(rows, opts = {}) {
  const gone = new Set(opts.gone || []);
  const w = rows[0].length;
  const h = rows.length;
  const shipped = (tx, ty) => rows[ty] != null && rows[ty][tx] === '#';
  const world = {
    w,
    h,
    tick: 0,
    state: 'playing',
    areaId: null,
    coins: 0,
    harryMode: false,
    level: { id: opts.id || '1-1' },
    rootLevel: { id: opts.id || '1-1', width: w, height: h, tiles: rows },
    damage: gone,
    sounds: [],
    spawned: [],
    player: {
      x: (opts.tx == null ? 6 : opts.tx) * TILE,
      y: (opts.ty == null ? 0 : opts.ty) * TILE - 16,
      w: 12,
      h: 16,
      grounded: true,
      state: 'normal',
      power: 'small',
      powerUp(kind) {
        this.power = kind;
        return true;
      },
    },
    solidAt(px, py) {
      const tx = Math.floor(px / TILE);
      const ty = Math.floor(py / TILE);
      return shipped(tx, ty) && !gone.has(`${tx},${ty}`);
    },
    addCoin(n) {
      this.coins += n;
    },
    sfx(name) {
      this.sounds.push(name);
    },
    spawn(type, x, y, o) {
      this.spawned.push({ type, x, y, ...o });
      return {};
    },
  };
  return world;
}

// Anything that is not air is a floor. The real caller hands in tileForChar
// from src/data/tiles.js.
const SOLID_CHAR = (ch) => ch === '#';

const parcelFor = (world) => new Parcel({ solidChar: SOLID_CHAR });

// Run n engine ticks past it. The step only scans on the interval, so anything
// shorter than one interval proves nothing — and since the goods now arrive on
// a CRATE that takes FALL_TICKS to come down, the default has to outlast the
// fall as well or every delivery assertion below would be reading the state
// half a second before it happens.
function run(p, world, n = CHECK_INTERVAL_TICKS * 3 + FALL_TICKS) {
  let last = null;
  for (let i = 0; i < n; i++) {
    const out = p.step(world);
    if (out) last = out;
    world.tick++;
  }
  return last;
}

const FLAT = ['#'.repeat(60)];
const cratered = (from, n) => {
  const keys = [];
  for (let tx = from; tx < from + n; tx++) keys.push(`${tx},0`);
  return keys;
};

test('the live map is what the bombs left, the original is what shipped', () => {
  const world = fakeWorld(FLAT, { gone: cratered(20, 12) });
  const now = currentGrid(world);
  const was = originalGrid(world.rootLevel, SOLID_CHAR);
  assert.equal(now.solid(20, 0), false, 'a bombed tile is a hole today');
  assert.equal(was.solid(20, 0), true, 'and was ground when the level shipped');
  assert.equal(now.w, was.w);
});

test('a chasm the bombs dug hands over five coins and the toolbelt', () => {
  const world = fakeWorld(FLAT, { gone: cratered(20, 12), tx: 14 });
  const p = parcelFor(world);
  const out = run(p, world);

  assert.equal(out.parcel, true);
  assert.equal(out.reason, 'cratered');
  assert.equal(p.given, 1);
  assert.equal(world.player.power, 'toolbelt', 'he is not wearing the belt');
  assert.equal(world.coins, PARCEL_COINS);
  assert.equal(world.harryMode, true, 'the coins have to be a wallet to be worth anything');
});

test('a hole the level shipped with hands over nothing', () => {
  // The same map, but nothing was ever destroyed: the level was authored with
  // the chasm in it and the pilot has done nothing to earn the blame.
  const rows = ['#'.repeat(20) + ' '.repeat(12) + '#'.repeat(28)];
  const world = fakeWorld(rows, { tx: 14 });
  const p = parcelFor(world);
  run(p, world);
  assert.equal(p.given, 0);
  assert.equal(p.last.reason, 'always-unjumpable');
  assert.equal(world.player.power, 'small');
  assert.equal(world.coins, 0);
});

test('one parcel per chasm, however many more bombs land in it', () => {
  const world = fakeWorld(FLAT, { gone: cratered(20, 12), tx: 14 });
  const p = parcelFor(world);
  run(p, world);
  assert.equal(p.given, 1);

  for (const k of cratered(32, 8)) world.damage.add(k);
  run(p, world);
  assert.equal(p.given, 1, 'widening the same chasm bought a second parcel');
});

test('a second chasm somewhere else is a second parcel', () => {
  const world = fakeWorld(['#'.repeat(140)], { gone: cratered(20, 12), tx: 14 });
  const p = parcelFor(world);
  run(p, world);

  for (const k of cratered(100, 12)) world.damage.add(k);
  world.player.x = 92 * TILE;
  run(p, world);
  assert.equal(p.given, 2);
});

test('a level rebuilt underneath him owes him a fresh parcel', () => {
  const world = fakeWorld(FLAT, { gone: cratered(20, 12), tx: 14 });
  const p = parcelFor(world);
  run(p, world);
  assert.equal(p.given, 1);

  // What World.loadLevel does: the tick counter goes back to zero and the
  // retained craters are re-applied. He has lost the belt with the life.
  world.tick = 0;
  world.player.power = 'small';
  run(p, world);
  assert.equal(p.given, 2, 'he walked up to the same chasm again with nothing');
});

test('nothing is decided about a man who is not standing on the level', () => {
  const cases = {
    'in mid-air': (w) => { w.player.grounded = false; },
    'down a pipe': (w) => { w.areaId = '1-1b'; },
    'dying': (w) => { w.player.state = 'dying'; },
    'at the flagpole': (w) => { w.state = 'levelend'; },
  };
  for (const [what, set] of Object.entries(cases)) {
    const world = fakeWorld(FLAT, { gone: cratered(20, 12), tx: 14 });
    set(world);
    const p = parcelFor(world);
    run(p, world);
    assert.equal(p.given, 0, `a parcel went out to a man ${what}`);
  }
});

// ---------------------------------------------------------------------------
// the crate
// ---------------------------------------------------------------------------

test('the goods arrive when the CRATE does, not when the chasm is noticed', () => {
  // The user's complaint was that the parcel was invisible: it was handed over
  // in the same frame it was decided, with nothing on screen at all. Now there
  // is a crate in the air for about a second first, and the wallet is untouched
  // until it is down.
  const world = fakeWorld(FLAT, { gone: cratered(20, 12), tx: 14 });
  const p = parcelFor(world);

  run(p, world, CHECK_INTERVAL_TICKS + 1);
  const flying = p.drop.state();
  assert.ok(flying, 'nothing was sent');
  assert.equal(flying.phase, PHASE.FALL);
  assert.equal(p.given, 0, 'the goods were handed over before the crate landed');
  assert.equal(world.coins, 0);
  assert.equal(world.player.power, 'small');

  // Mid-flight it is somewhere between the sky and the ground.
  run(p, world, FALL_TICKS / 2);
  const half = p.drop.state();
  assert.ok(half.y > flying.y, 'the crate is not coming down');
  assert.ok(half.y < world.player.y, 'it is already at ground level half way through');
  assert.equal(p.given, 0);

  run(p, world, FALL_TICKS);
  assert.equal(p.given, 1, 'the crate landed and nothing was handed over');
  assert.equal(world.coins, PARCEL_COINS);
  assert.equal(world.player.power, 'toolbelt');
});

test('it comes down BESIDE him, which is the whole of the bug', () => {
  const world = fakeWorld(FLAT, { gone: cratered(20, 12), tx: 14 });
  const p = parcelFor(world);
  run(p, world, CHECK_INTERVAL_TICKS + 1);

  const s = p.drop.state();
  const marioX = world.player.x + world.player.w / 2;
  assert.ok(s.x < marioX, 'the crate is on the chasm side of him');
  assert.equal(p.drop.landX, (14 - SIDE_TILES) * TILE + TILE / 2);
  // It began a full screen above where it will land — off the top of the view,
  // rather than appearing in mid-air beside him.
  assert.equal(p.drop.landY - FALL_HEIGHT_PX, -FALL_HEIGHT_PX);
  assert.ok(s.y < p.drop.landY - 150, `only ${p.drop.landY - s.y}px up after 11 ticks`);
  // Never over the chasm, which starts at column 20.
  assert.ok(p.drop.landX < 20 * TILE, 'the crate was dropped towards the hole');
});

test('the crate is drawn for a while after it lands, then it is gone', () => {
  const world = fakeWorld(FLAT, { gone: cratered(20, 12), tx: 14 });
  const p = parcelFor(world);
  run(p, world);
  assert.equal(p.given, 1);
  assert.ok(p.drop.state(), 'the crate vanished the instant it delivered');
  run(p, world, 200);
  assert.equal(p.drop.state(), null, 'the crate is still lying there');
});

test('a crate in the air when the level is rebuilt is abandoned, and owed again', () => {
  const world = fakeWorld(FLAT, { gone: cratered(20, 12), tx: 14 });
  const p = parcelFor(world);
  run(p, world, CHECK_INTERVAL_TICKS * 2);
  const inFlight = p.drop.state();
  assert.ok(inFlight && inFlight.t > 5, 'nothing was well into a fall to abandon');

  // What World.loadLevel does — he died, and the crate was still falling. The
  // level under it is not the level it was sent to, so it is thrown away; what
  // is in the air a tick later can only be a fresh one, because he is standing
  // at the same chasm and it has just been decided again.
  world.tick = 0;
  run(p, world, 1);
  const after = p.drop.state();
  assert.ok(!after || after.t <= 1, 'a crate went on falling into a level that was rebuilt');
  assert.equal(p.given, 0, 'the abandoned crate delivered anyway');

  // And he is owed it: the chasm is decided again from scratch rather than
  // staying marked paid for a parcel that never came.
  run(p, world);
  assert.equal(p.given, 1, 'the parcel was marked paid and never delivered');
});

test('a man who goes down a pipe mid-flight loses the crate but not the parcel', () => {
  const world = fakeWorld(FLAT, { gone: cratered(20, 12), tx: 14 });
  const p = parcelFor(world);
  run(p, world, CHECK_INTERVAL_TICKS + 1);
  assert.ok(p.drop.state());

  world.areaId = '1-1b';
  run(p, world, 4);
  assert.equal(p.drop.state(), null, 'the crate landed in a coin room');
  assert.equal(p.given, 0);

  world.areaId = null;
  run(p, world);
  assert.equal(p.given, 1, 'he came back up owed a parcel that never came');
});

test('a trip down a pipe with nothing in the air does not buy a second parcel', () => {
  // Abandoning clears the ledger, so it must only happen when there really was
  // a crate to lose — otherwise every visit to a coin room pays out again for a
  // chasm already answered.
  const world = fakeWorld(FLAT, { gone: cratered(20, 12), tx: 14 });
  const p = parcelFor(world);
  run(p, world, 300);
  assert.equal(p.given, 1);

  world.areaId = '1-1b';
  run(p, world, 30);
  world.areaId = null;
  run(p, world, 300);
  assert.equal(p.given, 1, 'a trip down a pipe bought him a second parcel');
});

test('the scan runs on the engine\'s tick and not on every call', () => {
  const world = fakeWorld(FLAT, { gone: cratered(20, 12), tx: 14 });
  const p = parcelFor(world);
  let scans = 0;
  world.tick = 1;
  for (let i = 0; i < CHECK_INTERVAL_TICKS; i++) {
    p.last = null;
    p.step(world);
    if (p.last) scans++;
    world.tick++;
  }
  assert.equal(scans, 1, 'the map was scanned more than once per interval');
});
