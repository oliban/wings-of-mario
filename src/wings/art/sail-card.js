import { PANEL } from './palette.js';

// The card the ocean changes behind: a black veil over the whole viewport and,
// once it is opaque, the signal telling the pilot where the group is going.
//
// It is drawn in the INSTRUMENT PANEL'S voice — the same condensed monospace,
// the same green bezel and pale ink — because that is the only typography this
// screen has, and a title card in some other face would read as a different
// program. The rules above and below the title are the bezel colour for the
// same reason.
//
// Composition only, like everything else in art/: the alphas and the words
// arrive from src/wings/sail.js, which counts them in simulation ticks.

const FONT_TITLE = '700 13px ui-monospace, "SF Mono", Menlo, monospace';
const FONT_LINE = '600 9px ui-monospace, "SF Mono", Menlo, monospace';

// Draw the veil and, at `view.text` > 0, the text. `view` is
// { veil, text, title, lines } — sailFrame() spread with sailText().
export function drawSailCard(ctx, w, h, view) {
  if (!view || view.veil <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, view.veil);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const a = view.text || 0;
  if (a <= 0) return;
  const cx = w / 2;
  // Anchored above centre so the block of lines below it sits ON the middle of
  // the screen rather than starting there.
  const top = Math.round(h * 0.38);

  ctx.save();
  ctx.globalAlpha = Math.min(1, a);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = FONT_TITLE;
  ctx.fillStyle = PANEL.ink;
  ctx.fillText(String(view.title || ''), cx, top);

  // A rule under the title, at the width of the title itself.
  const rule = Math.max(120, ctx.measureText(String(view.title || '')).width + 24);
  ctx.strokeStyle = PANEL.bezel;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - rule / 2, top + 7.5);
  ctx.lineTo(cx + rule / 2, top + 7.5);
  ctx.stroke();

  ctx.font = FONT_LINE;
  const lines = view.lines || [];
  for (let i = 0; i < lines.length; i++) {
    // The last line is the side-specific one — the pilot's squadron, Mario's
    // landfall — and is dimmed so it reads as a footnote to the news above it.
    ctx.fillStyle = i === lines.length - 1 && lines.length > 1 ? PANEL.inkDim : PANEL.ink;
    ctx.fillText(String(lines[i]), cx, top + 26 + i * 14);
  }
  ctx.restore();
}

export default drawSailCard;
