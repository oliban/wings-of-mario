// Localisation. English is the default; Swedish is available from Options.
//
// The stored choice wins over the default, so anyone who has already played and
// picked a language keeps it — flipping the default only changes what a new
// player sees on their first boot.
//
// Everything here is UPPERCASE and restricted to the glyphs the 8x8 font carries
// (A-Z, Å Ä Ö, 0-9 and a little punctuation). Lowercase would silently fall back
// to uppercase anyway, and an unknown glyph renders as a space, so strings are
// authored in the exact form they are drawn.
//
// Usage:
//   import { t, setLang, getLang, LANGS } from '../i18n.js';
//   drawTextCentered(ctx, t('gameOver'), 120);
//
// t() returns the key itself if a string is missing, which makes a gap obvious
// on screen instead of blanking the line.

const KEY = 'smb.lang.v1';

export const LANGS = ['sv', 'en'];

export const LANG_NAMES = { sv: 'SVENSKA', en: 'ENGLISH' };

const STRINGS = {
  sv: {
    // title + menu
    onePlayer: '1 SPELARE',
    twoPlayer: '2 SPELARE',
    harryMode: 'HARRY-LÄGE',
    options: 'INSTÄLLNINGAR',
    pushStart: 'TRYCK START',
    subtitle: 'ORIGINAL HYLLNING 2026',
    top: 'BÄST',

    // HUD
    mario: 'MARIO',
    luigi: 'LUIGI',
    world: 'VÄRLD',
    time: 'TID',
    score: 'POÄNG',
    lives: 'LIV',

    // states
    gameOver: 'SPELET SLUT',
    pause: 'PAUS',
    timeUp: 'TIDEN UTE',
    courseClear: 'BANAN KLAR',
    points: 'POÄNG ',
    player1: 'SPELARE 1',
    player2: 'SPELARE 2',

    // castle ending
    thankYou: 'TACK MARIO!',
    anotherCastleA: 'MEN PRINSESSAN ÄR I',
    anotherCastleB: 'ETT ANNAT SLOTT!',
    notBuiltA: 'MEN SPELET ÄR INTE',
    notBuiltB: 'HELT FÄRDIGBYGGT ÄN',

    // 8-4's real ending. Five separate messages, staggered — see
    // PrincessEndScreen for why they are five and not one block.
    questOver: 'DIN FÄRD ÄR ÖVER.',
    newQuest: 'VI GER DIG EN NY FÄRD.',
    pushButtonB: 'TRYCK KNAPP B',
    toSelectWorld: 'FÖR ATT VÄLJA VÄRLD',

    // options
    video: 'BILD',
    music: 'MUSIK',
    sound: 'LJUD',
    language: 'SPRÅK',
    controls: 'KONTROLLER',
    back: 'TILLBAKA',
    filterHint: 'FILTER  F',
    pauseHint: 'PAUS  ENTER',
  },

  en: {
    onePlayer: '1 PLAYER GAME',
    twoPlayer: '2 PLAYER GAME',
    harryMode: 'HARRY MODE',
    options: 'OPTIONS',
    pushStart: 'PUSH START BUTTON',
    subtitle: 'ORIGINAL HOMAGE 2026',
    top: 'TOP',

    mario: 'MARIO',
    luigi: 'LUIGI',
    world: 'WORLD',
    time: 'TIME',
    score: 'SCORE',
    lives: 'LIVES',

    gameOver: 'GAME OVER',
    pause: 'PAUSE',
    timeUp: 'TIME UP',
    courseClear: 'COURSE CLEAR',
    points: 'POINTS ',
    player1: 'PLAYER 1',
    player2: 'PLAYER 2',

    thankYou: 'THANK YOU MARIO!',
    anotherCastleA: 'BUT OUR PRINCESS IS IN',
    anotherCastleB: 'ANOTHER CASTLE!',
    notBuiltA: 'BUT THE GAME IS YET',
    notBuiltB: 'TO BE COMPLETELY BUILT',

    questOver: 'YOUR QUEST IS OVER.',
    newQuest: 'WE PRESENT YOU A NEW QUEST.',
    pushButtonB: 'PUSH BUTTON B',
    toSelectWorld: 'TO SELECT A WORLD',

    video: 'VIDEO',
    music: 'MUSIC',
    sound: 'SOUND',
    language: 'LANGUAGE',
    controls: 'CONTROLS',
    back: 'BACK',
    filterHint: 'FILTER  F',
    pauseHint: 'PAUSE   ENTER',
  },
};

function stored() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(KEY);
    return LANGS.includes(v) ? v : null;
  } catch (e) {
    return null; // Safari private mode throws on access
  }
}

// Swedish unless the player has explicitly chosen otherwise.
let current = stored() || 'en';

export function getLang() {
  return current;
}

export function setLang(lang) {
  if (!LANGS.includes(lang)) return current;
  current = lang;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, lang);
  } catch (e) {
    /* not persistable; the session still switches */
  }
  return current;
}

export function cycleLang(dir = 1) {
  const i = LANGS.indexOf(current);
  const n = LANGS.length;
  return setLang(LANGS[(((i + dir) % n) + n) % n]);
}

// Harry mode renames the hero everywhere he is addressed by name — the HUD label,
// Toad's line at the castle, the game-over card. Strings are authored with MARIO
// and substituted at lookup, so no table needs duplicating per mode.
let hero = null;

export function setHero(name) {
  hero = name || null;
  return hero;
}

export function getHero() {
  return hero || 'MARIO';
}

export function t(key) {
  const table = STRINGS[current] || STRINGS.sv;
  const v = table[key];
  const raw = typeof v === 'string' ? v : STRINGS.en[key];
  if (typeof raw !== 'string') return String(key).toUpperCase();
  return hero ? raw.split('MARIO').join(hero) : raw;
}

export default t;
