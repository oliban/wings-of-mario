import { normalizeRoomCode, SIDES } from './protocol.js';

// Where the room code comes from, and how a player is told which one they are
// in. Everything here is a browser concern — URLs, fetch, one div — and none of
// it is simulation.

export function roomFromLocation(search = '') {
  const params = new URLSearchParams(search);
  const raw = params.get('side');
  return {
    room: normalizeRoomCode(params.get('room')),
    side: SIDES.includes(raw) ? raw : null,
    // `?solo` is the escape hatch: play offline exactly as before this plan.
    // `?headless` implies it, because the capture tool and every existing
    // browser test load these pages expecting one player and no sockets.
    solo: params.has('solo') || params.has('headless'),
  };
}

// ---------------------------------------------------------------------------
// THE SEAT TOKEN, and where it lives across a reload.
//
// The server hands out a token that puts a returning player back in their own
// seat (spec 7.4), and Room.join has always honoured it. It lived in the
// Session object and nowhere else, so it survived a dropped socket and did not
// survive a reload — and a reloaded page, arriving with no token at all, is
// indistinguishable from a stranger asking for an occupied seat. Pressing
// reload therefore locked a player out of their own match with SEAT TAKEN.
//
// sessionStorage rather than localStorage, and this is the whole design: a
// token identifies ONE seat held by ONE page. sessionStorage is scoped to the
// tab, so it survives F5 and dies with the tab — exactly a reconnect token's
// meaning — and two tabs on one laptop get two separate stores and stay two
// players, which is how this game is normally tested and often played.
//
// (Chrome's Duplicate Tab copies sessionStorage, so a duplicated tab would
// present its parent's token and take the seat over. That is one keystroke
// nobody presses mid-match, and the alternative — localStorage — would break
// the ordinary two-tab case instead.)
// ---------------------------------------------------------------------------

const SEAT_KEY_PREFIX = 'wom.seat.';

// Keyed by room AND side: one tab can hold different seats in different rooms
// over its life, and a token is only ever valid for the one it was minted for.
function seatKey(room, side) {
  const code = normalizeRoomCode(room);
  if (!code || !SIDES.includes(side)) return null;
  return `${SEAT_KEY_PREFIX}${code}.${side}`;
}

// Every access can throw, not just fail: a page in Safari's private mode or in
// a sandboxed iframe throws on the mere mention of sessionStorage. A page that
// cannot store a token still has to play, so this returns null and the caller
// joins fresh — the behaviour every page had before this existed.
function seatStore(win) {
  try {
    const w = win || (typeof window === 'undefined' ? null : window);
    return w && w.sessionStorage ? w.sessionStorage : null;
  } catch {
    return null;
  }
}

export function rememberSeat(win, room, side, token) {
  const key = seatKey(room, side);
  const store = seatStore(win);
  if (!key || !store || typeof token !== 'string' || !token) return false;
  try {
    store.setItem(key, token);
    return true;
  } catch {
    return false;
  }
}

export function recallSeat(win, room, side) {
  const key = seatKey(room, side);
  const store = seatStore(win);
  if (!key || !store) return null;
  try {
    return store.getItem(key) || null;
  } catch {
    return null;
  }
}

