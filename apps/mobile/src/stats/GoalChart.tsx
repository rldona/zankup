/**
 * A goal day by day, drawn like a progress chart: a line through what was done so far each day of a
 * weekly goal (each day of a month, each month of a year) over a solid fill, ringed points in the
 * line's colour (with a faint dashed diagonal for a steady pace to the target), round values on the right
 * and the days underneath. Today's point is filled with a cursor; touching or sliding picks another.
 * Days still to come have no point. The days come from the calendar the Stats screen already reads,
 * so the server needs nothing new.
 */
import { calendarQuery, type CalendarDay, type GoalOut } from '@zankup/core';
import { Canvas, Circle, DashPathEffect, Group, Line, Path, vec } from '@shopify/react-native-skia';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { useApi } from '../auth';
import { locale } from '../i18n';
import { niceScale } from '../charts';
import { useTheme } from '../theme';

export type GoalPoint = {
  label: string;
  /** The point's day (or month) written out, for the value above the chart. */
  when: string;
  /** What was done from the start of the period to the end of this point. */
  done: number;
  /** Where a steady pace would be by then. */
  expected: number;
  state: 'on' | 'behind' | 'future';
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (day: string) => new Date(`${day}T00:00:00Z`);

/** How much one calendar day counts towards the goal (its sport, its metric). */
export function dayAmount(goal: Pick<GoalOut, 'metric' | 'sport'>, day: CalendarDay): number {
  return day.activities
    .filter((a) => !goal.sport || a.sport === goal.sport)
    .reduce(
      (sum, a) =>
        sum + (goal.metric === 'distance' ? (a.distance_m ?? 0) : goal.metric === 'time' ? a.moving_s : 1),
      0,
    );
}

/** The points of the chart: days of a week or a month, months of a year, cumulated. */
export function goalPoints(
  goal: Pick<GoalOut, 'metric' | 'sport' | 'period' | 'target' | 'start' | 'end'>,
  days: CalendarDay[],
  today: string,
): GoalPoint[] {
  const start = parse(goal.start);
  const end = parse(goal.end);
  const length = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const byDay = new Map(days.map((d) => [d.day, dayAmount(goal, d)]));
  // Each point closes at the end of a day (week, month) or of a month (year).
  const closes: { last: Date; label: string; when: string }[] = [];
  if (goal.period === 'year') {
    for (let m = 0; m < 12; m++) {
      const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m + 1, 0));
      closes.push({
        last,
        label: last.toLocaleDateString(locale, { month: 'narrow', timeZone: 'UTC' }),
        when: last.toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' }),
      });
    }
  } else {
    for (let i = 0; i < length; i++) {
      const day = new Date(start.getTime() + i * 86_400_000);
      closes.push({
        last: day,
        label:
          goal.period === 'week'
            ? day.toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }).replace('.', '')
            : String(day.getUTCDate()),
        when: day.toLocaleDateString(locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        }),
      });
    }
  }
  let done = 0;
  let cursor = new Date(start);
  return closes.map(({ last, label, when }) => {
    for (; cursor <= last; cursor = new Date(cursor.getTime() + 86_400_000))
      done += byDay.get(iso(cursor)) ?? 0;
    const elapsed = Math.round((last.getTime() - start.getTime()) / 86_400_000) + 1;
    const expected = (goal.target * elapsed) / length;
    // A day after today is still to come; so is a month of a yearly goal that has not begun.
    const future = goal.period === 'year' ? iso(last).slice(0, 7) > today.slice(0, 7) : iso(last) > today;
    const state: GoalPoint['state'] = future ? 'future' : done >= expected ? 'on' : 'behind';
    return { label, when, done, expected, state };
  });
}

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
  // On Android a canvas that draws before its surface exists stays blank, and these never redraw on
  // their own: the drawing comes a moment after the canvas, which then paints it.
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    if (!width) return;
    // Two frames: the canvas gets its surface in the first, the drawing lands in the second.
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setPainted(true));
    });
    return () => cancelAnimationFrame(id);
  }, [width]);
  const calendar = useQuery(calendarQuery(api, { from: goal.start, to: goal.end }));
  if (!calendar.data) return <View style={{ height: 150 }} />;
  const points = goalPoints(goal, calendar.data, today);
  const past = points.filter((p) => p.state !== 'future').length;
  const current = Math.min(picked ?? past - 1, past - 1);

  const height = 120;
  const top = 10;
  const bottom = height - 8;
  const axis = 52;
  const plot = Math.max(0, width - axis);
  const scale = niceScale([0, Math.max(goal.target, ...points.map((p) => p.done)) || 1], 2);
  const [, hi] = scale.domain;
  const slot = points.length ? plot / points.length : 0;
  const x = (i: number) => slot * i + slot / 2;
  const y = (v: number) => bottom - (bottom - top) * (v / (hi || 1));
  const radius = Math.max(2.5, Math.min(4.5, slot * 0.16));
  const labelEvery = points.length > 12 ? 5 : 1;

  const shown = points.slice(0, past);
  // The line starts from zero at the very start of the period, where the dashed diagonal starts.
  const line = shown.length ? `M0 ${y(0)}${shown.map((p, i) => `L${x(i)} ${y(p.done)}`).join('')}` : '';
  // No fill while nothing is done: a shape with no height breaks the whole canvas.
  const area = shown.some((p) => p.done > 0) ? `${line}L${x(shown.length - 1)} ${bottom}L0 ${bottom}Z` : '';
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
            {value(at.done)}
          </Text>
        </Text>
      )}
      <GestureDetector gesture={gesture}>
        <View collapsable={false} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
          {width > 0 && (
            <Canvas style={{ width, height }}>
              {painted && (
                <>
                  {scale.ticks.map((v) => (
                    <Line key={v} p1={vec(0, y(v))} p2={vec(plot, y(v))} color={c.line} strokeWidth={1} />
                  ))}
                  <Line
                    p1={vec(0, y(0))}
                    p2={vec(plot, y(goal.target))}
                    color={c.muted}
                    strokeWidth={1}
                    opacity={0.5}
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
                  {shown.map((p, i) =>
                    i === current ? (
                      <Group key={i}>
                        <Circle cx={x(i)} cy={y(p.done)} r={radius * 2.2} color={colour} opacity={0.3} />
                        <Circle cx={x(i)} cy={y(p.done)} r={radius + 1} color={colour} />
                      </Group>
                    ) : (
                      <Group key={i}>
                        <Circle cx={x(i)} cy={y(p.done)} r={radius} color={c.surface} />
                        <Circle
                          cx={x(i)}
                          cy={y(p.done)}
                          r={radius}
                          color={colour}
                          style="stroke"
                          strokeWidth={2.5}
                        />
                      </Group>
                    ),
                  )}
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
