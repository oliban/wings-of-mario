import test from 'node:test';
import assert from 'node:assert/strict';
import { WINNER } from '../../src/wings/match.js';
import { MatchHost } from '../../src/wings/match-host.js';

// A stand-in for the engine's World, holding the three callbacks it stores as
// instance properties (src/game/world.js:635-637) and firing them the way the
// engine does: onLifeLost on a death with lives left, onGameOver INSTEAD when
// the last one goes (world.js:2428-2436).
class FakeWorld {
  constructor(lives = 3) {
    this.lives = lives;
    this.upstream = [];
    this.onLevelComplete = () => this.upstream.push('levelComplete');
    this.onLifeLost = () => { this.upstream.push('lifeLost'); return false; };
    this.onGameOver = () => this.upstream.push('gameOver');
  }

  die() {
    this.lives--;
    if (this.lives <= 0) return this.onGameOver(this);
    return this.onLifeLost(this);
  }

  complete() {
    return this.onLevelComplete(this);
  }
}

class FakeRide {
  constructor() {
    this.boarded = [];
    this.cleared = 0;
    this.onArrive = null;
    this.onLost = null;
  }

  board(opts) { this.boarded.push(opts); return opts; }
  clear() { this.cleared++; }
}

class FakeHost {
  constructor() { this.loaded = []; }
  async loadLevel(id) { this.loaded.push(id); return id; }
}

function rig(opts = {}) {
  const host = new FakeHost();
  const ride = new FakeRide();
  const mh = new MatchHost(host, ride, opts);
  const world = new FakeWorld(opts.lives == null ? 3 : opts.lives);
  mh.install(world);
  return { host, ride, mh, world };
}

test('install takes the world once and keeps the upstream handlers', () => {
  const { mh, world } = rig();
  assert.equal(mh.world, world);
  assert.equal(typeof mh.prev.lifeLost, 'function', 'onLifeLost must be chained, not dropped');
  assert.equal(typeof mh.prev.gameOver, 'function');
  assert.equal(mh.install(world), false, 'installing twice is a no-op');
  assert.notEqual(mh.prev.lifeLost, world.onLifeLost,
    'the saved handler must be the original, not the wrapper that calls it');
});

test('a death mirrors the engine count and still respawns upstream', () => {
  const { mh, world } = rig();
  world.die();
  assert.equal(mh.match.lives, 2, 'the engine owns the count; the match mirrors it');
  assert.deepEqual(world.upstream, ['lifeLost'], 'upstream respawn must still run');
  assert.equal(mh.match.winner, WINNER.NONE);
});

test('the engine game-over is the pilot winning', () => {
  const { mh, world } = rig({ lives: 1 });
  world.die();
  assert.deepEqual(world.upstream, ['gameOver']);
  assert.equal(mh.match.winner, WINNER.PILOT);
  assert.equal(mh.state().winner, 'pilot');
});

test('a cleared level boards the ferry instead of the upstream progression', () => {
  const { ride, world, mh } = rig();
  world.complete();
  assert.deepEqual(world.upstream, [], 'onLevelComplete is replaced, not chained');
  assert.equal(ride.boarded.length, 1);
  assert.equal(ride.boarded[0].to, '1-2');
  assert.ok(ride.boarded[0].fromX < ride.boarded[0].toX, 'the crossing runs left to right');
  assert.equal(mh.match.phase, 'ferry');
});

test('arriving loads the island the ferry was carrying him to', () => {
  const { ride, host, world, mh } = rig();
  world.complete();
  ride.onArrive();
  assert.equal(mh.match.islandId, '1-2');
  assert.deepEqual(host.loaded, ['1-2']);
  assert.equal(ride.cleared, 1);
});

test('a sinking puts him back ashore where he sailed from', () => {
  const { ride, mh, world } = rig();
  world.complete();
  ride.onLost('sunk');
  assert.equal(mh.match.phase, 'ashore');
  assert.equal(mh.match.islandId, '1-1');
  assert.equal(ride.cleared, 1);
});

test('a castle sails the group and loads the next world without a boat', () => {
  const { ride, host, mh, world } = rig({ world: 1, island: 3 });
  assert.equal(mh.match.islandId, '1-4');
  world.complete();
  assert.equal(mh.match.islandId, '2-1');
  assert.deepEqual(host.loaded, ['2-1']);
  assert.equal(ride.boarded.length, 0, 'nobody ferries between archipelagos');
});

test('clearing 8-4 ends the match and loads nothing', () => {
  const { host, ride, mh, world } = rig({ world: 8, island: 3 });
  world.complete();
  assert.equal(mh.match.winner, WINNER.MARIO);
  assert.deepEqual(host.loaded, []);
  assert.equal(ride.boarded.length, 0);
});

test('the host survives having no ride and no engine world', () => {
  const mh = new MatchHost(null, null);
  assert.equal(mh.install(null), false);
  assert.equal(mh.match.islandId, '1-1');
});
