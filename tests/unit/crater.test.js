import test from 'node:test';
import assert from 'node:assert/strict';

import { WingsSim } from '../../src/wings/sim.js';
import { ORDNANCE } from '../../src/wings/ordnance.js';
import { SEA_Y, ISLAND_TOP_Y } from '../../src/wings/geo.js';
import { getLevel } from '../../src/data/levels/index.js';

// A CRATER IS A PROPERTY OF THE WEAPON.
//
// The impact test used to be a point sample at the tick boundary. A bomb off
// the ceiling arrives at about eleven pixels a tick, so that sample found it
// already several pixels inside the hillside, and a blast disc centred a few
// pixels deeper covers a different set of tiles. Crater size therefore varied
// with impact speed, and impact speed varies with the height it was dropped
// from — a weapon whose power depended on the frame rate of the thing it hit.
//
// These are the tests that would have caught it, and they are unit tests
// because they need no canvas and run in milliseconds.

const LEVEL = getLevel('1-1');

// Drop straight down (no forward speed) onto a chosen column, so the impact
// column is fixed and altitude is the only variable.
function dropOn(tx, planeY) {
  const sim = new WingsSim();
  const isle = sim.islands[0];
  const p = sim.plane;
  p.mode = 'air';
  p.gear = false;
  p.angle = 0;
  // A shot leaves the NOSE, half a plane-width ahead of p.x at angle 0.
  p.x = isle.x0 + tx * 16 + 8 - 24;
  p.y = planeY;
  p.speed = 0;
  p.vx = 0;
  p.vy = 0;
  sim.step({ pitch: 0, thrust: 0, drop: true });
  const shot = sim.shots[0];
  assert.ok(shot, `no bomb was released over tx=${tx} from y=${planeY}`);
  let guard = 0;
  while (!shot.dead && guard++ < 900) sim.step({ pitch: 0, thrust: 0 });
  const det = sim.events.filter((e) => e.type === 'detonation').pop();
  return { tiles: isle.keys().length, det, impact: { x: shot.x, y: shot.y } };
}

// The world y of the highest tile in a column that a shot actually stops at.
// Decor — a bush, a cloud, a coin — is not it: a bomb falls straight through
// those and detonates on whatever blocks it underneath.
const REF = new WingsSim().islands[0];
function topOf(tx) {
  for (let ty = 0; ty < LEVEL.tiles.length; ty++) {
    if (REF.blocksTile(tx, ty)) return ISLAND_TOP_Y + ty * 16;
  }
  return null;
}

test('a crater is the same size however far the bomb fell', () => {
  const failures = [];
  let columns = 0;
  for (let tx = 20; tx <= 200; tx += 7) {
    const top = topOf(tx);
    if (top == null) continue;
    // Only altitudes ABOVE everything in this column: released from below an
    // overhanging block the bomb legitimately falls past it and hits the
    // ground instead, which is physics rather than sampling.
    const alts = [top - 40, top - 140, top - 240, top - 340].filter((y) => y > 8);
    if (alts.length < 3) continue;
    columns++;
    const counts = alts.map((y) => dropOn(tx, y).tiles);
    if (!counts.every((c) => c === counts[0])) {
      failures.push(`tx=${tx} (top y=${top}) destroyed ${JSON.stringify(counts)} from ${JSON.stringify(alts)}`);
    }
  }
  assert.ok(columns >= 15, `only ${columns} columns were usable`);
  assert.deepEqual(failures, [], `crater size varied with drop height:\n  ${failures.join('\n  ')}`);
});

test('the impact speed itself changes nothing — only the weapon does', () => {
  // The same statement from the other side: measure the impact speed to show
  // the drops really were arriving at very different speeds.
  const tx = 60;
  const top = topOf(tx);
  const speeds = [];
  const craters = [];
  for (const y of [top - 40, top - 200, top - 400]) {
    const sim = new WingsSim();
    const isle = sim.islands[0];
    const p = sim.plane;
    p.mode = 'air';
    p.gear = false;
    p.angle = 0;
    p.x = isle.x0 + tx * 16 + 8 - 24;
    p.y = y;
    p.speed = 0;
    p.vx = 0;
    p.vy = 0;
    sim.step({ pitch: 0, thrust: 0, drop: true });
    const shot = sim.shots[0];
    let last = 0;
    let guard = 0;
    while (!shot.dead && guard++ < 900) {
      last = shot.vy;
      sim.step({ pitch: 0, thrust: 0 });
    }
    speeds.push(last);
    craters.push(isle.keys().length);
  }
  assert.ok(speeds[2] > speeds[0] * 2.5, `the drops arrived at similar speeds (${speeds.map((s) => s.toFixed(1))})`);
  assert.equal(craters[0], craters[1]);
  assert.equal(craters[1], craters[2]);
});

