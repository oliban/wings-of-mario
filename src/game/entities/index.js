// Enemy roster: imports every enemy module (each self-registers with the
// entity registry in ../entity.js) and exposes the shared runtime toolkit the
// enemy modules use.
//
// MODULE CYCLE CONTRACT — read before editing:
// The enemy modules import helpers from this file while this file imports them
// back. During the cycle only *function declarations* are initialised, so:
//   1. Only `export function` bindings may be imported by an enemy module.
//   2. A helper an enemy module calls at MODULE-EVALUATION time (pickAnim /
//      pickSprite / fallbackArt) must touch nothing but its own arguments and
//      its own locals. Helpers only ever called from update()/draw() are free
//      to use module state.
// Exporting a const/let/class that an enemy module touches throws a TDZ
// ReferenceError at boot.

import { makeSprite, Anim } from '../../core/gfx.js';
import { entityRegistry } from '../entity.js';
import { PHYS } from '../physics.js';
import { groundTile, tileSolid, tilePlatform } from '../collision.js';

import Goomba from './goomba.js';
import Koopa from './koopa.js';
import Shell from './shell.js';
import Buzzy from './buzzy.js';
import Spiny from './spiny.js';
import Lakitu from './lakitu.js';
import Piranha from './piranha.js';
import BulletBill from './bulletbill.js';
import Cheep from './cheep.js';
import Frenzy from './frenzy.js';
import Blooper from './blooper.js';
import Podoboo from './podoboo.js';
import HammerBro from './hammerbro.js';
import Bowser, { BowserFire } from './bowser.js';

// The thrown hammer is a shared projectile with its own module; world.js does
// not import it, so the enemy roster pulls it in to register the type.
import './hammer.js';

// ---------------------------------------------------------------------------
// Tunables. Pixels per frame / pixels per frame squared at 60.0988 Hz.
//
// These are accessors onto ../physics.js — the single authority — and never
// values of their own. They stay *functions* because the enemy modules import
// them across the module cycle (see the contract above); a re-exported const
// would be in its TDZ when an enemy module is the entry point.
// ---------------------------------------------------------------------------

export function walkSpeed() {
  return PHYS.enemyWalkSpeed;
}
export function shellSpeed() {
  return PHYS.shellSpeed;
}
export function enemyGravity() {
  return PHYS.enemyGravity;
}
export function enemyMaxFall() {
  return PHYS.enemyMaxFall;
}

// The floatey-number table (smbdis.asm:1262 FloateyNumTileData), indexed from
// zero. Matches STOMP_SCORES in ../player.js entry for entry.
export function chainScore(i) {
  const CHAIN = [100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000];
  return CHAIN[Math.min(i | 0, CHAIN.length - 1)];
}

// A kicked shell mowing enemies down starts four table entries in, not at the
// top: ShellCollisions (smbdis.asm:11642) does `lda ShellChainCounter,x /
// adc #$04`, so the chain runs 500, 800, 1000, 2000, 4000, 5000, 8000. Past
// that FloateyNumbersRoutine (smbdis.asm:1283) clamps the index at $0b, the
// 1-UP entry, which keeps paying a life for every further enemy.
// world.addScore() turns the '1UP' sentinel into a life.
export function shellChainScore(i) {
  const j = (i | 0) + 3;
  return j > 9 ? '1UP' : chainScore(j);
}

// ---------------------------------------------------------------------------
// Art resolution.
//
// Called at module-evaluation time by the enemy modules, so these must stay
// pure functions of their arguments (see the cycle contract above).
// `names` may use dotted paths into an exported object: 'KOOPA_GREEN.walk'.
// ---------------------------------------------------------------------------

