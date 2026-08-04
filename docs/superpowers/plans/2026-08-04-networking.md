# Networking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two browsers, two players, one live match. The pilot opens `/pilot.html?room=ABCD`, Mario opens `/?room=ABCD`, and they are in the same world: the pilot flies and bombs, Mario runs and gets cratered, and both clients' destroyed-tile sets stay byte-identical for the whole match.

**Architecture:** Split authority (spec §7.1). Each client fully simulates what it owns at 60Hz with zero input latency and streams 20Hz snapshots the other interpolates. A snapshot is **never rejected** — you are the truth about yourself. A thin Node server in `server/` serves the static files, hosts 4-character rooms, and holds exactly one piece of authoritative state: the per-island destroyed-tile map. **No game simulation runs on the server.** All client transport lives in `src/net/`, which upstream has never heard of. The engine gains **one** new method.

**Tech Stack:** Vanilla ES modules in `src/`, no build step, no npm dependencies in client code. The server may use dependencies; it uses exactly one (`ws`), justified below. Node's built-in `node:test` for tiers 1–2. Playwright (already a devDependency) for tiers 3–4.

**Ordering rule that governs this plan:** Task 5 ends with **two browsers in one room watching each other move**. Tasks 1–4 are the smallest amount of protocol that makes that real, and every task after 5 adds to something already playable. Nothing here is scaffolding for its own sake.

---

## Global Constraints

Copied from the spec and from `ARCHITECTURE.md`, which remains binding. Every task's requirements implicitly include this section.

- **No build step. No npm dependencies in `src/`. No TypeScript.** Every file under `src/` is a `.js` ES module loaded natively by the browser. **`server/` may use dependencies**; this plan adds exactly one (`ws`) and justifies it in Task 3. Nothing else.
- **Everything in `src/net/` must run unmodified in plain Node** — no `window`, no `document`, no `WebSocket` global — *except* `mario-side.js`, `mario-overlay.js`, `pilot-side.js` and `lobby.js`, which are the browser boundary and are tested in tiers 3–4 only. `protocol.js`, `interp.js`, `session.js`, `transport.js` and `damage-sync.js` are tier-1 testable and must stay that way.
- **Coordinate system:** origin top-left, +X right, **+Y down**. `TILE = 16`. Positions are floating-point pixels; velocities are pixels **per frame**, not per second.
- **Fixed timestep:** `FPS = 60.0988`, `DT = 1 / FPS`. **Simulation code must never read wall-clock time (`Date.now`, `performance.now`) or unseeded randomness.** Same seed plus the same input tape must give the same match. Two deliberate, declared exceptions, neither of which is simulation: the transport's artificial-latency timer (Task 4) and the server's room-code generator (Task 2). Both are named at their call sites.
- **Tile keys are the string `` `${tx},${ty}` ``** with no spaces, in **island-local** tile coordinates, never world coordinates. This is the wire format. `parseTileKey` rejects anything not matching `/^-?\d+,-?\d+$/` and rejects non-strings; treat `null` as "skip this key", never as an error to swallow silently on the server.
- **Island ids are level ids** — `'1-1'`, `'2-1'` — the same strings `getLevel()` takes and `Island#id` already carries.
- **The air tile record is `{ name: 'air' }` with no explicit `solid` key.** A cleared tile's `.solid` is `undefined`, never `false`. Assert truthiness, never `assert.equal(rec.solid, false)`.
- **Engine edits are confined to declared hook points** and every one gets a `MODS.md` entry. This plan adds **one method to `src/game/world.js` and one line to `index.html`**, and changes two lines of the existing `applyDamage`. `src/main.js` is **not** touched: everything Mario's client needs is already reachable through `window.__GAME.world`.
- **`window.__GAME` must not be removed or have existing members changed** — `tools/shot.mjs` drives it. `window.__WINGS` gains a `net` member and nothing else changes.
- **Never use ports 8123, 4322 or 8199.** 8123 is squatted by a stale server from an unrelated project, 4322 is the user's frozen build, and 8199 is the existing browser-test harness. This plan uses **8090** for the dev server and **8301** for test servers.
- **Original assets only.** No Nintendo ROM art or audio. Anti-aliasing is forbidden; hard pixel edges only.
- **`fly deploy` is never run.** Task 10 builds and locally verifies the Node image; deploying it requires explicit user approval and is not part of executing this plan.
- **Commit after every task.** Do not push to any remote; the user pushes.

---

## Already built — consume, do not rebuild

Verified against the working tree before this plan was written. Every name below exists today.

- **`src/wings/damage.js`** — `class DamageMap` with `add(islandId, keys) -> string[]` (returns only newly-added keys; rejects a non-array `keys` by returning `[]`), `has(islandId, key)`, `keys(islandId)` (sorted), `hash(islandId)`, `toJSON()` (`Object.create(null)`, island ids sorted), `static fromJSON(obj)`; and `hashKeys(keys) -> string` (8-char hex FNV-1a which **sorts its own input**, so the hash is order-independent by construction). **This file imports nothing**, deliberately, so the Node server runs this exact file.
- **`src/wings/blast.js`** — `blastTiles(cx, cy, radiusTiles) -> string[]`, `tileKey(tx, ty)`, `parseTileKey(key) -> {tx,ty} | null`.
- **`src/wings/island.js`** — `class Island(level, originX, damage = [])` with `id`, `originX`, `w`, `h`, `destroyed` (a `Set`), `x0/x1/y0/y1`, `inRange`, `charAt`, `blocksTile`, `destructibleTile`, `blocksAt`, `contains`, `applyDamage(keys)`, `blast(cx, cy, radiusTiles) -> string[]`, `keys()`.
- **`src/wings/geo.js`** — `VIEW_W`, `VIEW_H`, `SEA_Y`, `ISLAND_TOP_Y`, `ISLAND_H`, `DECK_X0/X1/Y`, `PLANE_W`, `PLANE_H`, `FIRST_ISLAND_X`, `ISLAND_GAP`, `layoutIslands(levels, firstX, gap)`, `worldToLocalTile(originX, px, py)`, `localTileToWorld(originX, tx, ty)`, `clamp`, `cameraFor`, `worldBounds`. **It imports only `src/core/constants.js`**, so Mario's page can import it to learn where the islands are without pulling in the flight sim.
- **`src/wings/ordnance.js`** — `ORDNANCE`, `createLoadout`, `release`, `stepShot`, `detonate`, `predictImpact`.
- **`src/wings/sim.js`** — `class WingsSim` with `constructor(opts)` taking `opts.islands` (an array of level ids) and `opts.squadron`; `islands` (an array of `Island`), `plane`, `shots`, `loadout`, `squadron`, `status`, `tick`, `events`; `step(input)`, `emit(type, data)`, `launch(kind)`, `burst(s, isle, water)`, `islandAt(px, py)`, `respawn()`, `land()`, `lose(reason)`, `turnState()`, `state()`. Also `SQUADRON`, `ISLAND_LEVELS`, `distanceTo`. **`burst()` already emits a `detonation` event carrying `{kind, x, y, radius, water, island, keys}`** — that event is the pilot's `detonate` and Task 6 forwards it verbatim.
- **`src/wings/pilot-main.js`** — `window.__WINGS` with `ready`, `sim`, `renderer`, `scene`, `hold`, `release`, `tick(n)`, `state()`, `events()`, `respawn()`, `reset(opts)`, `pause()`, `resume()`, `snapshot(type)`, `fatal()`. It exports `default pilot`, whose instance has `.sim`, `.scene`, `.renderer`, `.loop`, `.update()`, `.render()`.
- **Engine, on `World`:** `world.damage` (a `Set` of keys for the *currently loaded level only*), `world.applyDamage(keys)` (silent, unconditional record), `world.destroyTiles(keys) -> string[]` (loud: fx, `sfx('break')`, `shake(3,10)`, `_buildDecor()`, `_findLandmarks()`; returns only keys that actually removed a non-air tile), `world.blast(cx, cy, radiusTiles)` (= `destroyTiles(blastTiles(...))` **plus** `_blastKill`, which kills entities and Mario). `destroyTiles` deliberately does **not** kill: that split exists precisely so a client can replay a peer's craters without re-killing entities locally.
- **`window.__GAME`** — `game`, `ready`, `world` (getter), `renderer`, `audio`, `particles`, `screens`, `options`, `rng`, `loadLevel(id, areaId, damage)`, `teleport(tx, ty)`, `blast`, `destroyTiles`, `damageKeys()`, `setPower`, `hold`, `release`, `tick(n)`, `pause`, `resume`, `showTitle`, `setPreset`, `setPost`, `stats()`. `stats().level` is the current level id and `stats().lives` the life count.
- **`world.player`** carries `x`, `y`, `vx`, `vy`, `facing` (`1`/`-1`), `power`, `state` (`'normal'`, `'dying'`, `'climb'`, `'pipe'`, …), `grounded`, `dead`.
- **`tests/browser/helpers.mjs`** — `boot(opts)` where `opts.path` defaults to `'/'` and `opts.global` to `'__GAME'`, plus `shutdown(ctx)`. It spawns `npx http-server` on port **8199**. **Reuse it for single-client tests. Task 5 extends this same file** with a room helper rather than adding a second harness.
- **npm scripts:** `test:unit` → `node --test "tests/unit/*.test.js"`, `test:browser` → `node --test "tests/browser/*.test.mjs"`, `test` → both.
- **Baseline before this plan starts: 156 unit tests and 63 browser tests, all green, as of `272e05a`.** Every `Expected: PASS` count below is on top of that baseline; if your baseline differs because another plan landed first, the *deltas* are what matter.
- **`src/wings/bot.js`** — built and green as of `272e05a`. Deterministic autopilots, pure functions of sim state with no clock and no RNG, so a full sortie replays with identical tick counts, events and crater keys:

  ```
  takeoff(sim, budget = 600) -> boolean
  flyTo(sim, x, y, budget = 6000, opts = {}) -> boolean   // opts: near, floor, speed, dead, gear
  bombTile(sim, islandId, tx, ty, budget = 8000) -> boolean
  autoLand(sim, budget = 8000) -> boolean
  ```

  **Mirrored on `window.__WINGS`, and note the fourth name changes:** `takeoff(budget)`, `flyTo(x, y, budget)`, `bombTile(island, tx, ty, budget)`, **`land(budget)`** — not `autoLand`. Each renders once after running, so they are drivable from Playwright. Verified milestones for a full sortie: takeoff@133, release@1246, detonation@1306, landed@3488. Task 9 **uses** these and does not respecify them.

### The one name that differs between the sim and the wire

`WingsSim` emits its local ordnance event as **`'detonation'`**. The wire event, per spec §7.2, is **`'detonate'`**. **This is deliberate and the two must not be collapsed into one name**, because they are not the same thing:

- `detonation` is a *local sim event*: "a shot of mine reached something", carrying `{kind, x, y, radius, water, island, keys}`. It fires on the pilot's machine whether or not anybody is connected, and `?solo` depends on it.
- `detonate` is a *reliable wire event*: "I propose these keys be destroyed", carrying `{island, cx, cy, radius, keys}`. It exists only in a match, is owned by the pilot, is acked, and is answered by an authoritative `damage` broadcast.

Task 6's drain loop is the single translation point between them, and it is a rename plus a reshape, not a passthrough. If you ever find yourself sending `sim.events` straight down the socket, that is the bug this note exists to prevent.

**Two more corrections to older briefs, confirmed against the working tree:** ammunition is `sim.loadout` / `sim.bombs` / `sim.rockets`, never `sim.ordnance`; and **there is no sim-level `DamageMap` and no `reset({damage})`** — the pilot's craters live only on each `Island`'s own `destroyed` set, read back with `island.keys()`. That is exactly the three-shapes gap decision D3 and Task 6 exist to close, and nothing in this plan may assume a shortcut that does not exist.

---

## Recorded decisions

Three open questions were left to this plan by `MODS.md`. All three are settled here, and the settlements are load-bearing for Tasks 6 and 8. A fourth (D4) surfaced during Task 4 and is settled alongside them.

### D1. `applyDamage` records out-of-bounds keys; it just does not draw them

Today `world.applyDamage()` `continue`s on a key outside `this.w`/`this.h` *before* adding it to `this.damage`. That is right for the tile map and wrong for the wire: a client whose loaded level cannot accommodate a key the server holds would hash a strict subset of the server's set and report desync forever, with no way to recover.

**Decision: record the key unconditionally, skip only the `setTile`.** `this.damage` is the client's *replica of the server's set for this island*, not a log of tiles it drew. Two lines change; the invariant they buy is that after applying the same key list, every client's `damage` set is identical regardless of what level geometry it happens to have. The alternative — teaching the hash to ignore out-of-bounds keys — requires every client to agree on *which* keys are out of bounds, which is exactly the thing that differs between clients and so cannot be the basis of an agreement.

This is safe for the local map because `setTile` is the only thing that was ever skipped, and skipping it on an out-of-range coordinate is what it already did.

### D2. `DamageMap.add()` is authoritative; `World.destroyTiles()`'s return value never reaches the wire

Two dedup mechanisms exist and they are different predicates. `DamageMap.add()` returns keys **newly added to a set**. `World.destroyTiles()` returns keys that **actually removed a non-air tile on this client**. A key can be new to the map yet destroy nothing locally.

**Decision: the server's `DamageMap.add()` is the only authority on what is in the destroyed set.** Concretely, the one-way flow is:

```
pilot: Island.blast()  ──emit detonate{island, cx, cy, radius, keys}──▶  server
server: DamageMap.add(island, keys) ──broadcast damage{island, keys: ADDED}──▶  both clients
both clients: applyDamage(ADDED)   ← unconditional record, D1
```

`World.destroyTiles()` is **never** called by the network layer, and its return value is never sent anywhere. It stays what it is: the loud local entry point for a live detonation, used by the debug panel and by nothing in `src/net/`. The pilot's `Island.blast()` return value is a *proposal*; the server's `add()` return value is the *fact*. The pilot applies its own crater optimistically for feel and then reconciles against the broadcast, which for the pilot is always a no-op because `applyDamage` on an already-present key is idempotent.

This kills the whole class of bug where two clients disagree about what "already destroyed" means, because after this decision only one process ever evaluates that question.

### D3. The adapter is `src/net/damage-sync.js`, and it is the only place that knows about both types

`world.damage` is a `Set<string>` for one level. `DamageMap` is a `Map<islandId, Set<string>>` for a whole archipelago. Nothing bridges them today. `src/net/damage-sync.js` (Task 6) owns the bridge in both directions and is the only file allowed to:

- read `world.damage` and fold it into a `DamageMap` under the current level id,
- take a `DamageMap`'s island keys and push them into a `World` (via `applyDamage`/`replayBlast`) or an `Island` (via `applyDamage`).

Neither the engine nor `src/wings/` learns about `DamageMap`; `damage-sync.js` learns about all three.

### D4. A reliable event is acked end to end by the peer, not hop by hop by the server

A fourth question surfaced in Task 4 and is settled here. Two different acks travel the same socket and they mean different things. The server sends `{t:'ack', seq}` the moment it *relays* an EV (`server/index.js`), which says only that the message reached the server. The peer's own ack, relayed back, says the event reached the player it was aimed at.

**Decision: only the peer's ack clears the outbox.** The point of the reliable channel is that match-shaping events cannot be lost — `marioDeath`, `islandCleared`, `planeLost` and `worldCleared` each move state both players must agree on — and an ack of "the server has it" is an ack of the wrong thing. Clearing on the hop ack loses the event outright whenever the peer happens to be disconnected at that instant, which is precisely the case spec 7.4 exists for.

**The mechanism is a `peer: true` tag**, added by `Session` to every ack it sends. `validate()` checks only `seq` on an ACK, so the flag rides through the decoder untouched, and `server/index.js` relays the decoded ACK object *verbatim* — unlike a SNAP, which it rebuilds as `{ ...msg, side }`. So this needs no change to `protocol.js` and none to the server. **That verbatim relay is load-bearing:** rebuilding the ACK as a fresh `{t, seq}` would drop the tag, every ack would read as a server ack, and the outbox would resend forever. `tests/net/session.test.mjs` pins it directly.

**`detonate` is the one exemption, and needs no peer ack at all.** The server *consumes* a detonate rather than relaying it, so the peer never sees an EV to acknowledge; the authoritative `damage` broadcast carrying the proposal's `seq` is the end-to-end confirmation, and is what settles it. That falls straight out of D2: the broadcast is the fact, so the arrival of the fact is the receipt.

Two corollaries, both tested: an event sent while the other seat is empty is **held, not resent** — once the server has acknowledged it there is nobody to relay it to, so resending is a busy loop against nobody — and it is flushed the instant a `peer{present:true}` arrives. And a session must be **reused across a reconnect** rather than reconstructed, so that its `seq` counter and its seen-set survive; a fresh session restarting at `seq` 1 would have its first events silently deduped by a peer that remembers those numbers.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/net/protocol.js` (create, T1) | Message types, validation, room-code rules, event ownership. Imports nothing. |
| `server/room.js` (create, T2) | One room: sides, tokens, reconnect, the authoritative `DamageMap`, hash comparison. No sockets. |
| `server/rooms.js` (create, T2) | Room registry: code generation, lookup, reaping. |
| `server/static.js` (create, T3) | Static file serving with the MIME map from `deploy/nginx.conf`. |
| `server/index.js` (create, T3) | `node:http` + `ws`. Wires sockets to rooms. The whole server process. |
| `src/net/transport.js` (create, T4) | `WebSocket` wrapper with `latency(ms)` / `drop(pct)` / `disconnect()` fault injection. |
| `src/net/session.js` (create, T4) | Reliable outbox + acks, 20Hz snapshot cadence, 1Hz hash cadence. Side-agnostic. |
| `src/net/interp.js` (create, T5) | Snapshot ring buffer, sampled one interpolation delay behind. |
| `src/net/lobby.js` (create, T5) | Room code from the URL, or a create/join prompt. Shared by both pages. |
| `src/net/mario-overlay.js` (create, T5) | A canvas over `#screen` that draws the remote plane. Builds its own DOM. |
| `src/net/mario-side.js` (create, T5; extended T6, T7, T8) | Mario's client: boot, snapshot build/consume, event handling. Talks to the game only via `window.__GAME`. |
| `src/net/pilot-side.js` (create, T5; extended T6, T7, T8) | The pilot's client: same shape, wired into `WingsSim` and `Scene`. |
| `src/wings/art/contact.js` (create, T5) | Remote Mario as seen from the cockpit. |
| `src/net/damage-sync.js` (create, T6) | The `world.damage` ⟷ `DamageMap` adapter. D3. |
| `src/game/world.js` (modify, T6) | Hook point: `replayBlast()`, and the D1 fix to `applyDamage`. |
| `index.html` (modify, T5) | Hook point: one `<script>` tag for `src/net/mario-side.js`. |
| `pilot.html` (modify, T5) | Ours, not upstream: one `<script>` tag for `src/net/pilot-side.js`. |
| `Dockerfile` (modify, T10) | Node image replacing the nginx one. |
| `package.json` (modify, T3, T10) | `serve` script; `ws` dependency. |
| `MODS.md` (modify, T6) | The two engine touches and the resolution of the three open decisions. |
| `tests/unit/protocol.test.js` (create, T1) | Tier 1. |
| `tests/unit/room.test.js` (create, T2) | Tier 1. |
| `tests/unit/session.test.js` (create, T4) | Tier 1. |
| `tests/unit/interp.test.js` (create, T5) | Tier 1. |
| `tests/unit/damage-sync.test.js` (create, T6) | Tier 1. |
| `tests/net/helpers.mjs` (create, T3) | Spawns the real server on 8301; a fake Node WS client. |
| `tests/net/*.test.mjs` (create, T3, T7, T8) | Tier 2: two fake Node clients, no browser. |
| `tests/browser/helpers.mjs` (modify, T5) | Gains `bootRoom()`: the Node server plus two Playwright contexts. |
| `tests/browser/netplay.test.mjs` (create, T5; extended T9) | Tiers 3–4. |

---

## Task index

1. **The wire protocol** — message shapes, validation, room-code rules, event ownership. Pure, tier 1.
2. **The room state machine** — join, side assignment, reconnect, the authoritative damage map. Pure, tier 1.
3. **The server** — static files plus WebSocket rooms, driven by two fake Node clients. Tier 2. **`npm run serve` works at the end of this task.**
4. **Transport and session** — reliable events with acks, cadence, and fault injection. Tiers 1–2.
5. **Two browsers, one room, watching each other move.** Tiers 3–4. **The demonstrable milestone.**
6. **Damage sync** — the adapter, the engine replay hook, D1/D2/D3 made real. Tiers 1 and 3.
7. **Match events and hit resolution** — the nine reliable events, and a bomb that kills Mario because *Mario's* client said so. Tiers 2 and 4.
8. **Continuous desync detection** — hashing every second in real play, not just in tests. Tiers 2 and 4.
9. **The tier-4 integration test** — bomb island 3 while Mario is on island 1, then under 150ms latency and 5% loss.
10. **Deployment** — a Node image on the existing fly.io config. Built and verified locally; **not deployed**.

---

## Task 1: The wire protocol

One module, shared verbatim by the browser and the Node server, that knows what a legal message looks like. Everything downstream trusts it, so it validates rather than assumes: the server will hand it text from the network.

**Files:**
- Create: `src/net/protocol.js`
- Create: `tests/unit/protocol.test.js`

**Interfaces:**
- Consumes: nothing. This module imports no other file, for the same reason `damage.js` imports none — the server runs it unchanged.
- Produces:
  - `PROTOCOL_VERSION: number`, `SIDES: string[]`, `OTHER_SIDE: {mario:'pilot', pilot:'mario'}`
  - `MSG` — the message-type constants.
  - `EVENT_OWNER: {[type]: side}` — which side is allowed to originate each reliable event.
  - `RELIABLE_TYPES: Set<string>`
  - `ROOM_CODE_LEN`, `ROOM_CODE_ALPHABET`, `isRoomCode(s) -> boolean`, `normalizeRoomCode(s) -> string|null`
  - `encode(msg) -> string`, `decode(text) -> {ok:true, msg} | {ok:false, reason}`
  - `validate(msg) -> null | string` — `null` means valid; a string is the reason it is not.
  - `SNAPSHOT_INTERVAL_TICKS`, `HASH_INTERVAL_TICKS`, `INTERP_DELAY_TICKS`, `RESEND_INTERVAL_TICKS`, `MAX_MESSAGE_BYTES`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/protocol.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOCOL_VERSION, SIDES, OTHER_SIDE, MSG, EVENT_OWNER, RELIABLE_TYPES,
  ROOM_CODE_LEN, isRoomCode, normalizeRoomCode,
  encode, decode, validate,
  SNAPSHOT_INTERVAL_TICKS, HASH_INTERVAL_TICKS, MAX_MESSAGE_BYTES,
} from '../../src/net/protocol.js';

test('there are exactly two sides and they are each other', () => {
  assert.deepEqual(SIDES, ['mario', 'pilot']);
  assert.equal(OTHER_SIDE.mario, 'pilot');
  assert.equal(OTHER_SIDE.pilot, 'mario');
});

test('every reliable event has exactly one owner', () => {
  const expected = [
    'bombRelease', 'detonate', 'marioDeath', 'islandCleared', 'ferryBoard',
    'ferrySunk', 'sortieStart', 'landed', 'planeLost', 'worldCleared',
  ];
  assert.deepEqual(Object.keys(EVENT_OWNER).sort(), [...expected].sort());
  for (const type of expected) {
    assert.ok(SIDES.includes(EVENT_OWNER[type]), `${type} has no legal owner`);
    assert.ok(RELIABLE_TYPES.has(type), `${type} is not in RELIABLE_TYPES`);
  }
  // The three that decide the match belong to the side that can see them.
  assert.equal(EVENT_OWNER.detonate, 'pilot');
  assert.equal(EVENT_OWNER.marioDeath, 'mario');
  assert.equal(EVENT_OWNER.planeLost, 'pilot');
});

test('room codes are four characters from an unambiguous alphabet', () => {
  assert.equal(ROOM_CODE_LEN, 4);
  assert.ok(isRoomCode('ACDE'));
  assert.ok(!isRoomCode('ACD'), 'too short');
  assert.ok(!isRoomCode('ACDEF'), 'too long');
  assert.ok(!isRoomCode('AC0E'), 'zero is confusable with O and must not be in the alphabet');
  assert.ok(!isRoomCode('AC1E'), 'one is confusable with I and must not be in the alphabet');
  assert.ok(!isRoomCode(''), 'empty');
  assert.ok(!isRoomCode(null), 'non-string');
});

test('normalizeRoomCode is forgiving about case and whitespace and nothing else', () => {
  assert.equal(normalizeRoomCode(' acde '), 'ACDE');
  assert.equal(normalizeRoomCode('AcDe'), 'ACDE');
  assert.equal(normalizeRoomCode('AC-DE'), null);
  assert.equal(normalizeRoomCode('ABC'), null);
  assert.equal(normalizeRoomCode(undefined), null);
});

test('encode/decode round-trips a snapshot', () => {
  const msg = { t: MSG.SNAP, side: 'mario', tick: 120, s: { x: 1.5, y: 2.5 } };
  const back = decode(encode(msg));
  assert.equal(back.ok, true);
  assert.deepEqual(back.msg, msg);
});

