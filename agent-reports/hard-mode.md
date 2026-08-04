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
