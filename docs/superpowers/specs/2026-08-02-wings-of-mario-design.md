# Wings of Mario — Design Spec

**Date:** 2026-08-02
**Status:** Approved for planning

A live two-player asymmetric mashup of *Wings of Fury* (Broderbund, 1987) and *Super Mario
Bros.* (Nintendo, 1985). One player flies a carrier-based fighter-bomber. The other plays
Mario. The pilot hunts Mario across an archipelago and blows the levels apart beneath him.

---

## 1. Premise

Mario is trying to beat Super Mario Bros. — eight worlds, four levels each, his normal stock
of lives. The levels are islands in an ocean. Mario travels between them by ferry.

The pilot flies sorties from an aircraft carrier. He does not automatically know where Mario
is; a radar gives a fuzzy blip and he must fly out, find him, and attack. His bombs
permanently destroy level geometry, so he can also fly ahead and ruin an island Mario has not
reached yet. He carries a finite load, burns fuel, and must return to the carrier to land,
refuel and rearm. He can die.

**Pilot wins** when Mario runs out of lives — no continues. **Mario wins** by clearing world
8-4, or by destroying the pilot's entire squadron (§3.4).

---

## 2. World model

### 2.1 Archipelago = one SMB world

The ocean holds **one four-island archipelago at a time**, corresponding to one SMB world.
World 1 is islands 1-1, 1-2, 1-3, 1-4 plus the carrier. When Mario clears 1-4, the carrier
group sails and a fresh archipelago is laid out for World 2. Eight archipelagos = the whole
game.

Rationale: all 32 levels already exist upstream, so content is cheap, but 32 islands in a
single ocean would make flight times absurd and pre-bombing meaningless. Four islands keeps
the hunt tense and the pre-bombing window real.

### 2.2 Coordinate space

One continuous 2D space shared by both players. NES pixels, origin top-left, +X right,
+Y **down** — matching the upstream engine contract exactly.

```
 y=0    ─── altitude ceiling ──────────────────────────────────
                        ✈
 y=320  ─── island tops ──────────────────────────────────────
        [CARRIER]      [1-1]        [1-2]      [1-3]   [1-4]
 y=560  ~~~~~~~~~~~ sea level ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        x=0           x≈3000       x≈8000      ...
```

Each island is an unmodified upstream SMB level placed as a 240px-tall band (15 tiles × 16px)
whose bottom row sits at sea level. Islands are separated by open ocean. Exact spacing and
sky height are tuning constants, not contract.

Consequences that fall out for free:

- **Mario's pits become the sea.** Falling off a level is a splash.
- **Water levels (x-2, x-3)** read as submerged reefs.
- **Castle levels (x-4)** read as fortress islands.
- Both players occupy literally the same space at the same 1:1 pixel scale.

### 2.3 Cameras

Two viewports on one world, each client rendering only its own.

| Player | Viewport | Behaviour |
|---|---|---|
| Mario | 256×240 (stock) | Unchanged upstream camera |
| Pilot | ~512×240, 1:1 pixels | Scrolls horizontally and vertically, Wings-of-Fury style |

No zooming. The pilot's long-range picture comes from radar, not from a scaled-down view.
This preserves one art scale, one renderer, and the existing WebGL post/CRT chain.

---

## 3. The pilot

Faithful to the 1987 original wherever there is a choice:

- **Takeoff** is a roll down the carrier deck, building speed until lift.
- **Turning is a loop**, not an instant sprite flip. Immelmann up, split-S down.
- **Altitude ceiling** caps the climb.
- **Landing** requires approaching the deck low and slow with the tailhook down. Wrong speed
  or angle is a crash.
- **Gauges** for fuel and each ordnance type.

### 3.1 Loadout

Full Wings of Fury arsenal, chosen on the carrier before each sortie:

| Weapon | Role |
|---|---|
| Machine gun | Strafing Mario and enemies. No terrain damage. Large but finite ammo. |
| Bombs | The primary terrain weapon. Ballistic arc, inherits plane velocity. Craters. |
| Rockets | Fast, flat trajectory, large crater, very few carried. The precision option. |
| Torpedoes | Sea targets only — sinks Mario's ferry mid-crossing. |

### 3.2 The sortie loop

`takeoff → hunt via radar → attack → fuel/ordnance runs low → return → land → rearm → repeat`

Running dry or crashing costs a plane from the squadron.

### 3.3 Ways to die

1. Hitting the sea or terrain.
2. Botched carrier landing.
3. Own blast radius when bombing too low.
4. Anti-aircraft fire (§5).
5. Mario fighting back (§5).

### 3.4 Squadron

The pilot flies from a **finite squadron**. Each death costs one plane; the next sortie starts
on the deck with a fresh aircraft. Losing the last plane ends the match in Mario's favour.

