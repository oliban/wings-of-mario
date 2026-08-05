import test from 'node:test';
import assert from 'node:assert/strict';
import { DamageMap, destroyKeys, buildKeys, hashKeys } from '../../src/wings/damage.js';
import { DamageSync } from '../../src/net/damage-sync.js';
import { Room, HASH_GRACE_MS } from '../../src/net/room.js';
import { Island, BUILT_CHAR } from '../../src/wings/island.js';
import { drawLandmass } from '../../src/wings/art/land.js';
import { ARMOUR_EXEMPT } from '../../src/wings/art/mario-tiles.js';
import { ISLAND_TOP_Y } from '../../src/wings/geo.js';
import { TILE } from '../../src/core/constants.js';
import { watchBuilds, keepWatchingBuilds } from '../../src/wings/bricks.js';

// THE BRIDGE, on the pilot's side of the wire.
//
// Mario's toolbelt lays a row of five bricks in mid-air over a chasm
// (src/game/entities/brickbomb.js). The pilot's island is static level data
// plus key sets and has never had a concept of a tile that was ADDED. This file
// covers the whole of that: the two sets and the rule that keeps them disjoint,
// what an Island does with a built key, that the pilot DRAWS it exactly like a
// brick that shipped with the level, and the instance wrap that notices Mario
// building one in the first place.

// ---------------------------------------------------------------------------
// the two sets
// ---------------------------------------------------------------------------

const pair = () => ({ destroyed: new DamageMap(), built: new DamageMap() });

test('a brick laid in a crater leaves the destroyed set, and the reverse', () => {
  const { destroyed, built } = pair();

  destroyKeys(destroyed, built, '1-1', ['20,13']);
  assert.deepEqual(destroyed.keys('1-1'), ['20,13']);
  assert.deepEqual(built.keys('1-1'), []);

  // Bridge it.
  const b = buildKeys(destroyed, built, '1-1', ['20,13']);
  assert.deepEqual(b.built, ['20,13']);
  assert.deepEqual(b.repaired, ['20,13'], 'the crater it filled is reported back');
  assert.deepEqual(destroyed.keys('1-1'), [], 'the key is in ONE set, never both');
  assert.deepEqual(built.keys('1-1'), ['20,13']);

  // Bomb the bridge.
  const d = destroyKeys(destroyed, built, '1-1', ['20,13']);
  assert.deepEqual(d.destroyed, ['20,13']);
  assert.deepEqual(d.unbuilt, ['20,13']);
  assert.deepEqual(built.keys('1-1'), []);
  assert.deepEqual(destroyed.keys('1-1'), ['20,13']);
});

test('last action wins, which is the whole ordering rule', () => {
  // The same two actions in the two possible orders. There is no timestamp and
  // no sequence number anywhere in this: whichever ran last is the state, and
  // that is what lets a client apply broadcasts as they arrive.
  const a = pair();
  destroyKeys(a.destroyed, a.built, 'x', ['1,1']);
  buildKeys(a.destroyed, a.built, 'x', ['1,1']);
  assert.deepEqual([a.destroyed.keys('x'), a.built.keys('x')], [[], ['1,1']]);

  const b = pair();
  buildKeys(b.destroyed, b.built, 'x', ['1,1']);
  destroyKeys(b.destroyed, b.built, 'x', ['1,1']);
  assert.deepEqual([b.destroyed.keys('x'), b.built.keys('x')], [['1,1'], []]);
});

test('applying the same broadcast twice changes nothing', () => {
  // A resent build delivers the whole row again (Room#recordBuild returns the
  // authoritative set, not the newly-added one), so this happens in normal play
  // rather than only under packet loss.
  const { destroyed, built } = pair();
  buildKeys(destroyed, built, 'x', ['1,1', '2,1']);
  const again = buildKeys(destroyed, built, 'x', ['1,1', '2,1']);
  assert.deepEqual(again.built, [], 'nothing was new the second time');
  assert.deepEqual(built.keys('x'), ['1,1', '2,1']);
  assert.deepEqual(destroyed.keys('x'), []);
});

test('the two sets never overlap, whatever sequence they are put through', () => {
  const { destroyed, built } = pair();
  const keys = ['1,1', '2,2', '3,3', '4,4'];
  // A deterministic shuffle of destroys and builds over overlapping subsets.
  for (let i = 0; i < 64; i++) {
    const slice = keys.slice(i % 4, (i % 4) + 2);
    if (i % 3 === 0) destroyKeys(destroyed, built, 'x', slice);
    else buildKeys(destroyed, built, 'x', slice);
    const both = destroyed.keys('x').filter((k) => built.has('x', k));
    assert.deepEqual(both, [], `step ${i} left ${both} in both sets`);
  }
});

