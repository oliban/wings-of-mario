import { SCREEN_W, SCREEN_H, LAYER, DT } from './core/constants.js';
import { bakeAll, spriteCount } from './core/gfx.js';
import { GameLoop } from './core/loop.js';
import input, { BTN, pad2, updateAll } from './core/input.js';
import rng from './core/rng.js';

import renderer from './render/renderer.js';
import World from './game/world.js';
import particles from './fx/particles.js';
import { screens, options } from './ui/screens.js';
import { drawHud } from './ui/hud.js';

import audio from './audio/engine.js';
import playSfx, { SFX_NAMES, hasSfx } from './audio/sfx.js';
import { playMusic, stopMusic, pauseMusic, resumeMusic, starMusic, setHurry } from './audio/music.js';

import { getLevel, nextLevel, firstLevel, ORDER } from './data/levels/index.js';
import { headFor, harryReady } from './data/sprites/harry.js';
import { t, setHero } from './i18n.js';

const boot = document.getElementById('boot');
const bootBar = boot && boot.querySelector('.bar i');
const HEADLESS = new URLSearchParams(location.search).has('headless');

function progress(pct, label) {
  if (bootBar) bootBar.style.width = `${Math.round(pct * 100)}%`;
  if (boot && label) boot.childNodes[0].nodeValue = label;
}

// Gameplay modules were written in parallel and each invented its own names for the
// same sounds ('1up' / 'oneup' / 'one-up'). Rather than edit a dozen files, the host
// owns the vocabulary: every alias below resolves to a real effect in sfx.js.
const SFX_ALIAS = {
  '1up': 'one-up',
  oneup: 'one-up',
  powerup: 'powerup-collect',
  grow: 'powerup-collect',
  star: 'powerup-collect',
  'item-appear': 'powerup-appear',
  sprout: 'powerup-appear',
  powerdown: 'pipe',
  warp: 'pipe',
  castle: 'pipe',
  jump: 'jump-small',
  'jump-super': 'jump-big',
  kick: 'kick-shell',
  squish: 'stomp',
  die: 'death',
  mariodie: 'death',
  fire: 'fireball',
  shoot: 'fireball',
  throw: 'fireball',
  stroke: 'swim',
  flag: 'flagpole',
  'flagpole-land': 'bump',
  'block-bump': 'bump',
  bowserfall: 'bowser-fall',
  bowserfire: 'enemy-fire',
  rocket: 'firework',
};

function resolveSfx(name) {
  if (!name) return null;
  if (hasSfx(name)) return name;
  const alias = SFX_ALIAS[name];
  return alias && hasSfx(alias) ? alias : null;
}

// A lookup table of every name the game may legitimately ask for. player.js probes
// this (`a.SFX`) to choose from its fallback chain; without it, it always fires the
// first name in the chain, which is often the one that does not exist.
const SFX_TABLE = {};
for (const n of SFX_NAMES) SFX_TABLE[n] = true;
for (const a of Object.keys(SFX_ALIAS)) if (resolveSfx(a)) SFX_TABLE[a] = true;

// The world talks to audio through this narrow pair so a failure in one sound can
// never take down a frame of gameplay.
const audioFacade = {
  SFX: SFX_TABLE,
  sfx(name, opts) {
    const real = resolveSfx(name);
    if (!real) {
      warnOnce(`sfx-unknown:${name}`, new Error(`no effect named "${name}"`));
      return;
    }
    try {
      playSfx(real, opts);
    } catch (e) {
      warnOnce(`sfx:${real}`, e);
    }
  },
  music(name, opts) {
    try {
      if (name == null) stopMusic(opts && opts.fade);
      else playMusic(name, opts);
    } catch (e) {
      warnOnce(`music:${name}`, e);
    }
  },
  star(on) {
    try {
      starMusic(!!on);
    } catch (e) {
      warnOnce('starMusic', e);
    }
  },
  hurry(on) {
    try {
      setHurry(!!on);
    } catch (e) {
      warnOnce('setHurry', e);
    }
  },
};

