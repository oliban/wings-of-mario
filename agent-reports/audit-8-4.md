# 8-4 audit — Bowser missing, and the maze

Files touched: `tools/smb-decode.mjs`, `tools/smb-gen-world8.mjs`,
`src/data/levels/8-4.js` (regenerated, not hand-edited).

## 1. Why Bowser was missing (root cause, measured)

Bowser was NOT missing from the data and NOT failing to construct. Probe on a
freshly loaded 8-4, before any change:

```
kinds: { Goomba:3, Platform:1, Buzzy:2, Koopa:4, HammerBro:1, Podoboo:1,
         Bowser:1, Frenzy:2, Piranha:15 }
declaredBowser: ["bowser@279"]
```

He was constructed, alive, active — and standing on nothing. The level put him at
column 279, and columns 277-281 are lava (`LLLLL`, rows 13-14). Driving the game:

```
teleport(283.5, 9)   // the water-pipe arrival point the old level used
t=30    bowser x=277.8  y=12.4  vy=3
t=180   bowser x=278.4  y=40.5
t=240   bowser x=279.8  y=51.8   (the level is 15 rows tall)
```

He fell straight through the lava and out of the bottom of the world, forever, and
was never culled. He was also *behind* the player: the water pipe dropped you at
column 283.5, four columns past him, so he was off the left edge of the camera from
the first frame. No page error, no swallowed throw.

### Where the 279 came from — a bug in `tools/smb-decode.mjs`

`decodeEnemies()` mishandled row-`$0e` records (the 3-byte "area pointer + entrance
page" records). The ROM's parser (`reference/smbdis.asm:7905-7940`,
`CheckRightBounds` → `CheckPageCtrlRow`) applies the second byte's **MSB page
advance to every record, including row-`$0e`**, before it ever looks at the row.
The decoder's `if (row === 0x0e) { i += 3; continue; }` sat *above* the `b1 & 0x80`
page bump, so a row-`$0e` record whose second byte had bit 7 set never advanced the
page. CastleArea6 has two of them (`b1 = 0xe5`). Every enemy after the first landed
16 columns early, and after both, 32 early.

| enemy | old decode | ROM-correct |
|---|---|---|
| hammerbro | 257 | 273 |
| podoboo | 263 | 279 |
| bowserflame | 277 | 293 |
| **bowser** | **279** | **295** |
| toad / princess | 297 | 313 |

295 is exactly `CastleBridge.x + 7` — the same offset Bowser has in 1-4 (bridge 128,
bowser 135), 4-4 (160/167) and 6-4 (128/135). 279 is over the lava; 295 is on the
bridge.

The fix restructures the walk to the ROM's order (MSB bump → row-$0f page select →
position → row dispatch) and adds an exported `decodePointers()` so generators can
read the pipe-destination records instead of hardcoding them.

### Blast radius of the decoder fix — NEEDS A DECISION FROM THE LEAD

Areas whose decoded enemy positions change: GroundArea3 (**4-1**), GroundArea4
(**6-2**), GroundArea6 (**1-1**), GroundArea8 (**2-3**, **7-3**), UndergroundArea1
(**1-2**), CastleArea6 (**8-4**).

Independent corroboration that the new numbers are the right ones: 1-1's first
goomba moves 6 → 22 (at 6 it is inside the spawn area — `smb-build.mjs:457` was
silently dropping every enemy at x<8, which is why nobody noticed), and 1-2's first
enemies move 31 → 47.

**I regenerated world 8 only.** Worlds 1/2/4/6/7 are other agents' territory right
now; their level files still carry the old numbers and will shift when someone
re-runs those generators.

## 2. The rest of 8-4

### 2a. Every pipe destination was guessed; now it is read

The old generator carried a hand-written `FORWARD = { 51: 112, 152: 192 }` derived
from the same mis-decoded record columns. With the records at their true columns the
routing is different, and it now comes straight out of the data. A record is read
when the screen's right edge reaches it — about nine columns ahead of the player —
and one sits a few columns past each warp pipe, so the record governing a pipe is
the last one at or before `pipe + 9`:

