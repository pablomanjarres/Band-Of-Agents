import { useEffect, useRef } from 'react';

// Atmosphere for the live board: a lightweight constellation field keyed to the
// semantic agent palette (indigo = AI and dominant, emerald = human, amber =
// adapt), layered over a slow CSS mesh-gradient. Purely decorative — it reads as
// mood, never data — and it stands down entirely under prefers-reduced-motion
// (a single static frame, no rAF loop) and while the tab is hidden.

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: [number, number, number];
}

// Indigo is weighted so the field reads "mostly AI", flecked with human/adapt.
const PALETTE: [number, number, number][] = [
  [129, 140, 248], // indigo-400  (AI)
  [129, 140, 248],
  [129, 140, 248],
  [99, 102, 241], // indigo-500
  [52, 211, 153], // emerald-400 (human)
  [251, 191, 36], // amber-400   (adapt)
];

export function BoardHero() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

    let width = 0;
    let height = 0;
    let dots: Dot[] = [];
    let raf = 0;

    const seed = () => {
      const count = Math.round(Math.min(56, Math.max(16, (width * height) / 15000)));
      dots = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() * 2 - 1) * 0.16,
        vy: (Math.random() * 2 - 1) * 0.16,
        r: 0.8 + Math.random() * 1.6,
        color: PALETTE[(Math.random() * PALETTE.length) | 0],
      }));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const LINK = 118; // px: draw a hairline between dots closer than this

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Constellation links between nearby dots — quiet indigo wiring.
      for (let i = 0; i < dots.length; i++) {
        const a = dots[i];
        for (let j = i + 1; j < dots.length; j++) {
          const b = dots[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist < LINK) {
            ctx.strokeStyle = `rgba(129, 140, 248, ${(1 - dist / LINK) * 0.13})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Additive glow dots so overlaps bloom like signal nodes.
      ctx.globalCompositeOperation = 'lighter';
      for (const d of dots) {
        const rad = d.r * 6;
        const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, rad);
        const [r, gr, bl] = d.color;
        g.addColorStop(0, `rgba(${r}, ${gr}, ${bl}, 0.45)`);
        g.addColorStop(1, `rgba(${r}, ${gr}, ${bl}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(d.x, d.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    };

    const tick = () => {
      for (const d of dots) {
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < -24) d.x = width + 24;
        else if (d.x > width + 24) d.x = -24;
        if (d.y < -24) d.y = height + 24;
        else if (d.y > height + 24) d.y = -24;
      }
      draw();
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (raf || reduce.matches) return;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    resize();

    // Track container size (with a window-resize fallback where RO is absent).
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        resize();
        if (reduce.matches) draw();
      });
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }

    if (reduce.matches) draw();
    else start();

    // Be a good citizen: don't burn frames on a backgrounded tab.
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="board-mesh" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full opacity-70" />
    </div>
  );
}