const warned = new Set();
function warnOnce(key, err) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[audio] ${key} failed:`, err && err.message ? err.message : err);
}

class Game {
  constructor() {
    this.world = null;
    this.loop = null;
    this.levelId = firstLevel ? firstLevel() : ORDER[0];
    this.started = false;
    this.playerCount = 1;
    this.harryMode = false;
    this.turn = 0;
    this.slots = [this.newSlot(), this.newSlot()];
    this.audioUnlocked = false;
    this.scripted = false;
    this.fatal = null;
  }

  async boot() {
    if (HEADLESS) document.body.classList.add('headless');

    progress(0.1, 'RENDERER');
    renderer.init({ canvas: document.getElementById('screen'), keys: !HEADLESS });

    progress(0.25, 'ART');
    const baked = bakeAll();
    await harryReady;

    progress(0.5, 'WORLD');
    this.world = new World({
      onLevelComplete: (w) => this.onLevelComplete(w),
      onGameOver: (w) => this.onGameOver(w),
      onLifeLost: (w) => this.onLifeLost(w),
      onWarpLevel: (id, to) => this.onWarpLevel(id, to),
    });
    this.world.setParticles(particles);
    this.world.setAudio(audioFacade);

    progress(0.7, 'UI');
    screens.attach({ world: this.world, renderer, audio });
    // The menu delivers its choice through this callback — screens.update() returns
    // the Screens instance, not the selection.
    screens.onSelect = (choice) => this.onMenuSelect(choice);

    progress(0.85, 'INPUT');
    input.attach(window);
    this._bindGestures();

    progress(1, 'READY');

    this.loop = new GameLoop(
      () => this.update(),
      (alpha) => this.render(alpha)
    );

    // Load the opening level so the very first rendered frame is real content.
    await this.loadLevel(this.levelId);

    if (!HEADLESS) {
      await screens.showTitle();
    }

    if (boot) boot.classList.add('gone');
    if (!HEADLESS) this.loop.start();

    console.info(
      `[boot] ${baked} sprites baked (${spriteCount()} registered), ${ORDER.length} levels available.`
    );
    return this;
  }

  _bindGestures() {
    const unlock = () => {
      if (this.audioUnlocked) return;
      this.audioUnlocked = true;
      try {
        if (typeof audio.unlock === 'function') audio.unlock();
        else if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
      } catch (e) {
        warnOnce('unlock', e);
      }
    };
    for (const ev of ['keydown', 'pointerdown', 'touchstart']) {
      window.addEventListener(ev, unlock, { once: false, passive: true });
    }
    // Dim the control hint once the player clearly knows the controls.
    const hint = document.getElementById('hint');
    if (hint) {
      window.addEventListener(
        'keydown',
        () => {
          setTimeout(() => hint.classList.add('gone'), 2500);
        },
        { once: true }
      );
    }
  }

  async loadLevel(id, areaId = null, opts = {}) {
    const lvl = getLevel(id);
    if (!lvl) {
      console.error(`[main] unknown level "${id}"`);
      return false;
    }
    this.levelId = id;
    const [w, l] = String(id).split('-');
    this.world.worldNum = parseInt(w, 10) || 1;
    this.world.levelNum = parseInt(l, 10) || 1;
    this.world.loadLevel(lvl, areaId, opts);
    if (this.world.level && this.world.level.music !== undefined) {
      audioFacade.music(this.world.level.music);
    } else {
      audioFacade.music(this.world.theme || 'overworld');
    }
    return true;
  }

  onMenuSelect(choice) {
    if (choice === 'options') {
      screens.showOptions();
      return;
    }
    this.harryMode = choice === 'harry';
    this.startGame(choice === 'start2' ? 2 : 1);
  }

  // SMB two-player is alternating, not co-op: each player keeps their own score,
  // coins, lives and level, and the turn passes when the active one dies.
  newSlot() {
    return {
      score: 0,
      coins: 0,
      lives: 3,
      levelId: firstLevel ? firstLevel() : ORDER[0],
      checkpoint: false,
      over: false,
    };
  }

  saveSlot() {
    const s = this.slots && this.slots[this.turn];
    if (!s) return;
    s.score = this.world.score;
    s.coins = this.world.coins;
    s.lives = this.world.lives;
    s.levelId = this.levelId;
    s.checkpoint = !!this.world.checkpointReached;
  }

  playerLabel(i = this.turn) {
    if (this.playerCount < 2) return null;
    return i === 0 ? t('player1') : t('player2');
  }

  // The HUD's left label follows who is actually playing.
  syncPlayerName() {
    if (!this.world) return;
    setHero(this.harryMode ? 'HARRY' : null);
    if (this.harryMode) this.world.playerName = 'HARRY';
    else if (this.playerCount > 1) this.world.playerName = this.turn === 0 ? t('mario') : t('luigi');
    else this.world.playerName = null;
  }

  async startGame(players = 1) {
    this.playerCount = players === 2 ? 2 : 1;
    // Two-player is SIMULTANEOUS co-op: both brothers are live at once, Luigi on
    // the second pad, rather than SMB's alternating turns.
    this.world.coop = this.playerCount === 2;
    this.world.coopPad = pad2;
    this.slots = [this.newSlot(), this.newSlot()];
    this.turn = 0;
    this.started = true;
    this.syncPlayerName();
    await this.enterTurn();
  }

  // Load the active slot's level and show its intro card.
  async enterTurn() {
    this.syncPlayerName();
    const s = this.slots[this.turn];
    this.world.score = s.score;
    this.world.coins = s.coins;
    this.world.lives = s.lives;
    await this.loadLevel(s.levelId, null, {
      resetPlayer: true,
      fromCheckpoint: s.checkpoint,
    });
    await screens.showIntro(this.world, { label: this.playerLabel() });
  }

  // Hand over to the other player if they still have a game left. Returns false
  // when nobody else can play, which means a real game over.
  async passTurn() {
    // Simultaneous co-op shares one life pool — there are no alternating turns.
    if (this.world && this.world.coop) return false;
    if (this.playerCount < 2) return false;
    const other = this.turn === 0 ? 1 : 0;
    if (this.slots[other].over) return false;
    this.turn = other;
    await this.enterTurn();
    return true;
  }

  onLevelComplete() {
    (async () => {
      try {
        await screens.showTally(this.world);
      } catch (e) {
        /* tally is cosmetic */
      }
      const next = nextLevel(this.levelId);
      const s = this.slots[this.turn];
      // Beating a castle gets the classic Toad scene before anything else.
      if (this.world.theme === 'castle' || /-4$/.test(String(this.levelId))) {
        await screens.showCastleEnd(this.world, {
          lines: next
            ? [t('thankYou'), t('anotherCastleA'), t('anotherCastleB')]
            : [t('thankYou'), t('notBuiltA'), t('notBuiltB')],
        });
      }
      if (next) {
        this.saveSlot();
        s.levelId = next;
        s.checkpoint = false;
        await this.loadLevel(next, null, { fromCheckpoint: false });
        await screens.showIntro(this.world, { label: this.playerLabel() });
      } else {
        s.over = true;
        this.saveSlot();
        if (await this.passTurn()) return;
        await this.endSession({ cleared: true });
      }
    })();
    return true;
  }

  onLifeLost() {
    (async () => {
      this.saveSlot();
      // Dying always costs the power-up in SMB — you come back as small Mario.
      // world._placePlayer only resets the form when resetPlayer is set.
      if (await this.passTurn()) return;
      await this.loadLevel(this.levelId, null, {
        fromCheckpoint: this.world.checkpointReached,
        resetPlayer: true,
      });
      await screens.showIntro(this.world, { label: this.playerLabel() });
    })();
    return true;
  }

  // A pipe that leads out of the level entirely (the warp zone). The slot's
  // level id moves with the player, so dying in world 2 restarts world 2 rather
  // than dumping you back where the pipe was.
  onWarpLevel(id, to) {
    (async () => {
      const s = this.slots && this.slots[this.turn];
      if (s) {
        s.levelId = id;
        s.checkpoint = false;
        this.saveSlot();
      }
      const ok = await this.loadLevel(id, (to && to.area) || null, { fromCheckpoint: false });
      if (!ok) return;
      await screens.showIntro(this.world, { label: this.playerLabel() });
    })();
    return true;
  }

  onGameOver() {
    (async () => {
      const s = this.slots && this.slots[this.turn];
      if (s) {
        s.over = true;
        this.saveSlot();
      }
      try {
        await screens.showGameOver(this.world);
      } catch (e) {
        /* the game-over card is cosmetic; never strand the player on it */
      }
      // The other player may still have lives left in a two-player game.
      if (await this.passTurn()) return;
      await this.endSession();
    })();
    return true;
  }

  // Tear the run down BEFORE returning to the title so a new game can never
  // inherit the level, lives or score of the one that just ended.
  async endSession() {
    this.started = false;
    this.playerCount = 1;
    this.slots = [this.newSlot(), this.newSlot()];
    this.turn = 0;
    this.world.lives = 3;
    this.world.score = 0;
    this.world.coins = 0;
    this.world.checkpointReached = false;
    await this.loadLevel(firstLevel ? firstLevel() : ORDER[0], null, { resetPlayer: true });
    this.world.state = 'idle';
    await screens.showTitle();
  }

  update() {
    if (this.fatal) return;
    try {
      updateAll();

      if (input.pressed(BTN.START) && this.started && !screens.blocksWorld) {
        screens.togglePause();
        audioFacade.sfx('pause');
        if (screens.paused) pauseMusic();
        else resumeMusic();
      }

      screens.update();

      if (!screens.blocksWorld && !screens.paused) {
        this.world.update();
      }
    } catch (e) {
      this.crash(e);
    }
  }

  render() {
    if (this.fatal) return;
    try {
      // A level may override the sky without changing its theme. The original
      // picks the backdrop from a palette index, not from the area type: with
      // BackgroundColorCtrl at 4 or more it selects black, which is how 3-1,
      // 3-2 and 3-3 are night while still being ordinary overworld levels.
      // Overriding the sky alone keeps every tile, prop and animation resolving
      // through the existing theme tables. Read off `level` rather than the
      // root, so a sub-area can differ from the level that contains it.
      const lvl = this.world && this.world.level;
      const sky = renderer.skyColor((lvl && lvl.sky) || (this.world && this.world.theme));
      renderer.beginFrame(sky);
      if (this.world && this.world.level) this.world.submit(renderer);
      if (this.started && !screens.hudOwned) {
        renderer.draw(LAYER.HUD, (ctx) => drawHud(ctx, this.world));
      }
      screens.submit(renderer);
      renderer.flush();
      renderer.present();
      this.drawHarryOverlay();
    } catch (e) {
      this.crash(e);
    }
  }

  // Harry's photo is painted on the overlay canvas at DISPLAY resolution, so it
  // stays sharp instead of being quantised to the 256x240 framebuffer and then
  // nearest-neighbour upscaled with everything else.
  drawHarryOverlay() {
    const cv = document.getElementById('overlay');
    if (!cv) return;
    const src = renderer.canvas;
    if (!src) return;

    if (cv.width !== src.width || cv.height !== src.height) {
      cv.width = src.width;
      cv.height = src.height;
    }
    cv.style.width = src.style.width;
    cv.style.height = src.style.height;

    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!this.harryMode) return;

    const w = this.world;
    const p = w && w.player;
    if (!p || p.hidden || p.removed || !w.level || screens.blocksWorld) return;
    const h = headFor(p);
    if (!h) return;

    // Game pixels -> display pixels. The framebuffer is SCREEN_W wide, the display
    // canvas is SCREEN_W * deviceScale, so one game pixel is `k` device pixels.
    const k = src.width / SCREEN_W;
    const cam = w.rcam;
    const gx = p.x + h.dx - cam.x;
    const gy = p.y + h.dy - cam.y;
    if (gx + h.w < 0 || gx > SCREEN_W || gy + h.h < 0 || gy > SCREEN_H) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(h.img, gx * k, gy * k, h.w * k, h.h * k);
  }

  crash(e) {
    if (this.fatal) return;
    this.fatal = e;
    console.error('[fatal]', e);
    if (this.loop) this.loop.stop();
    try {
      const ctx = renderer.ctx || (renderer.buffer && renderer.buffer.getContext('2d'));
      if (ctx) {
        ctx.fillStyle = '#180000';
        ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
        renderer.tinyText(ctx, 'RUNTIME ERROR', 8, 8, '#ff6b6b');
        const msg = String((e && e.message) || e).slice(0, 120);
        renderer.tinyText(ctx, msg.slice(0, 40), 8, 24, '#ffffff');
        renderer.tinyText(ctx, msg.slice(40, 80), 8, 34, '#ffffff');
        renderer.tinyText(ctx, msg.slice(80, 120), 8, 44, '#ffffff');
        renderer.present();
      }
    } catch (_) {
      /* the crash screen itself must never throw */
    }
  }
}

const game = new Game();

const ready = game.boot().catch((e) => {
  console.error('[boot] failed:', e);
  game.crash(e);
  throw e;
});

// ---------------------------------------------------------------------------
// Debug / capture API — ARCHITECTURE.md section 10. tools/shot.mjs drives this.
// ---------------------------------------------------------------------------
window.__GAME = {
  game,
  ready,
  get world() {
    return game.world;
  },
  renderer,
  audio,
  particles,
  screens,
  options,
  rng,

  async loadLevel(id, areaId = null, damage = []) {
    // Pass damage THROUGH the options bag, not after the fact: game.loadLevel
    // forwards opts to world.loadLevel, which subtracts the damage right after
    // the tile map is rebuilt and before decor, landmarks, the player and the
    // entities read it. Applying it after the load returns would place all of
    // them on ground that only vanishes afterwards.
    const ok = await game.loadLevel(id, areaId, damage && damage.length ? { damage } : {});
    screens.hide();
    game.started = true;
    game.world.state = 'playing';
    // Settle the camera and one frame of entity activation before capture.
    game.loop.step(1);
    return ok;
  },

  teleport(tileX, tileY) {
    const p = game.world && game.world.player;
    if (!p) return false;
    p.x = tileX * 16;
    p.y = tileY * 16 - (p.h || 16);
    p.vx = 0;
    p.vy = 0;
    const cam = game.world.cam;
    const maxX = Math.max(0, game.world.w * 16 - SCREEN_W);
    cam.x = Math.max(0, Math.min(maxX, p.x - SCREEN_W / 2));
    if (typeof cam.snap === 'function') cam.snap(p);
    game.world.rcam.x = cam.x;
    game.world.rcam.y = cam.y;
    return true;
  },

  blast(cx, cy, radiusTiles) {
    const w = game.world;
    return w ? w.blast(cx, cy, radiusTiles) : [];
  },

  destroyTiles(keys) {
    const w = game.world;
    return w ? w.destroyTiles(keys) : [];
  },

  damageKeys() {
    const w = game.world;
    return w ? [...w.damage].sort() : [];
  },

  setPower(power) {
    const p = game.world && game.world.player;
    if (!p) return false;
    if (power === 'star') {
      if (typeof p.giveStar === 'function') p.giveStar();
      else p.starTimer = 660;
    } else if (typeof p.setPower === 'function') {
      p.setPower(power, true);
    } else {
      p.power = power;
    }
    return true;
  },

  hold(map) {
    game.scripted = true;
    input.force({
      left: !!map.left,
      right: !!map.right,
      up: !!map.up,
      down: !!map.down,
      jump: !!map.jump,
      run: !!map.run,
      start: !!map.start,
      select: !!map.select,
    });
    return true;
  },

  release() {
    game.scripted = false;
    input.release();
    return true;
  },

  tick(n = 1) {
    for (let i = 0; i < n; i++) {
      game.update();
      game.loop.tick++;
    }
    game.render(1);
    return game.loop.tick;
  },

  pause() {
    game.loop.stop();
    return true;
  },

  resume() {
    game.loop.start();
    return true;
  },

  async showTitle() {
    game.started = false;
    await screens.showTitle();
    game.loop.step(1);
    return true;
  },

  setPreset(name) {
    renderer.setPreset(name);
    game.render(1);
    return name;
  },

  setPost(name, on = true) {
    renderer.setPost(name, on);
    return true;
  },

  stats() {
    const w = game.world;
    const p = w && w.player;
    return {
      fps: game.loop ? Math.round(game.loop.fps) : 0,
      tick: game.loop ? game.loop.tick : 0,
      backend: renderer.backend,
      preset: renderer._preset,
      level: game.levelId,
      theme: w ? w.theme : null,
      entities: w ? w.entities.length : 0,
      particles: particles ? particles.count : null,
      state: w ? w.state : null,
      playerState: p ? p.state : null,
      power: p ? p.power : null,
      x: p ? Math.round(p.x) : null,
      y: p ? Math.round(p.y) : null,
      vx: p ? Number(p.vx.toFixed(4)) : null,
      vy: p ? Number(p.vy.toFixed(4)) : null,
      grounded: p ? !!p.grounded : null,
      score: w ? w.score : null,
      coins: w ? w.coins : null,
      lives: w ? w.lives : null,
      time: w ? w.time : null,
      fatal: game.fatal ? String(game.fatal.message || game.fatal) : null,
    };
  },
};

export default game;
