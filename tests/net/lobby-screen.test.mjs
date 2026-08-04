// The front door, without a browser. Everything this screen decides — whether
// it appears at all, what it lists, and where each click sends the player — is
// a function of a URL and one JSON response, so all of it is testable here.
//
// The DOM below is the smallest one that renderFrontDoor actually uses. It is
// not a browser and does not pretend to be; a real browser check that the veil
// really covers the game lives in tests/browser/front-door.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldOpen, openFrontDoor, renderFrontDoor, openVeil, closeVeil, SCREEN_LIMIT,
} from '../../src/net/lobby-screen.js';
import { seatHref } from '../../src/net/lobby.js';
import { startTestServer } from './helpers.mjs';

// ---------------------------------------------------------------------------
// A DOM with nothing in it but the six things the screen touches.

class FakeNode {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase();
    this.doc = doc;
    this.children = [];
    this.parentNode = null;
    this.style = { cssText: '' };
    this.dataset = {};
    this.listeners = new Map();
    this._text = '';
    this.disabled = false;
  }

  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }

  set textContent(v) {
    for (const c of this.children) {
      c.parentNode = null;
      this.doc._forget(c);
    }
    this.children = [];
    this._text = String(v);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    this.doc._remember(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    child.parentNode = null;
    this.doc._forget(child);
    return child;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  click() {
    return Promise.all((this.listeners.get('click') || []).map((fn) => fn()));
  }

  // Everything under this node, so a test can ask what is on screen without
  // knowing how the screen is nested.
  all() {
    const out = [];
    for (const c of this.children) out.push(c, ...c.all());
    return out;
  }
}

class FakeDoc {
  constructor() {
    this.byId = new Map();
    this.visibilityState = 'visible';
    this.body = new FakeNode('body', this);
  }

  createElement(tag) {
    return new FakeNode(tag, this);
  }

  getElementById(id) {
    return this.byId.get(id) || null;
  }

  _remember(node) {
    if (node.id) this.byId.set(node.id, node);
    for (const c of node.children) this._remember(c);
  }

  _forget(node) {
    if (node.id && this.byId.get(node.id) === node) this.byId.delete(node.id);
    for (const c of node.children) this._forget(c);
  }
}

// Nodes get their id AFTER createElement, so remember them at append time and
// again once ids are set. openVeil sets the id before appending, so this is
// only belt and braces for anything that does not.
const dom = () => {
  const doc = new FakeDoc();
  const win = { location: { search: '', origin: 'http://x' }, navigator: {} };
  return { doc, win };
};

const jsonRes = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const room = (code, seats, ageMs = 1000) => ({ code, seats, ageMs });

// A fetch that answers /rooms from a mutable list and nothing else.
function fakeFetch(state) {
  return async (url) => {
    if (String(url).endsWith('/rooms')) {
      if (state.gone) return jsonRes(null, 404);
      return jsonRes({ rooms: state.rooms });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

// Nothing here should ever start a real five-second timer.
const noTimers = { setTimeoutImpl: () => 0, clearTimeoutImpl: () => {} };

// ---------------------------------------------------------------------------

test('the front door knows which pages it must stay out of', () => {
  assert.equal(shouldOpen({ search: '' }), true, 'a bare address is the whole point');
  assert.equal(shouldOpen({ search: '?room=ACDE' }), false, 'a direct join already chose');
  assert.equal(shouldOpen({ search: '?room=acde' }), false, 'lowercase code is still a code');
  assert.equal(shouldOpen({ search: '?side=mario' }), false, 'an explicit seat already chose');
  assert.equal(shouldOpen({ search: '?solo' }), false, 'the offline escape hatch');
  assert.equal(shouldOpen({ search: '?headless' }), false, 'the capture tool');
  assert.equal(shouldOpen({ search: '?headless=1' }), false, 'tools/shot.mjs, exactly');

  // Automation gets a game, not a screen over it: several browser suites boot
  // at a bare `/` against the real server and drive window.__GAME.
  assert.equal(shouldOpen({ search: '', webdriver: true }), false);
  // ...unless it is the front door itself being tested.
  assert.equal(shouldOpen({ search: '?lobby', webdriver: true }), true);
  // ?lobby beats every suppression THIS function makes, so one flag is enough
  // to put the screen up. It does not beat `?solo`, because boot() on Mario's
  // page answers solo before it ever asks this question — see mario-side.js,
  // and tests/browser/front-door.test.mjs which asserts exactly that.
  assert.equal(shouldOpen({ search: '?solo&lobby', webdriver: true }), true);
});

test('a room with no lobby endpoint gets its veil taken back down', async () => {
  const { doc, win } = dom();
  const handle = await openFrontDoor({
    doc, win, origin: 'http://x', fetchImpl: fakeFetch({ gone: true, rooms: [] }), ...noTimers,
  });
  assert.equal(handle, null, 'no lobby here');
  assert.equal(doc.getElementById('net-front-door'), null, 'and no veil left behind');
  assert.equal(doc.body.children.length, 0, 'the page is exactly the page it was');
});

test('a URL that already chose never sees the veil at all', async () => {
  const { doc, win } = dom();
  win.location.search = '?room=ACDE';
  const calls = [];
  const handle = await openFrontDoor({
    doc, win, origin: 'http://x',
    fetchImpl: async (u) => { calls.push(u); return jsonRes({ rooms: [] }); },
    ...noTimers,
  });
  assert.equal(handle, null);
  assert.equal(doc.body.children.length, 0, 'nothing was ever drawn');
  assert.deepEqual(calls, [], 'and the lobby was not even asked');
});

test('the screen lists live games and sends each click to the seat it needs', async () => {
  const { doc, win } = dom();
  const state = {
    rooms: [
      room('WJH3', { mario: 'open', pilot: 'here' }),
      room('ACDE', { mario: 'open', pilot: 'open' }),
      room('KMNP', { mario: 'here', pilot: 'here' }),
    ],
  };
  const went = [];
  const handle = await openFrontDoor({
    doc, win, origin: 'http://x', fetchImpl: fakeFetch(state),
    go: (href) => went.push(href), ...noTimers,
  });
  assert.ok(handle, 'the front door is up, so boot must not mint or connect');

  const veil = doc.getElementById('net-front-door');
  const links = veil.all().filter((n) => n.tagName === 'A');
  assert.deepEqual(links.map((a) => a.textContent), [
    'WJH3 NEEDS MARIO NEW',
    'ACDE OPEN NEW',
  ], 'a room with a pilot in it says what it needs; an empty one is just open');
  assert.equal(links[0].href, '/?room=WJH3', 'a room needing Mario opens Mario\'s page');
  assert.equal(links[1].href, seatHref('mario', 'ACDE'), 'both seats free: mario, as the server picks');

  // The full room is on screen and is NOT a link.
  assert.match(veil.textContent, /KMNP FULL/);
  assert.equal(links.length, 2, 'a full room is listed, never linked');

  // One button to start one, and one way out to a game with no second player.
  assert.ok(veil.all().find((n) => n.dataset.role === 'start-pilot'));
  assert.ok(veil.all().find((n) => n.dataset.role === 'solo'));
  handle.stop();
});

test('starting a game mints a code and flies you to the pilot seat', async () => {
  const { doc, win } = dom();
  const went = [];
  const handle = await openFrontDoor({
    doc, win, origin: 'http://x', fetchImpl: fakeFetch({ rooms: [] }),
    go: (href) => went.push(href),
    mint: async (origin) => {
      assert.equal(origin, 'http://x');
      return 'WJH3';
    },
    ...noTimers,
  });
  const veil = doc.getElementById('net-front-door');
  assert.match(veil.textContent, /NO GAMES RUNNING/, 'an empty server says so plainly');

  const start = veil.all().find((n) => n.dataset.role === 'start-pilot');
  await start.click();
  assert.deepEqual(went, ['/pilot.html?room=WJH3']);
  handle.stop();
});

test('a mint that fails says so and leaves the screen usable', async () => {
  const { doc, win } = dom();
  const went = [];
  const handle = await openFrontDoor({
    doc, win, origin: 'http://x', fetchImpl: fakeFetch({ rooms: [] }),
    go: (href) => went.push(href),
    mint: async () => { throw new Error('lobby: could not mint a room (500)'); },
    ...noTimers,
  });
  const veil = () => doc.getElementById('net-front-door');
  await veil().all().find((n) => n.dataset.role === 'start-pilot').click();
  assert.deepEqual(went, [], 'nowhere to go, so nowhere was gone');
  assert.match(veil().textContent, /COULD NOT START A GAME/);
  // Redrawn, so the button is live again rather than stuck on STARTING….
  assert.equal(veil().all().find((n) => n.dataset.role === 'start-pilot').disabled, false);
  handle.stop();
});

test('playing alone is one click and lands on the URL that has always meant it', async () => {
  const { doc, win } = dom();
  const went = [];
  const handle = await openFrontDoor({
    doc, win, origin: 'http://x', fetchImpl: fakeFetch({ rooms: [] }),
    go: (href) => went.push(href), ...noTimers,
  });
  await doc.getElementById('net-front-door').all().find((n) => n.dataset.role === 'solo').click();
  assert.deepEqual(went, ['/?solo'], 'the offline escape hatch, unchanged and now reachable');
  handle.stop();
});

test('a game started while you are staring at the screen turns up on it', async () => {
  const { doc, win } = dom();
  const state = { rooms: [] };
  const handle = await openFrontDoor({
    doc, win, origin: 'http://x', fetchImpl: fakeFetch(state),
    go: () => {}, ...noTimers,
  });
  const veil = () => doc.getElementById('net-front-door');
  assert.match(veil().textContent, /NO GAMES RUNNING/);

  // The other player, on the other laptop, presses start.
  state.rooms = [room('WJH3', { mario: 'open', pilot: 'here' })];
  await handle.watch.refresh();
  assert.match(veil().textContent, /WJH3 NEEDS MARIO/, 'no reload, no code read out loud');
  handle.stop();
});

test('the screen shows at most SCREEN_LIMIT rooms', async () => {
  const { doc, win } = dom();
  const many = [];
  for (let i = 0; i < SCREEN_LIMIT + 4; i++) {
    // Real codes: the screen drops anything the protocol would not accept.
    const A = 'ACDEFGHJKMNPQRTUVWXY34679';
    many.push(room(`AC${A[i]}${A[i + 1]}`, { mario: 'open', pilot: 'open' }));
  }
  const handle = await openFrontDoor({
    doc, win, origin: 'http://x', fetchImpl: fakeFetch({ rooms: many }),
    go: () => {}, ...noTimers,
  });
  const links = doc.getElementById('net-front-door').all().filter((n) => n.tagName === 'A');
  assert.equal(links.length, SCREEN_LIMIT);
  handle.stop();
});

test('renderFrontDoor is idempotent — a redraw replaces, never stacks', () => {
  const { doc } = dom();
  renderFrontDoor(doc, { entries: [], go: () => {} });
  renderFrontDoor(doc, { entries: [], go: () => {} });
  assert.equal(doc.body.children.length, 1, 'one veil, not two');
  assert.equal(closeVeil(doc), true);
  assert.equal(doc.body.children.length, 0);
  assert.equal(closeVeil(doc), false, 'closing a screen that is not there is not an error');
  // And openVeil never doubles up either.
  openVeil(doc);
  openVeil(doc);
  assert.equal(doc.body.children.length, 1);
});

// ---------------------------------------------------------------------------
// Against the real server, because "is there a lobby here" is a question about
// an HTTP endpoint and the answer is what decides whether the screen appears.

test('the front door honours startServer({ lobby: false })', { timeout: 30000 }, async (t) => {
  const off = await startTestServer({ lobby: false });
  t.after(() => off.close());
  const { doc, win } = dom();
  const handle = await openFrontDoor({
    doc, win, origin: `http://127.0.0.1:${off.port}`, go: () => {}, ...noTimers,
  });
  assert.equal(handle, null, 'a server that will not list its rooms gets no lobby screen');
  assert.equal(doc.body.children.length, 0);
});

test('the front door opens on a real server and lists a real room', { timeout: 30000 }, async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.port}`;
  const minted = await (await fetch(`${origin}/room`, { method: 'POST' })).json();

  const { doc, win } = dom();
  const handle = await openFrontDoor({ doc, win, origin, go: () => {}, ...noTimers });
  assert.ok(handle);
  const links = doc.getElementById('net-front-door').all().filter((n) => n.tagName === 'A');
  assert.deepEqual(links.map((a) => a.href), [seatHref('mario', minted.room)]);
  handle.stop();
});
