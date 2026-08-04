import test from 'node:test';
import assert from 'node:assert/strict';
import { bootRoom, shutdownRoom } from './helpers.mjs';

// The bug this file exists for: reloading the page as Mario — the single most
// ordinary interruption there is — was answered with SEAT TAKEN, by the
// player's own previous connection. Spec 7.4 says the server holds the match so
// a disconnect reconnects into it; a reload is a disconnect, and it locked the
// player out of their own match permanently.
//
// A reload is asserted here rather than in a unit test because the whole
// question is what survives the page: a token that lives only in the Session
// object dies with the document, and nothing below the browser can notice that.

test('reloading as Mario returns to the same seat in the same room', { timeout: 180000 }, async (t) => {
  const ctx = await bootRoom({ room: 'CDEF' });
  t.after(() => shutdownRoom(ctx));

  const before = await ctx.mario.page.evaluate(() => window.__NET.state());
  assert.equal(before.connected, true);
  assert.equal(before.side, 'mario');

  await ctx.mario.page.reload();
  await ctx.mario.page.waitForFunction(() => window.__GAME && window.__GAME.ready, null, { timeout: 30000 });
  await ctx.mario.page.evaluate(() => window.__NET.ready);

  const after = await ctx.mario.page.evaluate(() => window.__NET.state());
  assert.equal(after.connected, true, 'the reloaded page must be back on the wire');
  assert.equal(after.room, 'CDEF', 'and in the same room');
  assert.equal(after.side, 'mario', 'and in the same seat');
  // The same archipelago: the seed decides which islands exist, so a different
  // one would be a different world under the same room code.
  assert.equal(after.seed, before.seed, 'and in the same archipelago');
  // Told so, rather than merely being right by accident.
  assert.equal(
    await ctx.mario.page.evaluate(() => window.__NET.session.reconnected),
    true,
    'the server should recognise this as a reconnect, not a fresh seat'
  );

  const banner = await ctx.mario.page.textContent('#net-banner');
  assert.ok(!banner.includes('SEAT TAKEN'), `banner still accuses the player: ${banner}`);
  assert.ok(banner.includes('CDEF') && banner.includes('MARIO'), `banner: ${banner}`);

  // The peer is still there, from both ends. The pilot never lost Mario: the
  // stale socket's close must not mark a seat that a live page is sitting in.
  await ctx.mario.page.waitForFunction(
    () => window.__NET.state().peer === true, null, { timeout: 20000 }
  );
  await ctx.pilot.page.waitForFunction(
    () => window.__WINGS.net.state().peer === true, null, { timeout: 20000 }
  );

  // The pilot's page does the same thing with the same three lines, so it is
  // asserted rather than assumed — on the SAME room, which also says a second
  // reconnect after a first one is nothing special.
  await ctx.pilot.page.reload();
  await ctx.pilot.page.waitForFunction(() => window.__WINGS && window.__WINGS.ready, null, { timeout: 30000 });
  await ctx.pilot.page.evaluate(() => window.__WINGS.net.ready);
  const pilotState = await ctx.pilot.page.evaluate(() => window.__WINGS.net.state());
  assert.equal(pilotState.connected, true, 'the pilot reloads back into the match too');
  assert.equal(pilotState.room, 'CDEF');
  assert.equal(pilotState.side, 'pilot');
  assert.equal(pilotState.seed, before.seed, 'the same archipelago it took off from');
});

// The other half of the bargain, and the reason the token is per-tab: the user
// plays both seats on one laptop. A second, genuinely different client must
// still be refused, and reconnect must not become a way around that.
test('a second client is still refused the seat', { timeout: 180000 }, async (t) => {
  const ctx = await bootRoom({ room: 'CDEG' });
  t.after(() => shutdownRoom(ctx));

  const context = await ctx.browser.newContext();
  const page = await context.newPage();
  await page.goto(`${ctx.base}/?room=CDEG&side=mario`);
  await page.waitForFunction(() => window.__GAME && window.__GAME.ready, null, { timeout: 30000 });
  await page.evaluate(() => window.__NET.ready);

  assert.equal(await page.evaluate(() => window.__NET.state().connected), false);
  assert.ok(
    (await page.textContent('#net-banner')).includes('SEAT TAKEN'),
    'a different player must still be told the seat is taken'
  );
  // And the tab it belongs to is untouched by the attempt.
  assert.equal(await ctx.mario.page.evaluate(() => window.__NET.state().connected), true);
  await context.close();
});
