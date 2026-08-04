// Mario.
//
// One state machine over (small | big | fire) x (idle, walk, run, skid, jump, fall, duck,
// swim, climb, pipe, growing, shrinking, star, dying, level-complete).
//
// Units: pixels and pixels-per-frame at the fixed 60.0988 Hz step. Nothing here is ever
// multiplied by dt. Every tunable comes out of src/game/physics.js; the FALLBACK table at
// the top is only consulted when physics.js does not export a given name, so this module
// still runs (with authentic SMB values) while that file is being written.

import { TILE, SCREEN_W, SCREEN_H } from '../core/constants.js';
import input, { BTN } from '../core/input.js';
import { Anim } from '../core/gfx.js';
import * as EntityMod from './entity.js';
import * as Phys from './physics.js';
import * as MarioArt from '../data/sprites/mario.js';
import * as LuigiArt from '../data/sprites/luigi.js';

const EntityBase = EntityMod.default || EntityMod.Entity;

// ---------------------------------------------------------------------------
// tiny helpers
// ---------------------------------------------------------------------------

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

function hasAny(obj, names) {
  if (!obj) return null;
  for (const n of names) if (typeof obj[n] === 'function') return n;
  return null;
}

function callAny(obj, names, ...args) {
  const n = hasAny(obj, names);
  if (!n) return undefined;
  try {
    return obj[n](...args);
  } catch (e) {
    console.warn(`[player] world.${n}() threw`, e);
    return undefined;
  }
}

// --- audio -----------------------------------------------------------------
// The audio agent owns the module path; resolve it lazily so a missing file can
// never take the whole game down.

let _audio = null;
let _audioProbed = false;

function audioOf(world) {
  if (world && world.audio) return world.audio;
  if (_audio) return _audio;
  if (!_audioProbed) {
    _audioProbed = true;
    for (const p of ['../audio/engine.js', '../audio/sfx.js', '../audio/music.js']) {
      import(p)
        .then((m) => {
          if (_audio) return;
          const c = m.Audio || m.audio || m.default;
          if (c && (typeof c.sfx === 'function' || typeof c.play === 'function')) _audio = c;
        })
        .catch(() => {});
    }
  }
  return _audio;
}

function pickSfxName(a, names) {
  const table = a.SFX || a.sfxTable || a.sounds || a.table;
  if (table) for (const n of names) if (table[n]) return n;
  return names[0];
}

function sfx(world, ...names) {
  const a = audioOf(world);
  if (!a) return;
  const f = a.sfx || a.play || a.playSfx;
  if (typeof f !== 'function') return;
  try {
    f.call(a, pickSfxName(a, names));
  } catch (e) {
    /* audio must never break gameplay */
  }
}

function music(world, name) {
  const a = audioOf(world);
  if (!a || typeof a.music !== 'function') return;
  try {
    a.music(name);
  } catch (e) {
    /* ignore */
  }
}

// --- particles -------------------------------------------------------------
//
// `kind` is always a ParticleSystem method name (landingDust, skidDust,
// enemyPoof, ...). world.fx() is the contracted entry point; the direct call is
// only a fallback for a world that predates it. Never guess a name: an unknown
// kind is a no-op, not a particle at the world origin.

