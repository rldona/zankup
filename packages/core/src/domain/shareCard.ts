/**
 * The share image (OS-408, OS-413, OS-919), laid out once for the web (canvas) and the app (Skia): a
 * 1080 × 1350 card with the title, the date, the route as the API gives it for sharing (privacy zones
 * already removed, OS-407) and up to six figures. Only the drawing differs per client.
 */
import type { formatters } from '../format';
import { formatDuration } from '../format';
import type { MessageKey } from '../i18n';

type Format = ReturnType<typeof formatters>;
type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
/** Where the route (or the bars) goes on the card. */
export const CARD_AREA = { x: 80, y: 360, w: CARD_WIDTH - 160, h: 560 };

export type CardFigure = { label: string; value: string };

/** A function that puts a [lat, lon] in `box`, keeping the route's shape, centred. */
export function projectRoute(
  stretches: [number, number][][],
  box: { x: number; y: number; w: number; h: number },
): (p: [number, number]) => readonly [number, number] {
  const points = stretches.flat();
  const lat0 = points.reduce((s, p) => s + p[0], 0) / points.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = points.map((p) => p[1] * k);
  const ys = points.map((p) => p[0]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min(box.w / (maxX - minX || 1e-9), box.h / (maxY - minY || 1e-9));
  const offX = box.x + (box.w - (maxX - minX) * scale) / 2;
  const offY = box.y + (box.h - (maxY - minY) * scale) / 2;
  return (p) => [offX + (p[1] * k - minX) * scale, offY + (maxY - p[0]) * scale] as const;
}

/** The card's figures from the shared activity: distance, time, pace (or speed) and ascent. */
export function shareCardFigures(
  shared: {
    distance_m?: number | null;
    moving_s?: number | null;
    duration_s: number;
    ascent_m?: number | null;
  },
  pace: boolean,
  format: Format,
  t: Translate,
): CardFigure[] {
  const moving = shared.moving_s ?? shared.duration_s;
  return [
    shared.distance_m ? { label: t('feed.stat.distance'), value: format.distance(shared.distance_m) } : null,
    { label: t('feed.stat.time'), value: formatDuration(moving) },
    shared.distance_m && moving
      ? {
          label: t(pace ? 'feed.stat.pace' : 'feed.stat.speed'),
          value: format.speedFor(shared.distance_m / moving, pace),
        }
      : null,
    shared.ascent_m ? { label: t('feed.stat.ascent'), value: format.elevation(shared.ascent_m) } : null,
  ].filter((f): f is CardFigure => f !== null);
}
