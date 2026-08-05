# 8-4 audit, round 3 — "discrepancies that make it hard to beat"

Scope: compare our 8-4 against the original, find what changed recently, and say
whether the level is beatable. Read-only on `src/**`; nothing changed, nothing
committed.

Prior work read first: `agent-reports/audit-8-4.md` (rounds 1 and 2) and
`agent-reports/hard-mode.md`. This report does not re-derive what those
establish — the pipe routing, the three loop commands, Bowser's column, the lift
seating and the paratroopas are all settled there and still hold. What follows is
what is *new* or what those rounds did not measure.

---

## VERDICT: 8-4 IS BEATABLE.

The whole route was traced by hand from the warp table and then driven leg by leg
in the real engine. No pipe leads nowhere, no loop is inescapable, the water
section has an exit, and every required jump is physically possible with this
engine's own constants. The axe still ends the fight
(`endPhase: null -> "tally"`, driven).

It is, however, **meaningfully harder than the original**, and the single largest
cause is a 25% shorter clock that has been wrong since the level was generated.

### The route (every leg driven or traced)

| leg | route | evidence |
|---|---|---|
| room 1 | spawn (2,6) → lava 6-10 → pillar 62-65 → **step onto the lift** when its left edge is in [66.8, 68.8] → ride → jump 3 tiles up onto the block at 75 → **pipe 81** (top row 8), press DOWN | 86/160 arbitrary step-offs board (measured, below); pipe 81 → `8-4 @ 112.5,12` (driven) |
| | traps: pipe 51 → column 16; walking past column 87 → loops back to 32 | loop driven: hold right at 84 → ends at 43.1, same area |
| room 2 | 112.5 → lava 144-146 (3 columns, flat) → climb to **pipe 152**, top at row 6 → DOWN | `8-4 @ 192.5,12` (driven, round 1; warps unchanged since) |
| | traps: pipe 132 → 16; past 167 → loops to 112 | |
| room 3 | 192.5 → up onto the shelf 198-219 (top row 10) → over pipes 204 and 212 → running jump the lava at 220-223 onto 224-227 → **pipe 228**, top row 8 → DOWN | `8-4w @ 5.5,9` (driven) |
| | traps: pipe 212 → 16; past 247 → loops to 192 | |
| water | swim right along rows 6-8 for 67 columns past 4 firebars and 3 bloopers → exit | driven end to end: spawn (5,8) → exit at f=1048 → `8-4 @ 256.5,12` |
| final | 256 → over the pipe at 259 → over the **trap** pipe at 266 (do NOT enter) → past the hammer bro at 273 → **full-run jump, takeoff at column 275-276**, clearing lava 277-281 and rising 3 tiles onto the ledge at 282 → bridge 288-300 → Bowser at 295 → axe pillar at 301 | jump driven; hammer-bro passage driven 6/8; axe driven to `tally` |

---

## FINDINGS, ranked

### 1. The clock is 300 seconds. The original gives 8-4 **400**. — DEFECT, HARDER, high confidence

`reference/smb-areas.json` carries each area's two header bytes. CastleArea6's are
`[0x5B, 0x06]`. `GetAreaDataAddrs` (`reference/smbdis.asm:4418-4423`) takes the top
two bits of the first byte as `GameTimerSetting`:

```
0x5B = %01011011   ->  bits 7-6 = %01  ->  GameTimerSetting = 1
GameTimerData (asm:2829-2831) = .db $20(dummy), $04, $03, $02
GameTimerData[1] = $04  ->  400 seconds
```

`src/data/levels/8-4.js:81` says `time: 300`. The generator never reads the
header: `tools/smb-gen-world8.mjs` hardcodes `time: 400` in the 8-1/8-2/8-3
templates and `time: 300` in the 8-4 one, on the assumption that castles are 300.
That assumption is wrong for three castles.

Decoding the header for all 36 levels and diffing against our files gives **10
mismatches**:

| level | ROM | ours | |
|---|---|---|---|
| 1-3, 2-3, 3-2, 5-1, 7-3, 8-1, 8-3 | 300 | 400 | too generous |
| 4-4, 7-4, **8-4** | 400 | 300 | **too tight** |

Why this bites 8-4 hardest, and why the user would notice it *as* 8-4:

* it is the longest level in the game to traverse — 317 columns plus an 86-column
  swim, and swimming is slow;
