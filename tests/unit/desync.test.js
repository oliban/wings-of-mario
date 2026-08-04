import test from 'node:test';
import assert from 'node:assert/strict';
import { noteDesync, describeDesync, firstForIsland } from '../../src/net/desync.js';

// console.error, captured. The point of the alarm is that it is loud, so what
// it says is worth asserting on.
function loud(fn) {
  const real = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(' '));
  try {
    fn();
  } finally {
    console.error = real;
  }
  return lines;
}

const msg = {
  island: '1-1',
  server: 'aaaaaaaa',
  client: 'bbbbbbbb',
  n: 3,
  sample: ['5,10', '6,10', '7,10'],
};

test('a desync says which island, both hashes, both counts and both samples', () => {
  const list = [];
  const lines = loud(() => noteDesync(list, msg, { keys: ['5,10'], tick: 900 }));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[DESYNC\]/);
  assert.match(lines[0], /island 1-1/);
  assert.match(lines[0], /aaaaaaaa \(3 keys\)/);
  assert.match(lines[0], /bbbbbbbb \(1 keys\)/);
  assert.match(lines[0], /server sample: 5,10 6,10 7,10/);
  assert.match(lines[0], /mine: 5,10/);
  assert.equal(list[0].at, 900, 'when it happened, in this side own ticks');
  assert.equal(list[0].mine, 1);
});

test('an island is shouted about once, however many times it is reported', () => {
  const list = [];
  const lines = loud(() => {
    for (let i = 0; i < 100; i++) noteDesync(list, msg, { keys: [] });
  });
  assert.equal(lines.length, 1, 'once a second forever would bury the console');
  assert.equal(list.length, 100, 'but every report is still recorded');
});

test('a second island is its own alarm', () => {
  const list = [];
  const lines = loud(() => {
    noteDesync(list, msg, {});
    noteDesync(list, { ...msg, island: '1-2' }, {});
    noteDesync(list, msg, {});
  });
  assert.equal(lines.length, 2);
  assert.match(lines[1], /island 1-2/);
  assert.equal(firstForIsland(list, '4-2'), true);
});

test('an island the client never mentioned reads as such rather than as undefined', () => {
  const line = describeDesync({ island: '1-2', server: 'aaaaaaaa', client: null, n: 4, sample: [] }, []);
  assert.match(line, /never mentioned it/);
  assert.match(line, /server sample: \(none\)/);
});

test('the banner is raised once, and only when there is a document to raise it on', () => {
  const list = [];
  const banners = [];
  const doc = {
    getElementById: () => null,
    createElement: () => ({ style: {}, appendChild() {} }),
    body: { appendChild() {} },
  };
  Object.defineProperty(doc, 'setter', { value: null });
  loud(() => {
    // No document: must not throw, which is the case in Node and in tests.
    noteDesync(list, msg, { keys: [] });
    assert.doesNotThrow(() => noteDesync(list, { ...msg, island: '2-1' }, { keys: [], doc }));
  });
  assert.equal(banners.length, 0);
});