test('decode refuses anything that is not a legal message', () => {
  assert.equal(decode('not json').ok, false);
  assert.equal(decode('[]').ok, false, 'an array is not a message');
  assert.equal(decode('null').ok, false);
  assert.equal(decode('42').ok, false);
  assert.equal(decode(JSON.stringify({ t: 'nonsense' })).ok, false);
  assert.equal(decode(Buffer.alloc(0)).ok, false, 'non-string input');
  const huge = JSON.stringify({ t: MSG.SNAP, side: 'mario', tick: 1, s: { pad: 'x'.repeat(MAX_MESSAGE_BYTES) } });
  assert.equal(decode(huge).ok, false, 'oversized payloads must be refused, not parsed');
});

test('hello must name a room and may name a side', () => {
  assert.equal(validate({ t: MSG.HELLO, v: PROTOCOL_VERSION, room: 'ACDE' }), null);
  assert.equal(validate({ t: MSG.HELLO, v: PROTOCOL_VERSION, room: 'ACDE', side: 'pilot' }), null);
  assert.ok(validate({ t: MSG.HELLO, v: PROTOCOL_VERSION, room: 'zz' }));
  assert.ok(validate({ t: MSG.HELLO, v: PROTOCOL_VERSION, room: 'ACDE', side: 'bowser' }));
  assert.ok(validate({ t: MSG.HELLO, v: PROTOCOL_VERSION + 1, room: 'ACDE' }), 'version mismatch is a reason');
});

test('an event must carry a sequence number and a known type', () => {
  assert.equal(validate({ t: MSG.EV, seq: 1, type: 'detonate', d: {} }), null);
  assert.ok(validate({ t: MSG.EV, type: 'detonate', d: {} }), 'missing seq');
  assert.ok(validate({ t: MSG.EV, seq: 0.5, type: 'detonate', d: {} }), 'seq must be an integer');
  assert.ok(validate({ t: MSG.EV, seq: 1, type: 'nope', d: {} }), 'unknown event type');
  assert.ok(validate({ t: MSG.EV, seq: 1, type: 'detonate' }), 'missing payload');
});

test('a hash frame is a plain object of island to hash', () => {
  assert.equal(validate({ t: MSG.HASH, tick: 60, h: { '1-1': 'deadbeef' } }), null);
  assert.equal(validate({ t: MSG.HASH, tick: 60, h: {} }), null, 'an empty archipelago is legal');
  assert.ok(validate({ t: MSG.HASH, tick: 60, h: [] }), 'an array is not a hash map');
  assert.ok(validate({ t: MSG.HASH, h: {} }), 'missing tick');
});

test('a snapshot is never rejected for its contents, only for its shape', () => {
  // Spec 7.1: you are the truth about yourself. Physically absurd values are
  // still legal messages — this is a game friends play together, not a
  // tournament, and validating gameplay here would be validating it twice.
  assert.equal(validate({ t: MSG.SNAP, side: 'pilot', tick: 3, s: { x: -1e9, fuel: 999 } }), null);
  assert.ok(validate({ t: MSG.SNAP, side: 'pilot', tick: 3 }), 'shape still matters');
  assert.ok(validate({ t: MSG.SNAP, side: 'nobody', tick: 3, s: {} }));
});

test('the cadences are the ones the spec asks for', () => {
  // 60.0988Hz fixed step; 20Hz snapshots is every third tick; hashes once a second.
  assert.equal(SNAPSHOT_INTERVAL_TICKS, 3);
  assert.equal(HASH_INTERVAL_TICKS, 60);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/net/protocol.js'`

- [ ] **Step 3: Write the protocol**

Create `src/net/protocol.js`:

```js
// The wire. This file imports nothing so the Node server can run it byte for
// byte identically to the browser — the same reason src/wings/damage.js
// imports nothing. Anything added here must keep that property.

export const PROTOCOL_VERSION = 1;

export const SIDES = ['mario', 'pilot'];
export const OTHER_SIDE = { mario: 'pilot', pilot: 'mario' };

export const MSG = {
  HELLO: 'hello',     // client -> server: I want into this room
  WELCOME: 'welcome', // server -> client: you are this side, here is the match
  PEER: 'peer',       // server -> client: the other side arrived or left
  SNAP: 'snap',       // either way, 20Hz, unreliable, never rejected
  EV: 'ev',           // either way, reliable, acked, resent until acked
  ACK: 'ack',         // acknowledgement of one EV seq
  DAMAGE: 'damage',   // server -> both: these keys are now destroyed. Authoritative.
  HASH: 'hash',       // client -> server: my destroyed-set hashes
  DESYNC: 'desync',   // server -> client: yours and mine disagree
  ERROR: 'error',     // server -> client: refused, with a reason
};

// Which side is allowed to originate each reliable event, per spec 7.3: hit
// resolution follows ownership. The server drops an event from the wrong side
// rather than relaying it, so "I dodged that" can only ever be argued with the
// client that owns the thing being dodged.
//
// Note the asymmetry with snapshots, which are NEVER rejected. A snapshot is a
// statement about yourself; an event is a claim about the shared world.
export const EVENT_OWNER = {
  bombRelease: 'pilot',
  detonate: 'pilot',
  sortieStart: 'pilot',
  landed: 'pilot',
  planeLost: 'pilot',
  ferrySunk: 'pilot',
  marioDeath: 'mario',
  islandCleared: 'mario',
  ferryBoard: 'mario',
  worldCleared: 'mario',
};

export const RELIABLE_TYPES = new Set(Object.keys(EVENT_OWNER));

// Room codes are read aloud over a voice call, so the alphabet drops every
// character that is confusable when spoken or seen: O/0, I/1/L, S/5, B/8, Z/2.
export const ROOM_CODE_LEN = 4;
export const ROOM_CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';

export function isRoomCode(s) {
  if (typeof s !== 'string' || s.length !== ROOM_CODE_LEN) return false;
  for (const ch of s) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

export function normalizeRoomCode(s) {
  if (typeof s !== 'string') return null;
  const up = s.trim().toUpperCase();
  return isRoomCode(up) ? up : null;
}

// Cadences, in fixed 60.0988Hz ticks. 20Hz snapshots is every third tick;
// hashes once a second (spec 8.4); the interpolation delay is two snapshot
// intervals, so one dropped snapshot still has a successor to interpolate to.
export const SNAPSHOT_INTERVAL_TICKS = 3;
export const HASH_INTERVAL_TICKS = 60;
export const INTERP_DELAY_TICKS = 6;
export const RESEND_INTERVAL_TICKS = 12;

// A snapshot is under 200 bytes and the biggest legal message is a full damage
// dump on join. 256KB is far past anything real and far short of anything that
// can exhaust the server, and refusing at the decoder means a hostile payload
// is never even parsed.
export const MAX_MESSAGE_BYTES = 256 * 1024;

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

// null means valid. A string is the reason it is not, and that reason is what
// the server puts in its ERROR reply, so it has to be safe to say out loud.
export function validate(msg) {
  if (!isPlainObject(msg)) return 'not an object';
  switch (msg.t) {
    case MSG.HELLO:
      if (msg.v !== PROTOCOL_VERSION) return `protocol version ${msg.v} != ${PROTOCOL_VERSION}`;
      if (!isRoomCode(msg.room)) return 'bad room code';
      if (msg.side != null && !SIDES.includes(msg.side)) return 'bad side';
      if (msg.token != null && typeof msg.token !== 'string') return 'bad token';
      return null;
    case MSG.WELCOME:
      if (!SIDES.includes(msg.side)) return 'bad side';
      if (!isRoomCode(msg.room)) return 'bad room code';
      if (typeof msg.token !== 'string') return 'bad token';
      if (!isInt(msg.seed)) return 'bad seed';
      if (!isPlainObject(msg.damage)) return 'bad damage map';
      return null;
    case MSG.PEER:
      if (!SIDES.includes(msg.side)) return 'bad side';
      if (typeof msg.present !== 'boolean') return 'bad presence';
      return null;
    case MSG.SNAP:
      // Deliberately shape-only. Spec 7.1: never rejected — you are the truth
      // about yourself, so the contents of `s` are not this layer's business.
      if (!SIDES.includes(msg.side)) return 'bad side';
      if (!isInt(msg.tick)) return 'bad tick';
      if (!isPlainObject(msg.s)) return 'bad snapshot body';
      return null;
    case MSG.EV:
      if (!isInt(msg.seq) || msg.seq < 0) return 'bad seq';
      if (!RELIABLE_TYPES.has(msg.type)) return `unknown event type ${msg.type}`;
      if (!isPlainObject(msg.d)) return 'bad event payload';
      return null;
    case MSG.ACK:
      if (!isInt(msg.seq) || msg.seq < 0) return 'bad seq';
      return null;
    case MSG.DAMAGE:
      if (typeof msg.island !== 'string' || !msg.island) return 'bad island';
      if (!Array.isArray(msg.keys)) return 'bad keys';
      return null;
    case MSG.HASH:
      if (!isInt(msg.tick)) return 'bad tick';
      if (!isPlainObject(msg.h)) return 'bad hash map';
      return null;
    case MSG.DESYNC:
      if (typeof msg.island !== 'string') return 'bad island';
      return null;
    case MSG.ERROR:
      if (typeof msg.reason !== 'string') return 'bad reason';
      return null;
    default:
      return `unknown message type ${msg && msg.t}`;
  }
}

export function encode(msg) {
  return JSON.stringify(msg);
}

// Never throws. The server feeds this whatever arrived on the socket, so a
// malformed frame has to be a return value, not an exception to be caught at
// every call site.
export function decode(text) {
  if (typeof text !== 'string') return { ok: false, reason: 'not text' };
  if (text.length > MAX_MESSAGE_BYTES) return { ok: false, reason: 'too large' };
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'bad json' };
  }
  const bad = validate(msg);
  if (bad) return { ok: false, reason: bad };
  return { ok: true, msg };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS. 10 new tests on top of the 148 baseline.

- [ ] **Step 5: Verify it really is import-free, the way `damage.js` is**

Run: `node -e "import('./src/net/protocol.js').then(m => console.log(Object.keys(m).length, 'exports'))"`
Expected: prints an export count and no error. If this file ever gains an import of anything under `src/core/` or `src/game/`, the server stops being able to run it and Task 3 breaks.

Run: `grep -c "^import" src/net/protocol.js`
Expected: `0`

- [ ] **Step 6: Commit**

```bash
git add src/net/protocol.js tests/unit/protocol.test.js
git commit -m "Wire protocol: message shapes, room codes and event ownership"
```

---

## Task 2: The room state machine

A room, with no sockets in it at all. Everything that decides who is Mario, who reconnects into what, and what the destroyed-tile map contains happens here and is testable in plain Node in milliseconds.

**Files:**
- Create: `server/room.js`
- Create: `server/rooms.js`
- Create: `tests/unit/room.test.js`

**Interfaces:**
- Consumes: `SIDES`, `OTHER_SIDE`, `EVENT_OWNER`, `ROOM_CODE_ALPHABET`, `ROOM_CODE_LEN`, `isRoomCode` from `src/net/protocol.js`; `DamageMap`, `hashKeys` from `src/wings/damage.js`; `parseTileKey` from `src/wings/blast.js`.
- Produces:
  - `class Room` — `code`, `seed`, `damage` (a `DamageMap`), `sides` (a `Map<side, seat>`), `lastActivity`
    - `join({side, token}) -> {ok:true, side, token, reconnected} | {ok:false, reason}`
    - `leave(token) -> boolean`
    - `seatFor(token) -> {side, token, present} | null`
    - `present(side) -> boolean`
    - `recordDetonate(side, islandId, keys) -> {ok:true, added} | {ok:false, reason}`
    - `mayEmit(side, type) -> boolean`
    - `compareHashes(hashes) -> [{island, server, client}]`
    - `matchState() -> {seed, damage, sides}`
    - `touch(now)`, `idleFor(now) -> number`, `empty() -> boolean`
  - `class Rooms` — `create(opts) -> Room`, `get(code) -> Room|null`, `getOrCreate(code)`, `drop(code)`, `reap(now) -> string[]`, `size`
  - `ROOM_IDLE_MS`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/room.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, Rooms, ROOM_IDLE_MS } from '../../server/room.js';
import { hashKeys } from '../../src/wings/damage.js';
import { isRoomCode } from '../../src/net/protocol.js';

test('the first player picks a side and the second gets the other', () => {
  const r = new Room('ACDE', { seed: 7 });
  const a = r.join({ side: 'pilot' });
  assert.equal(a.ok, true);
  assert.equal(a.side, 'pilot');
  const b = r.join({});
  assert.equal(b.ok, true);
  assert.equal(b.side, 'mario');
});

test('a first player who picks nothing gets mario, and the pilot follows', () => {
  const r = new Room('ACDE', { seed: 7 });
  assert.equal(r.join({}).side, 'mario');
  assert.equal(r.join({}).side, 'pilot');
});

test('a third player is refused', () => {
  const r = new Room('ACDE', { seed: 7 });
  r.join({});
  r.join({});
  const c = r.join({});
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'room full');
});

test('asking for a taken side is refused rather than silently reassigned', () => {
  // Silently handing them the other side is worse: they came to fly.
  const r = new Room('ACDE', { seed: 7 });
  r.join({ side: 'pilot' });
  const b = r.join({ side: 'pilot' });
  assert.equal(b.ok, false);
  assert.equal(b.reason, 'side taken');
});

test('a token reconnects into the same seat, damage and all', () => {
  const r = new Room('ACDE', { seed: 7 });
  const a = r.join({ side: 'pilot' });
  r.recordDetonate('pilot', '1-1', ['5,10', '6,10']);
  assert.equal(r.leave(a.token), true);
  assert.equal(r.present('pilot'), false);

  const back = r.join({ token: a.token });
  assert.equal(back.ok, true);
  assert.equal(back.side, 'pilot');
  assert.equal(back.reconnected, true);
  assert.equal(back.token, a.token, 'the token must survive the round trip');
  assert.deepEqual(r.matchState().damage['1-1'], ['5,10', '6,10']);
});

test('a stale token from another room is refused, not honoured', () => {
  const r = new Room('ACDE', { seed: 7 });
  const s = r.join({ side: 'mario' });
  const other = new Room('FGHJ', { seed: 7 });
  const bad = other.join({ token: s.token });
  // Unknown token means "treat me as new", and the seat is free, so this
  // succeeds — but as a FRESH seat, not a reconnect.
  assert.equal(bad.ok, true);
  assert.equal(bad.reconnected, false);
  assert.notEqual(bad.token, s.token);
});

test('the seat is held while the peer is away, not handed to a stranger', () => {
  const r = new Room('ACDE', { seed: 7 });
  const a = r.join({ side: 'pilot' });
  r.leave(a.token);
  const stranger = r.join({ side: 'pilot' });
  assert.equal(stranger.ok, false);
  assert.equal(stranger.reason, 'side taken');
});

test('detonate is recorded and deduplicated by the SERVER, not the client', () => {
  // Decision D2: DamageMap.add() is the only authority on what is in the set.
  const r = new Room('ACDE', { seed: 7 });
  r.join({ side: 'pilot' });
  const first = r.recordDetonate('pilot', '1-1', ['5,10', '6,10']);
  assert.deepEqual(first.added.sort(), ['5,10', '6,10']);
  const second = r.recordDetonate('pilot', '1-1', ['6,10', '7,10']);
  assert.deepEqual(second.added, ['7,10'], 'only genuinely new keys are broadcast');
  const third = r.recordDetonate('pilot', '1-1', ['6,10']);
  assert.deepEqual(third.added, [], 'a repeat adds nothing and is still ok');
  assert.equal(third.ok, true);
});

test('malformed tile keys are dropped before they reach the damage map', () => {
  const r = new Room('ACDE', { seed: 7 });
  r.join({ side: 'pilot' });
  const out = r.recordDetonate('pilot', '1-1', ['5,10', '', 'x,y', '1e3,4', 42, null, '6,10']);
  assert.deepEqual(out.added.sort(), ['5,10', '6,10']);
  assert.deepEqual(r.matchState().damage['1-1'], ['5,10', '6,10']);
});

test('mario may not detonate terrain', () => {
  const r = new Room('ACDE', { seed: 7 });
  const out = r.recordDetonate('mario', '1-1', ['5,10']);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'not the owner of detonate');
  assert.deepEqual(r.matchState().damage, {}, 'a refused detonate must record nothing');
});

test('event ownership is enforced in both directions', () => {
  const r = new Room('ACDE', { seed: 7 });
  assert.equal(r.mayEmit('pilot', 'detonate'), true);
  assert.equal(r.mayEmit('mario', 'detonate'), false);
  assert.equal(r.mayEmit('mario', 'marioDeath'), true);
  assert.equal(r.mayEmit('pilot', 'marioDeath'), false);
  assert.equal(r.mayEmit('pilot', 'nonsense'), false);
});

test('hash comparison names every island that disagrees and nothing else', () => {
  const r = new Room('ACDE', { seed: 7 });
  r.join({ side: 'pilot' });
  r.recordDetonate('pilot', '1-1', ['5,10', '6,10']);
  r.recordDetonate('pilot', '1-2', ['1,1']);

  const agreeing = { '1-1': hashKeys(['6,10', '5,10']), '1-2': hashKeys(['1,1']) };
  assert.deepEqual(r.compareHashes(agreeing), [], 'order must not matter');

  const wrong = { '1-1': hashKeys(['5,10']), '1-2': hashKeys(['1,1']) };
  const bad = r.compareHashes(wrong);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].island, '1-1');
  assert.equal(bad[0].server, hashKeys(['5,10', '6,10']));
});

test('an island the client has never touched must still match the empty hash', () => {
  const r = new Room('ACDE', { seed: 7 });
  assert.deepEqual(r.compareHashes({ '3-4': hashKeys([]) }), []);
  assert.equal(r.compareHashes({ '3-4': 'ffffffff' }).length, 1);
});

test('a room reports how long it has been idle and when it is empty', () => {
  const r = new Room('ACDE', { seed: 7, now: 1000 });
  const a = r.join({ side: 'mario' }, 1000);
  assert.equal(r.empty(), false);
  assert.equal(r.idleFor(5000), 0, 'a room with somebody in it is never idle');
  r.leave(a.token, 2000);
  assert.equal(r.empty(), true);
  assert.equal(r.idleFor(5000), 3000);
});

test('the registry mints legal, unique codes and reaps idle rooms', () => {
  // Injected generator: deterministic, and it collides on purpose the first time.
  const feed = ['ACDE', 'ACDE', 'FGHJ'];
  let i = 0;
  const rooms = new Rooms({ codeGen: () => feed[i++] });
  const a = rooms.create({ now: 0 });
  const b = rooms.create({ now: 0 });
  assert.equal(a.code, 'ACDE');
  assert.equal(b.code, 'FGHJ', 'a collision must be retried, not overwritten');
  assert.ok(isRoomCode(a.code) && isRoomCode(b.code));
  assert.equal(rooms.get('ACDE'), a);
  assert.equal(rooms.get('acde'), a, 'lookup normalizes');
  assert.equal(rooms.get('nope'), null);

  const reaped = rooms.reap(ROOM_IDLE_MS + 1);
  assert.deepEqual(reaped.sort(), ['ACDE', 'FGHJ']);
  assert.equal(rooms.size, 0);
});

test('an occupied room is never reaped', () => {
  const rooms = new Rooms({ codeGen: () => 'ACDE' });
  const r = rooms.create({ now: 0 });
  r.join({ side: 'mario' }, 0);
  assert.deepEqual(rooms.reap(ROOM_IDLE_MS * 10), []);
  assert.equal(rooms.size, 1);
});

test('the default code generator produces legal codes', () => {
  const rooms = new Rooms();
  for (let i = 0; i < 50; i++) assert.ok(isRoomCode(rooms.create({ now: 0 }).code));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../server/room.js'`

- [ ] **Step 3: Write the room**

Create `server/room.js`:

```js
import {
  SIDES, OTHER_SIDE, EVENT_OWNER, ROOM_CODE_ALPHABET, ROOM_CODE_LEN, normalizeRoomCode,
} from '../src/net/protocol.js';
import { DamageMap, hashKeys } from '../src/wings/damage.js';
import { parseTileKey } from '../src/wings/blast.js';

// How long an empty room is kept before it is thrown away. Long enough that a
// tab crash, a laptop lid or a train tunnel reconnects into the same match
// (spec 7.4), short enough that a forgotten room is not held forever.
export const ROOM_IDLE_MS = 10 * 60 * 1000;

let tokenCounter = 0;

// A seat token. Not a security credential — spec 11 puts anti-cheat explicitly
// out of scope — just something unguessable enough that two people in the same
// cafe do not collide, and unique enough to identify a reconnecting seat.
function mintToken(code, side) {
  tokenCounter++;
  const noise = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `${code}.${side}.${tokenCounter}.${noise}`;
}

export class Room {
  constructor(code, opts = {}) {
    this.code = code;
    // The archipelago seed. Every client derives layout, ferry timing and AA
    // behaviour from it (spec 8.1), so it is minted once, here, and never
    // recomputed. `opts.seed` exists so tests can pin it.
    this.seed = opts.seed != null ? opts.seed : (Math.random() * 0x7fffffff) | 0;
    // The entire authoritative shared state of the match (spec 4.3). Nothing
    // else on this server is authoritative about anything.
    this.damage = new DamageMap();
    this.sides = new Map(); // side -> { side, token, present }
    this.lastActivity = opts.now != null ? opts.now : 0;
  }

  touch(now) {
    if (now != null) this.lastActivity = now;
  }

  present(side) {
    const seat = this.sides.get(side);
    return !!seat && seat.present;
  }

  empty() {
    for (const seat of this.sides.values()) if (seat.present) return false;
    return true;
  }

  idleFor(now) {
    return this.empty() ? Math.max(0, now - this.lastActivity) : 0;
  }

  seatFor(token) {
    if (typeof token !== 'string') return null;
    for (const seat of this.sides.values()) if (seat.token === token) return seat;
    return null;
  }

  // A token reconnects into its own seat. Otherwise the requested side is
  // taken if free; with no request, whichever side is free, mario first.
  join({ side, token } = {}, now) {
    this.touch(now);
    const existing = this.seatFor(token);
    if (existing) {
      existing.present = true;
      return { ok: true, side: existing.side, token: existing.token, reconnected: true };
    }

    let want = SIDES.includes(side) ? side : null;
    if (want && this.sides.has(want)) return { ok: false, reason: 'side taken' };
    if (!want) {
      want = SIDES.find((s) => !this.sides.has(s)) || null;
      if (!want) return { ok: false, reason: 'room full' };
    }

    const seat = { side: want, token: mintToken(this.code, want), present: true };
    this.sides.set(want, seat);
    return { ok: true, side: seat.side, token: seat.token, reconnected: false };
  }

  // Leaving marks the seat absent but KEEPS it: the whole point of holding
  // match state is that a disconnect reconnects into the same match rather
  // than losing it, and a seat handed to a stranger in the meantime would
  // make that impossible.
  leave(token, now) {
    this.touch(now);
    const seat = this.seatFor(token);
    if (!seat) return false;
    seat.present = false;
    return true;
  }

  mayEmit(side, type) {
    return EVENT_OWNER[type] === side;
  }

  // The one place the destroyed-tile map is written. Decision D2: this
  // function's return value — DamageMap.add()'s newly-added keys — is the
  // fact. What a client's own destroyTiles() thought it removed is not.
  recordDetonate(side, islandId, keys, now) {
    this.touch(now);
    if (!this.mayEmit(side, 'detonate')) return { ok: false, reason: 'not the owner of detonate' };
    if (typeof islandId !== 'string' || !islandId) return { ok: false, reason: 'bad island' };
    if (!Array.isArray(keys)) return { ok: false, reason: 'bad keys' };
    // parseTileKey returns null for anything that is not `<int>,<int>`. Drop
    // those here rather than at the client: a key that reached the map would
    // be broadcast to a peer that cannot parse it, and the two would then
    // disagree forever with no way to tell which one was right.
    const clean = keys.filter((k) => parseTileKey(k) !== null);
    return { ok: true, added: this.damage.add(islandId, clean) };
  }

  // Every island the client mentions is compared against the server's set for
  // that island — including islands the server has never damaged, which must
  // hash as empty rather than be skipped, or a client that invented damage
  // out of nowhere would never be caught.
  compareHashes(hashes) {
    const out = [];
    if (!hashes || typeof hashes !== 'object') return out;
    for (const island of Object.keys(hashes)) {
      const server = this.damage.hash(island);
      if (hashes[island] !== server) out.push({ island, server, client: hashes[island] });
    }
    return out;
  }

  matchState() {
    return {
      seed: this.seed,
      damage: this.damage.toJSON(),
      sides: SIDES.filter((s) => this.sides.has(s)),
    };
  }
}

// ---------------------------------------------------------------------------

// Room codes are the one thing on this server allowed to be random: they are
// not simulation, they must not be predictable, and no test depends on their
// value (every test injects `codeGen`).
function defaultCodeGen() {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) {
    out += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

export class Rooms {
  constructor(opts = {}) {
    this.rooms = new Map();
    this.codeGen = opts.codeGen || defaultCodeGen;
  }

  get size() {
    return this.rooms.size;
  }

  create(opts = {}) {
    // Retry on collision. With a 25-character alphabet there are 390625 codes,
    // so this loop effectively never runs twice; the bound is there so a
    // broken generator fails loudly instead of hanging the process.
    for (let i = 0; i < 200; i++) {
      const code = this.codeGen();
      if (this.rooms.has(code)) continue;
      const room = new Room(code, opts);
      this.rooms.set(code, room);
      return room;
    }
    throw new Error('rooms: could not mint a free code');
  }

  get(code) {
    const norm = normalizeRoomCode(code);
    return norm ? this.rooms.get(norm) || null : null;
  }

  getOrCreate(code, opts = {}) {
    const norm = normalizeRoomCode(code);
    if (!norm) return null;
    let room = this.rooms.get(norm);
    if (!room) {
      room = new Room(norm, opts);
      this.rooms.set(norm, room);
    }
    return room;
  }

  drop(code) {
    const norm = normalizeRoomCode(code);
    return norm ? this.rooms.delete(norm) : false;
  }

  reap(now) {
    const dropped = [];
    for (const [code, room] of this.rooms) {
      if (room.idleFor(now) > ROOM_IDLE_MS) {
        this.rooms.delete(code);
        dropped.push(code);
      }
    }
    return dropped;
  }
}

export default Room;
```

Note `OTHER_SIDE` and `hashKeys` are imported but only `hashKeys` is used indirectly through `DamageMap.hash`. Drop any import this file does not actually use before committing — an unused import in a server file is a merge hazard for no benefit.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit`
Expected: PASS. 17 new tests.

- [ ] **Step 5: Verify the server files run under plain Node with no browser globals**

Run: `node -e "import('./server/room.js').then(m => { const r = new m.Room('ACDE', {seed: 1}); r.join({side:'pilot'}); console.log(r.recordDetonate('pilot','1-1',['5,10']).added, r.damage.hash('1-1')); })"`
Expected: `[ '5,10' ] ` followed by an 8-character hex hash, with no `window is not defined`.

- [ ] **Step 6: Commit**

```bash
git add server/room.js tests/unit/room.test.js
git commit -m "Room state machine: sides, reconnect tokens and the authoritative damage map

The server's only authoritative state is the per-island destroyed-tile set,
and DamageMap.add() is the sole arbiter of what is in it (decision D2)."
```

---

## Task 3: The server

`node:http` for the static files, `ws` for the sockets, `server/room.js` for everything that thinks. At the end of this task `npm run serve` serves the real game on port 8090 and two Node processes can join a room and talk to each other.

**Files:**
- Create: `server/static.js`
- Create: `server/index.js`
- Create: `tests/net/helpers.mjs`
- Create: `tests/net/room.test.mjs`
- Modify: `package.json`

**Dependency justification — one, and only one.** `ws` implements RFC 6455 framing, masking, ping/pong and close handshakes. Writing that by hand is a week of work that is not this game, and it is the piece where a subtle bug looks exactly like a netcode bug. `ws` has **zero runtime dependencies of its own**, so this adds one package and not a tree. Static file serving is done with `node:http` and `node:fs` rather than express — a 60-line handler with an explicit MIME map is smaller than the dependency would be, and the MIME map has to be explicit anyway (see `deploy/nginx.conf`: a module served as `text/plain` is refused by the browser and the whole game silently fails to boot).

**Interfaces:**
- Consumes: `Rooms`, `Room` from `server/room.js`; `MSG`, `decode`, `encode`, `validate`, `OTHER_SIDE`, `normalizeRoomCode` from `src/net/protocol.js`.
- Produces:
  - `server/static.js` — `MIME: {[ext]: string}`, `serveStatic(req, res, root) -> Promise<boolean>` (false if the path was not a file, so the caller can 404).
  - `server/index.js` — `startServer({port, root, rooms}) -> Promise<{http, wss, rooms, port, close()}>`; run directly it starts on `process.env.PORT || 8090`.
  - `tests/net/helpers.mjs` — `startTestServer()`, `connect(port, hello)`, `class FakeClient`.

- [ ] **Step 1: Add `ws` and the serve script to `package.json`**

Run: `npm install ws@^8.18.0`

Then in `"scripts"`, add alongside the existing entries:

```json
    "serve": "node server/index.js",
    "test:net": "node --test \"tests/net/*.test.mjs\"",
```

and change `"test"` to include the new tier:

```json
    "test": "npm run test:unit && npm run test:net && npm run test:browser",
```

Verify: `node -e "import('ws').then(m => console.log('ws ok', typeof m.WebSocketServer))"`
Expected: `ws ok function`

- [ ] **Step 2: Write the static handler**

Create `server/static.js`:

```js
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

// The same map as deploy/nginx.conf, and for the same reason: an ES module
// served as text/plain is refused by the browser and the whole game silently
// fails to boot with no console error worth reading.
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
};

// Resolve a URL path inside `root` and refuse anything that escapes it.
// `..` in a request path is the oldest bug on the web and this server is
// about to be exposed on the public internet by Task 10.
function resolveSafe(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.endsWith('/')) decoded += 'index.html';
  const full = normalize(join(root, decoded));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

export async function serveStatic(req, res, root) {
  const full = resolveSafe(root, req.url || '/');
  if (!full) {
    res.writeHead(403).end('forbidden');
    return true;
  }
  let info;
  try {
    info = await stat(full);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  const type = MIME[extname(full).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': info.size,
    'X-Content-Type-Options': 'nosniff',
    // The art modules are large string-literal files that change on every art
    // pass, so they are revalidated rather than cached hard — same policy the
    // nginx config had.
    'Cache-Control': 'public, max-age=0, must-revalidate',
  });
  createReadStream(full).pipe(res);
  return true;
}
```

- [ ] **Step 3: Write the server**

Create `server/index.js`:

```js
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WebSocketServer } from 'ws';

