import { useEffect, useRef } from 'react';

/**
 * Gentle animated waves for the brand panel (Canvas 2D, no library), drawn in the panel's text colour.
 * Still when the system asks for reduced motion; paused while the tab is hidden.
 */
export function Waves() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let width = 0;
    let height = 0;
    let frame = 0;

    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = getComputedStyle(canvas).color;
      const lines = Math.ceil(height / 30) + 2;
      for (let k = 0; k < lines; k++) {
        const base = 20 + k * 30;
        const amp = 16 + (k % 5) * 5;
        const phase = k * 0.7;
        ctx.beginPath();
        for (let x = -20; x <= width + 20; x += 12) {
          // Two overlapping waves drifting slowly, each line at its own pace.
          const y =
            base +
            Math.sin(x / 110 + phase + t * 0.00018 * (1 + (k % 3) * 0.25)) * amp +
            Math.sin(x / 47 + k - t * 0.00031) * amp * 0.35;
          if (x === -20) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.globalAlpha = k % 4 === 0 ? 0.32 : 0.18;
        ctx.lineWidth = k % 4 === 0 ? 1.6 : 1;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const size = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduce) draw(0);
    };
    size();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(size);
    observer?.observe(canvas);
    if (!reduce) {
      const loop = (t: number) => {
        if (!document.hidden) draw(t);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="waves" aria-hidden="true" />;
}
