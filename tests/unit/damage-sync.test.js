import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DamageSync,
  foldWorldDamage,
  applyToWorld,
  applyToIsland,
} from '../../src/net/damage-sync.js';
import { hashKeys } from '../../src/wings/damage.js';
import { Island } from '../../src/wings/island.js';
import { getLevel } from '../../src/data/levels/index.js';

test('record returns only what was new, per decision D2', () => {
  const s = new DamageSync();
  assert.deepEqual(s.record('1-1', ['5,10', '6,10']).sort(), ['5,10', '6,10']);
  assert.deepEqual(s.record('1-1', ['6,10', '7,10']), ['7,10']);
  assert.deepEqual(s.record('1-1', ['6,10']), []);
});

test('malformed keys never enter the set', () => {
  const s = new DamageSync();
  assert.deepEqual(s.record('1-1', ['5,10', 'x', '', null, 7, '1 ,2']).sort(), ['5,10']);
  assert.deepEqual(s.keys('1-1'), ['5,10']);
});

test('a hostile key from the wire is rejected, not aliased onto tile 0,0', () => {
  // parseTileKey's hardening only helps if the adapter actually consults it:
  // every one of these used to coerce to a real-looking tile.
  const s = new DamageSync();
  assert.deepEqual(s.record('1-1', ['', '0', ' 3,11', '1e1,2', '0x3,2', {}, [], undefined]), []);
  assert.deepEqual(s.keys('1-1'), []);
  assert.equal(s.has('1-1', '0,0'), false);
});

test('record survives a non-array payload from the wire', () => {
  const s = new DamageSync();
  assert.deepEqual(s.record('1-1', undefined), []);
  assert.deepEqual(s.record('1-1', '5,10'), [], 'a bare string must not iterate as characters');
  assert.deepEqual(s.keys('1-1'), []);
});

test('an out-of-bounds key is recorded anyway, per decision D1', () => {
  // The set is a REPLICA OF THE SERVER'S, not a log of what this client drew.
  // A key outside this client's map still belongs in the hash.
  const s = new DamageSync();
  s.record('1-1', ['9999,9999']);
  assert.ok(s.has('1-1', '9999,9999'));
  assert.equal(s.hashes()['1-1'], hashKeys(['9999,9999']));
});

test('hashes cover every island the sync has ever heard of', () => {
  const s = new DamageSync();
  s.record('1-1', ['5,10']);
  s.record('1-2', []);
  const h = s.hashes();
  assert.deepEqual(Object.keys(h).sort(), ['1-1', '1-2']);
  assert.equal(h['1-1'], hashKeys(['5,10']));
  assert.equal(h['1-2'], hashKeys([]), 'an island bombed for zero tiles still reports');
});

test('hashes are order-independent across two independently built syncs', () => {
  const a = new DamageSync();
  const b = new DamageSync();
  a.record('1-1', ['7,10', '5,10', '6,10']);
  b.record('1-1', ['5,10']);
  b.record('1-1', ['7,10', '6,10']);
  assert.deepEqual(a.hashes(), b.hashes());
});

test('it round-trips through JSON exactly as the welcome payload does', () => {
  const s = new DamageSync();
  s.record('1-1', ['5,10', '6,10']);
  s.record('2-1', ['1,1']);
  const back = DamageSync.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
  assert.deepEqual(back.toJSON(), s.toJSON());
  assert.deepEqual(back.hashes(), s.hashes());
});

test('fromJSON tolerates a missing or empty welcome payload', () => {
  assert.deepEqual(DamageSync.fromJSON(undefined).islands(), []);
  assert.deepEqual(DamageSync.fromJSON({}).islands(), []);
});

test('foldWorldDamage lifts a level Set into the island map', () => {
  // The adapter D3 exists for: world.damage is a Set for ONE level;
  // DamageMap is a Map of island -> Set. Nothing else may know both types.
  const s = new DamageSync();
  const fakeWorld = { damage: new Set(['5,10', '6,10']) };
  assert.deepEqual(foldWorldDamage(s, '1-1', fakeWorld).sort(), ['5,10', '6,10']);
  assert.deepEqual(s.keys('1-1'), ['5,10', '6,10']);
  // Folding twice records nothing new — it is a merge, not an append.
  assert.deepEqual(foldWorldDamage(s, '1-1', fakeWorld), []);
});

