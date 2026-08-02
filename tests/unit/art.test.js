import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANE_PAL, PLANE_ANIM, PLANE_FRAMES, HOOK } from '../../src/wings/art/plane.js';
import { CARRIER_PAL, C_DECK, C_HULL, C_WATERLINE, C_TOWER } from '../../src/wings/art/carrier.js';
import {
  SEA_PAL, WAVE_ANIM, CLOUD, BOMB, ROCKET, TRACER, PUFF,
  SKY_TOP, SKY_HAZE, SEA_DEEP, SEA_SHALLOW,
} from '../../src/wings/art/ocean.js';
import { PLANE_W, PLANE_H } from '../../src/wings/geo.js';

const ALL = [
  ['PLANE_FRAMES[0]', PLANE_FRAMES[0]], ['PLANE_FRAMES[1]', PLANE_FRAMES[1]], ['HOOK', HOOK],
  ['C_DECK', C_DECK], ['C_HULL', C_HULL], ['C_WATERLINE', C_WATERLINE], ['C_TOWER', C_TOWER],
  ['WAVE[0]', WAVE_ANIM.frames[0]], ['WAVE[1]', WAVE_ANIM.frames[1]], ['WAVE[2]', WAVE_ANIM.frames[2]],
  ['CLOUD', CLOUD], ['BOMB', BOMB], ['ROCKET', ROCKET], ['TRACER', TRACER], ['PUFF', PUFF],
];

test('every sprite has rectangular rows and legal pixel chars', () => {
  for (const [name, s] of ALL) {
    assert.ok(s && s.rows && s.rows.length, `${name} has no rows`);
    for (const row of s.rows) {
      assert.equal(row.length, s.w, `${name} has a ragged row`);
      assert.match(row, /^[0-9a-f.]+$/, `${name} uses an illegal pixel char`);
    }
  }
});

test('every pixel char has a palette entry', () => {
  for (const [name, sprite] of ALL) {
    for (const row of sprite.rows) {
      for (const ch of row) {
        if (ch === '.') continue;
        assert.ok(sprite.palette[parseInt(ch, 16)], `${name} uses slot ${ch} with no colour`);
      }
    }
  }
});

test('palettes have depth, not three flat colours', () => {
  for (const [name, pal] of [['PLANE_PAL', PLANE_PAL], ['CARRIER_PAL', CARRIER_PAL], ['SEA_PAL', SEA_PAL]]) {
    const used = pal.filter(Boolean);
    assert.ok(used.length >= 4, `${name} has only ${used.length} colours`);
    assert.ok(used.length <= 10, `${name} has ${used.length} colours, over the budget of 10`);
    assert.equal(new Set(used).size, used.length, `${name} repeats a colour`);
  }
});

test('the plane art matches the plane hitbox', () => {
  for (const f of PLANE_FRAMES) {
    assert.equal(f.w, PLANE_W);
    assert.equal(f.h, PLANE_H);
  }
});

test('the propeller actually animates', () => {
  assert.equal(PLANE_ANIM.frames.length, 2);
  assert.notDeepEqual(PLANE_ANIM.frames[0].rows, PLANE_ANIM.frames[1].rows);
  assert.ok(PLANE_ANIM.duration >= 2 && PLANE_ANIM.duration <= 16, 'a prop blur should be fast');
});

test('the sea undulates', () => {
  const [a, b, c] = WAVE_ANIM.frames;
  assert.equal(WAVE_ANIM.frames.length, 3);
  assert.notDeepEqual(a.rows, b.rows);
  assert.notDeepEqual(b.rows, c.rows);
});

test('the carrier is built from 16px tiles so it can be any length', () => {
  for (const [name, s] of [['C_DECK', C_DECK], ['C_HULL', C_HULL], ['C_WATERLINE', C_WATERLINE]]) {
    assert.equal(s.w, 16, `${name} must be one tile wide`);
    assert.equal(s.h, 16, `${name} must be one tile tall`);
  }
  assert.ok(C_TOWER.h > 16, 'the superstructure should stand above the deck');
});

test('the sky and sea gradient colours are hex', () => {
  for (const c of [SKY_TOP, SKY_HAZE, SEA_DEEP, SEA_SHALLOW]) assert.match(c, /^#[0-9a-f]{6}$/i);
});