| pipe | record | destination |
|---|---|---|
| 51 | 56 | 8-4 page 1 → column 16 (back to the start — a trap) |
| **81** | **83** | **8-4 page 7 → column 112 (forward, room 2)** |
| 132 | 133 | column 16 |
| **152** | **159** | **8-4 page 12 → column 192 (forward, room 3)** |
| 212 | 212 | column 16 |
| **228** | **228** | **WaterArea3 (forward, the swim)** |
| 266 | 271 | column 16 |

The old file had pipe **51** as the room-1 exit. It is a trap; **81** is the exit.

### 2b. The water section came out in the wrong place

WaterArea3 carries exactly one row-`$0e` record: back to 8-4 at **entrance page 16 =
column 256**. The old generator hardcoded `x: 283.5` — past the last lava, past
Bowser, on the wrong side of the fight. Now it is 256, at the head of the final
corridor, with the hammer bro, the podoboo, the last lava and the bridge still
ahead. It also lands east of the third loop trigger, so it does not re-loop.

### 2c. The two ad-hoc "dead end" warps replaced by the real loop commands

`LoopCmdWorldNumber`/`LoopCmdPageNumber`/`LoopCmdYPosition`
(`smbdis.asm:7787-7793`): world 8 has three loop commands, at pages 6, 11 and 16,
all with `LoopCmdYPosition = $f0`. No player can ever be at $f0, so the
"correct position" test can never pass and `ExecGameLoopback` always fires — which is
precisely what makes 8-4's rooms inescapable except through the right pipe. The
loopback sends the player back four pages. Modelled as three silent warps:

```
{ from: { x:  87, y:  9 }, dir: 'right', to: { x:  32.5 } }   // page 6  -> page 2
{ from: { x: 167, y: 12 }, dir: 'right', to: { x: 112.5 } }   // page 11 -> page 7
{ from: { x: 247, y:  9 }, dir: 'right', to: { x: 192.5 } }   // page 16 -> page 12
```

The trigger columns are the page boundaries minus nine: `ProcLoopCommand` fires on
`CurrentColumnPos == 0`, and `CurrentPageLoc` tracks the column being *rendered*,
which runs about nine columns ahead of the player. This engine has no rendering
pointer, so the trigger goes on the column the player actually stands on.

### 2d. Room 1 was impossible — the lift sat inside the lava (DEVIATION)

`reach.mjs 8-4` before the fix: **12 trap regions**, everything from column 0 to 65.
The pillar at 62-65 and the block at 75 are separated by nine columns of lava; the
only crossing is the horizontal lift the ROM puts at column 70. Its deck was one row
too low and standing on it was instant death — measured:

```
teleport onto the deck -> y 12.5, state DEAD, within 3 frames
```

The ROM puts the lift at `Enemy_Y = row * 16` = the top of the lava (`PosPlatform`
only ever adjusts X, `smbdis.asm:8988-8996`), but this engine draws a lift deck eight
pixels *below* its own row, so carrying the ROM's row through buries it. New local
pass `seatLavaLifts()` in the world-8 generator seats a lift whose sweep is over lava
one row higher, putting the deck on the lava surface. Marked DEVIATION in the source
with the reason.

The shared `smb-build.mjs` lift `y: e.y + 1` is the underlying cause and it is wrong
for lifts generally (it is right for ground enemies only because they fall). I did
**not** change it — 14 levels carry lifts and I cannot verify them all in this task.
See "remains".

## 3. What I verified, and how

All by driving the game, not by reading the file.

