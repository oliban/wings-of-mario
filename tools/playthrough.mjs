#!/usr/bin/env node
// Play the game the way a person would, and complain about what a person would
// complain about.
//
//   node tools/playthrough.mjs              # everything
//   node tools/playthrough.mjs 1-2          # one level and its sub-areas
//   node tools/playthrough.mjs --only warps # one check across every area
//   node tools/playthrough.mjs -v           # per-case detail, not just failures
//
// WHY THIS EXISTS
// ---------------
// validate.mjs proves the modules import. probe.mjs proves the physics matches
// the reference table. Neither has ever found a bug, because every bug this
// project has had lived in the space between correct units: a brick row big
// Mario could not fit under, a mushroom that surfaced inside a ceiling, a pipe
// that swallowed you from half a level away, a menu that chose for you. Those
// are all things you notice in ten seconds of playing and never notice in a
// unit test. So this harness drives the real game in a real browser and asserts
// on the experience.
//
// THE CHECKS
// ----------
//   loads    every level and sub-area loads, and the spawn is on solid ground
//            with room for big Mario to stand up.
//   blocks   every '?', power, and hidden block is reachable from the spawn,
//            and what it yields comes to rest somewhere you can walk into —
//            not embedded in a ceiling.
//   bricks   every brick row that has standing room under it can actually be
//            broken by big Mario. Driven for real: put him underneath, jump,
//            see whether the tile goes away.
//   warps    a pipe swallows you at its mouth and NOWHERE else. The player is
//            swept across the whole width of the level holding the trigger.
//   menu     title-screen navigation moves the cursor and does not start the
//            game; confirm still works.
//   route    a way from the spawn to the flagpole/axe/exit pipe exists at all.
//            This is the exact form of "the player can finish the level".
//   run      a bot actually drives it, following that route. ADVISORY: a bot
//            that falls short is reported but never fails the harness, because
//            it is far more often the bot's limitation than the level's.
//
// APPROXIMATE ON PURPOSE (do not read these as proofs):
//   * "reachable" and "route" come from tools/reach.mjs's conservative jump
//     model, not from simulation.
//   * every check clears the enemies and pins Mario small, so results are about
//     level geometry and are reproducible; combat is out of scope.
//   * the brick test samples one column per contiguous brick run.
//   * the warp sweep stands the player on every reachable surface and holds the
//     pipe's button; a trigger that only fires mid-air would be missed. A
//     trigger counts as legitimate if the player was within two tiles of some
//     mouth, so it catches "fires from half a level away", not "fires one pixel
//     early".
//   * the run bot is advisory, as above.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, serve } from './serve.mjs';
import { buildLevelGraph, atMouth } from './reach.mjs';

const TILE = 16;

const argv = process.argv.slice(2);
const verbose = argv.includes('-v');
const onlyCheck = (() => {
  const i = argv.indexOf('--only');
  return i >= 0 ? argv[i + 1] : null;
})();
const onlyLevel = argv.find((a) => !a.startsWith('-') && a !== onlyCheck) || null;

// ---------------------------------------------------------------------------
// Level data, statically
// ---------------------------------------------------------------------------

const levelDir = join(ROOT, 'src/data/levels');
const areas = [];
for (const f of readdirSync(levelDir).filter((n) => /^(?:\d+|h)-\d+\.js$/.test(n)).sort()) {
  const id = f.replace('.js', '');
  if (onlyLevel && id !== onlyLevel) continue;
  const lvl = (await import(pathToFileURL(join(levelDir, f)).href)).default;
  areas.push({ name: id, id, areaId: null, key: 'main', lvl });
  for (const [aid, sub] of Object.entries(lvl.areas || {})) {
    areas.push({ name: `${id}/${aid}`, id, areaId: aid, key: aid, lvl: sub });
  }
}
if (!areas.length) {
  console.error(onlyLevel ? `no such level: ${onlyLevel}` : 'no levels found');
  process.exit(2);
}
for (const a of areas) a.graph = buildLevelGraph(a.lvl, a.key);

// ---------------------------------------------------------------------------
// Result collection
// ---------------------------------------------------------------------------

const results = [];
// `weak` marks an advisory result: something the harness could not drive well
// enough to call a defect. It is reported but never fails the run.
const record = (check, area, ok, detail, weak = false) => {
  results.push({ check, area, ok: ok || weak, weak: !ok && weak, detail });
  if (verbose || !ok) {
    console.log(`  ${ok ? 'ok  ' : weak ? 'weak' : 'FAIL'} ${area.padEnd(12)} ${detail}`);
  }
};
const wanted = (name) => !onlyCheck || onlyCheck === name;

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