* the timer **does not reset on any internal warp**. Verified by driving: set
  `world.time = 222`, take pipe 81, take the loop at 87, take the water pipe —
  all three arrive with the timer still running down from 222, never back at 300.
  (`resetTime` defaults to `areaId == null`, `src/game/world.js:816`, which is the
  ROM's behaviour — `FetchNewGameTimerFlag`. Correct, and it means 300 really is
  the whole budget.)
* `TIME_TICKS = 24` (`src/game/world.js:200`) matches the ROM, so 300 units is
  120 real seconds against the original's 160. A single wrong pipe costs a whole
  room; the original gives you the slack to survive two or three, we do not.

**This is pre-existing**, not a recent commit. It is also the most likely single
answer to "it is hard to beat".

**Proposed minimal fix (NOT applied):** in `tools/smb-build.mjs`, derive the timer
from the header the level already carries —

```js
// GetAreaDataAddrs (asm:4418-4423): the two MSB of header byte 0 index
// GameTimerData (asm:2829-2831) = dummy, $04, $03, $02.
const GAME_TIMER = [null, 400, 300, 200];
const time = GAME_TIMER[(area.header[0] & 0xc0) >> 6];
```

— expose it on the emitted meta, and have each world generator write `time:`
from it instead of a literal. Then regenerate. It touches 10 levels across six
worlds, so it wants the lead's sign-off and a regeneration pass, not a one-line
edit to `8-4.js`.

---

### 2. The hammer bro at 273 was buffed in `3095797`, and he stands in the run-up to the level's hardest mandatory jump — RECENT, HARDER, high confidence

The final corridor is nine columns wide: floor 268-276, then **lava 277-281**,
then the ledge at 282-287 whose top is three rows *higher* than the floor you take
off from. Driven, small Mario, enemies cleared, full run from column 268:

| takeoff column | result |
|---|---|
| 272 | died at 280.8 |
| 273 | died at 281.3 |
| 274 | died at 281.3 |
| 275 | on the ledge, x 281.7 (lip) |
| 276 | on the ledge, x 282.9 |

So the jump requires **max run speed and a takeoff in the last two columns before
the lava**. There is no second chance: you cannot back up past the pipe at
266-267 for a longer run-up without climbing it again.

`3095797` put a hammer bro with hard-mode timings at column **273** — inside that
runway. Driven from 268 at six different enemy phases:

| approach | result |
|---|---|
| run straight through | **DIED 8/8**, at columns 270-272 |
| jump over him first, then jump | **on the ledge 6/8** |
| stomp him first, then jump | **on the ledge 6/8** |

So it is passable, but only by spending the runway on an evasion and still hitting
a two-column takeoff window.

Most of the buff is ROM-faithful and I verified each against the disassembly:
`HammerThrowTmrData .db $30, $1c` (asm:9204) indexed by `SecondaryHardMode` — 49
frames between hammers becomes 29; `HBroWalkingTimerData .db $80, $50`
(asm:8185-8193) — he starts advancing after 80 frames instead of 128. Both
correct. (Note the walk delay actually got *less* aggressive: the old code had a
hardcoded `walkT = 40`.)

**One part is not faithful.** `src/game/entities/hammerbro.js:199-204`:

```js
const long = hardMode(this.world) && rng.chance(0.5);
this.vy = -Math.sqrt(2 * enemyGravity() * (long ? HOP_RISE * (0x37 / 0x20) : HOP_RISE));
```

`HammerBroJumpCode` (asm:9243-9271) does not roll a flat coin. The offset into
`HammerBroJumpLData .db $20, $37` is `$00 AND PseudoRandomBitReg+2`, and `$00` is
set to 1 **only when the bro is above the middle of the screen**:

```
lda Enemy_Y_Position,x
bmi SetHJ          ; bottom half of the screen -> $00 stays 0, short hop, always
```

8-4's bro is at row 11, `Enemy_Y_Position = 176 = $b0`, which is the bottom half.
The original would give him the short `$20` hop **every time**, hard mode or not.
Ours gives him the long `$37` hop half the time, in the one corridor where his
reach decides whether you keep your run.

**Proposed minimal fix (NOT applied):** gate the long hop on the bro's screen
height as the ROM does, e.g. `hardMode(world) && this.y < <middle-of-screen> &&
rng.chance(0.5)`, rather than on hard mode alone. Affects every hammer bro from
5-3 on, so it is a small change with a wide blast radius and wants its own pass.

---

### 3. The lift deck shrank from 3 tiles to 2 in `3095797` — RECENT, ROM-CORRECT, and measurably **not** what broke room 1

This was the obvious suspect and it is worth closing explicitly, because it looks
much worse than it is.

