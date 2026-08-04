import { ORD } from './palette.js';

// Ordnance and the things it leaves behind. Small, but they are the only warm
// colours in the scene apart from the squadron flash, so they carry a lot of
// weight against a near-black sky.

export function drawBomb(ctx, x, y, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const g = ctx.createLinearGradient(-3, 0, 3, 0);
  g.addColorStop(0, ORD.steelLit);
  g.addColorStop(0.45, ORD.steel);
  g.addColorStop(1, ORD.steelDark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.quadraticCurveTo(3, -4, 3, 1);
  ctx.lineTo(2, 6);
  ctx.lineTo(-2, 6);
  ctx.lineTo(-3, 1);
  ctx.quadraticCurveTo(-3, -4, 0, -7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = ORD.steelDark;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-3.2, 8);
  ctx.lineTo(0, 4.5);
  ctx.lineTo(3.2, 8);
  ctx.stroke();
  ctx.restore();
}

export function drawRocket(ctx, x, y, angle, tick) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const g = ctx.createLinearGradient(0, -2, 0, 2);
  g.addColorStop(0, ORD.steelLit);
  g.addColorStop(1, ORD.steelDark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(1, -2);
  ctx.lineTo(-6, -2);
  ctx.lineTo(-6, 2);
  ctx.lineTo(1, 2);
  ctx.closePath();
  ctx.fill();
  // Exhaust plume, flickering off the tick.
  const f = 0.7 + 0.3 * Math.sin(tick * 0.8);
  const p = ctx.createLinearGradient(-6, 0, -6 - 11 * f, 0);
  p.addColorStop(0, ORD.flameCore);
  p.addColorStop(0.4, ORD.flameHot);
  p.addColorStop(1, 'rgba(164,71,15,0)');
  ctx.fillStyle = p;
  ctx.beginPath();
  ctx.moveTo(-6, -2.2);
  ctx.lineTo(-6 - 11 * f, 0);
  ctx.lineTo(-6, 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawTracer(ctx, x, y, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const g = ctx.createLinearGradient(-6, 0, 3, 0);
  g.addColorStop(0, 'rgba(255,214,107,0)');
  g.addColorStop(1, ORD.tracer);
  ctx.strokeStyle = g;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(3, 0);
  ctx.stroke();
  ctx.restore();
}

// A round striking Mario, `t` running 0..1 over the spark's short life. Four
// fixed spokes and a core, shrinking and fading — the smallest thing that reads
// as "that hit you" from a 256x240 screen with a man standing in front of it.
// The spokes are a fixed function of their index, never of a random number, so
// two clients drawing the same hit draw the same spark.
export function drawGunSpark(ctx, x, y, t) {
  if (t >= 1) return;
  const fade = 1 - t;
  const r = 2 + 5 * t;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = fade;
  ctx.strokeStyle = ORD.tracer;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    ctx.moveTo(dx * 1.5, dy * 1.5);
    ctx.lineTo(dx * r, dy * r);
  }
  ctx.stroke();
  ctx.fillStyle = ORD.flameCore;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

// A fireball, `t` running 0..1 over its life: a white flash that blooms into
// flame and collapses into smoke. Deterministic — the lobe layout is a fixed
// function of the lobe index, never of a random number.
export function drawFireball(ctx, x, y, t, size = 20) {
  if (t >= 1) return;
  ctx.save();
  ctx.translate(x, y);
  const grow = size * (0.35 + 1.25 * Math.min(1, t * 2.2));
  const fade = 1 - t;

  if (t < 0.18) {
    ctx.globalAlpha = 1 - t / 0.18;
    ctx.fillStyle = ORD.flameCore;
    ctx.beginPath();
    ctx.arc(0, 0, grow * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + t * 1.1;
    const d = grow * (0.28 + ((i * 29) % 40) / 100);
    const r = grow * (0.34 + ((i * 17) % 30) / 100) * (1 - t * 0.35);
    const lg = ctx.createRadialGradient(
      Math.cos(a) * d, Math.sin(a) * d - grow * t * 0.5, 0,
      Math.cos(a) * d, Math.sin(a) * d - grow * t * 0.5, r
    );
    const hot = t < 0.45;
    lg.addColorStop(0, hot ? ORD.flameHot : ORD.flameLow);
    lg.addColorStop(0.55, hot ? ORD.flameMid : ORD.smoke);
    lg.addColorStop(1, 'rgba(30,26,32,0)');
    ctx.globalAlpha = fade;
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * d, Math.sin(a) * d - grow * t * 0.5, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
