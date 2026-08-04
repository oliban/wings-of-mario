import test from 'node:test';
import assert from 'node:assert/strict';
import { DamageMap, hashKeys } from '../../src/wings/damage.js';

test('add returns only newly destroyed tiles', () => {
  const d = new DamageMap();
  assert.deepEqual(d.add('1-1', ['5,10', '6,10']).sort(), ['5,10', '6,10']);
  assert.deepEqual(d.add('1-1', ['6,10', '7,10']), ['7,10']);
  assert.deepEqual(d.add('1-1', ['6,10']), []);
});

test('islands are independent', () => {
  const d = new DamageMap();
  d.add('1-1', ['5,10']);
  assert.ok(d.has('1-1', '5,10'));
  assert.ok(!d.has('1-2', '5,10'));
  assert.deepEqual(d.keys('1-2'), []);
});

test('keys come back sorted regardless of insertion order', () => {
  const d = new DamageMap();
  d.add('1-1', ['9,3', '1,2', '4,7']);
  assert.deepEqual(d.keys('1-1'), ['1,2', '4,7', '9,3']);
});

test('round-trips through JSON', () => {
  const d = new DamageMap();
  d.add('1-1', ['5,10', '6,10']);
  d.add('1-4', ['2,2']);
  const back = DamageMap.fromJSON(JSON.parse(JSON.stringify(d.toJSON())));
  assert.deepEqual(back.toJSON(), d.toJSON());
  assert.ok(back.has('1-4', '2,2'));
});

test('hash is order-independent and change-sensitive', () => {
  const a = new DamageMap();
  const b = new DamageMap();
  a.add('1-1', ['5,10', '6,10', '7,10']);
  b.add('1-1', ['7,10', '5,10', '6,10']);
  assert.equal(a.hash('1-1'), b.hash('1-1'));

  b.add('1-1', ['8,10']);
  assert.notEqual(a.hash('1-1'), b.hash('1-1'));
});

test('hashKeys distinguishes tile sets that share characters', () => {
  // '1,23' and '12,3' must not collide — the separator has to matter.
  assert.notEqual(hashKeys(['1,23']), hashKeys(['12,3']));
});

test('an empty island hashes consistently', () => {
  const d = new DamageMap();
  assert.equal(d.hash('nowhere'), hashKeys([]));
});

test('the separator disambiguates element boundaries', () => {
  // Without a separator byte both of these feed FNV the identical character
  // stream "1,23", so the hash could not tell one destroyed tile from two.
  assert.notEqual(hashKeys(['1,2', '3']), hashKeys(['1,23']));
  assert.notEqual(hashKeys(['1', '2,3']), hashKeys(['12,3']));
});

test('hashKeys matches a pinned digest for a known input', () => {
  // Every other hash assertion in this file compares two locally-computed
  // hashes, so all of them would still pass if the FNV constants or the
  // 0x1f separator changed underneath us — a silent wire-format break for
  // the networking plan, which needs two independently-run copies of this
  // file to agree. This one is computed once against the implementation
  // and hardcoded, so it actually pins the algorithm.
  assert.equal(hashKeys(['5,10', '6,10', '7,10']), '20aaf8f9');
  assert.equal(hashKeys([]), '811c9dc5');
});

test('toJSON does not lose an island named __proto__', () => {
  const d = new DamageMap();
  d.add('__proto__', ['5,10']);
  const out = d.toJSON();
  assert.deepEqual(out.__proto__, ['5,10']);
  assert.deepEqual(Object.keys(out), ['__proto__']);
});

test('add rejects a string instead of iterating its characters', () => {
  const d = new DamageMap();
  assert.deepEqual(d.add('1-1', '56'), []);
  assert.deepEqual(d.keys('1-1'), []);
});

test('add rejects other non-array input without throwing', () => {
  const d = new DamageMap();
  assert.deepEqual(d.add('1-1', null), []);
  assert.deepEqual(d.add('1-1', undefined), []);
  assert.deepEqual(d.add('1-1', 5), []);
  assert.deepEqual(d.keys('1-1'), []);
});
