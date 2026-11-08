/**
 * Elevation and heart-rate profile drawn with Skia. Dragging moves a cursor; in "section" mode, dragging
 * selects a range. Everything that follows the finger (cursor line, readout, selection band) runs on
 * the UI thread from shared values; only the map cursor and the section stats cross to JS.
 */
import { Canvas, Group, Line, Path, Rect, Skia, vec } from '@shopify/react-native-skia';
import { type ComponentRef, useMemo, useRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { type SharedValue, useAnimatedProps, useDerivedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { logPerf } from './perf';
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
  colors: { alt: string; altFill: string; hr: string; cursor: string; band: string; text: string };
};

const PAD = 4;

export function Profile({ track, width, height, cursor, selection, selecting, onCursor, onSelection, colors }: Props) {
  const plotH = height - 2 * PAD;
  const { altPath, altFill, hrPath } = useMemo(() => {
    const alt = Skia.PathBuilder.Make();
    const fill = Skia.PathBuilder.Make();
    const hr = Skia.PathBuilder.Make();
    const columns = Math.max(2, Math.round(width));
    let altStarted = false;
    let hrStarted = false;
    for (let x = 0; x < columns; x++) {
      const i = indexAtDistance(track.dist, (x / (columns - 1)) * track.totalDist);
      const a = track.alt[i];
      if (a != null) {
        const y = PAD + plotH * (1 - (a - track.altMin) / (track.altMax - track.altMin));
        if (!altStarted) {
          alt.moveTo(x, y);
          fill.moveTo(x, height);
          fill.lineTo(x, y);
          altStarted = true;
        } else {
          alt.lineTo(x, y);
          fill.lineTo(x, y);
        }
      }
      const h = track.hr[i];
      if (h != null) {
        const y = PAD + plotH * (1 - (h - track.hrMin) / (track.hrMax - track.hrMin));
        if (!hrStarted) {
          hr.moveTo(x, y);
          hrStarted = true;
        } else hr.lineTo(x, y);
      }
    }
    if (altStarted) {
      fill.lineTo(columns - 1, height);
      fill.close();
    }
    return { altPath: alt.build(), altFill: fill.build(), hrPath: hr.build() };
  }, [track, width, height, plotH]);

  const dist = track.dist;
  const total = track.totalDist;
  const indexAtX = (x: number) => {
    'worklet';
    return indexAtDistance(dist, (Math.min(Math.max(x, 0), width) / width) * total);
  };
  const xAtIndex = (i: number) => {
    'worklet';
    return total > 0 ? (dist[i] / total) * width : 0;
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
  const readout = useAnimatedProps(() => {
    const i = cursor.value;
    if (i < 0) return { text: ' ', defaultValue: ' ' };
    const km = (dist[i] / 1000).toFixed(2);
    const a = alt[i];
    const h = hr[i];
    const text = `${km} km   ${a == null ? '–' : Math.round(a)} m   ${h == null ? '–' : h} bpm`;
    return { text, defaultValue: text };
  });

  // Where the chart is on screen, for scripts/measure.sh to drag across it.
  const box = useRef<ComponentRef<typeof View>>(null);
  const logBox = () =>
    box.current?.measureInWindow((x, y, w, h) => logPerf(`chart x=${x} y=${y} w=${w} h=${h} (dp)`));

  return (
    <View>
      <AnimatedText
        editable={false}
        underlineColorAndroid="transparent"
        style={[styles.readout, { color: colors.text }]}
        animatedProps={readout}
      />
      <GestureDetector gesture={pan}>
        <View ref={box} onLayout={logBox} collapsable={false}>
        <Canvas style={{ width, height }}>
          <Rect x={bandX} y={0} width={bandW} height={height} color={colors.band} />
          <Path path={altFill} color={colors.altFill} />
          <Path path={altPath} color={colors.alt} style="stroke" strokeWidth={1.5} />
          <Group>
            <Path path={hrPath} color={colors.hr} style="stroke" strokeWidth={1.2} />
          </Group>
          <Line p1={p1} p2={p2} color={colors.cursor} strokeWidth={1.5} />
        </Canvas>
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { fontSize: 13, fontVariant: ['tabular-nums'], paddingVertical: 4, paddingHorizontal: 0 },
});
