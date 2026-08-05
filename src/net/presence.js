// IS THERE REALLY SOMEBODY ON THE OTHER END — as opposed to "does the server
// still have a socket open for one".
//
// Pure, and in its own file, for the reason match-events.js is: it decides
// something the game behaves on, and everything around it (pilot-side.js) drags
// in the DOM and cannot be loaded outside a browser. The rule is three lines
// and it is worth being able to test them for what they are.
//
// THE BUG THIS EXISTS FOR. Presence was the server's `peerPresent` and nothing
// else. That is the right authority — but it can only go false when the server
// NOTICES, and it learned of a departure from the socket's `close` event, which
// only fires on an orderly shutdown. A laptop that sleeps, a phone that
// backgrounds Safari and a wifi drop all send no FIN at all, so the seat stayed
// occupied by nobody, for ever. The pilot's debug world jump refuses to move
// while a Mario is in the room — so a Mario who had silently vanished locked
// the pilot into one archipelago for the rest of the session.
//
// server/index.js now pings, which fixes the presence itself within twenty
// seconds. This is the faster second test, for the caller that wants LIVENESS
// rather than occupancy: Mario's client sends a snapshot every third tick for
// as long as it is running at all. It keeps sending them when he is down a
// pipe or in a coin room — an out-of-reach snapshot still goes on the wire,
// carrying no position (src/net/reach.js) — so silence means the client is
// gone, not that Mario is somewhere unusual.

// How long the other side may say nothing before this stops counting him as
// live. Counted in simulation ticks at 60.0988Hz, so a little over five
// seconds.
//
// DELIBERATELY GENEROUS. A sail freezes Mario's level for three seconds at the
// centre of the fade, and a level load stops the flow for a beat; calling a
// live Mario dead in the middle of either would be a worse bug than the one
// this fixes. The cost of being slow here is a few seconds of a debug key
// saying no, and the cost of being quick is the match disagreeing about who is
// in it.
export const PEER_SILENCE_TICKS = 300;

// `peerPresent` is the server's answer, `tick` is our own simulation clock and
// `lastHeard` is the tick a snapshot from the peer last arrived on — null if
// none ever has.
export function peerLive({ peerPresent, tick = 0, lastHeard = null } = {}) {
  if (!peerPresent) return false;
  // Present but never heard from: he is joining, and the first snapshot has not
  // landed yet. Believe the server. Refusing here would make the world jump
  // fail for a fraction of a second after every join, which is a worse tool
  // than one that works.
  if (lastHeard == null) return true;
  return tick - lastHeard < PEER_SILENCE_TICKS;
}

export default peerLive;
