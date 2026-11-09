/**
 * Small trend charts drawn with Skia (OS-512): lines and bars (stacked, or around zero when values go
 * negative), each layer on its own scale, with the first and last day under them and a legend. Enough
 * for the Health screen without a chart library on the phone.
 */
import { Canvas, Group, Line, Path, Rect, vec } from '@shopify/react-native-skia';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useTheme } from './theme';

type Value = number | null | undefined;

export type Layer =
  | { kind: 'line'; label: string; color: string; values: Value[]; domain?: [number, number] }
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

export function Chart({
  layers,
  days,
  height = 160,
  label,
}: {
  layers: Layer[];
  /** One label per value: the first and last are written under the chart. */
  days: string[];
  height?: number;
  /** What the chart says, for TalkBack. */
  label: string;
}) {
  const c = useTheme();
  const [width, setWidth] = useState(0);
  const count = days.length;
  const slot = count ? width / count : 0;
  const bar = Math.max(1, Math.min(14, slot * 0.7));

  const drawn = layers.map((layer, index) => {
    const domain = domainOf(layer);
    const [lo, hi] = domain;
    const y = (v: number) => height - ((v - lo) / (hi - lo || 1)) * height;
    if (layer.kind === 'line') {
      // Lines run from the centre of the first slot to the centre of the last, over the bars.
      const path = linePath(layer.values, width - slot, height, domain)
        .map((segment) =>
          segment.length === 1
            ? segment.map(([x, py]) => `M${x + slot / 2 - 1} ${py}h2`).join('')
            : segment.map(([x, py], n) => `${n ? 'L' : 'M'}${x + slot / 2} ${py}`).join(''),
        )
        .join('');
      return path ? (
        <Path key={index} path={path} style="stroke" strokeWidth={2} strokeCap="round" color={layer.color} />
      ) : null;
    }
    const zero = y(0);
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
      <Group key={index}>
        {rects.map((r, n) => (
          <Rect key={n} x={r.x} y={r.y} width={bar} height={Math.max(1, r.h)} color={r.color} />
        ))}
        {lo < 0 && <Line p1={vec(0, zero)} p2={vec(width, zero)} color={c.line} strokeWidth={1} />}
      </Group>
    );
  });

  const legend = layers.flatMap((layer) =>
    layer.kind === 'line' ? [{ label: layer.label, color: layer.color }] : layer.series,
  );
  return (
    <View accessible accessibilityLabel={label} style={{ gap: 6 }}>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
        {width > 0 && (
          <Canvas style={{ width, height }}>
            <Line p1={vec(0, height - 0.5)} p2={vec(width, height - 0.5)} color={c.line} strokeWidth={1} />
            {drawn}
          </Canvas>
        )}
      </View>
      {count > 0 && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: c.muted, fontSize: 11 }}>{days[0]}</Text>
          <Text style={{ color: c.muted, fontSize: 11 }}>{days[count - 1]}</Text>
        </View>
      )}
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
