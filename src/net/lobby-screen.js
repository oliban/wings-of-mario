import { mintRoom, seatHref, lobbyEntries, watchLobby, fetchRooms } from './lobby.js';

// THE FRONT DOOR.
//
// The problem: which side of the match you got was decided by WHICH PAGE YOU
// OPENED — `/pilot.html` made you the pilot and minted a code, `/?room=CODE`
// made you Mario — and the only way to learn a code was to be read it out and
// type it into an address bar. Nothing on the screen ever said so.
//
// This is a screen in front of that, not a replacement for it. Every URL the
// game has ever had still means exactly what it meant; this file only ever
// produces those URLs and then navigates to one. It runs on Mario's page (`/`)
// and nowhere else — see shouldOpen — because `/` is what a person types when
// they are handed a laptop and told the address, and because `/pilot.html`
// with no room is the direct "start one as pilot" URL that several browser
// tests and the muscle memory of the person playing both depend on.
//
// It contains no game state, no socket and no simulation. It is a list of
// links and two buttons.

// How many rooms the screen offers. Larger than the header's four: this one has
// a whole page and the scroll is real estate nobody is fighting over.
export const SCREEN_LIMIT = 8;

// Should this page show the front door at all?
//
// Every "no" here is an escape hatch that already existed, and each one is the
// reason a page that must not have a lobby in the way does not get one:
//
//   ?room=CODE  a direct join. The player already chose; asking again is a
//               dialog between the click and the thing it asked for.
//   ?solo       the offline escape hatch. `?headless` implies it, which is why
//               roomFromLocation folds them together and why the capture tool
//               (tools/shot.mjs loads /index.html?headless=1) never sees this.
//   ?side=      an explicit seat request is a direct join too.
//   webdriver   automation. tests/browser/helpers.mjs boots several suites at
//               a bare `/` against the real server, expecting a game and not a
//               screen over it. A test that WANTS the front door asks for it
//               with ?lobby, which overrides everything below.
//
// And one more "no" that is not in this function because it cannot be: a
// server with no /rooms endpoint. That is the plain-static-server case — the
// offline path — and open() below learns it from the first fetch rather than
// from the URL. It is also, for free, exactly what `startServer({lobby:false})`
// looks like from here: the endpoint 404s, and the front door never appears.
export function shouldOpen({ search = '', webdriver = false } = {}) {
  const params = new URLSearchParams(search);
  if (params.has('lobby')) return true;
  if (params.has('solo') || params.has('headless')) return false;
  if (params.get('room')) return false;
  if (params.get('side')) return false;
  return !webdriver;
}

// ---------------------------------------------------------------------------
// The screen itself.

const ID = 'net-front-door';

const CSS = {
  veil: [
    'position:fixed', 'inset:0', 'z-index:50',
    'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'gap:18px', 'padding:24px',
    'background:radial-gradient(120% 90% at 50% 0%,#101a2e 0%,#06080f 55%,#04050a 100%)',
    'font:600 12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace',
    'letter-spacing:.2em', 'color:#7f92c9', 'text-align:center',
  ].join(';'),
  title: 'font-size:15px;letter-spacing:.42em;color:#cdd6f4',
  note: 'font-size:10px;letter-spacing:.18em;color:#46527a;max-width:34em',
  list: 'display:flex;flex-direction:column;gap:6px;min-width:16em',
  row: [
    'display:block', 'padding:9px 16px', 'border:1px solid #2b3552', 'border-radius:6px',
    'color:#7f92c9', 'text-decoration:none', 'background:#0b1020', 'cursor:pointer',
  ].join(';'),
  rowDead: [
    'display:block', 'padding:9px 16px', 'border:1px solid #1b2238', 'border-radius:6px',
    'color:#46527a', 'background:#080c17', 'opacity:.7',
  ].join(';'),
  button: [
    'display:block', 'padding:11px 20px', 'border:1px solid #3d4c78', 'border-radius:6px',
    'background:#141d36', 'color:#cdd6f4', 'font:inherit', 'letter-spacing:.2em',
    'cursor:pointer',
  ].join(';'),
  quiet: 'background:none;border:none;color:#46527a;font:inherit;letter-spacing:.18em;cursor:pointer;text-decoration:underline',
};

function el(doc, tag, style, text) {
  const node = doc.createElement(tag);
  if (style) node.style.cssText = style;
  if (text != null) node.textContent = text;
  return node;
}

// The veil goes up SYNCHRONOUSLY, before anything is known, and says so. The
// alternative is a second of the Mario level running under the player's nose
// and then a lobby slamming over it, which reads as a bug. If the first fetch
// says there is no lobby here, close() takes it down again and the page is
// exactly the page it has always been.
export function openVeil(doc) {
  let veil = doc.getElementById(ID);
  if (veil) return veil;
  veil = el(doc, 'div', CSS.veil);
  veil.id = ID;
  veil.appendChild(el(doc, 'div', CSS.title, 'WINGS OF MARIO'));
  veil.appendChild(el(doc, 'div', CSS.note, 'LOOKING FOR GAMES…'));
  doc.body.appendChild(veil);
  return veil;
}

export function closeVeil(doc) {
  const veil = doc.getElementById(ID);
  if (veil && veil.parentNode) veil.parentNode.removeChild(veil);
  return !!veil;
}