import { serveStatic } from './static.js';
import { Rooms } from './room.js';
import {
  MSG, PROTOCOL_VERSION, OTHER_SIDE, decode, encode, normalizeRoomCode,
} from '../src/net/protocol.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

// Housekeeping only. This interval reaps empty rooms; it is NOT a simulation
// tick and there is deliberately no such thing on this server (spec 7.1).
const REAP_INTERVAL_MS = 60 * 1000;

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(encode(msg));
}

function fail(ws, reason) {
  send(ws, { t: MSG.ERROR, reason });
}

export async function startServer(opts = {}) {
  const root = opts.root || REPO_ROOT;
  const rooms = opts.rooms || new Rooms();
  const log = opts.log || console;

  const http = createServer(async (req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      return;
    }
    // POST /room mints a code. A GET would let a link preview or a prefetch
    // create rooms nobody asked for.
    if (req.method === 'POST' && req.url === '/room') {
      const room = rooms.create({ now: Date.now() });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ room: room.code })
      );
      return;
    }
    try {
      if (await serveStatic(req, res, root)) return;
    } catch (err) {
      log.error('[static]', err);
      res.writeHead(500).end('server error');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  });

  const wss = new WebSocketServer({ server: http, path: '/ws' });

  wss.on('connection', (ws) => {
    // Per-socket state. `seat` is null until a valid hello arrives; nothing
    // else is accepted before then.
    let room = null;
    let seat = null;

    const peer = () => {
      if (!room || !seat) return null;
      for (const client of wss.clients) {
        if (client !== ws && client.__room === room && client.__side === OTHER_SIDE[seat.side]) {
          return client;
        }
      }
      return null;
    };

    const relay = (msg) => {
      const other = peer();
      if (other) send(other, msg);
    };

    ws.on('message', (data) => {
      const parsed = decode(typeof data === 'string' ? data : data.toString('utf8'));
      if (!parsed.ok) return fail(ws, parsed.reason);
      const msg = parsed.msg;

      if (msg.t === MSG.HELLO) {
        if (seat) return fail(ws, 'already joined');
        const code = normalizeRoomCode(msg.room);
        // getOrCreate, not get: a player who types a code their friend read
        // out should land in a room whether or not the friend arrived first.
        const target = rooms.getOrCreate(code, { now: Date.now() });
        if (!target) return fail(ws, 'bad room code');
        const res = target.join({ side: msg.side, token: msg.token }, Date.now());
        if (!res.ok) return fail(ws, res.reason);

        room = target;
        seat = res;
        ws.__room = room;
        ws.__side = res.side;
        ws.__token = res.token;

        const state = room.matchState();
        send(ws, {
          t: MSG.WELCOME,
          v: PROTOCOL_VERSION,
          room: room.code,
          side: res.side,
          token: res.token,
          reconnected: !!res.reconnected,
          seed: state.seed,
          damage: state.damage,
          peer: room.present(OTHER_SIDE[res.side]),
        });
        relay({ t: MSG.PEER, side: res.side, present: true });
        return;
      }

      if (!seat) return fail(ws, 'hello first');
      room.touch(Date.now());

      switch (msg.t) {
        case MSG.SNAP:
          // Never rejected, never inspected, never stored. Spec 7.1: you are
          // the truth about yourself, so this is a relay and nothing else.
          // The `side` on the wire is overwritten with the seat's own side so
          // a client cannot narrate the other player's position.
          relay({ ...msg, side: seat.side });
          return;

        case MSG.EV: {
          if (!room.mayEmit(seat.side, msg.type)) {
            // Refused, not relayed. Hit resolution follows ownership (7.3).
            log.warn(`[room ${room.code}] ${seat.side} tried to emit ${msg.type}`);
            return fail(ws, `not the owner of ${msg.type}`);
          }
          if (msg.type === 'detonate') {
            const rec = room.recordDetonate(seat.side, msg.d.island, msg.d.keys);
            if (!rec.ok) return fail(ws, rec.reason);
            // The server's added-key list is the fact (decision D2). It goes
            // to BOTH clients, including the one that proposed it, so every
            // client's set is written by exactly one code path.
            const dmg = { t: MSG.DAMAGE, island: msg.d.island, keys: rec.added, seq: msg.seq };
            send(ws, dmg);
            relay(dmg);
          } else {
            relay(msg);
          }
          // Acked once the server has done its part. The sender stops resending.
          send(ws, { t: MSG.ACK, seq: msg.seq });
          return;
        }

        case MSG.ACK:
          relay(msg);
          return;

        case MSG.HASH: {
          const bad = room.compareHashes(msg.h);
          for (const m of bad) {
            // Loudly, in real play — spec 8.4. This is the whole point of the
            // detector: it must be impossible to miss in a server log.
            log.error(
              `[DESYNC] room=${room.code} side=${seat.side} island=${m.island} ` +
                `server=${m.server} client=${m.client}`
            );
            send(ws, { t: MSG.DESYNC, island: m.island, server: m.server, client: m.client });
          }
          return;
        }

        default:
          return fail(ws, `server does not accept ${msg.t}`);
      }
    });

    ws.on('close', () => {
      if (!room || !seat) return;
      room.leave(seat.token, Date.now());
      relay({ t: MSG.PEER, side: seat.side, present: false });
    });

    ws.on('error', (err) => log.error('[ws]', err && err.message));
  });

  const reaper = setInterval(() => {
    for (const code of rooms.reap(Date.now())) log.info(`[room ${code}] reaped`);
  }, REAP_INTERVAL_MS);
  // Do not hold the process open for housekeeping.
  if (reaper.unref) reaper.unref();

  const port = opts.port != null ? opts.port : Number(process.env.PORT) || 8090;
  await new Promise((done) => http.listen(port, done));

  return {
    http,
    wss,
    rooms,
    port: http.address().port,
    async close() {
      clearInterval(reaper);
      for (const c of wss.clients) c.terminate();
      wss.close();
      await new Promise((done) => http.close(done));
    },
  };
}

// Started directly rather than imported: `npm run serve`, and the Docker image.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  startServer().then((s) => console.log(`wings-of-mario listening on :${s.port}`));
}
```

- [ ] **Step 4: Write the tier-2 test helper**

Create `tests/net/helpers.mjs`:

```js
import { WebSocket } from 'ws';
import { startServer } from '../../server/index.js';
import { MSG, PROTOCOL_VERSION, encode, decode } from '../../src/net/protocol.js';
import { Rooms } from '../../server/room.js';

// Port 0 lets the OS pick a free one, which is the only reliable way to run
// these in parallel — and it sidesteps 8123, 4322 and 8199 by construction.
export async function startTestServer(opts = {}) {
  const quiet = { info() {}, warn() {}, error() {} };
  const logs = [];
  const log = opts.captureLogs
    ? {
        info: (...a) => logs.push(['info', a.join(' ')]),
        warn: (...a) => logs.push(['warn', a.join(' ')]),
        error: (...a) => logs.push(['error', a.join(' ')]),
      }
    : quiet;
  const server = await startServer({
    port: 0,
    rooms: new Rooms(opts.codeGen ? { codeGen: opts.codeGen } : {}),
    log,
  });
  server.logs = logs;
  return server;
}

