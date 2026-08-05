import test from 'node:test';
import assert from 'node:assert/strict';

import {
  warpPipeKeys, protectedKeys, isProtected, filterProtected, filterProtectedForIsland,
} from '../../src/wings/sanctuary.js';
import { getLevel } from '../../src/data/levels/index.js';
import { tileKey } from '../../src/wings/blast.js';
import { tileForChar } from '../../src/data/tiles.js';

// A PIPE THAT GOES SOMEWHERE IS A DOOR, and no bomb takes a door.
//
// Craters are permanent, so blowing the mouth off a warp pipe deletes the route
// for the rest of the match — the underground coin room, the warp zone, the
// shortcut past five worlds. Unlike a cratered floor there is no way round it
// and nothing Mario can do about it: that is a piece of the level removed, not
// the pilot stranding him, which is a legitimate win with counterplay.
//
// The shape is found by flood fill from the warp's own `from` tile, so it comes
// out of the level data exactly rather than from a guessed rectangle.

const pipeAt = (level, tx, ty) => {
  const ch = (level.tiles[ty] || '')[tx];
  const t = ch && tileForChar(ch);
  return !!(t && t.pipe);
};

test('every warp mouth in the shipped levels is protected', () => {
  let checked = 0;
  for (let w = 1; w <= 8; w++) {
    for (let l = 1; l <= 4; l++) {
      const level = getLevel(`${w}-${l}`);
      if (!level || !Array.isArray(level.warps)) continue;
      for (const warp of level.warps) {
        const tx = Math.floor(warp.from.x);
        const ty = Math.floor(warp.from.y);
        // Only pipes: a warp can also be a door or a lip Mario walks into, and
        // there is nothing to protect on those.
        if (!pipeAt(level, tx, ty)) continue;
        checked++;
        assert.equal(
          isProtected(level, tx, ty), true,
          `${w}-${l}: the warp mouth at ${tx},${ty} is bombable`
        );
      }
    }
  }
  assert.ok(checked > 4, `only ${checked} warp pipes across all 32 levels — that cannot be right`);
});

test('the whole pipe is protected, not only the tile the warp names', () => {
  // 1-2's warp zone: three pipes side by side to worlds 2, 3 and 4. Taking any
  // course of any of them off would be as final as taking the mouth.
  const level = getLevel('1-2');
  const keys = warpPipeKeys(level);
  for (const warp of level.warps) {
    const tx = Math.floor(warp.from.x);
    const ty = Math.floor(warp.from.y);
    if (!pipeAt(level, tx, ty)) continue;
    // Walk down from the mouth: every contiguous pipe tile below it is in.
    let n = 0;
    for (let y = ty; pipeAt(level, tx, y); y++) {
      assert.ok(keys.has(tileKey(tx, y)), `${tx},${y} of the pipe at ${tx},${ty} is bombable`);
      n++;
    }
    assert.ok(n >= 2, `the pipe at ${tx},${ty} is only ${n} tall; this asserts nothing`);
  }
});

test('a decorative pipe is still bombable', () => {
  // THE OTHER HALF, and the one that keeps this from being "pipes are
  // invincible". Most pipes in the game are scenery and stay destructible;
  // 1-1 ships both kinds, which is what makes it the case worth pinning.
  const level = getLevel('1-1');
  const warpKeys = warpPipeKeys(level);
  let plain = 0;
  for (let ty = 0; ty < level.tiles.length; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      if (!pipeAt(level, tx, ty)) continue;
      if (warpKeys.has(tileKey(tx, ty))) continue;
      // Not in a warp pipe, so the only thing that could protect it is the
      // spawn sanctuary. 1-1's pipes are all well clear of the spawn.
      assert.equal(
        isProtected(level, tx, ty), false,
        `the scenery pipe tile ${tx},${ty} was made indestructible`
      );
      plain++;
    }
  }
  assert.ok(plain > 0, '1-1 has no scenery pipes; this test proves nothing');
});

test('the protection reaches the two clients and the server as one set', () => {
  // All three read protectedKeys, so a warp pipe cannot come apart between
  // them — the failure the sanctuary file exists to prevent, since the desync
  // alarm compares replicas of the SERVER's set and cannot see two clients
  // that removed different tiles from their own maps.
  const level = getLevel('1-2');
  const mouth = level.warps.find((wp) => pipeAt(level, Math.floor(wp.from.x), Math.floor(wp.from.y)));
  const key = tileKey(Math.floor(mouth.from.x), Math.floor(mouth.from.y));

  assert.ok(protectedKeys(level).has(key));
  assert.deepEqual(filterProtected(level, [key]), [], 'a client would have destroyed it');
  assert.deepEqual(filterProtectedForIsland('1-2', [key]), [], 'the server would have recorded it');
});

test('a level with no warps protects no pipes', () => {
  // The rule is data-driven, so a level that never gained a warp gains nothing
  // here either — and the sanctuary is unaffected by any of this.
  const bare = { id: 'x', width: 4, tiles: ['....', '....'], spawn: { x: 1, y: 1 } };
  assert.equal(warpPipeKeys(bare).size, 0);
  assert.equal(warpPipeKeys(null).size, 0);
  assert.equal(warpPipeKeys({ warps: [{ from: null }], tiles: [], width: 0 }).size, 0);
});

test('a warp that is not a pipe protects nothing, rather than guessing', () => {
  // 4-2's vine and any door-style warp: the mouth is not a pipe tile, so there
  // is no pipe to flood fill and the rule declines rather than protecting a
  // rectangle of whatever happened to be there.
  const level = {
    id: 'y',
    width: 6,
    tiles: ['######', '######'],
    spawn: { x: 5, y: 0 },
    warps: [{ from: { x: 1, y: 0 }, to: { level: '2-1' } }],
  };
  assert.equal(warpPipeKeys(level).size, 0);
});
