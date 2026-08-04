import { banner } from './lobby.js';

// The client half of the desync alarm (spec 8.4). The server does the
// comparing; this decides what a player and a bug report get to see.
//
// Both sides run this identical function, and it is a plain function over a
// plain array so it can be tested in Node with no browser and no game.

// Once per island, not once per second. A desync is PERMANENT by construction
// — nothing in this design repairs a diverged set — so the hash timer would
// otherwise reprint the same line every second until the tab is closed and
// bury every other message in the console, including whatever caused it.
export function firstForIsland(list, island) {
  return !list.some((d) => d.island === island);
}

// What the two consoles have to say between them to be worth reading: the
// server's key count and a sample of its keys, and this client's own count and
// sample of the same island. The difference between those two lists is the
// diagnosis — a client short one crater and a client short a hundred are
// different bugs, and "desync" alone does not tell them apart.
export function describeDesync(m, mine) {
  const keys = Array.isArray(mine) ? mine : [];
  const server = Array.isArray(m.sample) ? m.sample : [];
  return (
    `[DESYNC] island ${m.island}: server ${m.server} (${m.n == null ? '?' : m.n} keys), ` +
    `this client ${m.client == null ? 'never mentioned it' : m.client} (${keys.length} keys). ` +
    `server sample: ${server.join(' ') || '(none)'} | mine: ${keys.slice(0, 8).join(' ') || '(none)'}. ` +
    'The two destroyed-tile sets have diverged and will not recover.'
  );
}

// Records the desync, shouts about it once, and returns the record. `keys` is
// this client's own key list for the island, and `tick` is this side's own tick
// counter — the two sides count in different places and a record that says
// when it happened has to say so in its own terms.
export function noteDesync(list, m, { keys = [], tick = null, doc = null } = {}) {
  const record = { ...m, mine: keys.length, at: tick };
  const first = firstForIsland(list, m.island);
  list.push(record);
  if (first) {
    console.error(describeDesync(m, keys));
    if (doc) banner(doc, `DESYNC ON ${m.island} — SEE CONSOLE`);
  }
  return record;
}

export default noteDesync;
