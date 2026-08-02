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

## `src/main.js` — scripted destruction

**Why:** Browser tests and the network layer detonate from outside the engine.

**Changed:**
- `window.__GAME.loadLevel(id, areaId)` gained an optional third parameter,
  `damage`, an array of tile keys applied right after the level loads. The first
  two parameters are unchanged, so `tools/shot.mjs` is unaffected.
- Added `blast()`, `destroyTiles()` and `damageKeys()` members.

**On conflict:** upstream owns this block per ARCHITECTURE.md section 10. Keep
their version of every pre-existing member and re-add ours.
