import test from 'node:test';
import assert from 'node:assert/strict';

import { Sail, SAIL, PHASE, sailFrame, sailText, worldOfIsland } from '../../src/wings/sail.js';
import { Archipelago, ARCHIPELAGO, layoutArchipelago } from '../../src/wings/archipelago.js';
import { WingsSim, SQUADRON } from '../../src/wings/sim.js';
import { MODE } from '../../src/wings/flight.js';
import { MarioEvents, MatchVerdict, applyWire, STATUS } from '../../src/net/match-events.js';
import { Match, MATCH } from '../../src/wings/match.js';

// ---------------------------------------------------------------------------
// The scene's clock
// ---------------------------------------------------------------------------

test('the fade is a pure function of elapsed TICKS', () => {
  // Called twice with the same number it gives the same frame, and it never
  // reads a clock: this is what makes a screenshot at tick N reproducible.
  for (const t of [0, 1, 47, 48, 100, 227, 228, 275, 276, 1000]) {
    assert.deepEqual(sailFrame(t), sailFrame(t));
  }
});

test('veil: transparent at the start, opaque across the hold, transparent at the end', () => {
  assert.equal(sailFrame(0).veil, 0);
  assert.equal(sailFrame(0).phase, PHASE.OUT);
  assert.equal(sailFrame(SAIL.FADE_OUT).veil, 1);
  assert.equal(sailFrame(SAIL.FADE_OUT).phase, PHASE.HOLD);
  assert.equal(sailFrame(SAIL.FADE_OUT + SAIL.HOLD - 1).veil, 1);
  assert.equal(sailFrame(SAIL.TOTAL - 1).phase, PHASE.IN);
  assert.equal(sailFrame(SAIL.TOTAL).veil, 0);
  assert.equal(sailFrame(SAIL.TOTAL).done, true);
});

test('the veil only ever darkens on the way in and lightens on the way out', () => {
  for (let t = 1; t <= SAIL.FADE_OUT; t++) {
    assert.ok(sailFrame(t).veil >= sailFrame(t - 1).veil, `veil went back at ${t}`);
  }
  for (let t = SAIL.FADE_OUT + SAIL.HOLD + 1; t <= SAIL.TOTAL; t++) {
    assert.ok(sailFrame(t).veil <= sailFrame(t - 1).veil, `veil went back at ${t}`);
  }
});

test('the text is legible ONLY while the screen is fully black', () => {
  for (let t = 0; t <= SAIL.TOTAL; t++) {
    const f = sailFrame(t);
    if (f.text > 0) assert.equal(f.veil, 1, `text at ${t} with veil ${f.veil}`);
  }
  // And it does become legible: a card nobody can read is not a card.
  assert.equal(sailFrame(SAIL.FADE_OUT + Math.floor(SAIL.HOLD / 2)).text, 1);
});

test('the scene runs about four and a half seconds', () => {
  const seconds = SAIL.TOTAL / 60.0988;
  assert.ok(seconds > 3.5 && seconds < 6, `sail is ${seconds.toFixed(2)}s`);
});

// ---------------------------------------------------------------------------
// The counter
// ---------------------------------------------------------------------------

test('the swap is one edge, on the tick the veil first goes opaque', () => {
  const s = new Sail();
  assert.equal(s.begin({ from: 1, to: 2 }), true);
  let swaps = 0;
  let swapAt = null;
  let finished = 0;
  for (let i = 0; i < SAIL.TOTAL + 10; i++) {
    const f = s.step();
    if (f.swap) { swaps++; swapAt = i + 1; }
    if (f.finished) finished++;
  }
  assert.equal(swaps, 1);
  assert.equal(swapAt, SAIL.SWAP);
  assert.equal(finished, 1);
  assert.equal(sailFrame(swapAt).veil, 1, 'the ocean changed in plain sight');
  assert.equal(s.active, false);
});

test('a second worldCleared for the same crossing does not restart it', () => {
  const s = new Sail();
  assert.equal(s.begin({ from: 1, to: 2 }), true);
  s.step();
  s.step();
  // The reliable channel dedupes by seq, but a client that reconnects mid-sail
  // can be told again. Refusing keeps it one crossing.
  assert.equal(s.begin({ from: 1, to: 2 }), false);
  assert.equal(s.elapsed, 2);
});

test('a stale crossing to a world already behind us is refused', () => {
  const s = new Sail();
  assert.equal(s.begin({ from: 3, to: 2 }), false);
  assert.equal(s.begin({ from: 3, to: 3 }), false);
  assert.equal(s.begin({ from: 3, to: 4 }), true);
});