| claim | evidence |
|---|---|
| Bowser stands on the bridge, alive | probe from the water arrival: bowser paces x 293.3 → 296.3 at y 8 (bridge deck is row 10), `dead:false`, over 300 frames |
| ...and is visible | `shot.mjs` at column 286: Bowser on the bridge breathing fire at Mario, lava below |
| the axe ends the fight | walked+jumped onto the axe pillar from 296: `endPhase` goes `null → "tally"`, Bowser entity gone, Mario walks off to the castle at 311 |
| pipe 81 goes forward | stand on it, hold down → `8-4 @ 112.5,12` |
| pipe 152 goes forward | → `8-4 @ 192.5,12` |
| pipe 228 goes to the swim | → `8-4w @ 5.5,9` |
| pipes 51/132/212/266 are traps | all → `8-4 @ 16.5,12` |
| the water pipe returns at 256 | swim exit at (66,7) holding right → `8-4 @ 258.3,12` (walked on from 256), alive |
| ...and does not re-trigger loop 3 | it lands east of the 247 trigger; the walk-on above stayed in the level |
| the three loops fire | holding right at 87/167/247 → 39.5 / 114.3 / 194.3 (landing columns 32/112/192 plus walk-on) |
| the lift is rideable | teleport onto the deck, ride 70 → 75.6 at y 11.5, `dead:false`, carried by the platform |
| room 1 is no longer a trap | `node tools/reach.mjs 8-4`: **"No trap regions found in 2 area(s)"** (was 12 regions) |
| the last lava is jumpable | running jump with takeoff at 274-276 from column 268 clears 277-281 and lands on the ledge; takeoff at 272-273 falls in |
| nothing broke on load | `node tools/validate.mjs` → 101/101 modules import cleanly; no page or console errors in any shot/probe run |
| 8-1/8-2/8-3 not clobbered | regenerating world 8 reproduced the other agent's `multicoin` edits byte-for-byte; their diffs are unchanged |

## 4. What remains

1. **Worlds 1, 2, 4, 6, 7 have stale enemy columns.** The decoder fix is in but
   their level files were not regenerated (other agents are editing them). Someone
   should re-run `smb-gen-world1/2/4/6.mjs` when those tasks land. 1-1's first goomba
   in particular is currently absent from the file entirely.
2. **Lift height is wrong game-wide.** `smb-build.mjs:495` uses `y: e.y + 1` for
   lifts; the ROM's `PosPlatform` adjusts X only, so lifts belong one row higher.
   Fixed locally for 8-4; 13 other levels still carry it. Worth a task of its own
   with a `reach.mjs --sizes` sweep before and after.
3. **Green paratroopas render as plain koopas.** `ENEMY_MAP` maps `$0e`, `$0f` and
   `$10` to `koopa:green` / `koopa:red` with no `winged` flag, so 8-4's four hopping
   green paratroopas at 139/141/155/157 walk instead of hop. The `koopa` entity
   already supports `winged`/`fly`. Game-wide, not 8-4-specific.
4. **No princess at the end.** The enemy stream has a retainer (`$35`) at column 313;
   `smb-build.mjs` lists `$35` as deliberately unhandled. 8-4's ending currently
   walks Mario into the castle with nobody there.
5. **Not verified:** a single unbroken human playthrough of 8-4 start to axe. Each
   leg was driven and measured separately (spawn→lift→81, 112→152, 192→228, swim,
   256→bridge→axe), but I never ran the whole chain in one go, and I did not measure
   whether the jump from the pillar at 65 onto the moving lift is timeable at normal
   speed — `reach.mjs` credits a lift's whole sweep without asking whether you can
   time it.
6. **Not verified:** the fight itself (five fireballs, hit points, the fake-Bowser
   reveal in `bowser.js`). I confirmed he spawns, paces, breathes fire and dies to
   the axe; I did not test defeating him by fireball.

---

# Round 2 — lift height and paratroopas (game-wide)

Files touched this round: `tools/smb-build.mjs`, `tools/reach.mjs`,
`src/game/world.js`, `src/game/entities/platform.js`,
`src/game/entities/koopa.js`, `tools/smb-gen-world8.mjs` (local compensation
removed), and all 32 level modules regenerated.

## TASK 1 — lift height

### What was wrong, and what it took to actually fix it