test('a set that lost a key and gained another is not the set it was', () => {
  // THE BUG THIS PINS: DamageSync cached one hash per island keyed on the SET'S
  // SIZE, which was only ever sound while these sets were append-only. Build
  // over a crater and bomb somewhere else and the size is back where it
  // started with a different set in it — and the stale hash goes out on the
  // wire once a second for the rest of the match, as a permanent desync on one
  // client and nothing at all on the other.
  const sync = new DamageSync();
  sync.record('1-1', ['20,13']);
  const first = sync.hash('1-1');

  sync.recordBuilt('1-1', ['20,13']);
  sync.record('1-1', ['99,9']);
  assert.equal(sync.keys('1-1').length, 1, 'same size, different set — the trap');
  assert.notEqual(sync.hash('1-1'), first, 'the cache served a hash for a set that is gone');
  assert.equal(sync.hash('1-1'), hashKeys(['99,9']));
});

test('DamageSync keeps the client\'s two sets disjoint exactly as the server does', () => {
  const sync = new DamageSync();
  sync.record('1-1', ['5,5', 'nonsense', '6,5']);
  assert.deepEqual(sync.keys('1-1'), ['5,5', '6,5'], 'a malformed key is not a tile');

  sync.recordBuilt('1-1', ['5,5']);
  assert.equal(sync.has('1-1', '5,5'), false);
  assert.equal(sync.hasBuilt('1-1', '5,5'), true);
  assert.deepEqual(sync.builtKeys('1-1'), ['5,5']);
  assert.deepEqual(sync.builtIslands(), ['1-1']);
});

// ---------------------------------------------------------------------------
// the server's copy
// ---------------------------------------------------------------------------

test('only Mario may say a brick was laid', () => {
  // Enforced in the Room and not merely at the socket. The transport checks
  // ownership too, so this is the second of two locks on the same door — and
  // the one that holds if a caller ever reaches recordBuild by another route,
  // which is exactly how a rule that is only enforced at the edge rots.
  const room = new Room('ACDE');
  const bad = room.recordBuild('pilot', '1-1', ['4,4'], 0);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /not the owner of build/);
  assert.deepEqual(room.built.keys('1-1'), [], 'a refused build must build nothing');

  const good = room.recordBuild('mario', '1-1', ['4,4'], 0);
  assert.equal(good.ok, true);
  assert.deepEqual(good.keys, ['4,4']);
});

test('the room refuses a build it cannot make sense of', () => {
  const room = new Room('ACDE');
  assert.equal(room.recordBuild('mario', '', ['1,1'], 0).ok, false, 'no island');
  assert.equal(room.recordBuild('mario', '1-1', '1,1', 0).ok, false, 'keys must be a list');
  assert.deepEqual(room.recordBuild('mario', '1-1', ['1,1', 'junk'], 0).keys, ['1,1']);
});

test('the room hands back the whole row on a resend, not the empty difference', () => {
  // The bug recordDetonate carries a comment about, in the other direction: the
  // broadcast is what settles the proposer's outbox, so answering a retry with
  // the newly-added keys settles it while delivering nothing, and the retry
  // that was meant to repair a dropped row guarantees it stays lost.
  const room = new Room('ACDE');
  room.recordBuild('mario', '1-1', ['1,1', '2,1'], 0);
  const again = room.recordBuild('mario', '1-1', ['1,1', '2,1'], 1);
  assert.deepEqual(again.added, [], 'nothing was new');
  assert.deepEqual(again.keys, ['1,1', '2,1'], 'and the whole row is still its responsibility');
});

test('the room keeps the two sets disjoint, and says which crater a row filled', () => {
  const room = new Room('ACDE');
  room.recordDetonate('pilot', '1-1', ['30,12'], 0);
  const built = room.recordBuild('mario', '1-1', ['30,12'], 1);
  assert.deepEqual(built.repaired, ['30,12']);
  assert.deepEqual(room.damage.keys('1-1'), []);
  assert.deepEqual(room.built.keys('1-1'), ['30,12']);

  const bombed = room.recordDetonate('pilot', '1-1', ['30,12'], 2);
  assert.deepEqual(bombed.added, ['30,12']);
  assert.deepEqual(room.built.keys('1-1'), [], 'the bridge is still standing on the server');
});

