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
