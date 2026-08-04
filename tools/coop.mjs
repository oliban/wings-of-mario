#!/usr/bin/env node
// Drive BOTH brothers headlessly and check the rules that only exist in co-op.
//
//   node tools/coop.mjs            # run every check
//   node tools/coop.mjs C1 C6      # run named ones
//
// WHY THIS TOOL EXISTS
// --------------------
// Simultaneous two-player is this project's invention: the original has no such
// mode, so reference/ says nothing about it and every other tool here —
// validate, probe, playthrough, reach — drives player one only. That gap has now
// cost three defects, and every one of them survived a reviewed commit, a full
// visual sweep and the playthrough suite:
//
//   * a ~35-frame window where the brother who was NOT growing became
//     intangible, because one global gate stood in for two per-player ones;
//   * big Luigi could bump a brick but never shatter it, because Entity.isPlayer
//     compared against the `world.player` singleton;
//   * a "power" block paid out by MARIO's size whoever hit it, for the same
//     reason.
//
// None of them were subtle once someone pressed Luigi's buttons. Nothing could:
// __GAME.hold() drives pad one, and until hold2() existed there was no public
// way to move the second brother at all. This file is the thing that presses
// them, so the next one fails here instead of in someone's hands.
//
// THE TWO TRAPS THIS FILE EXISTS TO NEUTRALISE
// --------------------------------------------
// Both of these produce confident, wrong numbers. Neither is hypothetical: both
// have been walked into during this work, and trap 1 was walked into by a
// reviewer who had just finished reading a report describing it. Documentation
// alone demonstrably does not stop them, which is why the sandbox below is
// shared and why the guard in bumpFromBelow() fails the run. Read `bed` before
// adding a check.
//
//   1. `world.coop = true` ALONE DOES NOT GIVE YOU A SECOND PLAYER you can
//      drive. Luigi is built on demand inside _placePlayer, and his pad comes
//      from `world.coopPad`. Set coop and load a level without binding coopPad
//      and you get a Luigi who exists, renders, and ignores hold2() forever.
//      What that actually looked like: an attempt to reproduce "hold() moves
//      player two 0px, hold2() moves him 45px" instead measured both brothers
//      moving an identical 9.25px under hold() and an identical 6.23px under
//      hold2() — the deltas match whichever pad is driving, because with no pad
//      bound nothing was reading input at all and trap 2 was moving both.
//
//   2. THE CAMERA DRAGS THE TRAILING BROTHER. camera.follow() tracks whichever
//      living brother is furthest RIGHT, and player.js clamps every player to
//      cam.x, so the one behind is shoved along by the screen edge. Two
//      consequences that have each invented a bug:
//        - Spawn both at the same x, move one, and the other slides too. That
//          reads as "hold() moves player two", which is false — it is the clamp,
//          not the pad. Every input check here therefore puts the brother being
//          measured AHEAD, where nothing can push him.
//        - A brother parked to the RIGHT of a block-bumper drags the bumper off
//          his own block before he can jump into it. That reads as "Mario cannot
//          break bricks either", which is false and much more alarming than the
//          real defect. bumpFromBelow() therefore makes the bumper the rightmost
//          player and ASSERTS he stayed put; if he did not, the run fails rather
//          than reporting a measurement taken somewhere else.
//
// Every co-op check runs beside a single-player control. A co-op number on its
// own cannot tell "Luigi is broken" from "my probe is broken" — the control can,
// and that is the only reason the results here are worth anything.

import { serve } from './serve.mjs';

