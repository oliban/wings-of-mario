import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { startServer } from '../../server/index.js';
import { Rooms } from '../../src/net/room.js';

const PORT = 8199;
export const BASE = `http://localhost:${PORT}`;

// A browser is the most expensive thing this repo starts. Chromium is not
// cheap and several test files — plus several agents running `npm test` at
// once — used to launch one each, so the machine ended up with a handful of
// headless browsers competing for the same cores. `--test-concurrency=1`
// bounds a single `npm test`; it cannot see other processes. This lock can.
const LOCK_PATH = nodePath.join(os.tmpdir(), 'wings-of-mario-browser.lock');
// A whole browser suite takes well under a minute, but a queue of agents can
// stack up several runs. Wait generously, then fail loudly rather than hang.
const LOCK_TIMEOUT_MS = Number(process.env.WOM_LOCK_TIMEOUT_MS || 600000);
// Held locks get their mtime refreshed while alive, so a lock file this old
// belongs to nobody — the guard against a PID that the OS has since recycled.
const LOCK_MAX_AGE_MS = 15 * 60 * 1000;
const LOCK_HEARTBEAT_MS = 10000;

// Refcounted so a file that boots twice does not release the lock at the first
// shutdown and hand the browser to someone else mid-run.
let lockDepth = 0;
let heartbeat = null;

// null means the file is gone. A present but unparseable file reports a NaN
// pid rather than nothing: the holder may simply not have finished writing it
// yet, and the age check below is what keeps us from stealing a fresh lock.
function readLock() {
  let age;
  try {
    age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs;
  } catch {
    return null;
  }
  try {
    return { pid: Number(JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8')).pid), age };
  } catch {
    return { pid: NaN, age };
  }
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return err.code === 'EPERM';
  }
}

async function acquireLock() {
  if (lockDepth++ > 0) return;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let holder = null;
  for (;;) {
    try {
      const fd = fs.openSync(LOCK_PATH, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      fs.closeSync(fd);
      // Keep the mtime fresh so waiters can tell a long run from a corpse.
      heartbeat = setInterval(() => {
        try {
          const now = new Date();
          fs.utimesSync(LOCK_PATH, now, now);
        } catch {
          /* released or reclaimed; the next release is a no-op anyway */
        }
      }, LOCK_HEARTBEAT_MS);
      heartbeat.unref();
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') {
        lockDepth--;
        throw err;
      }
    }
    holder = readLock();
    if (!holder) continue; // released between our failed open and the read
    // A run that was killed cannot release its own lock, and that happens
    // often enough that a deadlock here would be a daily nuisance. The PID in
    // the file says whether anyone is still home. The age guard keeps us from
    // stealing a lock whose holder has not finished writing its PID yet.
    if (
      (!isAlive(holder.pid) && holder.age > 1000) ||
      holder.age > LOCK_MAX_AGE_MS
    ) {
      try {
        fs.unlinkSync(LOCK_PATH);
      } catch {
        /* someone else reclaimed it first; loop and contend for it */
      }
      continue;
    }
    if (Date.now() > deadline) {
      lockDepth--;
      throw new Error(
        `browser test lock ${LOCK_PATH} held by pid ${holder.pid} for ` +
          `${Math.round(holder.age / 1000)}s; gave up after ` +
          `${LOCK_TIMEOUT_MS}ms. If that process is gone, delete the file.`
      );
    }
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 200));
  }
}

function releaseLock() {
  if (lockDepth === 0) return;
  if (--lockDepth > 0) return;
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  // Only unlink our own lock: if we were declared stale and reclaimed, the
  // file now belongs to someone else and deleting it would hand the browser
  // to a third run.
  const holder = readLock();
  if (holder && holder.pid !== process.pid) return;
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch {
    /* already gone */
  }
}

// Backstop for the paths that never reach shutdown(): a thrown assertion that
// kills the runner, a Ctrl-C, an unhandled rejection.
process.on('exit', releaseLock);

// Exposed so the lock can be exercised on its own, without paying for a
// browser, when checking that concurrent runs really do queue up.
export const __lockForTests = { acquire: acquireLock, release: releaseLock };

