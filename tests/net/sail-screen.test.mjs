import test from 'node:test';
import assert from 'node:assert/strict';

import { SailScreen, SAIL_SCREEN_ID } from '../../src/net/sail-screen.js';
import { SAIL, PHASE } from '../../src/wings/sail.js';

// Mario's fade lives on a plain element over #stage rather than on the
// engine's canvas, which is upstream-owned. That makes it testable in plain
// Node against the smallest document that can hold it: the things asserted
// here are the alpha at a given TICK, the words, and the level being held
// still while the screen is black — none of which need a browser.

function stubDoc() {
  const make = (tag) => {
    const el = {
      tagName: tag,
      id: '',
      className: '',
      dataset: {},
      style: {},
      children: [],
      _text: '',
      get textContent() {
        return this.children.length
          ? this.children.map((c) => c.textContent).join('\n')
          : this._text;
      },
      set textContent(v) {
        this._text = String(v);
        this.children = [];
      },
      appendChild(c) {
        this.children.push(c);
        return c;
      },
    };
    return el;
  };
  const stage = make('div');
  stage.id = 'stage';
  return {
    stage,
    createElement: (tag) => make(tag),
    getElementById: (id) => (id === 'stage' ? stage : null),
  };
}

// A world that only knows how to be held still — which is all this screen ever
// asks of one.
function stubWorld() {
  return {
    freezeTimer: 0,
    frozenTicks: 0,
    freeze(t) {
      if (t > this.freezeTimer) this.freezeTimer = t;
    },
    tick() {
      if (this.freezeTimer > 0) {
        this.freezeTimer--;
        this.frozenTicks++;
        return false;
      }
      return true;
    },
  };
}

test('the screen mounts one element over the stage and starts invisible', () => {
  const doc = stubDoc();
  const s = new SailScreen(doc);
  s.mount();
  assert.equal(doc.stage.children.length, 1);
  assert.equal(doc.stage.children[0].id, SAIL_SCREEN_ID);
  assert.equal(s.el.style.opacity, undefined);
  s.mount();
  assert.equal(doc.stage.children.length, 1, 'mounted twice');
});

test('the veil follows the TICK COUNT, not a clock', () => {
  const doc = stubDoc();
  const s = new SailScreen(doc);
  assert.equal(s.begin({ from: 1, to: 2, note: 'MARIO GOES ASHORE ON 2-1' }), true);

  const world = stubWorld();
  const seen = [];
  for (let i = 0; i < SAIL.TOTAL; i++) seen.push(s.step(world).veil);

  assert.equal(seen[0] > 0, true);
  assert.equal(seen[SAIL.FADE_OUT - 1], 1, 'not black by the end of the fade');
  assert.equal(seen[SAIL.FADE_OUT + 10], 1);
  assert.equal(seen[SAIL.TOTAL - 1], 0, 'the veil never lifted');
  assert.equal(s.active, false);
  assert.equal(s.el.style.opacity, '0');
  assert.equal(s.el.style.visibility, 'hidden');
});

test('the level is HELD STILL for exactly as long as the screen is black', () => {
  const doc = stubDoc();
  const s = new SailScreen(doc);
  s.begin({ from: 1, to: 2 });
  const world = stubWorld();
  let live = 0;
  let held = 0;
  for (let i = 0; i < SAIL.TOTAL; i++) {
    const f = s.step(world);
    // The engine consumes the freeze on its own update, in the same tick.
    if (world.tick()) live++;
    else held++;
    if (f.veil === 1) assert.ok(world.frozenTicks > 0, 'black over a live level');
  }
  assert.ok(held >= SAIL.HOLD - 2, `held only ${held} of ${SAIL.HOLD} black ticks`);
  // And he is playing again on both sides of it: the fades are not a freeze.
  assert.ok(live >= SAIL.FADE_OUT + SAIL.FADE_IN - 4, `only ${live} live ticks`);
});

test('the words go up under the black and name where the group is going', () => {
  const doc = stubDoc();
  const s = new SailScreen(doc);
  s.begin({ from: 1, to: 2, note: 'MARIO GOES ASHORE ON 2-1' });
  const world = stubWorld();
  for (let i = 0; i < SAIL.FADE_OUT; i++) {
    assert.equal(s.step(world).text, 0, 'text legible over the live level');
  }
  for (let i = 0; i < 40; i++) s.step(world);
  assert.ok(s.textAlpha > 0);
  const said = s.card.textContent;
  assert.match(said, /THE CARRIER GROUP IS UNDER WAY/);
  assert.match(said, /WORLD 1 SECURED/);
  assert.match(said, /WORLD 2 ARCHIPELAGO/);
  assert.match(said, /MARIO GOES ASHORE ON 2-1/);
});

test('a repeat of the same crossing is ignored while one is running', () => {
  const doc = stubDoc();
  const s = new SailScreen(doc);
  assert.equal(s.begin({ from: 1, to: 2 }), true);
  s.step(null);
  assert.equal(s.begin({ from: 1, to: 2 }), false);
  assert.equal(s.crossings, 1);
  assert.equal(s.state().elapsed, 1);
});

test('a crossing that goes nowhere is refused outright', () => {
  const s = new SailScreen(stubDoc());
  // What an 8-4 would look like if `final` were ever ignored upstream: there is
  // no world 9, so `to` cannot be ahead of `from`.
  assert.equal(s.begin({ from: 8, to: 8 }), false);
  assert.equal(s.begin({ from: null, to: 2 }), false);
  assert.equal(s.crossings, 0);
  assert.equal(s.state().active, false);
});

test('state() reports the phase a screenshot would have caught', () => {
  const s = new SailScreen(stubDoc());
  s.begin({ from: 2, to: 3 });
  const world = stubWorld();
  for (let i = 0; i < SAIL.FADE_OUT + 5; i++) s.step(world);
  const st = s.state();
  assert.equal(st.active, true);
  assert.equal(st.phase, PHASE.HOLD);
  assert.equal(st.veil, 1);
  assert.equal(st.from, 2);
  assert.equal(st.to, 3);
});

test('a screen with no document at all does not throw', () => {
  const s = new SailScreen(null);
  assert.equal(s.begin({ from: 1, to: 2 }), true);
  assert.doesNotThrow(() => s.step(null));
  assert.doesNotThrow(() => s.state());
});
