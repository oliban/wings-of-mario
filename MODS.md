# Engine modifications

Wings of Mario is a fork of [mario-game](https://github.com/oliban/mario-game). The
engine is pulled forward with:

    git fetch upstream && git merge upstream/main

Every edit to an upstream file is listed here. Keep this list short — each entry
is a future merge conflict. New code belongs in `src/wings/`, `src/net/` or
`server/`, which upstream has never heard of and can never conflict with.

---

## `src/game/world.js` — destructible terrain

**Why:** Bombs must permanently clear level geometry. The blast maths lives in
`src/wings/blast.js`; only the mutation of the tile map has to happen in-engine.

**Changed:**
- Added `import { blastTiles, parseTileKey } from '../wings/blast.js';`
- Added `this.damage = new Set()` to the constructor.
- Added two lines to `loadLevel`, straight after `this._buildTiles(lvl)`, that
  reset the damage set and re-apply `opts.damage`.
- Added `applyDamage()`, `destroyTiles()` and `blast()` after `breakBlock()`.

**Discrepancy found in Step 6:** `this.contents` is keyed by `blocks.js`'s
`tileKey(tx, ty)`, which packs the coordinates into a number
(`(ty << 12) | (tx & 0xfff)`), not the `` `${tx},${ty}` `` string format used
by `world.damage` and `src/wings/blast.js`. `destroyTiles()` therefore calls
`this.contents.delete(tileKey(tx, ty))` using the `blocks.js` `tileKey` (already
imported in `world.js`) rather than building a template-string key.

**On conflict:** if upstream reworks `_buildTiles` or `loadLevel`, keep the
two-line damage block anchored immediately after the tile map is rebuilt and
before anything reads it.

**Decor and landmarks are snapshots, and `destroyTiles` must rebuild them:**
`this.decor` (built by `_buildDecor()`) and `this.flag`/`this.castleX` (built
by `_findLandmarks()`) are both compiled once from the tile map at load time
and read from that snapshot thereafter — never from the live map. Once the
destroy predicate covers decor and flagpole tiles (see below), a live blast
that clears one of those tiles left the snapshot untouched: a bombed cloud
kept drawing, and a bombed flagpole stayed at its pre-blast height, until the
next `loadLevel` rebuilt both from scratch. `destroyTiles()` now calls
`_buildDecor()` and `_findLandmarks(this.level, this.rootLevel)` whenever it
actually destroys something, so a live blast and a reload agree. The
landmark rebuild is skipped while `this.flagFalling` is true, since
`_findLandmarks` unconditionally resets `flagY` to the pole's resting
position and would yank an in-progress flag-slide animation back up; the
level is already ending at that point, so the pole no longer needs to track
further blasts. `this.climbables` was checked too and needs no such fix — it
holds vine *entities* that self-register via `registerClimbable()`, not a
tile-map snapshot, and tile-based climb checks (the flagpole itself) already
read the live map through `recAt`/`tileAtPixel`.

**`destroyTiles` vs. `applyDamage`, and `contents`:** `destroyTiles` only
records a key in `this.damage` for a tile it actually cleared — any tile
whose record's `name` isn't `'air'`, per the design spec's "no material is
immune"; a splash into open air is the only thing it ever leaves alone.
`applyDamage` then clears every recorded key unconditionally on load — safe
only because the two agree on what "recorded" means. `destroyTiles` also calls
`this.contents.delete(tileKey(tx, ty))`, but `applyDamage` does not: this
looks like the same asymmetry and is not. `_buildContents` runs later in
`loadLevel` and repopulates `this.contents` from the level's own data
regardless of damage, so a restored `contents` entry over a cleared tile is
inert — every reader of `contents` (block bump, item spawn) requires the
underlying tile to be non-air first, and damaged tiles stay air. Nothing
needs to delete on load.

**Known, deliberate gaps left for the networking plan:**
- `applyDamage` silently drops a key whose tile falls outside `this.w`/`this.h`
  instead of recording it in `this.damage` — correct for the tile map, but it
  means a key the server holds and this client's map can't accommodate never
  joins the damage set, which a wire-format hash comparator would read as
  permanent desync. Plan 3 owns the decision of whether out-of-bounds keys
  should still be recorded (unapplied) so the hash matches the server.
- `DamageMap` (`src/wings/damage.js`) is not wired to `world.damage` — nothing
  in `src/` imports it, and `world.js` keeps its own plain `Set`. There are
  therefore two independent dedup mechanisms today (`DamageMap.add()` returns
  newly-*added* keys; `World.destroyTiles()` returns actually-*destroyed*
  keys — not the same predicate). Plan 3 owns picking which is authoritative
  and writing the adapter between them.

## `src/main.js` — scripted destruction

**Why:** Browser tests and the network layer detonate from outside the engine.

**Changed:**
- `window.__GAME.loadLevel(id, areaId, damage)` keeps its outer shape — an
  optional third parameter, `damage`, an array of tile keys — but now forwards
  it to `game.loadLevel` as `opts.damage` instead of applying it after the load
  returns. `world.loadLevel` subtracts the damage immediately after the tile
  map is rebuilt, before decor, contents, landmarks, the player or the level's
  entities are read, so all of them see the cratered map rather than the
  original one. `tools/shot.mjs` is unaffected: it never passes a third
  argument.
- Added `blast()`, `destroyTiles()` and `damageKeys()` members.

**On conflict:** upstream owns this block per ARCHITECTURE.md section 10. Keep
their version of every pre-existing member and re-add ours.

---

## `index.html` — bomb-test debug panel hook

**Why:** A clickable stand-in for the plane, so destructible terrain can be
play-tested before the pilot exists. All of its logic and styling lives in
`src/wings/debug-panel.js`, which builds its own DOM and never touches the
game's modules except through `window.__GAME`.

**Changed:**
- Added one line after the `src/main.js` script tag:
  `<script type="module" src="./src/wings/debug-panel.js"></script>`.

**On conflict:** keep this as the last `<script>` in `<body>`, after
`src/main.js` — the panel reads `window.__GAME`, which `src/main.js` only
assigns once its own module body has finished running, and module scripts on
a page execute in document order.
