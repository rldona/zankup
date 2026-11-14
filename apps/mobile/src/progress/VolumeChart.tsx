/**
 * Volume over time as Strava's Progress draws it: a line over a solid fill, a ring on each point when
 * there are few, the axis on the right and months (or days) along the bottom. Optionally the range
 * before it as a second line, and a picked point (a white rule and a filled dot) that touch or a
 * sideways slide moves; a vertical swipe still scrolls the screen.
 */
import { Canvas, Circle, Group, Line, Path, vec } from '@shopify/react-native-skia';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { hapticClick } from '../../modules/haptic-click/src';
import { useCanvasReady } from '../charts';
import { useTheme } from '../theme';
import { CLICK_STRENGTH } from './FitnessChart';

const AXIS = 76; // the labels on the right
const LABELS = 26; // the months under the chart

export function VolumeChart({
  values,
  previous,
  ticks,
  tickLabel,
  labels,
  picked,
  onPick,
  height = 230,
  label,
}: {
  values: number[];
  /** The range before, drawn as a second line on the same scale. */
  previous?: number[] | null;
  /** The right axis, from zero up. */
  ticks: number[];
  tickLabel: (v: number) => string;
  /** Words under some points (their index). */
  labels: { index: number; text: string }[];
  picked?: number | null;
  onPick?: (index: number) => void;
  height?: number;
  /** What the chart says, for TalkBack. */
  label: string;
}) {
  const c = useTheme();
  const [width, setWidth] = useState(0);
  const ready = useCanvasReady(width);
  const colour = String(c.accent);
  const plot = Math.max(0, width - AXIS - 8);
  const top = 10;
  const base = height - LABELS;
  const max = ticks.at(-1) || 1;
  const step = values.length > 1 ? plot / (values.length - 1) : 0;
  const x = (i: number) => 4 + i * step;
  const y = (v: number) => base - (Math.min(v, max) / max) * (base - top);
  const points = values.map((v, i) => [x(i), y(v)] as const);
  const line = (pts: readonly (readonly [number, number])[]) =>
    pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join('');
  const end = points[points.length - 1];
  const area = end ? `${line(points)}L${end[0]} ${base}L${points[0][0]} ${base}Z` : '';
  const before = previous?.slice(0, values.length).map((v, i) => [x(i), y(v)] as const);
  const rings = values.length <= 60;
  const at = picked != null ? points[picked] : null;

  const pick = (px: number) => {
    if (!onPick || !values.length) return;
    const i = Math.max(0, Math.min(values.length - 1, Math.round((px - 4) / (step || 1))));
    if (i === picked) return;
    // The same click as Fitness's circles when the finger lands on another point.
    if (rings) hapticClick(CLICK_STRENGTH);
    onPick(i);
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
      .onEnd((e) => pick(e.x)),
  );
  const muted = { color: c.fg, fontSize: 12, fontVariant: ['tabular-nums' as const] };

  const chart = (
    <View
      accessible
      accessibilityLabel={label}
      collapsable={false}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height, opacity: ready ? 1 : 0 }}
    >
      {width > 0 && (
        <>
          <Canvas style={{ width, height }}>
            {ready && (
              <>
                {ticks.map((v) => (
                  <Line key={v} p1={vec(0, y(v))} p2={vec(plot + 8, y(v))} color={c.line} strokeWidth={1} />
                ))}
                <Path path={area} color={colour} opacity={0.3} />
                {before && before.length > 1 && (
                  <Path
                    path={line(before)}
                    style="stroke"
                    strokeWidth={2}
                    strokeJoin="round"
                    color={c.fatigue}
                  />
                )}
                <Path path={line(points)} style="stroke" strokeWidth={3} strokeJoin="round" color={colour} />
                {rings &&
                  points.map(([px, py], i) => (
                    <Group key={i}>
                      <Circle cx={px} cy={py} r={4.5} color={c.surface} />
                      <Circle cx={px} cy={py} r={4.5} style="stroke" strokeWidth={2.5} color={colour} />
                    </Group>
                  ))}
                {at && (
                  <>
                    <Line p1={vec(at[0], top)} p2={vec(at[0], base)} color={c.fg} strokeWidth={2} />
                    <Circle cx={at[0]} cy={at[1]} r={14} color={colour} opacity={0.3} />
                    <Circle cx={at[0]} cy={at[1]} r={7} color={colour} />
                  </>
                )}
              </>
            )}
          </Canvas>
          {ticks.map((v) => (
            <Text key={v} style={[muted, { position: 'absolute', right: 0, top: y(v) - 9 }]}>
              {tickLabel(v)}
            </Text>
          ))}
          {labels.map(({ index, text }) => (
            <Text
              key={index}
              numberOfLines={1}
              style={[
                muted,
                {
                  position: 'absolute',
                  top: base + 8,
                  width: 64,
                  textAlign: 'center',
                  left: Math.max(0, Math.min(plot - 56, x(index) - 32)),
                },
              ]}
            >
              {text}
            </Text>
          ))}
        </>
      )}
    </View>
  );
  return onPick ? <GestureDetector gesture={gesture}>{chart}</GestureDetector> : chart;
}