test('the detonation lands on the surface, not inside the hill', () => {
  // The mechanism, stated directly: however fast it arrives, the bang happens
  // within a pixel or two of where the terrain starts.
  const tx = 60;
  const top = topOf(tx);
  for (const y of [top - 40, top - 200, top - 400]) {
    const r = dropOn(tx, y);
    assert.ok(r.det && !r.det.water, `dropped from ${y} it never hit the island`);
    const depth = r.det.y - top;
    assert.ok(depth >= 0, `detonated ${-depth}px above the surface`);
    assert.ok(depth < 4, `detonated ${depth.toFixed(1)}px INSIDE the hill from y=${y}`);
  }
});

test('nothing can tunnel through terrain, whatever it is fired at', () => {
  // A swept test also makes tunnelling impossible by construction. Fire every
  // kind of round at a wall from point blank at the highest closing speed the
  // game can produce and require that each one stops at it.
  const sim0 = new WingsSim();
  const isle0 = sim0.islands[0];
  // A column with a single floating block in it: the thinnest thing to hit.
  let thin = null;
  for (let tx = 20; tx < 200 && !thin; tx++) {
    for (let ty = 4; ty < 10; ty++) {
      if (LEVEL.tiles[ty][tx] !== '.' && LEVEL.tiles[ty - 1][tx] === '.' && LEVEL.tiles[ty + 1][tx] === '.') {
        thin = { tx, ty };
        break;
      }
    }
  }
  assert.ok(thin, 'no single-tile platform found in 1-1 to shoot at');
  assert.ok(isle0.blocksTile(thin.tx, thin.ty), 'the chosen platform is not something a shot should stop at');

  for (const kind of ['bomb', 'rocket', 'gun']) {
    const sim = new WingsSim();
    const isle = sim.islands[0];
    const p = sim.plane;
    p.mode = 'air';
    p.gear = false;
    // Straight down at maximum airspeed, from directly above the block.
    p.angle = Math.PI / 2;
    p.x = isle.x0 + thin.tx * 16 + 8;
    p.y = ISLAND_TOP_Y + thin.ty * 16 - 300;
    p.speed = 4.5;
    p.vx = 0;
    p.vy = 4.5;
    sim.step({ pitch: 0, thrust: 0, [kind === 'bomb' ? 'drop' : 'fire']: kind !== 'rocket' });
    if (kind === 'rocket') sim.launch('rocket');
    const shot = sim.shots.find((s) => s.kind === kind);
    if (!shot) continue;
    let guard = 0;
    let maxStep = 0;
    let prev = shot.y;
    while (!shot.dead && guard++ < 900) {
      sim.step({ pitch: 0, thrust: 0 });
      maxStep = Math.max(maxStep, shot.y - prev);
      prev = shot.y;
    }
    const det = sim.events.filter((e) => e.type === 'detonation').pop();
    assert.ok(det, `a ${kind} fired at a solid block never detonated at all`);
    assert.equal(det.water, false, `a ${kind} tunnelled through the block and hit the sea (steps of ${maxStep.toFixed(1)}px)`);
    assert.ok(
      det.y <= ISLAND_TOP_Y + thin.ty * 16 + 16,
      `a ${kind} detonated ${det.y - (ISLAND_TOP_Y + thin.ty * 16)}px past the face of a 16px block`
    );
  }
});

test('a bomb that reaches open water still detonates at the surface, not below it', () => {
  const sim = new WingsSim();
  const p = sim.plane;
  p.mode = 'air';
  p.gear = false;
  p.angle = 0;
  p.x = 1200;
  p.y = 60;
  p.speed = 4;
  p.vx = 4;
  p.vy = 0;
  sim.step({ pitch: 0, thrust: 0, drop: true });
  const shot = sim.shots[0];
  let guard = 0;
  while (!shot.dead && guard++ < 900) sim.step({ pitch: 0, thrust: 0 });
  const det = sim.events.filter((e) => e.type === 'detonation').pop();
  assert.ok(det && det.water, 'the bomb never reached the sea');
  assert.equal(det.y, SEA_Y, 'the splash was not drawn at the waterline');
});

test('the blast radius is the weapon\'s, and the weapon\'s alone', () => {
  // Belt and braces on the thing the user asked about: nothing in the release
  // path may scale the radius by speed, altitude or anything else.
  for (const kind of Object.keys(ORDNANCE)) {
    assert.equal(typeof ORDNANCE[kind].radius, 'number');
  }
  const sim = new WingsSim();
  const isle = sim.islands[0];
  const p = sim.plane;
  p.mode = 'air';
  p.gear = false;
  p.angle = 0;
  p.x = isle.x0 + 60 * 16 - 24;
  p.y = 40;
  p.speed = 4.5;
  p.vx = 4.5;
  p.vy = 0;
  sim.step({ pitch: 0, thrust: 0, drop: true });
  const shot = sim.shots[0];
  let guard = 0;
  while (!shot.dead && guard++ < 900) sim.step({ pitch: 0, thrust: 0 });
  const det = sim.events.filter((e) => e.type === 'detonation').pop();
  assert.equal(det.radius, ORDNANCE.bomb.radius, 'a fast bomb reported a different radius');
});
