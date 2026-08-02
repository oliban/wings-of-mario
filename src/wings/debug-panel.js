// Bomb-test debug panel — a stand-in for the plane that will eventually drop
// these blasts in-game. Everything here is new (upstream has never heard of
// this file); it drives the game only through window.__GAME's public API in
// src/main.js, and builds its own DOM/CSS so index.html needs only the one
// <script> hook that loads this module.
//
// Hard requirements this file exists to satisfy (see the task write-up):
//  - never leave keyboard focus sitting on a panel control (input.js reads
//    keys off `window`, but a focused <button> intercepts Space/Enter and a
//    focused <select>/<input> intercepts the arrows);
//  - never throw before a level/world exists;
//  - never overlap or resize #screen.

import { SCREEN_W, SCREEN_H, TILE } from '../core/constants.js';

const WORLDS = 8;
const STAGES = 4;

function levelIds() {
  const out = [];
  for (let w = 1; w <= WORLDS; w++) {
    for (let l = 1; l <= STAGES; l++) out.push(`${w}-${l}`);
  }
  return out;
}

// Never let a click hang onto focus. Buttons don't need focus to work — this
// stops it from ever landing in the first place, which is more robust than
// blurring after the fact.
function noFocus(el) {
  el.addEventListener('mousedown', (e) => e.preventDefault());
}

// Inputs and selects DO need focus while the user is interacting with them.
// Hand focus back to the game the moment that interaction ends.
function blurOnCommit(el) {
  el.addEventListener('change', () => el.blur());
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') el.blur();
  });
}

const STYLE = `
#wdp-panel {
  position: fixed;
  z-index: 20;
  width: 232px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  background: linear-gradient(180deg, #12151f 0%, #0a0c12 100%);
  color: #cdd6f4;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  border-radius: 10px;
  box-shadow:
    0 0 0 1px rgba(255,255,255,.06),
    0 20px 50px -15px rgba(0,0,0,.85);
  padding: 10px;
}
#wdp-panel * { box-sizing: border-box; }
#wdp-panel h2 {
  font-size: 11px;
  letter-spacing: .14em;
  color: #7f92c9;
  margin: 0 0 8px;
  text-transform: uppercase;
}
#wdp-panel h3 {
  font-size: 9px;
  letter-spacing: .16em;
  color: #4d7dff;
  text-transform: uppercase;
  margin: 12px 0 5px;
  border-top: 1px solid rgba(255,255,255,.07);
  padding-top: 8px;
}
#wdp-panel h3:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
#wdp-panel .wdp-row {
  display: flex;
  gap: 5px;
  margin-bottom: 5px;
}
#wdp-panel button {
  flex: 1 1 auto;
  background: #181c29;
  color: #cdd6f4;
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 5px;
  padding: 5px 6px;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
#wdp-panel button:hover:not(:disabled) {
  border-color: #4d7dff;
  color: #ffffff;
}
#wdp-panel button:active:not(:disabled) {
  background: #1e2333;
}
#wdp-panel button:disabled {
  opacity: .4;
  cursor: default;
}
#wdp-panel button.wdp-toggle.wdp-on {
  background: #24345e;
  border-color: #4d7dff;
  color: #fff;
}
#wdp-panel select,
#wdp-panel input[type="number"] {
  background: #0d0f18;
  color: #cdd6f4;
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 5px;
  padding: 4px 5px;
  font: inherit;
  width: 100%;
}
#wdp-panel .wdp-radius {
  display: flex;
  align-items: center;
  gap: 4px;
}
#wdp-panel .wdp-radius input {
  width: 42px;
  text-align: center;
  flex: none;
}
#wdp-panel .wdp-radius button {
  flex: none;
  width: 22px;
  text-align: center;
  padding: 4px 0;
}
#wdp-panel .wdp-readout {
  font-size: 10px;
  line-height: 1.5;
  color: #9aa6cf;
}
#wdp-panel .wdp-readout b { color: #cdd6f4; }
#wdp-panel .wdp-status {
  margin-top: 6px;
  padding: 6px;
  background: #0d0f18;
  border-radius: 5px;
  color: #7de2ff;
  min-height: 2.6em;
  word-break: break-word;
}
`;

