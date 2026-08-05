import test from 'node:test';
import assert from 'node:assert/strict';

import * as A from '../../src/wings/contact-anim.js';

// The cadence is the ROM's (GetPlayerAnimSpeed, smbdis.asm:6192-6223) and these
// are its numbers, asserted rather than assumed. If someone retunes the gait by
// eye, this is where it says so.
test('the three gaits are the ROM\'s two thresholds, not a curve', () => {
  assert.equal(A.strideHold(0), A.HOLD_WALK);
  assert.equal(A.strideHold(0.874), A.HOLD_WALK);
  // $0e/16 exactly: the ROM switches ON the threshold, not past it.
  assert.equal(A.strideHold(0.875), A.HOLD_MID);
  assert.equal(A.strideHold(1.5625), A.HOLD_MID);
  // $1c/16. Max WALK is $18 (1.5625) and never gets here: the fast cadence
  // belongs to the run alone.
  assert.equal(A.strideHold(1.75), A.HOLD_RUN);
  assert.equal(A.strideHold(3), A.HOLD_RUN);
});

test('the gait does not care which way he is going', () => {
  for (const s of [0.5, 1.0, 2.0]) {
    assert.equal(A.strideHold(-s), A.strideHold(s), `speed ${s}`);
  }
});

test('a run churns the legs faster than a walk, in the ROM\'s ratio', () => {
  // 7 ticks a frame at a stroll, 2 at a full run: the stride is three and a
  // half times the rate, which is the whole reason holding B reads as speed.
  assert.equal(A.strideHold(0.5) / A.strideHold(2.0), 3.5);
});

test('the stride is three drawings and it loops', () => {
  const seen = new Set();
  for (let t = 0; t < 120; t++) seen.add(A.strideFrame(t, 1.0));
  assert.deepEqual([...seen].sort(), [0, 1, 2]);
});

test('each drawing is held for the full gait and never flashes for one tick', () => {
  for (const speed of [0.5, 1.0, 2.0]) {
    const hold = A.strideHold(speed);
    let run = 1;
    let prev = A.strideFrame(0, speed);
    for (let t = 1; t <= 300; t++) {
      const f = A.strideFrame(t, speed);
      if (f === prev) { run++; continue; }
      // Every completed run of one drawing is exactly the gait's hold. A
      // single-tick pose is what strobes, and it is what this forbids.
      assert.equal(run, hold, `speed ${speed} held a frame for ${run}, want ${hold}`);
      run = 1;
      prev = f;
    }
  }
});

test('the stride advances on the SIMULATION tick, so a dropped frame cannot slow it', () => {
  // Two clients a hundred ticks apart in wall-clock but on the same tick draw
  // the same leg. That is the property; a per-rendered-frame counter would not
  // have it.
  assert.equal(A.strideFrame(48, 1.0), A.strideFrame(48, 1.0));
  const hold = A.strideHold(1.0);
  assert.notEqual(A.strideFrame(0, 1.0), A.strideFrame(hold, 1.0));
});

// ---- poses ----------------------------------------------------------------

test('standing still is standing still, interpolation dust and all', () => {
  assert.equal(A.contactPose({ vx: 0, grounded: 1 }), A.POSE.IDLE);
  // The reason STILL_SPEED exists: a 20Hz snapshot interpolated at 60Hz leaves
  // a thousandth of a pixel a frame on a man who has stopped dead, and without
  // a floor he shuffles on the spot for ever.
  assert.equal(A.contactPose({ vx: 0.004, grounded: 1 }), A.POSE.IDLE);
  assert.equal(A.contactPose({ vx: -0.004, grounded: 1 }), A.POSE.IDLE);
});

test('walking either way is a walk', () => {
  assert.equal(A.contactPose({ vx: 1.2, facing: 1, grounded: 1 }), A.POSE.WALK);
  assert.equal(A.contactPose({ vx: -1.2, facing: -1, grounded: 1 }), A.POSE.WALK);
});

test('the air beats every ground pose, whatever the legs were doing', () => {
  assert.equal(A.contactPose({ vx: 2.5, facing: 1, grounded: 0 }), A.POSE.JUMP);
  assert.equal(A.contactPose({ vx: 0, grounded: 0 }), A.POSE.JUMP);
  // Rising and falling are one drawing: small Mario has one jump pose in SMB
  // too, and four pixels of difference is invisible at 400 feet.
  assert.equal(
    A.contactPose({ vy: -4, grounded: 0 }),
    A.contactPose({ vy: 4, grounded: 0 }),
  );
});

test('moving against his facing at speed is a skid', () => {
  assert.equal(A.contactPose({ vx: -2, facing: 1, grounded: 1 }), A.POSE.SKID);
  assert.equal(A.contactPose({ vx: 2, facing: -1, grounded: 1 }), A.POSE.SKID);
});

test('an ordinary turn is not a skid', () => {
  // `facing` flips the instant he presses the other way, so for a few frames of
  // EVERY turn the velocity and the facing disagree. Drawing braced feet for
  // that made him twitch each time he changed direction.
  assert.equal(A.contactPose({ vx: -0.3, facing: 1, grounded: 1 }), A.POSE.WALK);
  assert.equal(A.contactPose({ vx: 0.3, facing: -1, grounded: 1 }), A.POSE.WALK);
});

test('a missing grounded flag draws him on his feet, not falling for ever', () => {
  // An old client, or a snapshot from before the field existed. The safe
  // default is the pose he is in for most of the game.
  assert.equal(A.contactPose({ vx: 0 }), A.POSE.IDLE);
  assert.equal(A.contactPose({}), A.POSE.IDLE);
});

// ---- the whole call -------------------------------------------------------

test('only the passing frame bobs, so a caller can add it blind', () => {
  const bob = [0, 1, 0];
  for (const pose of [{ vx: 0, grounded: 1 }, { vx: 2, facing: -1, grounded: 1 },
    { vx: 1, grounded: 0 }]) {
    assert.equal(A.contactDrawing(pose, 7, bob).bob, 0);
  }
  const lifted = [];
  for (let t = 0; t < 60; t++) {
    const d = A.contactDrawing({ vx: 1.0, facing: 1, grounded: 1 }, t, bob);
    if (d.bob) lifted.push(d.frame);
  }
  assert.ok(lifted.length > 0, 'the walk never lifted him at all');
  assert.deepEqual([...new Set(lifted)], [1], 'something other than the pass bobbed');
});

test('every pose but the walk pins the frame, so no other art needs three of it', () => {
  for (let t = 0; t < 40; t++) {
    assert.equal(A.contactDrawing({ vx: 0, grounded: 1 }, t).frame, 0);
    assert.equal(A.contactDrawing({ vx: 3, grounded: 0 }, t).frame, 0);
    assert.equal(A.contactDrawing({ vx: -3, facing: 1, grounded: 1 }, t).frame, 0);
  }
});
