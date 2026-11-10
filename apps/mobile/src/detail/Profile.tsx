/**
 * Elevation and heart-rate profile drawn with Skia, over a grid with metres on the left, bpm on the right
 * and the distance (or time) underneath, as in the PWA. Dragging moves a cursor; in "section" mode, dragging
 * selects a range. Everything that follows the finger (cursor line, readout, selection band) runs on
 * the UI thread from shared values; only the map cursor and the section stats cross to JS.
 */
import { Canvas, DashPathEffect, Group, Line, Path, Rect, Skia, vec } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { type SharedValue, useAnimatedProps, useDerivedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { niceScale, shortNumber } from '../charts';
import { indexAtDistance, type Track } from './track';

const AnimatedText = Animated.createAnimatedComponent(TextInput);

type Props = {
  track: Track;
  width: number;
  height: number;
  cursor: SharedValue<number>; // sample index, -1 when hidden
  selection: SharedValue<[number, number] | null>;
  selecting: boolean;
  onCursor: (index: number) => void;
  onSelection: (range: [number, number] | null, final: boolean) => void;
  colors: {
    alt: string;
    altFill: string;
    hr: string;
    cursor: string;
    band: string;
    text: string;
    grid: string;
    muted: string;
  };
  /** Legend names for the two lines. */
  labels: { alt: string; hr: string };
};

const PAD = 4;
const AXIS = 34;
const STEPS = 4;

/** Round marks along the profile's axis that fit inside it: 0, 5, 10 km, or 0, 15, 30 min. */
export function axisMarks(total: number, byTime: boolean) {
  if (total <= 0) return [];
  const unit = byTime ? 60 : 1000;
  const step = niceScale([0, total / unit]).ticks[1] * unit;
  const marks: number[] = [];
  for (let v = 0; v <= total + 1e-6 && marks.length < 12; v += step) marks.push(v);
  return marks;
}

function markLabel(v: number, byTime: boolean) {
  if (!byTime) return `${shortNumber(v / 1000)} km`;
  const minutes = Math.round(v / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} h`
    : `${minutes} min`;
}

export function Profile({
  track,
  width,
  height,
  cursor,
  selection,
  selecting,
  onCursor,
  onSelection,
  colors,
  labels,
}: Props) {
  const hasAlt = track.alt.some((a) => a != null);
  const hasHr = track.hr.some((h) => h != null);
  const left = hasAlt ? AXIS : 8;
  const right = hasHr ? AXIS : 8;
  const plotW = Math.max(2, width - left - right);
  const plotH = height - 2 * PAD;
  const altScale = useMemo(() => niceScale([track.altMin, track.altMax]), [track]);
  const hrScale = useMemo(() => niceScale([track.hrMin, track.hrMax]), [track]);
  const { altPath, altFill, hrPath } = useMemo(() => {
    const [altLo, altHi] = altScale.domain;
    const [hrLo, hrHi] = hrScale.domain;
    const alt = Skia.PathBuilder.Make();
    const fill = Skia.PathBuilder.Make();
    const hr = Skia.PathBuilder.Make();
    const columns = Math.max(2, Math.round(plotW));
    let altStarted = false;
    let hrStarted = false;
    for (let x = 0; x < columns; x++) {
      const i = indexAtDistance(track.x, (x / (columns - 1)) * track.totalX);
      const a = track.alt[i];
      if (a != null) {
        const y = PAD + plotH * (1 - (a - altLo) / (altHi - altLo || 1));
        if (!altStarted) {
          alt.moveTo(x, y);
          fill.moveTo(x, PAD + plotH);
          fill.lineTo(x, y);
          altStarted = true;
        } else {
          alt.lineTo(x, y);
          fill.lineTo(x, y);
        }
      }
      const h = track.hr[i];
      if (h != null) {
        const y = PAD + plotH * (1 - (h - hrLo) / (hrHi - hrLo || 1));
        if (!hrStarted) {
          hr.moveTo(x, y);
          hrStarted = true;
        } else hr.lineTo(x, y);
      }
    }
    if (altStarted) {
      fill.lineTo(columns - 1, PAD + plotH);
      fill.close();
    }
    return { altPath: alt.build(), altFill: fill.build(), hrPath: hr.build() };
  }, [track, plotW, plotH, altScale, hrScale]);

  // Distance, or time when the activity has none: the axis the profile runs along.
  const dist = track.x;
  const total = track.totalX;
  const byTime = track.byTime;
  const indexAtX = (x: number) => {
    'worklet';
    return indexAtDistance(dist, (Math.min(Math.max(x - left, 0), plotW) / plotW) * total);
  };
  const xAtIndex = (i: number) => {
    'worklet';
    return total > 0 ? (dist[i] / total) * plotW : 0;
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
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

  const cursorX = useDerivedValue(() => (cursor.value < 0 ? -10 : xAtIndex(cursor.value)));
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

  const alt = track.alt;
  const hr = track.hr;
  const marks = axisMarks(total, byTime);
  const muted = { color: colors.muted, fontSize: 10, fontVariant: ['tabular-nums' as const] };
  const tickY = (i: number) => PAD + plotH - (i / STEPS) * plotH;
  const readout = useAnimatedProps(() => {
    const i = cursor.value;
    if (i < 0) return { text: ' ', defaultValue: ' ' };
    const at = byTime
      ? `${Math.floor(dist[i] / 60)}:${String(Math.floor(dist[i] % 60)).padStart(2, '0')}`
      : `${(dist[i] / 1000).toFixed(2)} km`;
    const a = alt[i];
    const h = hr[i];
    const text = `${at}   ${a == null ? '–' : Math.round(a)} m   ${h == null ? '–' : h} bpm`;
    return { text, defaultValue: text };
  });

  return (
    <View>
      <AnimatedText
        editable={false}
        underlineColorAndroid="transparent"
        style={[styles.readout, { color: colors.text }]}
        animatedProps={readout}
      />
      <GestureDetector gesture={pan}>
        <View collapsable={false} style={{ height: height + 16 }}>
          <Canvas style={{ width, height }}>
            {altScale.ticks.map((_, i) => (
              <Line
                key={i}
                p1={vec(left, Math.round(tickY(i)) - 0.5)}
                p2={vec(left + plotW, Math.round(tickY(i)) - 0.5)}
                color={colors.grid}
                strokeWidth={1}
              >
                {i > 0 && <DashPathEffect intervals={[3, 4]} />}
              </Line>
            ))}
            <Group transform={[{ translateX: left }]}>
              <Rect x={bandX} y={0} width={bandW} height={height} color={colors.band} />
              <Path path={altFill} color={colors.altFill} />
              <Path path={altPath} color={colors.alt} style="stroke" strokeWidth={1.5} />
              <Path path={hrPath} color={colors.hr} style="stroke" strokeWidth={1.2} />
              <Line p1={p1} p2={p2} color={colors.cursor} strokeWidth={1.5} />
            </Group>
          </Canvas>
          {hasAlt &&
            altScale.ticks.map((v, i) => (
              <Text
                key={`a${i}`}
                style={[
                  muted,
                  styles.tick,
                  { left: 0, width: left - 6, textAlign: 'right', top: tickY(i) - 7 },
                ]}
              >
                {shortNumber(v)}
              </Text>
            ))}
          {hasHr &&
            hrScale.ticks.map((v, i) => (
              <Text
                key={`h${i}`}
                style={[muted, styles.tick, { right: 0, width: right - 6, top: tickY(i) - 7 }]}
              >
                {shortNumber(v)}
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
                    left: Math.max(left - 14, Math.min(width - 56, x - 28)),
                  },
                ]}
              >
                {markLabel(v, byTime)}
              </Text>
            );
          })}
        </View>
      </GestureDetector>
      <View style={styles.legend}>
        {hasAlt && (
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: colors.alt }]} />
            <Text style={{ color: colors.muted, fontSize: 12 }}>{labels.alt} (m)</Text>
          </View>
        )}
        {hasHr && (
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: colors.hr }]} />
            <Text style={{ color: colors.muted, fontSize: 12 }}>{labels.hr} (bpm)</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tick: { position: 'absolute' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  readout: { fontSize: 13, fontVariant: ['tabular-nums'], paddingVertical: 4, paddingHorizontal: 0 },
});
