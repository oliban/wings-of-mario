# Secondary hard mode

Files touched: `src/game/world.js`, `src/game/entities/index.js`,
`src/game/entities/hammerbro.js`, `bowser.js`, `blooper.js`, `cannons.js`,
`frenzy.js`, `platform.js`, `tools/smb-build.mjs`, `tools/reach.mjs`, and all 32
level modules regenerated.

## The rule

`InitializeArea`, smbdis.asm:2694-2703:

```
lda PrimaryHardMode ; bne SetSecHard
lda WorldNumber     ; cmp #World5 ; bcc CheckHalfway ; bne SetSecHard
lda LevelNumber     ; cmp #Level3 ; bcc CheckHalfway
SetSecHard: inc SecondaryHardMode
```

`World5 = 4`, `Level3 = 2` (asm:633, 639) are the zero-based internal numbers, so
in the numbers people say: **on from 5-3 onward**, and on for every world past 5.
No setting, no UI — the original gives the player no say and neither do we.

`secondaryHardMode(levelId, primary)` lives in `world.js` and is called from
`loadLevel`, which every path into an area funnels through (`main.js` loads,
warps, pipe transitions, checkpoint reloads, death reloads). It takes the **root**
level's id, never a sub-area's, because the original reads WorldNumber/LevelNumber
and a pipe changes neither. Nothing is stored between areas, so nothing can leak.
`primary` is the seam for PrimaryHardMode; it is always false today.

**Harry's `h-*` levels get nothing.** They are not a numbered world, the regex does
not match, and the function returns false.

### Measured

```
1-2=false  4-1=false  8-1=true  4-1=false  5-2=false  5-3=true
1-1=false  8-4=true   h-1=false 2-1=false
```

Read left to right: `8-1=true` then `4-1=false` is the leak test — arriving in
world 8 and then in world 4 gives world 4's answer, not a sticky one. `5-2=false`
/ `5-3=true` is the boundary. Sub-area inheritance: piping down 8-4's water pipe
lands in area `8-4w` with `hardMode = true`, from the parent's numbers.

## Every read site

`grep -n SecondaryHardMode reference/smbdis.asm` gives 15 lines: one write
(asm:2703) and **14 reads**. All 14, and what happened to each:

| # | asm | routine | what it changes | status |
|---|---|---|---|---|
| 1 | 6771 | `ProcessCannons` | `CannonBitmasks` %00001111 → %00000111 — a cannon is looked at 6/16 of frames, or 6/8 | **done** |
| 2 | 7978 | enemy parser | the `hardOnly` bit: the object is skipped entirely when clear | **done** |
| 3 | 8192 | `InitHammerBro` | `HBroWalkingTimerData` $80 → $50 | **done** |
| 4 | 8429 | `InitFlyingCheepCheep` | three fish on screen → four | **done** |
| 5 | 8568 | `InitBowserFlame` | `FrenzyEnemyTimer` −$10 | not applicable — see below |
| 6 | 8882 | `InitBalPlatform` | a 2-pixel horizontal nudge on balance platforms | not done (cosmetic) |
| 7 | 8936 | `SPBBox` | lift bounding box 6 → 5 (three tiles → two) | **done** |
| 8 | 9226 | `ProcHammerBro` | `HammerThrowTmrData` $30 → $1c | **done** |
| 9 | 9267 | `HammerBroJumpCode` | `HammerBroJumpLData` $20 → $20 or $37 | **done** |
| 10 | 9472 | `MoveBloober` | `BlooberBitmasks` %00111111 → %00000011 | **done** |
| 11 | 10254 | `ChkFireB` | Bowser's fire-breath timer −$10 | **done** |
| 12 | 10328 | `ProcBowserFlame` | flame movement force $40 → $60 | **done** |
| 13 | 10811 | `SetupPlatformRope` | rope x offset, companion of #7 | not done (cosmetic) |
| 14 | 13346 | `DrawPlatform` | last two of six lift sprites pushed offscreen | **done** with #7 |

### The remembered list, checked

