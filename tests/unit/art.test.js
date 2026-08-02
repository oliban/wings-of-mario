import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANE_PAL, PLANE_FRAMES, PLANE_ATTITUDES, PLANE_ANIM, PLANE_ANGLE_STEP,
  PLANE_PIVOT, GEAR, HOOK, GEAR_MOUNTS, HOOK_MOUNT,
} from '../../src/wings/art/plane.js';
import {
  CARRIER_PAL, C_DECK, C_DECK_PLAIN, C_DECK_WIRE, C_DECK_STRIPE, C_CATWALK,
  C_CATWALK_LAMP, C_HULL, C_WATERLINE, C_BOW, C_STERN, C_ISLAND, C_RADAR, BOW_WAVE,
} from '../../src/wings/art/carrier.js';
import {
  SKY_BANDS, SKY_SEAMS, SEAM_H, CLOUD_PAL, CLOUD_S, CLOUD_M, CLOUD_L, SCUD,
  CLOUD_DECKS, SCUD_BANK,
} from '../../src/wings/art/sky.js';
import {
  SEA_BANDS, SEA_SEAMS, SEA_PAL, SWELL_NEAR, SWELL_FAR, CREST, SPRAY, WAKE,
} from '../../src/wings/art/sea.js';
import { ORD_PAL, BOMB, ROCKET, TRACER, PUFF, FIREBALL } from '../../src/wings/art/ordnance.js';
import { HUD_PAL, HUD_PLATE, FUEL_BEZEL, SQUADRON_PIP, HOOK_PIP_UP, HOOK_PIP_DOWN } from '../../src/wings/art/hud.js';

// Flatten anything the art modules export into a flat list of [name, sprite].
function collect(label, v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) v.forEach((e, i) => collect(`${label}[${i}]`, e, out));
  else if (v.frames) v.frames.forEach((e, i) => collect(`${label}#${i}`, e, out));
  else if (v.rows && v.palette) out.push([label, v]);
  return out;
}

const ALL = [];
for (const [name, v] of Object.entries({
  PLANE_FRAMES, GEAR, HOOK,
  C_DECK, C_DECK_PLAIN, C_DECK_WIRE, C_DECK_STRIPE, C_CATWALK, C_CATWALK_LAMP,
  C_HULL, C_WATERLINE, C_BOW, C_STERN, C_ISLAND, C_RADAR, BOW_WAVE,
  SKY_SEAMS, CLOUD_S, CLOUD_M, CLOUD_L, SCUD,
  SEA_SEAMS, SWELL_NEAR, SWELL_FAR, CREST, SPRAY, WAKE,
  BOMB, ROCKET, TRACER, PUFF, FIREBALL,
  HUD_PLATE, FUEL_BEZEL, SQUADRON_PIP, HOOK_PIP_UP, HOOK_PIP_DOWN,
})) collect(name, v, ALL);

const PALETTES = [
  ['PLANE_PAL', PLANE_PAL], ['CARRIER_PAL', CARRIER_PAL], ['CLOUD_PAL', CLOUD_PAL],
  ['SEA_PAL', SEA_PAL], ['ORD_PAL', ORD_PAL], ['HUD_PAL', HUD_PAL],
];

test('every sprite is rectangular and uses only legal pixel chars', () => {
  assert.ok(ALL.length > 60, `only found ${ALL.length} sprites`);
  for (const [name, s] of ALL) {
    assert.ok(s.rows.length, `${name} has no rows`);
    for (const row of s.rows) {
      assert.equal(row.length, s.w, `${name} has a ragged row`);
      assert.match(row, /^[0-9a-f.]+$/, `${name} uses an illegal pixel char`);
    }
  }
});

test('every pixel char has a palette entry', () => {
  for (const [name, s] of ALL) {
    for (const row of s.rows) {
      for (const ch of row) {
        if (ch === '.') continue;
        assert.ok(s.palette[parseInt(ch, 16)], `${name} uses slot ${ch} with no colour`);
      }
    }
  }
});