const WANT = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const { chromium } = await import('playwright');
const { srv, port } = await serve();
const browser = await chromium.launch({ args: ['--mute-audio', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 900, height: 800 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });

await page.goto(`http://127.0.0.1:${port}/index.html?headless=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__GAME && window.__GAME.ready', null, { timeout: 20000 });
await page.evaluate('window.__GAME.ready');
await page.evaluate(() => window.__GAME.pause());

const checks = await page.evaluate(async (want) => {
  const g = window.__GAME;
  const TILE = 16;
  const FLOOR = 12;
  const inputMod = await import('/src/core/input.js');

  const out = [];
  const wanted = (id) => !want.length || want.includes(id);
  async function check(id, title, fn) {
    if (!wanted(id)) return;
    try {
      const r = await fn();
      out.push({ id, title, ...r });
    } catch (e) {
      out.push({ id, title, ok: false, control: '-', coop: `THREW: ${e.message}`, expect: '-' });
    }
  }

  /* ------------------------------------------------------------------ bed */
  // A flat floor with open sky, no enemies, and two brothers who are actually
  // controllable. Read trap 1 in the file header before changing this: binding
  // `coopPad` BEFORE loadLevel is what makes Luigi respond to a pad at all,
  // because _placePlayer copies it onto him at construction time.
  //
  // Brothers are placed 10 tiles apart by default, P2 ahead. That is not
  // cosmetic — see trap 2. Whoever is being measured must be the rightmost
  // player, or the camera clamp moves him for reasons that have nothing to do
  // with the rule under test.
  async function bed(opts = {}) {
    g.world.coop = opts.coop === false ? false : true;
    g.world.coopPad = inputMod.pad2;
    await g.loadLevel(opts.level || '1-1');
    const w = g.world;
    // Enemies are cleared by default so a physics or block result measures the
    // rule and not a goomba. A check about the level's own entities — the axe
    // sweep needs real firebars to sweep — asks to keep them.
    if (!opts.keepEntities) {
      w.entities.length = 0;
      if (w.level) w.level.entities = [];
      if (w.rootLevel) w.rootLevel.entities = [];
    }
    if (opts.carve !== false) {
      for (let tx = 2; tx < 60; tx++) {
        for (let ty = 0; ty < FLOOR; ty++) w.setTile(tx, ty, '.');
        for (let ty = FLOOR; ty < w.h; ty++) w.setTile(tx, ty, '#');
      }
    }
    // A single-player control needs Luigi gone, not merely idle: an inert second
    // brother still leads the camera and still shows up in the roster.
    if (opts.coop === false) {
      w.player2 = null;
      w.players = [w.player].filter(Boolean);
    }
    const p1 = w.player, p2 = w.player2;
    if (opts.p1 && p1) p1.setPower(opts.p1, true);
    if (opts.p2 && p2) p2.setPower(opts.p2, true);
    const put = (p, tx) => {
      if (!p) return;
      p.x = tx * TILE; p.y = FLOOR * TILE - p.h;
      p.vx = 0; p.vy = 0; p.px = p.x; p.py = p.y;
    };
    put(p1, opts.x1 == null ? 10 : opts.x1);
    put(p2, opts.x2 == null ? 20 : opts.x2);
    if (p1) w.cam.reset(w.level, p1);
    g.tick(2);
    return w;
  }

  const hold1 = (m) => inputMod.input.force(m || null);
  const hold2 = (m) => inputMod.pad2.force(m || null);
  const relAll = () => { inputMod.input.release(); inputMod.pad2.release(); };
  const tileKey = (tx, ty) => (ty << 12) | (tx & 0xfff); // blocks.js keys contents by a packed number

  // Stand `p` under the block at column `tx` and jump him into it through the
  // real input path. Hand-setting vy does not survive the physics step; the jump
  // has to be pressed. Returns every non-player entity kind seen at any point,
  // because an item the bumper collects on the way down is still an item.
  function bumpFromBelow(p, which, tx) {
    const w = g.world;
    // Trap 2: the bumper must be the rightmost player or the camera clamp drags
    // him off his own block.
    const other = p === w.player ? w.player2 : w.player;
    if (other) {
      other.x = (tx - 4) * TILE; other.y = FLOOR * TILE - other.h;
      other.vx = 0; other.vy = 0; other.px = other.x; other.py = other.y;
    }
    const wantX = tx * TILE + (TILE - p.w) / 2;
    p.x = wantX; p.y = FLOOR * TILE - p.h;
    p.vx = 0; p.vy = 0; p.px = p.x; p.py = p.y;
    w.cam.x = Math.max(0, p.x + p.w / 2 - 128);
    g.tick(2);
    if (Math.abs(p.x - wantX) > 1) {
      // Fail loudly. A run that measures the wrong column silently is how "Mario
      // cannot break bricks" got reported.
      throw new Error(
        `PROBE BROKEN: bumper dragged to x=${Math.round(p.x)}, wanted ${Math.round(wantX)} ` +
        `(camera clamp — is another brother to his right?)`
      );
    }
    const seen = new Set();
    const poll = () => {
      for (const e of w.entities) {
        if (!e || e === w.player || e === w.player2) continue;
        seen.add(e.constructor.name);
      }
    };
    const hold = which === 'p1' ? hold1 : hold2;
    hold({ jump: true });
    for (let i = 0; i < 26; i++) { g.tick(1); poll(); }
    hold(null);
    for (let i = 0; i < 40; i++) { g.tick(1); poll(); }
    relAll();
    return [...seen].join(',') || '(none)';
  }

  /* -------------------------------------------------- isPlayer consumers */
  // Entity.isPlayer has four consumers and every one means "is this A player",
  // not "is this THE camera player": blocks.js _canBreak, world.js _clearHazards
  // at the axe, and entity.js despawn protection twice. C1-C4 pin all four, so
  // an edit to that getter fails here rather than in one brother's hands.

  await check('C1', 'big Luigi breaks a brick like big Mario', async () => {
    const brick = async (who, coop) => {
      const w = await bed({ p1: 'big', p2: 'big', coop });
      const tx = 10, ty = FLOOR - 4;
      w.setTile(tx, ty, '=');
      g.tick(1);
      bumpFromBelow(who === 'p1' ? w.player : w.player2, who, tx);
      return w.tileAt(tx, ty).char;
    };
    const control = await brick('p1', false);   // single-player big Mario
    const coop = await brick('p2', true);       // big Luigi
    return { ok: control === '.' && coop === '.', expect: "both '.'",
             control: `mario '=' -> '${control}'`, coop: `luigi '=' -> '${coop}'` };
  });

  await check('C2', 'a power block pays out by the BUMPER\'s size', async () => {
    const pay = async (p1pow, p2pow, who, coop) => {
      const w = await bed({ p1: p1pow, p2: p2pow, coop });
      const tx = 10, ty = FLOOR - 4;
      w.setTile(tx, ty, '?');
      w.contents.set(tileKey(tx, ty), { item: 'power', opts: {} });
      g.tick(1);
      return bumpFromBelow(who === 'p1' ? w.player : w.player2, who, tx);
    };
    // Control: single-player, no Luigi to confuse the question.
    const cSmall = await pay('small', null, 'p1', false);
    const cBig = await pay('big', null, 'p1', false);
    // Co-op: Mario's size is set OPPOSITE to Luigi's in each case, so a payout
    // that follows Mario is immediately visible as the wrong one.
    const lSmall = await pay('big', 'small', 'p2', true);   // small bumper -> mushroom
    const lBig = await pay('small', 'big', 'p2', true);     // big bumper   -> fireflower
    return {
      ok: cSmall === 'Mushroom' && cBig === 'FireFlower' &&
          lSmall === 'Mushroom' && lBig === 'FireFlower',
      expect: 'small->Mushroom, big->FireFlower',
      control: `mario small->${cSmall}, big->${cBig}`,
      coop: `luigi small->${lSmall}, big->${lBig}`,
    };
  });

  await check('C3', 'the axe hazard sweep spares both brothers', async () => {
    const sweep = async (coop) => {
      const w = await bed({ level: '1-4', carve: false, keepEntities: true, coop });
      let ax = -1, ay = -1;
      for (let tx = 0; tx < w.w && ax < 0; tx++)
        for (let ty = 0; ty < w.h; ty++)
          if (w.tileAt(tx, ty).char === 'a') { ax = tx; ay = ty; break; }
      const hz = () => w.entities.filter((e) => e && !e.removed &&
        (typeof e.onPlayerTouch === 'function' || e.harmful)).length;
      const before = hz();
      const p1 = w.player, p2 = w.player2;
      p1.x = ax * TILE; p1.y = ay * TILE - p1.h; p1.px = p1.x; p1.py = p1.y;
      if (p2) { p2.x = (ax - 2) * TILE; p2.y = ay * TILE - p2.h; p2.px = p2.x; p2.py = p2.y; }
      w.cam.x = Math.max(0, p1.x - 128);
      for (let i = 0; i < 40; i++) g.tick(1);
      return { before, after: hz(), p1gone: !!p1.removed, p2gone: !!(p2 && p2.removed) };
    };
    const c = await sweep(false);
    const k = await sweep(true);
    return {
      ok: c.after < c.before && !c.p1gone && k.after < k.before && !k.p1gone && !k.p2gone,
      expect: 'hazards drop, no brother removed',
      control: `mario ${c.before}->${c.after} hazards, removed=${c.p1gone}`,
      coop: `both ${k.before}->${k.after} hazards, removed m=${k.p1gone} l=${k.p2gone}`,
    };
  });

  await check('C4', 'neither brother despawns behind the camera', async () => {
    const far = async (coop) => {
      const w = await bed({ coop });
      const p1 = w.player, p2 = w.player2;
      w.cam.x = 120 * TILE;                 // ~100 tiles ahead of both
      for (let i = 0; i < 60; i++) g.tick(1);
      return { p1gone: !!p1.removed, p2gone: !!(p2 && p2.removed), roster: w.players.length };
    };
    const c = await far(false);
    const k = await far(true);
    return {
      ok: !c.p1gone && !k.p1gone && !k.p2gone && k.roster === 2,
      expect: 'both survive, roster 2',
      control: `mario removed=${c.p1gone}`,
      coop: `removed m=${k.p1gone} l=${k.p2gone}, roster ${k.roster}`,
    };
  });

  /* ------------------------------------------------------ co-op scenarios */

  await check('C5', 'the brother who enters a pipe is the one who exits it', async () => {
    const ride = async (takerIsLuigi) => {
      const w = await bed({ carve: false });
      const taker = takerIsLuigi ? w.player2 : w.player;
      const other = takerIsLuigi ? w.player : w.player2;
      // 1-1 has a down-pipe at (57,9) into the coin room.
      taker.x = 57 * TILE; taker.y = 9 * TILE - taker.h; taker.px = taker.x; taker.py = taker.y;
      other.x = 50 * TILE; other.y = 9 * TILE - other.h; other.px = other.x; other.py = other.y;
      taker.vx = taker.vy = other.vx = other.vy = 0;
      w.cam.x = Math.max(0, taker.x - 128);
      g.tick(4);
      (takerIsLuigi ? hold2 : hold1)({ down: true });
      const tSt = new Set(), oSt = new Set();
      for (let i = 0; i < 160; i++) { g.tick(1); tSt.add(taker.state); oSt.add(other.state); }
      relAll();
      return { area: w.level && w.level.id, taker: tSt.has('pipeexit'), other: oSt.has('pipeexit'),
               bothLive: taker.state === 'normal' && other.state === 'normal' &&
                         !taker.controlsLocked && !other.controlsLocked };
    };
    const c = await ride(false);
    const k = await ride(true);
    return {
      ok: c.taker && !c.other && k.taker && !k.other && c.bothLive && k.bothLive &&
          c.area === '1-1b' && k.area === '1-1b',
      expect: 'taker exits, other does not, both controllable',
      control: `mario enters: exits=${c.taker} other=${c.other} area=${c.area}`,
      coop: `luigi enters: exits=${k.taker} other=${k.other} area=${k.area}`,
    };
  });

  await check('C6', 'hold() drives player one, hold2() drives player two', async () => {
    // Trap 2: the brother being measured is the rightmost, so a move he makes is
    // his own and not the camera clamp shoving him.
    const w = await bed({ x1: 10, x2: 20 });
    const p1 = w.player, p2 = w.player2;
    const move = (fn, who) => {
      const p = who === 'p1' ? p1 : p2;
      const x0 = p.x;
      fn({ right: true });
      g.tick(30);
      relAll();
      return +(p.x - x0).toFixed(2);
    };
    const p2ByHold1 = move(hold1, 'p2');   // must be 0: pad one is not his pad
    const p2ByHold2 = move(hold2, 'p2');
    const p1ByHold1 = move(hold1, 'p1');
    return {
      ok: p2ByHold1 === 0 && p2ByHold2 > 5 && p1ByHold1 > 5,
      expect: 'p2 unmoved by hold(), moved by hold2()',
      control: `p1 by hold() ${p1ByHold1}px`,
      coop: `p2 by hold() ${p2ByHold1}px, by hold2() ${p2ByHold2}px`,
    };
  });

  await check('C7', 'one brother dying does not freeze the other', async () => {
    const w = await bed();
    const p1 = w.player, p2 = w.player2;
    p2.y = FLOOR * TILE - p2.h - 40; p2.vy = -2;
    const y0 = p2.y, x0 = p2.x;
    p1.die('hit');
    hold2({ right: true });
    for (let i = 0; i < 20; i++) g.tick(1);
    relAll();
    const dx = +(p2.x - x0).toFixed(2), dy = +(p2.y - y0).toFixed(2);
    return { ok: dx > 1 && dy > 1 && w.state === 'playing',
             expect: 'survivor keeps moving and falling',
             control: 'n/a (single-player has no survivor)',
             coop: `luigi moved x+${dx} y+${dy}, state ${w.state}` };
  });

  await check('C8', 'a co-op death costs a life only when BOTH fall', async () => {
    const one = await (async () => {
      const w = await bed();
      const before = w.lives;
      w.player.die('hit');
      for (let i = 0; i < 200; i++) g.tick(1);
      return { before, after: w.lives };
    })();
    const both = await (async () => {
      const w = await bed();
      const before = w.lives;
      w.player.die('hit'); w.player2.die('hit');
      for (let i = 0; i < 260; i++) g.tick(1);
      return { before, after: w.lives, state: w.state, roster: w.players.length };
    })();
    const solo = await (async () => {
      const w = await bed({ coop: false });
      const before = w.lives;
      w.player.die('hit');
      for (let i = 0; i < 200; i++) g.tick(1);
      return { before, after: w.lives };
    })();
    return {
      ok: one.after === one.before && both.after === both.before - 1 &&
          both.state === 'playing' && both.roster === 2 && solo.after === solo.before - 1,
      expect: 'one death 0 lives, both 1 life',
      control: `solo death ${solo.before}->${solo.after}`,
      coop: `one ${one.before}->${one.after}, both ${both.before}->${both.after}, roster ${both.roster}`,
    };
  });

  await check('C9', 'a springboard launches both riders', async () => {
    const w = await bed({ x1: 10, x2: 11 });
    const sb = w.spawn('springboard', 10 * TILE, (FLOOR - 1) * TILE);
    if (!sb) throw new Error('PROBE BROKEN: could not spawn a springboard');
    if (typeof sb.place === 'function') sb.place(10 * TILE + TILE / 2, FLOOR * TILE);
    const p1 = w.player, p2 = w.player2;
    const seat = (p) => { p.x = sb.x + (sb.w - p.w) / 2; p.y = sb.y - p.h - 6;
                          p.vx = 0; p.vy = 2; p.px = p.x; p.py = p.y; };
    seat(p1); seat(p2);
    let v1 = 0, v2 = 0;
    for (let i = 0; i < 60; i++) { g.tick(1); v1 = Math.min(v1, p1.vy); v2 = Math.min(v2, p2.vy); }
    return { ok: v1 < -3 && v2 < -3, expect: 'both peak vy < -3',
             control: `mario ${v1.toFixed(2)}`, coop: `luigi ${v2.toFixed(2)}` };
  });

  await check('C10', 'one mushroom powers exactly one brother', async () => {
    const w = await bed({ p1: 'small', p2: 'small', x1: 10, x2: 10 });
    const m = w.spawn('mushroom', 10 * TILE, (FLOOR - 1) * TILE);
    if (!m) throw new Error('PROBE BROKEN: could not spawn a mushroom');
    if (typeof m.place === 'function') m.place(10 * TILE + TILE / 2, FLOOR * TILE);
    const p1 = w.player, p2 = w.player2;
    p1.x = m.x; p2.x = m.x;
    p1.y = FLOOR * TILE - p1.h; p2.y = FLOOR * TILE - p2.h;
    for (let i = 0; i < 40; i++) g.tick(1);
    const grew = [p1.power !== 'small', p2.power !== 'small'].filter(Boolean).length;
    return { ok: grew === 1, expect: 'exactly one grows',
             control: 'n/a', coop: `mario ${p1.power}, luigi ${p2.power} (grew: ${grew})` };
  });

  await check('C11', 'either brother can finish the level', async () => {
    const finish = async (grabberIsLuigi, coop) => {
      const w = await bed({ carve: false, coop });
      let fx = -1;
      for (let tx = 0; tx < w.w && fx < 0; tx++)
        for (let ty = 0; ty < w.h; ty++) if (w.tileAt(tx, ty).char === '|') { fx = tx; break; }
      const grabber = grabberIsLuigi ? w.player2 : w.player;
      const other = grabberIsLuigi ? w.player : w.player2;
      grabber.x = fx * TILE; grabber.y = 8 * TILE; grabber.vx = 0; grabber.vy = 0;
      grabber.px = grabber.x; grabber.py = grabber.y;
      if (other) {
        other.x = (fx - 30) * TILE; other.y = 11 * TILE - other.h;
        other.vx = 0; other.vy = 0; other.px = other.x; other.py = other.y;
      }
      w.cam.x = Math.max(0, grabber.x - 128);
      (grabberIsLuigi ? hold2 : hold1)({ right: true });
      const phases = new Set();
      for (let i = 0; i < 700; i++) {
        g.tick(1);
        if (w.state === 'levelend') phases.add(w.endPhase);
        // Stop AT the assertion target, not past it. Letting a sub-run reach
        // 'complete' advances the game to the next level, and that advance lands
        // asynchronously — after the following bed() has already awaited
        // loadLevel('1-1') — so the NEXT sub-run silently measures 1-2, finds no
        // flagpole column (fx === -1), parks its grabber at x=-16 and reports
        // "luigi never reached the flag". That reads as a co-op bug and is not one.
        // This was latent: it only bites once a sub-run can finish inside 700
        // ticks, which it could not while the end-of-level tally ran at half the
        // original's rate (world.js TALLY_TICKS, smbdis.asm:10487-10502).
        if (phases.has('tally') || w.state === 'complete') break;
      }
      relAll();
      return { phases: [...phases].join('>'), otherAlive: !other || (!other.dead && !other.out) };
    };
    const c = await finish(false, false);
    const k = await finish(true, true);
    const good = (r) => r.phases.includes('tally') && r.otherAlive;
    return { ok: good(c) && good(k), expect: 'reaches tally, other brother alive',
             control: `mario ${c.phases}`,
             coop: `luigi ${k.phases}, other alive=${k.otherAlive}` };
  });

  await check('C12', 'the stomp timer belongs to the brother who is stomping', async () => {
    // ChkETmrs (smbdis.asm:11388-11389) turns a contact that would injure into
    // a stomp while StompTimer is live. That timer is PER PLAYER — it lives in
    // the player's own timer block, not the world's — so one brother stomping
    // must not make the other brother invulnerable to a goomba he is walking
    // into. This project's worst defect of the day was a singleton that meant
    // "the main one" being read as "any one"; C12 exists so the stomp timer
    // cannot become the next one.
    const hit = async (armed) => {
      const w = await bed({ p1: 'big', p2: 'big' });
      const p1 = w.player, p2 = w.player2;
      // Luigi is the rightmost brother by default — trap 2 — so nothing shoves
      // him into or out of the goomba while we measure.
      const foe = w.spawn('goomba', p2.x + 20, FLOOR * TILE - 16, { fromEnemyStream: false });
      if (!foe) throw new Error('PROBE BROKEN: could not spawn a goomba');
      foe.speed = 0; foe.vx = 0;          // `speed` is what walkStep reads, not vx
      g.tick(4);
      if (foe.active === false) throw new Error('PROBE BROKEN: goomba never activated');
      const power0 = p2.power;
      let hurt = false;
      for (let i = 0; i < 30 && !hurt; i++) {
        // Re-arm every frame. The timer decrements once per frame exactly like
        // the ROM's DecTimers, so a one-shot set expires before contact.
        (armed === 'mario' ? p1 : p2).stompTimer = 2;
        p2.x += 1.5; p2.y = FLOOR * TILE - p2.h; p2.vy = 0;
        g.tick(1);
        if (p2.dead || p2.power !== power0) hurt = true;
      }
      return { hurt, other: (armed === 'mario' ? p2 : p1).stompTimer | 0 };
    };
    const byMario = await hit('mario');   // must NOT shield Luigi
    const byLuigi = await hit('luigi');   // Luigi's own timer must shield him
    return {
      ok: byMario.hurt === true && byLuigi.hurt === false,
      expect: "mario's stomp timer does not shield luigi; luigi's own does",
      control: `luigi armed himself -> hurt=${byLuigi.hurt}`,
      coop: `mario armed -> luigi hurt=${byMario.hurt} (luigi's own timer stayed ${byMario.other})`,
    };
  });

  relAll();
  return out;
}, WANT);

await browser.close();
srv.close();

/* ------------------------------------------------------------------ report */

const pad = (s, n) => String(s).padEnd(n);
console.log('CO-OP CHECKS — every co-op result sits beside a single-player control\n');
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${pad(c.id, 4)} ${c.title}`);
  console.log(`        expect : ${c.expect}`);
  console.log(`        control: ${c.control}`);
  console.log(`        co-op  : ${c.coop}`);
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);

if (errors.length) {
  console.error(`\n--- ${errors.length} runtime error(s) ---\n${[...new Set(errors)].slice(0, 20).join('\n')}`);
}
if (failed.length || errors.length) {
  console.error(`\nCO-OP FAILED — ${failed.map((c) => c.id).join(', ') || 'runtime errors'}`);
  process.exit(1);
}
console.log('CO-OP OK.');
