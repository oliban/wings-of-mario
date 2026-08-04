import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { serveStatic } from '../../server/static.js';
import { startServer } from '../../server/index.js';
import { Rooms } from '../../src/net/room.js';
import { __lockForTests } from './helpers.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// The thing this file exists for: rooms live in server memory and die with it,
// so the only way to join someone else's was to be told the code and type it
// into a URL. The header now lists what exists, and the list must be right
// about a room that appeared AFTER the page was drawn.
test('the header lists a room started after the page loaded, and links to its free seat', {
  timeout: 180000,
}, async (t) => {
  await __lockForTests.acquire();
  const server = await startServer({ port: 0, rooms: new Rooms(), log: { info() {}, warn() {}, error() {} } });
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await server.close();
    __lockForTests.release();
  });
  const base = `http://127.0.0.1:${server.port}`;

  // Mario, alone, on a server with no other rooms.
  const page = await browser.newPage();
  await page.goto(`${base}/?room=ACDE`);
  await page.waitForFunction(() => window.__NET && window.__NET.ready, null, { timeout: 30000 });
  await page.evaluate(() => window.__NET.ready);
  // 'attached', not visible: an empty list is an empty div with no box.
  await page.waitForSelector('#net-lobby', { state: 'attached', timeout: 10000 });
  // Our own room is never in it: the banner above already says more about it.
  assert.equal(await page.textContent('#net-lobby'), '');

  // Now the pilot starts one on the other laptop.
  const pilot = await browser.newContext().then((c) => c.newPage());
  await pilot.goto(`${base}/pilot.html?room=EFGH`);
  await pilot.waitForFunction(
    () => window.__WINGS && window.__WINGS.net && window.__WINGS.net.state().connected,
    null, { timeout: 30000 }
  );

  // Mario's header notices within a poll, with no reload.
  await page.waitForFunction(
    () => document.querySelector('#net-lobby a') !== null, null, { timeout: 15000 }
  );
  const link = page.locator('#net-lobby a').first();
  assert.match(await link.textContent(), /^EFGH NEEDS MARIO/);
  // The seat it offers is the free one. A link into the taken seat would land
  // the clicker on the SEAT TAKEN banner, which is the confusion this removes.
  assert.equal(await link.getAttribute('href'), '/?room=EFGH');

  // And it is a real link: following it joins that room's mario seat.
  await link.click();
  await page.waitForFunction(
    () => window.__NET && window.__NET.state().connected && window.__NET.state().room === 'EFGH',
    null, { timeout: 30000 }
  );
  assert.match(await page.textContent('#net-banner'), /^ROOM EFGH — MARIO/);
});

// The offline bargain, unchanged: a page served by something with no lobby
// endpoint still boots, still plays, and says nothing in red about it. The
// capture tool and the older browser tests are served exactly like this.
test('a page with no lobby endpoint still boots and plays', { timeout: 180000 }, async (t) => {
  const http = createServer(async (req, res) => {
    if (await serveStatic(req, res, REPO_ROOT)) return;
    res.writeHead(404).end('not found');
  });
  await new Promise((done) => http.listen(0, done));
  const base = `http://127.0.0.1:${http.address().port}`;

  await __lockForTests.acquire();
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await new Promise((done) => http.close(done));
    __lockForTests.release();
  });

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes('net]')) errors.push(m.text());
  });
  await page.goto(`${base}/pilot.html`);
  await page.waitForFunction(() => window.__WINGS && window.__WINGS.ready, null, { timeout: 30000 });
  await page.evaluate(() => window.__WINGS.net.ready);

  assert.equal(await page.textContent('#net-banner'), 'OFFLINE');
  const stepped = await page.evaluate(() => {
    const before = window.__WINGS.state().tick;
    window.__WINGS.tick(30);
    return window.__WINGS.state().tick - before;
  });
  assert.equal(stepped, 30, 'the simulation should still step with no server');
  // Nothing listed, nothing linked, and above all nothing thrown: a 404 from
  // /rooms is the ordinary case here, not a fault.
  assert.equal(await page.locator('#net-lobby a').count(), 0);
  assert.deepEqual(errors, [], 'the quiet path must not redden the console');
});
