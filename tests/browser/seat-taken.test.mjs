import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { serveStatic } from '../../server/static.js';
import { bootRoom, shutdownRoom, __lockForTests } from './helpers.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// The bug this file exists for: a player who already held the pilot seat in
// another tab opened the pilot page again and was told, in full, `OFFLINE`.
// The server refused correctly; the page simply would not say why.
test('a second pilot is told the seat is taken, not OFFLINE', { timeout: 180000 }, async (t) => {
  const ctx = await bootRoom({ room: 'ACDE' });
  t.after(() => shutdownRoom(ctx));

  // A third client, in its own context — the first two already hold both
  // seats — asking for the seat the pilot is sitting in.
  const context = await ctx.browser.newContext();
  const page = await context.newPage();
  await page.goto(`${ctx.base}/pilot.html?room=ACDE&side=pilot`);
  await page.waitForFunction(() => window.__WINGS && window.__WINGS.ready, null, { timeout: 30000 });
  await page.evaluate(() => window.__WINGS.net.ready);

  const text = await page.textContent('#net-banner');
  assert.equal(text, 'ROOM ACDE — PILOT SEAT TAKEN — MARIO JOINS AT /?room=ACDE');
  // And the fallback still happened: this tab plays on alone rather than dying.
  assert.equal(await page.evaluate(() => window.__WINGS.net.state().connected), false);
  await context.close();
});

// The other half of the bargain: the page that is not on a room server at all
// must still say OFFLINE and still play alone. A plain static server with no
// /room and no /ws is what the capture tool and the older browser tests use,
// and nothing there is wrong, so nothing there may be dressed up as a fault.
test('a page with no room server still falls back quietly', { timeout: 180000 }, async (t) => {
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
  const warnings = [];
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
    // The browser's own 404 for the missing POST /room is not ours and cannot
    // be silenced from a page; what matters is that the net module says
    // nothing in red about it.
    if (m.type() === 'error' && m.text().includes('net]')) errors.push(m.text());
  });
  await page.goto(`${base}/pilot.html`);
  await page.waitForFunction(() => window.__WINGS && window.__WINGS.ready, null, { timeout: 30000 });
  await page.evaluate(() => window.__WINGS.net.ready);

  assert.equal(await page.textContent('#net-banner'), 'OFFLINE');
  assert.equal(await page.evaluate(() => window.__WINGS.net.state().connected), false);
  // Still a game: the simulation is up and steps.
  const stepped = await page.evaluate(() => {
    const before = window.__WINGS.state().tick;
    window.__WINGS.tick(30);
    return window.__WINGS.state().tick - before;
  });
  assert.equal(stepped, 30, 'the simulation should still step with no server');
  assert.deepEqual(errors, [], 'the quiet path must not redden the console');
  assert.ok(warnings.some((w) => w.includes('offline')), 'it is still a warning');
});