Squadron size is a balance constant, sized so that the pilot is punished for reckless low
passes without the match ending on a single mistake. Starting value: 5 per archipelago,
replenished when the carrier group sails to the next world.

---

## 4. Destruction

### 4.1 Model

A detonation converts **every tile within its blast radius to air**. Ground, brick, question
blocks, pipes, staircases, castle stone, the flagpole base — no material is immune. No
tiering, no hit points, no regeneration. **Craters are permanent for the match.**

```
before:  ###########        blast r = 3 tiles
         ###########   →    ####...####
         ###########        #####.#####   ← permanent
```

**Accepted consequence:** the pilot can carve a gap Mario cannot cross, stranding him until he
runs out of lives. This is a legitimate win path, not a bug. There is no rescue system, no
terrain regeneration, and no bedrock floor.

### 4.2 Telegraphing is a core system

Because the crater is permanent and unrecoverable, Mario's entire counterplay is *not being
there*. Telegraphing is therefore first-class, not polish. Three layers, all on Mario's screen
only:

1. **Falling whistle** — a descending pitch sweep beginning at bomb release, panned by the
   bomb's x-offset from Mario. Audible before anything is visible.
2. **Shadow marker** — a shrinking reticle drawn on the ground at the bomb's *predicted*
   impact tile, computed from its ballistic arc, tightening as the bomb closes.
3. **Edge indicator** — a screen-edge arrow when a bomb is inbound from off-camera.

The pilot receives none of these. Leading the target by eye is the Wings of Fury skill.

### 4.3 Damage state

The entire authoritative shared state of the match is:

```js
destroyedTiles = { [islandId]: Set<"tx,ty"> }
```

Small enough to send in full on join, and as single-tile deltas thereafter.

**No inactive island is ever simulated.** An island Mario is not on is just a level definition
plus its destroyed-set. On arrival the engine loads the level and subtracts the set. This is
what makes "bomb island 4 while Mario is on island 1" nearly free.

---

## 5. Threats to the plane

Layered so the simplest lands first:

| Layer | Content |
|---|---|
| Terrain | Sea, island collision, own blast. |
| Repurposed enemies as AA | Bullet Bill cannons fire skyward, Piranha Plants spit up, Hammer Bros throw at altitude, Bowser breathes fire. The level defends itself. |
| Mario fights back | Fire-flower fireballs damage the plane; star or bounce-height Mario can strike it on a low pass. Rewards power-ups with real agency. |
| Naval flak | Neutral AA emplacements on some islands — obstacles both players must respect. |

---

## 6. The ocean

**Mario crosses between islands by ferry** — a short auto-scrolling boat ride he stands on
after clearing a level. This is his most vulnerable window: a torpedo sinks the boat.

The ferry is the answer to "how does Mario travel", "what are torpedoes for", and "when do
both players share a screen" in one mechanic.

---

## 7. Netcode

### 7.1 Split authority, thin server

Each client is the sole authority on what it controls, simulating it locally at full 60Hz with
zero input latency.

| Owner | Simulates |
|---|---|
| Mario client | Mario, his island's enemies/blocks/items, ferry rides |
| Pilot client | Plane, ordnance in flight, ocean, carrier, AA fire |
| Server | The destroyed-tile map, match bookkeeping. **No game simulation.** |

Optimised for feel over anti-cheat; this is a game friends play together.

### 7.2 Protocol

JSON over WebSocket, at two rates:

**20Hz state snapshots**, interpolated by the receiver, never rejected — you are the truth
about yourself.

```
mario → {island, x, y, vx, vy, anim, facing, power, lives}
pilot → {x, y, vx, vy, pitch, gear, ordnance[]}
```

**Reliable events**, sent once and acked:
`bombRelease`, `detonate{island,tx,ty,radius}`, `marioDeath`, `islandCleared`, `ferryBoard`,
`ferrySunk`, `sortieStart`, `landed`, `planeLost`, `worldCleared`.

### 7.3 Hit resolution follows ownership

This rule eliminates every "I dodged that!" argument:

- **Bomb hits Mario?** Mario's client decides, using the bomb's interpolated position. His
  screen, his hitbox.
- **Terrain destroyed?** The pilot's client detonates and emits `detonate`. The server records
  it into the destroyed-set and broadcasts. Both clients apply identical coordinates, so
  craters cannot diverge.
- **Mario's fireball hits the plane?** The pilot's client decides.

### 7.4 Server

A small Node process in `server/` serving the static game files and hosting WebSocket rooms.

- Room = a 4-character join code. First player picks Mario or Pilot; second gets the other.
- Holds match state (archipelago seed, destroyed tiles, lives, squadron, scores) so a
  disconnect **reconnects into the same match** rather than losing it.
