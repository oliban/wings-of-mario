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
