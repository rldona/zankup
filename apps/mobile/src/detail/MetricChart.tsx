/**
 * One series of an activity over its distance (or time), drawn with Skia as Garmin does: a filled
 * area, round values on the left, a grid and the distance underneath. Every chart of
 * the activity shares the cursor and the section, so dragging on one moves them all and the map.
 * What follows the finger (cursor line, value, section band) runs on the UI thread from shared values.
 */
import { Canvas, DashPathEffect, Group, Line, Path, Rect, Skia, vec } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { type SharedValue, useAnimatedProps, useDerivedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { niceScale, shortNumber } from '../charts';
import { indexAtDistance, type Track } from './track';

const AnimatedText = Animated.createAnimatedComponent(TextInput);

const PAD = 4;
const AXIS = 40;
const STEPS = 4;

/** Round marks along the axis that fit inside it: 0, 5, 10 km (or mi), or 0, 15, 30 min. */
export function axisMarks(total: number, unit: number) {
  if (total <= 0) return [];
  const step = niceScale([0, total / unit]).ticks[1] * unit;
  const marks: number[] = [];
  for (let v = 0; v <= total + 1e-6 && marks.length < 12; v += step) marks.push(v);
  return marks;
}

export type Readout = { kind: 'int' | 'dec1' | 'pace'; suffix: string; decimal: string };

/** The value under the finger, written on the UI thread as the finger moves (no Intl there). */
export function formatReadout(v: number | null | undefined, f: Readout): string {
  'worklet';
  if (v == null || !Number.isFinite(v)) return '–';
  if (f.kind === 'pace') {
    let m = Math.floor(v);
    let s = Math.round((v - m) * 60);
    if (s === 60) {
      m += 1;
      s = 0;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}${f.suffix}`;
  }
  if (f.kind === 'dec1') return `${(Math.round(v * 10) / 10).toFixed(1).replace('.', f.decimal)}${f.suffix}`;
  return `${Math.round(v)}${f.suffix}`;
}

export type ChartSeries = {
  label: string;
  color: string;
  /** One value per sample, in the unit the axis shows (null where there is none). */
  values: (number | null)[];
  /** How the value under the finger is written: whole, one decimal or m:ss, and what follows it. */
  readout: Readout;
  /** What the header shows while nothing is touched (the average, or the highest altitude). */
  average: string;
  /** Tick labels: numbers by default, m:ss for a pace. */
  tick?: (v: number) => string;
  /** Lower is better (a pace): the axis runs upside down, so faster is higher. */
  inverted?: boolean;
  /** Keep the axis on zero (power, cadence); otherwise it hugs the values (altitude, heart rate). */
  fromZero?: boolean;
};

type Props = {
  track: Track;
  series: ChartSeries;
  width: number;
  height: number;
  cursor: SharedValue<number>;
  selection: SharedValue<[number, number] | null>;
  selecting: boolean;
  onCursor: (index: number) => void;
  onSelection: (range: [number, number] | null, final: boolean) => void;
  colors: { cursor: string; band: string; grid: string; muted: string; fg: string };
  /** The distance unit in metres (1000 or 1609.344), for the marks underneath. */
  unit: number;
  unitLabel: string;
};

/** The range the axis covers: the 2nd to the 98th percentile, so a slow start or a GPS spike doesn't flatten the rest. */
function rangeOf(values: (number | null)[], fromZero: boolean): [number, number] {
  const sorted = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return [0, 1];
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  const lo = fromZero ? 0 : at(0.02);
  const hi = at(0.98);
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

export const MetricChart = memo(function MetricChart({
  track,
  series,
  width,
  height,
  cursor,
  selection,
  selecting,
  onCursor,
  onSelection,
  colors,
  unit,
  unitLabel,
}: Props) {
  const left = AXIS;
  const right = 8;
  const plotW = Math.max(2, width - left - right);
  const plotH = height - 2 * PAD;
  const scale = useMemo(
    () => niceScale(rangeOf(series.values, !!series.fromZero)),
    [series.values, series.fromZero],
  );
  const [lo, hi] = scale.domain;
  const yOf = (v: number) => {
    const share = (Math.min(Math.max(v, lo), hi) - lo) / (hi - lo || 1);
    return PAD + plotH * (series.inverted ? share : 1 - share);
  };
  // The area always fills down to the bottom edge, as Garmin draws a pace too.
  const base = PAD + plotH;

  const fill = useMemo(() => {
    const area = Skia.PathBuilder.Make();
    const columns = Math.max(2, Math.round(plotW));
    let started = false;
    let lastX = 0;
    for (let x = 0; x < columns; x++) {
      const i = indexAtDistance(track.x, (x / (columns - 1)) * track.totalX);
      const v = series.values[i];
      if (v == null) continue;
      const y = yOf(v);
      if (!started) {
        area.moveTo(x, base);
        area.lineTo(x, y);
        started = true;
      } else area.lineTo(x, y);
      lastX = x;
    }
    if (started) {
      area.lineTo(lastX, base);
      area.close();
    }
    return area.build();
    // yOf and base follow from the scale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, series.values, plotW, plotH, lo, hi, series.inverted]);

  const dist = track.x;
  const total = track.totalX;
  const indexAtX = (x: number) => {
    'worklet';
    return indexAtDistance(dist, (Math.min(Math.max(x - left, 0), plotW) / plotW) * total);
  };
  const xAtIndex = (i: number) => {
    'worklet';
    return total > 0 ? (dist[i] / total) * plotW : 0;
  };

  // Sideways drags move the cursor; a vertical swipe is left to the screen's scroll.
  const pan = Gesture.Pan()
    .activeOffsetX([-4, 4])
    .failOffsetY([-12, 12])
    .onStart((e) => {
      'worklet';
      const i = indexAtX(e.x);
      cursor.value = i;
      if (selecting) selection.value = [i, i];
      scheduleOnRN(onCursor, i);
    })
    .onUpdate((e) => {
      'worklet';
      const i = indexAtX(e.x);
      if (i === cursor.value) return;
      cursor.value = i;
      if (selecting && selection.value) {
        selection.value = [selection.value[0], i];
        scheduleOnRN(onSelection, selection.value, false);
      }
      scheduleOnRN(onCursor, i);
    })
    .onFinalize(() => {
      'worklet';
      if (selecting && selection.value) scheduleOnRN(onSelection, selection.value, true);
    });
  const tap = Gesture.Tap().onEnd((e) => {
    'worklet';
    const i = indexAtX(e.x);
    cursor.value = i;
    scheduleOnRN(onCursor, i);
  });
  const gesture = Gesture.Race(pan, tap);

  const cursorX = useDerivedValue(() => (cursor.value < 0 ? -1000 : xAtIndex(cursor.value)));
  const p1 = useDerivedValue(() => vec(cursorX.value, 0));
  const p2 = useDerivedValue(() => vec(cursorX.value, height));
  const bandX = useDerivedValue(() => {
    const s = selection.value;
    return s ? Math.min(xAtIndex(s[0]), xAtIndex(s[1])) : 0;
  });
  const bandW = useDerivedValue(() => {
    const s = selection.value;
    return s ? Math.abs(xAtIndex(s[1]) - xAtIndex(s[0])) : 0;
  });

  const values = series.values;
  const format = series.readout;
  const average = series.average;
  const readout = useAnimatedProps(() => {
    const i = cursor.value;
    const text = i < 0 ? average : formatReadout(values[i], format);
    return { text, defaultValue: text };
  });

  const marks = axisMarks(total, track.byTime ? 60 : unit);
  const muted = { color: colors.muted, fontSize: 10, fontVariant: ['tabular-nums' as const] };
  const tickY = (i: number) =>
    series.inverted ? PAD + (i / STEPS) * plotH : PAD + plotH - (i / STEPS) * plotH;
  const tick = series.tick ?? shortNumber;
  const markLabel = (v: number) => {
    if (!track.byTime) return `${shortNumber(v / unit)} ${unitLabel}`;
    const minutes = Math.round(v / 60);
    return minutes >= 60
      ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} h`
      : `${minutes} min`;
  };

  return (
    <View>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: series.color }]} />
        <Text style={{ color: colors.fg, fontSize: 13, fontWeight: '600', flex: 1 }}>{series.label}</Text>
        <AnimatedText
          editable={false}
          underlineColorAndroid="transparent"
          style={[styles.readout, { color: colors.fg }]}
          animatedProps={readout}
        />
      </View>
      <GestureDetector gesture={gesture}>
        <View collapsable={false} style={{ height: height + 16 }}>
          <Canvas style={{ width, height }}>
            {scale.ticks.map((_, i) => (
              <Line
                key={i}
                p1={vec(left, Math.round(tickY(i)) - 0.5)}
                p2={vec(left + plotW, Math.round(tickY(i)) - 0.5)}
                color={colors.grid}
                strokeWidth={1}
              >
                {(series.inverted ? i < STEPS : i > 0) && <DashPathEffect intervals={[3, 4]} />}
              </Line>
            ))}
            <Group transform={[{ translateX: left }]}>
              <Rect x={bandX} y={0} width={bandW} height={height} color={colors.band} />
              <Path path={fill} color={series.color} opacity={0.75} />
              <Line p1={p1} p2={p2} color={colors.cursor} strokeWidth={1.5} />
            </Group>
          </Canvas>
          {scale.ticks.map((v, i) => (
            <Text
              key={`y${i}`}
              style={[
                muted,
                styles.tick,
                { left: 0, width: left - 6, textAlign: 'right', top: tickY(i) - 7 },
              ]}
            >
              {tick(v)}
            </Text>
          ))}
          {marks.map((v, i) => {
            const x = left + (v / total) * plotW;
            return (
              <Text
                key={`x${i}`}
                numberOfLines={1}
                style={[
                  muted,
                  styles.tick,
                  {
                    top: height + 2,
                    width: 56,
                    textAlign: 'center',
                    left: Math.max(left - 16, Math.min(width - 56, x - 28)),
                  },
                ]}
              >
                {markLabel(v)}
              </Text>
            );
          })}
        </View>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  readout: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'], padding: 0, textAlign: 'right' },
  tick: { position: 'absolute' },
});