- No game logic. No npm dependencies in client code — the upstream no-build-step,
  vanilla-ES-modules rule holds throughout `src/`.

---

## 8. Automated verification

**Hard requirement: every layer is drivable by a script. Nothing is verified by a human
looking at it.**

### 8.1 Determinism

The engine already runs a fixed 60.0988Hz timestep and has a seeded RNG module. That
discipline extends to everything new: archipelago layout, ferry timing, and AA behaviour all
draw from a seed carried in match state. Same seed + same input tape = same match. Reading
wall-clock time or unseeded randomness in simulation code is a bug.

### 8.2 Scripted control API

Mirrors the existing `window.__GAME` debug API, which must not be removed.

```js
window.__WINGS = {
  hold({pitch, throttle, drop, fire, gear}),   // persists across ticks
  release(),
  tick(n),                                      // advance n fixed steps, ignore rAF
  flyTo(x, y), bombTile(island, tx, ty),        // high-level bot primitives
  state(),                                      // {x,y,fuel,ordnance,plane,island}
  net: { latency(ms), drop(pct), disconnect() } // fault injection
};
```

### 8.3 Test tiers

| Tier | Scope | Runtime | Runs |
|---|---|---|---|
| 1. Pure logic | Ballistic arc → impact tile; blast radius → tile set; radar world-x → blip; damage-set merge. Plain Node, no canvas. | ms | every save |
| 2. Protocol | Room join/assign/reconnect, event ordering, ack/retry, rejecting a `detonate` from a non-owner. Two fake Node WS clients. | <1s | every save |
| 3. Single-client browser | Playwright, one page. Drive `__WINGS`; assert crater lands in the tile map, telegraph reticle renders *before* impact, carrier landing succeeds inside the legal envelope and fails outside it. | seconds | pre-commit |
| 4. Two-client integration | Playwright, two contexts, one room. Pilot bot bombs island 3 while Mario bot is on island 1; Mario ferries over; assert both destroyed-sets are identical, Mario falls in, death propagates. Repeated under 150ms injected latency and 5% packet loss. | ~1 min | pre-commit |
| 5. Full-match soak | Competent Mario bot vs harassing pilot bot playing an entire 4-island world. Asserts no exception, no desync, and flags any state where Mario is alive with no legal move for 60s. | minutes | nightly |

The tier-5 softlock detector **reports**, it does not prevent — a stranded Mario is a valid
pilot win. Its job is to tell us when and why one happened.

`npm test` runs tiers 1–4. `npm run soak` runs tier 5.

### 8.4 Continuous desync detection

Not a test-only mechanism. Each client hashes its destroyed-tile set every second and sends
the hash; the server compares and logs loudly on mismatch. Active in real play.

### 8.5 Visual verification

Extend the upstream `tools/shot.mjs` scene-screenshot harness with plane, carrier, ocean, and
crater scenes. Art regressions are caught by diffing golden images.

---

## 9. Repository strategy

`mario-game` continues to develop independently. `wings-of-mario` must be able to pull the
latest engine and re-apply its own changes.

**Mechanism: fork with an upstream remote.**

```
origin    git@github.com:oliban/wings-of-mario.git
upstream  git@github.com:oliban/mario-game.git

git fetch upstream && git merge upstream/main
```

Git's 3-way merge re-applies our work automatically; conflicts appear only in files we
actually touched.

**The discipline that makes this cheap:** engine edits are confined to declared hook points
and every one is recorded in `MODS.md` with what changed and why. New code lives outside the
engine tree wherever possible.

Expected engine touch points:

| File | Change |
|---|---|
| `src/game/world.js` | Damage overlay consulted in `tileAt()`; `destroyTiles(coords)` entry point |
| `src/game/entity.js` | Entities handle ground vanishing beneath them |
| `src/main.js` | Multiplayer seam alongside the existing `window.__GAME` |

Proposed layout:

```
wings-of-mario/
  src/            ← forked engine, edits confined to hook points
  src/wings/      ← plane, carrier, ocean, ordnance, radar
  src/net/        ← client transport, interpolation, prediction
  server/         ← Node static + WebSocket rooms
  tests/          ← tiers 1–5
  MODS.md         ← every engine touch, and why
```

---

## 10. Deployment

Replaces the upstream nginx-only Docker image with a Node image serving both static assets and
the WebSocket endpoint, on the existing fly.io configuration.

`fly deploy` is never run without explicit approval.

---

## 11. Explicitly out of scope

- Anti-cheat and competitive integrity.
- More than two players.
- Mobile or touch controls.
- Any use of Nintendo ROM art or audio. All assets authored in-repo as code, per the upstream
  architecture contract.
- Terrain regeneration, rescue mechanics, or any softlock prevention system.
