// THE SAIL: the beat between one archipelago and the next.
//
// The ocean holds one SMB world at a time (spec 2.1). When Mario clears the
// last island of it the carrier group weighs anchor, a fresh four-island
// archipelago is laid out for the next world, and the pilot begins again from
// the deck with a full squadron (spec 3.4). The user asked for that to be a
// SCENE rather than a swap: fade out, say what is happening, fade back in on
// the new sea.
//
// This file is that scene's clock and its words, and NOTHING else — no canvas,
// no DOM, no engine, no import at all. Two reasons:
//
//   BOTH SCREENS RUN IT. This is the one moment in the match where the two
//   players are looking at the same thing, so the durations and the sentences
//   have to be one definition read twice, not two that happen to agree today.
//
//   IT IS COUNTED IN TICKS, never in milliseconds. The pilot's fade is driven
//   by his simulation's tick and Mario's by the engine's fixed timestep, so a
//   screenshot at tick N is the same picture however many frames the browser
//   managed to draw getting there. A wall-clock fade would make that false on
//   both sides at once.
//
// Everything here is a pure function of ELAPSED TICKS. There is no clock to
// read and no state to get wrong; `Sail` below is a counter over these
// functions and is the only stateful thing in the file.

// At 60.0988Hz: 0.8s down, 3.0s of black to read in, 0.8s back up. Long
// enough to land as a deliberate beat and to finish reading two lines; short
// enough that a player who has seen it seven times is not waiting on it.
const FADE_OUT = 48;
const HOLD = 180;
const FADE_IN = 48;

// The text lives entirely INSIDE the black — it ramps up after the world has
// gone and down before the new one arrives, so it is never legible over
// either ocean. Half a second each way.
const TEXT_RAMP = 30;

export const SAIL = {
  FADE_OUT,
  HOLD,
  FADE_IN,
  TEXT_RAMP,
  // THE SWAP TICK. The old ocean is thrown away and the new one laid out at
  // exactly this elapsed tick, under a fully opaque veil, on both clients.
  // Not at the start (the player would watch the world vanish) and not at the
  // end (he would watch it arrive).
  SWAP: FADE_OUT,
  TOTAL: FADE_OUT + HOLD + FADE_IN,
};

export const PHASE = { OUT: 'fade-out', HOLD: 'hold', IN: 'fade-in', DONE: 'done' };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Smoothstep, so the veil does not arrive and leave with a visible corner.
const ease = (u) => {
  const t = clamp01(u);
  return t * t * (3 - 2 * t);
};

// The whole scene at `elapsed` ticks in. Pure: same number in, same frame out,
// for ever.
//
//   veil    0..1, how black the screen is
//   text    0..1, how legible the information text is
//   swapped has the ocean already been replaced at this point
//   done    is the scene over
export function sailFrame(elapsed) {
  const t = Math.max(0, Math.floor(elapsed));
  if (t >= SAIL.TOTAL) {
    return { phase: PHASE.DONE, veil: 0, text: 0, swapped: true, done: true, elapsed: t };
  }
  if (t < FADE_OUT) {
    return {
      phase: PHASE.OUT, veil: ease(t / FADE_OUT), text: 0, swapped: false, done: false, elapsed: t,
    };
  }
  if (t < FADE_OUT + HOLD) {
    const u = t - FADE_OUT;
    // Up over TEXT_RAMP, down over the last TEXT_RAMP, flat in between.
    const text = Math.min(ease(u / TEXT_RAMP), ease((HOLD - u) / TEXT_RAMP));
    return { phase: PHASE.HOLD, veil: 1, text, swapped: true, done: false, elapsed: t };
  }
  const u = t - FADE_OUT - HOLD;
  return {
    phase: PHASE.IN, veil: 1 - ease(u / FADE_IN), text: 0, swapped: true, done: false, elapsed: t,
  };
}

// What both screens say. ONE definition, read by the pilot's canvas and by
// Mario's overlay, so neither player can be told a different story about where
// the group is going.
//
// `note` is the one side-specific line: the pilot is told his squadron is
// whole again, Mario which island he is stepping ashore on. Everything above
// it is identical on the two screens.
export function sailText(from, to, note = '') {
  const lines = [
    `WORLD ${from} SECURED`,
    `MAKING FOR THE WORLD ${to} ARCHIPELAGO`,
  ];
  if (note) lines.push(String(note));
  return { title: 'THE CARRIER GROUP IS UNDER WAY', lines };
}

// The world number an island id belongs to: '2-1' -> 2. Null for anything that
// is not an island of the archipelago — a coin room, one of Harry's painted
// levels — which is exactly the set of things that must never start a sail.
export function worldOfIsland(id) {
  if (typeof id !== 'string' || !/^\d+-\d+$/.test(id)) return null;
  const n = Number(id.split('-')[0]);
  return Number.isFinite(n) ? n : null;
}

// The scene, as a tick counter over the functions above.
//
// It decides nothing about the match: it is STARTED by whoever heard that a
// world was cleared (Mario's client says so; the pilot's obeys) and it reports
// the one tick on which the ocean must be replaced. What replacing it means is
// the caller's business — src/wings/sim.js on the pilot's side, the engine's
// own level load on Mario's.
export class Sail {
  constructor() {
    this.active = false;
    this.elapsed = 0;
    this.from = 0;
    this.to = 0;
    this.note = '';
  }

  // Begin the crossing to `to`. Refused if one is already running or if the
  // group is not actually going anywhere: a resent worldCleared, or a stale
  // one for a world already behind us, must not restart the scene or sail
  // twice. That refusal is what makes this safe on a reliable channel that
  // delivers at least once and dedupes only by sequence number.
  begin({ from, to, note = '' } = {}) {
    if (this.active) return false;
    // `== null` before Number(), which turns null into a perfectly finite 0 and
    // would put "WORLD 0 SECURED" on both screens. A missing world number means
    // the island id could not be read (worldOfIsland returned null), and the
    // only safe thing to do with an unreadable crossing is not to make it.
    if (from == null || to == null) return false;
    const a = Number(from);
    const b = Number(to);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return false;
    this.active = true;
    this.elapsed = 0;
    this.from = a;
    this.to = b;
    this.note = note;
    return true;
  }

  // One tick. Returns the frame, with `swap` true on EXACTLY the tick the
  // ocean must be replaced, and `finished` true on exactly the tick the scene
  // ends. Both are edges, fired once, so a caller can act on them directly
  // without keeping a flag of its own.
  step() {
    if (!this.active) return { ...sailFrame(SAIL.TOTAL), swap: false, finished: false };
    this.elapsed++;
    const f = sailFrame(this.elapsed);
    const swap = this.elapsed === SAIL.SWAP;
    const finished = this.elapsed >= SAIL.TOTAL;
    if (finished) this.active = false;
    return { ...f, swap, finished };
  }

  frame() {
    if (!this.active) return { ...sailFrame(SAIL.TOTAL), swap: false, finished: false };
    return { ...sailFrame(this.elapsed), swap: false, finished: false };
  }

  text() {
    return sailText(this.from, this.to, this.note);
  }

  cancel() {
    this.active = false;
    this.elapsed = 0;
    return true;
  }
}

export default Sail;