The approved change — `smb-build.mjs` `y: e.y + 1` → `y: e.y` — is in, and the
world-8 `seatLavaLifts()` compensation is gone. `InitEnemyObject` corroborates the
+1: it adds 8 pixels to Y for objects **$00-$14 only** (asm:8060-8062), and lifts
are $24-$2c, so they never get the nudge that the walkers do.

That change alone was **not** enough, and shipping it alone would have broken two
things. Both showed up in measurement, not in review:

**(a) A new trap in 4-3 (big body), column 69.** Raising the lifts pulled the
vertical lift at 58.75 out of jumping range of the ground, and the one-tile island
at column 69 became a dead end. Verified by driving, not just modelled: big Mario
placed at (69,12) and given a run jump, a standing jump, and a back-up-and-run —
all three either fall in the pit or fail to advance.

The real cause was underneath: `InitVertPlatform` (asm:8914-8926) stores the
written row as `YPlatformTopYPos`, the **limit** of travel, and sets
`YPlatformCenterYPos` 64 pixels away from it — below for a lift written high on
the screen, above for one written low. `YMovingPlatform` (asm:10896) then springs
about that centre. Our engine bobbed these lifts around the written row, i.e. half
a travel too high, so they had been wrong since before this task; the +1 removal
just pushed 4-3 over the edge. Fixed in `platform.js` as `swingY`, and mirrored in
`reach.mjs`'s lift model.

This applies **only** to the springing lift ($25 — `mode: 'vertical'` with no
`dir`): seven lifts in 1-3, 4-3, 5-3 and 6-3. The lifts that carry a direction are
$26/$27 and $2b/$2c — `LargeLiftUp/Down` and `PlatLiftUp/Down` — which run
continuously rather than springing, and they keep the written row as their centre.

**(b) 8-4's lava lift still killed its rider.** With the compensation removed, the
deck sat at 216px; the lava band is 208-240. Measured: `died@11`.

Cause: `world.js:1369` read

```js
if (typeof e.place === 'function') e.place(...);
else if (e.isPlatform) { /* keep the tile's top-left */ }
```

`place` is defined on `Entity`, so the first test is true of every entity that
exists and the platform arm **could never run**. Lifts were being bottom-anchored
like goombas, putting the deck 8px below its row and 16px left of its column. The
order is now `isPlatform` first, which is what the comment there always said it
did. Note `reach.mjs` has always modelled the deck at `spec.y * TILE` — the tool
and the engine disagreed, which is exactly why reach called 8-4 crossable while
riding it drowned you.

With both fixes, 8-4's lift deck sits at y=13.0 — `row * 16` = 208 = the lava
surface, the original's own number — and sweeps x 66.75 → 74.75, spanning the gap
between the pillar that ends at 65 and the block that starts at 75.

### Verification — every lift ridden

All **60** lifts in the game were ridden: player set to big, dropped onto the deck,
240 frames, recording whether the platform caught and carried him and whether the
deck's sweep matched its spec.

* **Every one of the 60 caught the player and carried him.** None is un-standable
  and none is unreachable in the model.
* Every deck now sits at exactly its spec row (`y[6,6]`, `y[9,9]`, …) and every
  horizontal sweep is centred on its spec column — engine and `reach.mjs` agree.
* The springing lifts show the new centre: 1-3/5-3 @y6 → `y[7.03,14]` (centre 10 =
  6+4); 6-3 @y13, written low → `y[5,12.02]` (centre 8.5 = 13−4).
* Riders die only on `fall` platforms (3-3, 6-3, 7-4) and on `pulley` platforms
  ridden to the bottom (4-3, 6-3) — both are the design: those decks are supposed
  to drop away under you.