test('both screens are told the same thing', () => {
  const pilot = sailText(1, 2, 'SQUADRON REPLENISHED — 5 AIRCRAFT ON DECK');
  const mario = sailText(1, 2, 'MARIO GOES ASHORE ON 2-1');
  assert.equal(pilot.title, mario.title);
  assert.match(pilot.title, /CARRIER GROUP/);
  // Everything but the last, side-specific line is identical.
  assert.deepEqual(pilot.lines.slice(0, -1), mario.lines.slice(0, -1));
  assert.match(pilot.lines.join(' '), /WORLD 2 ARCHIPELAGO/);
  assert.match(pilot.lines.join(' '), /WORLD 1 SECURED/);
});

test('worldOfIsland reads islands and refuses everything else', () => {
  assert.equal(worldOfIsland('2-1'), 2);
  assert.equal(worldOfIsland('8-4'), 8);
  assert.equal(worldOfIsland('1-1-coins'), null);
  assert.equal(worldOfIsland('harry-1'), null);
  assert.equal(worldOfIsland(null), null);
});

// ---------------------------------------------------------------------------
// The new ocean
// ---------------------------------------------------------------------------

test('two clients that sail from the same seed lay out the SAME ocean', () => {
  const a = new Archipelago({ seed: 0xc0ffee, world: 1 });
  const b = new Archipelago({ seed: 0xc0ffee, world: 1 });
  assert.equal(a.sail(2), true);
  assert.equal(b.sail(2), true);
  assert.deepEqual(a.slots.map((s) => [s.id, s.x]), b.slots.map((s) => [s.id, s.x]));
  // And it is the layout anyone can compute from the seed alone, which is how
  // Mario's client places him without being sent anything.
  assert.deepEqual(
    a.slots.map((s) => [s.id, s.x]),
    layoutArchipelago(2, 0xc0ffee).map((s) => [s.id, s.x]),
  );
});

test('a warp arrives at the world it names, not the next one along', () => {
  const a = new Archipelago({ seed: 7, world: 1 });
  assert.equal(a.sail(4), true);
  assert.equal(a.world, 4);
  assert.deepEqual(a.slots.map((s) => s.id), ['4-1', '4-2', '4-3', '4-4']);
});

test('sailing to where we already are is refused, so a resend is a no-op', () => {
  const a = new Archipelago({ seed: 7, world: 3 });
  const before = a.slots.map((s) => s.x);
  assert.equal(a.sail(3), false);
  assert.equal(a.sail(2), false);
  assert.equal(a.world, 3);
  assert.deepEqual(a.slots.map((s) => s.x), before);
});

test('there is no ninth archipelago', () => {
  const a = new Archipelago({ seed: 7, world: ARCHIPELAGO.WORLDS });
  assert.equal(a.sail(), false);
  assert.equal(a.sail(ARCHIPELAGO.WORLDS + 1), false);
  assert.equal(a.world, ARCHIPELAGO.WORLDS);
});

test('an explicit island list is dropped on the way out of its own world', () => {
  // ISLAND_LEVELS pins world 1 for the bots and the older tests. Carrying it
  // into world 2 would make every archipelago world 1 with different gaps.
  const a = new Archipelago({ seed: 7, world: 1, ids: ['1-1', '1-2', '1-3', '1-4'] });
  assert.equal(a.sail(2), true);
  assert.deepEqual(a.slots.map((s) => s.id), ['2-1', '2-2', '2-3', '2-4']);
});

test('craters do not leak across the sail', () => {
  const a = new Archipelago({ seed: 7, world: 1 });
  a.record('1-1', ['10,10', '11,10']);
  a.sail(2);
  for (const isle of a.islands()) {
    assert.equal(a.damageFor(isle.id).length, 0, `${isle.id} arrived pre-cratered`);
  }
  // The old world's record survives — craters are permanent for the match —
  // but its keys belong to island ids that are not in this ocean.
  assert.deepEqual(a.damageFor('1-1'), ['10,10', '11,10']);
});

// ---------------------------------------------------------------------------
// The pilot's simulation across the crossing
// ---------------------------------------------------------------------------

function airborne(sim) {
  for (let i = 0; i < 400 && sim.plane.mode !== MODE.AIR; i++) {
    sim.step({ thrust: 1, pitch: 1, gear: false });
  }
  return sim.plane.mode === MODE.AIR;
}

test('the pilot resumes on the deck, stationary, with a full squadron', () => {
  const sim = new WingsSim({ seed: 99, world: 1 });
  assert.ok(airborne(sim));
  sim.squadron = 1;
  sim.plane.fuel = 10;
  sim.loadout.bomb = 0;

  assert.equal(sim.sail(2), true);

  assert.equal(sim.archipelago.world, 2);
  assert.equal(sim.squadron, SQUADRON, 'the squadron is replenished when the group sails');
  assert.equal(sim.plane.mode, MODE.DECK);
  assert.equal(sim.plane.speed, 0);
  assert.equal(sim.plane.vx, 0);
  assert.equal(sim.plane.vy, 0);
  assert.equal(sim.status, 'ready');
  assert.ok(sim.plane.fuel > 10, 'a fresh tank');
  assert.ok(sim.bombs > 0, 'fresh ordnance');
  assert.deepEqual(sim.islands.map((i) => i.id), ['2-1', '2-2', '2-3', '2-4']);
});

