// THE PRINCESS, on the screen, and the restart that follows her.
//
// The half of the ending that needs a drawing context and a live Game. The
// wording, the ROM row/column of every line, the frame each one appears on and
// the enemy rewrite are all in src/wings/second-quest.js, which is pure and
// testable in plain Node; this file only paints them and does the wiring.
//
// WHY IT IS A WRAP AND NOT AN ENGINE EDIT. src/main.js:359 already routes every
// castle through `screens.showCastleEnd`, and the Screens manager runs whatever
// object is sitting in `screens.castle` (src/ui/screens.js:1582, 1620). So the
// whole scene is: swap that one property for the duration of the call, and put
// the Toad card back afterwards. src/main.js, src/game/** and index.html are
// untouched, and so is src/ui/screens.js — the fork's diff against upstream
// stays at the 150 lines MODS.md accounts for.

import { CastleEndScreen } from '../ui/screens.js';
import { hud, drawText, GLYPH_W } from '../ui/hud.js';
import { SCREEN_W, SCREEN_H } from '../core/constants.js';
import { input, BTN } from '../core/input.js';
import * as bossMod from '../data/sprites/boss.js';
import {
  PRINCESS_MESSAGES,
  PRINCESS_HOLD,
  VICTORY_MUSIC_AT,
  armSecondQuest,
  disarmSecondQuest,
  guardSecondQuest,
} from './second-quest.js';

// The last castle. Not "the level with no next level": Harry's sequence also
// ends, and a level that upstream has not built yet would end too, and neither
// of those is the Princess.
export const FINAL_CASTLE = '8-4';

// Which lines are up at tick `t`. Split out so a test can assert the stagger —
// that "YOUR QUEST IS OVER." is NOT on screen while Mario is still being
// thanked — without a canvas.
export function messagesAt(t) {
  return PRINCESS_MESSAGES.filter((m) => t >= m.at);
}

// The tick the last line lands on, and therefore the earliest the card will
// listen to a button.
export const LAST_LINE_AT = PRINCESS_MESSAGES[PRINCESS_MESSAGES.length - 1].at;

// B is the original's button. START and JUMP come along because every other
// card in this game closes on them and one that ignored them would read as
// frozen.
const dismissed = () =>
  input.pressed(BTN.RUN) || input.pressed(BTN.START) || input.pressed(BTN.JUMP);

export class PeachEndScreen extends CastleEndScreen {
  constructor(opts = {}) {
    super({ ...opts, hold: opts.hold == null ? PRINCESS_HOLD : opts.hold });
    // Queued once, on the tick the original queues it (see VICTORY_MUSIC_AT).
    // Presentation is injected rather than imported: src/ui/screens.js keeps
    // its `music()` helper private, and this class must stay constructible in a
    // test that has no audio device.
    this.onMusic = opts.onMusic || null;
    this._musicDone = false;
  }

  show(world, opts = {}) {
    this._musicDone = false;
    return super.show(world, opts);
  }

  // Deliberately NOT super.update(). The base card closes on START or JUMP
  // after 90 frames, which here would let the player skip past the Princess
  // before she has said anything: PlayerEndWorld (asm:1232-1247) does not look
  // at the controller until every message is up and WorldEndTimer has expired.
  // So the button rule is the ROM's, and the rest of the body is the base
  // class's three lines rather than a call that would undo them.
  update() {
    if (!this.running) return this;
    this.t++;
    if (!this._musicDone && this.t >= VICTORY_MUSIC_AT) {
      this._musicDone = true;
      if (this.onMusic) this.onMusic('ending');
    }
    if (this.t >= LAST_LINE_AT && dismissed()) this.running = false;
    // `hold` still ends it unattended: a two-player match must not sit on a
    // card forever waiting for a man who has put the pad down.
    if (this.t >= this.hold) this.running = false;
    return this;
  }

  draw(ctx) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    if (this.showHud) hud.draw(ctx, this.world);

    // She stands above her own words. The original prints them over the castle
    // room she is standing in, which this black card is not, so the one thing
    // that cannot be the ROM's is her position: it takes the card's own idiom
    // (portrait above, text below, as the Toad card does) and leaves every LINE
    // exactly where the ROM's VRAM address puts it.
    const art = bossMod.PEACH && bossMod.PEACH.idle;
    const s = art && (art.frame ? art.frame(this.t) : art);
    if (s && typeof s.draw === 'function') s.draw(ctx, (SCREEN_W - s.w) >> 1, 48);

