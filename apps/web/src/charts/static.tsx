/**
 * Static pieces in plain SVG or CSS (OS-215): no library, drawn with the theme's CSS variables, so they
 * cost nothing to load and change with the theme on their own. Charts with data use ECharts.
 */
import { formatDuration, routeThumbnail } from '@zankup/core';

/** Time in each HR zone as one stacked bar. */
export function ZoneBar({ seconds, label }: { seconds: number[]; label: string }) {
  const total = seconds.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="zbar" role="img" aria-label={label}>
      {seconds.map((s, i) => (
        <i
          key={i}
          style={{ width: `${(s / total) * 100}%`, background: `var(--zone-${i + 1})` }}
          title={`Z${i + 1} · ${formatDuration(s)}`}
        />
      ))}
    </div>
  );
}

/** The route of an activity, as on the feed's cards. */
export function RouteShape({
  route,
  label,
  colour = 'var(--accent)',
}: {
  route: string | null;
  label: string;
  colour?: string;
}) {
  const points = routeThumbnail(route);
  if (!points) return null;
  return (
    <svg
      className="thumb"
      viewBox="0 0 88 64"
      role="img"
      aria-label={label}
      style={{ ['--sport' as string]: colour }}
    >
      <polyline points={points} />
    </svg>
  );
}