const { chromium } = await import('playwright');
const { srv, port } = await serve();
const browser = await chromium.launch({ args: ['--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 900, height: 800 } });

const runtimeErrors = [];
page.on('pageerror', (e) => runtimeErrors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') runtimeErrors.push(`CONSOLE: ${m.text()}`);
});

// Shared page-side helpers. Kept in one place so every check loads a level the
// same way: enemies cleared (this harness tests level design, not combat) and
// the player settled on the ground with no buttons held, so the next hold()
// produces a real rising edge.
//
// `step` advances the simulation WITHOUT rendering. __GAME.tick() runs the whole
// WebGL post chain every call, which is right for screenshots and ruinous for a
// harness that needs a hundred thousand frames.
const PAGE_HELPERS = () => {
  const g = window.__GAME;
  window.__PT = {
    step(n = 1) {
      for (let i = 0; i < n; i++) {
        g.game.update();
        g.game.loop.tick++;
      }
    },
    async load(id, areaId, { keepEntities = false, power = 'small' } = {}) {
      await g.loadLevel(id, areaId);
      g.release();
      g.hold({});
      // Power carries across level loads, and big Mario has a different hitbox.
      // Pin it, or an earlier check that collected a mushroom silently changes
      // the outcome of a later one.
      if (power) g.setPower(power);
      const w = g.world;
      if (!keepEntities) {
        w.entities.length = 0;
        // `w.level` is the imported level module, shared by every load in this
        // page. Emptying its `entities` in place does not just clear this run —
        // it strips the level's platforms and enemies from every LATER load too,
        // so a check that asks to keep entities gets none. Swap in a shallow
        // clone instead and leave the module alone.
        if (w.level) w.level = { ...w.level, entities: [] };
      }
      return w;
    },
    settle(n = 60) {
      const p = g.world.player;
      for (let i = 0; i < n && !(p && p.grounded); i++) window.__PT.step(1);
      window.__PT.step(2);
      return p;
    },
    // Put the player on the surface of tile row `ty` — feet on its bottom edge,
    // body in the row itself. teleport() places the feet on the row's TOP edge,
    // which is a row out for anything that cares about the player's midpoint.
    stand(tx, ty) {
      const p = g.world.player;
      g.teleport(tx, ty);
      p.x = tx * 16;
      p.y = (ty + 1) * 16 - p.h;
      p.vx = 0;
      p.vy = 0;
      p.grounded = true;
      window.__PT.step(1);
      return p;
    },
    place(tx, ty, power) {
      g.teleport(tx, ty);
      if (power) g.setPower(power);
      g.hold({});
      return window.__PT.settle(40);
    },
  };
};

async function bootPage() {
  await page.goto(`http://127.0.0.1:${port}/index.html?headless=1`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction('window.__GAME && window.__GAME.ready', null, { timeout: 30000 });
  await page.evaluate('window.__GAME.ready');
  await page.evaluate(() => window.__GAME.pause());
  await page.evaluate(PAGE_HELPERS);
}
await bootPage();

// A wedged page must not wedge the harness: time every call out, then rebuild
// the page so the remaining checks still run.
const EVAL_TIMEOUT = 90000;
let evalFailure = null;
const ev = async (fn, arg) => {
  evalFailure = null;
  let timer;
  try {
    return await Promise.race([
      page.evaluate(fn, arg),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error(`page call exceeded ${EVAL_TIMEOUT / 1000}s`)), EVAL_TIMEOUT);
      }),
    ]);
  } catch (e) {
    evalFailure = e.message;
    try {
      await bootPage();
    } catch (e2) {
      evalFailure += ` (and the page would not restart: ${e2.message})`;
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------------------
// CHECK: loads
// ---------------------------------------------------------------------------

if (wanted('loads')) {
  console.log('\n== loads: every area loads, spawn is on solid ground with headroom ==');
  for (const a of areas) {
    const spawnY = Math.round(a.lvl.spawn ? a.lvl.spawn.y : 12);
    const spawnX = Math.round(a.lvl.spawn ? a.lvl.spawn.x : 2);
    // Headroom is measured where the player comes to REST, not at the spawn
    // tile: a pipe sub-area spawns you inside the pipe's throat by design.
    const r = await ev(
      async ({ id, areaId }) => {
        const g = window.__GAME;
        const w = await window.__PT.load(id, areaId);
        const p = window.__PT.settle(180);
        const cx = p.x + p.w / 2;
        const feetTy = Math.floor((p.y + p.h - 1) / 16);
        let headroom = 0;
        for (let ty = feetTy; ty >= 0; ty--) {
          if (w.solidAt(cx, ty * 16 + 8)) break;
          headroom++;
        }
        const rec = w.tileAt(Math.floor(cx / 16), feetTy);
        return {
          loaded: !!w.level,
          levelW: w.w,
          levelH: w.h,
          grounded: !!p.grounded,
          swimming: !!(rec && rec.liquid) || !!p.swimming,
          headroom,
          feetTy,
          fellOut: p.y > w.h * 16,
          state: w.state,
          playerState: p.state,
          fatal: g.stats().fatal,
        };
      },
      { id: a.id, areaId: a.areaId }
    );
    if (!r) {
      record('loads', a.name, false, `page call failed: ${evalFailure}`);
      continue;
    }

    const problems = [];
    if (!r.loaded) problems.push('level did not load');
    if (r.fatal) problems.push(`fatal: ${r.fatal}`);
    if (r.fellOut) problems.push('spawn fell out of the world');
    else if (!r.grounded && !r.swimming) problems.push(`spawn never landed (feet tile ${r.feetTy})`);
    if (r.playerState === 'dying' || r.playerState === 'dead') problems.push('died on spawn');
    if (r.headroom < 2) {
      problems.push(`only ${r.headroom} tile(s) of headroom where the player lands — big Mario cannot stand`);
    }
    if (!a.graph.start) problems.push(`spawn column ${spawnX} has no standable surface at all`);

    record(
      'loads',
      a.name,
      problems.length === 0,
      problems.length
        ? problems.join('; ')
        : `${r.levelW}x${r.levelH}, spawn ${spawnX},${spawnY} -> rests on row ${r.feetTy}` +
          `${r.swimming ? ' (swimming)' : ''}, ${r.headroom} tiles headroom`
    );
  }
}

// ---------------------------------------------------------------------------
// CHECK: blocks — reachable, and their yield lands somewhere collectible
// ---------------------------------------------------------------------------

const ITEM_CHARS = { '?': 'coin', M: 'power', 1: '1up', C: 'coin', v: 'vine' };

function blocksIn(lvl) {
  const found = [];
  for (let y = 0; y < lvl.tiles.length; y++) {
    for (let x = 0; x < lvl.tiles[y].length; x++) {
      const kind = ITEM_CHARS[lvl.tiles[y][x]];
      if (kind) found.push({ x, y, ch: lvl.tiles[y][x], kind });
    }
  }
  return found;
}

// A block is bumpable from a standable tile that is below it and within a jump.
function bumpSpots(gr, bx, by) {
  const spots = [];
  for (const n of gr.nodes) {
    // Lift nodes are virtual, and they are legitimate places to stand: 6-3's
    // power block hangs over open air with a horizontal lift running under it,
    // and riding the lift to bump it is exactly what the original intends.
    // Skipping them called that block unreachable.
    if (n.virtual && !n.lift) continue;
    if (Math.abs(n.x - bx) > 1) continue;
    const drop = n.y - by;
    if (drop < 1 || drop > 5) continue;
    if (!gr.reachedFromSpawn(n)) continue;
    // Nothing solid between his head and the block.
    let clear = true;
    for (let y = by + 1; y < n.y; y++) if (!gr.grid.free(n.x, y)) clear = false;
    if (clear) spots.push(n);
  }
  return spots.sort((a, b) => a.y - b.y);
}

if (wanted('blocks')) {
  console.log('\n== blocks: every ? / power / hidden block is reachable and yields something you can take ==');
  for (const a of areas) {
    const blocks = blocksIn(a.lvl);
    const unreachable = [];
    const buried = [];
    for (const b of blocks) {
      if (!bumpSpots(a.graph, b.x, b.y).length) unreachable.push(b);
      // A power-up rises out of the top of its block. If that tile is solid the
      // item is born inside the ceiling. This was a real bug in 1-2d.
      if ((b.kind === 'power' || b.kind === '1up' || b.kind === 'vine') && !a.graph.grid.free(b.x, b.y - 1)) {
        buried.push(b);
      }
    }

    const fmt = (list) => list.slice(0, 6).map((b) => `${b.ch}@${b.x},${b.y}`).join(' ');
    const problems = [];
    if (unreachable.length) problems.push(`${unreachable.length} unreachable: ${fmt(unreachable)}`);
    if (buried.length) problems.push(`${buried.length} yield into a solid tile: ${fmt(buried)}`);
    record(
      'blocks',
      a.name,
      problems.length === 0,
      problems.length ? problems.join('; ') : `${blocks.length} block(s) all reachable`
    );

    // Live: bump every power/1up block and watch where the item ends up.
    const live = blocks.filter((b) => b.kind === 'power' || b.kind === '1up');
    if (!live.length) continue;
    // Carry SEVERAL candidate spots, not just the first. bumpSpots sorts by y
    // ascending, so a virtual lift node — which is only a real place to stand
    // when the lift happens to be under you — sorts ahead of solid ground. 6-3's
    // power block hangs over open air with a lift running beneath it, so the
    // first spot drops the player into the pit. Real ground is tried first here,
    // and the trial below re-sites on death regardless.
    const specs = live
      .map((b) => {
        const all = bumpSpots(a.graph, b.x, b.y);
        const solid = all.filter((n) => !n.virtual);
        const spots = [...solid, ...all.filter((n) => n.virtual)].slice(0, 4);
        return { ...b, spots, from: spots[0] || null };
      })
      .filter((b) => b.from);
    if (!specs.length) continue;

    // The failure mode that matters is the item being BORN somewhere the player
    // can never touch — inside a ceiling. A mushroom that later walks off a
    // ledge is behaving correctly, so the verdict is taken the moment it has
    // finished rising out of the block, not wherever it eventually stops.
    const rests = await ev(
      async ({ id, areaId, specs }) => {
        const g = window.__GAME;
        const isItem = (e) => /mushroom|fireflower|flower|star|oneup|1up|vine/i.test(e.constructor.name);
        const out = [];

        // One trial from one standing spot. A trial in which the player DIES is
        // not evidence about the block: the death freezes entity updates, so an
        // item still rising is frozen mid-rise and looks like it "never finished".
        // The caller re-sites and tries again.
        const trial = async (s, spot) => {
          // KEEP THE PLATFORMS. bumpSpots deliberately counts virtual lift nodes
          // as places to stand — 6-3's power block hangs over a twelve-tile void
          // with a horizontal lift running under it, and riding it is exactly
          // what the original intends. Clearing every entity deleted that lift
          // and dropped the player into the pit. Enemies still go, because this
          // check is about level design and not combat.
          //
          // keepEntities also matters because __PT.load's clearing path empties
          // `w.level.entities`, which is the CACHED level module: once cleared,
          // every later load of that level in the same page comes back with no
          // platforms at all.
          const w = await window.__PT.load(id, areaId, { keepEntities: true });
          for (let i = w.entities.length - 1; i >= 0; i--) {
            if (!w.entities[i].isPlatform) w.entities.splice(i, 1);
          }
          const p = window.__PT.place(spot.x, spot.y, 'small');
          const lives0 = w.lives;
          const power0 = p.power;
          w.bumpBlock(s.x, s.y, p);

          let item = null;
          let emerged = null;
          let collected = false;
          let playerDied = false;
          for (let i = 0; i < 240; i++) {
            window.__PT.step(1);
            if (p.state === 'dying' || p.state === 'done' || p.dead || w.lives < lives0) playerDied = true;
            if (!item) item = w.entities.find((e) => e !== p && isItem(e));
            if (!item) continue;
            if (!emerged && !item.emerging) {
              const cx = item.x + item.w / 2;
              const cy = item.y + item.h / 2;
              emerged = {
                tx: Math.floor(cx / 16),
                ty: Math.floor(cy / 16),
                insideSolid: !!w.solidAt(cx, cy),
                headInSolid: !!w.solidAt(cx, item.y + 2),
                frames: i,
              };
            }
            // Taking the item is a GAIN: one more life, or a power level up.
            // `w.lives !== lives0` also fires when the player LOSES a life, so a
            // 1-up trial used to pass on a player death — the one thing the check
            // exists to catch could not fail it.
            if (w.lives === lives0 + 1 || p.power !== power0) collected = true;
            if (playerDied) break;
            if (item.removed || item.dead) break;
            if (emerged && item.grounded && Math.abs(item.vx) < 0.01 && i > emerged.frames + 30) break;
          }
          return {
            from: { x: spot.x, y: spot.y },
            playerDied,
            spawned: !!item,
            kindName: item ? item.constructor.name : null,
            emerged,
            collected,
            stillEmerging: !!(item && item.emerging),
            removedEarly: !!(item && (item.removed || item.dead) && !collected && !emerged),
          };
        };

        for (const s of specs) {
          let r = null;
          let tried = 0;
          for (const spot of s.spots) {
            tried++;
            r = await trial(s, spot);
            if (!r.playerDied) break;
          }
          out.push({ ...s, ...r, spotsTried: tried, spotsAvailable: s.spots.length });
        }
        return out;
      },
      { id: a.id, areaId: a.areaId, specs }
    );
    if (!rests) {
      record('blocks/yield', a.name, false, `page call failed: ${evalFailure}`);
      continue;
    }

    const why = (r) => {
      if (!r.spawned) return 'nothing spawned';
      // removedEarly BEFORE stillEmerging. An item destroyed while it was still
      // rising satisfies both, and "was destroyed" is the accurate half — the
      // other way round it was reported as having simply stalled, which sends
      // you looking at the emerge code instead of at whatever killed it.
      if (r.removedEarly) return `${r.kindName} was destroyed before it emerged`;
      if (r.stillEmerging) return `${r.kindName} never finished rising out of the block`;
      if (r.emerged && (r.emerged.insideSolid || r.emerged.headInSolid)) {
        return `${r.kindName} emerged INSIDE a solid tile at ${r.emerged.tx},${r.emerged.ty}`;
      }
      return null;
    };
    // A trial the player did not survive is not evidence about the block: the
    // death freezes entity updates, so an item still rising is frozen mid-rise
    // and reads as "never finished". Those are separated out and reported as
    // ADVISORY — the same `weak` channel the run bot uses for "the harness could
    // not drive this well enough to call it a defect". Every other verdict still
    // fails hard; only the un-runnable trial is downgraded.
    const invalid = rests.filter((r) => r.playerDied);
    const bad = rests.filter((r) => !r.playerDied && why(r));
    const detail = (list, f) => list.map((r) => `${r.ch}@${r.x},${r.y} -> ${f(r)}`).join('; ');
    if (bad.length) {
      record('blocks/yield', a.name, false, detail(bad, why));
    } else if (invalid.length) {
      record(
        'blocks/yield',
        a.name,
        false,
        detail(
          invalid,
          (r) =>
            `HARNESS: player died at all ${r.spotsTried} candidate bump spot(s), so the trial never ran` +
            ` and there is no verdict on this block. A death gates _updateEntities (world.js:1711),` +
            ` the only caller of stepEmerge, so the item freezes mid-rise and would otherwise be` +
            ` misreported as "never finished rising".`
        ),
        true
      );
    } else {
      record(
        'blocks/yield',
        a.name,
        true,
        `${rests.length} item(s) emerged into open space` +
          ` (${rests.filter((r) => r.collected).length} collected on the spot)`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// CHECK: bricks — big Mario has room to break every brick run
// ---------------------------------------------------------------------------

function brickRuns(lvl) {
  const runs = [];
  for (let y = 0; y < lvl.tiles.length; y++) {
    let run = null;
    for (let x = 0; x <= lvl.tiles[y].length; x++) {
      const isBrick = lvl.tiles[y][x] === '=';
      if (isBrick) {
        if (run) run.x1 = x;
        else run = { y, x0: x, x1: x };
      } else if (run) {
        runs.push(run);
        run = null;
      }
    }
  }
  return runs;
}

if (wanted('bricks')) {
  console.log('\n== bricks: big Mario has the headroom to break every brick run he can stand under ==');
  for (const a of areas) {
    const runs = brickRuns(a.lvl);
    const specs = [];
    const skipped = [];
    for (const r of runs) {
      // Sample the middle of the run, then anything else in it that has a
      // different amount of standing room.
      // bumpSpots models a size-agnostic body — effectively small Mario — but
      // this check then stands BIG Mario on what it returns. A spot only one row
      // under the brick puts his head in the brick's own row: he is inside it,
      // rises 0px and breaks nothing. That is not the level failing, it is a
      // place a two-tile body cannot occupy, so it is not a spot at all.
      // 1-2's column of bricks at 54-55 leaves exactly a one-tile gap, which
      // small Mario walks under and big Mario cannot enter.
      let picked = null;
      for (let x = r.x0; x <= r.x1 && !picked; x++) {
        const spot = bumpSpots(a.graph, x, r.y).find((n) => n.x === x && n.y - r.y >= 2);
        if (spot) picked = { x, y: r.y, from: spot, gap: spot.y - r.y };
      }
      if (picked) specs.push(picked);
      else skipped.push(r);
    }
    if (!specs.length) {
      record('bricks', a.name, true, `no brick run has standing room under it (${runs.length} run(s))`);
      continue;
    }

    const out = await ev(
      async ({ id, areaId, specs }) => {
        const g = window.__GAME;
        const res = [];
        for (const s of specs) {
          const w = await window.__PT.load(id, areaId);
          const p = window.__PT.place(s.from.x, s.from.y, 'big');
          const before = w.tileAt(s.x, s.y);
          const beforeName = before ? before.name : null;
          const startY = p.y;
          let rose = 0;
          // Underwater, holding jump is ONE stroke, not a jump — he rises a
          // little and then sinks away from the brick, so a 24-frame hold
          // measures nothing. Swimming up to a brick means stroking
          // repeatedly. Verified in the engine: held under the brick and
          // stroked, big Mario breaks it on the first strike, so this is the
          // harness's model being wrong and not the game.
          const swimming = !!p.inWater;
          if (swimming) {
            for (let i = 0; i < 120; i++) {
              g.hold(i % 8 < 2 ? { jump: true } : {});
              window.__PT.step(1);
              rose = Math.max(rose, startY - p.y);
              if (!w.tileAt(s.x, s.y)) break;
            }
          } else {
            g.hold({ jump: true });
            for (let i = 0; i < 24; i++) {
              window.__PT.step(1);
              rose = Math.max(rose, startY - p.y);
            }
          }
          g.hold({});
          for (let i = 0; i < 40; i++) window.__PT.step(1);
          const after = w.tileAt(s.x, s.y);
          res.push({
            ...s,
            beforeName,
            afterName: after ? after.name : null,
            rosePx: Math.round(rose),
            power: p.power,
            h: p.h,
            grounded: !!p.grounded,
          });
        }
        return res;
      },
      { id: a.id, areaId: a.areaId, specs }
    );
    if (!out) {
      record('bricks', a.name, false, `page call failed: ${evalFailure}`);
      continue;
    }

    const bad = out.filter((r) => r.afterName === r.beforeName && r.beforeName === 'brick');
    record(
      'bricks',
      a.name,
      bad.length === 0,
      bad.length
        ? bad
            .map(
              (r) =>
                `brick ${r.x},${r.y}: big Mario (h=${r.h}) stood at ${r.from.x},${r.from.y} ` +
                `with ${r.gap} tile(s) of room, rose ${r.rosePx}px, brick survived`
            )
            .join('; ')
        : `${out.length} run(s) broke, ${skipped.length} with no standing room (skipped)`
    );
  }
}

// ---------------------------------------------------------------------------
// CHECK: warps only trigger at their mouth
// ---------------------------------------------------------------------------

if (wanted('warps')) {
  console.log('\n== warps: a pipe swallows you at its mouth and nowhere else ==');
  for (const a of areas) {
    const warps = (a.lvl.warps || []).filter((wp) => (wp.dir || 'down') !== 'up');
    if (!warps.length) {
      record('warps', a.name, true, 'no warps');
      continue;
    }
    // Stand in every place the player can stand, hold the button the pipes react
    // to, and note where he was when one ate him. The bug this replaces was an
    // unbounded proximity test that fired from anywhere downstream of the mouth,
    // so the assertion is about the player's POSITION at the moment it fired.
    const spots = a.graph.nodes
      .filter((n) => !n.virtual && a.graph.reachedFromSpawn(n))
      .map((n) => ({ x: n.x, y: n.y }));

    for (const dir of ['down', 'right', 'left']) {
      const dirWarps = warps.filter((wp) => (wp.dir || 'down') === dir);
      if (!dirWarps.length) continue;

      const fired = await ev(
        async ({ id, areaId, spots, dir }) => {
          const g = window.__GAME;
          const hit = [];
          let w = await window.__PT.load(id, areaId);
          let dirty = false;
          const btn = dir === 'down' ? { down: true } : dir === 'right' ? { right: true } : { left: true };
          for (const s of spots) {
            // A pipe animation started by the previous spot would change the
            // level several frames later and be misread as a stray trigger, so
            // any spot that fired forces a clean reload.
            if (dirty) {
              w = await window.__PT.load(id, areaId);
              dirty = false;
            }
            // The sweep does not advance the level but it DOES advance the
            // clock, and a flooded area makes every tile a node: 2-2 has 2382
            // of them, so at 16 frames each the sweep burns ~630 seconds
            // against a 400-second timer. The player died of the clock about
            // two thirds of the way through, and every pipe after that point
            // was reported as never firing. Hold the clock, and reload if he
            // is in any state that cannot enter a pipe.
            g.world.time = Math.max(g.world.time | 0, 300);
            if (g.world.player.dead || g.world.player.state !== 'normal') {
              w = await window.__PT.load(id, areaId);
              g.world.time = 400;
            }
            const base = g.world.level;
            const p = g.world.player;
            window.__PT.stand(s.x, s.y);
            g.hold(btn);
            let got = null;
            // Long enough to close the sub-tile gap to a wall (the pipe entry
            // test measures the player's leading edge, not his tile).
            for (let i = 0; i < 16; i++) {
              window.__PT.step(1);
              if (p.state === 'pipe' || g.world.level !== base) {
                got = {
                  from: s,
                  px: Math.round(p.x),
                  pw: p.w,
                  feetRow: Math.floor((p.y + p.h - 1) / 16),
                  centreCol: Math.floor((p.x + p.w / 2) / 16),
                  frames: i,
                };
                break;
              }
            }
            g.hold({});
            if (got) {
              hit.push(got);
              dirty = true;
            }
          }
          return hit;
        },
        { id: a.id, areaId: a.areaId, spots, dir }
      );
      if (!fired) {
        record('warps', a.name, false, `page call failed: ${evalFailure}`);
        continue;
      }

      // A trigger is legitimate if the player was at SOME pipe's mouth when it
      // happened. Two tiles of slack: the exact pixel window is the engine's
      // business, half a level away is not.
      const legit = (f) =>
        dirWarps.some((wp) => {
          const fx = Math.round(wp.from.x);
          const fy = Math.round(wp.from.y);
          const dx = Math.min(Math.abs(f.centreCol - fx), Math.abs(f.centreCol - (fx + 1)));
          const dy = dir === 'down' ? f.feetRow - fy : Math.abs(f.feetRow - fy);
          return dx <= 2 && Math.abs(dy) <= 1;
        });

      const stray = fired.filter((f) => !legit(f));
      const label = `${dir} pipe(s) at ${dirWarps.map((wp) => `${wp.from.x},${wp.from.y}`).join(' & ')}`;
      const problems = [];
      if (stray.length) {
        problems.push(
          `fires with the player at ${stray
            .slice(0, 8)
            .map((f) => `col ${f.centreCol} row ${f.feetRow}`)
            .join(', ')}${stray.length > 8 ? ` (+${stray.length - 8} more)` : ''}`
        );
      }
      if (!fired.length) problems.push('never fires from anywhere the player can stand');
      record(
        'warps',
        a.name,
        problems.length === 0,
        problems.length
          ? `${label}: ${problems.join('; ')}`
          : `${label}: ${fired.length} trigger(s), all at a mouth ` +
            `(${spots.length} standing spots swept)`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// CHECK: menu navigation never changes game state
// ---------------------------------------------------------------------------

if (wanted('menu')) {
  console.log('\n== menu: navigating the title menu moves the cursor and starts nothing ==');
  // Driven with REAL key events, not __GAME.hold(): the bug was in the key map
  // (ArrowUp bound to UP *and* JUMP, and the menu reads JUMP as confirm), which
  // a test that forces abstract buttons cannot see.
  const setup = await ev(() => {
    const g = window.__GAME;
    const screens = g.screens;
    if (!window.__PT_MENU) window.__PT_MENU = { original: screens.onSelect, chosen: [] };
    screens.onSelect = (what) => window.__PT_MENU.chosen.push(what);
    return true;
  });

  const menuState = () =>
    ev(() => {
      const g = window.__GAME;
      return {
        index: g.screens.title.index,
        state: g.screens.state,
        started: !!g.game.started,
        chosen: window.__PT_MENU.chosen.slice(),
      };
    });
  const enterTitle = () =>
    ev(async () => {
      const g = window.__GAME;
      g.release();
      await g.showTitle();
      g.screens.title.index = 0;
      g.screens.title.result = null;
      window.__PT_MENU.chosen.length = 0;
      window.__PT.step(1);
      return true;
    });
  const tap = async (key) => {
    await page.keyboard.down(key);
    await ev(() => window.__PT.step(1));
    await page.keyboard.up(key);
    await ev(() => window.__PT.step(2));
  };

  let r = null;
  if (setup) {
    await enterTitle();
    const seen = [];
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp']) {
      const before = await menuState();
      await tap(key);
      const after = await menuState();
      seen.push({ key, before: before.index, after: after.index, ...after });
    }
    await enterTitle();
    await tap('Space');
    const confirmJump = (await menuState()).chosen;
    await enterTitle();
    await tap('Enter');
    const confirmStart = (await menuState()).chosen;
    await ev(() => {
      window.__GAME.screens.onSelect = window.__PT_MENU.original;
      return true;
    });
    r = { seen, confirmJump, confirmStart };
  }

  if (!r) record('menu', 'title', false, `page call failed: ${evalFailure}`);
  else {
    const problems = [];
    const strayConfirm = r.seen.find((s) => s.chosen.length);
    if (strayConfirm) {
      problems.push(
        `pressing ${strayConfirm.key} also confirmed the menu (chose "${strayConfirm.chosen[0]}")`
      );
    }
    if (r.seen.some((s) => s.started)) problems.push('navigating started the game');
    if (r.seen.some((s) => s.state !== 'title')) problems.push('navigating left the title screen');
    if (!r.seen.every((s) => s.after !== s.before)) {
      problems.push(
        `cursor did not move: ${r.seen.map((s) => `${s.key} ${s.before}->${s.after}`).join(', ')}`
      );
    }
    if (!r.confirmJump.length) problems.push('Space (JUMP) no longer confirms');
    if (!r.confirmStart.length) problems.push('Enter (START) no longer confirms');
    record(
      'menu',
      'title',
      problems.length === 0,
      problems.length
        ? problems.join('; ')
        : `arrow keys move the cursor (${r.seen.map((s) => `${s.before}->${s.after}`).join(' ')})` +
          ` and confirm nothing; Space chose "${r.confirmJump[0]}", Enter chose "${r.confirmStart[0]}"`
    );
  }
}

// ---------------------------------------------------------------------------
// CHECK: run — spawn to goal
// ---------------------------------------------------------------------------

// Solve a route out of the reachability graph, then hand the bot the waypoints.
// A greedy "hold right, jump at walls" bot cannot find 1-2's exit pipe or pick
// the right branch of 1-4's maze; with a route it only has to do the driving.
// The furthest exit is preferred so the bot aims at the flagpole rather than at
// the first bonus pipe it could fall into.
function routeToExit(gr) {
  if (!gr.start) return null;
  const prev = new Int32Array(gr.nodes.length).fill(-1);
  const seen = new Uint8Array(gr.nodes.length);
  const q = [gr.start.id];
  seen[gr.start.id] = 1;
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (const j of [...gr.out[i], ...gr.warpOut[i]]) {
      if (seen[j]) continue;
      seen[j] = 1;
      prev[j] = i;
      q.push(j);
    }
  }
  let goal = -1;
  for (const n of gr.nodes) {
    if (!n.exit || !seen[n.id] || n.id === gr.start.id) continue;
    if (goal < 0 || n.x > gr.nodes[goal].x) goal = n.id;
  }
  if (goal < 0) return null;
  const path = [];
  for (let i = goal; i >= 0; i = prev[i]) path.push(gr.nodes[i]);
  path.reverse();
  return path.map((n) => ({ x: n.x, y: n.y }));
}

if (wanted('run')) {
  console.log('\n== run: a bot walks from the spawn to the goal (enemies cleared) ==');
  for (const a of areas) {
    // The exact assertion: the level is completable at all.
    const route = routeToExit(a.graph);
    record(
      'route',
      a.name,
      !!route,
      route
        ? `spawn ${a.graph.spawn.x},${a.graph.spawn.y} -> goal ${a.graph.goalX} in ${route.length} hop(s)`
        : 'NO route from the spawn to the flagpole/axe/exit pipe exists'
    );
    if (!route) continue;

    const r = await ev(
      async ({ id, areaId, route, goalX, warps }) => {
        const g = window.__GAME;
        const w = await window.__PT.load(id, areaId);
        const p0 = window.__PT.settle(150);
        const startArea = w.level;
        const mouthHere = (tx, ty) => {
          for (const wp of warps) {
            const fx = Math.round(wp.from.x);
            const fy = Math.round(wp.from.y);
            if (wp.dir === 'down' && (tx === fx || tx === fx + 1) && ty === fy - 1) return 'down';
            if (wp.dir === 'right' && (tx === fx - 1 || tx === fx) && (ty === fy || ty === fy + 1)) {
              return 'right';
            }
            if (wp.dir === 'left' && (tx === fx + 1 || tx === fx + 2) && (ty === fy || ty === fy + 1)) {
              return 'left';
            }
          }
          return null;
        };
        const goalMouth = mouthHere(route[route.length - 1].x, route[route.length - 1].y);

        let i = 0;
        let jumpFor = 0;
        let restFor = 0;
        let stuck = 0;
        let backoff = 0;
        let lastX = p0.x;
        let maxTx = Math.floor(p0.x / 16);
        let swimTimer = 0;
        let done = null;
        const trace = [];

        for (let t = 0; t < 9000 && !done; t++) {
          const p = g.world.player;
          if (!p) {
            done = 'no player';
            break;
          }
          const cx = p.x + p.w / 2;
          const tx = Math.floor(cx / 16);
          const ty = Math.floor((p.y + p.h - 1) / 16);
          maxTx = Math.max(maxTx, tx);

          if (g.world.state === 'levelend' || g.world.state === 'complete') {
            done = 'levelend';
            break;
          }
          if (p.state === 'dying' || p.state === 'dead' || g.world.state === 'gameover') {
            done = 'died';
            break;
          }
          if (g.world.level !== startArea) {
            done = 'warped-out';
            break;
          }
          if (p.state === 'pipe') {
            g.hold({});
            window.__PT.step(1);
            continue;
          }
          if (tx >= goalX) {
            done = 'reached-goal';
            break;
          }

          // Advance along the route: skip any waypoint already behind us.
          while (
            i < route.length - 1 &&
            (tx > route[i].x || (tx === route[i].x && Math.abs(ty - route[i].y) <= 1))
          ) {
            i++;
          }
          const target = route[i];

          // The route ends at a pipe: walk into it.
          const here = mouthHere(tx, ty);
          if (here && goalMouth && i >= route.length - 2) {
            g.hold(here === 'down' ? { down: true } : here === 'right' ? { right: true } : { left: true });
            window.__PT.step(1);
            continue;
          }

          const swimming = !!(w.tileAtPixel(cx, p.y + p.h / 2) || {}).liquid;
          const dx = target.x - tx;
          const climbing = target.y < ty;
          // A ledge above you cannot be jumped onto from directly underneath —
          // you bump your head on it. Back off and take a run-up.
          if (climbing && dx <= 1 && p.grounded && stuck > 10 && backoff <= 0) backoff = 30;
          if (backoff > 0) backoff--;
          const goRight = backoff > 0 ? false : dx > 0 || (dx === 0 && !swimming && target.y >= ty);
          const goLeft = backoff > 0 ? true : dx < 0;

          const probeX = p.x + (goLeft ? -8 : p.w + 8);
          const wall =
            w.solidAt(probeX, p.y + p.h - 6) || w.solidAt(probeX, p.y + p.h - Math.min(20, p.h));
          // Ground within a stride: if it is missing, jump now.
          const groundAhead =
            !!w.solidAt(p.x + (goLeft ? -10 : p.w + 10), p.y + p.h + 6, 'down') ||
            !!w.solidAt(p.x + (goLeft ? -24 : p.w + 24), p.y + p.h + 6, 'down');
          const climb = climbing && Math.abs(dx) <= 3;

          if (Math.abs(p.x - lastX) < 0.3) stuck++;
          else stuck = 0;
          lastX = p.x;

          if (swimming) {
            // Swimming is a rhythm of taps, not a held button.
            swimTimer = (swimTimer + 1) % 12;
            g.hold({
              right: goRight,
              left: goLeft,
              jump: swimTimer < 2 && (target.y < ty || !groundAhead),
            });
            window.__PT.step(1);
            continue;
          }

          const mustJump = !groundAhead || wall;
          if (p.grounded && backoff <= 0 && (mustJump || ((climb || stuck > 20) && restFor <= 0))) {
            const rise = Math.max(1, ty - target.y);
            jumpFor = !groundAhead ? 30 : Math.min(30, 12 + rise * 5);
            restFor = jumpFor + 8;
          }
          if (jumpFor > 0) jumpFor--;
          if (restFor > 0) restFor--;

          g.hold({ right: goRight, left: goLeft, run: true, jump: jumpFor > 0 });
          window.__PT.step(1);
          if (t % 600 === 0) trace.push({ t, tx, ty, wp: i, target });
        }

        g.hold({});
        const p = g.world.player;
        return {
          done: done || 'timeout',
          maxTx,
          goalX,
          waypoints: route.length,
          lastWaypoint: i,
          finalTx: p ? Math.floor(p.x / 16) : null,
          finalTy: p ? Math.floor((p.y + p.h - 1) / 16) : null,
          stalledAt: route[Math.min(i, route.length - 1)],
          trace,
        };
      },
      {
        id: a.id,
        areaId: a.areaId,
        route,
        goalX: a.graph.goalX,
        warps: (a.lvl.warps || []).map((wp) => ({ from: wp.from, dir: wp.dir || 'down' })),
      }
    );
    if (!r) {
      record('run', a.name, false, `page call failed: ${evalFailure}`);
      continue;
    }
    const ok = r.done === 'reached-goal' || r.done === 'levelend' || r.done === 'warped-out';
    // Advisory: a bot that falls short is far more often a limitation of the bot
    // than a broken level, and `route` above already asserts completability.
    record(
      'run',
      a.name,
      ok,
      ok
        ? `${r.done} at column ${r.maxTx} (goal ${r.goalX}, ${r.waypoints} waypoints)`
        : `bot ${r.done} at column ${r.maxTx} of ${r.goalX} — waypoint ` +
          `${r.lastWaypoint}/${r.waypoints} (${r.stalledAt.x},${r.stalledAt.y}), ` +
          `player at ${r.finalTx},${r.finalTy}. Advisory only.`,
      true
    );
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

await browser.close();
srv.close();

const byCheck = new Map();
for (const r of results) {
  if (!byCheck.has(r.check)) byCheck.set(r.check, { pass: 0, fail: 0, weak: 0 });
  const c = byCheck.get(r.check);
  if (r.weak) c.weak++;
  else if (r.ok) c.pass++;
  else c.fail++;
}

console.log('\n================ PLAYTHROUGH ================');
for (const [check, c] of byCheck) {
  const total = c.pass + c.fail + c.weak;
  console.log(
    `${check.padEnd(14)} ${String(c.pass).padStart(3)}/${String(total).padEnd(3)} ${
      c.fail ? `FAIL (${c.fail})` : 'pass'
    }${c.weak ? `  [${c.weak} advisory]` : ''}`
  );
}

const weak = results.filter((r) => r.weak);
if (weak.length) {
  console.log(`\n${weak.length} advisory result(s) (not failures):`);
  for (const f of weak) console.log(`  ${f.check} / ${f.area}: ${f.detail}`);
}

const failures = results.filter((r) => !r.ok && !r.weak);
if (failures.length) {
  console.log(`\n${failures.length} failing case(s):`);
  for (const f of failures) console.log(`  ${f.check} / ${f.area}: ${f.detail}`);
}

const uniqueErrors = [...new Set(runtimeErrors)];
if (uniqueErrors.length) {
  console.log(`\n${uniqueErrors.length} runtime error(s) during the run:`);
  for (const e of uniqueErrors.slice(0, 20)) console.log(`  ${e}`);
}

const bad = failures.length + uniqueErrors.length;
console.log(bad ? `\nPLAYTHROUGH FAILED (${bad}).` : '\nPLAYTHROUGH PASSED.');
process.exit(bad ? 1 : 0);
