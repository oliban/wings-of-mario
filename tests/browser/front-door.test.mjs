import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from '../../server/index.js';
import { Rooms } from '../../src/net/room.js';
import { __lockForTests } from './helpers.mjs';

const quiet = { info() {}, warn() {}, error() {} };

// The front door in a real browser. What the unit tests cannot check is the
// half that only exists on a page: that the screen is really over the game,
// that a bare `/` under automation is really untouched, and that a click on a
// listed room really lands in that room's seat.
//
// `?lobby` is how a test asks for the screen. Without it the front door stays
// out of the way of every automated page — which is itself asserted below,
// because several older suites boot at a bare `/` and expect a game.
test('the front door lists a game, joins it, and starts one', { timeout: 180000 }, async (t) => {
  await __lockForTests.acquire();
  const server = await startServer({ port: 0, rooms: new Rooms(), log: quiet });
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await server.close();
    __lockForTests.release();
  });
  const base = `http://127.0.0.1:${server.port}`;

  // A pilot is up in EFGH and needs a Mario. This is the state the front door
  // exists to make legible.
  const pilot = await browser.newContext().then((c) => c.newPage());
  await pilot.goto(`${base}/pilot.html?room=EFGH`);
  await pilot.waitForFunction(
    () => window.__WINGS && window.__WINGS.net && window.__WINGS.net.state().connected,
    null, { timeout: 30000 }
  );

  // Somebody opens the server's address and is shown a lobby, not a game.
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/?lobby`);
  await page.waitForSelector('#net-front-door', { timeout: 30000 });
  await page.waitForSelector('#net-front-door a', { timeout: 15000 });

  const link = page.locator('#net-front-door a').first();
  assert.match(await link.textContent(), /^EFGH NEEDS MARIO/);
  assert.equal(await link.getAttribute('href'), '/?room=EFGH');

  // The screen is really in front: it covers the canvas the game draws into.
  const covered = await page.evaluate(() => {
    const veil = document.getElementById('net-front-door');
    const box = veil.getBoundingClientRect();
    return box.width >= window.innerWidth && box.height >= window.innerHeight;
  });
  assert.equal(covered, true, 'a screen in front is only in front if it covers');

  // No room was minted while the player was still deciding. That is the whole
  // behavioural change on this page: `/` used to mint on load.
  const roomsWhileDeciding = await (await fetch(`${base}/rooms`)).json();
  assert.deepEqual(roomsWhileDeciding.rooms.map((r) => r.code), ['EFGH']);

  // Clicking the room joins it, in the seat it said it needed.
  await link.click();
  await page.waitForFunction(
    () => window.__NET && window.__NET.state().connected && window.__NET.state().room === 'EFGH',
    null, { timeout: 30000 }
  );
  assert.match(await page.textContent('#net-banner'), /^ROOM EFGH — MARIO/);
  assert.equal(await page.locator('#net-front-door').count(), 0, 'the door closes behind you');

  // And the other way in: start a game, and be flown to the pilot's page in a
  // room that did not exist a moment ago.
  const starter = await browser.newContext().then((c) => c.newPage());
  await starter.goto(`${base}/?lobby`);
  await starter.waitForSelector('#net-front-door [data-role="start-pilot"]', { timeout: 30000 });
  await starter.click('#net-front-door [data-role="start-pilot"]');
  await starter.waitForURL(/\/pilot\.html\?room=[ACDEFGHJKMNPQRTUVWXY34679]{4}$/, { timeout: 30000 });
  await starter.waitForFunction(
    () => window.__WINGS && window.__WINGS.net && window.__WINGS.net.state().connected,
    null, { timeout: 30000 }
  );
  assert.deepEqual(errors, [], 'the front door must not redden the console');
});

// The constraint the whole design hangs on: the pages that must not have a
// lobby in the way do not get one.
test('every page that already chose is untouched by the front door', {
  timeout: 180000,
}, async (t) => {
  await __lockForTests.acquire();
  const server = await startServer({ port: 0, rooms: new Rooms(), log: quiet });
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await server.close();
    __lockForTests.release();
  });
  const base = `http://127.0.0.1:${server.port}`;

  const gone = async (page) => {
    // Give the first /rooms fetch time to have come back and put a veil up if
    // it were ever going to; asserting on absence needs the chance to be there.
    await page.waitForTimeout(500);
    return page.locator('#net-front-door').count();
  };

  // A bare `/` under automation. This is tests/browser/helpers.mjs boot()'s
  // default path, which half the browser suite uses, and it must still mint a
  // room and connect exactly as it did before the front door existed.
  const plain = await browser.newPage();
  await plain.goto(`${base}/`);
  await plain.waitForFunction(
    () => window.__NET && window.__NET.state().connected, null, { timeout: 30000 }
  );
  assert.equal(await gone(plain), 0, 'automation gets a game, not a screen');

  // `?solo`: the offline escape hatch, and the one the front door's own
  // PLAY THE LEVEL ALONE button navigates to. With `?lobby` alongside it, so
  // this is the strong claim: solo wins even against the flag that forces the
  // screen on, because boot() answers solo before it asks about the door.
  const solo = await browser.newContext().then((c) => c.newPage());
  await solo.goto(`${base}/?solo&lobby=`);
  await solo.waitForFunction(() => window.__GAME && window.__GAME.ready, null, { timeout: 30000 });
  await solo.evaluate(() => window.__NET.ready);
  assert.equal(await solo.textContent('#net-banner'), 'SOLO');
  assert.equal(await solo.locator('#net-front-door').count(), 0, 'solo means solo');

  // A direct join, which is every link the front door itself hands out.
  const direct = await browser.newContext().then((c) => c.newPage());
  await direct.goto(`${base}/?room=ACDE`);
  await direct.waitForFunction(
    () => window.__NET && window.__NET.state().room === 'ACDE', null, { timeout: 30000 }
  );
  assert.equal(await gone(direct), 0);
});