test('nothing in the air survives the crossing', () => {
  const sim = new WingsSim({ seed: 99, world: 1 });
  assert.ok(airborne(sim));
  sim.step({ thrust: 1, drop: true, fire: true, gear: false });
  sim.step({ thrust: 1, fire: true, gear: false });
  assert.ok(sim.shots.length > 0, 'nothing was in the air to begin with');

  sim.sail(2);
  assert.equal(sim.shots.length, 0);
  assert.equal(sim.gunTrace(), null, 'a round from the old ocean still on the wire');

  // And no orphan detonates into the new world: step on and nothing bursts.
  const before = sim.events.length;
  for (let i = 0; i < 120; i++) sim.step({});
  const late = sim.events.slice(before).filter((e) => e.type === 'detonation');
  assert.deepEqual(late, []);
});

test('a pilot who lost his last aeroplane is flying again in the next world', () => {
  const sim = new WingsSim({ seed: 5, world: 1, squadron: 1 });
  assert.ok(airborne(sim));
  sim.lose('sea');
  assert.equal(sim.status, 'over');

  sim.sail(2);
  assert.equal(sim.squadron, SQUADRON);
  assert.equal(sim.status, 'ready');
  // 'over' refuses to step, so a status left behind would ground him for good.
  const t = sim.tick;
  sim.step({});
  assert.equal(sim.tick, t + 1);
});

test('the radar holds no contact from the old ocean', () => {
  const sim = new WingsSim({ seed: 5, world: 1 });
  sim.setFix({ present: true, x: 4000, y: 500 });
  for (let i = 0; i < 200; i++) sim.step({});
  assert.ok(sim.radarContact(), 'no contact to lose');
  sim.sail(2);
  assert.equal(sim.radarContact(), null);
});

// ---------------------------------------------------------------------------
// Composing with the match
// ---------------------------------------------------------------------------

test('clearing world 8 is Mario winning, not a sail', () => {
  const ev = new MarioEvents();
  ev.step({ island: '8-4', lives: 3 });
  const out = ev.step({ island: '1-1', lives: 3 });
  const cleared = out.find((e) => e.type === 'worldCleared');
  assert.ok(cleared);
  assert.equal(cleared.d.final, true);

  const v = new MatchVerdict();
  assert.equal(applyWire(v, 'worldCleared', cleared.d), STATUS.MARIO);

  // And src/wings/match.js reaches the same answer through its own path.
  const m = new Match({ world: ARCHIPELAGO.WORLDS, island: ARCHIPELAGO.ISLANDS_PER_WORLD - 1 });
  assert.equal(m.clearLevel(), 'won');
  assert.equal(m.winner, 'mario');
});

test('clearing any earlier world is a sail, and the match goes on', () => {
  const ev = new MarioEvents();
  ev.step({ island: '1-4', lives: 3 });
  const out = ev.step({ island: '2-1', lives: 3 });
  const cleared = out.find((e) => e.type === 'worldCleared');
  assert.ok(cleared);
  assert.equal(cleared.d.final, false);
  assert.equal(worldOfIsland(cleared.d.next), 2);

  const v = new MatchVerdict();
  assert.equal(applyWire(v, 'worldCleared', cleared.d), STATUS.PLAYING);
});

test('the match replenishes the squadron on the sail, exactly as the sim does', () => {
  const m = new Match({ world: 1, island: ARCHIPELAGO.ISLANDS_PER_WORLD - 1, squadron: 1 });
  assert.equal(m.clearLevel(), 'sail');
  assert.equal(m.world, 2);
  assert.equal(m.island, 0);
  assert.equal(m.squadron, MATCH.SQUADRON);
  assert.equal(MATCH.SQUADRON, SQUADRON, 'two definitions of a squadron have drifted');
});

test('a warped Mario and the pilot end up in the SAME world', () => {
  // 1-2 has a warp zone to world 4. Mario's client names the island he walked
  // onto; the pilot sails to the world that names, and both oceans match.
  const ev = new MarioEvents();
  ev.step({ island: '1-2', lives: 3 });
  const out = ev.step({ island: '4-1', lives: 3 });
  const cleared = out.find((e) => e.type === 'worldCleared');
  assert.ok(cleared, 'a warp across worlds must announce the crossing');

  const sim = new WingsSim({ seed: 0xbeef, world: 1 });
  assert.equal(sim.sail(worldOfIsland(cleared.d.next)), true);
  assert.equal(sim.archipelago.world, 4);
  // Mario's client computes the same ocean from the seed, without being sent it.
  assert.deepEqual(
    sim.islands.map((i) => [i.id, i.originX]),
    layoutArchipelago(4, 0xbeef).map((s) => [s.id, s.x]),
  );
});
