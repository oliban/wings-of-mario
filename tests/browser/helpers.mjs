import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 8199;
export const BASE = `http://localhost:${PORT}`;

// One static server and one browser shared by a whole test file. The game has
// no build step, so `http-server` over the repo root is the entire deployment.
// `opts.path` and `opts.global` pick the entry point. The defaults are Mario's
// index.html and window.__GAME; the pilot boots pilot.html and window.__WINGS.
// One harness, because two would drift apart.
export async function boot(opts = {}) {
  const path = opts.path || '/';
  const global = opts.global || '__GAME';
  const server = spawn(
    'npx',
    ['http-server', '-p', String(PORT), '-c-1', '--silent', '.'],
    { stdio: 'ignore' }
  );
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch();
    const page = await browser.newPage();

    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(BASE + path);
    // goto resolves before the ES module graph has run, so the control API does
    // not exist yet. Wait for it before touching it, or every test races the
    // loader.
    await page.waitForFunction((g) => window[g] && window[g].ready, global, {
      timeout: 30000,
    });
    await page.evaluate((g) => window[g].ready, global);

    return { server, browser, page, errors };
  } catch (err) {
    // Without this, a failed boot leaks the server and the browser, and the
    // test process never exits — it hangs instead of reporting the failure.
    if (browser) await browser.close().catch(() => {});
    server.kill();
    throw err;
  }
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(BASE + '/index.html');
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('static server never came up');
}

export async function shutdown(ctx) {
  await ctx.browser.close();
  ctx.server.kill();
}
