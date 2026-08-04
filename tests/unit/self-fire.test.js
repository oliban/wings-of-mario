import test from 'node:test';
import assert from 'node:assert/strict';
import { MODE, FLIGHT, createPlane, stepPlane } from '../../src/wings/flight.js';
import { ORDNANCE, release, canDamage } from '../../src/wings/ordnance.js';
import { WingsSim } from '../../src/wings/sim.js';

function flying(over = {}) {
  const p = createPlane({ mode: MODE.AIR, x: 1000, y: 200, speed: 2.7, gear: false, ...over });
  stepPlane(p, { throttle: 1, pitch: 0 }); // settle vx/vy from angle and speed
  return p;
}

// Puts the sim's aeroplane in the air at cruise without flying a takeoff.
function airborne(sim, { x = 1200, y = 200, speed = 4 } = {}) {
  Object.assign(sim.plane, { mode: MODE.AIR, x, y, speed, angle: 0, gear: false });
  sim.step({ thrust: 1 });
  return sim.plane;
}

test('a round fired by the aeroplane is stamped with the aeroplane that fired it', () => {
  const sim = new WingsSim({ islands: ['1-1'] });
  airborne(sim);
  const shot = sim.launch('gun');
  assert.equal(shot.owner, sim.planeId);
  assert.equal(sim.state().shots[0].owner, sim.planeId, 'ownership must survive into state()');
});

test('a round fired by the aeroplane cannot damage it, even sitting on top of it', () => {
  const sim = new WingsSim({ islands: ['1-1'] });
  const p = airborne(sim);
  const shot = sim.launch('gun');
  // Positions coincide exactly: geometry alone would call this a hit.
  shot.x = p.x;
  shot.y = p.y;
  assert.equal(sim.canHitPlane(shot), false, 'the pilot was hit by his own tracer');
});

test('somebody ELSE\'s round can still damage the aeroplane', () => {
  const sim = new WingsSim({ islands: ['1-1'] });
  airborne(sim);
  const flak = { kind: 'gun', owner: 'flak:1-1:3', x: sim.plane.x, y: sim.plane.y };
  const neutral = { kind: 'gun', owner: null, x: sim.plane.x, y: sim.plane.y };
  assert.equal(sim.canHitPlane(flak), true, 'ownership must not make the plane invulnerable');
  assert.equal(sim.canHitPlane(neutral), true, 'an unattributed round harms everyone');
});

test('the pilot still dies to his OWN bomb blast — spec 3.3 survives this', () => {
  const sim = new WingsSim({ islands: ['1-1'] });
  airborne(sim);
  const bomb = sim.launch('bomb');
  assert.equal(bomb.owner, sim.planeId);
  // A DIRECT hit from your own bomb is still exempt...
  assert.equal(sim.canHitPlane(bomb), false);
  // ...but the BLAST is not, and the blast is what bombing too low means.
  assert.equal(sim.canHitPlane(bomb, { blast: true }), true, 'bombing too low must still kill');
  assert.ok(ORDNANCE.bomb.radius > 0, 'a bomb without a radius has no blast to die to');
  assert.equal(ORDNANCE.gun.radius, 0, 'the gun has no blast, which is why it is safe');
});

test('the rocket is exempt from its own direct hit and lethal in its own blast', () => {
  const sim = new WingsSim({ islands: ['1-1'] });
  airborne(sim);
  const rocket = sim.launch('rocket');
  assert.equal(sim.canHitPlane(rocket), false);
  assert.equal(sim.canHitPlane(rocket, { blast: true }), true);
});

test('ownership is an id, so the next aeroplane is not shot down by the last one', () => {
  const sim = new WingsSim({ islands: ['1-1'] });
  airborne(sim);
  const shot = sim.launch('gun');
  sim.lose('sea');
  sim.respawn();
  assert.equal(typeof shot.owner, 'string', 'ownership must not be an object reference');
  assert.equal(sim.canHitPlane(shot), false, 'a round outlived its airframe and turned hostile');
});

test('canDamage on its own: blast ignores ownership, a direct hit does not', () => {
  const mine = { kind: 'gun', owner: 'pilot' };
  assert.equal(canDamage(mine, 'pilot'), false);
  assert.equal(canDamage(mine, 'pilot', true), true);
  assert.equal(canDamage(mine, 'mario'), true);
  assert.equal(canDamage(mine, null), true);
});

// The diagnosis this fix was written against, pinned so it stops being
// folklore: the aeroplane was doubled in speed (MAX_SPEED 9.0) while the gun's
// muzzle velocity stayed at 6, and the natural worry is that the aeroplane now
// overtakes its own rounds. It does not, and it CANNOT, because a round
// inherits the aeroplane's velocity and then adds the muzzle on top: the round
// is faster than the aeroplane that fired it by exactly the muzzle velocity,
// at every airspeed, for ever. If muzzle is ever changed to be relative rather
// than additive, this test is the one that fails.
test('a round is always faster than the aeroplane that fired it, by the muzzle', () => {
  for (const speed of [0.8, 2.7, 5.39, FLIGHT.MAX_SPEED]) {
    const p = flying({ speed });
    const s = release('gun', p, null, 'pilot');
    const along = s.vx * Math.cos(p.angle) + s.vy * Math.sin(p.angle);
    const plane = p.vx * Math.cos(p.angle) + p.vy * Math.sin(p.angle);
    assert.ok(
      Math.abs(along - plane - ORDNANCE.gun.muzzle) < 1e-9,
      `at ${speed} px/f the round made only ${along.toFixed(3)} against the plane's ${plane.toFixed(3)}`,
    );
  }
});

test('flat out, chasing its own round, the aeroplane never catches it', () => {
  const sim = new WingsSim({ islands: ['1-1'] });
  const p = airborne(sim, { speed: FLIGHT.MAX_SPEED });
  const shot = sim.launch('gun');
  let gap = shot.x - p.x;
  for (let t = 0; t < ORDNANCE.gun.life; t++) {
    sim.step({ thrust: 1 });
    if (!sim.shots.includes(shot)) break; // expired or hit something
    const now = shot.x - sim.plane.x;
    assert.ok(now >= gap - 1e-9, `the aeroplane closed on its own round: ${gap} -> ${now}`);
    gap = now;
  }
});