function buildDom() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'wdp-panel';
  panel.innerHTML = `
    <h2>Bomb Test Panel</h2>

    <h3>Bombing runs</h3>
    <div class="wdp-row"><button id="wdp-carpet" disabled>Carpet bomb</button></div>
    <div class="wdp-row"><button id="wdp-crater" disabled>Crater under Mario</button></div>
    <div class="wdp-row"><button id="wdp-ahead" disabled>Bomb ahead</button></div>
    <div class="wdp-row"><button id="wdp-sky" disabled>Bomb the sky row</button></div>
    <div class="wdp-row"><button id="wdp-nuke" disabled>Nuke</button></div>

    <h3>Aiming</h3>
    <div class="wdp-row"><button id="wdp-click-toggle" class="wdp-toggle" disabled>Click-to-bomb: OFF</button></div>
    <div class="wdp-row wdp-radius">
      <span>Radius</span>
      <button id="wdp-radius-minus" disabled>-</button>
      <input id="wdp-radius" type="number" min="1" max="8" step="1" value="2" />
      <button id="wdp-radius-plus" disabled>+</button>
    </div>

    <h3>Persistence / reset</h3>
    <div class="wdp-row"><button id="wdp-reload-keep" disabled>Reload level (keep craters)</button></div>
    <div class="wdp-row"><button id="wdp-reload-clean" disabled>Reload level (clean)</button></div>
    <div class="wdp-row"><select id="wdp-level"></select></div>

    <h3>Readout</h3>
    <div class="wdp-readout">
      Destroyed tiles: <b id="wdp-destroyed">0</b><br/>
      Level: <b id="wdp-level-id">-</b>
    </div>
    <div class="wdp-status" id="wdp-status">Loading…</div>
  `;
  document.body.appendChild(panel);
  return panel;
}

// Keeps the panel glued to the right of #stage without ever touching its
// size — #stage lives inside a `place-items: center` grid, so its on-screen
// box moves with the viewport and has to be tracked, not assumed.
function dock(panel) {
  const reposition = () => {
    const stage = document.getElementById('stage');
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    panel.style.top = `${Math.max(8, r.top)}px`;
    panel.style.left = `${r.right + 18}px`;
  };
  reposition();
  window.addEventListener('resize', reposition);
  const stage = document.getElementById('stage');
  if (stage && typeof ResizeObserver === 'function') {
    new ResizeObserver(reposition).observe(stage);
  }
}

// Module scripts execute in document order only up to a point: main.js's
// graph includes a module with a top-level await (world.js), and in practice
// that does not hold up this script's own evaluation the way a synchronous
// script would. window.__GAME may not exist yet the instant this file's top
// level runs, so wait for it rather than trusting script order.
function waitForGame() {
  if (window.__GAME) return Promise.resolve(window.__GAME);
  return new Promise((resolve) => {
    const iv = setInterval(() => {
      if (window.__GAME) {
        clearInterval(iv);
        resolve(window.__GAME);
      }
    }, 20);
  });
}

