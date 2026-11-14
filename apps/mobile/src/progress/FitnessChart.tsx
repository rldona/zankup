/**
 * Fitness drawn as Strava does (Progress → Fitness): the score as a filled line over the range, a circle
 * on each day with load (bigger, harder) when the range is short, and the picked day marked with its
 * score in a badge. Touching or sliding sideways picks a day; a vertical swipe still scrolls the screen.
 * `FitnessSparkline` is the same line, small, for the card on Progress.
 */
import { Canvas, Circle, Group, Line, Path, vec } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { hapticClick } from '../../modules/haptic-click/src';
import { dayTicks, niceScale, shortNumber, useCanvasReady } from '../charts';
import { useTheme } from '../theme';
import { loadRadius } from './fitness';

const AXIS = 34;
const TOP = 40; // room for the picked day's badge
const BOTTOM = 22; // the days under the chart
/** How hard the click on a day with training is (0 to 1): the system's slider tick, firmer. */
export const CLICK_STRENGTH = 1;

function points(values: number[], left: number, plot: number, y: (v: number) => number) {
  const step = values.length > 1 ? plot / (values.length - 1) : 0;
  return values.map((v, i) => [left + i * step, y(v)] as const);
}

function linePath(pts: readonly (readonly [number, number])[]) {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('');
}

function areaPath(pts: readonly (readonly [number, number])[], base: number) {
  if (!pts.length) return '';
  return `${linePath(pts)}L${pts[pts.length - 1][0]} ${base}L${pts[0][0]} ${base}Z`;
}

export function FitnessChart({
  values,
  loads,
  labels,
  picked,
  onPick,
  showLoads,
  height = 360,
  label,
}: {
  values: number[];
  loads: number[];
  /** Under the chart: a few of these, always the first and the last. */
  labels: string[];
  picked: number;
  onPick: (index: number) => void;
  /** The circles of each day's load (the one-month range). */
  showLoads: boolean;
  height?: number;
  /** What the chart says, for TalkBack. */
  label: string;
}) {
  const c = useTheme();
  const [width, setWidth] = useState(0);
  const ready = useCanvasReady(width);
  const count = values.length;
  const plot = Math.max(0, width - AXIS - 22); // room on the right for the picked day's halo
  const inner = height - TOP - BOTTOM;
  const base = TOP + inner;
  // The tightest round top over the line (Strava: 106 → 120, not 125), with four to six steps.
  const { domain, ticks } = useMemo(() => {
    const top = Math.max(10, ...values) * 1.05;
    return [4, 5, 6]
      .map((n) => niceScale([0, top], n))
      .reduce((best, s) => (s.domain[1] < best.domain[1] ? s : best));
  }, [values]);
  const y = (v: number) => base - ((v - domain[0]) / (domain[1] - domain[0] || 1)) * inner;
  const pts = width ? points(values, AXIS, plot, y) : [];
  const step = count > 1 ? plot / (count - 1) : 0;
  const maxLoad = Math.max(0, ...loads);
  const colour = String(c.accent);

  const pick = (x: number) => {
    if (!count) return;
    const i = Math.max(0, Math.min(count - 1, Math.round((x - AXIS) / (step || 1))));
    if (i === picked) return;
    // A crisp system tick (as a slider's steps) when the finger lands on a day's circle (a day with training).
    if (showLoads && loadRadius(loads[i] ?? 0, maxLoad) > 0) hapticClick(CLICK_STRENGTH);
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

  const at = pts[picked];
  const marks = dayTicks(count, 5);
  const muted = { color: c.muted, fontSize: 11, fontVariant: ['tabular-nums' as const] };
  const badge = 48;

  return (
    <GestureDetector gesture={gesture}>
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
                    <Line
                      key={v}
                      p1={vec(AXIS, Math.round(y(v)) - 0.5)}
                      p2={vec(AXIS + plot, Math.round(y(v)) - 0.5)}
                      color={c.line}
                      strokeWidth={1}
                      opacity={v === 0 ? 1 : 0.5}
                    />
                  ))}
                  <Path path={areaPath(pts, base)} color={colour} opacity={0.22} />
                  <Path
                    path={linePath(pts)}
                    style="stroke"
                    strokeWidth={2.5}
                    strokeJoin="round"
                    strokeCap="round"
                    color={colour}
                  />
                  {showLoads &&
                    pts.map(([px, py], i) => {
                      const r = loadRadius(loads[i] ?? 0, maxLoad);
                      return r ? (
                        <Group key={i}>
                          <Circle cx={px} cy={py} r={r} color={c.bg} />
                          <Circle cx={px} cy={py} r={r} style="stroke" strokeWidth={2} color={colour} />
                        </Group>
                      ) : null;
                    })}
                  {at && (
                    <>
                      <Line
                        p1={vec(at[0], Math.max(0, at[1] - 24))}
                        p2={vec(at[0], base)}
                        color={colour}
                        strokeWidth={1.5}
                      />
                      <Circle cx={at[0]} cy={at[1]} r={15} color={colour} opacity={0.25} />
                      <Circle cx={at[0]} cy={at[1]} r={7} color={colour} />
                    </>
                  )}
                </>
              )}
            </Canvas>
            {ticks.map((v) => (
              <Text
                key={v}
                style={[
                  muted,
                  { position: 'absolute', left: 0, width: AXIS - 8, textAlign: 'right', top: y(v) - 8 },
                ]}
              >
                {shortNumber(v)}
              </Text>
            ))}
            {marks.map((i) => {
              const x = AXIS + i * step;
              return (
                <Text
                  key={i}
                  numberOfLines={1}
                  style={[
                    muted,
                    {
                      position: 'absolute',
                      top: base + 6,
                      width: 64,
                      textAlign: 'center',
                      left: Math.max(AXIS - 16, Math.min(width - 64, x - 32)),
                    },
                  ]}
                >
                  {labels[i]}
                </Text>
              );
            })}
            {at && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: Math.max(0, at[1] - 58),
                  left: Math.max(0, Math.min(width - badge, at[0] - badge / 2)),
                  width: badge,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: colour,
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    color: c.accentFg,
                    fontWeight: '700',
                    fontSize: 14,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {Math.round(values[picked])}
                </Text>
              </View>
            )}
          </>
        )}
      </View>
    </GestureDetector>
  );
}

