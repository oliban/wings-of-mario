import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { getLevel } from '../../src/data/levels/index.js';

// THE CLOCK EVERY LEVEL GETS, against the ROM's own header.
//
// The user: "there are discrepancies now that make it hard to beat the level"
// — about 8-4. The largest single cause was its clock: ours gave 300 where the
// original gives 400, on the longest level in the game, with a 317-column
// traverse and an 86-column swim and no timer reset at any internal warp. A
// wrong pipe costs a whole room, and the original's slack to survive two or
// three of them was simply missing.
//
// GetAreaDataAddrs (smbdis.asm:4418-4423) takes the top two bits of an area's
// first header byte as an index into GameTimerData (asm:2829-2831), which is
// `dummy, $04, $03, $02` — 400, 300, 200 seconds. So the timer is not a
// convention about level TYPE, which is what our generators assumed when they
// wrote `time: 300` into the castle template; it is data, and three castles
// disagree with the convention.
const TIMER = [null, 400, 300, 200];

const ref = JSON.parse(readFileSync(new URL('../../reference/smb-areas.json', import.meta.url)));

const romTimer = (levelId) => {
  const rec = ref.levelMap && ref.levelMap[levelId];
  const area = rec && ref.areas[rec.area];
  if (!area || !Array.isArray(area.header)) return null;
  return TIMER[(area.header[0] & 0xc0) >> 6];
};

test('the three castles that were short-changed now get the ROM\'s clock', () => {
  // 8-4 is the one the user hit; 4-4 and 7-4 had the same generator assumption
  // and the same 100 seconds missing.
  for (const id of ['4-4', '7-4', '8-4']) {
    assert.equal(romTimer(id), 400, `${id}: the reference does not say 400`);
    assert.equal(getLevel(id).time, 400, `${id} still ships the wrong clock`);
  }
});

test('no level is TIGHTER than the original', () => {
  // The direction that matters. A level more generous than the ROM is a
  // balance choice; a level tighter than the ROM is the game being unfair in a
  // way the player cannot see. Seven levels are currently more generous (1-3,
  // 2-3, 3-2, 5-1, 7-3, 8-1, 8-3 all give 400 where the ROM gives 300) and
  // that is a decision, not a defect — this pins that none goes the other way.
  const tight = [];
  for (let w = 1; w <= 8; w++) {
    for (let l = 1; l <= 4; l++) {
      const id = `${w}-${l}`;
      const level = getLevel(id);
      const rom = romTimer(id);
      if (!level || rom == null || level.time == null) continue;
      if (level.time < rom) tight.push(`${id}: ${level.time} < ${rom}`);
    }
  }
  assert.deepEqual(tight, [], `levels tighter than the original: ${tight.join(', ')}`);
});