test('foldWorldDamage on a world with no damage is a no-op, not a crash', () => {
  const s = new DamageSync();
  assert.deepEqual(foldWorldDamage(s, '1-1', null), []);
  assert.deepEqual(foldWorldDamage(s, '1-1', {}), []);
  assert.deepEqual(s.islands(), []);
});

test('applyToWorld replays a peer crater through the silent path, not destroyTiles', () => {
  // destroyTiles kills entities. Replaying a peer's crater must not re-kill
  // anything locally — only a LIVE detonation, which knows its centre, kills.
  const calls = [];
  const world = {
    damage: new Set(),
    applyDamage(keys) {
      calls.push(['applyDamage', keys]);
    },
    destroyTiles(keys) {
      calls.push(['destroyTiles', keys]);
      return keys;
    },
  };
  applyToWorld(world, ['5,10', '6,10']);
  assert.deepEqual(calls, [['applyDamage', ['5,10', '6,10']]]);
});

test('applyToWorld with opts.blast is loud, and falls back when replayBlast is absent', () => {
  const calls = [];
  const withReplay = {
    applyDamage: (k) => calls.push(['applyDamage', k]),
    replayBlast: (cx, cy, r, k) => calls.push(['replayBlast', cx, cy, r, k]),
  };
  applyToWorld(withReplay, ['5,10'], { blast: { cx: 8, cy: 16, radiusTiles: 2 } });
  assert.deepEqual(calls, [['replayBlast', 8, 16, 2, ['5,10']]]);

  // An engine without the hook still gets the crater, silently, rather than
  // throwing and leaving this client's tile map behind the server's set.
  const plain = { applyDamage: (k) => calls.push(['plain', k]) };
  applyToWorld(plain, ['5,10'], { blast: { cx: 8, cy: 16, radiusTiles: 2 } });
  assert.deepEqual(calls.at(-1), ['plain', ['5,10']]);
});

test('applyToWorld ignores an absent world or an empty key list', () => {
  assert.doesNotThrow(() => applyToWorld(null, ['5,10']));
  assert.doesNotThrow(() => applyToWorld({}, []));
  assert.doesNotThrow(() => applyToWorld({}, 'nope'));
});

test('the adapter never mentions destroyTiles, per decision D2', () => {
  // destroyTiles' return value is "what actually removed a tile HERE"; the
  // wire only ever carries "what was newly added to the server's set". The
  // cheapest way to keep those from ever being confused is that the one file
  // bridging the engine and the wire cannot name the wrong one.
  const src = readFileSync(new URL('../../src/net/damage-sync.js', import.meta.url), 'utf8');
  assert.ok(!/destroyTiles/.test(src.replace(/\/\/.*$/gm, '')));
});

test('applyToIsland puts the server keys into a real Island', () => {
  const isle = new Island(getLevel('1-1'), 3000);
  applyToIsland(isle, ['20,13', '21,13']);
  assert.ok(isle.destroyed.has('20,13'));
  assert.equal(isle.charAt(20, 13), '.');
  // Idempotent: the same broadcast arriving twice must change nothing.
  applyToIsland(isle, ['20,13']);
  assert.deepEqual(isle.keys(), ['20,13', '21,13']);
});

test('applyToIsland ignores an absent island or an empty key list', () => {
  assert.doesNotThrow(() => applyToIsland(null, ['20,13']));
  assert.doesNotThrow(() => applyToIsland({}, []));
});

test('an island and a sync that saw the same keys agree on the hash', () => {
  // This equality is the entire desync detector. If it can fail here it will
  // fail in a match.
  const isle = new Island(getLevel('1-1'), 3000);
  const s = new DamageSync();
  const keys = ['20,13', '21,13', '22,13'];
  applyToIsland(isle, keys);
  s.record('1-1', keys);
  assert.equal(s.hashes()['1-1'], hashKeys(isle.keys()));
});