async function init() {
  const GAME = await waitForGame();

  const panel = buildDom();
  dock(panel);

  const $ = (id) => panel.querySelector(id);
  const buttons = [
    '#wdp-carpet', '#wdp-crater', '#wdp-ahead', '#wdp-sky', '#wdp-nuke',
    '#wdp-click-toggle', '#wdp-radius-minus', '#wdp-radius-plus',
    '#wdp-reload-keep', '#wdp-reload-clean',
  ].map($);
  buttons.forEach(noFocus);

  const radiusInput = $('#wdp-radius');
  const levelSelect = $('#wdp-level');
  const statusEl = $('#wdp-status');
  const destroyedEl = $('#wdp-destroyed');
  const levelIdEl = $('#wdp-level-id');
  blurOnCommit(radiusInput);
  blurOnCommit(levelSelect);

  for (const id of levelIds()) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    levelSelect.appendChild(opt);
  }

  let radius = 2;
  function setRadius(n) {
    radius = Math.max(1, Math.min(8, Math.round(n) || 1));
    radiusInput.value = String(radius);
  }

  function currentLevelId() {
    return (GAME.game && GAME.game.levelId) || null;
  }

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function refreshReadout() {
    const world = GAME.world;
    destroyedEl.textContent = world ? String(GAME.damageKeys().length) : '—';
    const id = currentLevelId();
    levelIdEl.textContent = id || '—';
    if (id && levelSelect.value !== id && [...levelSelect.options].some((o) => o.value === id)) {
      levelSelect.value = id;
    }
  }

  // Every bombing-run action is guarded the same way: a missing world (title
  // screen, mid-load) makes the button a no-op that reports itself, never a
  // thrown error.
  function withWorld(fn) {
    const world = GAME.world;
    const p = world && world.player;
    if (!world || !p) {
      setStatus('no level loaded — load a level first');
      return;
    }
    fn(world, p);
    refreshReadout();
  }

  $('#wdp-carpet').addEventListener('click', () => withWorld((world, p) => {
    const startX = p.x + p.w + 20;
    const y = p.y + p.h / 2;
    const destroyed = new Set();
    for (let i = 0; i < 8; i++) {
      const cx = startX + i * 40;
      for (const k of GAME.blast(cx, y, 2)) destroyed.add(k);
    }
    setStatus(`carpet bomb: ${destroyed.size} tiles destroyed`);
  }));

  $('#wdp-crater').addEventListener('click', () => withWorld((world, p) => {
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h + 4;
    const keys = GAME.blast(cx, cy, 2);
    setStatus(`crater under Mario: ${keys.length} tiles destroyed`);
  }));

  $('#wdp-ahead').addEventListener('click', () => withWorld((world, p) => {
    const cx = p.x + p.w + 80;
    const cy = p.y + p.h / 2;
    const keys = GAME.blast(cx, cy, 2);
    setStatus(`bomb ahead: ${keys.length} tiles destroyed`);
  }));

  $('#wdp-sky').addEventListener('click', () => withWorld((world, p) => {
    const cx = p.x + p.w / 2 + 40;
    const cy = 9 * TILE + TILE / 2;
    const keys = GAME.blast(cx, cy, radius);
    setStatus(`sky row bomb: ${keys.length} tiles destroyed`);
  }));

  $('#wdp-nuke').addEventListener('click', () => withWorld((world, p) => {
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    const keys = GAME.blast(cx, cy, 6);
    setStatus(`nuke: ${keys.length} tiles destroyed`);
  }));

  // --- Aiming --------------------------------------------------------------

  let clickToBombOn = false;
  const canvas = document.getElementById('screen');

  function onCanvasClick(e) {
    const world = GAME.world;
    if (!world) return;
    const rect = canvas.getBoundingClientRect();
    // The canvas is displayed at an integer multiple of the 256x240 internal
    // framebuffer, so a fraction of its ON-SCREEN box is the same fraction of
    // the framebuffer, regardless of devicePixelRatio or CSS scale. Add the
    // camera's world-space offset to land on the same tile the player saw.
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const wx = fx * SCREEN_W + world.cam.x;
    const wy = fy * SCREEN_H + world.cam.y;
    const keys = GAME.blast(wx, wy, radius);
    setStatus(`click-to-bomb: ${keys.length} tiles destroyed at (${Math.round(wx)}, ${Math.round(wy)})`);
    refreshReadout();
  }

  $('#wdp-click-toggle').addEventListener('click', (e) => {
    clickToBombOn = !clickToBombOn;
    if (clickToBombOn && canvas) canvas.addEventListener('click', onCanvasClick);
    else if (canvas) canvas.removeEventListener('click', onCanvasClick);
    e.currentTarget.textContent = `Click-to-bomb: ${clickToBombOn ? 'ON' : 'OFF'}`;
    e.currentTarget.classList.toggle('wdp-on', clickToBombOn);
  });

  $('#wdp-radius-minus').addEventListener('click', () => setRadius(radius - 1));
  $('#wdp-radius-plus').addEventListener('click', () => setRadius(radius + 1));
  radiusInput.addEventListener('change', () => setRadius(parseInt(radiusInput.value, 10)));

  // --- Persistence / reset ---------------------------------------------------

  $('#wdp-reload-keep').addEventListener('click', async () => {
    const id = currentLevelId();
    if (!id || !GAME.world) return setStatus('no level loaded');
    const damage = GAME.damageKeys();
    await GAME.loadLevel(id, null, damage);
    setStatus(`reload (keep craters): ${damage.length} tiles restored on ${id}`);
    refreshReadout();
  });

  $('#wdp-reload-clean').addEventListener('click', async () => {
    const id = currentLevelId();
    if (!id) return setStatus('no level loaded');
    await GAME.loadLevel(id, null, []);
    setStatus(`reload (clean): ${id} reloaded with no damage`);
    refreshReadout();
  });

  levelSelect.addEventListener('change', async () => {
    const id = levelSelect.value;
    await GAME.loadLevel(id);
    setStatus(`loaded level ${id}`);
    refreshReadout();
  });

  await GAME.ready;
  buttons.forEach((b) => { b.disabled = false; });
  refreshReadout();
  setStatus('ready');
}

init();
