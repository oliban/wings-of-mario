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

**`destroyTiles` vs. `applyDamage`, and `contents`:** `destroyTiles` only
records a key in `this.damage` for a tile it actually cleared (solid,
platform or climb); a splash into open air, a free coin, a lava pool or a
hidden block it left alone is never recorded. `applyDamage` then clears every
recorded key unconditionally on load — safe only because the two agree on
what "recorded" means. `destroyTiles` also calls
`this.contents.delete(tileKey(tx, ty))`, but `applyDamage` does not: this
looks like the same asymmetry and is not. `_buildContents` runs later in
`loadLevel` and repopulates `this.contents` from the level's own data
regardless of damage, so a restored `contents` entry over a cleared tile is
inert — every reader of `contents` (block bump, item spawn) requires the
underlying tile to be non-air first, and damaged tiles stay air. Nothing
needs to delete on load.

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
