/**
 * A goal day by day: one dot per day of a weekly goal (per day of a month, per month of a year) at the
 * height of what was done so far, over a dashed line from zero to the target, the steady pace that
 * reaches it. A dot on or above the line is on track (filled), below it is behind (red), and the days
 * still to come wait as empty rings on the floor. The days come from the calendar the Stats screen
 * already reads, so the server needs nothing new.
 */
import { calendarQuery, type CalendarDay, type GoalOut } from '@zankup/core';
import { Canvas, Circle, DashPathEffect, Line, vec } from '@shopify/react-native-skia';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useApi } from '../auth';
import { locale } from '../i18n';
import { useTheme } from '../theme';

export type GoalPoint = {
  label: string;
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
  const closes: { last: Date; label: string }[] = [];
  if (goal.period === 'year') {
    for (let m = 0; m < 12; m++) {
      const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m + 1, 0));
      closes.push({
        last,
        label: last.toLocaleDateString(locale, { month: 'narrow', timeZone: 'UTC' }),
      });
    }
  } else {
    for (let i = 0; i < length; i++) {
      const day = new Date(start.getTime() + i * 86_400_000);
      closes.push({
        last: day,
        label:
          goal.period === 'week'
            ? day.toLocaleDateString(locale, { weekday: 'narrow', timeZone: 'UTC' })
            : String(day.getUTCDate()),
      });
    }
  }
  let done = 0;
  let cursor = new Date(start);
  return closes.map(({ last, label }) => {
    for (; cursor <= last; cursor = new Date(cursor.getTime() + 86_400_000))
      done += byDay.get(iso(cursor)) ?? 0;
    const elapsed = Math.round((last.getTime() - start.getTime()) / 86_400_000) + 1;
    const expected = (goal.target * elapsed) / length;
    // A day after today is still to come; so is a month of a yearly goal that has not begun.
    const future = goal.period === 'year' ? iso(last).slice(0, 7) > today.slice(0, 7) : iso(last) > today;
    const state: GoalPoint['state'] = future ? 'future' : done >= expected ? 'on' : 'behind';
    return { label, done, expected, state };
  });
}

export function GoalChart({ goal }: { goal: GoalOut }) {
  const api = useApi();
  const c = useTheme();
  const [width, setWidth] = useState(0);
  // Today on the phone's calendar, fixed while the card is on screen.
  const [today] = useState(() => iso(new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)));
  const calendar = useQuery(calendarQuery(api, { from: goal.start, to: goal.end }));
  if (!calendar.data) return <View style={{ height: 96 }} />;
  const points = goalPoints(goal, calendar.data, today);
  const height = 72;
  const pad = 8;
  const top = Math.max(goal.target, ...points.map((p) => p.done)) || 1;
  const slot = points.length ? width / points.length : 0;
  const x = (i: number) => slot * i + slot / 2;
  const y = (v: number) => pad + (height - 2 * pad) * (1 - v / top);
  const radius = Math.max(2.5, Math.min(6, slot * 0.28));
  const labelEvery = points.length > 12 ? 5 : 1;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessible={false}>
      {width > 0 && (
        <Canvas style={{ width, height }}>
          <Line p1={vec(0, y(0))} p2={vec(width, y(0))} color={c.line} strokeWidth={1} />
          <Line p1={vec(0, y(goal.target))} p2={vec(width, y(goal.target))} color={c.line} strokeWidth={1}>
            <DashPathEffect intervals={[3, 4]} />
          </Line>
          <Line
            p1={vec(x(0) - slot / 2, y(0))}
            p2={vec(x(points.length - 1) + slot / 2, y(goal.target))}
            color={c.muted}
            strokeWidth={1.5}
            opacity={0.6}
          >
            <DashPathEffect intervals={[4, 4]} />
          </Line>
          {points.map((p, i) =>
            p.state === 'future' ? (
              <Circle
                key={i}
                cx={x(i)}
                cy={y(0)}
                r={radius}
                color={c.line}
                style="stroke"
                strokeWidth={1.5}
              />
            ) : (
              <Circle
                key={i}
                cx={x(i)}
                cy={y(p.done)}
                r={radius}
                color={p.state === 'on' ? String(c.accent) : c.zone5}
              />
            ),
          )}
        </Canvas>
      )}
      <View style={{ flexDirection: 'row' }}>
        {points.map((p, i) => (
          <Text
            key={i}
            style={{ flex: 1, textAlign: 'center', color: c.muted, fontSize: 10 }}
            numberOfLines={1}
          >
            {i % labelEvery === 0 || i === points.length - 1 ? p.label : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}