`reach.mjs`: **2 trap regions in 57 areas, in BOTH body sizes** — `1-2/1-2b` and
`8-1/8-1b`, the two known ROM-geometry ones. No third region. For contrast, the
same tree with only the lift height reverted reports **14** regions (the two, plus
the twelve covering 8-4's first room).

`tools/validate.mjs`: 101/101 modules import cleanly.
`tools/probe.mjs` physics suite: maxWalk, maxRun, terminalVy, standingJump,
runJump all still OK against the reference.

## TASK 2 — green paratroopas

The ROM does **not** give the three winged koopas one behaviour. `EnemyMovementSubs`
(asm:9086-9106) hands each its own routine:

| id | init | movement | behaviour |
|---|---|---|---|
| `$0e` green | `InitJumpGPTroopa` (8868) | `MoveJumpingEnemy` | walks and hops on the ground |
| `$0f` red | `InitRedPTroopa` (8214) | `ProcMoveRedPTroopa` (9377) | springs straight up and down, **no horizontal movement at all** |
| `$10` green | `InitHorizFlySwimEnemy` (8200) | `MoveFlyGreenPTroopa` (9402) | shuttles left and right on the XMove counters, with a shallow wave |

`ENEMY_MAP` mapped all three to plain koopas with no wings. Entries can now carry
options as well as a type, and the three ids emit `winged: true`, `winged: true`
(red), and `winged: true, fly: 'horizontal'`.

`koopa.js` already implemented the hop and a vertical hover, but the hover was
wrong in two ways and there was no horizontal flight at all. Now:

* `flyMode` replaces the boolean `flying`, so the three are distinguishable.
* The red bob is centred where `InitRedPTroopa` puts it — 48 pixels **below** the
  written row, or 32 above for one written low — with the written row as the top of
  travel, instead of bobbing symmetrically about the written row.
* The red bob no longer drifts sideways. The old code applied
  `vx = speed * facing * 0.35`; no red paratroopa in the original moves horizontally.
* `fly: 'horizontal'` cruises left and right about the written column with a
  shallow ±4px wave — an approximation of the XMove counters, not a transcription
  of them.

**48 paratroopas** across 15 levels now fly or hop that were walking.

### Verified by watching, with the camera on them

* **Green hopper**, 3-1 @25 and 8-4 @139: `flyMode: null`, y cycles 11.5 ↔ 9.24
  (a 2.26-tile hop — `HOP_RISE` is 38px) while walking left, x 24.72 → 20.13.
  Screenshot: two winged green koopas, one grounded and one mid-hop.
* **Red bobber**, 1-3 @74: `flyMode: 'vertical'`, y sweeps **[4, 10]** — from the
  written row down to row + 96px, centred on row + 48 — and **x stays at 74.00 for
  all 300 frames**. Screenshot: red paratroopa hovering between the platforms.
* **Horizontal flyer**: spawned by hand, cruises x [30, 38] about home 34, sways y
  [6.75, 7.25], reverses 5 times in 400 frames.

### One thing to know about `$10`

Both instances in the game (2-3 and 7-3) are **hard-mode-only**, and the generator
drops `hardOnly` enemies, so no level file carries one. The code path is
implemented and measured, but it is currently unreachable in normal play. I did not
change the hard-mode filter — that is a separate decision.

## Also worth a look

* `smb-build.mjs:457` — `if (e.x < 8 && e.id < 0x37 && ENEMY_MAP[e.id]) continue;`.
  I left it. It was compensating for the row-$0e decode bug, but it is not a pure
  no-op now: `decodeEnemies` still yields a handful of genuinely-low-column enemies
  across the game, and removing it changes more than 1-1. It wants its own pass
  with a before/after `reach.mjs --sizes` sweep, not a drive-by.
* `x: e.x + 0.75` on every lift cites `PosPlatform`, but `PosPlatform` is only
  called from `InitBalPlatform` — the balance ($24) platforms. The other eight lift
  ids never go through it, so the 12-pixel nudge looks like it is being applied
  eight times too widely. Unverified; I did not touch it.
* One harness oddity I could not explain: a probe reported the lift at 6-3
  `126.75,6` with `mode: 'fall'` where the level spec and a clean inventory probe
  both say `pulley`. The lift at that origin was ridden for 228 frames before its
  deck dropped away, so it works; the mode label is the only thing in question.