function fx(world, kind, x, y, a, b) {
  if (!world) return null;
  if (typeof world.fx === 'function') {
    try {
      return world.fx(kind, x, y, a, b);
    } catch (e) {
      return null;
    }
  }
  const ps = world.particles;
  if (!ps || typeof ps[kind] !== 'function') return null;
  try {
    return ps[kind](x, y, a, b);
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// physics constants
// ---------------------------------------------------------------------------

const PHYS_SRC = [
  Phys,
  Phys.default,
  Phys.PHYS,
  Phys.PHYSICS,
  Phys.PLAYER,
  Phys.PLAYER_PHYS,
  Phys.MARIO,
  Phys.P,
].filter((s) => s && typeof s === 'object');

function pnum(fallback, ...names) {
  for (const src of PHYS_SRC) {
    for (const n of names) {
      const v = src[n];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  return fallback;
}

function pfn(...names) {
  for (const src of PHYS_SRC) {
    for (const n of names) {
      const v = src[n];
      if (typeof v === 'function') return v;
    }
  }
  return null;
}

// Authentic SMB values (px/frame, px/frame^2) used only where physics.js is silent.
const P = {
  minWalk: pnum(0.07421875, 'minWalkSpeed', 'playerMinWalk', 'minWalk', 'MIN_WALK'),
  maxWalk: pnum(1.5625, 'maxWalkSpeed', 'playerMaxWalk', 'maxWalk', 'walkMax', 'MAX_WALK'),
  maxRun: pnum(2.5625, 'maxRunSpeed', 'playerMaxRun', 'maxRun', 'runMax', 'MAX_RUN'),
  walkAccel: pnum(0.037109375, 'walkAccel', 'playerWalkAccel', 'walkAcceleration', 'WALK_ACCEL'),
  runAccel: pnum(0.0556640625, 'runAccel', 'playerRunAccel', 'runAcceleration', 'RUN_ACCEL'),
  friction: pnum(0.05078125, 'releaseDecel', 'friction', 'playerFriction', 'groundDecel', 'FRICTION'),
  skidDecel: pnum(0.1015625, 'skidDecel', 'playerSkidDecel', 'skidDeceleration', 'SKID_DECEL'),
  skidTurn: pnum(0.5625, 'skidTurnSpeed', 'skidTurnaround', 'turnAroundSpeed', 'SKID_TURN'),
  // Air acceleration is the ground acceleration in SMB — same two rates, picked by the
  // latched airborne speed instead of the run button (see _groundAirHorizontal).
  airAccel: pnum(0.0369873046875, 'walkAccel', 'airAccel', 'playerAirAccel', 'AIR_ACCEL'),
  airRunAccel: pnum(0.0555419921875, 'runAccel', 'airRunAccel', 'playerAirRunAccel', 'AIR_RUN_ACCEL'),
  airTurnDecel: pnum(0.1015625, 'airTurnDecel', 'airSkidDecel', 'airTurnaround', 'skidDecel', 'AIR_TURN_DECEL'),
  airTurnFast: pnum(1.8125, 'airTurnFastSpeed', 'airFastThreshold'),

  gravity: pnum(0.4375, 'playerGravity', 'gravity', 'fallGravity', 'GRAVITY'),
  gravityHold: pnum(0.125, 'playerJumpGravity', 'jumpGravity', 'gravityHeld', 'holdGravity'),
  maxFall: pnum(4.5, 'maxFallSpeed', 'playerMaxFall', 'terminalVelocity', 'MAX_FALL'),

  // physics.js names the WEAK bounce 'stompBounceWeak' and the held one 'stompBounce'.
  stompBounce: pnum(-2.5, 'stompBounceWeak', 'playerStompBounce', 'bounceVelocity'),
  stompBounceHeld: pnum(-4.0, 'stompBounce', 'stompBounceHeld', 'playerStompBounceHeld', 'bounceVelocityHeld'),

  // Swimming is index 5 of the jump/fall force tables (smbdis.asm:6014-6024, selected
  // at 6110-6123), and it uses the SAME two-force scheme as a jump: JumpMForceData[5]
  // = $0d/256 while the stroke button is still down, FallMForceData[5] = $0a/256 once
  // it is released or you are sinking (JumpSwimSub, smbdis.asm:5921-5935). A held
  // stroke therefore rises 1.5^2 / (2*0.05078125) = 22px = 1.4 tiles; tapped, 28.8px.
  //
  // waterGravity in physics.js is 0.09375 = $18, which is the force the original
  // switches to ABOVE the swimming ceiling (smbdis.asm:5940-5946) — a hard pull back
  // down — not the ordinary swim force. It is kept here under that meaning; using it
  // everywhere is what made every stroke worth 0.69 tiles instead of 1.4.
  swimRiseGravity: pnum(0.05078125, 'waterRiseGravity', 'swimRiseGravity'),
  swimSinkGravity: pnum(0.0390625, 'waterSinkGravity', 'swimSinkGravity'),
  swimCeilingGravity: pnum(0.09375, 'waterGravity', 'swimGravity', 'playerSwimGravity'),
  // Player_Y_Position < $14 is "above water level" to the original (smbdis.asm:5939,
  // 6127). Our y is the top of the hitbox, as Player_Y_Position is.
  swimCeilingY: pnum(20, 'swimCeilingY', 'waterCeilingY'),
  swimStroke: pnum(-1.5, 'strokeVelocity', 'swimStroke', 'swimImpulse'),
  swimStrokeSurface: pnum(-1.0, 'strokeVelocityAtTop', 'swimStrokeSurface', 'surfaceStroke'),
  swimMaxRise: pnum(-2.0, 'swimMaxRise', 'swimRiseCap'),
  swimMaxFall: pnum(2.0, 'waterMaxFallSpeed', 'swimMaxFall', 'swimFallCap', 'waterMaxFall'),
  swimAccel: pnum(0.024, 'swimAccel', 'waterAccel'),
  swimFriction: pnum(0.0165, 'swimFriction', 'waterFriction'),
  swimMaxSpeed: pnum(1.125, 'maxUnderwaterSpeed', 'swimMaxSpeed', 'waterMaxSpeed'),

  deathRise: pnum(-4.0, 'playerDeathRise', 'deathRise', 'deathJump', 'DEATH_RISE'),
  deathGravity: pnum(0.1875, 'playerDeathGravity', 'deathGravity'),
  deathFreeze: pnum(30, 'playerDeathFreeze', 'deathFreeze', 'deathPause'),

  // Beanstalk. The climb is slower than the flagpole slide — SMB's vine is a
  // deliberate, unhurried ascent — and letting go gives a small hop so you clear
  // the vine instead of being caught again on the way down.
  climbSpeed: pnum(1.0, 'vineClimbSpeed', 'climbSpeed', 'ladderSpeed'),
  vineHop: pnum(-2.0, 'vineReleaseRise', 'vineHop'),
  vinePush: pnum(1.0, 'vineReleasePush', 'vinePush'),

  flagSlide: pnum(2.0, 'flagpoleSlide', 'flagSlideSpeed', 'poleSlideSpeed'),
  flagWalk: pnum(1.0, 'flagWalkSpeed', 'levelEndWalkSpeed', 'walkOffSpeed'),

  pipeFrames: pnum(30, 'pipeEnterFrames', 'pipeFrames', 'warpFrames'),
  growFrames: pnum(30, 'growFrames', 'powerUpFrames', 'changeSizeFrames'),
  invulnFrames: pnum(90, 'invulnerableFrames', 'invulnFrames', 'hurtInvuln', 'damageInvuln'),
  starFrames: pnum(660, 'starFrames', 'starDuration', 'invincibleFrames'),

  jumpBuffer: pnum(4, 'jumpBufferFrames', 'jumpBuffer'),
  coyote: pnum(4, 'coyoteFrames', 'coyoteTime'),

  // Two on screen is the real limiter, exactly as SMB; the cooldown only stops a
  // single frame from spawning two.
  maxFireballs: pnum(2, 'maxFireballs', 'fireballLimit'),
  fireCooldown: pnum(2, 'fireCooldown', 'throwCooldown'),
};

// Move `current` toward `target` by at most `rate`. physics.js owns the definition;
// the local copy only exists so this module still runs if that export is missing.
const approach =
  pfn('approach') ||
  ((current, target, rate) => {
    const r = rate < 0 ? -rate : rate;
    if (current < target) return Math.min(current + r, target);
    if (current > target) return Math.max(current - r, target);
    return target;
  });

// The launch velocity AND both gravities come from one table row selected by the
// horizontal speed at takeoff. physics.js's jumpVelocityFor(speed) returns that whole
// row as { vy0, gHold, gFall } — never a bare number, so it is consumed directly here
// rather than through the numeric resolver. The row is latched for the whole jump.
// Thresholds are the ROM's, $09/$10/$19/$1c over 16 — see the table in
// physics.js for the derivation. The third is 1.5625 ($19, exactly maxWalk),
// not 2.3125; this copy must not drift from that one.
const FALLBACK_JUMP_ROWS = [
  { at: 0.0, vy0: -4.0, gHold: 0.125, gFall: 0.4375 },
  { at: 1.0, vy0: -4.0, gHold: 0.1171875, gFall: 0.375 },
  { at: 1.5625, vy0: -5.0, gHold: 0.15625, gFall: 0.5625 },
];

function fallbackJumpRow(speed) {
  let row = FALLBACK_JUMP_ROWS[0];
  for (let i = FALLBACK_JUMP_ROWS.length - 1; i >= 0; i--) {
    if (speed >= FALLBACK_JUMP_ROWS[i].at) {
      row = FALLBACK_JUMP_ROWS[i];
      break;
    }
  }
  return { vy0: row.vy0, gHold: row.gHold, gFall: row.gFall };
}

function jumpRowFor(speed) {
  const s = Math.abs(speed);
  const fb = fallbackJumpRow(s);
  if (typeof Phys.jumpVelocityFor !== 'function') return fb;
  let row;
  try {
    row = Phys.jumpVelocityFor(s);
  } catch (e) {
    return fb;
  }
  if (!row || typeof row !== 'object') return fb;
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const vy0 = num(row.vy0, fb.vy0);
  return {
    vy0: vy0 > 0 ? -vy0 : vy0,
    gHold: num(row.gHold, fb.gHold),
    gFall: num(row.gFall, fb.gFall),
  };
}

// Held jump gives the big hop; releasing it gives the weak one.
function stompBounceFor(held) {
  if (typeof Phys.stompBounceFor === 'function') {
    const v = Phys.stompBounceFor(!!held);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return held ? P.stompBounceHeld : P.stompBounce;
}

// ---------------------------------------------------------------------------
// hitboxes / scoring
// ---------------------------------------------------------------------------

// A crouching big player is exactly as short as a small one — not a compromise
// between the two. BoundBoxCtrlData entry 2 (big crouching) is $02,$14,$0e,$20,
// byte for byte the same box as entry 1 (small), and ChkCollSize takes the same
// branch for crouching as for small when it picks the BACKGROUND collision
// offset. So a one-tile gap admits a ducking big player, which is why you can
// slide under a low brick run. _unduck() already refuses to stand back up while
// something is overhead, so he stays down until it is clear.
export const HITBOX = {
  W: 12,
  SMALL_H: 16,
  BIG_H: 32,
  DUCK_H: 16,
};

// One stomp/shell chain table for the whole game. world.js (STOMP_CHAIN) and
// entities/index.js (chainScore) must award exactly these values at the same
// indices; past the end of the table the chain pays a 1-UP instead.
export const STOMP_SCORES = [100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000];

// Not every enemy pays the chain. EnemyStomped (smbdis.asm:11439-11463) compares
// the enemy id against a short list and diverts the matches to EnemyStompedPts,
// which awards StompedEnemyPtsData[y] and returns WITHOUT ever touching
// StompChainCounter — a fixed-value stomp neither reads the chain nor advances
// it, so the next ordinary stomp still pays whatever the chain was owed.
// ChkForDemoteKoopa (asm:11480-11493) does the same with a literal $03.
//
// An entity opts in by setting `stompPoints` to the value it owes; 0, absent or
// nonsense means "pay the chain" and is the default for everything else. It is
// read at award time rather than baked in, so an entity whose worth changes with
// its state (a paratroopa is worth 400 only while it still has its wings) can
// just set it as that state changes.
export function stompPointsOf(entity) {
  const v = entity && entity.stompPoints;
  return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0;
}
// Flagpole bands, in the original's order (FlagpoleScoreMods / FlagpoleScoreDigits,
// smbdis.asm:6573-6577): $05/$02 at digit 3 and $08/$04/$01 at digit 4. FIVE bands
// — there is no 200-point flagpole in SMB. Selected by absolute player Y against
// FLAGPOLE_Y_OFFSETS below, not by fractions of the pole.
export const FLAGPOLE_SCORES = [5000, 2000, 800, 400, 100];

// FlagpoleYPosData (smbdis.asm:12150) .db $18,$22,$50,$68,$90 = y 24/34/80/104/144,
// compared against Player_Y_Position — the TOP of the player, exactly like our
// `this.y`. ChkFlagpoleYPosLoop walks the table from the back and takes the last
// entry the player is at or below, falling back to index 0 for anything higher.
//
// Mapping to our geometry: the pole column itself is pixel-identical to SMB's —
// ball tile top at y=32, shaft down to y=192 (verified on 1-1/2-1/3-1/4-1/8-1) —
// so the thresholds are stored as offsets from the pole's top tile: 24/34/80/104/144
// minus 32. What differs is the floor: ours is one row lower (top y=208 vs SMB's
// 192), and that extra 16px simply widens the bottom band, which is the running-grab
// band anyway. Anchoring to the pole rather than to the floor also keeps the bands
// correct if a level ever hangs its pole at a different height.
const FLAGPOLE_Y_OFFSETS = [-8, 2, 48, 72, 112];

export const POWER = { SMALL: 'small', BIG: 'big', FIRE: 'fire' };

// ---------------------------------------------------------------------------
// sprite set resolution
//
// src/data/sprites/mario.js is authored by another agent; accept any reasonable
// key naming (idle/stand, throw/fire, ...) and either Anims, Sprites or arrays.
// ---------------------------------------------------------------------------

const setCache = new Map();

function normalizeSet(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const cached = setCache.get(raw);
  if (cached) return cached;
  const out = {};
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (!v) continue;
    const key = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    let anim = null;
    if (typeof v.frame === 'function') anim = v;
    else if (typeof v.draw === 'function') anim = Anim.still(v);
    else if (Array.isArray(v) && v.length && v[0] && typeof v[0].draw === 'function') {
      anim = new Anim(v, 6);
    }
    if (anim) out[key] = anim;
  }
  setCache.set(raw, out);
  return out;
}

const SET_RAW = {
  small: MarioArt.SMALL_MARIO || MarioArt.MARIO_SMALL || MarioArt.SMALL,
  big: MarioArt.BIG_MARIO || MarioArt.MARIO_BIG || MarioArt.BIG,
  fire: MarioArt.FIRE_MARIO || MarioArt.MARIO_FIRE || MarioArt.FIRE,
};

const LUIGI_RAW = LuigiArt.LUIGI_SETS || LuigiArt.default || null;

function setFor(power, luigi) {
  if (luigi && LUIGI_RAW) {
    const alt = LUIGI_RAW[power] || LUIGI_RAW.small || LUIGI_RAW.big || LUIGI_RAW.fire;
    if (alt) return normalizeSet(alt);
  }
  const raw = SET_RAW[power] || SET_RAW.small || SET_RAW.big || SET_RAW.fire;
  return normalizeSet(raw);
}

// The half-grown art is published by mario.js as its own top-level export, not as a
// pose inside the small/big/fire sets, so it has to be picked up separately or the
// grow/shrink transition never shows anything but the two end sizes. It is a whole
// authored sequence (small / mid / big interleaved), played forwards while growing
// and backwards while shrinking.
const GROW_FRAMES = (() => {
  const raw =
    MarioArt.GROW_FRAMES || MarioArt.MARIO_GROW || MarioArt.GROW_MARIO || MarioArt.GROW || null;
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const frames = raw.filter((s) => s && typeof s.draw === 'function');
    return frames.length ? frames : null;
  }
  if (Array.isArray(raw.frames) && raw.frames.length) return raw.frames.slice();
  if (typeof raw.draw === 'function') return [raw];
  return null;
})();

const stillCache = new Map();

function stillAnim(sprite) {
  let a = stillCache.get(sprite);
  if (!a) {
    a = Anim.still(sprite);
    stillCache.set(sprite, a);
  }
  return a;
}

const POSE_ALIASES = {
  idle: ['idle', 'stand', 'standing', 'still', 'stop'],
  // walk6 is the smoother six-frame cycle; the three-frame `walk` stays as the
  // fallback so a sprite set that never authored walk6 still animates.
  walk: ['walk6', 'walk', 'walking', 'move'],
  run: ['run', 'walk6', 'walk', 'walking'],
  skid: ['skid', 'turn', 'brake', 'slide', 'skidding'],
  jump: ['jump', 'rise', 'air', 'jumping'],
  fall: ['fall', 'falling', 'jump', 'air'],
  duck: ['duck', 'crouch', 'crouching', 'ducking', 'down'],
  swim: ['swim', 'swimming', 'stroke', 'swimstroke'],
  swimidle: ['swimidle', 'swimglide', 'glide', 'swim'],
  climb: ['climb', 'climbing', 'flagpole', 'pole', 'vine', 'grab'],
  throw: ['throw', 'throwing', 'fire', 'shoot', 'attack', 'cast'],
  die: ['die', 'death', 'dead', 'dying'],
  grow: ['grow', 'mid', 'middle', 'medium', 'transform', 'change'],
};

function pickAnim(set, poseKey) {
  if (!set) return null;
  const names = POSE_ALIASES[poseKey] || [poseKey];
  for (const n of names) if (set[n]) return set[n];
  if (set.idle) return set.idle;
  const keys = Object.keys(set);
  return keys.length ? set[keys[0]] : null;
}

// ---------------------------------------------------------------------------
// star palette cycle
// ---------------------------------------------------------------------------

function parseCss(css) {
  if (typeof css !== 'string') return null;
  let s = css.trim();
  if (s[0] === '#') {
    s = s.slice(1);
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (s.length === 6) s += 'ff';
    if (s.length !== 8) return null;
    return [
      parseInt(s.slice(0, 2), 16),
      parseInt(s.slice(2, 4), 16),
      parseInt(s.slice(4, 6), 16),
      parseInt(s.slice(6, 8), 16),
    ];
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(',').map((v) => parseFloat(v));
    return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? Math.round(p[3] * 255) : 255];
  }
  return null;
}

function hex2(n) {
  const s = clamp(Math.round(n), 0, 255).toString(16);
  return s.length < 2 ? '0' + s : s;
}

function rgb2hsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hsl2rgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}

function rotateHue(css, deg) {
  const c = parseCss(css);
  if (!c) return css;
  const [r, g, b, a] = c;
  // Leave the outline ink alone so the silhouette stays readable at every phase.
  if (Math.max(r, g, b) < 48) return css;
  const [h, s, l] = rgb2hsl(r, g, b);
  const [nr, ng, nb] = hsl2rgb((h + deg / 360 + 1) % 1, Math.min(1, s * 1.15 + 0.12), l);
  return `#${hex2(nr)}${hex2(ng)}${hex2(nb)}${a >= 255 ? '' : hex2(a)}`;
}

const starCache = new Map();
const STAR_ROT = [0, 95, 190, 285];

function starVariant(sprite, phase) {
  const p = phase & 3;
  if (p === 0 || !sprite) return sprite;
  let v = starCache.get(sprite);
  if (!v) {
    v = [sprite, null, null, null];
    starCache.set(sprite, v);
  }
  if (!v[p]) {
    try {
      v[p] = sprite.shift((c) => rotateHue(c, STAR_ROT[p]), `${sprite.name}:star${p}`);
    } catch (e) {
      v[p] = sprite;
    }
  }
  return v[p];
}

// ---------------------------------------------------------------------------
// grow / shrink flicker tables — index into [small, previous/big, mid]
// ---------------------------------------------------------------------------

const GROW_FLICKER = [1, 0, 2, 0, 1, 2, 0, 1, 2, 1];
const SHRINK_FLICKER = [0, 1, 2, 1, 0, 2, 1, 0, 2, 0];

// Tiny downward bias while grounded so the collider keeps reporting contact on
// slopes and moving platforms without ever accumulating fall speed.
const GROUND_STICK = 0.5;

// SMB's foot check reads a block-buffer row quantised to whole tiles, so a body up
// to 4px below a floor surface still finds that floor underfoot; landing then masks
// the low nybble off the vertical position and pops Mario back onto it
// (SMBDIS.ASM DoFootCheck/LandPlyr: `cpy #$05` / `and #$f0`).
const LEDGE_SNAP = 5;

// SMB samples the sides 8px above the feet (BlockBuffer_Y_Adder $08/$18 against the
// $20 foot adder), so the bottom of the body never catches on a ledge face.
const SIDE_FOOT_SKIP = 8;

// ImpedePlayerMove moves Mario ONE PIXEL away from a wall he is pressed into
// every frame the side collision lasts (smbdis.asm:12318-12351), which is what
// stops the original ever leaving him embedded in solid geometry. Player-only:
// the ROM routine is, and resolveX is shared with every enemy.
const SIDE_EJECT = 1;

// ---------------------------------------------------------------------------

export default class Player extends EntityBase {
  static type = 'player';

  constructor(world, x, y, opts = {}) {
    super(world, x, y);
    this.world = world;

    this.power = opts.power || POWER.SMALL;
    this.w = HITBOX.W;
    this.h = this.power === POWER.SMALL ? HITBOX.SMALL_H : HITBOX.BIG_H;
    this.x = x;
    this.y = y;

    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.grounded = false;
    this.dead = false;
    this.removed = false;
    this.hidden = false;

    this.state = 'normal';
    this.stateTimer = 0;
    this.animTick = 0;
    this._cycleRate = null;
    this._lastFootIdx = -1;
    this._animIdx = 0;
    this._animLen = 1;
    this.pose = 'idle';

    this.ducking = false;
    this.skidding = false;
    this.jumping = false;
    this.jumpHeld = false;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this._gHold = P.gravityHold;
    this._gFall = P.gravity;
    // Latched peak |vx| of the current airtime; drives the airborne accel rule.
    this.airSpeed = 0;

    this.inWater = false;
    this.swimTick = 0;

    this.invulnFrames = 0;
    this.starFrames = 0;
    this.starTick = 0;
    this.starChain = 0;
    this.stompChain = 0;
    // StompTimer ($0791). Set when a stomp is absorbed, decremented once per
    // frame like every other frame timer, and read by the collision loop to
    // turn what would be an injury into another stomp — see update() and
    // world._playerEntityCollisions.
    this.stompTimer = 0;

    this.throwTimer = 0;
    this.fireCooldown = 0;
    this.fireballs = [];
    // Mario stages his OWN death (the hop, then the fall off the bottom of the
    // screen) in _updateDying. Entity's default corpse animation would replace
    // that with the enemy flatten-and-vanish and suppress update() entirely, so
    // the body just froze in place where it died.
    this.autoCorpse = false;
    this.persistent = true;
    this.colOpts.footSkip = SIDE_FOOT_SKIP;
    this.colOpts.ejectX = SIDE_EJECT;

    this.walkPhase = 0;
    this.animPhase = 0;
    this.landSquash = 0;
    this.stretch = 0;
    this.dustTimer = 0;
    this._deathCause = null;
    this._deathFreeze = P.deathFreeze;

    this.controlsLocked = false;
    this.intangible = false;
    this.invincible = false;
    this.collidable = true;
    this.noclip = false;
    this.deathReported = false;

    this._prevMusic = null;
    this._grow = null;
    this._flag = null;
    this._pipe = null;
    this._clip = null;
    this._walkOff = null;
    this._wasGrounded = false;
    this._bumpLock = 0;
  }

  // -------------------------------------------------------------------------
  // public surface
  // -------------------------------------------------------------------------

  // Entity's base getter answers this by comparing against `world.player`, which
  // in co-op names only ONE of the two brothers. Every consumer of it asks "is
  // this A player" — may it break a brick, skip it in the axe hazard sweep, keep
  // it safe from despawn — and Luigi answering false to all three made him a
  // second-class brother who could not open a brick wall. `world.player` keeps
  // its own meaning (the primary/camera brother); this is a different question.
  get isPlayer() {
    return true;
  }

  get big() {
    return this.power !== POWER.SMALL;
  }
  get isBig() {
    return this.power !== POWER.SMALL;
  }
  get isSmall() {
    return this.power === POWER.SMALL;
  }
  get isFire() {
    return this.power === POWER.FIRE;
  }
  get starPower() {
    return this.starFrames > 0;
  }
  get busy() {
    return this.state !== 'normal';
  }

  isInvincible() {
    return this.starFrames > 0;
  }
  isIntangible() {
    return this.intangible;
  }
  canBeHurt() {
    return !this.intangible && this.state === 'normal' && !this.dead;
  }

  // Instant power change, no animation. Used by the debug API and by respawn.
  setPower(name) {
    if (name === 'star') {
      this.giveStar();
      return;
    }
    const p = name === POWER.FIRE ? POWER.FIRE : name === POWER.BIG ? POWER.BIG : POWER.SMALL;
    const wasBig = this.big;
    this.power = p;
    if (this.big && !wasBig) this._setHeight(HITBOX.BIG_H, true);
    else if (!this.big && wasBig) this._setHeight(HITBOX.SMALL_H, false);
    this.ducking = false;
  }

  // Reposition for a level (re)start. `x, y` is the top-left of the hitbox at
  // whatever size the given power implies.
  respawn(x, y, power) {
    if (power) this.power = power === 'star' ? this.power : power;
    this.h = this.big ? HITBOX.BIG_H : HITBOX.SMALL_H;
    this.w = HITBOX.W;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.state = 'normal';
    this.stateTimer = 0;
    this.hidden = false;
    this.dead = false;
    this.removed = false;
    this.deathReported = false;
    this.ducking = false;
    this.jumping = false;
    this.grounded = false;
    this.invulnFrames = 0;
    this.starFrames = 0;
    this.stompChain = 0;
    this.starChain = 0;
    this.stompTimer = 0;
    this.fireballs.length = 0;
    this.controlsLocked = false;
    this._clip = null;
    this._flag = null;
    this._pipe = null;
    this._grow = null;
    this._walkOff = null;
    this.airSpeed = 0;
    this._gHold = P.gravityHold;
    this._gFall = P.gravity;
    this.walkPhase = 0;
    this.pose = 'idle';
  }
  reset(x, y, power) {
    this.respawn(x, y, power);
  }

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  update() {
    // `this.tick` is advanced by the Entity update wrapper (entity.js) — do not
    // increment it here or the entity clock runs at double speed. `animTick` is
    // the player's own animation clock and is ours to advance.
    this.animTick++;
    this.stateTimer++;
    if (this._bumpLock > 0) this._bumpLock--;
    if (this.throwTimer > 0) this.throwTimer--;
    if (this.fireCooldown > 0) this.fireCooldown--;
    if (this.landSquash > 0) this.landSquash--;
    if (this.stretch > 0) this.stretch--;
    if (this.invulnFrames > 0) this.invulnFrames--;
    // StompTimer is $0791, offset $11 into Timers ($0780), which is inside the
    // frame-timer range DecTimers walks (`ldx #$14`, asm:788-799) — so it ticks
    // down every frame, not on an interval. DecTimers runs at the top of the
    // main loop, BEFORE GameEngine and therefore before the enemy collision
    // pass; decrementing it here, in the roster update that world.js runs ahead
    // of _playerEntityCollisions (world.js:1709 then :1742), reproduces that
    // order. The effect is that a stomp keeps the timer live for the remainder
    // of the frame that set it, which is exactly the window in which a second
    // enemy standing next to the first is still being walked by the loop.
    if (this.stompTimer > 0) this.stompTimer--;
    this._updateStar();
    this._pruneFireballs();

    this._checkVines();

    // JumpspringAnimCtrl, consumed once per frame. A springboard re-asserts it
    // on every frame it animates (SpringBoard.update, which runs after the
    // roster — world.js:1642 then :1651), so reading it here and dropping it
    // means it can never outlive the board that set it. A latch the board had
    // to clear would strand the player unable to jump for good the moment he
    // rode one through a level change, a warp or a death.
    this._springLock = this.springAnim;
    this.springAnim = false;

    switch (this.state) {
      case 'normal':
        this._updateNormal();
        break;
      case 'growing':
        this._updateChangeSize();
        break;
      case 'shrinking':
        this._updateChangeSize();
        break;
      case 'dying':
        this._updateDying();
        break;
      case 'flagpole':
        this._updateFlagpole();
        break;
      case 'flagflip':
        this._updateFlagFlip();
        break;
      case 'flagwalk':
      case 'walkoff':
        this._updateWalkOff();
        break;
      case 'climb':
        this._updateClimb();
        break;
      case 'pipe':
        this._updatePipe();
        break;
      case 'pipeexit':
        this._updatePipeExit();
        break;
      case 'done':
        break;
      default:
        this._toNormal();
        break;
    }

    this._updateFlags();
    this._updateAnim();
  }

  // The single recovery path back to playable state. Every cutscene bail-out goes
  // through here: dropping back to 'normal' without releasing the control lock and
  // the cutscene handles leaves Mario alive but permanently unable to move.
  _toNormal() {
    this.state = 'normal';
    this.stateTimer = 0;
    this.controlsLocked = false;
    this.hidden = false;
    this._clip = null;
    this._pipe = null;
    this._flag = null;
    this._walkOff = null;
    this._grow = null;
  }

  _updateFlags() {
    const inv = this.state !== 'normal' || this.invulnFrames > 0 || this.starFrames > 0;
    this.intangible = this.state !== 'normal' || this.invulnFrames > 0;
    this.invulnerable = this.intangible;
    this.vulnerable = !inv;
    this.invincible = this.starFrames > 0;
    this.collidable = this.state === 'normal' && !this.hidden;
    this.noclip = this.state === 'dying' || this.state === 'pipe' || this.state === 'pipeexit';
    this.controllable = this.state === 'normal' && !this.controlsLocked;
  }

  // --- input wrappers so cutscenes can silence the pad ----------------------

  get pad() {
    return this._pad || input;
  }
  set pad(v) {
    this._pad = v || null;
  }

  _down(b) {
    return !this.controlsLocked && this.pad.down(b);
  }
  _pressed(b) {
    return !this.controlsLocked && this.pad.pressed(b);
  }

  // Up doubles as a jump button during normal play — it is what players reach for
  // first. It must NOT while climbing, where Up means go up the vine/pole.
  _climbing() {
    return this.state === 'climb' || this.state === 'flagpole' || this.state === 'flagflip';
  }
  _jumpPressed() {
    return this._pressed(BTN.JUMP) || (!this._climbing() && this._pressed(BTN.UP));
  }
  _jumpHeld() {
    return this._down(BTN.JUMP) || (!this._climbing() && this._down(BTN.UP));
  }

  // -------------------------------------------------------------------------
  // normal gameplay
  // -------------------------------------------------------------------------

  _updateNormal() {
    this._wasGrounded = this.grounded;
    this.inWater = this._checkWater();

    const left = this._down(BTN.LEFT);
    const right = this._down(BTN.RIGHT);
    const down = this._down(BTN.DOWN);
    const run = this._down(BTN.RUN);
    let dir = (right ? 1 : 0) - (left ? 1 : 0);

    this._updateDuck(down);
    if (this.ducking && this.grounded) dir = 0;

    if (this.inWater) this._swimHorizontal(dir);
    else this._groundAirHorizontal(dir, run);

    // --- jump / stroke ------------------------------------------------------
    if (this._jumpPressed()) this.jumpBuffer = P.jumpBuffer;
    if (this.jumpBuffer > 0) this.jumpBuffer--;
    if (this.grounded) this.coyote = P.coyote;
    else if (this.coyote > 0) this.coyote--;

    // CheckForJumping (smbdis.asm:6064-6066) reads JumpspringAnimCtrl BEFORE it
    // reads the A button and skips the whole jump routine while a jumpspring is
    // animating; the vertical collision path does the same at asm:12007-12008,
    // branching away from LandPlyr. Ours has to say it out loud because
    // SpringBoard.snap() holds a rider `grounded` for the entire compress, so
    // the fresh press the boost is keyed to is also a legal ordinary jump and
    // _doJump() fires on it — Mario hops under his own power mid-compress. The
    // buffer goes with it: the original has none, and a press that survived the
    // animation would only fire the jump on the frame the spring let go.
    if (this._springLock) this.jumpBuffer = 0;

    if (this.inWater) {
      if (this.jumpBuffer > 0) {
        this._stroke();
        this.jumpBuffer = 0;
      }
    } else if (this.jumpBuffer > 0 && this.coyote > 0) {
      this._doJump();
    }

    // --- gravity ------------------------------------------------------------
    // The launch frame is NOT exempt: physics.js integrates gravity on the frame the
    // jump starts (see simulateJump), and skipping it adds a whole vy0 of extra rise.
    if (this.inWater) {
      // Three forces, exactly as JumpSwimSub picks them (smbdis.asm:5921-5946):
      // above the swimming ceiling the strong $18 pull wins whichever way you are
      // moving, otherwise a rising stroke that is still held decelerates at $0d and
      // everything else — released stroke, sinking — at $0a.
      const rising = this.vy < 0;
      if (rising && !this._jumpHeld()) this.jumpHeld = false;
      this.vy +=
        this.y < P.swimCeilingY
          ? P.swimCeilingGravity
          : rising && this.jumpHeld
            ? P.swimRiseGravity
            : P.swimSinkGravity;
      if (this.vy > P.swimMaxFall) this.vy = P.swimMaxFall;
      if (this.vy < P.swimMaxRise) this.vy = P.swimMaxRise;
    } else if (this.grounded) {
      this.vy = Math.max(this.vy, 0);
      this._gHold = P.gravityHold;
      this._gFall = P.gravity;
      this.jumping = false;
      this.vy = GROUND_STICK;
    } else if (this._launchFrame) {
      // The NES integrates the jump as explicit Euler: the takeoff frame travels a
      // full vy0 BEFORE gravity is first applied. Folding gravity into the launch
      // frame (semi-implicit) costs 4 px of height and is why a standing jump was
      // landing 2 px short of the 4-tile block it is supposed to clear.
      this._launchFrame = false;
    } else {
      const rising = this.vy < 0;
      if (this.jumping && rising && this.jumpHeld && this._jumpHeld()) {
        this.vy += this._gHold;
      } else {
        if (rising) this.jumpHeld = false;
        this.vy += this._gFall;
      }
      if (this.vy > P.maxFall) this.vy = P.maxFall;
    }

    // --- fireball -----------------------------------------------------------
    if (this.power === POWER.FIRE && this._pressed(BTN.RUN)) this._throwFireball();

    // --- integrate ----------------------------------------------------------
    const vyBefore = this.vy;
    this.grounded = false;
    this.moveAndCollide();
    this._snapUpToLedge();
    this._confirmGround();

    this._clampToWorld();
    this._afterMove(vyBefore);
  }

  // Ledge skim. See LEDGE_SNAP: a body sunk less than 5px into the row its feet
  // occupy is lifted back onto that row whenever either foot has solid under it.
  // With colOpts.footSkip keeping the far lip from acting as a wall, this is what
  // lets a run skim a one-tile gap instead of stopping dead in it.
  _snapUpToLedge() {
    if (this.vy < 0) return;
    const bottom = this.y + this.h;
    const row = Math.floor(bottom / TILE);
    const sink = bottom - row * TILE;
    if (sink <= 0 || sink >= LEDGE_SNAP) return;
    const footY = row * TILE + TILE * 0.5;
    if (!this._solid(this.x + 1, footY) && !this._solid(this.x + this.w - 1, footY)) return;
    this.y -= sink;
    this.vy = 0;
    this.grounded = true;
  }

  // Ground probe. moveAndCollide() owns `grounded`; this only fills in when the
  // collider reports contact under a different name or not at all.
  _confirmGround() {
    if (this.grounded) return;
    if (this.onGround === true || this.onFloor === true) {
      this.grounded = true;
      return;
    }
    if (this.vy < 0) return;
    const footY = this.y + this.h + 1;
    if (this._solid(this.x + 1, footY) || this._solid(this.x + this.w - 1, footY)) {
      this.grounded = true;
    }
  }

  _groundAirHorizontal(dir, run) {
    const speed = Math.abs(this.vx);
    const moving = sgn(this.vx);
    const topSpeed = run || speed > P.maxWalk + 0.001 ? P.maxRun : P.maxWalk;

    // Airborne acceleration follows the LATCHED peak speed of the jump, not the
    // instantaneous one: once the body has touched the walk cap during an airtime it
    // keeps the run acceleration for the rest of it, even after a mid-air turnaround
    // drags |vx| back down. Mirrors Phys.stepHorizontal's `ent.airSpeed`.
    if (this.grounded) this.airSpeed = speed;
    else if (!(this.airSpeed >= speed)) this.airSpeed = speed;

    if (this.grounded) {
      if (dir !== 0) {
        if (moving !== 0 && moving !== dir) {
          // Skid: decelerate through zero. The threshold is a presentation event —
          // it ends the skid pose and flips the facing — never a velocity snap, so
          // the turnaround reads as a slide instead of an instant reversal.
          this.vx = approach(this.vx, 0, P.skidDecel);
          this.skidding = Math.abs(this.vx) >= P.skidTurn;
          if (!this.skidding) this.facing = dir;
          this._skidDust();
        } else {
          this.skidding = false;
          this.facing = dir;
          if (!run && speed > P.maxWalk) {
            // Run button released above the walk cap: bleed off with friction ONLY.
            // Adding acceleration here as well would nearly cancel it out.
            this.vx = approach(this.vx, P.maxWalk * (moving || dir), P.friction);
          } else {
            const a = run ? P.runAccel : P.walkAccel;
            if (Math.abs(this.vx) < P.minWalk) this.vx = dir * P.minWalk;
            this.vx = approach(this.vx, (run ? P.maxRun : P.maxWalk) * dir, a);
          }
        }
      } else {
        this.skidding = false;
        if (moving !== 0) this.vx = approach(this.vx, 0, P.friction);
      }
    } else {
      this.skidding = false;
      if (dir !== 0) {
        if (moving !== 0 && moving !== dir) {
          const d = speed >= P.airTurnFast ? P.airTurnDecel : P.airRunAccel;
          this.vx += dir * d;
        } else {
          const a = this.airSpeed >= P.maxWalk ? P.airRunAccel : P.airAccel;
          this.vx += dir * a;
        }
        this.facing = dir;
      }
    }

    // The airborne cap is measured from the speed carried INTO the frame, so momentum
    // taken off the ground survives while acceleration past it still clamps.
    const cap = this.grounded ? topSpeed : Math.max(topSpeed, speed);
    if (Math.abs(this.vx) > cap) this.vx = sgn(this.vx) * cap;
    if (this.grounded && Math.abs(this.vx) < 0.02) this.vx = 0;
    if (!this.grounded && !(this.airSpeed >= Math.abs(this.vx))) this.airSpeed = Math.abs(this.vx);
  }

  _swimHorizontal(dir) {
    if (dir !== 0) {
      this.vx += dir * P.swimAccel;
      this.facing = dir;
      if (Math.abs(this.vx) > P.swimMaxSpeed) this.vx = sgn(this.vx) * P.swimMaxSpeed;
    } else if (this.vx !== 0) {
      const m = sgn(this.vx);
      this.vx -= m * P.swimFriction;
      if (sgn(this.vx) !== m) this.vx = 0;
    }
    this.skidding = false;
  }

  _updateDuck(down) {
    if (!this.big) {
      if (this.ducking) this._unduck(true);
      return;
    }
    if (down && !this.ducking) {
      this.ducking = true;
      this._setHeight(HITBOX.DUCK_H, false);
    } else if (!down && this.ducking) {
      this._unduck(false);
    }
  }

  _unduck(force) {
    if (!this.ducking) return;
    const targetH = this.big ? HITBOX.BIG_H : HITBOX.SMALL_H;
    if (!force && targetH > this.h) {
      const top = this.y - (targetH - this.h);
      if (this._solid(this.x + 1, top + 1) || this._solid(this.x + this.w - 1, top + 1)) return;
    }
    this.ducking = false;
    this._setHeight(targetH, false);
  }

  _doJump() {
    const row = jumpRowFor(Math.abs(this.vx));
    this.vy = row.vy0;
    this._gHold = row.gHold;
    this._gFall = row.gFall;
    this.jumping = true;
    this.jumpHeld = true;
    this._launchFrame = true;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.grounded = false;
    this.stretch = 3;
    this.stompChain = 0;
    sfx(this.world, this.big ? 'jump-big' : 'jump-small', 'jump');
    fx(this.world, 'landingDust', this.x + this.w / 2, this.y + this.h, 0.55);
  }

  _stroke() {
    const headTile = this._tile(this.x + this.w / 2, this.y - 2);
    const surface = !headTile || !(headTile.liquid || /water/i.test(headTile.name || ''));
    this.vy = surface && this.world.level && this.world.level.theme !== 'water'
      ? P.swimStrokeSurface
      : P.swimStroke;
    if (this.vy < P.swimMaxRise) this.vy = P.swimMaxRise;
    // The swimming ceiling: a stroke taken above y=20 gives no upward speed at all,
    // which is what keeps you from swimming out of the top of the level
    // (PlayerPhysicsSub, smbdis.asm:6124-6134).
    if (this.y < P.swimCeilingY) this.vy = 0;
    this.swimTick = 0;
    this.jumping = false;
    this.jumpHeld = true;
    sfx(this.world, 'swim', 'stroke');
    fx(this.world, 'bubble', this.x + this.w / 2 + this.facing * 3, this.y + 4, false);
  }

  _throwFireball() {
    if (this.fireCooldown > 0) return;
    if (this.fireballs.length >= P.maxFireballs) return;
    const fx0 = this.facing > 0 ? this.x + this.w - 2 : this.x - 6;
    const fy0 = this.y + (this.big && !this.ducking ? 12 : 4);
    let fb;
    if (typeof this.world.spawn === 'function') {
      fb = this.world.spawn('fireball', fx0, fy0, {
        dir: this.facing,
        facing: this.facing,
        owner: this,
        from: 'player',
      });
    }
    this.fireballs.push(fb || { _ttl: 90 });
    this.fireCooldown = P.fireCooldown;
    this.throwTimer = 10;
    sfx(this.world, 'fireball', 'fire', 'throw');
  }

  _pruneFireballs() {
    if (!this.fireballs.length) return;
    this.fireballs = this.fireballs.filter((f) => {
      if (!f) return false;
      if (f._ttl != null) return --f._ttl > 0;
      return !f.removed && !f.dead;
    });
  }

  // --- post-move bookkeeping ----------------------------------------------

  _afterMove(vyBefore) {
    // landing
    if (this.grounded && !this._wasGrounded) {
      this.jumping = false;
      this.jumpHeld = false;
      this.stompChain = 0;
      if (vyBefore > 1.6 && !this.inWater) {
        this.landSquash = 3;
        // landingDust normalises a raw fall speed itself; keep it in its 0..2 band.
        fx(this.world, 'landingDust', this.x + this.w / 2, this.y + this.h,
          clamp(vyBefore / P.maxFall + 0.4, 0.5, 2));
      }
    }

    // head bump — the collider zeroes upward velocity against a ceiling; some
    // colliders only reposition, so a direct probe backs it up.
    //
    // Being airborne is NOT part of the test. In a corridor with no headroom the
    // jump is stopped by the ceiling on its own launch frame: the body never
    // leaves the floor, _confirmGround puts `grounded` straight back, and gating
    // on it swallowed exactly the bump the player was aiming for. `vyBefore < 0`
    // is the real signal — only a jump or a bounce drives vy negative, and a
    // grounded frame carries GROUND_STICK instead.
    if (vyBefore < 0 && this._bumpLock === 0 && (this.vy >= 0 || this._headSolid())) {
      this._bumpHead();
    }

    // pits and level bottom
    const level = this.world.level;
    const floor = level && level.height ? level.height * TILE : SCREEN_H;
    if (this.y > floor + 8) {
      this.die('pit');
      return;
    }

    if (this.state !== 'normal') return;
    if (this._checkFlagpole()) return;
    this._checkPipeEntry();
  }

  _headProbes() {
    return [this.x + this.w / 2, this.x + 1, this.x + this.w - 1];
  }

  _headSolid() {
    const headY = this.y - 1;
    for (const px of this._headProbes()) if (this._solid(px, headY)) return true;
    return false;
  }

  _bumpHead() {
    const headY = this.y - 1;
    for (const px of this._headProbes()) {
      if (!this._solid(px, headY)) continue;
      this._bumpLock = 5;
      this.vy = Math.max(this.vy, 0);
      const tx = Math.floor(px / TILE);
      const ty = Math.floor(headY / TILE);
      if (typeof this.world.bumpBlock === 'function') this.world.bumpBlock(tx, ty, this);
      else sfx(this.world, 'bump');
      return;
    }
  }

  _clampToWorld() {
    const cam = this.world.cam;
    const level = this.world.level;
    const leftWall = cam ? cam.x : 0;
    if (this.x < leftWall) {
      this.x = leftWall;
      if (this.vx < 0) this.vx = 0;
    }
    if (level && level.width) {
      const right = level.width * TILE - this.w;
      if (this.x > right) {
        this.x = right;
        if (this.vx > 0) this.vx = 0;
      }
    }
    // Vertical, in water only. The swimming ceiling above already turns you around
    // ~11px above y=20, so this never fires in ordinary play; it is the backstop that
    // stops any future stroke or bounce from putting a swimmer off the top of a level
    // the camera cannot follow him out of. Dry levels keep SMB's open sky.
    if (this.inWater && this.y < 0) {
      this.y = 0;
      if (this.vy < 0) this.vy = 0;
    }
  }

  // -------------------------------------------------------------------------
  // world queries
  // -------------------------------------------------------------------------

  _tile(px, py) {
    const w = this.world;
    if (!w || typeof w.tileAt !== 'function') return null;
    return w.tileAt(Math.floor(px / TILE), Math.floor(py / TILE)) || null;
  }

  _solid(px, py) {
    const w = this.world;
    if (w && typeof w.solidAt === 'function') return !!w.solidAt(px, py);
    const t = this._tile(px, py);
    return !!(t && t.solid);
  }

  _checkWater() {
    // Three samples up the body, not one: a coin or a block sitting inside the
    // water is a dry tile, and sampling only the middle made swimming flicker
    // off for the frames it took to pass through one.
    const cx = this.x + this.w / 2;
    const wet = (fy) => {
      const t = this._tile(cx, this.y + this.h * fy);
      return !!(t && (t.liquid || /water/i.test(t.name || '')));
    };
    if (wet(0.5) || wet(0.15) || wet(0.85)) return true;
    // The theme is only a fallback, for a water level that never tiled its
    // water. Letting it win outright meant a water level could not have a
    // shore: the flagpole at the end of 2-2 would be swum, not walked.
    const level = this.world.level;
    if (level && level.theme === 'water' && !this.world.hasWaterTiles) return true;
    return false;
  }

  // -------------------------------------------------------------------------
  // damage / death
  // -------------------------------------------------------------------------

  // Called by enemies through onPlayerTouch(). Returns true if the hit landed.
  hurt(source) {
    if (!this.canBeHurt()) return false;
    if (this.starFrames > 0) return false;
    if (this.big) {
      const from = this.power;
      this.power = POWER.SMALL;
      this._setHeight(HITBOX.SMALL_H, false);
      this.ducking = false;
      this.state = 'shrinking';
      this.stateTimer = 0;
      // Velocity survives the transition. SMB freezes the animation but resumes
      // the jump exactly as it was; zeroing here cancelled the arc mid-air.
      this._grow = { kind: 'shrink', from, frames: P.growFrames };
      // src/audio/sfx.js has no 'powerdown'; the power-down reuses the pipe warble.
      sfx(this.world, 'pipe', 'powerdown');
      callAny(this.world, ['freeze'], 6);
      return true;
    }
    this.die('hit', source);
    return true;
  }
  damage(source) {
    return this.hurt(source);
  }
  takeDamage(source) {
    return this.hurt(source);
  }
  onHurt(source) {
    return this.hurt(source);
  }

  die(cause = 'hit') {
    if (this.state === 'dying' || this.dead) return;
    this.state = 'dying';
    this.stateTimer = 0;
    this.dead = true;
    this.hidden = false;
    this.vx = 0;
    this.vy = 0;
    this.ducking = false;
    this.starFrames = 0;
    this.invulnFrames = 0;
    this.controlsLocked = true;
    this._deathCause = cause;
    this._deathFreeze = cause === 'pit' ? 0 : P.deathFreeze;
    if (cause === 'pit') this.vy = 2;
    // In co-op the level keeps running while a brother is still standing, so
    // one death must not silence the track — only the last one does.
    if (!this._othersStanding()) music(this.world, null);
    sfx(this.world, 'death', 'die', 'mariodie');
  }

  // Is any OTHER player still in play? Reads the roster rather than
  // world.player, which is just whichever brother is currently leading.
  _othersStanding() {
    const w = this.world;
    if (!w) return false;
    const roster =
      Array.isArray(w.players) && w.players.length ? w.players : [w.player, w.player2];
    for (const q of roster) {
      if (!q || q === this) continue;
      if (q.out || q.dead || q.state === 'dying') continue;
      return true;
    }
    return false;
  }

  kill(style) {
    this.die(style || 'hit');
  }

  _updateDying() {
    if (this.stateTimer <= this._deathFreeze) {
      if (this.stateTimer === this._deathFreeze) this.vy = P.deathRise;
      return;
    }
    this.vy += P.deathGravity;
    if (this.vy > P.maxFall) this.vy = P.maxFall;
    this.y += this.vy;
    this.x += this.vx;

    const cam = this.world.cam || { y: 0 };
    if (!this.deathReported && this.y > cam.y + SCREEN_H + 48) {
      this.deathReported = true;
      this.hidden = true;
      this.state = 'done';
      if (!hasAny(this.world, ['onPlayerDeath', 'playerDied', 'loseLife', 'onDeath', 'restart'])) {
        console.warn('[player] world has no death handler');
      }
      callAny(this.world, ['onPlayerDeath', 'playerDied', 'loseLife', 'onDeath', 'restart'], this);
    }
  }

  // -------------------------------------------------------------------------
  // stomping
  // -------------------------------------------------------------------------

  // Called by the collision system when the player lands on an enemy that
  // absorbed the stomp. Returns the score awarded.
  stompBounce(entity) {
    const held = this._jumpHeld();
    this.vy = stompBounceFor(held);
    this.jumping = true;
    this.jumpHeld = held;
    const row = jumpRowFor(Math.abs(this.vx));
    this._gHold = row.gHold;
    this._gFall = row.gFall;
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.landSquash = 0;
    this.stretch = 2;

    const ex = entity ? entity.x + (entity.w || 16) / 2 : this.x + this.w / 2;
    const ey = entity ? entity.y : this.y + this.h;
    const fixed = stompPointsOf(entity);
    // HandleStompedShellE builds the floatey number as StompChainCounter PLUS
    // StompTimer (asm:11502-11506), so every enemy already taken this frame
    // pushes the next one an extra rung up the ladder: two goombas in one
    // landing pay 100 then 400, not 100 then 200. A single stomp has the timer
    // at zero and is unaffected, which is why the ordinary ladder is unchanged.
    const score = fixed
      ? this._awardFixed(ex, ey, fixed)
      : this._awardChain(ex, ey, 'stompChain', this.stompTimer | 0);
    sfx(this.world, 'stomp', 'squish');
    // Deliberately no freeze() here — see world._onStompLanded. The stomp was
    // being frozen twice (3 + 2 frames), which is what desynced chain-stomps.
    fx(this.world, 'enemyPoof', ex, ey);
    return score;
  }
  onStompEnemy(e) {
    return this.stompBounce(e);
  }
  onStompedEnemy(e) {
    return this.stompBounce(e);
  }
  stomped(e) {
    return this.stompBounce(e);
  }

  // Generic upward kick (springs, shell chains, scripted beats).
  bounce(vy) {
    this.vy = typeof vy === 'number' ? vy : P.stompBounceHeld;
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumping = true;
    this.jumpHeld = this._jumpHeld();
    const row = jumpRowFor(Math.abs(this.vx));
    this._gHold = row.gHold;
    this._gFall = row.gFall;
  }

  // Enemy destroyed by star contact.
  starKill(entity) {
    const ex = entity ? entity.x + (entity.w || 16) / 2 : this.x;
    const ey = entity ? entity.y : this.y;
    sfx(this.world, 'kick', 'stomp');
    return this._awardChain(ex, ey, 'starChain');
  }

  // EnemyStompedPts (smbdis.asm:11464-11466): one floatey number for the value
  // the enemy is worth, and the chain counter is left exactly as it was.
  _awardFixed(x, y, score) {
    callAny(this.world, ['addScore', 'score', 'addPoints'], score, x, y);
    return score;
  }

  // `bonus` is the ROM's StompTimer, added to the chain counter to pick the
  // floatey number (asm:11503-11506). It shifts what is PAID without moving the
  // counter itself — the counter still advances by exactly one per enemy, the
  // way `inc StompChainCounter` does.
  _awardChain(x, y, field, bonus = 0) {
    const i = this[field];
    // Saturate the counter ON the 1-UP step, not past it. FloateyNumbersRoutine
    // (smbdis.asm:1286-1289) clamps FloateyNum_Control at $0b and $0b IS the 1-UP
    // entry of ScoreUpdateData (asm:1278-1281, `inc NumberofLives` asm:1300), so
    // once a chain reaches the top EVERY further enemy pays another life — it does
    // not fall back to 8000. entities/index.js:shellChainScore models the same
    // clamp for a kicked shell's chain; these two must not disagree. The same
    // clamp catches an index the bonus pushed past the end.
    const idx = Math.min(i + (bonus | 0), STOMP_SCORES.length);
    this[field] = Math.min(i + 1, STOMP_SCORES.length);
    if (idx >= STOMP_SCORES.length) {
      callAny(this.world, ['addLife', 'oneUp', 'gainLife', 'addLives'], 1);
      sfx(this.world, '1up', 'oneup');
      fx(this.world, 'powerupSparkle', x, y);
      return 0;
    }
    const score = STOMP_SCORES[idx];
    callAny(this.world, ['addScore', 'score', 'addPoints'], score, x, y);
    return score;
  }

  // -------------------------------------------------------------------------
  // power-ups
  // -------------------------------------------------------------------------

  powerUp(kind) {
    switch (kind) {
      case 'mushroom':
      case 'super':
      case 'grow':
        if (this.power === POWER.SMALL) this._beginGrow(POWER.BIG);
        else callAny(this.world, ['addScore'], 1000, this.x, this.y);
        sfx(this.world, 'powerup', 'grow');
        return true;
      case 'flower':
      case 'fireflower':
      case 'fire':
        if (this.power === POWER.SMALL) this._beginGrow(POWER.FIRE);
        else if (this.power === POWER.BIG) this._beginGrow(POWER.FIRE);
        else callAny(this.world, ['addScore'], 1000, this.x, this.y);
        sfx(this.world, 'powerup', 'grow');
        return true;
      case 'star':
      case 'starman':
        this.giveStar();
        return true;
      case '1up':
      case 'oneup':
        callAny(this.world, ['addLife', 'oneUp', 'gainLife'], 1);
        sfx(this.world, '1up', 'oneup');
        return true;
      default:
        return false;
    }
  }
  applyPowerup(kind) {
    return this.powerUp(kind);
  }
  collect(kind) {
    return this.powerUp(kind);
  }

  _beginGrow(target) {
    this.state = 'growing';
    this.stateTimer = 0;
    // Velocity survives the transition — see hurt().
    this.ducking = false;
    this._grow = { kind: 'grow', from: this.power, to: target, frames: P.growFrames };
    if (this.power === POWER.SMALL) this._growTo(HITBOX.BIG_H);
    this.power = target;
    callAny(this.world, ['freeze'], 4);
  }

  _growTo(h) {
    this._setHeight(h, true);
    // If the new head is embedded in a ceiling, ease down until it clears.
    for (let i = 0; i < h && (this._solid(this.x + 1, this.y + 1) || this._solid(this.x + this.w - 1, this.y + 1)); i++) {
      this.y += 1;
    }
  }

  giveStar() {
    const first = this.starFrames <= 0;
    this.starFrames = P.starFrames;
    this.starTick = 0;
    this.starChain = 0;
    if (first) {
      const lvl = this.world.level;
      this._prevMusic = lvl && lvl.music ? lvl.music : 'overworld';
      music(this.world, 'star');
    }
    sfx(this.world, 'powerup', 'star');
  }

  _updateStar() {
    if (this.starFrames <= 0) return;
    this.starTick++;
    this.starFrames--;
    if (this.starTick % 2 === 0 && !this.hidden) {
      fx(this.world, 'starTrail', this.x + this.w / 2, this.y + this.h / 2);
    }
    if (this.starFrames === 0) {
      this.starChain = 0;
      music(this.world, this._prevMusic || 'overworld');
    }
  }

  _updateChangeSize() {
    // No physics integration happens in this state (only _updateNormal moves the
    // player), so Mario is already held in place. vx/vy are left intact so the
    // jump resumes with the same momentum when the animation ends.
    const g = this._grow;
    const frames = (g && g.frames) || P.growFrames;
    if (this.stateTimer < frames) return;
    if (this.state === 'shrinking') {
      this.invulnFrames = P.invulnFrames;
    } else if (this.power !== POWER.SMALL && this.h < HITBOX.BIG_H && !this.ducking) {
      this._growTo(HITBOX.BIG_H);
    }
    this._grow = null;
    this.state = 'normal';
    this.stateTimer = 0;
  }

  // -------------------------------------------------------------------------
  // flagpole
  // -------------------------------------------------------------------------

  // SMB grabs the pole through the ordinary player-to-background side collision:
  // CheckSideMTiles -> CheckForClimbMTiles -> HandleClimbing (smbdis.asm:12153),
  // which fires when the metatile beside the player is the flagpole ball ($24) or
  // shaft ($25). Both are CLIMBABLE metatiles, not solid — FlagpoleObject
  // (smbdis.asm:3966) renders the ball, nine rows of shaft, and its one solid tile
  // ($61) into the floor row itself. So in the original the pole column is empty at
  // body height and a running Mario walks straight into it; HandleClimbing's
  // $06/$0a nybble window only makes the pole thinner than its 16px metatile.
  //
  // Our column is drawn one row above its floor: the grey base block sits in row 12,
  // exactly where a standing player's body is, so the collider pins the right edge at
  // poleX and the old `poleX + 6` port of that nybble window was unreachable on foot —
  // the level could only be finished by jumping. Keying the grab off contact with the
  // pole column restores the running grab without moving a single tile.
  _checkFlagpole() {
    const level = this.world.level;
    const fp = level && level.flagpole;
    if (!fp || typeof fp.x !== 'number') return false;
    // From the first grab onward the end-of-level sequence owns the world
    // (FlagpoleCollision bails out when GameEngineSubroutine is already the slide
    // or the end-of-level routine, smbdis.asm:12167). A co-op partner still on his
    // feet must not restart the flag.
    const wstate = this.world.state;
    if (wstate === 'levelend' || wstate === 'complete') return false;

    const tx = fp.x | 0;
    const poleX = tx * TILE;
    // Horizontal: the body has to be in contact with the pole column. Touching its
    // left face is enough — that is where the base block stops us, and it is 6px
    // short of where SMB's shaft would have been met.
    if (this.x + this.w < poleX || this.x > poleX + TILE) return false;

    // Vertical: the body has to overlap the pole, from the ball down to the ground
    // the pole stands on (`span.bottom` is the top of the base block, one tile above
    // that ground). This is what keeps the pole from being grabbed from below.
    const span = this._findPole(tx, fp);
    if (this.y + this.h <= span.top || this.y >= span.bottom + TILE) return false;

    this.startFlagpole(fp, span);
    return true;
  }

  // ChkFlagpoleYPosLoop (smbdis.asm:12187): walk FlagpoleYPosData from the back and
  // take the last entry the player's Y is at or below; anything above the first entry
  // falls through to index 0, the 5000 band.
  _flagpoleBand(poleTop) {
    for (let i = FLAGPOLE_Y_OFFSETS.length - 1; i > 0; i--) {
      if (this.y >= poleTop + FLAGPOLE_Y_OFFSETS[i]) return i;
    }
    return 0;
  }

  startFlagpole(fp, knownSpan) {
    if (this.state === 'flagpole') return;
    const level = this.world.level;
    const tx = fp && typeof fp.x === 'number' ? fp.x : Math.floor((this.x + this.w) / TILE);
    const poleX = tx * TILE;
    const span = knownSpan || this._findPole(tx, fp);
    // Read the height BEFORE the slide moves anything: SMB stores
    // Player_Y_Position into FlagpoleCollisionYPos at the moment of contact.
    const band = this._flagpoleBand(span.top);

    this.state = 'flagpole';
    this.stateTimer = 0;
    this.controlsLocked = true;
    this.vx = 0;
    this.vy = P.flagSlide;
    this.grounded = false;
    this.ducking = false;
    this._unduck(true);
    this.facing = 1;
    this.x = poleX + 8 - this.w + 2;

    const score = FLAGPOLE_SCORES[band];
    callAny(this.world, ['addScore', 'score', 'addPoints'], score, this.x, this.y);

    this._flag = { poleX, top: span.top, bottom: span.bottom, score, waited: 0 };
    sfx(this.world, 'flagpole', 'flag', 'coin');
    music(this.world, null);
    callAny(this.world, ['lowerFlag', 'startFlag', 'flagpoleGrab'], this);
  }
  grabFlagpole(fp) {
    this.startFlagpole(fp);
  }

  _findPole(tx, fp) {
    const level = this.world.level;
    let top = null;
    let bottom = null;
    const rows = level && level.height ? level.height : 15;
    for (let ty = 0; ty < rows; ty++) {
      const t = this.world.tileAt ? this.world.tileAt(tx, ty) : null;
      if (t && (t.climb || /flag|pole/i.test(t.name || ''))) {
        if (top === null) top = ty * TILE;
        bottom = ty * TILE;
      }
    }
    if (top === null) {
      top = (fp && typeof fp.top === 'number' ? fp.top : 2) * TILE;
      bottom = (fp && typeof fp.base === 'number' ? fp.base : rows - 2) * TILE;
    }
    // The slide stops when Mario's feet reach the ground under the pole.
    let groundY = bottom + TILE;
    for (let ty = Math.floor(bottom / TILE); ty < rows; ty++) {
      const t = this.world.tileAt ? this.world.tileAt(tx, ty) : null;
      if (t && t.solid) {
        groundY = ty * TILE;
        break;
      }
    }
    return { top, bottom: groundY, ground: groundY };
  }

  _updateFlagpole() {
    const f = this._flag;
    if (!f) {
      this._toNormal();
      return;
    }
    const stopY = f.bottom - this.h;
    this.y += P.flagSlide;
    if (this.y >= stopY) {
      this.y = stopY;
      this.state = 'flagflip';
      this.stateTimer = 0;
      this.facing = -1;
      this.x = f.poleX + 8 + 2;
      sfx(this.world, 'bump', 'flagpole-land');
      fx(this.world, 'landingDust', this.x + this.w / 2, this.y + this.h, 1);
    }
  }

  _updateFlagFlip() {
    if (this.stateTimer < 24) return;
    this.state = 'flagwalk';
    this.stateTimer = 0;
    this.facing = 1;
    this.vx = P.flagWalk;
    this._walkOff = { hideAt: this._castleDoorX(), hideTimer: -1 };
    music(this.world, 'clear');
    callAny(this.world, ['onFlagDone', 'flagComplete'], this);
  }

  _castleDoorX() {
    const level = this.world.level;
    if (level && level.castle && typeof level.castle.x === 'number') {
      return level.castle.x * TILE + 22;
    }
    if (level && typeof level.castle === 'number') return level.castle * TILE + 22;
    return this.x + 160;
  }

  // Public entry point for castle/axe endings that skip the flagpole.
  walkOff(targetX) {
    this.state = 'walkoff';
    this.stateTimer = 0;
    this.controlsLocked = true;
    this.facing = 1;
    this.vx = P.flagWalk;
    this._walkOff = { hideAt: typeof targetX === 'number' ? targetX : this.x + 200, hideTimer: -1 };
  }

  _updateWalkOff() {
    const wo = this._walkOff || (this._walkOff = { hideAt: this._castleDoorX(), hideTimer: -1 });
    if (wo.hideTimer < 0) {
      this.vx = P.flagWalk;
      this.vy += P.gravity;
      if (this.vy > P.maxFall) this.vy = P.maxFall;
      this.grounded = false;
      this.moveAndCollide();
      if (this.x + this.w / 2 >= wo.hideAt) {
        wo.hideTimer = 0;
        this.hidden = true;
        this.vx = 0;
        sfx(this.world, 'pipe', 'castle');
      }
    } else {
      wo.hideTimer++;
      if (wo.hideTimer === 48) {
        this.state = 'done';
        callAny(
          this.world,
          ['levelComplete', 'onLevelComplete', 'completeLevel', 'levelClear', 'onPlayerFinish'],
          this
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // pipes
  // -------------------------------------------------------------------------

  _checkPipeEntry() {
    if (!this.grounded && !this._down(BTN.RIGHT) && !this._down(BTN.LEFT)) return false;
    const level = this.world.level;
    const warps = level && level.warps;
    const cx = this.x + this.w / 2;

    const feetTy = Math.floor((this.y + this.h + 1) / TILE);
    const midTy = Math.floor((this.y + this.h - 4) / TILE);
    const cTx = Math.floor(cx / TILE);

    if (typeof this.world.warpAt === 'function' && this.grounded && this._down(BTN.DOWN)) {
      const w = this.world.warpAt(cTx, feetTy, 'down');
      if (w) {
        this.enterPipe(w, 'down');
        return true;
      }
    }
    if (!Array.isArray(warps)) return false;

    for (const wdef of warps) {
      const from = wdef && wdef.from;
      if (!from) continue;
      const dir = wdef.dir || 'down';
      if (dir === 'down') {
        if (!this.grounded || !this._down(BTN.DOWN)) continue;
        if (feetTy !== from.y) continue;
        if (cTx !== from.x && cTx !== from.x + 1) continue;
        this.enterPipe(wdef, 'down');
        return true;
      }
      if (dir === 'right' || dir === 'left') {
        const want = dir === 'right' ? BTN.RIGHT : BTN.LEFT;
        if (!this._down(want)) continue;
        if (midTy !== from.y && midTy !== from.y + 1) continue;
        const mouthX = from.x * TILE;
        // The leading edge has to be AT the mouth, not merely past it. An unbounded
        // ">= mouthX" matches every tile to the right of the pipe for the rest of the
        // level, so walking anywhere downstream teleported the player back through it.
        const lead = dir === 'right' ? this.x + this.w : this.x;
        const near =
          dir === 'right'
            ? lead >= mouthX - 2 && lead <= mouthX + TILE
            : lead <= mouthX + TILE + 2 && lead >= mouthX;
        if (!near) continue;
        this.enterPipe(wdef, dir);
        return true;
      }
      if (dir === 'up') continue;
    }
    return false;
  }

  enterPipe(wdef, dir) {
    if (this.state === 'pipe') return;
    const d = dir || (wdef && wdef.dir) || 'down';
    this.state = 'pipe';
    this.stateTimer = 0;
    this.controlsLocked = true;
    this.vx = 0;
    this.vy = 0;
    this.ducking = false;
    this._unduck(true);
    const from = (wdef && wdef.from) || { x: Math.floor(this.x / TILE), y: Math.floor(this.y / TILE) };

    let step;
    if (d === 'down') {
      this.facing = 1;
      step = { dx: 0, dy: (this.h + 8) / P.pipeFrames };
      this._clip = { axis: 'y', at: from.y * TILE + 1, side: 'above' };
      this.x = from.x * TILE + TILE - this.w / 2;
    } else if (d === 'up') {
      step = { dx: 0, dy: -(this.h + 8) / P.pipeFrames };
      this._clip = { axis: 'y', at: (from.y + 1) * TILE, side: 'below' };
    } else if (d === 'right') {
      this.facing = 1;
      step = { dx: (this.w + 10) / P.pipeFrames, dy: 0 };
      this._clip = { axis: 'x', at: from.x * TILE, side: 'left' };
    } else {
      this.facing = -1;
      step = { dx: -(this.w + 10) / P.pipeFrames, dy: 0 };
      this._clip = { axis: 'x', at: (from.x + 1) * TILE, side: 'right' };
    }

    this._pipe = { warp: wdef, dir: d, step, frames: P.pipeFrames };
    sfx(this.world, 'pipe', 'warp', 'powerdown');
  }

  // -------------------------------------------------------------------------
  // Vines. The beanstalk is intangible, so nothing latches Mario onto it
  // through the collision loop — he looks for it himself each frame.
  // -------------------------------------------------------------------------

  _checkVines() {
    if (this.state !== 'normal') return;
    // A vine you just let go of must not re-grab on the same frame, or jumping
    // off is impossible: you leave and are caught again before you clear it.
    if (this._vineCooldown > 0) {
      this._vineCooldown--;
      return;
    }
    const list = this.world && this.world.climbables;
    if (!Array.isArray(list) || !list.length) return;
    for (const v of list) {
      if (!v || v.removed) continue;
      if (typeof v.canClimb === 'function' && v.canClimb(this)) {
        this.grabVine(v);
        return;
      }
    }
  }

  grabVine(v) {
    if (!v || this.state === 'climb' || this.state === 'dying') return;
    if (this._vineCooldown > 0) return;
    this.state = 'climb';
    this.stateTimer = 0;
    this.climbVine = v;
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;
    this.ducking = false;
    this.onPlatform = null;
    this._launchFrame = false;
    this.controlsLocked = false;
    if (typeof v.climbX === 'function') this.x = v.climbX() - this.w / 2;
    sfx(this.world, 'vine', 'climb', 'pipe');
  }

  releaseVine(vy = 0, vx = 0) {
    this.climbVine = null;
    this._vineCooldown = 12;
    this.state = 'normal';
    this.stateTimer = 0;
    this.grounded = false;
    this.vy = vy;
    this.vx = vx;
  }

  _updateClimb() {
    const v = this.climbVine;
    if (!v || v.removed) {
      this.releaseVine(0, 0);
      return;
    }

    // Jump lets go, with a small push in the direction you are holding — the
    // only way off a beanstalk that is not the top or the bottom.
    if (this._pressed(BTN.JUMP)) {
      const dir = this._down(BTN.RIGHT) ? 1 : this._down(BTN.LEFT) ? -1 : 0;
      this.facing = dir || this.facing;
      this.releaseVine(P.vineHop, dir * P.vinePush);
      return;
    }

    const up = this._down(BTN.UP);
    const down = this._down(BTN.DOWN);
    if (up) this.y -= P.climbSpeed;
    else if (down) this.y += P.climbSpeed;
    this.climbTick = (this.climbTick | 0) + (up || down ? 1 : 0);

    this.x = v.climbX() - this.w / 2;
    this.vx = 0;
    this.vy = 0;

    // Off the top: this is the whole point of a beanstalk. The vine names the
    // area it leads to and the world performs the same warp a pipe would.
    // Trigger on the HEAD reaching the tip, which is also where the clamp below
    // stops him — testing his feet instead means the clamp holds him one body
    // height short of the condition and he climbs forever.
    if (this.y <= v.y + 2) {
      if (v.warp) {
        this.state = 'done';
        this.hidden = true;
        this.climbVine = null;
        if (typeof this.world.warp === 'function') this.world.warp(v.warp, this);
        return;
      }
      this.y = v.y + 2;
    }

    // Sliding off the bottom just puts you back on your feet.
    if (this.y + this.h >= v.baseY) {
      this.y = v.baseY - this.h;
      if (down) this.releaseVine(0, 0);
    }
  }

  _updatePipe() {
    const p = this._pipe;
    if (!p) {
      this._toNormal();
      return;
    }
    if (this.stateTimer <= p.frames) {
      this.x += p.step.dx;
      this.y += p.step.dy;
      return;
    }
    this.hidden = true;
    this._clip = null;
    this.state = 'done';
    const wdef = p.warp;
    const to = wdef && wdef.to;
    if (hasAny(this.world, ['warp', 'doWarp', 'takeWarp', 'enterWarp'])) {
      callAny(this.world, ['warp', 'doWarp', 'takeWarp', 'enterWarp'], wdef, this);
    } else if (to && hasAny(this.world, ['loadArea', 'gotoArea', 'loadLevel'])) {
      callAny(this.world, ['loadArea', 'gotoArea', 'loadLevel'], to.area, to.x, to.y);
    } else {
      console.warn('[player] no warp handler on world');
      this._toNormal();
    }
  }

  // Called by the world after a warp so Mario rises/steps out of the target pipe.
  exitPipe(dir = 'up', fromTile) {
    const d = dir;
    this.state = 'pipeexit';
    this.stateTimer = 0;
    this.controlsLocked = true;
    this.hidden = false;
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;
    const tile = fromTile || { x: Math.floor(this.x / TILE), y: Math.floor((this.y + this.h) / TILE) };

    let step;
    if (d === 'up') {
      step = { dx: 0, dy: -(this.h + 8) / P.pipeFrames };
      this.y = tile.y * TILE + 8;
      this._clip = { axis: 'y', at: tile.y * TILE + 1, side: 'above' };
    } else if (d === 'down') {
      step = { dx: 0, dy: (this.h + 8) / P.pipeFrames };
      // Start ABOVE the settled position and descend into it, mirroring 'up'.
      // Without this the walk begins wherever the world already stood him — on
      // the floor — and then travels h+8 px DOWN with collision disabled, which
      // buried him to the shoulders and soft-locked the level: he could not
      // walk, jump or leave. Every `exit: 'down'` destination in the game did
      // this, thirteen of them, including three of the four warp zones.
      this.y -= this.h + 8;
      this._clip = { axis: 'y', at: (tile.y + 1) * TILE, side: 'below' };
    } else if (d === 'right') {
      this.facing = 1;
      step = { dx: (this.w + 10) / P.pipeFrames, dy: 0 };
      this._clip = { axis: 'x', at: (tile.x + 1) * TILE, side: 'right' };
    } else {
      this.facing = -1;
      step = { dx: -(this.w + 10) / P.pipeFrames, dy: 0 };
      this._clip = { axis: 'x', at: tile.x * TILE, side: 'left' };
    }
    this._pipe = { dir: d, step, frames: P.pipeFrames };
    sfx(this.world, 'pipe', 'warp');
  }
  pipeExit(dir, fromTile) {
    this.exitPipe(dir, fromTile);
  }

  _updatePipeExit() {
    const p = this._pipe;
    if (!p) {
      this._toNormal();
      return;
    }
    if (this.stateTimer <= p.frames) {
      this.x += p.step.dx;
      this.y += p.step.dy;
      return;
    }
    this._toNormal();
    this.vy = 0;
  }

  // -------------------------------------------------------------------------
  // geometry
  // -------------------------------------------------------------------------

  // Bottom-anchored resize: the feet never move.
  _setHeight(h, _grow) {
    if (this.h === h) return;
    this.y += this.h - h;
    this.h = h;
  }

  // -------------------------------------------------------------------------
  // presentation
  // -------------------------------------------------------------------------

  _skidDust() {
    if (Math.abs(this.vx) < 0.9) return;
    this.dustTimer++;
    if (this.dustTimer % 4 !== 0) return;
    // The puffs trail the direction of TRAVEL, which during a skid is the opposite
    // of the pad — hence sgn(vx) rather than facing.
    const dir = sgn(this.vx) || this.facing;
    fx(this.world, 'skidDust', this.x + this.w / 2 - dir * 4, this.y + this.h - 1, dir);
  }

  _poseKey() {
    if (this.state === 'dying') return 'die';
    if (this.state === 'climb') return 'climb';
    if (this.state === 'flagpole' || this.state === 'flagflip') return 'climb';
    if (this.state === 'pipe' || this.state === 'pipeexit') return 'idle';
    if (this.state === 'flagwalk' || this.state === 'walkoff') return 'walk';
    if (this.state === 'growing' || this.state === 'shrinking') return 'idle';
    if (this.inWater && !this.grounded) return this.swimTick < 14 ? 'swim' : 'swimidle';
    if (this.throwTimer > 0) return 'throw';
    if (this.ducking) return 'duck';
    if (!this.grounded) return this.vy < 0 ? 'jump' : 'fall';
    if (this.skidding) return 'skid';
    if (Math.abs(this.vx) > 0.06) {
      // Hysteresis across the walk/run boundary. Holding the pad at almost
      // exactly maxWalk is common, and without a dead band the gait flips
      // between two differently-drawn cycles every frame and reads as a stutter.
      const sp = Math.abs(this.vx);
      if (this._runGait) this._runGait = sp >= P.maxWalk * 0.86;
      else this._runGait = sp > P.maxWalk * 1.04;
      return this._runGait ? 'run' : 'walk';
    }
    this._runGait = false;
    return 'idle';
  }

  // Animation phases advance on the fixed step, never in draw(), so the cycle
  // speed is identical whether the frame is rendered or skipped.
  _updateAnim() {
    const key = this._poseKey();
    this.pose = key;
    if (this.inWater) this.swimTick++;
    else this.swimTick = 99;

    switch (key) {
      case 'run':
      case 'walk': {
        // SMB scales the leg cycle with speed: a full run cycles ~3x a slow walk.
        const t = clamp(Math.abs(this.vx) / P.maxRun, 0, 1);
        // Ease the cycle rate in rather than stepping it, so accelerating out of a
        // stand ramps the legs up smoothly instead of snapping to run cadence.
        const target = 0.55 + 1.85 * t * t * (3 - 2 * t);
        this._cycleRate = this._cycleRate == null ? target : this._cycleRate + (target - this._cycleRate) * 0.25;
        this.walkPhase += this.state === 'normal' ? this._cycleRate : 1.1;
        // 720720 divides by every frame count 1..16, so wrapping never skips.
        if (this.walkPhase >= 720720) this.walkPhase -= 720720;
        this.animPhase = this.walkPhase;

        // Footfall: a puff of dust each time the cycle returns to a contact pose
        // at speed. This is what sells weight when running, and it costs nothing
        // when walking slowly because the threshold gates it out.
        if (this.grounded && Math.abs(this.vx) > P.maxWalk * 0.8) {
          const idx = this._animIdx | 0;
          if (idx !== this._lastFootIdx && idx !== 1) {
            fx(this.world, 'runDust', this.x + this.w / 2, this.y + this.h, this.facing);
          }
          this._lastFootIdx = idx;
        } else {
          this._lastFootIdx = -1;
        }
        break;
      }
      case 'swim':
      case 'swimidle':
        this.animPhase = this.swimTick;
        break;
      default:
        this.animPhase = this.animTick;
        break;
    }
  }

  _currentSprite() {
    const key = this.pose;

    let set;
    if (this.state === 'growing' || this.state === 'shrinking') {
      set = this._flickerSet();
    } else {
      set = setFor(this.power, this.isLuigi);
    }
    const anim = pickAnim(set, key);
    if (!anim) return null;
    // Remember which frame of the cycle we are on. draw() uses it for the step
    // bob, and _updateAnim uses the change of frame as a footfall trigger.
    this._animIdx = typeof anim.indexAt === 'function' ? anim.indexAt(this.animPhase | 0) : 0;
    this._animLen = anim.frames ? anim.frames.length : 1;
    return anim.frame(this.animPhase | 0);
  }

  // small <-> big/fire transition art.
  //
  // When mario.js publishes the dedicated sequence it IS the animation: it already
  // interleaves the small, half-grown and big poses, so it is simply stepped by the
  // transition progress (backwards when shrinking). Only if that art is missing does
  // this fall back to flickering the two end sizes from the tables below.
  _flickerSet() {
    const g = this._grow || {};
    const frames = g.frames || P.growFrames;
    const growing = this.state === 'growing';
    const t = clamp(this.stateTimer / Math.max(1, frames), 0, 0.999);

    if (GROW_FRAMES) {
      const n = GROW_FRAMES.length;
      const i = clamp(Math.floor(t * n), 0, n - 1);
      const anim = stillAnim(GROW_FRAMES[growing ? i : n - 1 - i]);
      return { idle: anim, walk: anim, duck: anim, jump: anim };
    }

    const table = growing ? GROW_FLICKER : SHRINK_FLICKER;
    const pick = table[clamp(Math.floor(t * table.length), 0, table.length - 1)];
    const a = setFor(growing ? g.from || POWER.SMALL : this.power);
    const b = setFor(growing ? g.to || POWER.BIG : g.from || POWER.BIG);
    if (pick === 0) return a;
    if (pick === 1) return b;
    const midAnim = (b && b.grow) || (a && a.grow);
    if (midAnim) return { idle: midAnim, walk: midAnim, duck: midAnim, jump: midAnim };
    return a;
  }

  draw(ctx, cam) {
    if (this.hidden || this.removed) return;
    if (this.invulnFrames > 0 && this.starFrames <= 0 && (this.invulnFrames & 1) === 1) return;

    let sprite = this._currentSprite();
    if (!sprite) return;

    if (this.starFrames > 0) {
      const fast = this.starFrames > 120 ? 1 : 2;
      sprite = starVariant(sprite, (this.starTick >> fast) & 3);
    }

    const camX = cam ? cam.x : 0;
    const camY = cam ? cam.y : 0;
    const flip = this.facing < 0;
    const img = sprite.variant(flip, false);

    const ox = flip ? this.w - sprite.w - (sprite.ox || 0) : sprite.ox || 0;
    let dx = Math.floor(this.x - camX) + ox;
    let dy = Math.floor(this.y - camY) + (this.h - sprite.h) + (sprite.oy || 0);
    let dw = sprite.w;
    let dh = sprite.h;

    // Step bob. In a real walk cycle the body is highest at the passing pose and
    // lowest at each footfall, so the contact frames sit one pixel lower. One pixel
    // is all it takes at this scale — it turns a slide into a walk, and it scales
    // itself out at low speed so a creeping Mario does not jitter.
    if (this.grounded && (this.pose === 'walk' || this.pose === 'run')) {
      const len = this._animLen || 1;
      const passing = len > 1 && this._animIdx === 1;
      if (!passing && Math.abs(this.vx) > P.minWalk) dy += 1;
    }

    // Weight: squash on landing, stretch out of the takeoff.
    if (this.landSquash > 0) {
      const s = this.landSquash >= 3 ? 2 : 1;
      dh -= s;
      dy += s;
      dw += s;
      dx -= s >> 1;
    } else if (this.stretch > 0 && this.vy < 0) {
      dh += 1;
      dy -= 1;
    }

    const clipped = this._applyClip(ctx, camX, camY);
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.imageSmoothingEnabled = prevSmooth;
    if (clipped) ctx.restore();
  }

  _applyClip(ctx, camX, camY) {
    const c = this._clip;
    if (!c) return false;
    ctx.save();
    ctx.beginPath();
    if (c.axis === 'y') {
      const at = Math.floor(c.at - camY);
      if (c.side === 'above') ctx.rect(-64, -256, SCREEN_W + 128, at + 256);
      else ctx.rect(-64, at, SCREEN_W + 128, SCREEN_H + 256);
    } else {
      const at = Math.floor(c.at - camX);
      if (c.side === 'left') ctx.rect(-256, -64, at + 256, SCREEN_H + 128);
      else ctx.rect(at, -64, SCREEN_W + 256, SCREEN_H + 128);
    }
    ctx.clip();
    return true;
  }

  // -------------------------------------------------------------------------
  // debug
  // -------------------------------------------------------------------------

  debug() {
    return {
      state: this.state,
      pose: this.pose,
      power: this.power,
      x: +this.x.toFixed(2),
      y: +this.y.toFixed(2),
      vx: +this.vx.toFixed(3),
      vy: +this.vy.toFixed(3),
      w: this.w,
      h: this.h,
      grounded: this.grounded,
      ducking: this.ducking,
      skidding: this.skidding,
      inWater: this.inWater,
      star: this.starFrames,
      invuln: this.invulnFrames,
      chain: this.stompChain,
      fireballs: this.fireballs.length,
    };
  }
}