test('a client one broadcast behind a brick row is not accused of a desync', () => {
  // Laying a brick in a crater CHANGES THE DESTROYED SET, which is the set the
  // detector compares. Without remembering the state it just left, the client
  // still holding it for one trip down the wire looks like a client that has
  // lost a crater — and the alarm fires on every bridge anybody builds.
  const room = new Room('ACDE');
  room.recordDetonate('pilot', '1-1', ['30,12'], 0);
  const stale = room.damage.hash('1-1');
  room.recordBuild('mario', '1-1', ['30,12'], 1000);
  assert.deepEqual(room.compareHashes({ '1-1': stale }, 1200), [], 'accused of being one behind');
  // And still caught once that grace has run out.
  const late = room.compareHashes({ '1-1': stale }, 1000 + HASH_GRACE_MS + 1);
  assert.equal(late.length, 1, 'a genuinely stale client is never caught');
});

test('the match state a joiner is given carries both sets', () => {
  const room = new Room('ACDE');
  room.recordDetonate('pilot', '1-1', ['30,12'], 0);
  room.recordBuild('mario', '1-1', ['31,12'], 1);
  const state = room.matchState();
  assert.deepEqual(state.damage['1-1'], ['30,12']);
  assert.deepEqual(state.built['1-1'], ['31,12']);
});

// ---------------------------------------------------------------------------
// the island
// ---------------------------------------------------------------------------

// A level with a hole in it, well clear of the spawn so the sanctuary is not
// what any of this is measuring.
const LEVEL = () => ({
  id: 't-1',
  theme: 'overworld',
  width: 20,
  height: 4,
  spawn: { x: 0, y: 3 },
  tiles: [
    '....................',
    '....................',
    '....................',
    '##########..########',
  ],
});

const ORIGIN = 3000;
const isleWith = (built = []) => {
  const isle = new Island(LEVEL(), ORIGIN);
  isle.applyBuild(built);
  return isle;
};

test('a built key reports as a brick and is therefore drawn, hit and bombed', () => {
  const isle = isleWith(['11,2']);
  assert.equal(isle.charAt(11, 2), BUILT_CHAR, 'the pilot must see a brick');
  assert.equal(isle.charAt(12, 2), '.', 'and only where one was laid');
  assert.equal(isle.blocksTile(11, 2), true, 'the aeroplane flies into it');
  assert.equal(isle.destructibleTile(11, 2), true, 'and his bombs take it');
});

test('a bomb takes a built brick, and the key changes sides', () => {
  const isle = isleWith(['11,2']);
  const changed = isle.blast(ORIGIN + 11 * TILE + 8, ISLAND_TOP_Y + 2 * TILE + 8, 0.5);
  assert.ok(changed.includes('11,2'), 'the bridge survived a direct hit');
  assert.equal(isle.charAt(11, 2), '.');
  assert.deepEqual(isle.builtKeys(), [], 'a destroyed brick is not still built');
  assert.ok(isle.keys().includes('11,2'));
});

test('an island rebuilt from the match state does not care which set it is given first', () => {
  // Both orders, same two key lists, same island in the end — which is what the
  // welcome and the archipelago rebuild both depend on.
  const a = new Island(LEVEL(), ORIGIN);
  a.applyDamage(['5,3']);
  a.applyBuild(['5,3', '11,2']);

  const b = new Island(LEVEL(), ORIGIN);
  b.applyBuild(['5,3', '11,2']);
  b.applyDamage(['5,3']);

  assert.equal(a.charAt(5, 3), BUILT_CHAR, 'built last: a brick');
  assert.equal(b.charAt(5, 3), '.', 'destroyed last: a hole');
  assert.equal(a.charAt(11, 2), BUILT_CHAR);
  assert.equal(b.charAt(11, 2), BUILT_CHAR);
  // Whichever way round, the key is in exactly one set on both.
  for (const isle of [a, b]) {
    assert.equal(isle.keys().filter((k) => isle.built.has(k)).length, 0);
  }
});

test('a brick outside the map is not a brick anywhere', () => {
  const isle = isleWith(['99,99', 'rubbish', '-1,2']);
  assert.deepEqual(isle.builtKeys(), []);
  assert.equal(isle.charAt(99, 99), '.');
});

// ---------------------------------------------------------------------------
// what the pilot actually sees
// ---------------------------------------------------------------------------

// A canvas that records rather than paints, as in island-tiles.test.js. Every
// call in order, so two frames can be compared as strings.
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

const paint = (isle) => {
  const ctx = recorder();
  drawLandmass(ctx, isle, { x: ORIGIN, y: ISLAND_TOP_Y }, 320, 240, 0, 560, 1.15);
  return ctx.ops;
};

