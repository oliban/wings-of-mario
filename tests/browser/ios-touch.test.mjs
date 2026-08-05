import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';
import { startServer } from '../../server/index.js';
import { Rooms } from '../../src/net/room.js';
import { __lockForTests } from './helpers.mjs';

const quiet = { info() {}, warn() {}, error() {} };
const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

// THE iOS PRESS.
//
// The bug reported from a real iPhone: buttons that did not work, and a
// copy / paste / Look Up / SEARCH GOOGLE menu coming up over the game instead.
// Both are one root cause. iOS Safari reads a press held a fraction longer than
// a tap as "the player is selecting this text", and a press that begins on
// selectable text with a callout available gets the callout, not the button.
//
// index.html already had the treatment (see #joypad there); nothing WE wrote
// did. These tests pin the four declarations onto our own surfaces so a later
// style edit cannot quietly drop one:
//
//   user-select / -webkit-user-select: none   nothing to select, so no callout
//   -webkit-touch-callout: none               and no callout even if there were
//   -webkit-tap-highlight-color: transparent  no grey flash over a control
//   touch-action                              no double-tap zoom eating presses
//
// WHAT THIS CANNOT PROVE, and why it is split in two.
//
// Chromium is the only browser installed here, and it does not merely ignore
// `-webkit-touch-callout` — it DROPS the declaration at parse time, so neither
// getComputedStyle nor the CSSOM can see it from inside the page. The callout
// is therefore asserted from the SOURCE, below, and everything a browser can
// actually answer is asserted in a browser, on a real touch device profile.
//
// And no test here can watch the menu fail to appear, because Chromium has no
// such menu. That needs a phone. What these tests do cover is that the fix is
// present on every surface, and that a synthesised TOUCH — not a mouse click —
// still works the controls, which is the user's literal complaint.

// The three Chromium can see. `manipulation` on anything a finger might scroll
// or a page might zoom; `none` only where a drag must be swallowed whole.
const READ = (el) => {
  const s = getComputedStyle(el);
  return {
    userSelect: s.webkitUserSelect || s.userSelect,
    // Safari reports the keyword; Chromium resolves it to rgba(0, 0, 0, 0).
    highlight: s.webkitTapHighlightColor,
    touchAction: s.touchAction,
  };
};

const assertTreated = (got, where, touchAction = 'manipulation') => {
  assert.equal(got.userSelect, 'none', `${where}: text must not be selectable`);
  assert.match(
    got.highlight, /transparent|rgba\(0, 0, 0, 0\)/,
    `${where}: the tap highlight must not flash`
  );
  assert.equal(got.touchAction, touchAction, `${where}: wrong touch-action`);
};

// The callout, read from the source, because no browser we have will report it.
// Crude on purpose: the declaration either appears in the file that styles the
// surface or it does not, and this is what catches its deletion.
test('every surface we own turns the iOS callout off', () => {
  for (const file of [
    'pilot.html',
    'src/net/lobby-screen.js',
    'src/net/lobby.js',
    'src/wings/debug-panel.js',
  ]) {
    const src = readFileSync(root(file), 'utf8');
    assert.match(
      src, /-webkit-touch-callout\s*:\s*none/,
      `${file} must switch the copy/paste/Search Google callout off`
    );
    assert.match(
      src, /-webkit-tap-highlight-color\s*:\s*transparent/,
      `${file} must switch the grey tap highlight off`
    );
  }
});

// WHERE the declaration sits, not just that it exists. iOS treats a long press
// on a <canvas> the way it treats one on an image and offers Copy / Share /
// Search with Google, and it has never inherited -webkit-touch-callout
// dependably: upstream shipped it on `html, body` and the television — two
// canvases — went on raising the menu mid-game until it moved to a rule that
// matches every element. pilot.html is a canvas page too and had the same bug,
// so this pins the fix rather than the symptom. The test above cannot see the
// difference; that is why this one exists.
test('the callout is set on every element, not left to inherit onto a canvas', () => {
  const src = readFileSync(root('pilot.html'), 'utf8');
  // The universal rule, and the callout inside it. Written as one match so a
  // callout that drifts back out of the `*` rule fails here.
  assert.match(
    src, /\*\s*\{[^}]*-webkit-touch-callout\s*:\s*none/,
    'pilot.html must set the callout on `*`: a <canvas> does not inherit it'
  );
});

