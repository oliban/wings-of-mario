import { TILE } from '../core/constants.js';
import { tileForChar, CHAR_TO_TILE } from '../data/tiles.js';

// The characters nothing is ever drawn for: the hidden 1UP block and the
// hidden coin. Mirrors INVISIBLE in src/wings/art/mario-tiles.js.
const HIDDEN_CHARS = new Set(['1', 'C']);
import { blastTiles, tileKey, parseTileKey } from './blast.js';
import { ISLAND_TOP_Y, worldToLocalTile } from './geo.js';
import { isProtected } from './sanctuary.js';

// What the toolbelt's brick bomb lays. The engine writes this exact character
// (`w.setTile(tx, ty, '=')`, src/game/entities/brickbomb.js) and the pilot's
// island has to report the same one, or the two clients draw different terrain
// from the same key set.
export const BUILT_CHAR = '=';

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
    // Tiles Mario's toolbelt put here that the level never had — the brick
    // bomb's row of five (src/game/entities/brickbomb.js). The static level
    // data is never touched: an island is its level plus these two sets, which
    // is what keeps rebuilding the archipelago free.
    //
    // Disjoint from `destroyed` by construction, so charAt need not care which
    // it consults first. applyDamage and applyBuild are the only two writers
    // and each takes a key out of the other set.
    this.built = new Set();
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
    const key = tileKey(tx, ty);
    // A built brick reports as a brick, and everything downstream follows from
    // that one line: src/wings/art/land.js paints whatever charAt says, so it
    // is drawn; blocksTile reads it, so the aeroplane hits it; and
    // destructibleTile reads it, so a bomb takes it. Nothing else in the pilot's
    // client needed to learn what a brick bomb is.
    if (this.built.has(key)) return BUILT_CHAR;
    if (this.destroyed.has(key)) return '.';
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
  // WHAT THE AEROPLANE CAN FLY INTO — which is not the same as what is solid.
  //
  // '1' and 'C' are HIDDEN blocks: the extra life and the hidden coin. They are
  // solid to Mario, who discovers them by jumping into one, and they are drawn
  // by nothing at all. An aeroplane hitting one exploded against empty sky:
  // "the plane explodes mid-air here... it is hitting the invisible brick that
  // yields an extra life."
  //
  // Being killed by something the screen does not show is not difficulty, it is
  // a lie. They stay solid for everything else — Mario still finds them, bombs
  // still take them — but they are air as far as the aeroplane is concerned.
  //
  // The set is the renderer's own INVISIBLE list from art/mario-tiles.js, which
  // is the definition of "nothing is drawn here", copied for the same reason
  // geo.js copies the deck's thickness: the simulation must not import the art.
  blocksAircraftTile(tx, ty) {
    if (HIDDEN_CHARS.has(this.charAt(tx, ty))) return false;
    return this.blocksTile(tx, ty);
  }

  blocksAircraftAt(px, py) {
    const { tx, ty } = worldToLocalTile(this.originX, px, py);
    return this.blocksAircraftTile(tx, ty);
  }

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
      if (!this.inRange(tx, ty)) continue;
      // A bomb into a brick row takes the bricks out. The two sets are kept
      // disjoint HERE as well as on the wire, so an island rebuilt from two
      // key lists in either order ends up in the same state as one that
      // watched them arrive live.
      this.built.delete(key);
      this.destroyed.add(key);
    }
  }

  // The other direction: the row a brick bomb laid. Same silence and the same
  // disjointness — a brick fills the crater it was laid in.
  applyBuild(keys) {
    for (const key of keys) {
      const parsed = parseTileKey(key);
      if (!parsed) continue;
      const { tx, ty } = parsed;
      if (!this.inRange(tx, ty)) continue;
      this.destroyed.delete(key);
      this.built.add(key);
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
      // destructibleTile reads charAt, so a built brick answers as a brick and
      // is taken like any other. It leaves the built set as it joins the
      // destroyed one.
      if (!this.destructibleTile(tx, ty)) continue;
      this.built.delete(key);
      this.destroyed.add(key);
      changed.push(key);
    }
    return changed;
  }

  keys() {
    return [...this.destroyed].sort();
  }

  builtKeys() {
    return [...this.built].sort();
  }
}

export default Island;
