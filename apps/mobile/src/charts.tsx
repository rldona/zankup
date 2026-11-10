/**
 * Trend charts drawn with Skia (OS-512), as complete as the PWA's: lines and bars (stacked, or around
 * zero when values go negative) over a grid with round values on the left axis, a right axis when a
 * second scale is drawn, a few days along the bottom and a legend. Touching or sliding sideways picks a
 * day and shows its values; a vertical swipe still scrolls the screen.
 */
import { Canvas, DashPathEffect, Group, Line, Path, Rect, vec } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { useTheme } from './theme';

type Value = number | null | undefined;

export type Layer =
  | {
      kind: 'line';
      label: string;
      color: string;
      values: Value[];
      domain?: [number, number];
      /** Line width (2 by default) and opacity, to set one line apart from the rest. */
      width?: number;
      opacity?: number;
      /** Left out of the legend (many lines of the same kind). */
      hideLegend?: boolean;
    }
  | {
      kind: 'bars';
      /** Several series are stacked; values below zero hang from a zero line. */
      series: { label: string; color: string; values: Value[] }[];
      domain?: [number, number];
    };

/** The range a layer is drawn on: its own unless given, and always including zero for bars. */
export function domainOf(layer: Layer): [number, number] {
  if (layer.domain) return layer.domain;
  if (layer.kind === 'line') {
    const values = layer.values.filter((v): v is number => v != null);
    if (!values.length) return [0, 1];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo) * 0.1 || 1;
    return [lo - pad, hi + pad];
  }
  const length = Math.max(0, ...layer.series.map((s) => s.values.length));
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < length; i++) {
    const total = layer.series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
    lo = Math.min(lo, total);
    hi = Math.max(hi, total);
  }
  return hi === lo ? [lo, lo + 1] : [lo, hi];
}

/** The polyline of a series, broken where a day has no value. */
export function linePath(values: Value[], width: number, height: number, [lo, hi]: [number, number]) {
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const y = (v: number) => height - ((v - lo) / (hi - lo || 1)) * height;
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push([i * step, y(v)]);
  });
  if (current.length) segments.push(current);
  return segments;
}

const INTERVALS = 4;

/** A round step (1, 2, 2.5 or 5 times a power of ten) and the domain it covers in four intervals. */
export function niceScale([lo, hi]: [number, number], intervals = INTERVALS) {
  const span = hi - lo || Math.abs(hi) || 1;
  let magnitude = 10 ** Math.floor(Math.log10(span / intervals));
  for (let tries = 0; tries < 40; tries++) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * magnitude;
      const start = Math.floor(lo / step + 1e-9) * step;
      if (start + intervals * step >= hi - 1e-9) {
        const ticks = Array.from({ length: intervals + 1 }, (_, i) => round(start + i * step));
        return { domain: [ticks[0], ticks[intervals]] as [number, number], ticks };
      }
    }
    magnitude *= 10;
  }
  return { domain: [lo, hi] as [number, number], ticks: [lo, hi] };
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** A tick or a value, short: 1,5 · 120 · 12k. */
export function shortNumber(v: number) {
  const a = Math.abs(v);
  if (a >= 10000) return `${round(v / 1000)}k`;
  if (a >= 100 || Number.isInteger(v)) return String(Math.round(v));
  return String(Math.round(v * 10) / 10).replace('.', ',');
}

/** The days written under the chart: about five, spread evenly, always the first and the last. */
export function dayTicks(count: number, wanted = 5) {
  if (count <= 0) return [];
  if (count <= wanted) return Array.from({ length: count }, (_, i) => i);
  const every = (count - 1) / (wanted - 1);
  return Array.from({ length: wanted }, (_, i) => Math.round(i * every));
}

/**
 * Whether a Skia canvas of this width can be drawn on. On Android a canvas that draws before its
 * surface exists stays blank and does not redraw on its own, which happens when a chart mounts with its
 * data already there (a period changed, a card unfolded). The drawing waits two frames: the canvas gets
 * its surface in the first, the drawing lands in the second. Hide the chart until then, so its labels
 * do not show ahead of it.
 */
export function useCanvasReady(width: number): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!width) return;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setReady(true));
    });
    return () => cancelAnimationFrame(id);
  }, [width]);
  return ready;
}

const AXIS = 34;
const TOP = 8;