The brief expected enemy walk speed, Lakitu aggression, cheep-cheep speed and the
firebar/podoboo timings to be on this list. **None of them are.** The grep above is
exhaustive and no line of it falls in `MoveNormalEnemy`, `MoveLakitu`,
`ProcFirebar`, `MovePodoboo`, or anything that sets `Enemy_X_Speed` for a walker.
The one cheep-cheep site (#4) is a *count*, not a speed — `FlyCCXSpeedData`
(asm:8411) is indexed by pseudorandom bits, not by the flag. Hard mode in SMB is
narrower than its reputation: it is more enemies, a nastier hammer bro, a faster
Bowser, hungrier bloobers and cannons, and shorter lifts.

### #5, why not applicable

`InitBowserFlame` times the **standalone flame frenzy** — the `$15` records in the
enemy stream. `smb-build.mjs` lists `$15` among the ids it deliberately drops
("bowser's flame — our Bowser emits its own"), so there is no frenzy object for the
timer to belong to. Bowser's own breathing is #11, and that is done.

## `hardOnly` enemies

Bit 6 of an enemy record's second byte. `smb-build.mjs` dropped every one of them
unconditionally; they are now emitted with `hard: true` and gated in
`World._spawnLevelEntities` — not spawned-and-hidden, because the original never
parses the object at all (asm:7976-7979).

**34 enemies come back**, measured as the live-entity delta between levels that
share a ROM area, where the only difference is the flag:

| area | flag off | flag on | delta |
|---|---|---|---|
| CastleArea1 | 1-4 — 9 live | 6-4 — 16 live | **+7** |
| CastleArea3 | 2-4 — 12 live | 5-4 — 21 live | **+9** |
| WaterArea2 | 2-2 — 10 live | 7-2 — 17 live | **+7** |
| GroundArea8 | 2-3 — 4 live | 7-3 — 11 live | **+7** |
| GroundArea20 | (7-1 only) | 7-1 — 16 live | **+4** |

What each level gains:

* **6-4** 3 firebars, 3 podoboos, 1 firebar
* **5-4** 5 firebars, 4 podoboos
* **7-2** 7 bloopers
* **7-3** 5 koopas and **the two `$10` horizontal paratroopas**
* **7-1** 3 hopping paratroopas and a fourth hammer bro

**Placement checked:** no non-firebar addition sits in a solid tile or off the map.
Firebar hubs do sit on solid tiles — that is correct and deliberate, they are
mounted on the `EmptyBlock` the original mounts them on (the existing note in
`smb-build.mjs`), so they are excluded from that test rather than counted as
failures.

**5-3 gains nothing**, despite the flag. Its two `hardOnly` records are id `$17`
(bullet-bill/cheep frenzy control), which `smb-build.mjs` already lists as
deliberately unhandled. Worth knowing rather than assuming the gate failed.

The `$10` paratroopa is now reachable at last, and it flies: in 7-3 it cruises
x 136 → 144 with the ±0.25-tile sway, `flyMode: 'horizontal'`.

## Behaviour changes, with both numbers

Timings read straight off the entities in real levels:

| thing | flag off | flag on | table |
|---|---|---|---|
| hammer bro, frames between hammers | **49** (3-1, 5-2) | **29** (7-1, 8-3) | `HammerThrowTmrData` $30 / $1c |
| hammer bro, frames before he walks at you | **128** | **80** | `HBroWalkingTimerData` $80 / $50 |
| Bowser, frames between breaths | **116** (1-4, 4-4) | **100** (6-4, 8-4) | `ChkFireB` −$10 |
| Bowser's flame, px/frame | **2.0** | **2.2** | force $40 / $60, +1 px flat |
| lift deck width, tiles | **3** (1-3) | **2** (5-3) | `SPBBox` 6 / 5 |

1-3 and 5-3 are the same ROM area (GroundArea7), so that last row is the flag and
nothing else. Castles shrink their decks with the flag off too (1-4: 2 tiles) —
that is the `AreaType` half of the same test, which we were also missing.

Hammer bro jumps: outside hard mode `HJump` forces the table offset to 0 and he
always gets the short `$20` hop; in hard mode the offset comes off the LSFR, so
half his hops are the long `$37` one — 1.7x the airtime.

Measured over time rather than read off a field:

* **Blooper re-aim**, same experiment either side, player parked alternately left
  and right so a re-aim is visible: **2** heading changes in 900 frames in 2-2,
  **31** in 7-2. Ratio 15.5 against the tables' 16 (1/64 vs 1/4).
  Note this needed the direction *latch* implementing first — our blooper homed on
  the player every stroke, which is more aggressive than the original's normal
  mode, and left the `BlooberBitmasks` axis nothing to attach to.
* **Cannons**, 7-1 with the flag forced each way (same level, same geometry):
  **17** bullet bills in 1200 frames off, **21** on. The gain is smaller than the
  2x on the selection roll because a cannon's fourteen-selection reload only ticks
  on a frame it is selected, and `MAX_BILLS = 3` caps throughput.
* **Flying cheeps**, 2-3 with the flag forced each way: peak **4** live off, **5**
  on. The delta is the +1 the ROM specifies; both absolute numbers sit one above
  the ROM's 3/4 because our cap is tested before the spawn is added to the list.
  The delta is what the flag controls and it is exactly right.

## Verification gates

* `tools/reach.mjs`: **2 trap regions in 57 areas**, `1-2/1-2b` and `8-1/8-1b`.
  `--big`: **2**. No new region — including after the lift deck shrank to two tiles
  in every castle and everything from 5-3 on.
* Every lift in the ten levels whose decks shrank re-ridden, big Mario, deck-catch
  and carry recorded: **all catch and carry**. 8-4's lava lift — the one that was
  lethal two rounds ago — is `w=2, carried=189 frames, alive`. 1-3 keeps `w=3` as
  the control. Deaths occur only on `fall` and bottomed-out `pulley` decks, by
  design.
* `tools/validate.mjs`: 101/101 modules import cleanly.
* `tools/probe.mjs` physics suite: maxWalk, maxRun, terminalVy, standingJump,
  runJump all unchanged and OK.

## What I did not do

* **Primary hard mode / second quest.** Out of scope. The seam is the `primary`
  argument to `secondaryHardMode`, unused and always false.
* **#6 and #13**, the balance-platform nudge and the rope offset. Both are a few
  pixels of drawing that ride along with the deck shrink; neither changes what you
  can reach. #13 also assumes the original's rope-drawing routine, which we do not
  share.
* **Not verified:** playing any of 5-3 → 8-4 through by hand to say whether the
  back half is now *fairly* harder rather than merely harder. `reach.mjs` says
  nothing became unreachable, and every added enemy is in open space, but 34 extra
  enemies and a hammer bro throwing 1.7x as fast is a difficulty change that only
  a person can judge.
* One harness oddity, same as last round: a single-lookup probe reported `NOMATCH`
  for 6-4's lift while the identical `horizontal@138.75` lift rode fine in 1-4,
  2-4, 3-4 and 5-4. The lift is there; the lookup is flaky.

---

# Round 2 — checking the baseline's three conclusions

The 36 records in 6 areas match my own inventory exactly. Two of the three
conclusions drawn from them do not survive checking, because they rest on
`ENEMY_NAMES` labels in `smb-decode.mjs` that are wrong.

## 1. GroundArea8 and the `$10` flyer — confirmed

`levelMap` gives GroundArea8 to **2-3 and 7-3**. 2-3 is world 2, flag off, so
**7-3 is the only place the horizontal flyer becomes reachable.**

Watched in play, not hand-spawned: loading 7-3 and looking for
`flyMode === 'horizontal'` finds **two**, at columns **140 and 156**. Driving to
column 134 and watching the near one for 240 frames: it cruises **x 136 → 144**
and sways **y 6.75 → 7.25**, `winged: true`, `variant: 'green'`.

## 2. There are no groups — every one of those records is a FIREBAR

`grep`ing the hardOnly records for their actual ids rather than their names:

```
2-2/7-2   $7@25 $7@52 $7@77 $7@90 $7@150 $7@173 $7@179
1-3/5-3   $17@18 $17@82
2-3/7-3   $0@39 $e@52 $3@79 $3@95 $3@119 $10@140 $10@156
7-1       $e@26 $e@44 $e@65 $5@86
1-4/6-4   $1d@23 $c@27 $c@33 $1d@37 $1b@80 $1d@92 $c@131
2-4/5-4   $c@20 $1f@23 $1b@43 $1b@55 $1d@67 $1c@103 $c@109 $c@113 $c@131

total records 36 | real group records ($37-$3e): 0
```

**Zero.** The records the baseline reads as `koopa-group-3-row10`,
`goomba-group-3-row10` and `goomba-group-3-row6` are ids **$1b, $1c and $1d**, and
the enemy init table (asm:8100-8104) maps `$1b-$1e` to `InitShortFirebar` and
`$1f` to `InitLongFirebar`. They are firebars. `ENEMY_NAMES` in `smb-decode.mjs`
carries stale group labels for that range; `smb-build.mjs` has had the right table
(`FIREBARS`, `0x1b`-`0x1f`) all along, which is why the emitted specs came out as
firebars.

So nothing expands three-for-one and the true added count is **not** above 36. It
is **34 live entities** — 36 records minus the two `$17` frenzy-control records in
GroundArea7 that we do not implement — which is exactly the delta already
measured. `HandleGroupEnemies` is not on this path at all, so gating cannot bypass
it.

## 3. `$1f` is handled — it is the long firebar

It looks unmapped in `ENEMY_MAP` because firebars never reach `ENEMY_MAP`:
`smb-build.mjs` checks its `FIREBARS` table first, and `0x1f` is there with
`count: 12`. Nothing ships that we cannot spawn.

Verified in play, on the two levels that share CastleArea3:

| | firebars live | at columns |
|---|---|---|
| 2-4 (flag off) | **6** | 49 55 61 73 82 92 |
| 5-4 (flag on) | **11** | 23 43 49 55 55 61 67 73 82 92 103 |

The one at column 23 — the `$1f` record — has **12 segments** against the others'
6. Screenshot of 5-4 shows it mounted on its block with the long tail of fireballs
running off the bottom of the screen, rotated well off horizontal, so it is
spinning.

## 4. WaterArea2's seven bloopers, measured

| | bloopers | densest screen (16 tiles) | tightest horizontal gap |
|---|---|---|---|
| 2-2 | 7 | 2 | 9 tiles |
| 7-2 | **14** | **3** | **3 tiles** |

That looks alarming until you take the rows into account. Every hard-only blooper
is placed in a **different lane** from the one it crowds:

```
col  22 row 12  always      col  71 row  9  always
col  25 row  8  HARD-ONLY   col  77 row  7  HARD-ONLY
col  46 row 10  always      col  83 row  9  always
col  52 row  8  HARD-ONLY   col  90 row 12  HARD-ONLY
col  55 row 11  always      col  94 row  4  always
```

The two tight pairs — 22/25 and 52/55 — are 4 and 3 rows apart in a shaft with
**13 swimmable rows**. No column in 7-2 is walled off; the additions fill a second
lane rather than blocking the corridor. Those are the original's own columns and
rows, so the shape of the difficulty is the ROM's, not ours.

What I could **not** establish: that it is *fair*. A naive "hold right, stroke
every twelve frames" bot dies in both levels (2-2 at column 79.3, 7-2 at 109.3),
which measures the bot's rhythm and not the level. Passability still needs a person.

## 5. A pre-existing bug found on the way — NOT hard mode

The blooper at **column 71 of WaterArea2** is an always-present one, and it spawns
**inside solid brick**: column 71 is `B` from row 8 to row 12, and the blooper is
placed at row 9. Measured — it starts at (71, 8.5) with `solidAt` true and drifts
out to x 69.59 over 60 frames, so it frees itself rather than staying stuck.

It is in **2-2 as well as 7-2** and has nothing to do with the flag or with my
change. Flagging it rather than fixing it: it is a placement question for whoever
owns the water areas.

---

# Round 3 — the column-71 blooper in WaterArea2 (investigation only)

**Answer: (c). The ROM really does put a blooper inside that block column, and the
original never spawns it — the enemy stream is consumed in order against the
camera, and this one record is always already behind the screen by the time the
parser reaches it. Our builder instantiates the whole level up front, so we show
an enemy the original cannot.**

Nothing was changed. This section is evidence and a recommendation only.

## (a) is ruled out — the decode is right

The raw bytes around it, with the ROM's own page arithmetic:

```
7a 07 -> col  55 row 10 id$7
d6 c7 -> col  77 row  6 id$7 HARD   (msb page++)
78 07 -> col  71 row  8 id$7
38 87 -> col  83 row  8 id$7        (msb page++)
```

`d6 c7`: second byte `0xc7` has bit 7 set, so the page steps 3 → 4, and
`0xd6 >> 4` = 13 gives column 4·16+13 = **77**. Bit 6 is set, so it is hard-only.
`78 07`: page is still 4, `0x78 >> 4` = 7, column 4·16+7 = **71**, row 8.

So the stream genuinely runs **…55, 77, 71, 83…** — out of order. That is not a
decode artefact: the page bump that produces it lives in `CheckRightBounds`
(asm:7920-7925), which runs **before** the hard-mode test at asm:7976-7979, so the
bump happens whether or not the flag is set and column 71 is column 71 in both
modes.

## (b) is ruled out — our bricks are the ROM's bricks

WaterArea2's object stream carries, at that spot:

```
x 71 row 6 param 4  ColumnOfSolidBlocks
```

Objects map with +2 and enemies with +1 (the mapping already documented and
checked against 1-4's firebars in `smb-build.mjs`), so the ROM's block column is
our rows **8-12** and the ROM's row-8 enemy is our row **9**. Our tiles:

```
our column 71: 0:~ 1:~ 2:~ 3:_ … 7:_ 8:B 9:B 10:B 11:B 12:B 13:# 14:#
our blooper spec at 71: {"type":"blooper","x":71,"y":9}
```

Exact match. The same verdict holds without our mapping at all: in ROM pixels the
block column spans Y 128-208 and `InitEnemyObject` (asm:8060-8062) puts the
blooper at row·16 + 8 = **136**. Inside, either way.

## (c), with the mechanism

`PositionEnemyObj` (asm:7943-7956) compares the record's column against
`ScreenRight` as a 16-bit quantity:

```
cmp ScreenRight_X_Pos / lda Enemy_PageLoc,x / sbc ScreenRight_PageLoc
bcs CheckRightExtBounds          ; at or beyond the boundary -> candidate to spawn
…                                ; otherwise fall through
jmp CheckThreeBytes              ; -> Inc2B: step over the record, spawning nothing
```

A record whose column is **already behind the screen's right edge is discarded**,
not deferred. And `CheckRightExtBounds` only lets a record through once
`ScreenRight + 48` reaches it, so the parser sits **blocked** on the col-77 record
while the camera crosses columns 71 through 74.

Sequence, in either difficulty:

1. Camera scrolls right. The parser's next record is the one at column 77. While
   `ScreenRight + 48 < 77·16` it branches to `CheckFrenzyBuffer` and does not
   advance — so it stays parked there as the screen passes column 71.
2. At `ScreenRight ≈ 74·16` the col-77 record is finally consumed: spawned in hard
   mode, skipped at `Inc2B` in normal mode. Either way the offset advances.
3. The parser now reads the col-71 record. `71·16 < ScreenRight ≈ 74·16`, so carry
   is clear, and it falls through to `Inc2B`. **Never spawned, in either mode.**

The threshold is `column < previousColumn − 3` (the 48 pixels of extended
boundary). 71 < 77 − 3 = 74, so it is dead by a clear margin, not a borderline case.

## How general is this?

I scanned every area's enemy stream for records that sit below the highest column
seen before them:

```
2-2/7-2   WaterArea2   DEAD blooper@71 (after 77)
certainly-dead records: 1   borderline: 0
```

**One record in the whole game.** So the eager-instantiation difference the brief
anticipated is real as a mechanism, and worth writing down — *any* enemy record
placed behind an earlier record's column is invisible in the original and visible
in ours — but Nintendo left exactly one such record in the data. There is no
hidden population of these.

It is also worth noting what the mechanism does *not* cover: it is about stream
order, not about the camera generally. Enemies whose records are in ascending
order all spawn in the original too, just later than we spawn them. This is not an
argument that our eager instantiation is wrong in general.

## Behaviour today

Present in **2-2 and 7-2 both** — the record is not hard-only, so the flag is
irrelevant to it. Measured: it starts at (71, 8.5) with `solidAt` true and drifts
out to x 69.59 over 60 frames, so it extracts itself rather than sticking. It is a
blooper that appears out of a wall in a level where the original has none.

## Recommendation — NOT implemented

Drop it at build time, in `smb-build.mjs`, by reproducing the parser's own rule:
skip an enemy record whose column is more than three below the highest column seen
so far in the stream. One condition, one comment citing asm:7943-7956, and it is
self-limiting — the scan above proves it can only ever match this one record, so
it cannot quietly delete anything else now or after a future decode change.

Two things to know before doing it:

* It changes **2-2 and 7-2**, removing one blooper from each. Both need
  regenerating.
* Do it in the builder, not at spawn time. Modelling the camera-relative parse
  properly in `World` would be the general fix, but it is a large change to
  entity lifetime for a single enemy, and it would alter when every enemy in the
  game comes into existence.

I have not made either change.