// Draw the whole screen. `entries` are lobbyEntries rows — the SAME rows the
// in-game header draws, so "which seat does that room need" is decided in one
// place for both. `go` is how this screen navigates; injected so a test can
// watch where a click would have taken the player without a browser.
export function renderFrontDoor(doc, { entries = [], go, error = null } = {}) {
  const veil = openVeil(doc);
  veil.textContent = '';
  const nav = typeof go === 'function' ? go : (href) => { doc.defaultView.location.href = href; };

  veil.appendChild(el(doc, 'div', CSS.title, 'WINGS OF MARIO'));

  const live = entries.filter((e) => e.joinable);
  if (entries.length) {
    veil.appendChild(el(
      doc, 'div', CSS.note,
      live.length ? 'GAMES WAITING FOR A PLAYER — PICK ONE' : 'GAMES IN PROGRESS'
    ));
    const list = el(doc, 'div', CSS.list);
    for (const entry of entries) {
      if (!entry.joinable) {
        // Listed and not clickable. A room that is full is still worth showing:
        // a player who was read that code out loud needs to find out it is
        // taken, and finding out here is better than bouncing off SEAT TAKEN.
        list.appendChild(el(doc, 'div', CSS.rowDead, entry.text));
        continue;
      }
      const a = el(doc, 'a', CSS.row, entry.text);
      a.href = entry.href;
      list.appendChild(a);
    }
    veil.appendChild(list);
  } else {
    veil.appendChild(el(doc, 'div', CSS.note, 'NO GAMES RUNNING. START ONE.'));
  }

  const start = el(doc, 'button', CSS.button, 'START A GAME — YOU FLY THE BOMBER');
  start.type = 'button';
  start.dataset.role = 'start-pilot';
  veil.appendChild(start);

  const note = el(
    doc, 'div', CSS.note,
    'THE OTHER PLAYER OPENS THIS SAME ADDRESS AND YOUR GAME IS IN THEIR LIST.'
  );
  veil.appendChild(note);

  const alone = el(doc, 'button', CSS.quiet, 'PLAY THE LEVEL ALONE');
  alone.type = 'button';
  alone.dataset.role = 'solo';
  alone.addEventListener('click', () => nav('/?solo'));
  veil.appendChild(alone);

  if (error) veil.appendChild(el(doc, 'div', CSS.note, error));
  return { veil, start, alone };
}

// Everything above is markup. This is the screen with a server behind it.
//
// Returns a handle if the front door is up — the caller must then NOT mint a
// room and NOT connect, because every button on this screen navigates. `null`
// means there is no lobby to show (no endpoint, or the URL said not to) and the
// page should boot exactly as it did before this file existed.
export async function openFrontDoor(opts = {}) {
  const doc = opts.doc || (typeof document === 'undefined' ? null : document);
  const win = opts.win || (typeof window === 'undefined' ? null : window);
  if (!doc || !win) return null;

  const search = opts.search != null ? opts.search : win.location.search;
  const webdriver = opts.webdriver != null
    ? opts.webdriver
    : !!(win.navigator && win.navigator.webdriver);
  if (!shouldOpen({ search, webdriver })) return null;

  const origin = opts.origin != null ? opts.origin : win.location.origin;
  const go = opts.go || ((href) => { win.location.href = href; });
  const mint = opts.mint || mintRoom;

  openVeil(doc);

  // One fetch, before anything is drawn, to answer the only question that can
  // cancel the front door: is there a lobby here at all? A page served by a
  // plain static server, or by a server started with { lobby: false }, gets a
  // 404 and its veil taken back down.
  const first = await fetchRooms(origin, opts.fetchImpl);
  if (!first.ok) {
    closeVeil(doc);
    return null;
  }

  let error = null;
  // What is currently on screen. The poll runs every five seconds and the list
  // usually has not changed; redrawing anyway would throw away a button the
  // player is mid-click on and blink the page at them for nothing.
  let drawn = null;
  const draw = (entries) => {
    drawn = JSON.stringify([entries, error]);
    const { start } = renderFrontDoor(doc, { entries, go, error });
    start.addEventListener('click', async () => {
      start.disabled = true;
      start.textContent = 'STARTING…';
      try {
        // The pilot seat, and the pilot's page, in one click. Mario's seat is
        // deliberately NOT a second button: whoever starts the game hands the
        // laptop-and-address to the other player, and the other player lands
        // here and clicks the room — which puts them in the seat this one left
        // open. Two buttons here would be two ways to say the same thing.
        const code = await mint(origin);
        go(seatHref('pilot', code));
      } catch (e) {
        error = 'COULD NOT START A GAME — IS THE SERVER STILL UP?';
        redraw(entries);
      }
    });
  };

  // Redraw only on a real change. `error` is in the signature because an error
  // that has just appeared is exactly a change worth repainting for.
  const redraw = (entries) => {
    if (JSON.stringify([entries, error]) === drawn) return false;
    draw(entries);
    return true;
  };

  draw(lobbyEntries(first.rooms, { limit: opts.limit || SCREEN_LIMIT }));

  // And keep it current. The scenario this exists for is two people in one
  // room: one of them starts a game while the other is already staring at this
  // screen, and the code must appear without anybody reloading anything.
  const watch = watchLobby({
    origin,
    limit: opts.limit || SCREEN_LIMIT,
    fetchImpl: opts.fetchImpl,
    setTimeoutImpl: opts.setTimeoutImpl,
    clearTimeoutImpl: opts.clearTimeoutImpl,
    visible: () => !doc.visibilityState || doc.visibilityState === 'visible',
    onEntries: (entries) => {
      // Gone from under us mid-screen means the server went away; leave the
      // last list up rather than blanking it. It is still the best guess at
      // what is out there, and the codes on it are still typeable.
      if (doc.getElementById(ID)) redraw(entries);
    },
  });

  return { doc, watch, stop: () => watch.stop() };
}
