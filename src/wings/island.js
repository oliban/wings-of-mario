import { TILE } from '../core/constants.js';
import { tileForChar, CHAR_TO_TILE } from '../data/tiles.js';
import { blastTiles, tileKey, parseTileKey } from './blast.js';
import { ISLAND_TOP_Y, worldToLocalTile } from './geo.js';
import { isProtected } from './sanctuary.js';

// An unmodified upstream level placed in the ocean as a 15-row band whose
// bottom row sits at sea level. The pilot never loads a Mario World: an
// island is the level definition plus its destroyed-set and nothing else,
// which is what makes bombing one nobody is standing on nearly free.
export class Island {
  constructor(level, originX, damage = []) {
    this.id = level.id;
    this.level = level;
    this.originX = originX;
    this.rows = level.tiles;
    this.w = level.width;
    this.h = level.tiles.length;
    this.destroyed = new Set();
    if (damage.length) this.applyDamage(damage);
  }

  get x0() {
    return this.originX;
  }

  get x1() {
    return this.originX + this.w * TILE;
  }

  get y0() {
    return ISLAND_TOP_Y;
  }

  get y1() {
    return ISLAND_TOP_Y + this.h * TILE;
  }

  inRange(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h;
  }

  charAt(tx, ty) {
    if (!this.inRange(tx, ty)) return '.';
    if (this.destroyed.has(tileKey(tx, ty))) return '.';
    return this.rows[ty][tx];
  }

  // A character the legend has never heard of. World's `_makeRec` tags these
  // `{ name: 'air', unknown: true }` — same name as real air, but still a
  // real (if unrecognised) tile. `tileForChar` folds an unknown char to id 0
  // (plain air) with no such flag, so the unknown case has to be caught here,
  // separately, before it is ever handed to `tileForChar`.
  _unknown(ch) {
    return !(ch in CHAR_TO_TILE);
  }

  // What stops an aeroplane: solid tiles and one-way platforms. A plane must
  // not explode against a free-floating coin, a bush, or a tile character
  // nobody defined.
  blocksTile(tx, ty) {
    const ch = this.charAt(tx, ty);
    if (this._unknown(ch)) return false;
    const rec = tileForChar(ch);
    return !!rec.solid || !!rec.platform;
  }

  // What a blast removes: any non-air tile, coins and decor and lava
  // included, PLUS any character the legend doesn't recognise. This is a
  // copy of the predicate in world.destroyTiles() —
  // `rec.name !== 'air' || rec.unknown` — and the two must stay identical or
  // the pilot's crater and Mario's crater diverge, which is how the
  // multiplayer desync hash ends up firing forever.
  //
  // Minus the sanctuary: the tiles around Mario's spawn are not destructible
  // at all (src/wings/sanctuary.js). That exception is NOT re-implemented
  // here — Mario's side and the server import the very same predicate, which
  // is the only reason the two craters can be trusted to match.
  destructibleTile(tx, ty) {
    if (isProtected(this.level, tx, ty)) return false;
    const ch = this.charAt(tx, ty);
    if (this._unknown(ch)) return true;
    return tileForChar(ch).name !== 'air';
  }

  blocksAt(px, py) {
    const { tx, ty } = worldToLocalTile(this.originX, px, py);
    return this.blocksTile(tx, ty);
  }

  contains(px, py) {
    return px >= this.x0 && px < this.x1 && py >= this.y0 && py < this.y1;
  }

  // Silent: used when rebuilding an island that was already bombed.
  applyDamage(keys) {
    for (const key of keys) {
      const parsed = parseTileKey(key);
      if (!parsed) continue;
      const { tx, ty } = parsed;
      if (this.inRange(tx, ty)) this.destroyed.add(key);
    }
  }

  // A live detonation at world pixel (cx, cy). Mirrors world.destroyTiles()
  // exactly: a key already destroyed is skipped outright, and a key that
  // was never anything but air is never recorded at all — recording it
  // would make a later `applyDamage` clear it unconditionally, which is how
  // an untouched lava pool or hidden block would vanish on reload. Only
  // what the blast actually removed is returned.
  blast(cx, cy, radiusTiles) {
    const keys = blastTiles(cx - this.originX, cy - ISLAND_TOP_Y, radiusTiles);
    const changed = [];
    for (const key of keys) {
      const parsed = parseTileKey(key);
      if (!parsed) continue;
      const { tx, ty } = parsed;
      if (!this.inRange(tx, ty)) continue;
      if (this.destroyed.has(key)) continue;
      if (!this.destructibleTile(tx, ty)) continue;
      this.destroyed.add(key);
      changed.push(key);
    }
    return changed;
  }

  keys() {
    return [...this.destroyed].sort();
  }
}

export default Island;