function readPath(sheet, name) {
  if (!sheet) return undefined;
  if (name.indexOf('.') < 0) return sheet[name];
  const parts = name.split('.');
  let v = sheet[parts[0]];
  for (let i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
  return v;
}

function lookup(sheets, names) {
  const list = Array.isArray(sheets) ? sheets : [sheets];
  for (let s = 0; s < list.length; s++) {
    for (let i = 0; i < names.length; i++) {
      const v = readPath(list[s], names[i]);
      if (v != null) return v;
    }
  }
  return null;
}

function isSprite(v) {
  return !!v && typeof v.draw === 'function' && typeof v.w === 'number';
}

function isAnim(v) {
  return !!v && typeof v.frame === 'function' && Array.isArray(v.frames);
}

// Resolve an Anim from a sprite sheet, accepting an Anim, a Sprite or an array
// of Sprites under any of `names`. `fallback` is an Anim, a Sprite, or a
// zero-argument factory returning either.
export function pickAnim(sheets, names, fallback, hold) {
  const v = lookup(sheets, names);
  if (isAnim(v)) return v;
  if (isSprite(v)) return new Anim([v], hold || 8);
  if (Array.isArray(v) && v.length && isSprite(v[0])) return new Anim(v, hold || 8);
  const fb = typeof fallback === 'function' ? fallback() : fallback;
  if (isAnim(fb)) return fb;
  if (isSprite(fb)) return new Anim([fb], hold || 8);
  if (Array.isArray(fb) && fb.length && isSprite(fb[0])) return new Anim(fb, hold || 8);
  return new Anim([fallbackArt('blob')], hold || 8);
}

export function pickSprite(sheets, names, fallback) {
  const v = lookup(sheets, names);
  if (isSprite(v)) return v;
  if (isAnim(v)) return v.frames[0];
  if (Array.isArray(v) && v.length && isSprite(v[0])) return v[0];
  const fb = typeof fallback === 'function' ? fallback() : fallback;
  if (isSprite(fb)) return fb;
  if (isAnim(fb)) return fb.frames[0];
  if (Array.isArray(fb) && fb.length && isSprite(fb[0])) return fb[0];
  return fallbackArt('blob');
}

// Last-resort art, used only if an art module renames an export out from under
// us. Everything is authored here rather than drawn as a rectangle. Rows and
// palette are function locals so this is safe to call during the module cycle.
export function fallbackArt(kind) {
  const cache = fallbackArt._cache || (fallbackArt._cache = new Map());
  const hit = cache.get(kind);
  if (hit) return hit;

  const PAL = ['#1a1008', '#5a2d0c', '#96541b', '#c88a3a', '#f0c078', '#ffffff', '#12080a'];
  const BLOB = [
    '.....000000.....',
    '...0444333220...',
    '..044433332220..',
    '.04443333322210.',
    '.04433552255110.',
    '0443336522652110',
    '0443335522552110',
    '0433333332221110',
    '0333332222211110',
    '.03332222111110.',
    '.03222221111110.',
    '..022221111110..',
    '...0221111110...',
    '...0000000000...',
    '..000......000..',
    '..000......000..',
  ];
  const spr = makeSprite(BLOB, PAL, { name: 'fallback-' + kind });
  cache.set(kind, spr);
  return spr;
}

// ---------------------------------------------------------------------------
// World adapters (runtime only).
// ---------------------------------------------------------------------------

export function frozen(world) {
  return !!world && (world.freezeTimer | 0) > 0;
}

export function sfx(world, name) {
  const a = world && world.audio;
  if (a && typeof a.sfx === 'function') {
    try {
      a.sfx(name);
    } catch (err) {
      /* audio not ready */
    }
  }
}

// world.fx dispatches to the named ParticleSystem effect.
export function fx(world, kind, x, y, opts) {
  if (world && typeof world.fx === 'function') world.fx(kind, x, y, opts);
}

export function addScore(world, n, x, y) {
  if (world && n && typeof world.addScore === 'function') world.addScore(n, x, y);
}

export function playerOf(world) {
  return (world && world.player) || null;
}

// Every player currently on the field. playerOf() returns only world.player,
// which in co-op is one of the two brothers — fine for "who do I chase", wrong
// for "is it safe to sprout here", where ignoring the other brother means
// growing straight through him.
export function playersOf(world) {
  if (!world) return [];
  const roster = world.players;
  if (Array.isArray(roster) && roster.length) return roster.filter(Boolean);
  return world.player ? [world.player] : [];
}

export function hurtPlayer(e) {
  const w = e && e.world;
  if (w && typeof w.hurtPlayer === 'function') w.hurtPlayer(e);
}

export function isStarPlayer(p) {
  return !!p && (p.invincible === true || (p.starFrames | 0) > 0 || (p.star | 0) > 0);
}

// Star Mario kills on contact. The world hands every non-stomp overlap to
// onPlayerTouch without inspecting invincibility, so the enemy decides.
// Returns true when the touch was resolved by the star.
export function starTouch(e, player, score) {
  if (!isStarPlayer(player)) return false;
  enemyDie(e, 'shell', player, score == null ? 200 : score);
  return true;
}

export function spawnAt(world, type, x, y, opts) {
  if (world && typeof world.spawn === 'function') return world.spawn(type, x, y, opts);
  return null;
}

// ---------------------------------------------------------------------------
// Shared enemy behaviour.
// ---------------------------------------------------------------------------

// The standard non-stomp death: pop up, flip onto its back, tumble away.
// Entity.kill() owns the corpse physics; this adds the feedback around it.
//
// `score` is per killer, and the original does not use one value for all of
// them: a fire or shell kill pays ShellOrBlockDefeat's 200 (100 goomba, 1000
// hammer bro, smbdis.asm:11172), while a block bumped out from under an enemy
// pays GiveOEPoints' flat 100 for every enemy alike (smbdis.asm:12451). Keep
// the onBlockBump/onBumped handlers at 100 across the roster.
export function enemyDie(e, style, by, score) {
  if (e.dead) return false;
  e.kill(style === 'fireball' ? 'fireball' : 'shell', by || null);
  fx(e.world, 'enemyPoof', e.x + e.w * 0.5, e.y + e.h * 0.5);
  if (score) addScore(e.world, score, e.x + e.w * 0.5, e.y);
  sfx(e.world, 'kick');
  return true;
}

// Is there floor under the enemy's own CENTRE? This is the ledge test, and it is
// deliberately not a look-ahead: ChkForRedKoopa (smbdis.asm:12572-12576) is only
// reached from NoEToBGCollision — when ChkUnderEnemy (asm:12707) found nothing —
// and that probe uses offset $15, the BOTTOM MIDDLE (8,18) of the enemy. A red
// koopa therefore keeps walking until its own centre clears the lip, visibly
// overhanging the gap, and turns only then. Probing past its leading edge instead
// turned it about ten pixels early, so it never stepped out over the edge at all.
// One-way platforms count as floor, exactly as hasGroundAhead has always had it.
function groundUnderCentre(e) {
  const t = groundTile(e.world, e, 2);
  return tileSolid(t) || tilePlatform(t);
}

// One tick of ground patrol: gravity, tile resolve, turn at walls and
// (optionally) at ledges. Returns the collision result.
export function walkStep(e, opts) {
  const o = opts || {};
  const speed = o.speed == null ? PHYS.enemyWalkSpeed : o.speed;
  e.applyGravity(
    o.gravity == null ? PHYS.enemyGravity : o.gravity,
    o.maxFall == null ? PHYS.enemyMaxFall : o.maxFall
  );
  if (o.turnAtLedge && e.grounded && !groundUnderCentre(e)) e.facing = -e.facing;
  e.vx = speed * e.facing;
  const col = e.moveAndCollide();
  if (col.hitLeft || col.hitRight) {
    e.facing = col.hitLeft ? 1 : -1;
    e.vx = speed * e.facing;
  }
  return col;
}

// Walking enemies reverse off one another, the way SMB shuffles a goomba pair.
export function enemyBump(e) {
  const list = e.world && e.world.entities;
  if (!list) return false;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o === e || !o || o.removed || o.dead || !o.isWalker || !e.isWalker) continue;
    if (!e.hits(o)) continue;
    if (e.centerX <= o.centerX) {
      if (e.facing > 0) e.facing = -1;
      if (o.facing < 0) o.facing = 1;
    } else {
      if (e.facing < 0) e.facing = 1;
      if (o.facing > 0) o.facing = -1;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Roster. world.js reads ENTITY_TYPES to build its spawn table.
// ---------------------------------------------------------------------------

// Static roster published for world.js. It is snapshotted from the live
// registry in ../entity.js — which every enemy module above populates as it
// evaluates — and never built by reading the class bindings directly: when an
// enemy module is the entry point this file's body runs mid-cycle, and reading
// `Goomba` here would throw a TDZ ReferenceError.
//
// world.js resolves types through entity.js's live registry first, so this is
// only ever a convenience mirror.
export const ENTITY_TYPES = Object.fromEntries(entityRegistry());
export const ENTITIES = ENTITY_TYPES;

export {
  Goomba,
  Koopa,
  Shell,
  Buzzy,
  Spiny,
  Lakitu,
  Piranha,
  BulletBill,
  Cheep,
  Frenzy,
  Blooper,
  Podoboo,
  HammerBro,
  Bowser,
  BowserFire,
};

export default ENTITY_TYPES;