// A player, with no game in it: send a message, await the reply you want.
export class FakeClient {
  constructor(port) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.inbox = [];
    this.waiters = [];
    this.ws.on('message', (data) => {
      const parsed = decode(data.toString('utf8'));
      if (!parsed.ok) throw new Error(`client received illegal message: ${parsed.reason}`);
      this.inbox.push(parsed.msg);
      this.waiters = this.waiters.filter((w) => {
        if (!w.match(parsed.msg)) return true;
        w.resolve(parsed.msg);
        return false;
      });
    });
    this.open = new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
    });
  }

  send(msg) {
    this.ws.send(encode(msg));
    return this;
  }

  // Resolve on the first message matching `match`, past OR future — a reply
  // that arrived before the caller got round to waiting must still count, or
  // every test is a race.
  next(match, ms = 3000) {
    const found = this.inbox.find(match);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for a message after ${ms}ms`)),
        ms
      );
      this.waiters.push({
        match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  ofType(t, ms) {
    return this.next((m) => m.t === t, ms);
  }

  async hello(room, side, token) {
    await this.open;
    this.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, room, side, token });
    return this.next((m) => m.t === MSG.WELCOME || m.t === MSG.ERROR);
  }

  close() {
    return new Promise((res) => {
      if (this.ws.readyState === this.ws.CLOSED) return res();
      this.ws.on('close', res);
      this.ws.close();
    });
  }
}

export async function pair(port, room = 'ACDE') {
  const mario = new FakeClient(port);
  const pilot = new FakeClient(port);
  const a = await mario.hello(room, 'mario');
  const b = await pilot.hello(room, 'pilot');
  return { mario, pilot, marioWelcome: a, pilotWelcome: b };
}
```

- [ ] **Step 5: Write the tier-2 test**

Create `tests/net/room.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG, PROTOCOL_VERSION } from '../../src/net/protocol.js';
import { startTestServer, FakeClient, pair } from './helpers.mjs';

test('two clients, one room', { timeout: 30000 }, async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { port } = server;

  await t.test('the static files are served with module-safe MIME types', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/src/net/protocol.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    const html = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /text\/html/);
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(await health.text(), 'ok');
  });

  await t.test('a traversal out of the repo root is refused', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/../../../etc/passwd`);
    assert.ok(res.status === 403 || res.status === 404, `got ${res.status}`);
  });

  await t.test('POST /room mints a joinable code', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/room`, { method: 'POST' });
    const { room } = await res.json();
    const c = new FakeClient(port);
    const w = await c.hello(room, 'mario');
    assert.equal(w.t, MSG.WELCOME);
    assert.equal(w.room, room);
    await c.close();
  });

  await t.test('sides are assigned and the peer is announced', async () => {
    const { mario, pilot, marioWelcome, pilotWelcome } = await pair(port, 'FGHJ');
    assert.equal(marioWelcome.side, 'mario');
    assert.equal(marioWelcome.peer, false, 'mario arrived first');
    assert.equal(pilotWelcome.side, 'pilot');
    assert.equal(pilotWelcome.peer, true, 'pilot arrived second and should see mario');
    const announced = await mario.ofType(MSG.PEER);
    assert.equal(announced.side, 'pilot');
    assert.equal(announced.present, true);
    assert.equal(typeof marioWelcome.seed, 'number');
    assert.equal(marioWelcome.seed, pilotWelcome.seed, 'both sides must share the seed');
    await mario.close();
    await pilot.close();
  });

  await t.test('a third client is refused', async () => {
    const { mario, pilot } = await pair(port, 'KMNP');
    const third = new FakeClient(port);
    const res = await third.hello('KMNP', undefined);
    assert.equal(res.t, MSG.ERROR);
    assert.equal(res.reason, 'room full');
    await third.close();
    await mario.close();
    await pilot.close();
  });

  await t.test('snapshots relay verbatim and are never rejected', async () => {
    const { mario, pilot } = await pair(port, 'QRTU');
    mario.send({ t: MSG.SNAP, side: 'mario', tick: 42, s: { x: -99999, lives: 3, junk: 'ok' } });
    const got = await pilot.ofType(MSG.SNAP);
    assert.equal(got.tick, 42);
    assert.equal(got.s.x, -99999);
    assert.equal(got.s.junk, 'ok');
    await mario.close();
    await pilot.close();
  });

  await t.test('a client cannot narrate the other side', async () => {
    const { mario, pilot } = await pair(port, 'VWXY');
    mario.send({ t: MSG.SNAP, side: 'pilot', tick: 1, s: { x: 0 } });
    const got = await pilot.ofType(MSG.SNAP);
    assert.equal(got.side, 'mario', 'the server stamps the sender, not the claim');
    await mario.close();
    await pilot.close();
  });

  await t.test('a detonate from the pilot is recorded, broadcast and acked', async () => {
    const { mario, pilot } = await pair(port, 'ACDE');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['5,10', '6,10'] } });
    const toMario = await mario.ofType(MSG.DAMAGE);
    const toPilot = await pilot.ofType(MSG.DAMAGE);
    assert.deepEqual(toMario.keys.sort(), ['5,10', '6,10']);
    assert.deepEqual(toPilot.keys.sort(), ['5,10', '6,10'], 'the proposer is told too');
    assert.equal(toMario.island, '1-1');
    const ack = await pilot.ofType(MSG.ACK);
    assert.equal(ack.seq, 1);
    await mario.close();
    await pilot.close();
  });

  await t.test('a detonate from mario is refused and records nothing', async () => {
    const { mario, pilot } = await pair(port, 'WXY3');
    mario.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['9,9'] } });
    const err = await mario.ofType(MSG.ERROR);
    assert.equal(err.reason, 'not the owner of detonate');
    // And nothing reached the pilot.
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(pilot.inbox.some((m) => m.t === MSG.DAMAGE), false);
    await mario.close();
    await pilot.close();
  });

  await t.test('marioDeath goes the other way and pilot may not send it', async () => {
    const { mario, pilot } = await pair(port, 'Y346');
    mario.send({ t: MSG.EV, seq: 1, type: 'marioDeath', d: { island: '1-1', lives: 2 } });
    const got = await pilot.ofType(MSG.EV);
    assert.equal(got.type, 'marioDeath');
    assert.equal(got.d.lives, 2);

    pilot.send({ t: MSG.EV, seq: 1, type: 'marioDeath', d: { lives: 0 } });
    const err = await pilot.ofType(MSG.ERROR);
    assert.equal(err.reason, 'not the owner of marioDeath');
    await mario.close();
    await pilot.close();
  });

  await t.test('a reconnect returns to the same seat with the damage intact', async () => {
    const { mario, pilot, pilotWelcome } = await pair(port, 'CDEF');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['1,1', '2,1'] } });
    await mario.ofType(MSG.DAMAGE);
    await pilot.close();

    const again = new FakeClient(port);
    const back = await again.hello('CDEF', undefined, pilotWelcome.token);
    assert.equal(back.t, MSG.WELCOME);
    assert.equal(back.side, 'pilot');
    assert.equal(back.reconnected, true);
    assert.deepEqual(back.damage['1-1'], ['1,1', '2,1'], 'the match survived the disconnect');
    assert.equal(back.seed, pilotWelcome.seed, 'and so did the seed');
    await again.close();
    await mario.close();
  });

  await t.test('the peer is told when somebody drops', async () => {
    const { mario, pilot } = await pair(port, 'EFGH');
    await pilot.close();
    const gone = await mario.next((m) => m.t === MSG.PEER && m.present === false);
    assert.equal(gone.side, 'pilot');
    await mario.close();
  });

  await t.test('a malformed frame gets a reason, not a dropped connection', async () => {
    const c = new FakeClient(port);
    await c.open;
    c.ws.send('{not json');
    const err = await c.ofType(MSG.ERROR);
    assert.equal(err.reason, 'bad json');
    // The socket is still usable.
    const w = await c.hello('HJKM', 'mario');
    assert.equal(w.t, MSG.WELCOME);
    await c.close();
  });

  await t.test('anything before hello is refused', async () => {
    const c = new FakeClient(port);
    await c.open;
    c.send({ t: MSG.SNAP, side: 'mario', tick: 1, s: {} });
    const err = await c.ofType(MSG.ERROR);
    assert.equal(err.reason, 'hello first');
    await c.close();
  });

  await t.test('a version mismatch is refused with a legible reason', async () => {
    const c = new FakeClient(port);
    await c.open;
    c.ws.send(JSON.stringify({ t: MSG.HELLO, v: PROTOCOL_VERSION + 1, room: 'MNPQ' }));
    const err = await c.ofType(MSG.ERROR);
    assert.match(err.reason, /protocol version/);
    await c.close();
  });
});
```

- [ ] **Step 6: Run the tier-2 suite**

Run: `npm run test:net`
Expected: PASS, 14 subtests.

- [ ] **Step 7: Serve the real game and check it boots**

Run in one terminal: `npm run serve`
Expected: `wings-of-mario listening on :8090`

Then in another:

```bash
node -e "import('playwright').then(async ({chromium}) => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8090/');
  await p.waitForFunction(() => window.__GAME && window.__GAME.ready, null, {timeout: 20000});
  await p.goto('http://localhost:8090/pilot.html');
  await p.waitForFunction(() => window.__WINGS && window.__WINGS.ready, null, {timeout: 20000});
  console.log('both pages boot, errors:', errs); await b.close();
})"
```

Expected: `both pages boot, errors: []`. This is the moment the Node server replaces `http-server` for real use; if a module fails to load here it is the MIME map in `server/static.js`.

- [ ] **Step 8: Commit**

```bash
git add server/static.js server/index.js tests/net/helpers.mjs tests/net/room.test.mjs package.json package-lock.json
git commit -m "A Node server: static files, WebSocket rooms, and no game simulation

One dependency, ws, for RFC 6455 framing. Everything that decides anything
lives in server/room.js and is tested without a socket."
```

---

## Task 4: Transport and session

The client half of the protocol, still with no game attached: a socket wrapper that can be made to lag and lose packets on demand, and a session that guarantees reliable events arrive exactly once.

**Files:**
- Create: `src/net/transport.js`
- Create: `src/net/session.js`
- Create: `tests/unit/session.test.js`
- Create: `tests/net/session.test.mjs`

**Interfaces:**
- Consumes: everything from `src/net/protocol.js`; `hashKeys` is *not* used here (Task 8 owns hashing).
- Produces:
  - `class Transport` — `constructor(url, opts)` where `opts.WebSocketImpl` defaults to the global `WebSocket` and `opts.seed` seeds the loss RNG.
    - `connect() -> Promise<void>`, `send(text)`, `close()`
    - `onMessage(cb)`, `onOpen(cb)`, `onClose(cb)`
    - `latency(ms)`, `drop(pct)`, `disconnect()`, `reconnect()`
    - `stats() -> {sent, received, dropped, delayed}`
  - `class Session` — `constructor({transport, room, side, token})`
    - `connect() -> Promise<welcome>`
    - `sendSnapshot(tick, body)` — rate-limited internally to `SNAPSHOT_INTERVAL_TICKS`
    - `sendEvent(type, data) -> number` — returns the seq; queued until acked
    - `sendHash(tick, hashes)`
    - `pump(tick)` — call once per simulation tick: drives resends
    - `on(type, cb)` / `off(type, cb)` for `'snapshot'`, `'event'`, `'damage'`, `'peer'`, `'desync'`, `'error'`
    - `pending() -> number`, `acked` (a `Set` of received seqs), `stats()`

- [ ] **Step 1: Write the tier-1 session test**

The session's whole job is bookkeeping, so it is tested against a stub transport with no socket anywhere. Create `tests/unit/session.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../../src/net/session.js';
import {
  MSG, PROTOCOL_VERSION, encode, decode,
  SNAPSHOT_INTERVAL_TICKS, RESEND_INTERVAL_TICKS,
} from '../../src/net/protocol.js';

// A transport that goes nowhere: everything sent lands in an array, and
// `deliver` pushes a message back up as if the server had sent it.
class StubTransport {
  constructor() {
    this.sent = [];
    this._msg = null;
    this._open = null;
  }
  onMessage(cb) { this._msg = cb; }
  onOpen(cb) { this._open = cb; }
  onClose() {}
  async connect() { if (this._open) this._open(); }
  send(text) { this.sent.push(decode(text).msg); }
  close() {}
  deliver(msg) { this._msg(encode(msg)); }
  lastOf(t) { return [...this.sent].reverse().find((m) => m.t === t) || null; }
  countOf(t) { return this.sent.filter((m) => m.t === t).length; }
}

function makeSession(over = {}) {
  const transport = new StubTransport();
  const s = new Session({ transport, room: 'ACDE', side: 'pilot', ...over });
  return { s, transport };
}

test('connect sends hello and resolves on welcome', async () => {
  const { s, transport } = makeSession();
  const p = s.connect();
  const hello = transport.lastOf(MSG.HELLO);
  assert.equal(hello.room, 'ACDE');
  assert.equal(hello.side, 'pilot');
  assert.equal(hello.v, PROTOCOL_VERSION);
  transport.deliver({
    t: MSG.WELCOME, v: PROTOCOL_VERSION, room: 'ACDE', side: 'pilot',
    token: 'tok', seed: 99, damage: { '1-1': ['5,10'] }, peer: false,
  });
  const w = await p;
  assert.equal(w.seed, 99);
  assert.equal(s.token, 'tok', 'the token is kept for reconnecting');
  assert.equal(s.side, 'pilot');
});

test('connect rejects on error', async () => {
  const { s, transport } = makeSession();
  const p = s.connect();
  transport.deliver({ t: MSG.ERROR, reason: 'room full' });
  await assert.rejects(p, /room full/);
});

test('a reconnect sends the token it was given', async () => {
  const { s, transport } = makeSession({ token: 'old-token' });
  s.connect();
  assert.equal(transport.lastOf(MSG.HELLO).token, 'old-token');
});

async function connected(over) {
  const { s, transport } = makeSession(over);
  const p = s.connect();
  transport.deliver({
    t: MSG.WELCOME, v: PROTOCOL_VERSION, room: 'ACDE', side: 'pilot',
    token: 'tok', seed: 1, damage: {}, peer: true,
  });
  await p;
  transport.sent.length = 0;
  return { s, transport };
}

test('snapshots go out at 20Hz, not 60', async () => {
  const { s, transport } = await connected();
  for (let tick = 0; tick < 30; tick++) s.sendSnapshot(tick, { x: tick });
  assert.equal(transport.countOf(MSG.SNAP), 30 / SNAPSHOT_INTERVAL_TICKS);
  const last = transport.lastOf(MSG.SNAP);
  assert.equal(last.tick, 27);
  assert.equal(last.s.x, 27, 'the snapshot must carry the CURRENT state, not a stale one');
});

test('events get consecutive sequence numbers starting at 1', async () => {
  const { s, transport } = await connected();
  assert.equal(s.sendEvent('detonate', { island: '1-1', keys: [] }), 1);
  assert.equal(s.sendEvent('landed', {}), 2);
  assert.deepEqual(transport.sent.filter((m) => m.t === MSG.EV).map((m) => m.seq), [1, 2]);
});

test('an unacked event is resent, and an acked one is not', async () => {
  const { s, transport } = await connected();
  s.sendEvent('landed', {});
  assert.equal(s.pending(), 1);
  for (let t = 1; t <= RESEND_INTERVAL_TICKS; t++) s.pump(t);
  assert.equal(transport.countOf(MSG.EV), 2, 'should have gone out once more');

  transport.deliver({ t: MSG.ACK, seq: 1 });
  assert.equal(s.pending(), 0);
  for (let t = 1; t <= RESEND_INTERVAL_TICKS * 3; t++) s.pump(t);
  assert.equal(transport.countOf(MSG.EV), 2, 'an acked event must never go out again');
});

test('a resent event keeps its sequence number', async () => {
  const { s, transport } = await connected();
  s.sendEvent('planeLost', { reason: 'sea' });
  for (let t = 1; t <= RESEND_INTERVAL_TICKS * 2; t++) s.pump(t);
  const seqs = new Set(transport.sent.filter((m) => m.t === MSG.EV).map((m) => m.seq));
  assert.deepEqual([...seqs], [1], 'a resend is the same event, not a new one');
});

test('a duplicated inbound event is delivered exactly once', async () => {
  const { s, transport } = await connected();
  const seen = [];
  s.on('event', (e) => seen.push(e));
  const ev = { t: MSG.EV, seq: 7, type: 'marioDeath', d: { lives: 2 } };
  transport.deliver(ev);
  transport.deliver(ev);
  transport.deliver(ev);
  assert.equal(seen.length, 1, 'the peer resent it; we must not act on it three times');
  assert.equal(seen[0].type, 'marioDeath');
});

test('out-of-order inbound events are all delivered', async () => {
  // Reliability is exactly-once, NOT in-order: the events are independent and
  // holding event 3 hostage to event 2 would stall the match on one lost frame.
  const { s, transport } = await connected();
  const seen = [];
  s.on('event', (e) => seen.push(e.type));
  transport.deliver({ t: MSG.EV, seq: 3, type: 'landed', d: {} });
  transport.deliver({ t: MSG.EV, seq: 2, type: 'sortieStart', d: {} });
  assert.deepEqual(seen, ['landed', 'sortieStart']);
});

test('damage, peer and desync are routed to their own listeners', async () => {
  const { s, transport } = await connected();
  const got = { damage: [], peer: [], desync: [] };
  s.on('damage', (m) => got.damage.push(m));
  s.on('peer', (m) => got.peer.push(m));
  s.on('desync', (m) => got.desync.push(m));
  transport.deliver({ t: MSG.DAMAGE, island: '1-1', keys: ['5,10'] });
  transport.deliver({ t: MSG.PEER, side: 'mario', present: true });
  transport.deliver({ t: MSG.DESYNC, island: '1-1', server: 'aaaa', client: 'bbbb' });
  assert.deepEqual(got.damage[0].keys, ['5,10']);
  assert.equal(got.peer[0].present, true);
  assert.equal(got.desync[0].island, '1-1');
});

test('an inbound snapshot reaches the snapshot listener untouched', async () => {
  const { s, transport } = await connected();
  const seen = [];
  s.on('snapshot', (m) => seen.push(m));
  transport.deliver({ t: MSG.SNAP, side: 'mario', tick: 9, s: { x: 5, anim: 'run' } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tick, 9);
  assert.equal(seen[0].s.anim, 'run');
});

test('sending before connect throws rather than silently dropping', async () => {
  const { s } = makeSession();
  assert.throws(() => s.sendEvent('landed', {}), /not connected/);
});

test('an unknown event type throws at the SENDER', async () => {
  // Catching a typo here is worth an exception; catching it on the server
  // means the round trip already happened and the event is simply gone.
  const { s } = await connected();
  assert.throws(() => s.sendEvent('explode', {}), /unknown event type/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '.../src/net/session.js'`

- [ ] **Step 3: Write the transport**

Create `src/net/transport.js`:

```js
// A WebSocket with a fault injector strapped to it (spec 8.2:
// `net: { latency(ms), drop(pct), disconnect() }`). Everything here is
// transport, never simulation, which is why it is allowed the two things
// simulation is not: a wall-clock timer and a random number generator.

// The RNG is nonetheless SEEDED, and deliberately not the engine's: sharing
// Mario's rng would make packet loss consume draws from the stream gameplay
// depends on, so injecting loss would silently change the match — the exact
// coupling the determinism rule exists to prevent. Mulberry32, six lines,
// no import.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Transport {
  constructor(url, opts = {}) {
    this.url = url;
    this.WS = opts.WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    if (!this.WS) throw new Error('transport: no WebSocket implementation available');
    this.ws = null;
    this._msg = () => {};
    this._open = () => {};
    this._close = () => {};

    // Fault injection, all off by default.
    this._latencyMs = 0;
    this._dropPct = 0;
    this._severed = false;
    this._rand = mulberry32(opts.seed != null ? opts.seed : 0x5eed);
    this._timers = new Set();

    this._stats = { sent: 0, received: 0, dropped: 0, delayed: 0 };
  }

  onMessage(cb) { this._msg = cb; }
  onOpen(cb) { this._open = cb; }
  onClose(cb) { this._close = cb; }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new this.WS(this.url);
      this.ws.onopen = () => {
        this._open();
        resolve();
      };
      this.ws.onerror = (e) => reject(new Error(`transport: connect failed (${this.url})`));
      this.ws.onclose = () => this._close();
      this.ws.onmessage = (e) => this._receive(typeof e.data === 'string' ? e.data : String(e.data));
    });
  }

  _receive(text) {
    if (this._severed) return;
    if (this._dropPct > 0 && this._rand() * 100 < this._dropPct) {
      this._stats.dropped++;
      return;
    }
    this._stats.received++;
    if (this._latencyMs > 0) this._later(() => this._msg(text));
    else this._msg(text);
  }

  send(text) {
    if (this._severed) return false;
    if (!this.ws || this.ws.readyState !== 1) return false;
    if (this._dropPct > 0 && this._rand() * 100 < this._dropPct) {
      this._stats.dropped++;
      // Deliberately reported as sent: the application believes it went, which
      // is what makes the reliable layer's resend the thing under test.
      return true;
    }
    this._stats.sent++;
    if (this._latencyMs > 0) this._later(() => this.ws.readyState === 1 && this.ws.send(text));
    else this.ws.send(text);
    return true;
  }

  // The one wall-clock timer in the client. Named, so a grep for setTimeout in
  // src/ has exactly one hit to explain.
  _later(fn) {
    this._stats.delayed++;
    const id = setTimeout(() => {
      this._timers.delete(id);
      fn();
    }, this._latencyMs);
    this._timers.add(id);
  }

  latency(ms) {
    this._latencyMs = Math.max(0, ms | 0);
    return this._latencyMs;
  }

  drop(pct) {
    this._dropPct = Math.max(0, Math.min(100, Number(pct) || 0));
    return this._dropPct;
  }

  // Sever the wire without closing the socket: the peer sees nothing at all,
  // which is what a train tunnel looks like. reconnect() puts it back.
  disconnect() {
    this._severed = true;
    return true;
  }

  reconnect() {
    this._severed = false;
    return true;
  }

  stats() {
    return { ...this._stats };
  }

  close() {
    for (const id of this._timers) clearTimeout(id);
    this._timers.clear();
    if (this.ws) this.ws.close();
  }
}

export default Transport;
```

- [ ] **Step 4: Write the session**

Create `src/net/session.js`:

```js
import {
  MSG, PROTOCOL_VERSION, RELIABLE_TYPES,
  SNAPSHOT_INTERVAL_TICKS, RESEND_INTERVAL_TICKS,
  encode, decode,
} from './protocol.js';

// One player's connection to a room. Knows nothing about aeroplanes, tiles or
// Mario: it moves messages and guarantees the reliable ones arrive exactly
// once. Both sides run this identical file.
export class Session {
  constructor({ transport, room, side, token } = {}) {
    if (!transport) throw new Error('session: a transport is required');
    this.transport = transport;
    this.room = room;
    this.side = side || null;
    this.token = token || null;
    this.seed = null;
    this.connected = false;
    this.peerPresent = false;

    this._seq = 0;
    // seq -> { msg, lastSentTick }
    this._outbox = new Map();
    // Every inbound event seq we have already acted on. The peer resends until
    // its ack arrives, so the same event arrives several times routinely — and
    // acting on `detonate` twice would be a double crater.
    this.seen = new Set();
    this._listeners = new Map();
    this._lastSnapTick = -Infinity;

    this.transport.onMessage((text) => this._onMessage(text));
    this.transport.onClose(() => {
      this.connected = false;
      this._emit('close', {});
    });
  }

  // ---- listeners -----------------------------------------------------------

  on(type, cb) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(cb);
    return this;
  }

  off(type, cb) {
    const set = this._listeners.get(type);
    if (set) set.delete(cb);
    return this;
  }

  _emit(type, payload) {
    const set = this._listeners.get(type);
    if (!set) return;
    for (const cb of set) cb(payload);
  }

  // ---- connecting ----------------------------------------------------------

  async connect() {
    await this.transport.connect();
    return new Promise((resolve, reject) => {
      this._welcome = { resolve, reject };
      this._send({
        t: MSG.HELLO,
        v: PROTOCOL_VERSION,
        room: this.room,
        side: this.side || undefined,
        token: this.token || undefined,
      });
    });
  }

  // ---- sending -------------------------------------------------------------

  _send(msg) {
    this.transport.send(encode(msg));
  }

  // Unreliable and rate-limited: a snapshot that is late is worthless, so a
  // dropped one is simply never mentioned again. `body` is built fresh by the
  // caller each tick, so what goes out is always current state.
  sendSnapshot(tick, body) {
    this._requireConnected();
    if (tick - this._lastSnapTick < SNAPSHOT_INTERVAL_TICKS) return false;
    this._lastSnapTick = tick;
    this._send({ t: MSG.SNAP, side: this.side, tick, s: body });
    return true;
  }

  // Reliable: kept in the outbox and resent on a timer until acked.
  sendEvent(type, data = {}) {
    this._requireConnected();
    if (!RELIABLE_TYPES.has(type)) throw new Error(`session: unknown event type "${type}"`);
    const seq = ++this._seq;
    const msg = { t: MSG.EV, seq, type, d: data };
    this._outbox.set(seq, { msg, lastSentTick: 0 });
    this._send(msg);
    return seq;
  }

  sendHash(tick, hashes) {
    this._requireConnected();
    this._send({ t: MSG.HASH, tick, h: hashes });
    return true;
  }

  // Call once per simulation tick. The only thing it does is resend: it is
  // driven by the TICK COUNTER, not a clock, so a paused or stepped client
  // behaves exactly like a running one.
  pump(tick) {
    if (!this.connected) return 0;
    let resent = 0;
    for (const entry of this._outbox.values()) {
      if (tick - entry.lastSentTick < RESEND_INTERVAL_TICKS) continue;
      entry.lastSentTick = tick;
      this._send(entry.msg);
      resent++;
    }
    return resent;
  }

  _requireConnected() {
    if (!this.connected) throw new Error('session: not connected');
  }

  // ---- receiving -----------------------------------------------------------

  _onMessage(text) {
    const parsed = decode(text);
    if (!parsed.ok) {
      this._emit('error', { reason: `undecodable message: ${parsed.reason}` });
      return;
    }
    const msg = parsed.msg;

    switch (msg.t) {
      case MSG.WELCOME:
        this.connected = true;
        this.side = msg.side;
        this.token = msg.token;
        this.room = msg.room;
        this.seed = msg.seed;
        this.peerPresent = !!msg.peer;
        this._emit('welcome', msg);
        if (this._welcome) {
          this._welcome.resolve(msg);
          this._welcome = null;
        }
        return;

      case MSG.ERROR:
        this._emit('error', msg);
        if (this._welcome) {
          this._welcome.reject(new Error(msg.reason));
          this._welcome = null;
        }
        return;

      case MSG.PEER:
        this.peerPresent = msg.present;
        this._emit('peer', msg);
        return;

      case MSG.SNAP:
        this._emit('snapshot', msg);
        return;

      case MSG.EV:
        // Ack first, unconditionally: the peer resends because it did not
        // hear us, and an event we have already acted on still needs its ack
        // or it will be resent forever.
        this._send({ t: MSG.ACK, seq: msg.seq });
        if (this.seen.has(msg.seq)) return;
        this.seen.add(msg.seq);
        this._emit('event', msg);
        return;

      case MSG.ACK:
        this._outbox.delete(msg.seq);
        return;

      case MSG.DAMAGE:
        // Authoritative (decision D2). Whoever proposed it, this is the fact.
        this._emit('damage', msg);
        return;

      case MSG.DESYNC:
        this._emit('desync', msg);
        return;

      default:
        return;
    }
  }

  pending() {
    return this._outbox.size;
  }

  stats() {
    return {
      side: this.side,
      room: this.room,
      connected: this.connected,
      peer: this.peerPresent,
      pending: this._outbox.size,
      seen: this.seen.size,
      transport: this.transport.stats ? this.transport.stats() : null,
    };
  }

  close() {
    this.connected = false;
    this.transport.close();
  }
}

export default Session;
```

- [ ] **Step 5: Run the tier-1 test**

Run: `npm run test:unit`
Expected: PASS, 13 new tests.

- [ ] **Step 6: Write the tier-2 test — two real sessions over a real server, under loss**

Create `tests/net/session.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { Session } from '../../src/net/session.js';
import { Transport } from '../../src/net/transport.js';
import { startTestServer } from './helpers.mjs';

// `ws`'s WebSocket is API-compatible with the browser's for everything
// Transport touches (onopen/onmessage/onclose/send/readyState/close), which is
// the whole reason Transport takes the implementation as an option.
function makeSession(port, room, side, opts = {}) {
  const transport = new Transport(`ws://127.0.0.1:${port}/ws`, {
    WebSocketImpl: WebSocket,
    seed: opts.seed,
  });
  return { session: new Session({ transport, room, side }), transport };
}

// Drive both sessions' pump() until `check()` is true or the budget runs out.
// This is the tick loop with no game in it.
async function spin(sessions, check, ticks = 900) {
  for (let t = 1; t <= ticks; t++) {
    for (const s of sessions) s.pump(t);
    await new Promise((r) => setTimeout(r, 2));
    if (check()) return t;
  }
  return -1;
}

test('sessions over a real socket', { timeout: 60000 }, async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { port } = server;

  await t.test('two sessions join and exchange an event', async () => {
    const a = makeSession(port, 'ACDE', 'mario');
    const b = makeSession(port, 'ACDE', 'pilot');
    await a.session.connect();
    await b.session.connect();

    const seen = [];
    a.session.on('event', (e) => seen.push(e));
    b.session.sendEvent('planeLost', { reason: 'sea' });

    const at = await spin([a.session, b.session], () => seen.length > 0);
    assert.ok(at > 0, 'the event never arrived');
    assert.equal(seen[0].type, 'planeLost');
    assert.equal(seen[0].d.reason, 'sea');
    assert.equal(b.session.pending(), 0, 'it should have been acked');
    a.session.close();
    b.session.close();
  });

  await t.test('a reliable event survives 50% packet loss', async () => {
    // Half of everything, in both directions, on both sockets. If the resend
    // logic is wrong this hangs; if it is right this costs a few resends.
    const a = makeSession(port, 'FGHJ', 'mario', { seed: 11 });
    const b = makeSession(port, 'FGHJ', 'pilot', { seed: 22 });
    await a.session.connect();
    await b.session.connect();
    a.transport.drop(50);
    b.transport.drop(50);

    const seen = [];
    a.session.on('event', (e) => seen.push(e.type));
    b.session.sendEvent('detonate', { island: '1-1', keys: ['5,10'] });

    const at = await spin([a.session, b.session], () => seen.length > 0 && b.session.pending() === 0);
    assert.ok(at > 0, `never delivered and acked; transport=${JSON.stringify(b.transport.stats())}`);
    assert.deepEqual(seen, ['detonate'], 'delivered exactly once despite the resends');
    a.session.close();
    b.session.close();
  });

  await t.test('injected latency delays but does not lose', async () => {
    const a = makeSession(port, 'KMNP', 'mario');
    const b = makeSession(port, 'KMNP', 'pilot');
    await a.session.connect();
    await b.session.connect();
    a.transport.latency(150);
    b.transport.latency(150);

    const seen = [];
    a.session.on('event', (e) => seen.push(e.type));
    b.session.sendEvent('landed', {});
    const at = await spin([a.session, b.session], () => seen.length > 0);
    assert.ok(at > 0);
    assert.deepEqual(seen, ['landed']);
    a.session.close();
    b.session.close();
  });

  await t.test('disconnect stops everything and reconnect resumes the same seat', async () => {
    const a = makeSession(port, 'QRTU', 'mario');
    const b = makeSession(port, 'QRTU', 'pilot');
    const welcome = await a.session.connect();
    await b.session.connect();

    a.transport.disconnect();
    const seen = [];
    a.session.on('event', (e) => seen.push(e.type));
    b.session.sendEvent('landed', {});
    await spin([b.session], () => false, 40);
    assert.deepEqual(seen, [], 'a severed wire must deliver nothing');

    a.transport.reconnect();
    const at = await spin([a.session, b.session], () => seen.length > 0);
    assert.ok(at > 0, 'the resend should reach a reconnected client');
    assert.deepEqual(seen, ['landed']);
    assert.equal(a.session.token, welcome.token);
    a.session.close();
    b.session.close();
  });

  await t.test('the server refuses an event the session should not have sent', async () => {
    const a = makeSession(port, 'VWXY', 'mario');
    await a.session.connect();
    const errors = [];
    a.session.on('error', (e) => errors.push(e.reason));
    // Bypass sendEvent's own guard to prove the server is the backstop.
    a.transport.send(JSON.stringify({ t: 'ev', seq: 1, type: 'detonate', d: { island: '1-1', keys: [] } }));
    await spin([a.session], () => errors.length > 0, 200);
    assert.match(errors[0], /not the owner of detonate/);
    a.session.close();
  });
});
```

- [ ] **Step 7: Run it**

Run: `npm run test:net`
Expected: PASS, 14 subtests from Task 3 plus 5 here.

- [ ] **Step 8: Verify the one wall-clock timer is the only one**

Run: `grep -rn "setTimeout\|setInterval\|Date.now\|performance.now" src/net/`
Expected: exactly two hits, both in `src/net/transport.js` — `_later`'s `setTimeout` and its `clearTimeout`. Anything in `session.js` is a determinism bug: the session is driven by `pump(tick)` precisely so it is not.

- [ ] **Step 9: Commit**

```bash
git add src/net/transport.js src/net/session.js tests/unit/session.test.js tests/net/session.test.mjs
git commit -m "Client transport and session: reliable events, acks, and fault injection

Reliability is exactly-once, not in-order — the events are independent and
holding one hostage to another would stall a match on a single lost frame."
```

---

## Task 5: Two browsers, one room, watching each other move

**The milestone.** At the end of this task you open `http://localhost:8090/?room=ACDE` in one window and `http://localhost:8090/pilot.html?room=ACDE` in another, and each sees the other move in real time in the correct place in a shared coordinate space. No damage sync yet, no match events — just presence, and it is playable enough to be worth showing somebody.

**Files:**
- Create: `src/net/interp.js`
- Create: `src/net/lobby.js`
- Create: `src/net/mario-overlay.js`
- Create: `src/net/mario-side.js`
- Create: `src/net/pilot-side.js`
- Create: `src/wings/art/contact.js`
- Create: `tests/unit/interp.test.js`
- Create: `tests/browser/netplay.test.mjs`
- Modify: `index.html` (one line — **engine hook point**), `pilot.html` (one line — ours)
- Modify: `src/wings/scene.js` (ours — one draw call and one field)
- Modify: `tests/browser/helpers.mjs` (add `bootRoom`)

**The coordinate contract, which is the whole of this task.** Mario's engine works in level-local pixels: `(0,0)` is the top-left of the level. The pilot works in archipelago world pixels. `src/wings/geo.js` already converts between them and is importable from both pages because it imports only `src/core/constants.js`:

```
world.x = island.originX + mario.x
world.y = ISLAND_TOP_Y   + mario.y
```

Both sides compute `originX` with the same `layoutIslands(ids.map(getLevel))` call over the same island id list, so neither has to be told where the islands are.

**Interfaces:**
- Produces:
  - `interp.js` — `class Interp` with `push(tick, state)`, `sample(localTick) -> state|null`, `latest()`, `size`, `clear()`; `lerp(a, b, t)`, `lerpState(a, b, t, opts)`.
  - `lobby.js` — `roomFromLocation(search) -> {room, side, auto}`, `async ensureRoom(base, wanted)`, `wsUrl(base)`.
  - `mario-overlay.js` — `class MarioOverlay` with `attach()`, `set(remote)`, `draw()`, `detach()`.
  - `mario-side.js` — `window.__NET` on `index.html`.
  - `pilot-side.js` — `window.__WINGS.net`.
  - `contact.js` — `MARIO_CONTACT`, `CONTACT_PAL`.

- [ ] **Step 1: Write the interpolation test**