test('a built brick is painted exactly like a brick the level shipped with', () => {
  // The strongest statement available without a screenshot, and the one that
  // makes the feature true rather than merely wired: the pilot's renderer is
  // handed no new concept at all. Everything follows from charAt.
  const built = isleWith(['11,2']);

  const authored = LEVEL();
  authored.tiles[2] = `${authored.tiles[2].slice(0, 11)}=${authored.tiles[2].slice(12)}`;
  const shipped = new Island(authored, ORIGIN);

  const empty = paint(isleWith([]));
  const drawn = paint(built);
  assert.notDeepEqual(drawn, empty, 'nothing was drawn for the brick at all');
  assert.deepEqual(drawn, paint(shipped));
});

test('a built brick is not washed as armour, because a bomb will take it', () => {
  // The wash means "no bomb will take this ground". Painting it over a bridge
  // would be a lie told to the one player whose whole job is choosing what to
  // bomb. Keyed off the island's own destructibleTile, so this is really a test
  // that a built brick answers that predicate honestly.
  const isle = isleWith(['11,2']);
  assert.equal(ARMOUR_EXEMPT.has(BUILT_CHAR), false, 'a brick is not armour-exempt art');
  assert.equal(isle.destructibleTile(11, 2), true);
  // And the drawn frame agrees: identical to the authored-brick frame above,
  // which contains no wash for that tile either.
  const ops = paint(isle);
  const washAt = (tx) => ops.filter((op, i) => op.startsWith(`fillRect(${(tx * TILE).toFixed(3)},`)
    && String(ops[i - 1]).startsWith('fillStyle=rgba'));
  // The positive control, in the very same frame: this level spawns Mario at
  // column 0, so the ground there IS inside the sanctuary and IS washed. Without
  // this the filter below could be looking for something that never appears
  // anywhere and would pass with the wash painted over everything.
  assert.ok(washAt(0).length > 0, 'no wash found anywhere, so this proves nothing');
  assert.deepEqual(washAt(11), [], 'the bridge was painted as indestructible');
});

// ---------------------------------------------------------------------------
// noticing the build, without editing the engine
// ---------------------------------------------------------------------------

// A stand-in for the engine's World: a tile map and the two methods the wrap
// touches. `solid` is the engine's own record, which is what the watcher reads
// rather than judging the character itself.
function fakeWorld(rows) {
  const map = rows.map((r) => [...r]);
  return {
    w: map[0].length,
    h: map.length,
    recAt(tx, ty) {
      const ch = map[ty] && map[ty][tx];
      return { name: ch === '.' ? 'air' : 'block', solid: ch != null && ch !== '.' };
    },
    setTile(tx, ty, ch) {
      if (!map[ty] || tx < 0 || tx >= map[0].length) return false;
      map[ty][tx] = ch;
      return true;
    },
    read: (tx, ty) => map[ty][tx],
  };
}

test('a tile turning solid is a build; everything else the engine does is not', () => {
  const world = fakeWorld(['..?.', '####']);
  const seen = [];
  assert.equal(watchBuilds(world, (key) => seen.push(key)), true);

  world.setTile(0, 0, '=');
  assert.deepEqual(seen, ['0,0'], 'the brick bomb lays a brick over air');

  // The other three things the engine writes with setTile, none of which is a
  // build. See the table in src/wings/bricks.js.
  world.setTile(2, 0, 'U'); // a spent question block: solid before, solid after
  world.setTile(0, 1, '.'); // a shattered brick: solid before, air after
  world.setTile(3, 0, '.'); // air over air
  assert.deepEqual(seen, ['0,0'], `these are not builds: ${seen}`);
});

test('the wrap passes the write through and refuses to invent one', () => {
  const world = fakeWorld(['....']);
  const seen = [];
  watchBuilds(world, (key) => seen.push(key));
  world.setTile(1, 0, '=');
  assert.equal(world.read(1, 0), '=', 'the tile was not actually written');
  // Off the map: setTile refuses, so nothing turned solid and nothing is news.
  world.setTile(99, 0, '=');
  assert.deepEqual(seen, ['1,0']);
});

test('installing twice does not report every brick twice', () => {
  // The caller runs this every frame — the world may only now exist, and a
  // reconnect re-points it. Two wrappers stacked would double every row.
  const world = fakeWorld(['....']);
  const first = [];
  const second = [];
  keepWatchingBuilds(world, (k) => first.push(k));
  keepWatchingBuilds(world, (k) => second.push(k));
  world.setTile(2, 0, '=');
  assert.deepEqual(second, ['2,0'], 'the latest callback is the one that hears');
  assert.deepEqual(first, [], 'and the old one is replaced, not stacked');
});

test('a world without the methods is left alone rather than half-wrapped', () => {
  assert.equal(watchBuilds(null, () => {}), false);
  assert.equal(watchBuilds({}, () => {}), false);
  assert.equal(keepWatchingBuilds({ setTile() {} }, () => {}), false);
});