export function forgetSeat(win, room, side) {
  const key = seatKey(room, side);
  const store = seatStore(win);
  if (!key || !store) return false;
  try {
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function wsUrl(loc) {
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws`;
}

// Ask the server for a fresh code. POST, not GET: a link preview or a browser
// prefetch must not be able to create rooms nobody asked for.
export async function mintRoom(origin) {
  const res = await fetch(`${origin}/room`, { method: 'POST' });
  if (!res.ok) throw new Error(`lobby: could not mint a room (${res.status})`);
  const body = await res.json();
  const code = normalizeRoomCode(body.room);
  if (!code) throw new Error('lobby: server returned an illegal room code');
  return code;
}

// Put the code in the address bar so it can be copied and pasted to the other
// player. replaceState, not pushState: a room code is not a navigation step
// and Back should leave the page, not un-join the match.
export function showRoom(win, code, side) {
  const url = new URL(win.location.href);
  url.searchParams.set('room', code);
  if (side) url.searchParams.set('side', side);
  win.history.replaceState(null, '', url.toString());
  return url.toString();
}

// Why the boot failed, in the player's terms. The banner used to read OFFLINE
// for every failure alike, which told a player holding the pilot seat in
// another tab nothing at all about the tab they were staring at.
//
// Only the causes the WIRE can tell apart get a diagnosis. The server refuses a
// hello with exactly three reasons this page can hit — 'side taken' and
// 'room full' from Room.join, 'bad room code' from an unparseable code — and
// they arrive as the message of the error the session rejects with. Everything
// else (no server, no /room endpoint, a socket that never opened) is
// indistinguishable from the ordinary one-player case and stays OFFLINE.
//
// Note what is NOT here: an expired room. The server joins by getOrCreate, so a
// code whose room was reaped or lost to a restart quietly becomes a new empty
// room and the client is welcomed into it. There is nothing on the wire to
// report, and inventing one would be a guess.
const OTHER_SEAT = { pilot: 'mario', mario: 'pilot' };
const SEAT_PAGE = { pilot: '/pilot.html', mario: '/' };

// The URL that puts a player in a given seat of a given room. The one place
// that mapping is written down: the header list, the front door and the
// SEAT TAKEN advice all read it from here, so a page that ever moves moves
// once. Relative, so it works on whatever host the page came from — the LAN
// address included.
export function seatHref(side, code) {
  const page = SEAT_PAGE[side];
  const room = normalizeRoomCode(code);
  if (!page || !room) return null;
  return `${page}?room=${encodeURIComponent(room)}`;
}

export function bootFailure(err, { room, side } = {}) {
  const reason = err && err.message ? String(err.message) : '';
  const here = room ? `ROOM ${room} — ` : '';
  const other = OTHER_SEAT[side];

  if (reason === 'side taken' && other) {
    const go = room
      ? `AT ${SEAT_PAGE[other]}?room=${room}`
      : 'ON THE OTHER PAGE';
    return {
      diagnosed: true,
      text: `${here}${side.toUpperCase()} SEAT TAKEN — ${other.toUpperCase()} JOINS ${go}`,
    };
  }
  if (reason === 'room full') {
    return { diagnosed: true, text: `${here}FULL — BOTH SEATS ARE TAKEN` };
  }
  if (reason === 'bad room code') {
    return { diagnosed: true, text: `${here}NO SUCH ROOM — START A FRESH ROOM` };
  }
  return { diagnosed: false, text: 'OFFLINE' };
}

// ---------------------------------------------------------------------------
// The lobby list: which rooms exist right now, and which seat each one wants.
//
// The problem it solves: rooms live in server memory and die with it, so codes
// go stale constantly and the only way to join one was to be told the code and
// type it into a URL. Everything below turns "which rooms exist" into a line of
// links under the banner.
// ---------------------------------------------------------------------------

// The seat a link should offer, or null if there is none to offer.
//
// A seat is offerable only when the server would actually accept a hello for
// it — that is Room.join's rule, not "is somebody looking at it". A seat whose
// player closed the tab is 'away' and is still theirs to reconnect into, so it
// is NOT on offer; Room.summary explains why. Handing out a link to an 'away'
// seat would land the clicker on SEAT TAKEN, which is the exact confusion this
// list exists to remove.
//
// With both seats open, mario: it is what the server itself picks for a hello
// with no side (SIDES order, mario first), and it is the page a player who has
// not chosen yet is already looking at.
export function openSeat(summary) {
  const seats = (summary && summary.seats) || {};
  if (seats.mario === 'open') return 'mario';
  if (seats.pilot === 'open') return 'pilot';
  return null;
}

// Where clicking that room takes you. Relative, so it works on whatever host
// or port the page is being served from — the LAN address included.
export function joinHref(summary) {
  const side = openSeat(summary);
  if (!side || !summary) return null;
  return seatHref(side, summary.code);
}

// Age, in the two characters a header can spare. Not a timestamp: the question
// is "is this the one they just started", and "NEW" answers it.
export function shortAge(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60 * 1000) return 'NEW';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}M`;
  return `${Math.floor(mins / 60)}H`;
}

// What the room is waiting for, in the words of the seat it wants.
function seatLabel(summary) {
  const seats = summary.seats || {};
  const open = openSeat(summary);
  if (open) {
    const other = seats[OTHER_SEAT[open]];
    // Nobody in either seat yet: nothing is "waiting", the room is just free.
    if (other === 'open') return 'OPEN';
    return `NEEDS ${open.toUpperCase()}`;
  }
  // Both seats spoken for. 'here' means somebody is actually in it; all-'away'
  // is a match whose players both dropped and whose seats are held for their
  // reconnect until the room is reaped.
  const anyHere = SIDES.some((s) => seats[s] === 'here');
  return anyHere ? 'FULL' : 'HELD';
}

// The list as the header should show it, newest first — rows, not markup, so
// the interesting decisions are testable without a browser.
//
// `here` is this page's own room and is dropped: the banner two lines up
// already says more about it than a row ever could, and a row for the room you
// are sitting in is a link to where you already are.
export function lobbyEntries(rooms, { here = null, limit = 4 } = {}) {
  const mine = normalizeRoomCode(here);
  const out = [];
  for (const summary of Array.isArray(rooms) ? rooms : []) {
    const code = normalizeRoomCode(summary && summary.code);
    if (!code || code === mine) continue;
    const href = joinHref(summary);
    const age = shortAge(summary.ageMs);
    out.push({
      code,
      href,
      joinable: !!href,
      state: seatLabel(summary),
      age,
      // Full rooms are listed and NOT linked. Listing them is how a player who
      // was read a code out loud finds out it is full rather than wondering
      // whether the server is down; not linking them is how they find that out
      // without first being bounced off a SEAT TAKEN banner.
      text: `${code} ${seatLabel(summary)}${age ? ` ${age}` : ''}`,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// One fetch of the list. Never throws for the ordinary reasons — a page served
// by a plain static server has no /rooms at all, and that is the offline case,
// not a fault. `gone` says the endpoint does not exist and never will, so the
// caller can stop asking; see watchLobby.
export async function fetchRooms(origin, fetchImpl) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!f) return { ok: false, gone: true, rooms: [] };
  try {
    const res = await f(`${origin}/rooms`, { headers: { Accept: 'application/json' } });
    if (res.status === 404) return { ok: false, gone: true, rooms: [] };
    if (!res.ok) return { ok: false, gone: false, rooms: [] };
    const body = await res.json();
    return { ok: true, gone: false, rooms: Array.isArray(body && body.rooms) ? body.rooms : [] };
  } catch {
    // A dead server, a refused connection, a page opened from file://. All of
    // them mean "no lobby", none of them mean "broken page".
    return { ok: false, gone: false, rooms: [] };
  }
}

// How often to ask. The scenario is a player walking to another laptop and
// starting a room, so seconds matter and sub-second does not.
export const LOBBY_POLL_MS = 5000;
// How many failures in a row before this page gives up asking. A 404 gives up
// at once (there is no endpoint to wait for); a refused connection gets a few
// tries, because a server being restarted mid-playtest is the normal case.
const LOBBY_MAX_FAILS = 3;

// Poll, and hand each list to `onEntries`. Returns a stop function.
//
// POLLING RATHER THAN A PUSH DOWN THE SOCKET, deliberately: the list has to be
// useful on a page that has no socket — the offline page, the page whose room
// is full, the page still deciding which seat to take — and those are exactly
// the pages that most need to see what is joinable. A socket broadcast would
// reach only pages that already got a seat. The cost is one small JSON request
// per page per five seconds, and it is paid only while the tab is visible and
// only until the endpoint says it is not there.
export function watchLobby(opts = {}) {
  const {
    origin = '',
    here = null,
    onEntries = () => {},
    intervalMs = LOBBY_POLL_MS,
    fetchImpl = null,
    visible = () => true,
    limit = 4,
  } = opts;
  // `here` may be a function: on both pages the room code is minted DURING
  // boot, after the watcher has already started, and a list that keeps
  // offering you the room you are sitting in is worse than no list.
  const whoami = typeof here === 'function' ? here : () => here;
  const setT = opts.setTimeoutImpl || ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeoutImpl || ((id) => clearTimeout(id));

  let timer = null;
  let stopped = false;
  let fails = 0;

  const stop = () => {
    stopped = true;
    if (timer !== null) clearT(timer);
    timer = null;
  };

  const schedule = () => {
    if (stopped) return;
    timer = setT(tick, intervalMs);
  };

  async function tick() {
    if (stopped) return;
    // A hidden tab is a tab nobody is choosing a room in. Skipping the request
    // rather than the timer keeps it current the moment it is looked at again.
    if (!visible()) return schedule();
    const res = await fetchRooms(origin, fetchImpl);
    if (stopped) return;
    if (res.gone) return stop();
    if (!res.ok) {
      if (++fails >= LOBBY_MAX_FAILS) return stop();
      return schedule();
    }
    fails = 0;
    onEntries(lobbyEntries(res.rooms, { here: whoami(), limit }));
    schedule();
  }

  // The first ask is immediate: a player who reloads because they were told
  // "I started one" should not watch an empty header for five seconds.
  const first = tick();
  return { stop, first, refresh: () => tick() };
}

// The list, under the banner, as links. A separate element from the banner
// because banner() owns its textContent — and because these must be clickable,
// where the banner is deliberately pointer-events:none so it never eats a click
// meant for the game.
export function renderLobby(doc, entries) {
  let el = doc.getElementById('net-lobby');
  if (!el) {
    el = doc.createElement('div');
    el.id = 'net-lobby';
    el.style.cssText = [
      'position:fixed', 'top:30px', 'left:0', 'right:0', 'text-align:center',
      'font:600 10px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace',
      'letter-spacing:.18em', 'color:#46527a', 'pointer-events:none', 'z-index:9',
    ].join(';');
    doc.body.appendChild(el);
  }
  el.textContent = '';
  if (!entries || !entries.length) return el;
  el.appendChild(doc.createTextNode('JOIN '));
  entries.forEach((entry, i) => {
    if (i) el.appendChild(doc.createTextNode('  ·  '));
    if (!entry.joinable) {
      // Listed, dimmed, unclickable: honest about existing and honest about
      // not being available.
      const span = doc.createElement('span');
      span.style.cssText = 'opacity:.55';
      span.textContent = entry.text;
      el.appendChild(span);
      return;
    }
    const a = doc.createElement('a');
    a.href = entry.href;
    a.textContent = entry.text;
    a.style.cssText = 'pointer-events:auto;color:#7f92c9;text-decoration:none;border-bottom:1px solid #2b3552';
    el.appendChild(a);
  });
  return el;
}

// What each page calls: one line, no awaiting, nothing it can throw into a
// boot sequence. It runs beside boot() rather than inside it on purpose — the
// page whose boot FAILED, and the page sitting on a full room, are the two that
// most need to be told what else is joinable.
export function lobbyHeader({ doc, win, here = null } = {}) {
  const d = doc || (typeof document === 'undefined' ? null : document);
  const w = win || (typeof window === 'undefined' ? null : window);
  if (!d || !w) return { stop() {}, refresh() {} };
  const watch = watchLobby({
    origin: w.location.origin,
    here,
    visible: () => !d.visibilityState || d.visibilityState === 'visible',
    onEntries: (entries) => renderLobby(d, entries),
  });
  // Looking back at a tab is exactly the moment the list must be right.
  if (d.addEventListener) {
    d.addEventListener('visibilitychange', () => {
      if (!d.visibilityState || d.visibilityState === 'visible') watch.refresh();
    });
  }
  return watch;
}

// The banner. Built here rather than in either page's markup, so index.html —
// an upstream file — gains nothing at all and pilot.html gains one script tag.
export function banner(doc, text) {
  let el = doc.getElementById('net-banner');
  if (!el) {
    el = doc.createElement('div');
    el.id = 'net-banner';
    el.style.cssText = [
      'position:fixed', 'top:10px', 'left:0', 'right:0', 'text-align:center',
      'font:600 11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace',
      'letter-spacing:.24em', 'color:#7f92c9', 'pointer-events:none', 'z-index:9',
    ].join(';');
    doc.body.appendChild(el);
  }
  el.textContent = text;
  return el;
}
