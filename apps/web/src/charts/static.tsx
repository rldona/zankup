/**
 * Static charts in plain SVG (OS-215): no library, drawn with the theme's CSS variables, so they
 * cost nothing to load and change with the theme on their own.
 */
import { formatDuration, routeThumbnail } from '@zankup/core';

/** A small trend line. */
export function Sparkline({
  values,
  label,
  colour = 'var(--accent)',
}: {
  values: number[];
  label: string;
  colour?: string;
}) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = values
    .map(
      (v, i) =>
        `${((i / Math.max(1, values.length - 1)) * 100).toFixed(1)},${(28 - ((v - min) / (max - min || 1)) * 24).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline points={points} style={{ stroke: colour }} />
    </svg>
  );
}

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
