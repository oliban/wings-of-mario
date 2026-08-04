import { Entity, registerEntity } from '../entity.js';
import * as ITEMS from '../../data/sprites/items.js';
import { animOf, awardPowerup, drawEmerging, fx, sfx } from './mushroom.js';

// The TOOLBELT power-up. Mechanically a fire flower: it comes out of a block
// ROOTED (it never walks, see blocks.js:183), it rises on the block system's
// emerge lift, and one touch hands the power to whoever walked into it.
// What it grants is player.powerUp('toolbelt') — the wiring in player.js owns
// what that means; this file only delivers it.

// The power name handed to player.powerUp(). Exported so the wiring agent and
// the block randomiser agree on one string rather than two spellings.
export const TOOLBELT_POWER = 'toolbelt';

//  0 outline   1 leather dark  2 leather mid  3 leather light
//  4 brass dark 5 brass light   6 steel dark   7 steel light   8 specular
const BELT_PAL = [
  '#1a1008',
  '#5a2d0c',
  '#8a4a14',
  '#c07a2a',
  '#a06010',
  '#ffd830',
  '#6a6a7a',
  '#d8d8e8',
  '#ffffff',
];

// A hammer and a wrench standing out of a strap with a brass buckle. The two
// tools break the silhouette above the strap line, which is what makes it read
// as "builder" at 16x16 rather than as a brown bar.
const BELT_A = [
  '................',
  '.00000....00.00.',
  '.07760....07.70.',
  '.06660....06660.',
  '..0330.....0660.',
  '..0330.....0660.',
  '..0330.....0660.',
  '0000000000000000',
  '0222220440222220',
  '0233330550333330',
  '0222220440222220',
  '0000000000000000',
  '...01111110.....',
  '...01222210.....',
  '...01222210.....',
  '...00000000.....',
];

// Frame B is the same belt with the buckle catching the light and a glint on
// the wrench — nothing in this game may sit perfectly still (ARCHITECTURE §12).
const BELT_B = [
  '................',
  '.00000....00.00.',
  '.07860....08.70.',
  '.06660....06660.',
  '..0330.....0660.',
  '..0330.....0660.',
  '..0330.....0660.',
  '0000000000000000',
  '0222220550222220',
  '0233330580333330',
  '0222220550222220',
  '0000000000000000',
  '...01111110.....',
  '...01222210.....',
  '...01322210.....',
  '...00000000.....',
];

// items.js is authored by another agent in parallel: take TOOLBELT.idle if it
// is there, the export itself if it is a bare Anim/Sprite/rows, and our own
// pixels if it is neither. animOf() accepts all of those shapes.
const AUTHORED = (ITEMS.TOOLBELT && (ITEMS.TOOLBELT.idle || ITEMS.TOOLBELT.frames)) || ITEMS.TOOLBELT;

const BELT_ANIM = animOf(AUTHORED, [BELT_A, BELT_B], BELT_PAL, { name: 'toolbelt' }, 10);

export default class Toolbelt extends Entity {
  static type = 'toolbelt';

  constructor(world, x, y, opts = {}) {
    super(world, x, y, opts);
    this.w = 16;
    this.h = 16;
    this.t = 0;
    this.isItem = true;
    this.rooted = true;
    this.autoCorpse = false;
    this.vx = 0;
    this.vy = 0;
    if (opts.fromBlock) sfx(world, 'item-appear');
  }

  onEmerged() {
    fx(this.world, 'powerupSparkle', this.x + 8, this.y + 8);
  }

  // Rooted items ignore bumps from the block underneath them.
  onBlockBump() {}

  update() {
    this.t++;
    if (this.x + this.w < this.world.cam.x - 32) this.removed = true;
  }

  onPlayerTouch(player) {
    if (this.removed) return false;
    this.removed = true;
    // `already` suppresses the 1000 — awardPowerup pays it only when the touch
    // actually changed Mario, exactly as the flower does.
    const already = !!player && player.power === TOOLBELT_POWER;
    awardPowerup(this.world, player, TOOLBELT_POWER, this.x + 8, this.y, already);
    return true;
  }

  onStomp() {
    return false;
  }

  onFireball() {
    return false;
  }

  draw(ctx, cam) {
    drawEmerging(this, ctx, cam, BELT_ANIM.frame(this.t));
  }
}

registerEntity(Toolbelt);
registerEntity('toolbeltitem', Toolbelt);
registerEntity('builder', Toolbelt);
