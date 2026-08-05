import test from 'node:test';
import assert from 'node:assert/strict';

import {
  warpPipeKeys, protectedKeys, isProtected, filterProtected, filterProtectedForIsland,
} from '../../src/wings/sanctuary.js';
import { getLevel } from '../../src/data/levels/index.js';
import { tileKey } from '../../src/wings/blast.js';
import { tileForChar } from '../../src/data/tiles.js';

// A PIPE INTO A WARP ZONE IS THE ONE PIPE NO BOMB TAKES.
//
// Craters are permanent, so blowing its mouth off deletes the only route in the
// game that skips whole worlds, for the rest of the match, with nothing Mario
// can do about it. Every OTHER pipe stays bombable, including the ones that go
// somewhere: a coin room and one of Harry's levels cost him a detour and some
// coins, which is exactly the damage the pilot is meant to be able to do.
//
// The distinction is the point of this file. 1-1 has three pipes that warp and
// only one of them is a warp zone.

const pipeAt = (level, tx, ty) => {
  const ch = (level.tiles[ty] || '')[tx];
  const t = ch && tileForChar(ch);
  return !!(t && t.pipe);
};

const eachLevel = (fn) => {
  for (let w = 1; w <= 8; w++) {
    for (let l = 1; l <= 4; l++) {
      const level = getLevel(`${w}-${l}`);
      if (level) fn(level, `${w}-${l}`);
    }
  }
};

test('exactly the warp zones of the shipped game are protected, and nothing else', () => {
  // The three warp zones SMB actually has: 1-1's single pipe, the three at the
  // end of 1-2, and 4-2's pipe to world 8. If a level regeneration moves them
  // this still holds — the rule reads the level data — but if it ever protects
  // a fourth level's pipes, that is a real change and worth failing over.
  const found = [];
  eachLevel((level, id) => {
    if (warpPipeKeys(level).size) found.push(id);
  });
  assert.deepEqual(found, ['1-1', '1-2', '4-2']);
});

test('1-1 protects the warp zone pipe and neither of the other two', () => {
  const level = getLevel('1-1');
  const keys = warpPipeKeys(level);
  // 1-1's three destinations: 1-1b is a coin room, 1-1h is Harry's painted
  // level, 1-1w is the warp zone with a way to all thirty-two levels.
  const zone = level.warps.find((w) => w.to.area === '1-1w');
  const coins = level.warps.find((w) => w.to.area === '1-1b');
  const harry = level.warps.find((w) => w.to.area === '1-1h');
  assert.ok(zone && coins && harry, '1-1 no longer has the three areas this pins');

  assert.ok(keys.has(tileKey(zone.from.x, zone.from.y)), 'the warp zone pipe is bombable');
  assert.ok(!keys.has(tileKey(coins.from.x, coins.from.y)), 'the coin room pipe was protected');
  assert.ok(!keys.has(tileKey(harry.from.x, harry.from.y)), "Harry's pipe was protected");
  // One pipe, two columns, two courses.
  assert.equal(keys.size, 4);
});

test('a pipe that warps straight to another level is a warp zone in itself', () => {
  // 1-2's three at the end go directly to 2-1, 3-1 and 4-1. There is no area to
  // look inside, and they are the most warp-zone thing in the game.
  const level = getLevel('1-2');
  const keys = warpPipeKeys(level);
  for (const warp of level.warps) {
    const key = tileKey(warp.from.x, warp.from.y);
    if (warp.to.level) assert.ok(keys.has(key), `the pipe to ${warp.to.level} is bombable`);
    else assert.ok(!keys.has(key), `the pipe to ${warp.to.area} was protected`);
  }
});

test('the whole pipe is protected, not only the tile the warp names', () => {
  // Taking any course off would be as final as taking the mouth.
  const level = getLevel('1-2');
  const keys = warpPipeKeys(level);
  for (const warp of level.warps) {
    if (!warp.to.level) continue;
    const tx = Math.floor(warp.from.x);
    let n = 0;
    for (let y = Math.floor(warp.from.y); pipeAt(level, tx, y); y++) {
      assert.ok(keys.has(tileKey(tx, y)), `${tx},${y} of a warp zone pipe is bombable`);
      n++;
    }
    assert.ok(n >= 2, `the pipe at ${tx} is only ${n} tall; this asserts nothing`);
  }
});

test('every other pipe in the game is still bombable', () => {
  // THE HALF THAT KEEPS THIS HONEST. Most pipes are scenery, several are doors
  // to coin rooms, and all of them stay destructible.
  let plain = 0;
  eachLevel((level, id) => {
    const zone = warpPipeKeys(level);
    for (let ty = 0; ty < level.tiles.length; ty++) {
      for (let tx = 0; tx < level.width; tx++) {
        if (!pipeAt(level, tx, ty) || zone.has(tileKey(tx, ty))) continue;
        // Only the spawn sanctuary could still protect it, and no shipped
        // level puts a pipe inside one.
        assert.equal(isProtected(level, tx, ty), false, `${id}: pipe ${tx},${ty} is indestructible`);
        plain++;
      }
    }
  });
  assert.ok(plain > 50, `only ${plain} bombable pipes in the whole game — that cannot be right`);
});

test('the protection reaches the two clients and the server as one set', () => {
  // All three read protectedKeys, so a warp zone pipe cannot come apart between
  // them — the failure the sanctuary file exists to prevent, since the desync
  // alarm compares replicas of the SERVER's set and cannot see two clients that
  // removed different tiles from their own maps.
  const level = getLevel('1-1');
  const zone = level.warps.find((w) => w.to.area === '1-1w');
  const key = tileKey(zone.from.x, zone.from.y);

  assert.ok(protectedKeys(level).has(key));
  assert.deepEqual(filterProtected(level, [key]), [], 'a client would have destroyed it');
  assert.deepEqual(filterProtectedForIsland('1-1', [key]), [], 'the server would have recorded it');
});

test('one level destination is a door, two is a warp zone', () => {
  // The threshold, stated as its own case: 1-1h warps to exactly one level and
  // is a painted sequence, not a choice of destinations.
  const tiles = ['......', '..[]..', '..{}..', '######'];
  const base = { id: 'x', width: 6, tiles, spawn: { x: 5, y: 0 } };
  const withArea = (warps) => ({
    ...base,
    warps: [{ from: { x: 2, y: 1 }, to: { area: 'a' } }],
    areas: { a: { warps } },
  });

  assert.equal(warpPipeKeys(withArea([])).size, 0, 'a dead end was protected');
  assert.equal(warpPipeKeys(withArea([{ to: { level: '2-1' } }])).size, 0, 'a door was protected');
  assert.equal(
    warpPipeKeys(withArea([{ to: { level: '2-1' } }, { to: { level: '3-1' } }])).size, 4,
    'a warp zone was left bombable'
  );
});

test('a warp that is not a pipe protects nothing, rather than guessing', () => {
  const level = {
    id: 'y',
    width: 6,
    tiles: ['######', '######'],
    spawn: { x: 5, y: 0 },
    warps: [{ from: { x: 1, y: 0 }, to: { level: '2-1' } }],
  };
  assert.equal(warpPipeKeys(level).size, 0);
  assert.equal(warpPipeKeys(null).size, 0);
  assert.equal(warpPipeKeys({ warps: [{ from: null }], tiles: [], width: 0 }).size, 0);
});