Create `tests/unit/interp.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Interp, lerp, lerpState } from '../../src/net/interp.js';
import { INTERP_DELAY_TICKS } from '../../src/net/protocol.js';

test('lerp is the boring one', () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(0, 10, 0.25), 2.5);
  assert.equal(lerp(-10, 10, 0.5), 0);
});

test('lerpState interpolates numbers and snaps everything else', () => {
  const a = { x: 0, y: 0, facing: 1, anim: 'idle', island: '1-1' };
  const b = { x: 10, y: 20, facing: -1, anim: 'run', island: '1-2' };
  const mid = lerpState(a, b, 0.5);
  assert.equal(mid.x, 5);
  assert.equal(mid.y, 10);
  // A half-run animation or a half-island is nonsense; discrete fields take
  // the newer value outright.
  assert.equal(mid.anim, 'run');
  assert.equal(mid.island, '1-2');
  assert.equal(mid.facing, -1);
});

test('lerpState never interpolates a field named in `snap`', () => {
  const mid = lerpState({ x: 0, hp: 3 }, { x: 10, hp: 1 }, 0.5, { snap: ['hp'] });
  assert.equal(mid.x, 5);
  assert.equal(mid.hp, 1);
});

test('an empty buffer samples to nothing rather than to the origin', () => {
  // Returning {x:0,y:0} would draw the peer at the top-left corner of the
  // world for the first fifth of a second of every match.
  const i = new Interp();
  assert.equal(i.sample(100), null);
  assert.equal(i.latest(), null);
  assert.equal(i.size, 0);
});

test('samples are taken one interpolation delay behind the newest', () => {
  const i = new Interp();
  i.push(0, { x: 0 });
  i.push(3, { x: 30 });
  i.push(6, { x: 60 });
  // Local tick 6 renders what the peer looked like at tick 6 - 6 = 0.
  assert.equal(i.sample(6).x, 0);
  assert.equal(i.sample(9).x, 30);
  // Halfway between the tick-0 and tick-3 samples.
  assert.equal(i.sample(7.5).x, 15);
});

test('the delay is the constant, not a magic number', () => {
  const i = new Interp();
  i.push(0, { x: 0 });
  i.push(60, { x: 600 });
  assert.equal(i.sample(INTERP_DELAY_TICKS).x, 0);
});

test('sampling before the oldest sample holds the oldest', () => {
  const i = new Interp();
  i.push(100, { x: 5 });
  assert.equal(i.sample(0).x, 5, 'must not extrapolate backwards into nothing');
});

test('sampling past the newest holds the newest rather than flying off', () => {
  // Extrapolation looks like a teleport-and-snap-back when the next packet
  // lands. Holding still is honest: the peer has genuinely told us nothing.
  const i = new Interp();
  i.push(0, { x: 0 });
  i.push(3, { x: 30 });
  assert.equal(i.sample(1000).x, 30);
});

test('an out-of-order snapshot is inserted, not appended', () => {
  const i = new Interp();
  i.push(0, { x: 0 });
  i.push(6, { x: 60 });
  i.push(3, { x: 30 });
  assert.equal(i.sample(9).x, 30, 'the late packet must take its proper place in time');
});

test('a duplicated tick replaces rather than doubling', () => {
  const i = new Interp();
  i.push(3, { x: 30 });
  i.push(3, { x: 33 });
  assert.equal(i.size, 1);
  assert.equal(i.latest().x, 33);
});

test('the buffer is bounded', () => {
  const i = new Interp({ capacity: 8 });
  for (let t = 0; t < 200; t++) i.push(t, { x: t });
  assert.ok(i.size <= 8, `buffer grew to ${i.size}`);
  assert.equal(i.latest().x, 199, 'the newest must always survive');
});

test('a peer that reconnects with a reset tick counter does not freeze', () => {
  // The peer reloaded: its tick went backwards by thousands. Without a reset
  // the buffer would hold samples from the future forever and the avatar would
  // never move again.
  const i = new Interp();
  for (let t = 0; t < 60; t += 3) i.push(1000 + t, { x: t });
  i.push(0, { x: 999 });
  assert.equal(i.size, 1, 'a backwards jump clears the buffer');
  assert.equal(i.latest().x, 999);
});
```

- [ ] **Step 2: Run it and watch it fail, then write it**

Run: `npm run test:unit` — Expected: FAIL, `Cannot find module '.../src/net/interp.js'`.

Create `src/net/interp.js`:

```js
import { INTERP_DELAY_TICKS } from './protocol.js';

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Numbers are interpolated; everything else takes the NEWER value. A half-way
// animation name or a half-way island id is not a thing, and guessing one is
// worse than being one snapshot stale.
export function lerpState(a, b, t, opts = {}) {
  const snap = new Set(opts.snap || []);
  const out = {};
  for (const key of Object.keys(b)) {
    const av = a[key];
    const bv = b[key];
    if (!snap.has(key) && typeof av === 'number' && typeof bv === 'number') {
      out[key] = lerp(av, bv, t);
    } else {
      out[key] = bv;
    }
  }
  return out;
}

// A small ring of the peer's recent snapshots, sampled one interpolation delay
// behind the newest one. Two snapshot intervals of delay means a single lost
// packet still has a successor to interpolate toward, which is the difference
// between a peer that glides and a peer that stutters on every 20th frame.
//
// Everything here is measured in TICKS, never milliseconds: the peer's tick
// counter arrives in the snapshot, and the local one comes from the caller, so
// interpolation stays as deterministic as the simulation it is showing.
export class Interp {
  constructor(opts = {}) {
    this.capacity = opts.capacity || 32;
    this.delay = opts.delay != null ? opts.delay : INTERP_DELAY_TICKS;
    this.snapFields = opts.snap || [];
    this.buf = []; // ascending by tick
  }

  get size() {
    return this.buf.length;
  }

  clear() {
    this.buf.length = 0;
  }

  push(tick, state) {
    const newest = this.buf.length ? this.buf[this.buf.length - 1].tick : -Infinity;
    // A peer that reloaded starts counting from zero again. Keeping the old
    // samples would leave the avatar interpolating toward a tick that will not
    // arrive for another few minutes, i.e. frozen.
    if (tick < newest - this.capacity * 8) this.clear();

    let at = this.buf.length;
    while (at > 0 && this.buf[at - 1].tick > tick) at--;
    if (at > 0 && this.buf[at - 1].tick === tick) this.buf[at - 1].state = state;
    else this.buf.splice(at, 0, { tick, state });

    while (this.buf.length > this.capacity) this.buf.shift();
  }

  latest() {
    return this.buf.length ? this.buf[this.buf.length - 1].state : null;
  }

  // `localTick` is this client's own tick counter. The peer's snapshots carry
  // its counter; the two are not synchronised and do not need to be, because
  // what matters is only the SHAPE of the peer's motion, replayed a fixed
  // distance behind whatever it has told us so far.
  sample(localTick) {
    if (!this.buf.length) return null;
    const newest = this.buf[this.buf.length - 1].tick;
    const oldest = this.buf[0].tick;
    // Anchor to the newest received tick rather than to the local clock: the
    // two clients booted at different times and their counters are unrelated.
    const want = newest - this.delay + Math.max(0, localTick - this._lastLocal(localTick));
    const at = Math.min(newest, Math.max(oldest, Number.isFinite(want) ? want : newest));

    if (at <= oldest) return this.buf[0].state;
    if (at >= newest) return this.buf[this.buf.length - 1].state;

    for (let i = 1; i < this.buf.length; i++) {
      const b = this.buf[i];
      if (b.tick < at) continue;
      const a = this.buf[i - 1];
      const span = b.tick - a.tick;
      const t = span === 0 ? 1 : (at - a.tick) / span;
      return lerpState(a.state, b.state, t, { snap: this.snapFields });
    }
    return this.buf[this.buf.length - 1].state;
  }

  // The local tick only supplies the FRACTION between two received snapshots:
  // it advances the sample point smoothly between packets without ever letting
  // the two unrelated counters drift apart.
  _lastLocal(localTick) {
    if (this._anchorTick == null || this._anchorNewest !== this.buf[this.buf.length - 1].tick) {
      this._anchorTick = localTick;
      this._anchorNewest = this.buf[this.buf.length - 1].tick;
    }
    return this._anchorTick;
  }
}

export default Interp;
```

Run: `npm run test:unit` — Expected: PASS, 12 new tests.

- [ ] **Step 3: Write the lobby**

Create `src/net/lobby.js`:

```js
import { normalizeRoomCode, SIDES } from './protocol.js';

// Where the room code comes from. In order: the URL, then the server.
// Everything here is a browser concern; nothing in it is simulation.
export function roomFromLocation(search = '') {
  const params = new URLSearchParams(search);
  const room = normalizeRoomCode(params.get('room'));
  const raw = params.get('side');
  return {
    room,
    side: SIDES.includes(raw) ? raw : null,
    // `?solo` is the escape hatch: play offline exactly as before this plan.
    solo: params.has('solo'),
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
// an upstream file — gains exactly one script tag and nothing else.
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
```

- [ ] **Step 4: Write the remote-Mario sprite for the pilot's screen**

Create `src/wings/art/contact.js`:

```js
import { makeSprite } from '../../core/gfx.js';

// Mario as the pilot sees him: 12x16, from 400 feet, through a canopy. Small,
// high-contrast and readable against both grass and castle stone, because at
// the pilot's scale the only question is "is that him".
//
// This is NOT the engine's Mario sprite and must not become it. The pilot's
// page never loads the game's art, and reaching into src/game for a sprite
// would couple the two pages together for a 12x16 picture.
export const CONTACT_PAL = [
  '#0a0d14', // 0 outline
  '#c0392b', // 1 cap and shirt
  '#e8b088', // 2 skin
  '#2b4a9b', // 3 dungarees
  '#f4d9c0', // 4 skin highlight
  '#7a2018', // 5 shirt shadow
];

export const MARIO_CONTACT = makeSprite(
  [
    '....0000....',
    '...011110...',
    '...0111110..',
    '..0022420...',
    '..0242420...',
    '..0244420...',
    '...022200...',
    '..01131100..',
    '.011131110..',
    '011113311110',
    '022113311220',
    '024113311420',
    '000333333000',
    '..03300330..',
    '..03300330..',
    '..00000000..',
  ],
  CONTACT_PAL,
  { name: 'wings.contact.mario' }
);
```

Run: `node -e "import('./src/wings/art/contact.js').then(m => { const s = m.MARIO_CONTACT; console.log(s.w, s.h, s.rows.every(r => r.length === s.w)); })"`
Expected: `12 16 true`. If the row widths disagree, fix the ragged row — `tests/unit/art.test.js` will catch it anyway, but not until you run it.

- [ ] **Step 5: Draw the remote Mario on the pilot's screen**

In `src/wings/scene.js`, add the import alongside the other art imports:

```js
import { MARIO_CONTACT } from './art/contact.js';
```

Add a field in the `Scene` constructor, next to the other per-frame state:

```js
    // The networked peer, in WORLD pixels, or null when playing offline.
    // src/net/pilot-side.js writes it; nothing else touches it.
    this.remoteMario = null;
```

And in `submit(r, sim)`, add one line immediately **after** the `LAYER.ENTITIES` line and before the `LAYER.PLAYER` line, so a contact on the ground reads as beneath the aeroplane:

```js
    r.draw(LAYER.ENTITIES, world((ctx) => this.drawContact(ctx, cam, f)));
```

`f` is the frame object `submit` already builds, carrying `f.vw`/`f.vh` — the *zoomed* viewport size, which is what the surrounding draw calls use and what the cull below must use too. It is not `VIEW_W`/`VIEW_H`: those are the unzoomed constants and culling against them would clip the contact early at altitude.

Then add the method to the class:

```js
  // The other player, drawn only when he is actually in the viewport. The
  // pilot does not automatically know where Mario is (spec 3): the long-range
  // picture is radar's job, and radar is a later plan. Off-camera he is simply
  // not drawn — no arrow, no ghost at the screen edge.
  drawContact(ctx, cam, f) {
    const m = this.remoteMario;
    if (!m) return;
    const sx = Math.floor(m.x - cam.x);
    const sy = Math.floor(m.y - cam.y);
    if (sx < -MARIO_CONTACT.w || sy < -MARIO_CONTACT.h) return;
    if (sx > f.vw || sy > f.vh) return;
    MARIO_CONTACT.draw(ctx, sx, sy, m.facing < 0, false);
  }
```

`Sprite#draw` is `draw(ctx, x, y, flipX = false, flipY = false)` — verified in `src/core/gfx.js`.

- [ ] **Step 6: Write the pilot's network side**

Create `src/net/pilot-side.js`:

```js
import { Transport } from './transport.js';
import { Session } from './session.js';
import { Interp } from './interp.js';
import { roomFromLocation, wsUrl, mintRoom, showRoom, banner } from './lobby.js';
import { ISLAND_TOP_Y, layoutIslands } from '../wings/geo.js';
import { getLevel } from '../data/levels/index.js';
import { ISLAND_LEVELS } from '../wings/sim.js';
import pilot from '../wings/pilot-main.js';

// The pilot's half of the match. It reaches into the game only through the
// `pilot` instance that pilot-main.js already exports, exactly as
// debug-panel.js reaches into Mario only through window.__GAME.

// Both sides compute island origins from the same list with the same function,
// so neither has to be told where the islands are.
function islandOrigins(ids = ISLAND_LEVELS) {
  const out = Object.create(null);
  for (const slot of layoutIslands(ids.map(getLevel))) out[slot.id] = slot.x;
  return out;
}

export class PilotNet {
  constructor(opts = {}) {
    this.session = null;
    this.transport = null;
    this.origins = islandOrigins(opts.islands);
    // Mario's discrete fields must never be interpolated into a blend.
    this.marioInterp = new Interp({ snap: ['island', 'anim', 'facing', 'power', 'lives', 'state'] });
    this.remote = null;
    this.lastEvent = null;
    this.desyncs = [];
  }

  async connect({ room, side = 'pilot', origin, location }) {
    this.transport = new Transport(wsUrl(location), {});
    this.session = new Session({ transport: this.transport, room, side });

    this.session.on('snapshot', (m) => {
      if (m.side === 'pilot') return; // our own, echoed: ignore
      this.marioInterp.push(m.tick, m.s);
    });
    this.session.on('peer', (m) => {
      if (!m.present) this.marioInterp.clear();
    });
    this.session.on('event', (m) => {
      this.lastEvent = m;
    });
    this.session.on('desync', (m) => {
      this.desyncs.push(m);
      console.error('[DESYNC]', m.island, 'server', m.server, 'client', m.client);
    });

    const welcome = await this.session.connect();
    this.seed = welcome.seed;
    return welcome;
  }

  // Called once per simulation tick from pilot-main's update loop.
  pump() {
    if (!this.session || !this.session.connected) return;
    const sim = pilot.sim;
    const p = sim.plane;
    this.session.sendSnapshot(sim.tick, {
      x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      angle: p.angle, mode: p.mode, gear: p.gear, fuel: p.fuel,
      squadron: sim.squadron, status: sim.status,
    });
    this.session.pump(sim.tick);

    // Mario's snapshot is in LEVEL-LOCAL pixels. Convert once, here, so the
    // renderer only ever deals in world coordinates.
    const s = this.marioInterp.sample(sim.tick);
    if (!s) {
      this.remote = null;
    } else {
      const originX = this.origins[s.island];
      this.remote = originX == null
        ? null // he is on an island this pilot has not laid out; nothing to draw
        : { x: originX + s.x, y: ISLAND_TOP_Y + s.y, facing: s.facing, island: s.island };
    }
    pilot.scene.remoteMario = this.remote;
  }

  state() {
    return {
      connected: !!(this.session && this.session.connected),
      room: this.session ? this.session.room : null,
      side: this.session ? this.session.side : null,
      peer: this.session ? this.session.peerPresent : false,
      remote: this.remote ? { ...this.remote } : null,
      desyncs: this.desyncs.length,
      stats: this.session ? this.session.stats() : null,
    };
  }
}

// --------------------------------------------------------------------------
// Boot. `?solo` skips all of this and the page behaves exactly as it did
// before this plan.
// --------------------------------------------------------------------------

const net = new PilotNet();

async function boot() {
  await pilot.boot ? await window.__WINGS.ready : null;
  const { room, solo } = roomFromLocation(location.search);
  if (solo) {
    banner(document, 'SOLO');
    return null;
  }
  const code = room || (await mintRoom(location.origin));
  showRoom(window, code, 'pilot');
  banner(document, `ROOM ${code} — PILOT`);
  const welcome = await net.connect({
    room: code,
    side: 'pilot',
    origin: location.origin,
    location,
  });
  banner(document, `ROOM ${code} — PILOT — ${welcome.peer ? 'MARIO IS HERE' : 'WAITING FOR MARIO'}`);
  net.session.on('peer', (m) => {
    banner(document, `ROOM ${code} — PILOT — ${m.present ? 'MARIO IS HERE' : 'MARIO LEFT'}`);
  });
  // One pump per simulation tick, driven by the game loop rather than a timer.
  pilot.onTick = () => net.pump();
  return welcome;
}

const ready = boot().catch((e) => {
  console.error('[pilot net] failed:', e);
  banner(document, 'OFFLINE');
  return null;
});

// Attached to the existing API rather than a second global, per spec 8.2.
window.__WINGS.net = {
  ready,
  get session() { return net.session; },
  get transport() { return net.transport; },
  state: () => net.state(),
  remote: () => net.remote,
  pump: () => net.pump(),
  latency: (ms) => (net.transport ? net.transport.latency(ms) : 0),
  drop: (pct) => (net.transport ? net.transport.drop(pct) : 0),
  disconnect: () => (net.transport ? net.transport.disconnect() : false),
  reconnect: () => (net.transport ? net.transport.reconnect() : false),
  desyncs: () => net.desyncs.map((d) => ({ ...d })),
};

export default net;
```

- [ ] **Step 7: Give `pilot-main.js` the one-line tick hook this needs**

`pilot-side.js` sets `pilot.onTick`. `pilot-main.js` must call it. In `Pilot#update()`, immediately after `this.trackAttitude();`, add:

```js
      // The network layer, if one attached itself (src/net/pilot-side.js).
      // Called from update() rather than from a timer so it advances at the
      // simulation's rate and is driven correctly by __WINGS.tick(n) in tests.
      if (this.onTick) this.onTick();
```

and in the `Pilot` constructor, next to `this.fatal = null;`:

```js
    this.onTick = null;
```

`pilot.html` is ours, not upstream, so it needs no `MODS.md` entry. Add the script tag as the last element in `<body>`, after the existing `pilot-main.js` tag:

```html
  <script type="module" src="./src/net/pilot-side.js"></script>
```

- [ ] **Step 8: Write Mario's overlay**

Create `src/net/mario-overlay.js`:

```js
import { PLANE_FRAMES } from '../wings/art/plane.js';
import { SCREEN_W, SCREEN_H } from '../core/constants.js';

// The remote aeroplane, drawn on a canvas of our own laid over the game's.
// The engine's renderer is upstream-owned and its entity list is Mario's
// simulation; pushing a network ghost into either would be an engine edit for
// a picture. A sibling canvas costs one element and zero merge surface — the
// same trade src/wings/debug-panel.js already makes.
export class MarioOverlay {
  constructor(doc = document) {
    this.doc = doc;
    this.canvas = null;
    this.ctx = null;
    this.remote = null;
  }

  attach() {
    const screen = this.doc.getElementById('screen');
    if (!screen) return null;
    const c = this.doc.createElement('canvas');
    c.id = 'net-overlay';
    c.width = SCREEN_W;
    c.height = SCREEN_H;
    // Match the game canvas's on-screen box exactly, so one logical pixel here
    // is one logical pixel there whatever the display scale happens to be.
    c.style.cssText = 'position:absolute;pointer-events:none;z-index:4;image-rendering:pixelated;';
    screen.parentElement.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this._place();
    this.doc.defaultView.addEventListener('resize', () => this._place());
    return c;
  }

  _place() {
    if (!this.canvas) return;
    const screen = this.doc.getElementById('screen');
    const box = screen.getBoundingClientRect();
    const host = screen.parentElement.getBoundingClientRect();
    this.canvas.style.left = `${box.left - host.left}px`;
    this.canvas.style.top = `${box.top - host.top}px`;
    this.canvas.style.width = `${box.width}px`;
    this.canvas.style.height = `${box.height}px`;
  }

  // `remote` is in LEVEL-LOCAL pixels already — mario-side.js does the world
  // conversion — plus the camera to subtract.
  set(remote) {
    this.remote = remote;
  }

  draw() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
    const r = this.remote;
    if (!r) return;
    const sx = Math.floor(r.x - r.camX);
    const sy = Math.floor(r.y - r.camY);
    if (sx < -32 || sx > SCREEN_W + 32 || sy < -32 || sy > SCREEN_H + 32) return;
    // Frame 0 always: the prop blur is the pilot's own feedback, and at
    // Mario's scale a strobing two-frame cycle on a distant aircraft reads as
    // flicker rather than as rotation.
    PLANE_FRAMES[0].draw(this.ctx, sx, sy, Math.cos(r.angle || 0) < 0, false);
  }

  detach() {
    if (this.canvas && this.canvas.parentElement) this.canvas.parentElement.removeChild(this.canvas);
    this.canvas = null;
    this.ctx = null;
  }
}

export default MarioOverlay;
```

Verify the two constants exist before relying on them:

Run: `grep -n "export const SCREEN_W\|export const SCREEN_H" src/core/constants.js`
Expected: both, with `SCREEN_W` 256 and `SCREEN_H` 240. If they are named differently, use whatever `src/main.js` imports for the same purpose — it already imports `SCREEN_W`.

- [ ] **Step 9: Write Mario's network side**

Create `src/net/mario-side.js`:

```js
import { Transport } from './transport.js';
import { Session } from './session.js';
import { Interp } from './interp.js';
import { MarioOverlay } from './mario-overlay.js';
import { roomFromLocation, wsUrl, mintRoom, showRoom, banner } from './lobby.js';
import { ISLAND_TOP_Y, layoutIslands } from '../wings/geo.js';
import { getLevel } from '../data/levels/index.js';
import { ISLAND_LEVELS } from '../wings/sim.js';

// Mario's half of the match. Like src/wings/debug-panel.js, this file talks to
// the game ONLY through window.__GAME and builds any DOM it needs itself, so
// index.html gains exactly one script tag and src/main.js is not touched.

function islandOrigins(ids = ISLAND_LEVELS) {
  const out = Object.create(null);
  for (const slot of layoutIslands(ids.map(getLevel))) out[slot.id] = slot.x;
  return out;
}

export class MarioNet {
  constructor(opts = {}) {
    this.game = opts.game || window.__GAME;
    this.session = null;
    this.transport = null;
    this.origins = islandOrigins(opts.islands);
    this.pilotInterp = new Interp({ snap: ['mode', 'gear', 'status', 'squadron'] });
    this.overlay = new MarioOverlay(opts.doc || document);
    this.remote = null;
    this.desyncs = [];
    this.tick = 0;
  }

  async connect({ room, side = 'mario', location }) {
    this.transport = new Transport(wsUrl(location), {});
    this.session = new Session({ transport: this.transport, room, side });

    this.session.on('snapshot', (m) => {
      if (m.side === 'mario') return;
      this.pilotInterp.push(m.tick, m.s);
    });
    this.session.on('peer', (m) => {
      if (!m.present) this.pilotInterp.clear();
    });
    this.session.on('desync', (m) => {
      this.desyncs.push(m);
      console.error('[DESYNC]', m.island, 'server', m.server, 'client', m.client);
    });

    const welcome = await this.session.connect();
    this.seed = welcome.seed;
    this.overlay.attach();
    return welcome;
  }

  // Which island Mario is on. The engine calls it a level id; the network
  // calls it an island id; they are the same string.
  islandId() {
    const stats = this.game.stats();
    return stats.level || null;
  }

  pump() {
    if (!this.session || !this.session.connected) return;
    this.tick++;
    const world = this.game.world;
    const p = world && world.player;
    if (p) {
      this.session.sendSnapshot(this.tick, {
        island: this.islandId(),
        x: p.x, y: p.y, vx: p.vx, vy: p.vy,
        facing: p.facing, power: p.power, state: p.state,
        grounded: !!p.grounded, lives: world.lives,
      });
    }
    this.session.pump(this.tick);

    // The pilot's snapshot is in WORLD pixels. Convert into this island's
    // local frame, which is the frame Mario's camera lives in.
    const s = this.pilotInterp.sample(this.tick);
    const originX = this.origins[this.islandId()];
    if (!s || originX == null || !world) {
      this.remote = null;
    } else {
      this.remote = {
        x: s.x - originX,
        y: s.y - ISLAND_TOP_Y,
        angle: s.angle,
        camX: world.rcam ? world.rcam.x : world.cam.x,
        camY: world.rcam ? world.rcam.y : world.cam.y,
      };
    }
    this.overlay.set(this.remote);
    this.overlay.draw();
  }

  state() {
    return {
      connected: !!(this.session && this.session.connected),
      room: this.session ? this.session.room : null,
      side: this.session ? this.session.side : null,
      peer: this.session ? this.session.peerPresent : false,
      island: this.islandId(),
      remote: this.remote ? { ...this.remote } : null,
      desyncs: this.desyncs.length,
      stats: this.session ? this.session.stats() : null,
    };
  }
}

const net = new MarioNet();

async function boot() {
  await window.__GAME.ready;
  const { room, solo } = roomFromLocation(location.search);
  if (solo) {
    banner(document, 'SOLO');
    return null;
  }
  const code = room || (await mintRoom(location.origin));
  showRoom(window, code, 'mario');
  banner(document, `ROOM ${code} — MARIO`);
  const welcome = await net.connect({ room: code, side: 'mario', location });
  banner(document, `ROOM ${code} — MARIO — ${welcome.peer ? 'PILOT IS UP' : 'WAITING FOR PILOT'}`);
  net.session.on('peer', (m) => {
    banner(document, `ROOM ${code} — MARIO — ${m.present ? 'PILOT IS UP' : 'PILOT LEFT'}`);
  });
  // rAF rather than the engine's loop: __GAME exposes no per-tick hook and
  // adding one would be an edit to src/main.js for no gain — the overlay is
  // presentation, and presentation runs at frame rate by definition.
  const frame = () => {
    try {
      net.pump();
    } catch (e) {
      console.error('[mario net]', e);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return welcome;
}

const ready = boot().catch((e) => {
  console.error('[mario net] failed:', e);
  banner(document, 'OFFLINE');
  return null;
});

// A second global rather than a member of __GAME: __GAME is upstream-owned
// (ARCHITECTURE.md section 10) and tools/shot.mjs drives it. Adding to it
// would be an engine edit; adding beside it is not.
window.__NET = {
  ready,
  get session() { return net.session; },
  get transport() { return net.transport; },
  state: () => net.state(),
  remote: () => net.remote,
  pump: () => net.pump(),
  latency: (ms) => (net.transport ? net.transport.latency(ms) : 0),
  drop: (pct) => (net.transport ? net.transport.drop(pct) : 0),
  disconnect: () => (net.transport ? net.transport.disconnect() : false),
  reconnect: () => (net.transport ? net.transport.reconnect() : false),
  desyncs: () => net.desyncs.map((d) => ({ ...d })),
};

export default net;
```

