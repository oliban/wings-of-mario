// On-screen joypad. The artwork is pure CSS (see #joypad in index.html); this
// module only wires the DOM to the pad-1 button state.
//
// Two directions:
//   pointer -> input.setVirtual(), so touching the pad plays the game;
//   input.live() -> css classes, so playing on the keyboard or a real gamepad
//   lights the on-screen buttons up.
//
// Everything about it is skipped in body.headless, where the pad is hidden so
// the screenshot harness keeps seeing an undecorated page.

import input, { BTN } from '../core/input.js';

const root = document.getElementById('joypad');

// Total design height of the pad in `em`: margin-top + body.
const PAD_EM_H = 1.6 + 19;
const PAD_EM_W = 42;
const MIN_PX = 3;
// Desktop is played on the keyboard, so the pad is mainly something to look at
// and stays modest. On a phone it is the only input, so it takes the width.
const MAX_PX_DESKTOP = 3.5;
const MAX_PX_PHONE = 18;
const PHONE = '(max-width: 760px)';
// Landscape phone: vertical room is scarce, so the pad sits BESIDE the TV.
const BESIDE = '(max-height: 560px) and (orientation: landscape)';

const NAMES = Object.values(BTN);

if (root) {
  const stage = document.getElementById('stage');

  // --- sizing -------------------------------------------------------------
  // The renderer picks an integer canvas scale from the window height, so how
  // much room is left underneath is only knowable at runtime. Fit to it rather
  // than guessing in CSS, or a short window pushes the TV off the viewport.
  let lastPx = 0;
  const fit = () => {
    const r = stage ? stage.getBoundingClientRect() : { width: 0, height: 0 };
    const cs = getComputedStyle(document.body);
    // The body carries the safe-area insets, so take them off the budget:
    // nothing of the pad may end up under a notch or a home indicator.
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const el = document.documentElement;
    const vw = (el.clientWidth || window.innerWidth || 0) - padX;
    const vh = (el.clientHeight || window.innerHeight || 0) - padY;

    const beside = window.matchMedia(BESIDE).matches;
    const phone = beside || window.matchMedia(PHONE).matches;
    const availW = beside ? vw - r.width - 20 : vw - (phone ? 20 : 24);
    const availH = beside ? vh - 6 : vh - r.height - (phone ? 30 : 12);

    const max = phone ? MAX_PX_PHONE : MAX_PX_DESKTOP;
    const px = Math.max(MIN_PX, Math.min(max, availH / PAD_EM_H, availW / PAD_EM_W));
    if (Math.abs(px - lastPx) < 0.05) return;
    lastPx = px;
    root.style.fontSize = `${px.toFixed(2)}px`;
    // Below ~200 CSS px the lettering stops being letters and becomes a smear;
    // the cross, arrows, ridges and buttons all survive down to 135px.
    root.classList.toggle('jp-tiny', px * PAD_EM_W < 200);
  };
  fit();
  window.addEventListener('resize', fit);
  if (stage && window.ResizeObserver) new ResizeObserver(fit).observe(stage);

  // --- input diary (?inputlog) --------------------------------------------
  // A button that dies mid-game on a phone cannot be caught from a desktop
  // harness: WebKit's touch stack is not Chromium's, and every layer we CAN
  // drive measures clean. So let the phone keep the record instead. Off unless
  // asked for by hand, and it never touches the input path — it only watches.
  const DIARY = /[?&]inputlog\b/.test(location.search);
  let diary = null;
  if (DIARY) {
    diary = document.createElement('div');
    diary.style.cssText =
      'position:fixed;left:0;right:0;top:0;z-index:99;max-height:38vh;overflow:hidden;' +
      'font:10px/1.35 ui-monospace,Menlo,monospace;color:#9fe;background:rgba(0,0,0,.82);' +
      'padding:4px 6px;white-space:pre;pointer-events:none';
    document.body.appendChild(diary);
    const lines = [];
    let n = 0;
    diary.note = (s) => {
      n++;
      lines.push(`${String(n).padStart(3)} ${s}`);
      if (lines.length > 26) lines.shift();
      diary.textContent = lines.join('\n');
    };
    // The events themselves, in the capture phase so the log is what ARRIVED,
    // not what survived our own handlers.
    for (const t of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      root.addEventListener(
        t,
        (e) => {
          const at = buttonsAt(e.clientX, e.clientY).join('+') || '-';
          diary.note(`${t.replace('pointer', 'p.').padEnd(10)} id=${e.pointerId} at=${at} held=${held.size}`);
        },
        true
      );
    }
    // and every jump/run edge the game actually acted on, so a press that
    // arrived but was never consumed is visible as an event with no edge.
    const orig = input.update.bind(input);
    input.update = () => {
      orig();
      if (input.pressed(BTN.JUMP)) diary.note('  >> JUMP edge consumed');
      if (input.pressed(BTN.RUN)) diary.note('  >> RUN  edge consumed');
    };
    window.addEventListener('blur', () => diary.note('window blur -> all released'));
    document.addEventListener('visibilitychange', () => diary.note(`visibility: ${document.visibilityState}`));
  }

  // --- pointer -> input ---------------------------------------------------
  const held = new Map(); // pointerId -> string[] of BTN names

  const buttonsAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const hit = el && el.closest ? el.closest('[data-btn]') : null;
    if (!hit || !root.contains(hit)) return [];
    return hit.dataset.btn.split(/\s+/).filter((b) => NAMES.includes(b));
  };

  const commit = () => {
    const on = new Set();
    for (const list of held.values()) for (const b of list) on.add(b);
    for (const b of NAMES) input.setVirtual(b, on.has(b));
    paint();
  };

  const track = (e) => {
    held.set(e.pointerId, buttonsAt(e.clientX, e.clientY));
    commit();
  };

  const drop = (e) => {
    if (!held.has(e.pointerId)) return;
    held.delete(e.pointerId);
    commit();
  };

  root.addEventListener('pointerdown', (e) => {
    const list = buttonsAt(e.clientX, e.clientY);
    if (!list.length) return;
    e.preventDefault();
    // Capture on the root, not the button: the pointer must keep reporting
    // once it slides off a button (rolling around the d-pad, or dragging away
    // to let go) so a button can never be left stuck down.
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety; the window-level fallbacks below still fire */
    }
    held.set(e.pointerId, list);
    commit();
  });
  root.addEventListener('pointermove', (e) => {
    if (held.has(e.pointerId)) track(e);
  });
  root.addEventListener('pointerup', drop);
  root.addEventListener('pointercancel', drop);
  root.addEventListener('lostpointercapture', drop);
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  // Belt and braces: a pointerup delivered somewhere else entirely (capture
  // denied, or the pointer released over another window) still releases.
  window.addEventListener('pointerup', drop);
  window.addEventListener('pointercancel', drop);
  window.addEventListener('blur', () => {
    held.clear();
    input.clearVirtual();
    paint();
  });

  // --- input -> css -------------------------------------------------------
  let shown = 0;
  function paint() {
    if (root.offsetParent === null) return; // hidden (body.headless)
    const now = input.live();
    let bits = 0;
    for (let i = 0; i < NAMES.length; i++) if (now[NAMES[i]]) bits |= 1 << i;
    if (bits === shown) return;
    shown = bits;
    for (let i = 0; i < NAMES.length; i++) root.classList.toggle(`is-${NAMES[i]}`, !!(bits & (1 << i)));
  }

  const frame = () => {
    paint();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export default root;