test('the front door survives a finger', { timeout: 180000 }, async (t) => {
  await __lockForTests.acquire();
  const server = await startServer({ port: 0, rooms: new Rooms(), log: quiet });
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await server.close();
    __lockForTests.release();
  });
  const base = `http://127.0.0.1:${server.port}`;

  // A pilot is waiting, so the list has a row in it to press.
  const pilot = await browser.newContext().then((c) => c.newPage());
  await pilot.goto(`${base}/pilot.html?room=EFGH`);
  await pilot.waitForFunction(
    () => window.__WINGS && window.__WINGS.net && window.__WINGS.net.state().connected,
    null, { timeout: 30000 }
  );

  // An actual phone profile: touch, no mouse, a phone's viewport. tap() below
  // therefore cannot quietly fall back to a mouse — Playwright refuses tap()
  // on a context without hasTouch, and this one has it.
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await phone.newPage();
  await page.goto(`${base}/?lobby`);
  await page.waitForSelector('#net-front-door a', { timeout: 30000 });

  const styles = await page.evaluate((fn) => {
    const read = eval(`(${fn})`);
    const veil = document.getElementById('net-front-door');
    return {
      veil: read(veil),
      row: read(veil.querySelector('a')),
      start: read(veil.querySelector('[data-role="start-pilot"]')),
      alone: read(veil.querySelector('[data-role="solo"]')),
    };
  }, READ.toString());

  assertTreated(styles.veil, 'the front door itself');
  assertTreated(styles.row, 'a joinable room row');
  assertTreated(styles.start, 'START A GAME');
  assertTreated(styles.alone, 'PLAY THE LEVEL ALONE');

  // And the control still works when a finger uses it. This is the user's
  // actual complaint — "buttons not working" — so it is asserted with a real
  // touch event and not a mouse click.
  await page.tap('#net-front-door a');
  await page.waitForFunction(
    () => window.__NET && window.__NET.state().connected && window.__NET.state().room === 'EFGH',
    null, { timeout: 30000 }
  );

  // Nothing got selected on the way. A press that selects is a press that would
  // have raised the callout on a real phone.
  assert.equal(
    await page.evaluate(() => String(window.getSelection() || '')), '',
    'a tap must not leave a selection behind it'
  );
});

test("the pilot's page survives a finger", { timeout: 180000 }, async (t) => {
  await __lockForTests.acquire();
  const server = await startServer({ port: 0, rooms: new Rooms(), log: quiet });
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await server.close();
    __lockForTests.release();
  });
  const base = `http://127.0.0.1:${server.port}`;

  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await phone.newPage();
  await page.goto(`${base}/pilot.html?room=ACDE`);
  await page.waitForFunction(() => window.__WINGS, null, { timeout: 30000 });

  const got = await page.evaluate((fn) => {
    const read = eval(`(${fn})`);
    return {
      body: read(document.body),
      screen: read(document.getElementById('screen')),
      hint: read(document.getElementById('hint')),
    };
  }, READ.toString());

  assertTreated(got.body, "the pilot's page");
  // The canvas is the one place `none` is right: it is a game surface, and a
  // drag across it must be swallowed entire rather than becoming a page scroll.
  assertTreated(got.screen, "the pilot's canvas", 'none');
  // The key legend is text sitting over the game, and the likeliest thing on
  // the page for a stray press to land on and try to select. No touch-action
  // assertion: it is `pointer-events: none`, so it is not a touch target at all
  // and its own touch-action would never be consulted.
  assert.equal(got.hint.userSelect, 'none', 'the key legend must not be selectable');
  assert.match(got.hint.highlight, /transparent|rgba\(0, 0, 0, 0\)/);
});

test("the bomb panel's buttons survive a finger", { timeout: 180000 }, async (t) => {
  await __lockForTests.acquire();
  const server = await startServer({ port: 0, rooms: new Rooms(), log: quiet });
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await server.close();
    __lockForTests.release();
  });
  const base = `http://127.0.0.1:${server.port}`;

  // A phone's viewport, but a desktop-width window: the panel docks to the
  // right of #stage and on a 390px-wide screen it is parked entirely off it,
  // where nothing can be tapped. That is a separate problem from this one — the
  // panel is a developer tool and has never claimed to fit a phone — so the
  // touch profile is kept and the viewport widened enough to reach it.
  const phone = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 1100, height: 800 },
  });
  const page = await phone.newPage();
  await page.goto(`${base}/?solo`);
  await page.waitForSelector('#wdp-panel button:not([disabled])', { timeout: 60000 });

  const got = await page.evaluate((fn) => {
    const read = eval(`(${fn})`);
    return {
      panel: read(document.getElementById('wdp-panel')),
      button: read(document.getElementById('wdp-nuke')),
      radius: read(document.getElementById('wdp-radius')),
    };
  }, READ.toString());

  // The panel scrolls (it is taller than a short window), so `manipulation` and
  // never `none` — `none` would take that scroll away.
  assertTreated(got.panel, 'the bomb panel');
  assertTreated(got.button, 'a bombing-run button');
  // The radius field is the deliberate exception: it is a text field, and a
  // player who wants to paste a number into it must be able to reach Paste. It
  // opts back INTO selection while everything around it stays out.
  assert.equal(got.radius.userSelect, 'text', 'the radius field must be selectable');
  assert.equal(got.radius.touchAction, 'manipulation');

  // And the rule that must not regress: a press leaves focus with the game, so
  // the arrow keys keep driving Mario. This was a real bug once.
  await page.tap('#wdp-nuke');
  assert.equal(
    await page.evaluate(() => document.activeElement.id), '',
    'a panel button must never keep focus'
  );
});