// One static server and one browser shared by a whole test file. The game has
// no build step, so `http-server` over the repo root is the entire deployment.
// `opts.path` and `opts.global` pick the entry point. The defaults are Mario's
// index.html and window.__GAME; the pilot boots pilot.html and window.__WINGS.
// One harness, because two would drift apart.
export async function boot(opts = {}) {
  const path = opts.path || '/';
  const global = opts.global || '__GAME';
  await acquireLock();
  // Six test files used to spawn six servers on one port and let them fight
  // over it; whichever won served everybody, which worked by luck. Ask first.
  const server = (await serverIsUp()) ? null : spawnServer();
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
    if (server) server.kill();
    releaseLock();
    throw err;
  }
}

function spawnServer() {
  return spawn(
    'npx',
    ['http-server', '-p', String(PORT), '-c-1', '--silent', '.'],
    { stdio: 'ignore' }
  );
}

async function serverIsUp() {
  try {
    const res = await fetch(BASE + '/index.html', {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    if (await serverIsUp()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('static server never came up');
}

// Two players, one room, one real Node server. Separate browser CONTEXTS, not
// just separate pages: two clients that share a context share localStorage and
// a rendering process, and the whole point is that they are two independent
// clients.
//
// This does NOT go through the shared static server on PORT: it needs
// /room and /ws, which http-server does not have, and an ephemeral port so
// several of these can never collide with each other or with the user's own
// running build. It does still take the browser lock — Chromium is the
// expensive thing here, and it is the same Chromium.
export async function bootRoom(opts = {}) {
  const room = opts.room || 'ACDE';
  const serverErrors = [];
  await acquireLock();
  const rooms = new Rooms();
  // The archipelago seed is normally minted at random, which is right for a
  // real match and wrong for a test that compares one run against another: the
  // seed decides where the islands are, so it decides how long a sortie to
  // island 3 takes. Pinning it is what makes "the same sortie, three times, on
  // three different networks" a comparison rather than three anecdotes.
  if (opts.seed != null) rooms.getOrCreate(room, { now: Date.now(), seed: opts.seed });
  const server = await startServer({
    // Port 0: the OS picks a free one. Never a fixed port — 8123, 4322 and
    // 8199 all belong to somebody else on this machine.
    port: 0,
    rooms,
    log: {
      info() {},
      warn() {},
      // Kept rather than printed: a desync during a run is a test failure, and
      // this is where the server says so.
      error(...a) { serverErrors.push(a.join(' ')); },
    },
  });
  server.serverErrors = serverErrors;
  const base = `http://127.0.0.1:${server.port}`;

  let browser;
  try {
    browser = await chromium.launch();
    const open = async (path, global) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console: ${m.text()}`);
      });
      await page.goto(`${base}${path}?room=${room}`);
      await page.waitForFunction((g) => window[g] && window[g].ready, global, { timeout: 30000 });
      await page.evaluate((g) => window[g].ready, global);
      return { context, page, errors };
    };

    // Mario first, so he takes the mario seat deterministically.
    const mario = await open('/', '__GAME');
    const pilot = await open('/pilot.html', '__WINGS');
    await mario.page.waitForFunction(
      () => window.__NET && window.__NET.state().connected, null, { timeout: 20000 }
    );
    await pilot.page.waitForFunction(
      () => window.__WINGS.net && window.__WINGS.net.state().connected, null, { timeout: 20000 }
    );

    // Faults last, so the handshake itself is never the thing being tested:
    // a client that cannot get its HELLO through has not exercised the netcode,
    // it has failed to boot. Injected on the CLIENT transports rather than on
    // the server, so both directions of both sockets are affected and the
    // server stays a plain, fast relay — the fault under test is the network.
    if (opts.latency || opts.loss) {
      const faults = { latency: opts.latency || 0, loss: opts.loss || 0 };
      await mario.page.evaluate(({ latency, loss }) => {
        if (latency) window.__NET.latency(latency);
        if (loss) window.__NET.drop(loss);
      }, faults);
      await pilot.page.evaluate(({ latency, loss }) => {
        if (latency) window.__WINGS.net.latency(latency);
        if (loss) window.__WINGS.net.drop(loss);
      }, faults);
    }

    return { server, browser, base, room, mario, pilot };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    await server.close();
    releaseLock();
    throw err;
  }
}

export async function shutdownRoom(ctx) {
  await ctx.browser.close();
  await ctx.server.close();
  releaseLock();
}

export async function shutdown(ctx) {
  await ctx.browser.close();
  // ctx.server is null when we reused someone else's server. Killing a server
  // we did not start would break whoever does own it.
  if (ctx.server) ctx.server.kill();
  releaseLock();
}
