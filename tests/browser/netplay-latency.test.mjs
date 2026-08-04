import test from 'node:test';
import assert from 'node:assert/strict';
import { bootRoom, shutdownRoom } from './helpers.mjs';

// THE TIER-4 TEST (spec 8.3): two browser contexts, one room, one real server.
// The pilot flies a sortie to island 3 and craters it while Mario is standing
// on island 1; Mario then walks onto island 3 and finds the hole. The whole
// scenario runs three times — on a perfect socket, at 150ms, and at 150ms with
// 5% packet loss — with an identical body each time.
//
// Everything below is asserted on GAME STATE: Mario's own tile map, the two
// clients' destroyed-tile sets, the desync detector's own findings. Nothing
// asserts that a message was sent, because a message that arrives and changes
// nothing is indistinguishable from one that never came, and the second of
// those is the bug the injected loss exists to find.
//
// The archipelago seed is pinned, so all three runs fly the SAME sortie over
// the SAME ocean. Latency and packet loss are transport concerns; if they moved
// the sortie's tick count, something in the simulation would be reading the
// network, and the three runs would not be comparable at all. The last subtest
// of the last run checks exactly that.

// One tile of island 1-3's ground. Row 13 of 1-3 is solid from column 0 to 15,
// with nothing above it for four rows, so a radius-2 blast here punches clean
// through rows 13 and 14 and leaves a pit with no floor — which is what makes
// "Mario walks in and falls through" a real outcome rather than a stumble.
const ISLAND = '1-3';
const TX = 10;
const TY = 13;

const SEED = 0x5eed1234;
// Where that seed puts island 1-3. Pinned so that a change to the archipelago's
// layout rules shows up here as one clear failure rather than as three sorties
// that quietly took a different number of ticks.
const ISLAND_ORIGIN_X = 11987;

const RUNS = [
  { name: 'clean', latency: 0, loss: 0, room: 'ACDE' },
  { name: 'under 150ms latency', latency: 150, loss: 0, room: 'FGHJ' },
  { name: 'under 150ms latency and 5% packet loss', latency: 150, loss: 5, room: 'KMNP' },
];

// Filled in by each run, compared by the last one.
const sortieTicks = new Map();

