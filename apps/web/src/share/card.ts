/**
 * Share images (OS-408, OS-413): a 1080 × 1350 PNG drawn on a canvas, with the route as the API gives it
 * for sharing (privacy zones already removed, OS-407) and a few figures. Nothing leaves the device until
 * the person shares the file.
 */
import { commonTokens, themes, type ThemeName } from '@zankup/core';

export type CardFigure = { label: string; value: string };

export type CardContent = {
  title: string;
  subtitle: string;
  figures: CardFigure[];
  /** Stretches of [lat, lon]; empty or null for no map. */
  route?: [number, number][][] | null;
  /** Bars (e.g. distance per day of a month), drawn when there is no route. */
  bars?: number[];
  sport?: string;
};

const WIDTH = 1080;
const HEIGHT = 1350;

function project(stretches: [number, number][][], box: { x: number; y: number; w: number; h: number }) {
  const points = stretches.flat();
  const lat0 = points.reduce((s, p) => s + p[0], 0) / points.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = points.map((p) => p[1] * k);
  const ys = points.map((p) => p[0]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min(box.w / (maxX - minX || 1e-9), box.h / (maxY - minY || 1e-9));
  const offX = box.x + (box.w - (maxX - minX) * scale) / 2;
  const offY = box.y + (box.h - (maxY - minY) * scale) / 2;
  return (p: [number, number]) => [offX + (p[1] * k - minX) * scale, offY + (maxY - p[0]) * scale] as const;
}

export async function drawCard(content: CardContent, theme: ThemeName): Promise<Blob> {
  const c = { ...commonTokens, ...themes[theme] } as Record<string, string>;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('No canvas');
  const font = (size: number, weight = 600) => `${weight} ${size}px system-ui, -apple-system, sans-serif`;
  g.fillStyle = c.bg ?? '#111';
  g.fillRect(0, 0, WIDTH, HEIGHT);

  g.fillStyle = c.fg ?? '#fff';
  g.font = font(64, 700);
  wrap(g, content.title, 80, 150, WIDTH - 160, 72, 2);
  g.fillStyle = c.muted ?? '#999';
  g.font = font(36, 500);
  g.fillText(content.subtitle, 80, 300);

  const area = { x: 80, y: 360, w: WIDTH - 160, h: 560 };
  const accent = (content.sport && c[content.sport]) || c.accent || '#f60';
  if (content.route && content.route.some((s) => s.length > 1)) {
    const at = project(content.route, area);
    g.strokeStyle = accent;
    g.lineWidth = 10;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (const stretch of content.route) {
      g.beginPath();
      stretch.forEach((p, i) => {
        const [x, y] = at(p);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
    }
  } else if (content.bars && content.bars.length) {
    const max = Math.max(...content.bars, 1);
    const w = area.w / content.bars.length;
    g.fillStyle = accent;
    content.bars.forEach((v, i) => {
      const h = (v / max) * area.h;
      g.fillRect(area.x + i * w + w * 0.15, area.y + area.h - h, w * 0.7, h);
    });
  }

  const figures = content.figures.slice(0, 6);
  const columns = figures.length > 4 ? 3 : 2;
  const cell = (WIDTH - 160) / columns;
  figures.forEach((f, i) => {
    const x = 80 + (i % columns) * cell;
    const y = 1010 + Math.floor(i / columns) * 150;
    g.fillStyle = c.fg ?? '#fff';
    g.font = font(60, 700);
    g.fillText(f.value, x, y);
    g.fillStyle = c.muted ?? '#999';
    g.font = font(30, 500);
    g.fillText(f.label.toUpperCase(), x, y + 46);
  });

  g.fillStyle = c.muted ?? '#999';
  g.font = font(30, 700);
  g.fillText('ZANKUP', 80, HEIGHT - 60);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No image'))), 'image/png'),
  );
}

function wrap(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  line: number,
  max: number,
) {
  const words = text.split(/\s+/);
  let current = '';
  let row = 0;
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (g.measureText(next).width > width && current) {
      g.fillText(row === max - 1 ? `${current}…` : current, x, y + row * line);
      if (++row >= max) return;
      current = word;
    } else current = next;
  }
  if (current) g.fillText(current, x, y + row * line);
}

/** Share the image with the system sheet when the browser can, or download it. */
export async function shareImage(blob: Blob, name: string, title: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return 'shared';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