    for (const m of messagesAt(this.t)) {
      drawText(ctx, m.text, m.col * GLYPH_W, m.row * GLYPH_W, m.at === 0 ? 'gold' : 'white');
    }
    return this;
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const INSTALLED = Symbol.for('wings.peachEnding');

// `g` is window.__GAME. Idempotent, and safe to call before the game exists —
// which is the whole reason it is called from a poll in mario-main.js rather
// than at module load.
export function installPeachEnding(g) {
  if (!g || !g.game || !g.screens || g.screens[INSTALLED]) return false;
  const { game, screens } = g;
  const audio = g.audio || null;
  g.screens[INSTALLED] = true;

  const peach = new PeachEndScreen({
    onMusic: (name) => {
      try {
        if (audio && typeof audio.music === 'function') audio.music(name);
      } catch (e) {
        /* the fanfare is cosmetic; never strand the player on the card */
      }
    },
  });

  // 1. THE SCENE. Swapped in for one showing and swapped straight back out, so
  //    the other seven castles still get Toad and his own words.
  const showCastleEnd = screens.showCastleEnd.bind(screens);
  screens.showCastleEnd = (world, opts = {}) => {
    if (game.levelId !== FINAL_CASTLE) return showCastleEnd(world, opts);
    const toad = screens.castle;
    screens.castle = peach;
    const done = () => {
      screens.castle = toad;
    };
    return Promise.resolve(showCastleEnd(world, opts)).then(
      (v) => {
        done();
        return v;
      },
      (e) => {
        done();
        throw e;
      }
    );
  };

  // 2. THE QUEST. Upstream tears the run down and returns to the title once
  //    there is no next level (src/main.js:376). The original does not: it puts
  //    you back on 1-1 with PrimaryHardMode set. `cleared` is what tells the two
  //    calls apart — onLevelComplete passes it, onGameOver does not — and a
  //    game over still goes to the title and still clears the flag, because the
  //    next game from the title is quest 1 again.
  //
  //    startGame() rather than a hand-rolled reset: it makes fresh slots (three
  //    lives, no score, back to 1-1), keeps the player count and the Harry flag,
  //    and shows the intro card, which is every part of "start again" already
  //    written down once.
  const endSession = game.endSession.bind(game);
  game.endSession = async (opts = {}) => {
    if (!opts || !opts.cleared) {
      disarmSecondQuest(game.world);
      return endSession(opts);
    }
    armSecondQuest(game.world, (game.world && game.world.quest ? game.world.quest : 1) + 1);
    return game.startGame(game.playerCount);
  };

  // The scripted surface, alongside __TELEGRAPH's and __PARCEL's and assigned
  // for the same reason. READ-ONLY on purpose: there is no method here that
  // arms the quest, because a test that could ask for one would never prove
  // that clearing 8-4 arms it.
  if (typeof window !== 'undefined') {
    window.__QUEST = {
      // 1 until 8-4 has been cleared once, then 2, 3, ...
      n: () => (game.world && game.world.quest) || 1,
      hard: () => ({
        primary: !!(game.world && game.world.primaryHardMode),
        secondary: !!(game.world && game.world.hardMode),
      }),
      // The Princess, if she is the card in front of you: how long she has been
      // up and which of her lines have appeared so far. Null for Toad's card
      // and null when no card is up at all, so a test can tell the two endings
      // apart without reading pixels.
      card: () =>
        screens.state === 'castle' && screens.castle === peach
          ? { t: peach.t, hold: peach.hold, lines: messagesAt(peach.t).map((m) => m.text) }
          : null,
      // What the level ACTUALLY spawned. The rewrite happens on the specs, so
      // this is the only reading that proves the engine built buzzy beetles
      // rather than that our copy of the list said it would.
      walkers: () => {
        const w = game.world;
        if (!w || !w.entities) return [];
        return w.entities
          .filter((e) => e && (e.type === 'goomba' || e.type === 'buzzy' || e.type === 'koopa'))
          .map((e) => ({ type: e.type, speed: e.speed, winged: !!e.winged }));
      },
    };
  }

  return true;
}

// The enemy rewrite goes on the world, and a world is rebuilt by a death and a
// pipe as well as by a load — so this belongs on the caller's per-tick hook
// list, next to the toolbelt seeder and the flat throw. The wrap is idempotent
// and does nothing at all until the quest is armed.
export function stepSecondQuest(world) {
  return guardSecondQuest(world);
}

export default installPeachEnding;