// ARCHITECTURE.md section 2: 4-10 slots per sprite, every one a distinct colour.
test('palettes are ramps of four to ten distinct colours', () => {
  for (const [name, pal] of PALETTES) {
    const used = pal.filter(Boolean);
    assert.ok(used.length >= 4, `${name} has only ${used.length} colours`);
    assert.ok(used.length <= 10, `${name} has ${used.length} colours, over the budget of 10`);
    assert.equal(new Set(used).size, used.length, `${name} repeats a colour`);
    for (const c of used) assert.match(c, /^#[0-9a-f]{6}$/i, `${name} has a non-hex entry ${c}`);
  }
});

// Anti-aliasing is forbidden, so no colour anywhere may be partly transparent.
test('no colour is semi-transparent', () => {
  for (const [name, pal] of PALETTES) {
    for (const c of pal.filter(Boolean)) {
      assert.equal(c.length, 7, `${name} entry ${c} carries an alpha channel`);
    }
  }
  for (const c of [...SKY_BANDS, ...SEA_BANDS]) assert.match(c, /^#[0-9a-f]{6}$/i);
});

// Slots the scene paints with fillStyle rather than with pixels: the fuel
// needle is a rectangle drawn under the bezel's cut-out, so its three colours
// live in the palette but never appear in a sprite grid.
const FILL_ONLY = new Map([[HUD_PAL, new Set([6, 7, 8])]]);

test('every declared palette slot is actually reached by some pixel', () => {
  const reached = new Map();
  for (const [, s] of ALL) {
    let set = reached.get(s.palette);
    if (!set) reached.set(s.palette, (set = new Set()));
    for (const row of s.rows) for (const ch of row) if (ch !== '.') set.add(parseInt(ch, 16));
  }
  for (const [name, pal] of PALETTES) {
    const set = [...reached.entries()].find(([p]) => p === pal)?.[1];
    if (!set) continue; // seam palettes are built per-boundary, not shared
    for (let i = 0; i < pal.length; i++) {
      if (FILL_ONLY.get(pal)?.has(i)) continue;
      if (pal[i]) assert.ok(set.has(i), `${name} declares slot ${i} that no pixel uses`);
    }
  }
});

// ---------------------------------------------------------------------------
// The aircraft
// ---------------------------------------------------------------------------

test('the plane is drawn by hand at thirteen attitudes, 15 degrees apart', () => {
  assert.equal(PLANE_ANGLE_STEP, 15);
  assert.equal(PLANE_ATTITUDES.length, 13);
  assert.equal((PLANE_ATTITUDES.length - 1) * PLANE_ANGLE_STEP, 180);
  for (const pair of PLANE_FRAMES) assert.equal(pair.length, 2, 'each attitude needs two prop phases');
});

test('every attitude is the same square canvas and rotates about the same pivot', () => {
  for (const pair of PLANE_FRAMES) {
    for (const s of pair) {
      assert.equal(s.w, 32);
      assert.equal(s.h, 32);
    }
  }
  assert.ok(PLANE_PIVOT.x > 0 && PLANE_PIVOT.x < 32);
  assert.ok(PLANE_PIVOT.y > 0 && PLANE_PIVOT.y < 32);
});

test('no attitude is a duplicate of another — thirteen frames means thirteen drawings', () => {
  const seen = new Set();
  for (const pair of PLANE_FRAMES) {
    const key = pair[0].rows.join('|');
    assert.ok(!seen.has(key), 'two attitudes are the same picture');
    seen.add(key);
  }
});

test('the propeller actually animates', () => {
  for (let i = 0; i < PLANE_FRAMES.length; i++) {
    assert.notDeepEqual(
      PLANE_FRAMES[i][0].rows, PLANE_FRAMES[i][1].rows,
      `attitude ${i} has two identical prop phases`
    );
  }
  assert.ok(PLANE_ANIM.duration >= 2 && PLANE_ANIM.duration <= 16, 'a prop blur should be fast');
});

// Rotation preserves area. If an attitude carries materially less ink than the
// others, part of the aeroplane fell off the edge of its 32x32 canvas — which
// is silent at runtime and obvious here.
test('no attitude has lost part of the aeroplane off the canvas', () => {
  const ink = PLANE_FRAMES.map((p) => p[0].rows.join('').replace(/\./g, '').length);
  const lo = Math.min(...ink);
  const hi = Math.max(...ink);
  assert.ok(lo > 150, `an attitude has only ${lo} pixels of aircraft in it`);
  assert.ok((hi - lo) / hi < 0.08, `attitude ink spread ${lo}..${hi} suggests a clipped frame`);
});

test('the gear and the hook are separate parts with mounts to hang them on', () => {
  assert.ok(GEAR.h > GEAR.w, 'an undercarriage leg is taller than it is wide');
  assert.equal(GEAR_MOUNTS.length, 2, 'a taildragger still has two main legs');
  assert.ok(HOOK_MOUNT.x < 0, 'the hook belongs at the tail, which is aft of the pivot');
  assert.ok(HOOK.w > 1 && HOOK.h > 1);
});

// ---------------------------------------------------------------------------
// The ship
// ---------------------------------------------------------------------------

test('the ship is built from 16px tiles so she can be any length', () => {
  for (const [name, s] of [
    ['C_DECK', C_DECK], ['C_DECK_PLAIN', C_DECK_PLAIN], ['C_DECK_WIRE', C_DECK_WIRE],
    ['C_DECK_STRIPE', C_DECK_STRIPE], ['C_CATWALK', C_CATWALK], ['C_CATWALK_LAMP', C_CATWALK_LAMP],
    ['C_HULL', C_HULL], ['C_WATERLINE', C_WATERLINE],
  ]) assert.equal(s.w, 16, `${name} must be one tile wide`);
});

test('the bow and the stern are the same height and taper opposite ways', () => {
  assert.equal(C_BOW.h, C_STERN.h);
  assert.equal(C_BOW.w, C_STERN.w);
  const ink = (row) => [...row].map((c, i) => (c === '.' ? -1 : i)).filter((i) => i >= 0);
  const bowTop = Math.max(...ink(C_BOW.rows[10]));
  const bowLow = Math.max(...ink(C_BOW.rows[40]));
  assert.ok(bowLow < bowTop, 'the stem should rake aft as it goes down');
  const sternTop = Math.min(...ink(C_STERN.rows[10]));
  const sternLow = Math.min(...ink(C_STERN.rows[40]));
  assert.ok(sternLow > sternTop, 'the transom should tuck forward as it goes down');
});

test('the deck is marked, wired and lit', () => {
  const paint = (s) => s.rows.join('').includes('6');
  assert.ok(paint(C_DECK), 'the landing area needs a painted centreline');
  assert.ok(paint(C_DECK_STRIPE), 'the touchdown zone needs stripes');
  assert.ok(C_DECK_WIRE.rows[0].includes('5'), 'an arrestor wire should stand proud of the deck');
  assert.ok(C_CATWALK_LAMP.rows.join('').includes('8'), 'the catwalk needs a lamp');
  assert.ok(!C_CATWALK.rows.join('').includes('8'), 'the unlit catwalk must not carry one');
});

test('the island stands above the deck and carries a mast', () => {
  assert.ok(C_ISLAND.h > 24, 'the superstructure should be a superstructure');
  assert.ok(C_ISLAND.rows.join('').includes('8'), 'the bridge needs lit ports');
  assert.equal(C_RADAR.frames.length, 4, 'the aerial should sweep, not sit');
});

// ---------------------------------------------------------------------------
// Sky and sea
// ---------------------------------------------------------------------------

test('the sky and the sea are banded, and every band is darker than the last', () => {
  const lum = (c) => parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16);
  assert.equal(SKY_SEAMS.length, SKY_BANDS.length - 1);
  assert.equal(SEA_SEAMS.length, SEA_BANDS.length - 1);
  assert.equal(SEAM_H, 4);
  for (let i = 1; i < SKY_BANDS.length; i++) {
    assert.ok(lum(SKY_BANDS[i]) > lum(SKY_BANDS[i - 1]), 'the sky should pale toward the horizon');
  }
  for (let i = 1; i < SEA_BANDS.length; i++) {
    assert.ok(lum(SEA_BANDS[i]) < lum(SEA_BANDS[i - 1]), 'the sea should darken with depth');
  }
});

test('both swells tile seamlessly and run at different periods', () => {
  assert.equal(SWELL_NEAR.w % 2, 0);
  assert.notEqual(SWELL_NEAR.w, SWELL_FAR.w, 'two identical periods do not beat against each other');
  for (const s of [SWELL_NEAR, SWELL_FAR]) {
    // Column 0 must continue from the last column, or the joint shows as a seam.
    for (let y = 0; y < s.h; y++) {
      const a = s.rows[y][0] === '.';
      const b = s.rows[y][s.w - 1] === '.';
      assert.equal(a, b, `${s.name} does not tile at row ${y}`);
    }
  }
});

test('nothing on the water is static', () => {
  assert.equal(CREST.frames.length, 3);
  assert.equal(WAKE.frames.length, 2);
  assert.equal(SCUD.frames.length, 2);
  assert.notDeepEqual(WAKE.frames[0].rows, WAKE.frames[1].rows);
  assert.notDeepEqual(SCUD.frames[0].rows, SCUD.frames[1].rows);
  assert.notDeepEqual(BOW_WAVE.frames[0].rows, BOW_WAVE.frames[1].rows);
});

test('an impact throws spray and a wreck burns, and neither loops', () => {
  assert.equal(SPRAY.loop, false);
  assert.equal(FIREBALL.loop, false);
  assert.ok(SPRAY.frames.length >= 3);
  assert.ok(FIREBALL.frames.length >= 3);
});

test('the cloud decks are literals, so the sky is the same on every run', () => {
  assert.ok(CLOUD_DECKS.length >= 12);
  assert.ok(SCUD_BANK.length >= 6);
  for (const c of CLOUD_DECKS) {
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y));
    assert.ok(c.m > 0 && c.m < 1, 'a parallax factor outside (0,1) is not parallax');
    assert.ok(['s', 'm', 'l'].includes(c.s));
  }
  const depths = new Set(CLOUD_DECKS.map((c) => c.m));
  assert.ok(depths.size >= 3, 'clouds need more than one depth to read as depth');
});

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

test('the panel is a tiled plate with a cut-out for the fuel gauge', () => {
  assert.equal(HUD_PLATE.w, 16, 'the plate is tiled across the screen');
  assert.ok(HUD_PLATE.h >= 24);
  assert.ok(FUEL_BEZEL.rows[4].includes('.'), 'the gauge well must be see-through');
  assert.notDeepEqual(HOOK_PIP_UP.rows, HOOK_PIP_DOWN.rows, 'the hook indicator has to move');
  assert.ok(SQUADRON_PIP.w >= 5);
});
