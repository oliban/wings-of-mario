import { Sail, PHASE } from '../wings/sail.js';

// THE SAIL, on Mario's screen.
//
// The pilot gets his fade painted into the flight canvas (src/wings/scene.js
// and art/sail-card.js). Mario's canvas is the ENGINE'S, and it is
// upstream-owned — so this is a plain element stacked over #stage, exactly the
// trick src/wings/mario-overlay.js and src/net/mario-overlay.js already use for
// their canvases. One div, zero merge surface, no file under src/game touched.
//
// The WORDS and the DURATIONS come from src/wings/sail.js, which the pilot's
// side reads too: this is the one moment in the match where both players are
// looking at the same thing, and they are told the same thing for the same
// length of time because there is one definition of it.
//
// IT IS STEPPED ON THE ENGINE'S FIXED CLOCK, from the hook list in
// src/wings/mario-main.js — never on rAF and never against a wall clock. Same
// reason as the pilot's: the alpha at tick N has to be the alpha at tick N.
//
// While the veil is fully opaque the LEVEL IS HELD, through world.freeze() —
// the engine's own hit-stop, a public method, called rather than edited. Three
// seconds of black over a live level is three seconds of a goomba walking into
// a man who cannot see it coming.

export const SAIL_SCREEN_ID = 'sail-screen';

// Two ticks at a time, re-asserted every tick of the hold: freeze() only ever
// raises the timer, so this holds the level for exactly as long as the black
// lasts and lets go within a tick of it lifting.
const FREEZE_TICKS = 2;

export class SailScreen {
  constructor(doc = typeof document === 'undefined' ? null : document) {
    this.doc = doc;
    this.sail = new Sail();
    this.el = null;
    this.card = null;
    this.veil = 0;
    this.textAlpha = 0;
    // Test surface: how many crossings this screen has played, and the last
    // one's numbers. Presentation keeps no match state beyond this.
    this.crossings = 0;
    this.last = null;
  }

  get active() {
    return this.sail.active;
  }

  mount() {
    if (this.el || !this.doc) return this.el;
    const stage = this.doc.getElementById('stage');
    if (!stage) return null;
    const el = this.doc.createElement('div');
    el.id = SAIL_SCREEN_ID;
    el.style.cssText = [
      'position:absolute', 'inset:0', 'z-index:6', 'pointer-events:none',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:#000', 'opacity:0', 'visibility:hidden', 'border-radius:4px',
      'font:600 13px/1.6 ui-monospace,"SF Mono",Menlo,monospace',
      'text-align:center', 'letter-spacing:.06em',
    ].join(';');
    const card = this.doc.createElement('div');
    card.className = 'sail-card';
    card.style.cssText = 'opacity:0;color:#dfe9f2;padding:0 16px';
    el.appendChild(card);
    stage.appendChild(el);
    this.el = el;
    this.card = card;
    return el;
  }

  // Mario's client cleared the world, so Mario's client starts the scene. `to`
  // is the world he has actually walked into, which a warp zone can put three
  // ahead of the one he was in.
  begin({ from, to, note = '' } = {}) {
    if (!this.sail.begin({ from, to, note })) return false;
    this.mount();
    this.crossings++;
    this.last = { from: this.sail.from, to: this.sail.to };
    this.render();
    return true;
  }

  // One fixed engine tick. `world` is __GAME.world, held still while the veil
  // is opaque.
  step(world) {
    if (!this.sail.active) return null;
    const f = this.sail.step();
    // The hold is the part that is fully black on BOTH screens, and it is
    // exactly the part where a level running underneath would be unfair.
    if (world && typeof world.freeze === 'function' && f.phase === PHASE.HOLD) {
      world.freeze(FREEZE_TICKS);
    }
    this.veil = f.veil;
    this.textAlpha = f.text;
    this.render(f);
    return f;
  }

  render(frame = null) {
    if (!this.el) this.mount();
    if (!this.el) return null;
    const f = frame || this.sail.frame();
    const veil = this.sail.active ? f.veil : 0;
    const text = this.sail.active ? f.text : 0;
    this.el.style.opacity = String(veil);
    // Off entirely rather than transparent, so a finished crossing cannot sit
    // over the game swallowing anything.
    this.el.style.visibility = veil > 0 ? 'visible' : 'hidden';
    if (this.card) {
      this.card.style.opacity = String(text);
      if (text > 0 && this.card.dataset.for !== `${this.sail.from}>${this.sail.to}`) {
        const t = this.sail.text();
        this.card.dataset.for = `${this.sail.from}>${this.sail.to}`;
        this.card.textContent = '';
        const h = this.doc.createElement('div');
        h.className = 'sail-title';
        h.style.cssText = 'font-size:15px;font-weight:700;border-bottom:1px solid #7dbf35;'
          + 'padding-bottom:6px;margin-bottom:10px';
        h.textContent = t.title;
        this.card.appendChild(h);
        t.lines.forEach((line, i) => {
          const p = this.doc.createElement('div');
          p.className = 'sail-line';
          // The last line is the side-specific one — here, where Mario steps
          // ashore — dimmed as a footnote, exactly as on the pilot's card.
          if (i === t.lines.length - 1 && t.lines.length > 1) p.style.color = '#7d8fa1';
          p.textContent = line;
          this.card.appendChild(p);
        });
      }
    }
    return this.el;
  }

  state() {
    const f = this.sail.frame();
    return {
      active: this.sail.active,
      from: this.sail.from,
      to: this.sail.to,
      phase: this.sail.active ? f.phase : null,
      veil: this.sail.active ? f.veil : 0,
      text: this.sail.active ? f.text : 0,
      elapsed: this.sail.active ? f.elapsed : 0,
      crossings: this.crossings,
    };
  }

  cancel() {
    this.sail.cancel();
    this.render();
    return true;
  }
}

export default SailScreen;