for (const run of RUNS) {
  test(`tier 4: the pilot craters island ${ISLAND} while Mario is on 1-1 — ${run.name}`,
    { timeout: 300000 },
    async (t) => {
      const ctx = await bootRoom({ ...run, seed: SEED });
      t.after(() => shutdownRoom(ctx));
      const { mario, pilot } = ctx;

      // One step of both clients, with a real pause in between so the sockets
      // can actually deliver. page.evaluate bodies are synchronous, so a loop
      // inside one blocks the page's own event loop — including the setTimeout
      // that injected latency is implemented with. Without the pause, a lossy
      // run would never see a single resend land.
      //
      // Mario's pump is called directly; the pilot's rides on __WINGS.tick(),
      // which is the only thing that advances sim.tick — and sim.tick is the
      // session's resend clock, so pumping the pilot without stepping him
      // resends nothing at all however many times it is called.
      const step = async (frames = 60) => {
        await pilot.page.evaluate((n) => window.__WINGS.tick(n), frames);
        await mario.page.evaluate((n) => {
          for (let i = 0; i < n; i++) window.__NET.pump();
        }, frames);
        await new Promise((r) => setTimeout(r, 120));
      };

      // Wait for a CONDITION, never for a fixed number of steps: with loss
      // injected, how many resends it takes is by design not a constant.
      const until = async (what, probe, tries = 60) => {
        for (let i = 0; i < tries; i++) {
          if (await probe()) return i;
          await step();
        }
        throw new Error(`gave up waiting for ${what} after ${tries} steps of both clients`);
      };

      // ---- Mario is on island 1, and stays there for the whole sortie -------

      await mario.page.evaluate(async () => {
        await window.__GAME.loadLevel('1-1');
        window.__GAME.teleport(6, 11);
        window.__GAME.tick(30);
      });
      await step(20);
      assert.equal(await mario.page.evaluate(() => window.__GAME.stats().level), '1-1');
      assert.deepEqual(
        await mario.page.evaluate(() => window.__GAME.damageKeys()),
        [],
        'Mario started with damage he should not have'
      );

      // ---- the sortie ------------------------------------------------------

      // A real bombing run, not a hand-emitted detonation: roll down the deck,
      // climb above the islands, cross the ocean and pickle on tile TX,TY of
      // island 1-3. bot.js drives sim.step directly and reads no clock and no
      // RNG, so this replays with identical tick counts every time.
      //
      // The climb is flown explicitly because bombTile's own cruise altitude is
      // solved from the TARGET tile and sits a few pixels above the island
      // tops — fine for the island you are attacking, fatal over the two you
      // have to cross to reach island 3.
      const sortie = await pilot.page.evaluate(
        ({ island, tx, ty }) => {
          const isle = window.__WINGS.sim.islandById(island);
          if (!isle) return { error: `no island ${island} in this ocean` };
          const targetX = isle.originX + tx * 16 + 8;
          // The aeroplane has been sitting on the deck since the page loaded,
          // and pilot-main's own rAF loop has been ticking it the whole time —
          // so sim.tick at this instant is a wall-clock measurement of how long
          // boot took, and nothing to do with the sortie. What is deterministic
          // is the LENGTH of the sortie, so that is what gets measured.
          const startTick = window.__WINGS.state().tick;
          const rolled = window.__WINGS.takeoff(600);
          const climbed = window.__WINGS.flyTo(window.__WINGS.sim.plane.x + 400, 140, 3000);
          const crossed = window.__WINGS.flyTo(targetX - 1000, 140, 12000);
          const released = window.__WINGS.bombTile(island, tx, ty, 12000);
          return {
            rolled, climbed, crossed, released,
            originX: isle.originX,
            sortieTicks: window.__WINGS.state().tick - startTick,
          };
        },
        { island: ISLAND, tx: TX, ty: TY }
      );
      assert.equal(sortie.error, undefined, sortie.error);
      assert.ok(sortie.rolled, 'the bot never got off the deck');
      assert.ok(sortie.climbed, 'the bot never reached cruise altitude');
      assert.ok(sortie.crossed, `the bot never reached island ${ISLAND}`);
      assert.ok(sortie.released, `bombTile ran out of budget before it pickled on ${TX},${TY}`);
      sortieTicks.set(run.name, sortie.sortieTicks);
      assert.equal(sortie.originX, ISLAND_ORIGIN_X,
        'the pinned seed did not produce the pinned ocean');

      // Hold the throttle open while the bomb falls and the wire settles.
      // Without it the aeroplane glides down and ditches partway through the
      // waiting, and a lost plane is a match event this test has no business
      // generating.
      await pilot.page.evaluate(() => window.__WINGS.hold({ thrust: 1 }));

      // The bomb is away, not landed: bombTile returns on RELEASE. The crater
      // exists when the pilot's own island says so.
      await until(
        `the bomb to land on ${ISLAND}`,
        () => pilot.page.evaluate(
          (id) => window.__WINGS.sim.islandById(id).keys().length > 0, ISLAND
        ),
        40
      );
      const cratered = await pilot.page.evaluate(
        (id) => window.__WINGS.sim.islandById(id).keys(), ISLAND
      );
      assert.ok(cratered.length > 0, 'the bot flew a sortie and cratered nothing');

      // ---- the craters cross the wire --------------------------------------

      // Mario's REPLICA of the server's map, which is where a crater for an
      // island he is not standing on has to live. This is the assertion the
      // injected loss is aimed at: the pilot's detonate has to survive the
      // wire, and the server's authoritative broadcast has to survive it back.
      // BOTH replicas, not just Mario's. The pilot's own set is written by the
      // same authoritative broadcast over the same lossy socket, so waiting
      // only on Mario and then comparing the two asserted the pilot's half at
      // a fixed moment — which is how this file used to fail about one run in
      // four while the product was doing nothing wrong on that particular run.
      //
      // Bounded, and it throws on timeout: a wait that could run forever until
      // the sets happened to agree would turn a real, permanent divergence
      // into a hang instead of a failure, and prove nothing either way.
      await until(
        `island ${ISLAND}'s craters to reach BOTH clients`,
        async () => {
          const [m, p] = await Promise.all([
            mario.page.evaluate(
              ({ id, n }) => window.__NET.damage(id).length >= n,
              { id: ISLAND, n: cratered.length }
            ),
            pilot.page.evaluate(
              ({ id, n }) => window.__WINGS.net.damage(id).length >= n,
              { id: ISLAND, n: cratered.length }
            ),
          ]);
          return m && p;
        }
      );

      await t.test('both clients hold byte-identical destroyed-sets', async () => {
        const [m, p] = await Promise.all([
          mario.page.evaluate((id) => window.__NET.damage(id).slice().sort(), ISLAND),
          pilot.page.evaluate((id) => window.__WINGS.net.damage(id).slice().sort(), ISLAND),
        ]);
        assert.deepEqual(m, p, 'the two clients hold different sets for ' + ISLAND);
        assert.deepEqual(m, cratered.slice().sort(), 'neither set matches the crater the bomb made');
      });

      await t.test('the two clients hash the whole map the same way', async () => {
        // The full per-island hash map — the same object that goes on the wire
        // for the desync detector, covering every island, not just this one.
        const [m, p] = await Promise.all([
          mario.page.evaluate(() => JSON.parse(JSON.stringify(window.__NET.hashes()))),
          pilot.page.evaluate(() => JSON.parse(JSON.stringify(window.__WINGS.net.hashes()))),
        ]);
        assert.deepEqual(m, p, 'the two clients hash different maps');
      });

      await t.test(`the craters were NOT applied to the island Mario is on`, async () => {
        // The bug a naive "apply it to whatever level is loaded" implementation
        // has: 1-3's craters punched into 1-1.
        const here = await mario.page.evaluate(() => window.__GAME.damageKeys());
        assert.deepEqual(here, [], `island ${ISLAND}'s craters landed on 1-1`);
      });

      await t.test('Mario arrives on the pre-bombed island and finds the crater', async () => {
        // Arriving means loading the island with its destroyed-set already
        // subtracted, which is what MarioNet's loadLevel hook does and what the
        // ferry will go through when it exists.
        const arrival = await mario.page.evaluate(
          async ({ id, tx, ty }) => {
            await window.__GAME.loadLevel(id);
            window.__GAME.tick(10);
            return {
              level: window.__GAME.stats().level,
              keys: window.__GAME.damageKeys(),
              solid: window.__GAME.world.tileAt(tx, ty).solid,
            };
          },
          { id: ISLAND, tx: TX, ty: TY }
        );
        assert.equal(arrival.level, ISLAND);
        for (const k of cratered) {
          assert.ok(
            arrival.keys.includes(k),
            `${ISLAND} was pre-bombed but arrived intact: ${k} is missing of ${cratered.length}`
          );
        }
        assert.ok(!arrival.solid, `Mario arrived at ${ISLAND} and the ground was still there`);
      });

      await t.test('Mario falls into the crater and the pilot hears about it', async () => {
        const before = await mario.page.evaluate(() => window.__GAME.world.lives);
        await mario.page.evaluate(({ tx, ty }) => {
          window.__GAME.teleport(tx, ty - 2);
        }, { tx: TX, ty: TY });
        const fell = await mario.page.evaluate(() => {
          for (let i = 0; i < 600; i++) {
            window.__GAME.tick(1);
            window.__NET.pump();
            const p = window.__GAME.world.player;
            if (p.state === 'dying' || p.dead || p.y > window.__GAME.world.h * 16) return true;
          }
          return false;
        });
        assert.ok(fell, 'Mario stood on thin air where the crater was');

        // The life is spent on MARIO's machine and the pilot mirrors it; he
        // never decides it himself. Waiting on the pilot's number is waiting on
        // the whole reliable-event path, resends included.
        await until(
          'the death to reach the pilot',
          () => pilot.page.evaluate(
            (n) => window.__WINGS.net.state().marioLives === n, before - 1
          )
        );
      });

      await t.test('neither side, nor the server, reported a desync', async () => {
        // The detector runs continuously, so a clean run is itself the
        // assertion. Give it one more hash interval on each side first, so a
        // set that diverged at the very end still gets compared.
        await step(90);
        const [m, p] = await Promise.all([
          mario.page.evaluate(() => window.__NET.desyncs()),
          pilot.page.evaluate(() => window.__WINGS.net.desyncs()),
        ]);
        assert.deepEqual(m, [], `Mario reported ${m.length} desyncs`);
        assert.deepEqual(p, [], `the pilot reported ${p.length} desyncs`);
        assert.deepEqual(
          ctx.server.serverErrors.filter((l) => l.includes('[DESYNC]')),
          [],
          'the server saw a desync neither client noticed'
        );
      });

      await t.test('the server logged no faults at all', () => {
        assert.deepEqual(ctx.server.serverErrors, []);
      });

      await t.test('no uncaught page errors on either side', () => {
        assert.deepEqual(ctx.mario.errors, []);
        assert.deepEqual(ctx.pilot.errors, []);
      });

      if (run === RUNS[RUNS.length - 1]) {
        await t.test('the sortie was identical on all three networks', () => {
          // Latency and packet loss are TRANSPORT concerns. If either moved the
          // tick the bomb came off at, something in the simulation is reading
          // the network — a determinism bug, not a flaky test, and one that
          // would make every later soak test meaningless.
          const ticks = [...sortieTicks.values()];
          assert.equal(sortieTicks.size, RUNS.length, 'a run did not record its sortie');
          assert.equal(
            new Set(ticks).size, 1,
            `the bomb came off at different ticks per network: ${
              [...sortieTicks].map(([k, v]) => `${k}=${v}`).join(', ')}`
          );
        });
      }
    });
}