export function Chart({
  layers,
  days,
  height = 160,
  label,
}: {
  layers: Layer[];
  /** One label per value: a few of them are written under the chart. */
  days: string[];
  height?: number;
  /** What the chart says, for TalkBack. */
  label: string;
}) {
  const c = useTheme();
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const ready = useCanvasReady(width);
  const count = days.length;

  // Layers given the same domain share a scale. The first scale is the left axis, the second the right.
  const scales = useMemo(() => {
    const keys: string[] = [];
    const of = layers.map((layer, index) => {
      const key = layer.domain ? layer.domain.join(':') : `own:${index}`;
      if (!keys.includes(key)) keys.push(key);
      return keys.indexOf(key);
    });
    const nice = keys.map((key) => niceScale(domainOf(layers[of.indexOf(keys.indexOf(key))])));
    return { of, nice };
  }, [layers]);
  const right = scales.nice.length > 1;
  const left = AXIS;
  const plot = Math.max(0, width - left - (right ? AXIS : 8));
  const inner = height - TOP;
  const slot = count ? plot / count : 0;
  const bar = Math.max(1, Math.min(14, slot * 0.7));
  const yOf = (scale: number) => {
    const [lo, hi] = scales.nice[scale].domain;
    return (v: number) => TOP + inner - ((v - lo) / (hi - lo || 1)) * inner;
  };

  const drawn = layers.map((layer, index) => {
    const scale = scales.of[index];
    const domain = scales.nice[scale].domain;
    const y = yOf(scale);
    if (layer.kind === 'line') {
      // Lines run from the centre of the first slot to the centre of the last, over the bars.
      const path = linePath(layer.values, plot - slot, inner, domain)
        .map((segment) =>
          segment.length === 1
            ? segment.map(([x, py]) => `M${x + slot / 2 - 1} ${py + TOP}h2`).join('')
            : segment.map(([x, py], n) => `${n ? 'L' : 'M'}${x + slot / 2} ${py + TOP}`).join(''),
        )
        .join('');
      return path ? (
        <Path
          key={index}
          path={path}
          style="stroke"
          strokeWidth={layer.width ?? 3}
          strokeCap="round"
          strokeJoin="round"
          color={layer.color}
          opacity={layer.opacity ?? 1}
        />
      ) : null;
    }
    const rects: { x: number; y: number; h: number; color: string }[] = [];
    for (let i = 0; i < count; i++) {
      let base = 0;
      for (const s of layer.series) {
        const v = s.values[i];
        if (v == null || v === 0) continue;
        const top = y(base + v);
        const bottom = y(base);
        rects.push({
          x: i * slot + (slot - bar) / 2,
          y: Math.min(top, bottom),
          h: Math.abs(bottom - top),
          color: s.color,
        });
        base += v;
      }
    }
    return (
      <Group key={index} opacity={picked == null ? 1 : 0.9}>
        {rects.map((r, n) => (
          <Rect key={n} x={r.x} y={r.y} width={bar} height={Math.max(1, r.h)} color={r.color} />
        ))}
      </Group>
    );
  });

  const pick = (x: number) => {
    if (!slot) return;
    setPicked(Math.max(0, Math.min(count - 1, Math.floor((x - left) / slot))));
  };
  const gesture = Gesture.Race(
    Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-6, 6])
      .failOffsetY([-12, 12])
      .onStart((e) => pick(e.x))
      .onUpdate((e) => pick(e.x)),
    Gesture.Tap()
      .runOnJS(true)
      .onEnd((e) => {
        const i = slot ? Math.floor((e.x - left) / slot) : -1;
        setPicked((current) => (current === i || i < 0 || i >= count ? null : i));
      }),
  );

  const legend = layers.flatMap((layer) =>
    layer.kind === 'line'
      ? layer.hideLegend
        ? []
        : [{ label: layer.label, color: layer.color }]
      : layer.series,
  );
  const readout =
    picked == null
      ? []
      : layers
          .flatMap((layer) =>
            layer.kind === 'line'
              ? [{ label: layer.label, color: layer.color, value: layer.values[picked] }]
              : layer.series.map((s) => ({ label: s.label, color: s.color, value: s.values[picked] })),
          )
          .filter((item) => item.value != null)
          .slice(0, 8);
  const zeroLines = scales.nice.map((s) => s.domain[0] < 0 && s.domain[1] > 0);
  const leftTicks = scales.nice[0]?.ticks ?? [];
  const rightTicks = right ? scales.nice[1].ticks : [];
  const ticks = dayTicks(count);
  const pickedX = picked == null ? 0 : left + picked * slot + slot / 2;
  const muted = { color: c.muted, fontSize: 10, fontVariant: ['tabular-nums' as const] };

  return (
    <View accessible accessibilityLabel={label} style={{ gap: 6, opacity: ready ? 1 : 0 }}>
      <GestureDetector gesture={gesture}>
        <View
          collapsable={false}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          style={{ height: height + 16 }}
        >
          {width > 0 && (
            <>
              <Canvas style={{ width, height }}>
                {ready && (
                  <>
                    {leftTicks.map((_, i) => {
                      const py = Math.round(TOP + inner - (i / INTERVALS) * inner) - 0.5;
                      return (
                        <Line
                          key={i}
                          p1={vec(left, py)}
                          p2={vec(left + plot, py)}
                          color={c.line}
                          strokeWidth={1}
                        >
                          {i > 0 && <DashPathEffect intervals={[3, 4]} />}
                        </Line>
                      );
                    })}
                    {zeroLines.map((on, scale) =>
                      on ? (
                        <Line
                          key={`zero${scale}`}
                          p1={vec(left, yOf(scale)(0))}
                          p2={vec(left + plot, yOf(scale)(0))}
                          color={c.muted}
                          strokeWidth={1}
                        />
                      ) : null,
                    )}
                    <Group transform={[{ translateX: left }]}>{drawn}</Group>
                    {picked != null && (
                      <Line p1={vec(pickedX, TOP)} p2={vec(pickedX, height)} color={c.fg} strokeWidth={1} />
                    )}
                  </>
                )}
              </Canvas>
              {leftTicks.map((v, i) => (
                <Text
                  key={`l${i}`}
                  style={[
                    muted,
                    {
                      position: 'absolute',
                      left: 0,
                      width: left - 6,
                      textAlign: 'right',
                      top: TOP + inner - (i / INTERVALS) * inner - 7,
                    },
                  ]}
                >
                  {shortNumber(v)}
                </Text>
              ))}
              {rightTicks.map((v, i) => (
                <Text
                  key={`r${i}`}
                  style={[
                    muted,
                    {
                      position: 'absolute',
                      right: 0,
                      width: AXIS - 6,
                      textAlign: 'left',
                      top: TOP + inner - (i / INTERVALS) * inner - 7,
                    },
                  ]}
                >
                  {shortNumber(v)}
                </Text>
              ))}
              {ticks.map((i) => {
                const x = left + i * slot + slot / 2;
                return (
                  <Text
                    key={`d${i}`}
                    numberOfLines={1}
                    style={[
                      muted,
                      {
                        position: 'absolute',
                        top: height + 2,
                        width: 60,
                        textAlign: 'center',
                        left: Math.max(left - 12, Math.min(width - 60, x - 30)),
                      },
                    ]}
                  >
                    {days[i]}
                  </Text>
                );
              })}
              {picked != null && (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: 0,
                    ...(pickedX < width / 2 ? { left: pickedX + 8 } : { right: width - pickedX + 8 }),
                    backgroundColor: c.surface2,
                    borderColor: c.line,
                    borderWidth: 1,
                    borderRadius: 8,
                    paddingHorizontal: 8,
                    paddingVertical: 6,
                    gap: 2,
                    maxWidth: width * 0.6,
                  }}
                >
                  <Text style={{ color: c.fg, fontSize: 12, fontWeight: '700' }}>{days[picked]}</Text>
                  {readout.map((item) => (
                    <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: item.color }} />
                      <Text style={{ color: c.muted, fontSize: 12, flexShrink: 1 }} numberOfLines={1}>
                        {item.label}
                      </Text>
                      <Text
                        style={{
                          color: c.fg,
                          fontSize: 12,
                          fontWeight: '600',
                          fontVariant: ['tabular-nums'],
                        }}
                      >
                        {shortNumber(item.value as number)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </GestureDetector>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {legend.map((item) => (
          <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.color }} />
            <Text style={{ color: c.muted, fontSize: 12 }}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