`src/game/entities/platform.js:84-92` now shrinks a three-tile deck to two in a
castle or in secondary hard mode. 8-4 is both, and its lava lift is the only way
across room 1. Verified in the engine: `tilesWide: 2`, `w: 32`, deck at `y = 208`
(the lava surface), left edge sweeping **66.75 → 74.75**.

The change is correct. `SPBBox` (asm:8930-8940) sets bounding-box control 5
instead of 6 for a castle-type level, and `DrawPlatform` (asm:13343-13350) pushes
the last two of the deck's six sprites offscreen under the same test — castle
first, hard mode second, and 8-4 satisfies castle unconditionally. Six sprites is
three tiles, four is two. **8-4's lift was always two tiles in the original.**

And it does not narrow the boarding window, because the deck is anchored at its
left edge and its leftmost position is 66.75: the third tile only ever existed on
the *right*, where nobody boards. Measured by sweeping the lift's phase — walk off
the pillar at 62 holding right, record the deck's left edge at the moment the
player crosses column 66, record whether he lands on the deck (lava blanked
in-memory so a miss is a fall, not a level reload):

* **boarding band: deck left edge in [66.78, 68.84]** — 2.06 tiles, about 44
  frames of deck travel, and the deck passes through it twice per cycle;
* **86 of 160** arbitrary step-offs boarded;
* the deck still reaches x = 76.75, overlapping the landing block that starts at
  75, so the far side is unchanged too.

`node tools/reach.mjs 8-4` — which models the two-tile deck since the same commit
— reports **"No trap regions found in 2 area(s)"**.

Conclusion: harder to look at, not harder to do. **No fix proposed.**

---

### 4. No data regression from the recent commits — checked, clean

The lead's hypothesis was that `ce57ed1` ("Regenerate the levels that carry
hard-only enemies") left 8-4 stale. It did not.

* I regenerated world 8 into a scratch directory through the current pipeline and
  diffed: **8-1, 8-2, 8-3 and 8-4 are byte-identical to what is in the tree.**
  The level data is not stale in any way.
* 8-4 correctly gained no `hard: true` entities, because it has none to gain:
  decoding CastleArea6's and WaterArea3's enemy streams gives **21 records,
  `hardOnly: false` on every one**. `ce57ed1` was right to skip 8-4.
* `ff5c5b9` (firebar naming in the decoder) is names only; regenerating confirms
  no output change.

---

### 5. Smaller recent changes, all ROM-faithful

| change (all `3095797`) | effect on 8-4 | faithful? |
|---|---|---|
| Bowser's flame 2.0 → 2.2 px/frame; breath every 100 frames instead of 116 | HARDER, at the bridge | yes — `ChkFireB` asm:10248-10258, `ProcBowserFlame` asm:10328-10334 |
| flying-cheep frenzy cap 3 → 4 | HARDER, columns 221-234 of room 3 — over the lava jump and the water pipe | yes — `InitFlyingCheepCheep` asm:8425-8433 |
| blooper direction latch | **EASIER**, the swim | yes, and it fixes a bug: bloopers used to re-aim every stroke, which was more aggressive than the original's *normal* mode |

None of these is a defect. Together with finding 2 they are why the back half of
8-4 feels different "now" even though the level data did not move.

---

### 6. Still open from round 1, unchanged

* **No princess/retainer at the end.** The enemy stream carries a toad (`$35`) at
  column 313; `smb-build.mjs` lists `$35` as deliberately unhandled and
  `8-4.js` has no such entity. Cosmetic, EASIER-neutral.
* Round 1's remaining "not verified" item — a single unbroken playthrough — is
  now partly closed: every leg was driven again this round, but still separately,
  and combat was cleared for the geometry measurements.

---

## What I did NOT find

* No pipe that leads nowhere. All seven warps resolve; the three that go to column
  16 are the original's own traps, read from the row-`$0e` pointer records.
* No loop that cannot be exited. All three loop triggers fire and land on solid
  ground west of the pipe that leaves the room.
* No required jump that is impossible. The two tight ones (the lift board, the
  final lava) were both driven successfully.
* No water section without an exit. Driven start to finish.

## Recommendation

Finding **1** is the one to act on, and it is the only one I would call
unambiguous. It is not an 8-4 edit — it is a generator change plus a regeneration
of ten levels, so it needs your call before anyone touches it. Finding **2**'s
hop bug is a genuine but smaller deviation with a game-wide blast radius. Finding
**3** should be left alone.
