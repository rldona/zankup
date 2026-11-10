/**
 * A goal day by day: a line through what each day of a weekly goal added (each day of a month, each
 * month of a year), down to zero on a day with nothing, over a solid fill, with the day's share of the
 * target as a dashed line. Days with something done are green, the others grey rings; round values on
 * the right and the days underneath. Today's point is picked with a cursor and the value above gives
 * the day's amount and the total so far; touching or sliding picks another. Days still to come have no
 * point. The days come from the calendar the Stats screen already reads, so the server needs nothing new.
 */
import { calendarQuery, goalPoints, type GoalOut } from '@zankup/core';
import { Canvas, Circle, DashPathEffect, Group, Line, Path, vec } from '@shopify/react-native-skia';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { useApi } from '../auth';
import { locale, t } from '../i18n';
import { niceScale, useCanvasReady } from '../charts';
import { useTheme } from '../theme';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function GoalChart({
  goal,
  value,
  tick,
}: {
  goal: GoalOut;
  /** A value written in full (above the chart), and a round one for the axis. */
  value: (v: number) => string;
  tick: (v: number) => string;
}) {
  const api = useApi();
  const c = useTheme();
  const [width, setWidth] = useState(0);
  // Today on the phone's calendar, fixed while the card is on screen.
  const [today] = useState(() => iso(new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)));
  const [picked, setPicked] = useState<number | null>(null);
  const painted = useCanvasReady(width);
  const calendar = useQuery(calendarQuery(api, { from: goal.start, to: goal.end }));
  if (!calendar.data) return <View style={{ height: 150 }} />;
  const points = goalPoints(goal, calendar.data, today, locale);
  const past = points.filter((p) => p.state !== 'future').length;
  const current = Math.min(picked ?? past - 1, past - 1);

  const height = 120;
  const top = 10;
  // Room under the floor for the picked point's halo, so a day at zero is not cut by the edge.
  const bottom = height - 14;
  const axis = 52;
  const plot = Math.max(0, width - axis);
  // Each point is what that day (or month) added; the dashed line is its share of the target.
  const share = points.length ? goal.target / points.length : goal.target;
  // Sessions come whole: a count's axis goes at least to 2, so its marks are 0, 1, 2.
  const floor = goal.metric === 'count' ? 2 : 0;
  const scale = niceScale([0, Math.max(floor, share, ...points.map((p) => p.own)) || 1], 2);
  const [, hi] = scale.domain;
  const slot = points.length ? plot / points.length : 0;
  const x = (i: number) => slot * i + slot / 2;
  const y = (v: number) => bottom - (bottom - top) * (v / (hi || 1));
  const radius = Math.max(2.5, Math.min(4.5, slot * 0.16));
  const labelEvery = points.length > 12 ? 5 : 1;

  const shown = points.slice(0, past);
  // The line starts from zero at the very start of the period, where the dashed diagonal starts.
  const line = shown.length ? `M0 ${y(0)}${shown.map((p, i) => `L${x(i)} ${y(p.own)}`).join('')}` : '';
  // No fill while nothing is done: a shape with no height breaks the whole canvas.
  const area = shown.some((p) => p.own > 0) ? `${line}L${x(shown.length - 1)} ${bottom}L0 ${bottom}Z` : '';
  const colour = String(c.accent);

  const pick = (px: number) => {
    if (!slot || !past) return;
    setPicked(Math.max(0, Math.min(past - 1, Math.floor(px / slot))));
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
  const at = current >= 0 ? points[current] : null;

  return (
    // Everything shows together once drawn, so the labels never appear ahead of the chart.
    <View accessible={false} style={{ gap: 4, opacity: painted ? 1 : 0 }}>
      {at && (
        <Text style={{ color: c.muted, fontSize: 12 }}>
          {at.when} ·{' '}
          <Text style={{ color: c.fg, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
            {value(at.own)}
          </Text>
          {current > 0 ? ` · ${t('goals.total', { value: value(at.done) })}` : ''}
        </Text>
      )}
      <GestureDetector gesture={gesture}>
        <View collapsable={false} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
          {width > 0 && (
            <Canvas style={{ width, height }}>
              {painted && (
                <>
                  {/* The floor and the top as lines; between them, each day a faint vertical line with a hollow ring at
                      every mark of the axis, the size of a day's point. */}
                  <Line p1={vec(0, y(0))} p2={vec(plot, y(0))} color={c.line} strokeWidth={1} />
                  <Line
                    p1={vec(0, y(hi))}
                    p2={vec(plot, y(hi))}
                    color={c.muted}
                    opacity={0.25}
                    strokeWidth={1}
                  />
                  {points.map((_, i) => (
                    <Line
                      key={`day-${i}`}
                      p1={vec(x(i), y(hi))}
                      p2={vec(x(i), y(0))}
                      color={c.muted}
                      opacity={0.25}
                      strokeWidth={1}
                    />
                  ))}
                  {scale.ticks.flatMap((v) =>
                    points.map((p, i) =>
                      // On the floor, only the days to come: the others have their own point there.
                      v === 0 && p.state !== 'future' ? null : (
                        <Group key={`${v}-${i}`}>
                          <Circle cx={x(i)} cy={y(v)} r={radius} color={c.surface} />
                          <Circle
                            cx={x(i)}
                            cy={y(v)}
                            r={radius}
                            color={c.muted}
                            opacity={0.4}
                            style="stroke"
                            strokeWidth={1.5}
                          />
                        </Group>
                      ),
                    ),
                  )}
                  <Line
                    p1={vec(0, y(share))}
                    p2={vec(plot, y(share))}
                    color={c.muted}
                    strokeWidth={1}
                    opacity={0.7}
                  >
                    <DashPathEffect intervals={[4, 4]} />
                  </Line>
                  {area ? <Path path={area} color={colour} opacity={0.35} /> : null}
                  {line ? (
                    <Path path={line} style="stroke" strokeWidth={3} strokeJoin="round" color={colour} />
                  ) : null}
                  {at && (
                    <Line
                      p1={vec(x(current), top)}
                      p2={vec(x(current), bottom)}
                      color={c.fg}
                      strokeWidth={2}
                    />
                  )}
                  {/* Green where something was done that day; a grey ring where the line only carries on. */}
                  {shown.map((p, i) => {
                    const tint = p.own > 0 ? colour : c.muted;
                    return i === current ? (
                      <Group key={i}>
                        <Circle cx={x(i)} cy={y(p.own)} r={radius * 2.2} color={tint} opacity={0.3} />
                        <Circle cx={x(i)} cy={y(p.own)} r={radius + 1} color={tint} />
                      </Group>
                    ) : (
                      <Group key={i}>
                        <Circle cx={x(i)} cy={y(p.own)} r={radius} color={c.surface} />
                        <Circle
                          cx={x(i)}
                          cy={y(p.own)}
                          r={radius}
                          color={tint}
                          style="stroke"
                          strokeWidth={2.5}
                        />
                      </Group>
                    );
                  })}
                </>
              )}
            </Canvas>
          )}
          {width > 0 &&
            scale.ticks.map((v) => (
              <Text
                key={v}
                style={{
                  position: 'absolute',
                  left: plot + 8,
                  top: y(v) - 8,
                  color: c.muted,
                  fontSize: 11,
                  fontVariant: ['tabular-nums'],
                }}
                numberOfLines={1}
              >
                {tick(v)}
              </Text>
            ))}
        </View>
      </GestureDetector>
      <View style={{ flexDirection: 'row', width: plot }}>
        {points.map((p, i) => (
          <Text
            key={i}
            style={{
              flex: 1,
              textAlign: 'center',
              color: i === current ? c.fg : c.muted,
              fontSize: 11,
              fontWeight: i === current ? '700' : '400',
            }}
            numberOfLines={1}
          >
            {i % labelEvery === 0 || i === points.length - 1 ? p.label : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}