/** The card's line: where the range started (its score beside it) and today, marked. */
export function FitnessSparkline({
  values,
  width = 150,
  height = 84,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  const c = useTheme();
  const ready = useCanvasReady(width);
  const colour = String(c.accent);
  const left = 30; // the first score, written before the line
  const pad = 14;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo || 1)) * (height - 2 * pad);
  const pts = points(values, left, width - left - pad, y);
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (!first || !last) return null;
  return (
    <View style={{ width, height, opacity: ready ? 1 : 0 }}>
      <Canvas style={{ width, height }}>
        {ready && (
          <>
            <Path path={areaPath(pts, height)} color={colour} opacity={0.15} />
            <Line
              p1={vec(left, last[1])}
              p2={vec(last[0], last[1])}
              color={c.muted}
              strokeWidth={1}
              opacity={0.6}
            />
            <Path path={linePath(pts)} style="stroke" strokeWidth={2.5} strokeJoin="round" color={colour} />
            <Circle cx={first[0]} cy={first[1]} r={5} color={c.surface} />
            <Circle cx={first[0]} cy={first[1]} r={5} style="stroke" strokeWidth={2.5} color={colour} />
            <Circle cx={last[0]} cy={last[1]} r={11} color={colour} opacity={0.25} />
            <Circle cx={last[0]} cy={last[1]} r={5.5} color={colour} />
          </>
        )}
      </Canvas>
      <Text
        style={{
          position: 'absolute',
          left: 0,
          width: left - 8,
          textAlign: 'right',
          top: first[1] - 9,
          color: c.muted,
          fontSize: 12,
          fontVariant: ['tabular-nums'],
        }}
      >
        {Math.round(values[0])}
      </Text>
    </View>
  );
}