- [ ] **Step 10: Add the one line to `index.html`**

**This is the engine hook point.** Add as the **last** `<script>` in `<body>`, after `src/wings/debug-panel.js`:

```html
  <script type="module" src="./src/net/mario-side.js"></script>
```

Order matters for the same reason the debug panel's does: this module reads `window.__GAME`, which `src/main.js` assigns only once its own module body has run, and module scripts execute in document order.

- [ ] **Step 11: Extend the browser test harness with a room**

In `tests/browser/helpers.mjs`, add below the existing exports. **Do not touch `boot()`** — every existing browser test depends on it exactly as it is.

```js
import { startServer } from '../../server/index.js';
import { Rooms } from '../../server/room.js';

// Two players, one room, one real Node server. Separate browser CONTEXTS, not
// just separate pages: two clients that share a browser context share
// localStorage and the same rendering process, and the whole point is that
// they are two independent clients.
export async function bootRoom(opts = {}) {
  const room = opts.room || 'ACDE';
  const server = await startServer({
    port: 0,
    rooms: new Rooms(),
    log: { info() {}, warn() {}, error(...a) { serverErrors.push(a.join(' ')); } },
  });
  const serverErrors = [];
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

    // Mario first so he takes the mario seat deterministically.
    const mario = await open('/', '__GAME');
    const pilot = await open('/pilot.html', '__WINGS');
    await mario.page.waitForFunction(() => window.__NET && window.__NET.state().connected, null, { timeout: 20000 });
    await pilot.page.waitForFunction(() => window.__WINGS.net && window.__WINGS.net.state().connected, null, { timeout: 20000 });

    return { server, browser, base, room, mario, pilot };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    await server.close();
    throw err;
  }
}

export async function shutdownRoom(ctx) {
  await ctx.browser.close();
  await ctx.server.close();
}
```

Move the `serverErrors` declaration above `startServer` — the log callback closes over it, and a `const` used before its declaration is a `TemporalDeadZone` error the first time the server logs anything.

- [ ] **Step 12: Write the tier-3/4 test**

Create `tests/browser/netplay.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootRoom, shutdownRoom } from './helpers.mjs';

test('two browsers in one room', { timeout: 180000 }, async (t) => {
  const ctx = await bootRoom({ room: 'ACDE' });
  t.after(() => shutdownRoom(ctx));
  const { mario, pilot } = ctx;

  await t.test('both sides joined the same room with the same seed', async () => {
    const m = await mario.page.evaluate(() => window.__NET.state());
    const p = await pilot.page.evaluate(() => window.__WINGS.net.state());
    assert.equal(m.room, 'ACDE');
    assert.equal(p.room, 'ACDE');
    assert.equal(m.side, 'mario');
    assert.equal(p.side, 'pilot');
    assert.equal(m.peer, true, 'mario should see the pilot');
    assert.equal(p.peer, true, 'the pilot should see mario');
    const seeds = await Promise.all([
      mario.page.evaluate(() => window.__NET.session.seed),
      pilot.page.evaluate(() => window.__WINGS.net.session.seed),
    ]);
    assert.equal(seeds[0], seeds[1]);
    assert.equal(typeof seeds[0], 'number');
  });

  await t.test('the pilot sees Mario move', async () => {
    await mario.page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(6, 11);
    });
    // Let snapshots flow. Mario's pump is on rAF, so real time has to pass.
    await mario.page.waitForTimeout(400);
    const before = await pilot.page.evaluate(() => {
      window.__WINGS.net.pump();
      const r = window.__WINGS.net.remote();
      return r ? { x: r.x, island: r.island } : null;
    });
    assert.ok(before, 'the pilot never received a snapshot of Mario');
    assert.equal(before.island, '1-1');

    await mario.page.evaluate(() => {
      window.__GAME.hold({ right: true, run: true });
      window.__GAME.tick(90);
      window.__GAME.release();
    });
    await mario.page.waitForTimeout(500);
    const after = await pilot.page.evaluate(() => {
      window.__WINGS.net.pump();
      const r = window.__WINGS.net.remote();
      return r ? { x: r.x } : null;
    });
    assert.ok(after.x > before.x + 32, `Mario ran but the pilot saw ${before.x} -> ${after.x}`);
  });

  await t.test('the contact is in the right place in world coordinates', async () => {
    // Mario at local tile 6 of island 1-1 must appear at that island's origin
    // plus 96px, not at 96px, and not at the carrier.
    const [local, world] = await Promise.all([
      mario.page.evaluate(() => ({ x: window.__GAME.world.player.x, level: window.__GAME.stats().level })),
      pilot.page.evaluate(() => {
        window.__WINGS.net.pump();
        const r = window.__WINGS.net.remote();
        const isle = window.__WINGS.sim.islandById(r.island);
        return { x: r.x, originX: isle.originX };
      }),
    ]);
    assert.equal(local.level, '1-1');
    assert.ok(
      Math.abs(world.x - (world.originX + local.x)) < 48,
      `contact at ${world.x}, expected about ${world.originX + local.x} (one interp delay of slack)`
    );
  });

  await t.test('Mario sees the plane move', async () => {
    const before = await mario.page.evaluate(() => {
      window.__NET.pump();
      const r = window.__NET.remote();
      return r ? r.x : null;
    });
    await pilot.page.evaluate(() => {
      window.__WINGS.hold({ pitch: 1, thrust: 1 });
      window.__WINGS.tick(240);
      window.__WINGS.release();
    });
    await pilot.page.waitForTimeout(500);
    const after = await mario.page.evaluate(() => {
      window.__NET.pump();
      const r = window.__NET.remote();
      return r ? r.x : null;
    });
    assert.ok(before !== null && after !== null, 'no plane snapshot reached Mario');
    assert.notEqual(Math.round(before), Math.round(after), 'the plane took off and Mario saw nothing');
  });

  await t.test('the overlay canvas exists and is the game screen size', async () => {
    const box = await mario.page.evaluate(() => {
      const c = document.getElementById('net-overlay');
      return c ? { w: c.width, h: c.height } : null;
    });
    assert.deepEqual(box, { w: 256, h: 240 });
  });

  await t.test('a peer that leaves is announced and stops being drawn', async () => {
    await pilot.page.evaluate(() => window.__WINGS.net.session.close());
    await mario.page.waitForFunction(() => window.__NET.state().peer === false, null, { timeout: 10000 });
    const remote = await mario.page.evaluate(() => {
      window.__NET.pump();
      return window.__NET.remote();
    });
    assert.equal(remote, null, 'the plane must not hang in the sky after the pilot leaves');
  });

  await t.test('no uncaught page errors on either side', () => {
    assert.deepEqual(ctx.mario.errors, []);
    assert.deepEqual(ctx.pilot.errors, []);
  });
});
```

- [ ] **Step 13: Run everything**

Run: `npm test`
Expected: unit, net and browser tiers all green. 7 new browser subtests.

- [ ] **Step 14: See it with your own eyes**

Run `npm run serve`, then open two windows:

- `http://localhost:8090/pilot.html` — it mints a room and puts the code in the address bar and in the banner.
- `http://localhost:8090/?room=CODE` — using the code from the first window.

Expected: the pilot's banner changes to `MARIO IS HERE`; flying over island 1-1 shows a small Mario figure standing on it; and on Mario's window a small aeroplane crosses the sky when the pilot flies past. This is the demo. Take a screenshot for the commit if you like, but the tests are what gate the task.

- [ ] **Step 15: Commit**

```bash
git add src/net/interp.js src/net/lobby.js src/net/mario-overlay.js src/net/mario-side.js \
        src/net/pilot-side.js src/wings/art/contact.js src/wings/scene.js src/wings/pilot-main.js \
        index.html pilot.html tests/unit/interp.test.js tests/browser/helpers.mjs \
        tests/browser/netplay.test.mjs
git commit -m "Two browsers, one room, watching each other move

Mario draws the plane on a sibling canvas rather than in the engine's
entity list; the pilot draws Mario through Scene. Both convert with the
same geo.js layout, so neither has to be told where the islands are."
```

---

## Task 6: Damage sync

The pilot bombs; the server records; both clients apply the identical key list. Decisions D1, D2 and D3 all become code here, and this is the one task that edits the engine.

**Files:**
- Create: `src/net/damage-sync.js`
- Create: `tests/unit/damage-sync.test.js`
- Modify: `src/game/world.js` (**engine hook point**)
- Modify: `src/net/mario-side.js`, `src/net/pilot-side.js`
- Modify: `MODS.md`
- Modify: `tests/browser/netplay.test.mjs`

**Interfaces:**
- Consumes: `DamageMap`, `hashKeys` from `src/wings/damage.js`; `parseTileKey` from `src/wings/blast.js`.
- Produces:
  - `class DamageSync` — `record(islandId, keys) -> string[]`, `keys(islandId)`, `has(islandId, key)`, `hashes() -> {[island]: hash}`, `islands() -> string[]`, `toJSON()`, `static fromJSON(obj)`
  - `foldWorldDamage(sync, islandId, world) -> string[]` — read `world.damage` into the sync under `islandId`; returns keys newly recorded.
  - `applyToWorld(world, keys, opts) -> void` — `opts.blast = {cx, cy, radiusTiles}` makes it loud and lethal; without it, silent.
  - `applyToIsland(island, keys) -> void`
  - On `World`: `world.replayBlast(cx, cy, radiusTiles, keys) -> string[]`

- [ ] **Step 1: Write the failing adapter test**

Create `tests/unit/damage-sync.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { DamageSync, foldWorldDamage, applyToIsland } from '../../src/net/damage-sync.js';
import { hashKeys } from '../../src/wings/damage.js';
import { Island } from '../../src/wings/island.js';
import { getLevel } from '../../src/data/levels/index.js';

test('record returns only what was new, per decision D2', () => {
  const s = new DamageSync();
  assert.deepEqual(s.record('1-1', ['5,10', '6,10']).sort(), ['5,10', '6,10']);
  assert.deepEqual(s.record('1-1', ['6,10', '7,10']), ['7,10']);
  assert.deepEqual(s.record('1-1', ['6,10']), []);
});

test('malformed keys never enter the set', () => {
  const s = new DamageSync();
  assert.deepEqual(s.record('1-1', ['5,10', 'x', '', null, 7, '1 ,2']).sort(), ['5,10']);
  assert.deepEqual(s.keys('1-1'), ['5,10']);
});

test('an out-of-bounds key is recorded anyway, per decision D1', () => {
  // The set is a REPLICA OF THE SERVER'S, not a log of what this client drew.
  // A key outside this client's map still belongs in the hash.
  const s = new DamageSync();
  s.record('1-1', ['9999,9999']);
  assert.ok(s.has('1-1', '9999,9999'));
  assert.equal(s.hashes()['1-1'], hashKeys(['9999,9999']));
});

test('hashes cover every island the sync has ever heard of', () => {
  const s = new DamageSync();
  s.record('1-1', ['5,10']);
  s.record('1-2', []);
  const h = s.hashes();
  assert.deepEqual(Object.keys(h).sort(), ['1-1', '1-2']);
  assert.equal(h['1-1'], hashKeys(['5,10']));
  assert.equal(h['1-2'], hashKeys([]), 'an island bombed for zero tiles still reports');
});

test('hashes are order-independent across two independently built syncs', () => {
  const a = new DamageSync();
  const b = new DamageSync();
  a.record('1-1', ['7,10', '5,10', '6,10']);
  b.record('1-1', ['5,10']);
  b.record('1-1', ['7,10', '6,10']);
  assert.deepEqual(a.hashes(), b.hashes());
});

test('it round-trips through JSON exactly as the welcome payload does', () => {
  const s = new DamageSync();
  s.record('1-1', ['5,10', '6,10']);
  s.record('2-1', ['1,1']);
  const back = DamageSync.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
  assert.deepEqual(back.toJSON(), s.toJSON());
  assert.deepEqual(back.hashes(), s.hashes());
});

test('foldWorldDamage lifts a level Set into the island map', () => {
  // The adapter D3 exists for: world.damage is a Set for ONE level;
  // DamageMap is a Map of island -> Set. Nothing else may know both types.
  const s = new DamageSync();
  const fakeWorld = { damage: new Set(['5,10', '6,10']) };
  assert.deepEqual(foldWorldDamage(s, '1-1', fakeWorld).sort(), ['5,10', '6,10']);
  assert.deepEqual(s.keys('1-1'), ['5,10', '6,10']);
  // Folding twice records nothing new — it is a merge, not an append.
  assert.deepEqual(foldWorldDamage(s, '1-1', fakeWorld), []);
});

test('foldWorldDamage on a world with no damage is a no-op, not a crash', () => {
  const s = new DamageSync();
  assert.deepEqual(foldWorldDamage(s, '1-1', null), []);
  assert.deepEqual(foldWorldDamage(s, '1-1', {}), []);
  assert.deepEqual(s.islands(), []);
});

test('applyToIsland puts the server keys into a real Island', () => {
  const isle = new Island(getLevel('1-1'), 3000);
  applyToIsland(isle, ['20,13', '21,13']);
  assert.ok(isle.destroyed.has('20,13'));
  assert.equal(isle.charAt(20, 13), '.');
  // Idempotent: the same broadcast arriving twice must change nothing.
  applyToIsland(isle, ['20,13']);
  assert.deepEqual(isle.keys(), ['20,13', '21,13']);
});

test('an island and a sync that saw the same keys agree on the hash', () => {
  // This equality is the entire desync detector. If it can fail here it will
  // fail in a match.
  const isle = new Island(getLevel('1-1'), 3000);
  const s = new DamageSync();
  const keys = ['20,13', '21,13', '22,13'];
  applyToIsland(isle, keys);
  s.record('1-1', keys);
  assert.equal(s.hashes()['1-1'], hashKeys(isle.keys()));
});
```

- [ ] **Step 2: Run it and watch it fail, then write the adapter**

Run: `npm run test:unit` — Expected: FAIL, `Cannot find module '.../src/net/damage-sync.js'`.

Create `src/net/damage-sync.js`:

```js
import { DamageMap, hashKeys } from '../wings/damage.js';
import { parseTileKey } from '../wings/blast.js';

// The bridge between the two shapes damage comes in. THIS IS THE ONLY FILE
// ALLOWED TO KNOW BOTH (decision D3):
//
//   world.damage   Set<"tx,ty">                 one level, engine-owned
//   Island#destroyed  Set<"tx,ty">              one island, pilot-owned
//   DamageMap      Map<islandId, Set<"tx,ty">>  the whole match, server-owned
//
// Neither the engine nor src/wings/ learns about DamageMap. Everything in
// src/net/ that needs damage goes through here.

export class DamageSync {
  constructor(map) {
    this.map = map || new DamageMap();
  }

  // Decision D2: the newly-added keys this returns are the fact. Note there
  // is no bounds check and deliberately so (decision D1) — this set is a
  // replica of the server's, not a record of what this client managed to
  // draw, and a client that quietly dropped a key it could not apply would
  // hash a strict subset of the server's set and report desync forever.
  //
  // Malformed keys ARE dropped, because a key that cannot be parsed cannot be
  // applied by anybody and so cannot be part of any agreement.
  record(islandId, keys) {
    if (!Array.isArray(keys)) return [];
    return this.map.add(islandId, keys.filter((k) => parseTileKey(k) !== null));
  }

  has(islandId, key) {
    return this.map.has(islandId, key);
  }

  keys(islandId) {
    return this.map.keys(islandId);
  }

  islands() {
    return [...this.map.islands.keys()].sort();
  }

  // One hash per island we have heard of, including islands with an empty set:
  // a client that invented damage the server never saw must still be caught.
  hashes() {
    const out = Object.create(null);
    for (const id of this.islands()) out[id] = this.map.hash(id);
    return out;
  }

  toJSON() {
    return this.map.toJSON();
  }

  static fromJSON(obj) {
    return new DamageSync(DamageMap.fromJSON(obj));
  }
}

// Lift a World's flat, single-level damage Set into the island map. Used on
// arrival at an island, so damage the engine applied locally on load is
// reflected in what this client hashes.
export function foldWorldDamage(sync, islandId, world) {
  if (!world || !world.damage) return [];
  return sync.record(islandId, [...world.damage]);
}

// Push the server's keys into a loaded World. With `opts.blast` this is a LIVE
// detonation on this client — craters, debris, shake, and anything standing in
// the radius dies. Without it, it is a silent catch-up (a level just loaded, a
// reconnect, a peer's crater on an island nobody is standing on).
export function applyToWorld(world, keys, opts = {}) {
  if (!world || !Array.isArray(keys) || !keys.length) return;
  const b = opts.blast;
  if (b && typeof world.replayBlast === 'function') {
    world.replayBlast(b.cx, b.cy, b.radiusTiles, keys);
  } else {
    world.applyDamage(keys);
  }
}

// The pilot's terrain is an Island, not a World: no entities, no decor
// snapshot, nothing to kill. applyDamage is the whole of it.
export function applyToIsland(island, keys) {
  if (!island || !Array.isArray(keys) || !keys.length) return;
  island.applyDamage(keys);
}

export default DamageSync;
```

Run: `npm run test:unit` — Expected: PASS, 10 new tests.

- [ ] **Step 3: Fix `applyDamage` per decision D1**

In `src/game/world.js`, in `applyDamage(keys)`, replace this:

```js
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
      this.damage.add(key);
      this.setTile(tx, ty, '.');
```

with this:

```js
      // Record the key WHATEVER the local map can accommodate, and skip only
      // the tile write. `this.damage` is this client's replica of the shared
      // destroyed-set (design spec 4.3), not a log of tiles this client drew:
      // a key the server holds and this level cannot place must still be in
      // the set, or the desync hash compares a strict subset against the
      // server's full set and reports a permanent, unrecoverable mismatch.
      // See MODS.md, decision D1.
      this.damage.add(key);
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
      this.setTile(tx, ty, '.');
```

- [ ] **Step 4: Add `replayBlast` to `World`**

Insert immediately after `blast(cx, cy, radiusTiles)` in `src/game/world.js`:

```js
  // A PEER'S detonation, replayed on this client. The KEYS are authoritative:
  // they came from the server, which is the only process that decides what is
  // in the destroyed set, so they are applied unconditionally through
  // applyDamage() rather than re-derived here. Re-deriving them with
  // blastTiles() would let two clients with any difference at all — a
  // different level revision, a rounding difference in the impact point —
  // silently crater different tiles, which is precisely the divergence the
  // desync hash exists to catch and should never have to.
  //
  // Everything else this does is local presentation, and the kill: only a
  // live detonation knows the blast's CENTRE, which is why _blastKill is not
  // in destroyTiles() and why this method has to exist at all rather than the
  // network calling destroyTiles().
  replayBlast(cx, cy, radiusTiles, keys) {
    const fresh = [];
    for (const key of keys) if (!this.damage.has(key)) fresh.push(key);
    this.applyDamage(keys);
    for (const key of fresh) {
      const parsed = parseTileKey(key);
      if (!parsed) continue;
      const { tx, ty } = parsed;
      if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) continue;
      this.contents.delete(tileKey(tx, ty));
      this.fx('brickShatter', tx * TILE + TILE / 2, ty * TILE + TILE / 2, this.theme);
    }
    if (fresh.length) {
      this.sfx('break');
      this.shake(3, 10);
      this._buildDecor();
      if (!this.flagFalling) this._findLandmarks(this.level, this.rootLevel);
    }
    this._blastKill(cx, cy, radiusTiles * TILE);
    return fresh;
  }
```

The `_blastKill` call is **outside** the `if (fresh.length)` guard on purpose: a bomb that lands in a hole it already blew still kills whatever is standing in the hole.

- [ ] **Step 5: Verify the engine still boots and a replayed blast behaves**

Run `npm run serve` in one terminal, then:

```bash
node -e "import('playwright').then(async ({chromium}) => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://localhost:8090/?solo');
  await p.evaluate(() => window.__GAME.ready);
  const r = await p.evaluate(async () => {
    await window.__GAME.loadLevel('1-1');
    const w = window.__GAME.world;
    const before = w.tileAt(20, 13).solid;
    const fresh = w.replayBlast(20*16+8, 13*16+8, 2, ['20,13','21,13','9999,9999']);
    return { before, fresh, after: w.tileAt(20,13).solid, damage: [...w.damage].sort() };
  });
  console.log(r); await b.close();
})"
```

Expected: `before` truthy, `fresh` contains all three keys, `after` falsy, and `damage` **includes `9999,9999`** — that last one is decision D1 working. If `9999,9999` is missing, Step 3 did not take.

- [ ] **Step 6: Wire the pilot's detonation to the wire**

In `src/net/pilot-side.js`, add to the imports:

```js
import { DamageSync, applyToIsland } from './damage-sync.js';
```

In `PilotNet`'s constructor, next to `this.desyncs = []`:

```js
    this.sync = new DamageSync();
    // How far through sim.events we have already reported. sim.events is
    // append-only and pilot-main never truncates it, so a cursor is cheaper
    // and safer than draining the array out from under the HUD.
    this.eventCursor = 0;
```

In `connect()`, before `await this.session.connect()`, register the damage handler:

```js
    this.session.on('damage', (m) => {
      // Authoritative. Apply to the island whether or not we proposed it: one
      // code path writes the set on every client (decision D2).
      this.sync.record(m.island, m.keys);
      const isle = pilot.sim.islandById(m.island);
      if (isle) applyToIsland(isle, m.keys);
    });
```

and after it resolves, seed from the welcome:

```js
    const welcome = await this.session.connect();
    this.seed = welcome.seed;
    // A reconnect, or a room whose pilot bombed before we arrived: the match's
    // whole destroyed-set arrives in the welcome and every island takes its own.
    this.sync = DamageSync.fromJSON(welcome.damage);
    for (const isle of pilot.sim.islands) applyToIsland(isle, this.sync.keys(isle.id));
    return welcome;
```

In `pump()`, after `this.session.pump(sim.tick)`, drain the sim's own event log:

```js
    // WingsSim already emits `detonation` with exactly the fields the wire
    // wants; forwarding it is a rename, not a second source of truth.
    for (; this.eventCursor < sim.events.length; this.eventCursor++) {
      const e = sim.events[this.eventCursor];
      if (e.type === 'detonation') {
        if (!e.island || !e.keys || !e.keys.length) continue;
        this.session.sendEvent('detonate', {
          island: e.island,
          cx: e.x,
          cy: e.y,
          radius: e.radius,
          keys: e.keys,
        });
      } else if (e.type === 'released') {
        this.session.sendEvent('bombRelease', { kind: e.kind, x: e.x, y: e.y });
      }
    }
```

- [ ] **Step 7: Apply craters on Mario's client**

In `src/net/mario-side.js`, add to the imports:

```js
import { DamageSync, applyToWorld, foldWorldDamage } from './damage-sync.js';
import { ISLAND_TOP_Y } from '../wings/geo.js';
```

