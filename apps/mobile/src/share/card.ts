/**
 * The share image on the phone (OS-919), the same card as the PWA's (OS-408): 1080 × 1350, drawn with
 * Skia off screen from the layout in packages/core, saved as a PNG in the cache and handed to the
 * system's share sheet. Nothing leaves the phone until the person picks where to send it.
 */
import { matchFont, Skia, StrokeCap, StrokeJoin, PaintStyle, type SkFont } from '@shopify/react-native-skia';
import { CARD_AREA, CARD_HEIGHT, CARD_WIDTH, projectRoute, type CardFigure } from '@zankup/core';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export type CardColours = { bg: string; fg: string; muted: string; accent: string };

export type CardContent = {
  title: string;
  subtitle: string;
  figures: CardFigure[];
  /** Stretches of [lat, lon]; empty or null for no map. */
  route?: [number, number][][] | null;
};

const font = (size: number, weight: '500' | '700') =>
  matchFont({ fontFamily: 'sans-serif', fontSize: size, fontWeight: weight });

/** Up to `max` lines of `text` within `width`, the last one with an ellipsis when it does not fit. */
function lines(text: string, f: SkFont, width: number, max: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (f.measureText(next).width > width && current) {
      out.push(current);
      current = word;
      if (out.length === max) {
        out[max - 1] = `${out[max - 1]}…`;
        return out;
      }
    } else current = next;
  }
  if (current) out.push(current);
  return out;
}

/** Draws the card and returns it as PNG bytes. */
export function drawCard(content: CardContent, c: CardColours): Uint8Array {
  const surface = Skia.Surface.Make(CARD_WIDTH, CARD_HEIGHT);
  if (!surface) throw new Error('No surface');
  const canvas = surface.getCanvas();
  const paint = (colour: string) => {
    const p = Skia.Paint();
    p.setColor(Skia.Color(colour));
    p.setAntiAlias(true);
    return p;
  };
  canvas.drawColor(Skia.Color(c.bg));

  const title = font(64, '700');
  lines(content.title, title, CARD_WIDTH - 160, 2).forEach((line, i) =>
    canvas.drawText(line, 80, 150 + i * 72, paint(c.fg), title),
  );
  canvas.drawText(content.subtitle, 80, 300, paint(c.muted), font(36, '500'));

  if (content.route && content.route.some((s) => s.length > 1)) {
    const at = projectRoute(content.route, CARD_AREA);
    const stroke = paint(c.accent);
    stroke.setStyle(PaintStyle.Stroke);
    stroke.setStrokeWidth(10);
    stroke.setStrokeJoin(StrokeJoin.Round);
    stroke.setStrokeCap(StrokeCap.Round);
    for (const stretch of content.route) {
      const d = stretch
        .map((p, i) => {
          const [x, y] = at(p);
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join('');
      const path = Skia.Path.MakeFromSVGString(d);
      if (path) canvas.drawPath(path, stroke);
    }
  }

  const figures = content.figures.slice(0, 6);
  const columns = figures.length > 4 ? 3 : 2;
  const cell = (CARD_WIDTH - 160) / columns;
  const value = font(60, '700');
  const label = font(30, '500');
  figures.forEach((f, i) => {
    const x = 80 + (i % columns) * cell;
    const y = 1010 + Math.floor(i / columns) * 150;
    canvas.drawText(f.value, x, y, paint(c.fg), value);
    canvas.drawText(f.label.toUpperCase(), x, y + 46, paint(c.muted), label);
  });
  canvas.drawText('ZANKUP', 80, CARD_HEIGHT - 60, paint(c.muted), font(30, '700'));

  surface.flush();
  const bytes = surface.makeImageSnapshot().encodeToBytes();
  if (!bytes.length) throw new Error('No image');
  return bytes;
}

/** Saves the card in the cache and opens the share sheet with it. */
export async function shareCard(bytes: Uint8Array, name: string, title: string): Promise<void> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle: title });
}
