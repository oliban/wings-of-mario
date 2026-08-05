// WHICH DRAWING OF MARIO THE PILOT SEES, and when it changes.
//
// The pilot's contact used to be one static figure sliding across the island,
// which read as a decal rather than as a man. This file is the pose choice and
// the leg cadence, and NOTHING else — no canvas, no sprite, no import. Pure
// functions of the numbers already on the wire, so the whole of it is testable
// in plain Node.
//
// THE CADENCE IS THE ROM'S, not a rate that looked about right. src/game/
// player.js takes it from GetPlayerAnimSpeed (smbdis.asm:6192-6223), and this
// is the same two thresholds and the same three timers reached independently
// from the same source — deliberately, because the two screens draw the same
// man walking and a gait that disagreed between them would be visible the
// moment anyone put the two windows side by side.
//
//   PlayerAnimTmrData .db $02, $04, $07   ; ticks each animation frame is held
//   >= $1c -> 2        >= $0e -> 4        else -> 7
//
// Speed units in the ROM are 1/16 px/frame, so the thresholds are 1.75 and
// 0.875 px/frame. Max WALK is $18 (1.5625) and never reaches $1c: the fast
// cadence belongs to the run alone, which is why holding B visibly churns the
// legs. Our cycle is three frames, exactly as ActionWalkRun's is, so the hold
// is the ROM's number unaltered — no scaling, no period arithmetic.
export const GAIT_RUN_SPEED = 1.75; // $1c/16
export const GAIT_MID_SPEED = 0.875; // $0e/16

export const HOLD_RUN = 2;
export const HOLD_MID = 4;
export const HOLD_WALK = 7;

// Below this he is standing still, not walking imperceptibly slowly. The ROM
// has no such threshold because it animates off the input; we work from a
// SAMPLED velocity that has been interpolated between two 20Hz snapshots, and
// interpolation leaves a thousandth of a pixel a frame on a man who has stopped
// dead. Without this the contact shuffles on the spot for ever.
export const STILL_SPEED = 0.05;

// A skid needs real speed behind it. Mario's `facing` flips the instant he
// presses the other way, so for the first few frames of every ordinary turn his
// velocity and his facing disagree — at walking-out-of-a-standstill speeds that
// is a turn, not a skid, and drawing braced feet for it makes him twitch every
// time he changes direction.
export const SKID_SPEED = 0.6;

export const POSE = {
  IDLE: 'idle',
  WALK: 'walk',
  SKID: 'skid',
  JUMP: 'jump',
};

// How long one drawing of the stride is held, in ticks, at this ground speed.
export function strideHold(speed) {
  const s = Math.abs(Number(speed) || 0);
  if (s >= GAIT_RUN_SPEED) return HOLD_RUN;
  if (s >= GAIT_MID_SPEED) return HOLD_MID;
  return HOLD_WALK;
}

// The pose, from the snapshot's own numbers. Ordered by what overrides what:
// being in the air beats everything, because a man who has jumped mid-stride is
// in the air whatever his legs were doing.
//
// `grounded` is sent by Mario's client (src/net/reach.js) and never inferred
// here. The pilot's client has no collision map for Mario's level and could not
// work out whether he is standing on anything — which is the same reason it
// does not decide whether a bomb hit him (spec 7.3).
export function contactPose({ vx = 0, vy = 0, grounded = 1, facing = 1 } = {}) {
  if (!grounded) return POSE.JUMP;
  const speed = Math.abs(Number(vx) || 0);
  if (speed < STILL_SPEED) return POSE.IDLE;
  // Moving one way while facing the other: the brake. Sign comparison only —
  // `facing` is ±1 and is one of the fields interp.js is told never to blend,
  // so it is always exactly the value Mario's client sent.
  const dir = vx < 0 ? -1 : 1;
  const face = Number(facing) < 0 ? -1 : 1;
  if (dir !== face && speed >= SKID_SPEED) return POSE.SKID;
  return POSE.WALK;
}

// Which of the three stride drawings, at this tick.
//
// A PURE FUNCTION OF THE TICK, rather than a counter advanced per frame. The
// pilot's renderer can drop frames, and a phase accumulated per rendered frame
// would then run the gait slow on exactly the machines least able to hide it.
// Driving it off the simulation tick makes the stride rate the same on a
// struggling laptop as on a fast one, which is the same argument sail.js makes
// for counting its fade in ticks.
export function strideFrame(tick, speed) {
  const hold = strideHold(speed);
  const t = Math.floor(Number(tick) || 0);
  return (Math.floor(t / hold) % 3 + 3) % 3;
}

// Everything the renderer needs, in one call: which pose, which frame of it,
// and how far to lift the figure this frame.
//
// `bob` is only ever non-zero on the walk's passing frame; every other pose
// returns 0, so a caller can add it unconditionally.
export function contactDrawing(snapshot = {}, tick = 0, bob = [0, 1, 0]) {
  const pose = contactPose(snapshot);
  if (pose !== POSE.WALK) return { pose, frame: 0, bob: 0 };
  const frame = strideFrame(tick, snapshot.vx);
  return { pose, frame, bob: bob[frame] || 0 };
}

export default contactDrawing;