(`ISLAND_TOP_Y` is already imported by Task 5's version of the file; do not import it twice.)

In `MarioNet`'s constructor:

```js
    this.sync = new DamageSync();
```

In `connect()`, register the handler before connecting:

```js
    this.session.on('damage', (m) => {
      this.sync.record(m.island, m.keys);
      // Only the island Mario is actually standing on has a World to crater.
      // Spec 4.3: no inactive island is ever simulated — for the others the
      // sync IS the island, and loadLevel subtracts it on arrival.
      if (m.island !== this.islandId()) return;
      const world = this.game.world;
      const d = this.pendingBlast && this.pendingBlast.island === m.island ? this.pendingBlast : null;
      applyToWorld(world, m.keys, d ? { blast: d } : {});
      this.pendingBlast = null;
    });

    this.session.on('event', (m) => {
      if (m.type !== 'detonate') return;
      // The centre arrives with the event; the KEYS arrive with the damage
      // broadcast. Hold the centre so the two can be applied as one live
      // detonation — the kill needs the centre, the crater needs the keys.
      const originX = this.origins[m.d.island];
      if (originX == null) return;
      this.pendingBlast = {
        island: m.d.island,
        cx: m.d.cx - originX,
        cy: m.d.cy - ISLAND_TOP_Y,
        radiusTiles: m.d.radius,
      };
    });
```

and seed from the welcome after connecting:

```js
    const welcome = await this.session.connect();
    this.seed = welcome.seed;
    this.sync = DamageSync.fromJSON(welcome.damage);
    await this.reloadIsland();
    this.overlay.attach();
    return welcome;
```

Add the reload method to `MarioNet`:

```js
  // Arriving at an island — on join, on reconnect, or on clearing the last
  // one — means loading the level with its destroyed-set subtracted.
  // __GAME.loadLevel passes the keys through the options bag so decor,
  // landmarks, the player and the entities all see the cratered map rather
  // than the original one.
  async reloadIsland(id) {
    const island = id || this.islandId();
    if (!island) return false;
    await this.game.loadLevel(island, null, this.sync.keys(island));
    // And fold back whatever the engine ended up with, so the set this client
    // hashes is the set the engine is actually holding.
    foldWorldDamage(this.sync, island, this.game.world);
    return true;
  }
```

- [ ] **Step 8: Extend the browser test**

Append these subtests to `tests/browser/netplay.test.mjs`, inside the existing `test(...)` body **before** the `no uncaught page errors` subtest (it must stay last):

```js
  await t.test('a crater the pilot blows appears in Mario\'s tile map', async () => {
    await mario.page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
    });
    await mario.page.waitForTimeout(300);

    const solidBefore = await mario.page.evaluate(() => window.__GAME.world.tileAt(20, 13).solid);
    assert.ok(solidBefore, 'test premise: 20,13 of 1-1 is solid ground');

    const proposed = await pilot.page.evaluate(() => {
      const isle = window.__WINGS.sim.islandById('1-1');
      // Detonate straight on the island rather than flying a bomb there: the
      // ballistics are Plan 2's business and are tested there.
      const keys = isle.blast(isle.originX + 20 * 16 + 8, 13 * 16 + 8 + 0, 2);
      window.__WINGS.sim.emit('detonation', {
        kind: 'bomb',
        x: isle.originX + 20 * 16 + 8,
        y: window.__WINGS.sim.islands[0].y0 + 13 * 16 + 8,
        radius: 2,
        water: false,
        island: '1-1',
        keys,
      });
      window.__WINGS.net.pump();
      return keys;
    });
    assert.ok(proposed.length > 0, 'the pilot destroyed nothing to send');

    await mario.page.waitForFunction(
      () => !window.__GAME.world.tileAt(20, 13).solid,
      null,
      { timeout: 10000 }
    );

    const [marioKeys, pilotKeys] = await Promise.all([
      mario.page.evaluate(() => window.__NET.state() && window.__GAME.damageKeys()),
      pilot.page.evaluate(() => window.__WINGS.sim.islandById('1-1').keys()),
    ]);
    assert.deepEqual(marioKeys, pilotKeys, 'the two destroyed-sets diverged');
  });

  await t.test('both sides hash the destroyed set identically', async () => {
    const [a, b] = await Promise.all([
      mario.page.evaluate(() => window.__NET.session && window.__NET.state()),
      pilot.page.evaluate(() => window.__WINGS.net.state()),
    ]);
    assert.equal(a.desyncs, 0, 'Mario reported a desync');
    assert.equal(b.desyncs, 0, 'the pilot reported a desync');
  });
```

- [ ] **Step 9: Run everything**

Run: `npm test`
Expected: green throughout.

- [ ] **Step 10: Update `MODS.md`**

Under the `src/game/world.js` heading, **replace** the `Known, deliberate gaps left for the networking plan` block with:

```markdown
**Decisions the networking plan made about these (Plan 3):**

- **`applyDamage` now records an out-of-bounds key and skips only the
  `setTile`.** `this.damage` is this client's replica of the shared
  destroyed-set (design spec 4.3), not a log of the tiles this client drew.
  A key the server holds and this level cannot place must still be in the
  set, or the desync hash compares a strict subset against the server's full
  set and reports a permanent, unrecoverable mismatch. Two lines.
- **`DamageMap.add()` is authoritative; `destroyTiles()`'s return value never
  reaches the wire.** The two return different things — newly-*added* keys
  versus actually-*destroyed* keys — and only one process is allowed to answer
  "what is destroyed": the server. The pilot's `Island.blast()` result is a
  *proposal*; the server's `DamageMap.add()` result is the *fact*, broadcast
  to both clients and applied through `applyDamage`. `destroyTiles()` stays
  exactly what it was, the loud local entry point for a live detonation, and
  nothing in `src/net/` calls it.
- **The adapter is `src/net/damage-sync.js`.** It is the only file in the repo
  that knows both `world.damage` (a `Set` for one level) and `DamageMap` (a
  `Map` of island to `Set`). The engine still has never heard of `DamageMap`.

**Added `replayBlast(cx, cy, radiusTiles, keys)`:** a peer's detonation,
replayed here. The keys are applied verbatim through `applyDamage` rather than
re-derived from `blastTiles`, because re-deriving them would let two clients
with any difference at all — a level revision, a rounding difference in the
impact point — silently crater different tiles. Everything else it does is
local: debris, `sfx('break')`, `shake`, the decor and landmark rebuild that
`destroyTiles` also does, and `_blastKill`, which needs the blast CENTRE and
is therefore the reason this method has to exist instead of the network layer
calling `destroyTiles`. `_blastKill` runs even when no tile was fresh: a bomb
into a hole it already blew still kills whatever is standing in it.
```

And append a new section:

```markdown
## `index.html` — multiplayer hook

**Why:** Mario's client needs to join a room. Like the debug panel, all of its
logic lives outside the engine — in `src/net/`, which upstream has never heard
of — and it reaches the game only through `window.__GAME`. `src/main.js` is
**not** touched: everything the network layer needs is already on that object,
and `window.__NET` is a separate global beside it rather than a new member of
it, because `__GAME` is upstream-owned per ARCHITECTURE.md section 10 and
`tools/shot.mjs` drives it.

**Changed:**
- Added one line after the `src/wings/debug-panel.js` script tag:
  `<script type="module" src="./src/net/mario-side.js"></script>`.

**On conflict:** keep this as the last `<script>` in `<body>`. It reads
`window.__GAME`, which `src/main.js` assigns only once its module body has
finished, and module scripts execute in document order.
```

- [ ] **Step 11: Check the engine diff is still small**

Run: `git diff upstream/main --stat -- src/game src/main.js index.html`
Expected: three files, and the total added-line count within about 20 lines of the 149 it was before this task. If it has grown more than that, something that belongs in `src/net/` has leaked into the engine.

If `upstream/main` is not fetched, `git fetch upstream` first; if there is no upstream remote configured in this checkout, compare against the merge base with the initial import instead and say so in the commit message.

- [ ] **Step 12: Commit**

```bash
git add src/net/damage-sync.js src/net/mario-side.js src/net/pilot-side.js \
        src/game/world.js MODS.md tests/unit/damage-sync.test.js tests/browser/netplay.test.mjs
git commit -m "Damage sync: one process decides what is destroyed

The server's DamageMap.add() is the fact; a client's destroyTiles() result is
not. applyDamage now records out-of-bounds keys so a client can never hash a
strict subset of the server's set. World gains replayBlast, which applies a
peer's keys verbatim and kills from the blast centre."
```

---

## Task 7: Match events and hit resolution

The nine remaining reliable events, and the rule that settles every argument: **hit resolution follows ownership.**

**Files:**
- Modify: `src/net/mario-side.js`, `src/net/pilot-side.js`
- Create: `tests/net/events.test.mjs`
- Modify: `tests/browser/netplay.test.mjs`

**The rule, made concrete.** Per spec §7.3:

| Question | Decided by | How |
|---|---|---|
| Did that bomb kill Mario? | **Mario's client** | `replayBlast`'s `_blastKill` runs on Mario's machine against his own hitbox and his own `invulnFrames`. He then emits `marioDeath`. |
| Which tiles did that bomb destroy? | The pilot proposes, **the server records** | Task 6. |
| Did Mario's fireball hit the plane? | **The pilot's client** | The fireball's position comes from Mario's snapshot; the pilot's client tests it against its own plane. Deferred with the rest of Mario-fights-back to a later plan; the ownership is fixed here so it cannot be relitigated. |
| Did the plane crash? | **The pilot's client** | `WingsSim.lose()` already decides; it emits `planeLost`. |

The pilot's client never kills Mario and Mario's client never destroys a plane. Nothing in this task is allowed to break that.

**Interfaces:**
- Produces, on `MarioNet`: `onDeath`, `onCleared`, `lives`, `matchStatus`.
- Produces, on `PilotNet`: `marioLives`, `squadron`, `matchStatus`, `winner()`.

- [ ] **Step 1: Emit Mario's events**

In `src/net/mario-side.js`, add to `MarioNet`'s constructor:

```js
    // Match bookkeeping, mirrored from whichever side owns each number.
    this.lives = null;
    this.squadron = null;
    this.matchStatus = 'playing';
    this._lastLives = null;
    this._lastLevel = null;
    this._deathSent = false;
```

and add this method, called from `pump()` immediately after the snapshot is sent:

```js
  // Mario's client owns Mario, so it is the one that announces what happened
  // to him. Everything here is edge-triggered off state the engine already
  // maintains — nothing new is simulated to produce an event.
  emitOwnEvents() {
    const world = this.game.world;
    const p = world && world.player;
    if (!p) return;
    const island = this.islandId();

    // A death. `state === 'dying'` is the engine's own flag and it latches for
    // the whole death animation, so the send is guarded rather than levelled:
    // one death, one event.
    const dying = p.state === 'dying' || p.dead;
    if (dying && !this._deathSent) {
      this._deathSent = true;
      this.session.sendEvent('marioDeath', { island, lives: world.lives, x: p.x, y: p.y });
    }
    if (!dying) this._deathSent = false;

    if (this._lastLives != null && world.lives < this._lastLives && world.lives <= 0) {
      // No continues (spec 1). This is the pilot's win and it is announced
      // once, by the client that owns the life counter.
      this.matchStatus = 'pilot-wins';
    }
    this._lastLives = world.lives;

    // Clearing an island: the level id changed under us and the previous one
    // was not abandoned by a death.
    if (this._lastLevel && island && island !== this._lastLevel && !dying) {
      this.session.sendEvent('islandCleared', { island: this._lastLevel, next: island });
      if (this._lastLevel === '8-4') {
        this.session.sendEvent('worldCleared', { island: this._lastLevel });
        this.matchStatus = 'mario-wins';
      }
    }
    this._lastLevel = island;
  }
```

Wire it in `pump()`, right after `this.session.sendSnapshot(...)`:

```js
      this.emitOwnEvents();
```

and consume the pilot's events by extending the existing `'event'` listener in `connect()`:

```js
    this.session.on('event', (m) => {
      if (m.type === 'detonate') {
        const originX = this.origins[m.d.island];
        if (originX == null) return;
        this.pendingBlast = {
          island: m.d.island,
          cx: m.d.cx - originX,
          cy: m.d.cy - ISLAND_TOP_Y,
          radiusTiles: m.d.radius,
        };
        return;
      }
      if (m.type === 'planeLost') {
        this.squadron = m.d.squadron;
        // The pilot's last aircraft: Mario wins (spec 3.4). The pilot's client
        // owns the squadron count, so this is mirrored, never recomputed.
        if (m.d.squadron <= 0) this.matchStatus = 'mario-wins';
        return;
      }
      if (m.type === 'bombRelease') {
        // Telegraphing (spec 4.2) is Plan 4. Recorded here so the whistle and
        // the shadow marker have an event to hang off when it lands.
        this.lastBombRelease = m.d;
      }
    });
```

- [ ] **Step 2: Emit the pilot's events**

In `src/net/pilot-side.js`, extend the `sim.events` drain in `pump()` — the loop already added in Task 6 — with the remaining cases:

```js
      } else if (e.type === 'landed') {
        this.session.sendEvent('landed', { x: sim.plane.x, squadron: sim.squadron });
      } else if (e.type === 'planeLost') {
        this.session.sendEvent('planeLost', {
          reason: e.reason, x: e.x, y: e.y, squadron: sim.squadron,
        });
        if (sim.squadron <= 0) this.matchStatus = 'mario-wins';
      } else if (e.type === 'sortieStart') {
        this.session.sendEvent('sortieStart', { squadron: e.squadron });
      }
```

Add to `PilotNet`'s constructor:

```js
    this.marioLives = null;
    this.marioIsland = null;
    this.matchStatus = 'playing';
```

and extend the `'event'` listener in `connect()`:

```js
    this.session.on('event', (m) => {
      this.lastEvent = m;
      if (m.type === 'marioDeath') {
        this.marioLives = m.d.lives;
        // Spec 1: no continues. Mario's client owns the life counter, so this
        // is read, never recomputed.
        if (m.d.lives <= 0) this.matchStatus = 'pilot-wins';
      } else if (m.type === 'islandCleared') {
        this.marioIsland = m.d.next;
      } else if (m.type === 'worldCleared') {
        this.matchStatus = 'mario-wins';
      } else if (m.type === 'ferryBoard') {
        // The ferry is a later plan; the event is carried now so the torpedo
        // has something to sink when it arrives.
        this.marioIsland = null;
      }
    });
```

Add a `winner()` to both classes — identical body, deliberately duplicated rather than shared, because it reads a different object on each side:

```js
  winner() {
    return this.matchStatus === 'playing' ? null : this.matchStatus.replace('-wins', '');
  }
```

- [ ] **Step 3: Write the tier-2 event test**

Create `tests/net/events.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG } from '../../src/net/protocol.js';
import { startTestServer, pair } from './helpers.mjs';

const OWNED_BY_PILOT = ['bombRelease', 'detonate', 'sortieStart', 'landed', 'planeLost', 'ferrySunk'];
const OWNED_BY_MARIO = ['marioDeath', 'islandCleared', 'ferryBoard', 'worldCleared'];

test('event ownership over a real socket', { timeout: 60000 }, async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { port } = server;

  await t.test('every pilot-owned event reaches Mario and is refused from Mario', async () => {
    const { mario, pilot } = await pair(port, 'ACDE');
    let seq = 0;
    for (const type of OWNED_BY_PILOT) {
      const d = type === 'detonate' ? { island: '1-1', keys: [] } : { probe: type };
      pilot.send({ t: MSG.EV, seq: ++seq, type, d });
      // detonate arrives as a DAMAGE broadcast, not as a relayed EV.
      const want = type === 'detonate' ? MSG.DAMAGE : MSG.EV;
      const got = await mario.next((m) => m.t === want && (want === MSG.DAMAGE || m.type === type));
      assert.ok(got, `${type} never reached Mario`);
    }
    let mseq = 0;
    for (const type of OWNED_BY_PILOT) {
      mario.send({ t: MSG.EV, seq: ++mseq, type, d: { island: '1-1', keys: [] } });
      const err = await mario.next((m) => m.t === MSG.ERROR && m.reason.includes(type));
      assert.match(err.reason, new RegExp(`not the owner of ${type}`));
    }
    await mario.close();
    await pilot.close();
  });

  await t.test('every mario-owned event reaches the pilot and is refused from the pilot', async () => {
    const { mario, pilot } = await pair(port, 'FGHJ');
    let seq = 0;
    for (const type of OWNED_BY_MARIO) {
      mario.send({ t: MSG.EV, seq: ++seq, type, d: { probe: type } });
      const got = await pilot.next((m) => m.t === MSG.EV && m.type === type);
      assert.equal(got.d.probe, type);
    }
    let pseq = 0;
    for (const type of OWNED_BY_MARIO) {
      pilot.send({ t: MSG.EV, seq: ++pseq, type, d: {} });
      const err = await pilot.next((m) => m.t === MSG.ERROR && m.reason.includes(type));
      assert.match(err.reason, new RegExp(`not the owner of ${type}`));
    }
    await mario.close();
    await pilot.close();
  });

  await t.test('a refused event costs the sender nothing else', async () => {
    // A rejection must not tear down the connection or invalidate the seq
    // stream: the next legal event still has to work.
    const { mario, pilot } = await pair(port, 'KMNP');
    mario.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['1,1'] } });
    await mario.ofType(MSG.ERROR);
    mario.send({ t: MSG.EV, seq: 2, type: 'marioDeath', d: { lives: 2 } });
    const got = await pilot.next((m) => m.t === MSG.EV && m.type === 'marioDeath');
    assert.equal(got.d.lives, 2);
    await mario.close();
    await pilot.close();
  });

  await t.test('events survive a reconnect mid-flight', async () => {
    const { mario, pilot, pilotWelcome } = await pair(port, 'QRTU');
    await pilot.close();
    mario.send({ t: MSG.EV, seq: 1, type: 'marioDeath', d: { lives: 1 } });
    // Nobody is listening. Mario's session keeps resending; simulate that by
    // sending again once the pilot is back.
    const { FakeClient } = await import('./helpers.mjs');
    const again = new FakeClient(port);
    await again.hello('QRTU', undefined, pilotWelcome.token);
    mario.send({ t: MSG.EV, seq: 1, type: 'marioDeath', d: { lives: 1 } });
    const got = await again.next((m) => m.t === MSG.EV && m.type === 'marioDeath');
    assert.equal(got.d.lives, 1);
    await again.close();
    await mario.close();
  });
});
```

- [ ] **Step 4: Add the tier-4 hit-resolution test**

Append to `tests/browser/netplay.test.mjs`, before the `no uncaught page errors` subtest:

```js
  await t.test('a bomb kills Mario because MARIO\'S client said so', async () => {
    // Ownership (spec 7.3): the pilot proposes a detonation, Mario's client
    // runs the kill against his own hitbox, and Mario's client is what
    // announces the death.
    await mario.page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(30, 12);
      window.__GAME.tick(30);
    });
    await mario.page.waitForTimeout(300);

    const livesBefore = await mario.page.evaluate(() => window.__GAME.world.lives);

    await pilot.page.evaluate(() => {
      const isle = window.__WINGS.sim.islandById('1-1');
      const cx = isle.originX + 30 * 16 + 8;
      const cy = isle.y0 + 12 * 16 + 8;
      const keys = isle.blast(cx, cy, 2);
      window.__WINGS.sim.emit('detonation', {
        kind: 'bomb', x: cx, y: cy, radius: 2, water: false, island: '1-1', keys,
      });
      window.__WINGS.net.pump();
    });

    await mario.page.waitForFunction(
      () => {
        const p = window.__GAME.world.player;
        return p.state === 'dying' || p.dead;
      },
      null,
      { timeout: 10000 }
    );

    // And the pilot learns about it from Mario, not by deciding it himself.
    await pilot.page.waitForFunction(
      () => window.__WINGS.net.state().marioLives != null,
      null,
      { timeout: 10000 }
    );
    const seen = await pilot.page.evaluate(() => window.__WINGS.net.state().marioLives);
    assert.ok(seen <= livesBefore, `pilot saw lives=${seen}, Mario had ${livesBefore}`);
  });

  await t.test('a star Mario survives the same bomb, and the pilot is told nothing', async () => {
    // The engine's one deliberate exception (MODS.md), and it must hold over
    // the wire too: the kill runs on Mario's machine against Mario's state.
    await mario.page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(30, 12);
      window.__GAME.tick(30);
      window.__GAME.setPower('star');
    });
    await mario.page.waitForTimeout(300);

    await pilot.page.evaluate(() => {
      const isle = window.__WINGS.sim.islandById('1-1');
      const cx = isle.originX + 30 * 16 + 8;
      const cy = isle.y0 + 12 * 16 + 8;
      const keys = isle.blast(cx, cy, 3);
      window.__WINGS.sim.emit('detonation', {
        kind: 'bomb', x: cx, y: cy, radius: 3, water: false, island: '1-1', keys,
      });
      window.__WINGS.net.pump();
    });
    await mario.page.waitForTimeout(800);
    const alive = await mario.page.evaluate(() => {
      const p = window.__GAME.world.player;
      return p.state !== 'dying' && !p.dead;
    });
    assert.ok(alive, 'a star Mario was killed by a networked blast');
  });
```

`livesBefore` is captured inside the first subtest and referenced in it only — do not hoist it; the second subtest reloads the level and its own life count is irrelevant.

- [ ] **Step 5: Run everything**

Run: `npm test`
Expected: green. 4 new tier-2 subtests, 2 new tier-4 subtests.

- [ ] **Step 6: Commit**

```bash
git add src/net/mario-side.js src/net/pilot-side.js tests/net/events.test.mjs tests/browser/netplay.test.mjs
git commit -m "Match events, and hit resolution that follows ownership

Mario's client decides whether a bomb killed Mario, and announces it. The
pilot's client decides whether the plane crashed, and announces that. Neither
ever decides anything about the other."
```

---

## Task 8: Continuous desync detection

Spec §8.4 is explicit that this is **not a test-only mechanism**. Each client hashes its destroyed-tile set every second and sends it; the server compares and logs loudly on mismatch. It runs in real play, on both sides, whether or not anybody is watching.

**Files:**
- Modify: `src/net/session.js`, `src/net/mario-side.js`, `src/net/pilot-side.js`
- Create: `tests/net/desync.test.mjs`
- Modify: `tests/browser/netplay.test.mjs`

**Interfaces:**
- Produces:
  - `Session#maybeSendHash(tick, buildHashes) -> boolean` — fires on the `HASH_INTERVAL_TICKS` cadence and calls `buildHashes()` **only** when it is actually going to send; hashing 200 keys sixty times a second for one useful frame would be a waste.
  - On both `__NET` and `__WINGS.net`: `desyncs()`, and a `hashes()` reader.

- [ ] **Step 1: Add the cadence to the session**

In `src/net/session.js`, import `HASH_INTERVAL_TICKS` alongside the others and add to the constructor:

```js
    this._lastHashTick = -Infinity;
```

Then add the method next to `sendHash`:

```js
  // The desync detector's clock. `buildHashes` is a callback rather than a
  // value so the hash is computed only on the tick it is actually sent —
  // FNV-1a over every destroyed key, sixty times a second, for one useful
  // frame in sixty, is real work for nothing.
  maybeSendHash(tick, buildHashes) {
    if (!this.connected) return false;
    if (tick - this._lastHashTick < HASH_INTERVAL_TICKS) return false;
    this._lastHashTick = tick;
    this.sendHash(tick, buildHashes());
    return true;
  }
```

Add to `tests/unit/session.test.js`:

```js
test('hashes go out once a second and are computed only when sent', async () => {
  const { s, transport } = await connected();
  let built = 0;
  const build = () => {
    built++;
    return { '1-1': 'deadbeef' };
  };
  for (let tick = 0; tick < 181; tick++) s.maybeSendHash(tick, build);
  assert.equal(transport.countOf(MSG.HASH), 4, 'ticks 0, 60, 120 and 180');
  assert.equal(built, 4, 'the hash must not be computed on the 177 ticks it is not sent');
  assert.deepEqual(transport.lastOf(MSG.HASH).h, { '1-1': 'deadbeef' });
});
```

Run: `npm run test:unit` — Expected: PASS, one new test.

- [ ] **Step 2: Send the hashes from both sides**

In `src/net/mario-side.js`, in `pump()`, after `this.session.pump(this.tick)`:

```js
    // Spec 8.4: this runs in real play, not only under test. The set hashed
    // is the SYNC's, not the world's, because the sync is the replica of what
    // the server holds — including keys for islands nobody is standing on and
    // keys this level's map could not place (decision D1).
    this.session.maybeSendHash(this.tick, () => {
      const island = this.islandId();
      // Fold first: whatever the engine has cratered locally belongs in the
      // replica before it is hashed, or a local blast the server has not yet
      // acknowledged reads as a desync for one frame.
      if (island) foldWorldDamage(this.sync, island, this.game.world);
      return this.sync.hashes();
    });
```

In `src/net/pilot-side.js`, in `pump()`, after `this.session.pump(sim.tick)`:

```js
    this.session.maybeSendHash(sim.tick, () => {
      // Same fold on this side: the pilot's islands crater optimistically the
      // moment a bomb lands, before the server has confirmed anything.
      for (const isle of sim.islands) this.sync.record(isle.id, isle.keys());
      return this.sync.hashes();
    });
```

- [ ] **Step 3: Make a mismatch impossible to miss**

The server already logs `[DESYNC] room=… side=… island=… server=… client=…` at `console.error` and sends a `DESYNC` message back (Task 3). Add the client half. In **both** `mario-side.js` and `pilot-side.js` the `'desync'` listener already exists from Task 5; replace its body with:

```js
    this.session.on('desync', (m) => {
      this.desyncs.push({ ...m, at: this.tickCount() });
      // Loud, and once per island rather than once per second: a desync is
      // permanent by construction — the sets do not repair themselves — so a
      // per-second repeat would bury everything else in the console.
      if (this.desyncs.filter((d) => d.island === m.island).length === 1) {
        console.error(
          `[DESYNC] island ${m.island}: server ${m.server}, this client ${m.client}. ` +
            `The two destroyed-tile sets have diverged and will not recover.`
        );
        banner(document, `DESYNC ON ${m.island} — SEE CONSOLE`);
      }
    });
```

Add the trivial `tickCount()` to each class — `MarioNet` returns `this.tick`, `PilotNet` returns `pilot.sim.tick` — because the two sides count ticks in different places and the desync record should say when it happened in each side's own terms.

Expose the reader on both APIs, next to the existing `desyncs`:

```js
  hashes: () => net.sync.hashes(),
```

- [ ] **Step 4: Write the tier-2 desync test**

Create `tests/net/desync.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MSG } from '../../src/net/protocol.js';
import { hashKeys } from '../../src/wings/damage.js';
import { startTestServer, pair } from './helpers.mjs';

test('the desync detector', { timeout: 30000 }, async (t) => {
  const server = await startTestServer({ captureLogs: true });
  t.after(() => server.close());
  const { port } = server;

  await t.test('an agreeing hash gets no reply at all', async () => {
    const { mario, pilot } = await pair(port, 'ACDE');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['5,10', '6,10'] } });
    await mario.ofType(MSG.DAMAGE);
    mario.send({ t: MSG.HASH, tick: 60, h: { '1-1': hashKeys(['6,10', '5,10']) } });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(mario.inbox.some((m) => m.t === MSG.DESYNC), false);
    await mario.close();
    await pilot.close();
  });

  await t.test('a disagreeing hash comes back named, with both values', async () => {
    const { mario, pilot } = await pair(port, 'FGHJ');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['5,10', '6,10'] } });
    await mario.ofType(MSG.DAMAGE);
    mario.send({ t: MSG.HASH, tick: 60, h: { '1-1': hashKeys(['5,10']) } });
    const d = await mario.ofType(MSG.DESYNC);
    assert.equal(d.island, '1-1');
    assert.equal(d.server, hashKeys(['5,10', '6,10']));
    assert.equal(d.client, hashKeys(['5,10']));
    await mario.close();
    await pilot.close();
  });

  await t.test('the server logs it loudly', async () => {
    const shouted = server.logs.filter(([level, line]) => level === 'error' && line.includes('[DESYNC]'));
    assert.ok(shouted.length > 0, 'a desync must be impossible to miss in the server log');
    assert.match(shouted[0][1], /room=FGHJ/);
    assert.match(shouted[0][1], /island=1-1/);
  });

  await t.test('a client claiming damage on an island the server never touched is caught', async () => {
    const { mario, pilot } = await pair(port, 'KMNP');
    mario.send({ t: MSG.HASH, tick: 60, h: { '4-2': hashKeys(['1,1']) } });
    const d = await mario.ofType(MSG.DESYNC);
    assert.equal(d.island, '4-2');
    assert.equal(d.server, hashKeys([]));
    await mario.close();
    await pilot.close();
  });

  await t.test('the out-of-bounds case decision D1 exists for', async () => {
    // A key no client can place on its own map must STILL be hashed, or the
    // client that could not place it reports desync forever. This is exactly
    // what world.applyDamage now guarantees.
    const { mario, pilot } = await pair(port, 'QRTU');
    pilot.send({ t: MSG.EV, seq: 1, type: 'detonate', d: { island: '1-1', keys: ['5,10', '99999,99999'] } });
    const dmg = await mario.ofType(MSG.DAMAGE);
    assert.deepEqual(dmg.keys.sort(), ['5,10', '99999,99999']);
    mario.send({ t: MSG.HASH, tick: 60, h: { '1-1': hashKeys(['5,10', '99999,99999']) } });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(mario.inbox.some((m) => m.t === MSG.DESYNC), false, 'the wide key must be in both sets');
    await mario.close();
    await pilot.close();
  });
});
```

- [ ] **Step 5: Add the tier-4 subtest**

Append to `tests/browser/netplay.test.mjs`, before the `no uncaught page errors` subtest:

```js
  await t.test('both clients hash identically after a real bombing run', async () => {
    const [mh, ph] = await Promise.all([
      mario.page.evaluate(() => window.__NET.hashes()),
      pilot.page.evaluate(() => window.__WINGS.net.hashes()),
    ]);
    assert.deepEqual(mh, ph, 'the two clients hash different destroyed-tile sets');
    assert.ok(Object.keys(mh).length > 0, 'nothing was bombed, so this proves nothing');
  });

  await t.test('the detector fires when the sets are forced apart', async () => {
    // Deliberately corrupt one client's replica and prove the machinery
    // notices. This is the only place in the suite that manufactures a
    // desync; everywhere else asserts their absence, which is only
    // meaningful if the detector can fail.
    await mario.page.evaluate(() => {
      window.__NET.session.sendHash(999999, { '1-1': 'ffffffff' });
    });
    await mario.page.waitForFunction(() => window.__NET.desyncs().length > 0, null, { timeout: 10000 });
    const d = await mario.page.evaluate(() => window.__NET.desyncs());
    assert.equal(d[0].island, '1-1');
    assert.equal(d[0].client, 'ffffffff');
    assert.notEqual(d[0].server, 'ffffffff');
    // And the server shouted about it.
    assert.ok(
      ctx.server.serverErrors.some((l) => l.includes('[DESYNC]')),
      'the server must log a desync loudly'
    );
  });
```

This subtest deliberately pollutes `ctx.mario.errors` with the client's own `console.error`. Adjust the final `no uncaught page errors` subtest to ignore that one line and nothing else:

```js
  await t.test('no uncaught page errors on either side', () => {
    const real = (errs) => errs.filter((e) => !e.includes('[DESYNC]'));
    assert.deepEqual(real(ctx.mario.errors), []);
    assert.deepEqual(real(ctx.pilot.errors), []);
  });
```

- [ ] **Step 6: Run everything**

Run: `npm test`
Expected: green. 5 new tier-2 subtests, 2 new tier-4 subtests, 1 new unit test.

- [ ] **Step 7: Commit**

```bash
git add src/net/session.js src/net/mario-side.js src/net/pilot-side.js \
        tests/unit/session.test.js tests/net/desync.test.mjs tests/browser/netplay.test.mjs
git commit -m "Continuous desync detection, active in real play

Each client hashes its replica of the destroyed-tile set every second; the
server compares and shouts. Logged once per island, not once per second — a
desync is permanent by construction and a repeat would bury everything else."
```

---

## Task 9: The tier-4 integration test

The prize the spec asks for in §8.3: **pilot bombs island 3 while Mario is on island 1, Mario ferries over, both destroyed-sets are byte-identical** — and the whole thing again under 150ms latency and 5% packet loss.

**Files:**
- Create: `tests/browser/netplay-latency.test.mjs`
- Modify: `tests/browser/helpers.mjs`
- Modify: `src/wings/sim.js` (ours — a four-island default)

**Note on the archipelago.** `ISLAND_LEVELS` is currently `['1-1', '2-1']` — two islands, which Plan 2 chose deliberately as "somewhere for the mechanics to happen". Spec §2.1 wants four per archipelago. This task raises it to `['1-1', '1-2', '1-3', '1-4']`, which is both what the spec asks for and what makes "bomb island 3 while Mario is on island 1" a real test rather than a two-island approximation. The seeded, eight-archipelago chain remains a later plan.

**Interfaces:**
- Produces: `bootRoom(opts)` gains `opts.latency`, `opts.loss` and `opts.islands`.

- [ ] **Step 1: Widen the archipelago to four islands**

In `src/wings/sim.js`:

```js
// One archipelago is one SMB world: four islands (spec 2.1). The seeded chain
// of eight archipelagos is a later plan; this is world 1.
export const ISLAND_LEVELS = ['1-1', '1-2', '1-3', '1-4'];
```

Run: `npm run test:unit`
Expected: PASS. If any Plan 2 test asserted `sim.islands.length === 2` or indexed `sim.islands[1]` expecting `2-1`, update that test to use `sim.islandById('1-1')` rather than a positional index — the ids are the contract, the order is not.

Run: `npm run test:browser`
Expected: PASS. `1-2`, `1-3` and `1-4` must all exist in `src/data/levels/`; verify before assuming:

Run: `node -e "import('./src/data/levels/index.js').then(m => console.log(['1-1','1-2','1-3','1-4'].map(id => id + ':' + (m.hasLevel(id) ? m.getLevel(id).width : 'MISSING')).join(' ')))"`
Expected: four ids, each with a tile width. If any is missing, substitute the nearest existing level id **in every place this task names it** and note the substitution in the commit message.

- [ ] **Step 2: Let `bootRoom` inject faults**

In `tests/browser/helpers.mjs`, extend `bootRoom` so faults are applied after both clients are connected, before the caller gets the context:

```js
    if (opts.latency || opts.loss) {
      // Injected on the CLIENT transports, not on the server, so both
      // directions of both sockets are affected and the server stays a plain,
      // fast relay — the fault under test is the network, not the server.
      await mario.page.evaluate(
        ({ latency, loss }) => {
          if (latency) window.__NET.latency(latency);
          if (loss) window.__NET.drop(loss);
        },
        { latency: opts.latency || 0, loss: opts.loss || 0 }
      );
      await pilot.page.evaluate(
        ({ latency, loss }) => {
          if (latency) window.__WINGS.net.latency(latency);
          if (loss) window.__WINGS.net.drop(loss);
        },
        { latency: opts.latency || 0, loss: opts.loss || 0 }
      );
    }
```

- [ ] **Step 3: Write the integration test**

Create `tests/browser/netplay-latency.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootRoom, shutdownRoom } from './helpers.mjs';

// The spec's tier-4 scenario, run three times: clean, then under 150ms of
// latency, then under latency AND 5% packet loss. The body is identical each
// time — if the netcode is right, the faults change only how long it takes.
const RUNS = [
  { name: 'clean', latency: 0, loss: 0, room: 'ACDE' },
  { name: 'under 150ms latency', latency: 150, loss: 0, room: 'FGHJ' },
  { name: 'under 150ms latency and 5% packet loss', latency: 150, loss: 5, room: 'KMNP' },
];

for (const run of RUNS) {
  test(`tier 4: bomb island 3 while Mario is on island 1 — ${run.name}`, { timeout: 240000 }, async (t) => {
    const ctx = await bootRoom(run);
    t.after(() => shutdownRoom(ctx));
    const { mario, pilot } = ctx;

    // Mario is on island 1 and stays there for the whole bombing run.
    await mario.page.evaluate(async () => {
      await window.__GAME.loadLevel('1-1');
      window.__GAME.teleport(6, 11);
      window.__GAME.tick(30);
    });
    await mario.page.waitForTimeout(400);
    assert.equal(await mario.page.evaluate(() => window.__GAME.stats().level), '1-1');

    // The pilot craters island 3 — an island nobody is standing on, which per
    // spec 4.3 is not simulated anywhere and costs a key list and nothing else.
    const bombed = await pilot.page.evaluate(() => {
      const isle = window.__WINGS.sim.islandById('1-3');
      const out = [];
      for (const tx of [18, 20, 22]) {
        const cx = isle.originX + tx * 16 + 8;
        const cy = isle.y0 + 13 * 16 + 8;
        const keys = isle.blast(cx, cy, 2);
        window.__WINGS.sim.emit('detonation', {
          kind: 'bomb', x: cx, y: cy, radius: 2, water: false, island: '1-3', keys,
        });
        out.push(...keys);
      }
      window.__WINGS.net.pump();
      return out;
    });
    assert.ok(bombed.length > 0, 'the pilot destroyed nothing on island 1-3');

    // Under loss, the detonate events need their resends. Pump both sides.
    await mario.page.evaluate(() => {
      for (let i = 0; i < 400; i++) window.__NET.pump();
    });
    await pilot.page.evaluate(() => {
      for (let i = 0; i < 400; i++) window.__WINGS.net.pump();
    });

    await mario.page.waitForFunction(
      (n) => {
        const s = window.__NET.state();
        return s && window.__NET.hashes()['1-3'] != null;
      },
      bombed.length,
      { timeout: 60000 }
    );

    await t.test('both destroyed-sets are byte-identical', async () => {
      const [m, p] = await Promise.all([
        mario.page.evaluate(() => window.__NET.session && JSON.parse(JSON.stringify(window.__NET.hashes()))),
        pilot.page.evaluate(() => JSON.parse(JSON.stringify(window.__WINGS.net.hashes()))),
      ]);
      assert.deepEqual(m, p, 'the two clients hash different sets');
    });

    await t.test('Mario arrives on the bombed island and finds the crater', async () => {
      // The ferry is a later plan; arriving means loading the island with its
      // destroyed-set subtracted, which is exactly what reloadIsland does and
      // exactly what the ferry will call when it exists.
      const solid = await mario.page.evaluate(async () => {
        await window.__NET.reloadIsland('1-3');
        return window.__GAME.world.tileAt(20, 13).solid;
      });
      assert.ok(!solid, 'Mario arrived at island 1-3 and the ground was still there');
    });

    await t.test("Mario's local damage matches what the pilot destroyed", async () => {
      const [local, remote] = await Promise.all([
        mario.page.evaluate(() => window.__GAME.damageKeys()),
        pilot.page.evaluate(() => window.__WINGS.sim.islandById('1-3').keys()),
      ]);
      assert.deepEqual(local, remote);
    });

    await t.test('Mario falls into the crater and the death reaches the pilot', async () => {
      await mario.page.evaluate(() => {
        window.__GAME.teleport(20, 11);
        window.__GAME.tick(180);
      });
      const dead = await mario.page.evaluate(() => {
        const p = window.__GAME.world.player;
        return p.state === 'dying' || p.dead || p.y > window.__GAME.world.h * 16;
      });
      assert.ok(dead, 'Mario stood on thin air');

      await mario.page.evaluate(() => {
        for (let i = 0; i < 600; i++) window.__NET.pump();
      });
      await pilot.page.waitForFunction(
        () => window.__WINGS.net.state().marioLives != null,
        null,
        { timeout: 60000 }
      );
    });

    await t.test('no desync was reported by either side', async () => {
      const [m, p] = await Promise.all([
        mario.page.evaluate(() => window.__NET.desyncs()),
        pilot.page.evaluate(() => window.__WINGS.net.desyncs()),
      ]);
      assert.deepEqual(m, [], `Mario reported ${m.length} desyncs`);
      assert.deepEqual(p, [], `the pilot reported ${p.length} desyncs`);
      assert.deepEqual(
        ctx.server.serverErrors.filter((l) => l.includes('[DESYNC]')),
        [],
        'the server saw a desync neither client noticed'
      );
    });

    await t.test('no uncaught page errors', () => {
      assert.deepEqual(ctx.mario.errors, []);
      assert.deepEqual(ctx.pilot.errors, []);
    });
  });
}
```

- [ ] **Step 4: Run it, three times over**

Run: `npm run test:browser`
Expected: PASS — three top-level tests, six subtests each.

This is the slowest thing in the suite by a wide margin. If the lossy run flakes, the fix is **never** to raise the loss threshold or loosen an assertion: it is either more `pump()` iterations (the resend budget is in ticks and a lossy run genuinely needs more of them) or a real bug in the reliable layer. A tier-4 test that passes by being asked less is worth nothing.

- [ ] **Step 5: Fly the sortie for real**

The hand-emitted detonations in Step 3 prove the *plumbing*. Now prove it against a bot that actually flies there and drops a bomb, which is what spec §8.3 tier 4 asks for. Replace the `bombed` block in Step 3 with:

```js
    // A real sortie: roll down the deck, fly to island 1-3, put a bomb on
    // tile 20,13. bot.js is deterministic — no clock, no RNG — so this
    // replays with identical tick counts and identical crater keys, which is
    // what makes the latency and loss runs comparable to the clean one.
    const bombed = await pilot.page.evaluate(() => {
      const isle = () => window.__WINGS.sim.islandById('1-3');
      const before = isle().keys().length;
      const flew = window.__WINGS.takeoff(600);
      const hit = window.__WINGS.bombTile('1-3', 20, 13, 8000);
      window.__WINGS.net.pump();
      return { flew, hit, grew: isle().keys().length > before, keys: isle().keys() };
    });
    assert.ok(bombed.flew, 'the bot never got off the deck');
    assert.ok(bombed.hit, 'bombTile ran out of budget before it hit 20,13 of 1-3');
    assert.ok(bombed.grew, 'the bot flew a sortie and cratered nothing');
```

and use `bombed.keys` wherever the flat array was used before. Everything else in the file is unchanged.

Two things this now also covers for free, and both are worth asserting once, in the clean run only:

```js
    await t.test('the sortie is deterministic under injected faults', async () => {
      // Latency and packet loss are TRANSPORT concerns. If either changed the
      // sortie's tick count, something in the simulation is reading the
      // network — which is the determinism rule being violated, not a flaky
      // test. The milestone is bot.js's own verified figure.
      const tick = await pilot.page.evaluate(() => window.__WINGS.state().tick);
      assert.ok(tick > 1300, `sortie ended at tick ${tick}; expected the bomb away by ~1246`);
    });
```

Record the observed tick in the commit message for each of the three runs. **They should be identical across all three.** If they are not, stop and find out why before touching anything else in this plan: a simulation whose timing moves when the network lags is a determinism bug that will make every later soak test meaningless.

Finish the sortie with `window.__WINGS.land(8000)` — **`land`, not `autoLand`**; `autoLand` is the module export's name and `land` is what `__WINGS` exposes — if you want the run to end on the deck rather than mid-air.

- [ ] **Step 6: Commit**

```bash
git add tests/browser/netplay-latency.test.mjs tests/browser/helpers.mjs src/wings/sim.js
git commit -m "Tier 4: bomb island 3 while Mario is on island 1, three times over

Clean, at 150ms, and at 150ms with 5% loss. The archipelago is four islands
now, per spec 2.1, which is what makes the scenario real rather than a
two-island approximation."
```

---

## Task 10: Deployment

Replace the nginx-only image with a Node image serving both the static assets and the WebSocket endpoint, on the **existing** fly.io configuration. Built and verified locally.

**`fly deploy` is not run by this task, or by anybody executing this plan.** It requires explicit user approval every time. Do not run it, do not suggest running it as part of "finishing", and do not add it to a script.

**Files:**
- Modify: `Dockerfile`
- Modify: `.dockerignore`
- Modify: `fly.toml`
- Delete: `deploy/nginx.conf`
- Modify: `README.md`

- [ ] **Step 1: Write the Dockerfile**

Replace `Dockerfile` entirely:

```dockerfile
# The game is plain ES modules with no build step, but it is no longer only
# static files: the same process serves the assets and hosts the WebSocket
# rooms, so one origin covers both and there is no CORS or cross-origin
# WebSocket configuration anywhere. MIME types are explicit in
# server/static.js for the reason the nginx config gave: a module served as
# text/plain is refused by the browser and the whole game silently fails to
# boot.
FROM node:22-alpine

WORKDIR /app

# Dependencies first so a source-only change does not reinstall them.
# `--omit=dev` drops playwright, which is 400MB of browser nobody needs in
# production.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Only what the server actually serves. tests/, tools/ and shots/ are excluded
# by .dockerignore as well, but naming the copies keeps the image honest about
# its contents.
COPY server ./server
COPY src ./src
COPY index.html pilot.html ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "server/index.js"]
```

- [ ] **Step 2: Update `.dockerignore`**

Ensure it excludes at least these, adding any that are missing:

```
node_modules
.git
tests
tools
shots
docs
.superpowers
*.md
```

`MODS.md`, `ARCHITECTURE.md` and `README.md` are excluded by `*.md`; that is intended, they are development documents.

- [ ] **Step 3: Check `fly.toml` needs nothing**

`fly.toml` already sets `internal_port = 8080`, `force_https = true` and a `/healthz` check, and `server/index.js` answers `/healthz` with `ok` (Task 3). Fly's HTTP service proxies WebSocket upgrades on the same port with no extra configuration.

One change is required: `auto_stop_machines = 'stop'` with `min_machines_running = 0` suspends the machine when idle, which **drops every open WebSocket and evaporates every live room**. Change:

```toml
  auto_stop_machines = 'suspend'
  min_machines_running = 1
```

`suspend` keeps the machine's memory, so rooms survive an idle period, and one machine always running means a player joining a code their friend read out five minutes ago still finds the room. This costs money and is the user's call — flag it and let them decide rather than assuming.

Verify nothing else references nginx:

Run: `grep -rn "nginx" fly.toml Dockerfile README.md deploy/ 2>/dev/null`
Expected: no hits outside `deploy/nginx.conf` itself.

- [ ] **Step 4: Delete the nginx config**

```bash
git rm deploy/nginx.conf
```

`deploy/` is then empty and git will drop it. If anything else lands in `deploy/` later that is fine; nothing references it now.

- [ ] **Step 5: Build and run the image locally**

```bash
docker build -t wings-of-mario .
docker run --rm -p 8091:8080 wings-of-mario
```

Port 8091, not 8090, so this does not collide with a `npm run serve` you left running.

In another terminal:

```bash
curl -s http://localhost:8091/healthz
curl -sI http://localhost:8091/src/net/protocol.js | grep -i content-type
curl -s -X POST http://localhost:8091/room
```

Expected: `ok`; `content-type: text/javascript; charset=utf-8`; and a JSON body with a four-character room code.

Then the real check — two clients in a room, against the image:

```bash
node -e "import('playwright').then(async ({chromium}) => {
  const b = await chromium.launch();
  const m = await (await b.newContext()).newPage();
  const p = await (await b.newContext()).newPage();
  const errs = []; m.on('pageerror', e => errs.push('mario: '+e.message));
  p.on('pageerror', e => errs.push('pilot: '+e.message));
  await m.goto('http://localhost:8091/?room=ACDE');
  await m.waitForFunction(() => window.__NET && window.__NET.state().connected, null, {timeout: 30000});
  await p.goto('http://localhost:8091/pilot.html?room=ACDE');
  await p.waitForFunction(() => window.__WINGS.net && window.__WINGS.net.state().connected, null, {timeout: 30000});
  console.log('mario:', await m.evaluate(() => window.__NET.state().side),
              'pilot:', await p.evaluate(() => window.__WINGS.net.state().side),
              'peer:', await m.evaluate(() => window.__NET.state().peer),
              'errors:', errs);
  await b.close();
})"
```

Expected: `mario: mario pilot: pilot peer: true errors: []`.

Stop the container.

- [ ] **Step 6: Update the README**

In `README.md`, wherever it describes running or deploying the game, replace the static-server description with:

```markdown
## Running

    npm run serve

Serves the game and the multiplayer rooms on <http://localhost:8090>. Mario is
at `/`, the pilot at `/pilot.html`. Open the pilot first: it mints a four-character
room code and puts it in the address bar. Give that code to the other player as
`/?room=CODE`. Add `?solo` to either page to play offline.

`npm start` still runs the old static-only server on port 8123 for single-page
work like `npm run shots`; it has no WebSocket endpoint, so multiplayer does
not work against it.

## Deploying

    fly deploy

**Never run without explicit approval.** The image is a Node process serving
both the static assets and the WebSocket endpoint on port 8080.
```

- [ ] **Step 7: Full suite, one more time**

Run: `npm test`
Expected: every tier green.

- [ ] **Step 8: Commit**

```bash
git add Dockerfile .dockerignore fly.toml README.md
git rm --cached deploy/nginx.conf 2>/dev/null || true
git commit -m "Deploy as a Node image: static assets and WebSocket rooms, one origin

Replaces the nginx-only image. fly.toml switches auto_stop to suspend with one
machine always running, because stopping the machine drops every open socket
and evaporates every live room. NOT deployed — fly deploy needs approval."
```

Then tell the user the image is built and verified locally, that `fly.toml` now asks for one always-running machine, and that deploying is theirs to authorise.

---

## Done when

- `npm test` is green from a clean checkout: tiers 1, 2, 3 and 4.
- Two browsers on `npm run serve`, one room code, both players see each other move, the pilot craters an island, Mario falls in, and neither console shows `[DESYNC]`.
- Killing the pilot's tab and reopening it with the same URL rejoins the **same** match with the craters still there.
- `MODS.md` lists exactly three modified engine files — `src/game/world.js`, `src/main.js`, `index.html` — and records the resolution of all three open decisions.
- `git diff upstream/main --stat -- src/game src/main.js index.html` is within about 20 lines of its 149-line pre-plan size.
- `grep -rn "setTimeout\|setInterval\|Date.now\|performance.now" src/net/` returns hits only in `src/net/transport.js`.
- `grep -c "^import" src/net/protocol.js` returns `0` and `grep -c "^import" src/wings/damage.js` returns `0` — the two files the server runs unchanged.
- `docker build` succeeds and two clients join a room against the image.

## Deliberately not in this plan

Each belongs elsewhere and must not be started here:

- **Telegraphing** — the falling whistle, the shadow marker, the screen-edge arrow (spec §4.2). Plan 4. The `bombRelease` event is carried and recorded now so the whistle has something to start on, and `predictImpact` already exists; nothing draws or plays anything yet.
- **Radar.** The pilot currently sees Mario only when Mario is inside his viewport, and off-camera sees nothing at all. That is deliberate: spec §3 says the pilot does not automatically know where Mario is, so a fuzzy long-range blip is a designed mechanic and not a rendering detail to be improvised here.
- **The ferry** (spec §6) and therefore `ferryBoard` / `ferrySunk` in anger. Both event types exist, are owned, and are carried; nothing emits them. Task 9's "Mario arrives at island 3" is a `reloadIsland` call, which is exactly what the ferry will call when it exists.
- **Torpedoes against the ferry.** `ORDNANCE.torpedo` carries no terrain damage and has nothing to sink yet.
- **Anti-aircraft fire and Mario fighting back** (spec §5). The ownership of "did Mario's fireball hit the plane?" is fixed in Task 7's table — the pilot's client decides — so that it cannot be relitigated when it is built.
- **The seeded, eight-archipelago chain.** Task 9 widens `ISLAND_LEVELS` to world 1's four islands, as spec §2.1 requires. The seed is minted by the server, carried in every `welcome`, and stored on both clients; **nothing reads it yet.** Whoever builds the seeded layout consumes `session.seed` and does not mint their own.
- **Tier-5 soak** (spec §8.3) and the softlock detector. `npm run soak` does not exist yet.
- **Anti-cheat.** Spec §11 puts it explicitly out of scope. The server validates message *shape* and event *ownership* and nothing else; a snapshot is never rejected for its contents, on purpose.
- **More than two players.** `Room` holds exactly two seats and refuses a third by design, not by accident.
- **`fly deploy`.** Task 10 builds and verifies the image. Deploying it is the user's call, every time.

