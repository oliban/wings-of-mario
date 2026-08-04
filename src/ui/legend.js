// Desktop key legend. Built FROM the keymaps rather than from hand-written
// strings: a binding can never drift out of the panel, because the panel is the
// keymap. Hidden on phones (the joypad is the input there) and in body.headless.

import { BTN, KEYMAP_P1, KEYMAP_P2 } from '../core/input.js';

const GLYPH = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Space: 'SPACE',
  Enter: 'ENTER',
  Escape: 'ESC',
  Tab: 'TAB',
  ShiftLeft: 'SHIFT',
  ShiftRight: 'SHIFT',
  Period: '.',
  Comma: ',',
  Slash: '/',
};

const label = (code) =>
  GLYPH[code] ||
  (code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : code);

// action rows, in the order a player learns them
const ROWS = [
  { name: 'MOVE', btns: [BTN.LEFT, BTN.RIGHT, BTN.UP, BTN.DOWN] },
  { name: 'JUMP', btns: [BTN.JUMP] },
  { name: 'RUN', btns: [BTN.RUN] },
  { name: 'PAUSE', btns: [BTN.START] },
  // BACK exists on the keyboard only — no joypad button maps to it.
  { name: 'BACK', btns: [BTN.BACK] },
];
const P2_ROWS = [ROWS[0], ROWS[1], ROWS[2]];
// Harry's toolbelt: one more P1 control, named for what it does rather than for
// the button, revealed in place rather than in a box of its own.
const TOOLBELT = { name: 'BRICK BOMB', btns: [BTN.SELECT], note: 'COSTS 5 COINS' };

function keysFor(map, btns) {
  const seen = new Set();
  const out = [];
  for (const [code, b] of Object.entries(map)) {
    const list = Array.isArray(b) ? b : [b];
    if (!list.some((x) => btns.includes(x))) continue;
    const k = label(code);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

const row = (r, cls = '') =>
  `<div class="lg-row ${cls}"><span class="lg-act">${r.name}</span><span class="lg-keys">${r.keys
    .map((k) => `<kbd>${k}</kbd>`)
    .join('')}</span></div>`;

function group(tag, map, rowSet = ROWS, extra = '') {
  const rows = rowSet.map((r) => ({ name: r.name, keys: keysFor(map, r.btns) })).filter((r) => r.keys.length);
  if (!rows.length) return '';
  return `<div class="lg-group"><div class="lg-tag">${tag}</div>${rows.map((r) => row(r)).join('')}${extra}</div>`;
}

const el = document.createElement('div');
el.id = 'legend';
el.setAttribute('aria-hidden', 'true');
// The toolbelt rows live INSIDE P1 and are always laid out — only their
// visibility changes — so revealing them cannot make the rows below jump.
const toolbeltRows =
  row({ name: TOOLBELT.name, keys: keysFor(KEYMAP_P1, TOOLBELT.btns) }, 'lg-toolbelt') +
  `<div class="lg-row lg-toolbelt lg-note">${TOOLBELT.note}</div>`;

el.innerHTML = group('P1', KEYMAP_P1, ROWS, toolbeltRows) + group('P2', KEYMAP_P2, P2_ROWS);
(document.getElementById('deck') || document.body).appendChild(el);

// It shares the row under the TV with the joypad, so it stands down entirely
// rather than pushing the pair off a short viewport — `body` is overflow:hidden,
// so an off-screen panel is invisible with no scrollbar to hint at it.
const stage = document.getElementById('stage');
const deck = document.getElementById('deck');
const place = () => {
  if (!deck) return;
  el.classList.remove('lg-hidden', 'lg-side');
  const doc = document.documentElement;
  const st = stage ? stage.getBoundingClientRect() : { height: 0, left: 0 };
  const room = (doc.clientHeight || 0) - st.height - 14;
  const r = deck.getBoundingClientRect();
  if (r.height <= room && r.width <= (doc.clientWidth || 0) - 16) return;
  // no room in the row: try the empty column beside the TV, else stand down
  el.classList.add('lg-side');
  const side = el.getBoundingClientRect();
  if (side.width + 44 > st.left || side.height > (doc.clientHeight || 0) - 16) {
    el.classList.remove('lg-side');
    el.classList.add('lg-hidden');
  }
};
place();
window.addEventListener('resize', place);
if (stage && window.ResizeObserver) new ResizeObserver(place).observe(stage);

// The toolbelt is revealed while HARRY MODE is the HIGHLIGHTED title row — a
// preview before it is chosen — and stays revealed while actually playing it.
// `screens.menuChoice` is the public accessor; never reach into title.index.
// The group is always laid out and only its visibility changes, so moving the
// menu cursor up and down cannot make the panel twitch.
let harry = null;
const poll = () => {
  const g = window.__GAME;
  const on = !!(
    g &&
    ((g.screens && g.screens.menuChoice === 'harry') || (g.world && g.world.harryMode) || g.harryMode)
  );
  if (on !== harry) {
    harry = on;
    el.classList.toggle('lg-harry', on);
  }
  requestAnimationFrame(poll);
};
requestAnimationFrame(poll);

export default el;
