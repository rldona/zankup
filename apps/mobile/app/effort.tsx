/**
 * Relative effort, from Progress (as Strava's): a week on a panel of its status's colour (its score,
 * what it means and its days as bars), the weeks around it with the range each was judged against,
 * and the week's activities with their effort. Swiping the panel, the arrows or touching the chart
 * changes the week.
 */
import { Canvas, Circle, Line, Path, vec } from '@shopify/react-native-skia';
import { calendarQuery, SPORT_ICONS, type CalendarDay } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { hapticClick } from '../modules/haptic-click/src';
import { useApi } from '../src/auth';
import { useCanvasReady } from '../src/charts';
import { Icon } from '../src/Icon';
import { locale, t } from '../src/i18n';
import { asSport } from '../src/prefs';
import { activityBand } from '../src/progress/effort';
import {
  onStatus,
  statusColour,
  statusPaint,
  useEffortWeeks,
  type EffortWeek,
} from '../src/progress/EffortCard';
import { CLICK_STRENGTH } from '../src/progress/FitnessChart';
import { monthLabels } from '../src/progress/VolumeCard';
import { addDays, weekDays } from '../src/progress/weeks';
import { PageSkeleton } from '../src/Skeleton';
import { useTheme } from '../src/theme';
import { accent, InfoButton, Muted, Screen } from '../src/ui';

const WEEKS = 52;
const WINDOW = 12;
const at = (iso: string) => new Date(`${iso}T12:00:00`);
const longDate = (iso: string) =>
  at(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

export default function EffortScreen() {
  const c = useTheme();
  const { weeks, isPending } = useEffortWeeks(WEEKS);
  const [picked, setPicked] = useState<number | null>(null);
  // The last week the chart shows (none: the latest). Only the arrows and the panel's swipe move it.
  const [end, setEnd] = useState<number | null>(null);
  if (isPending) return <PageSkeleton cards={2} />;
  if (!weeks.length)
    return (
      <Screen header>
        <Muted>{t('progress.noEffort')}</Muted>
      </Screen>
    );
  const index = Math.min(picked ?? weeks.length - 1, weeks.length - 1);
  const week = weeks[index];
  const last = Math.min(end ?? weeks.length - 1, weeks.length - 1);
  const first = Math.max(0, last - WINDOW + 1);
  /** A week picked on the chart: the chart stays where it is. */
  const pick = (to: number) => {
    if (to !== index) {
      hapticClick(CLICK_STRENGTH);
      setPicked(to);
    }
  };
  /** The arrows and the swipe: the next or previous week, the chart following when it leaves it. */
  const go = (to: number) => {
    const next = Math.max(0, Math.min(weeks.length - 1, to));
    if (next === index) return;
    pick(next);
    if (next < first) setEnd(next + WINDOW - 1);
    else if (next > last) setEnd(next);
  };
  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-24, 24])
    .failOffsetY([-16, 16])
    .onEnd((e) => go(index + (e.translationX > 0 ? -1 : 1)));
  const colour = statusColour(c, week.status);
  const fg = onStatus(c, week.status);

  return (
    <Screen header>
      <GestureDetector gesture={swipe}>
        <View
          style={{
            marginHorizontal: -16,
            marginTop: -16,
            backgroundColor: colour,
            padding: 20,
            paddingTop: 36,
            gap: 14,
          }}
        >
          <Text style={{ color: fg, fontSize: 14 }}>
            {longDate(week.monday)} - {longDate(addDays(week.monday, 6))}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ color: fg, fontSize: 44, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {week.score}
            </Text>
            <InfoButton text={t('progress.effortInfo')} color={fg} />
          </View>
          <Text style={{ color: fg, fontSize: 18, fontWeight: '800' }}>
            {t(`progress.effortTitle.${week.status}`)}
          </Text>
          <Text style={{ color: fg, fontSize: 14, lineHeight: 22 }}>
            {t(`progress.effortText.${week.status}`)}
          </Text>
          <DayBars monday={week.monday} colour={String(fg)} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('progress.prevWeek')}
              hitSlop={12}
              disabled={index === 0}
              onPress={() => go(index - 1)}
            >
              <Icon name="chevron_left" color={fg} size={30} />
            </Pressable>
            <Text style={{ flex: 1, textAlign: 'center', color: fg, fontSize: 14 }}>
              {t('progress.swipeWeeks')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('progress.nextWeek')}
              hitSlop={12}
              disabled={index === weeks.length - 1}
              onPress={() => go(index + 1)}
            >
              <Icon name="chevron_right" color={index === weeks.length - 1 ? 'transparent' : fg} size={30} />
            </Pressable>
          </View>
        </View>
      </GestureDetector>
      <WeeksChart weeks={weeks} index={index} first={first} onPick={pick} />
      <WeekActivities monday={week.monday} />
    </Screen>
  );
}

/** The week's days as bars of their effort, a dash on a day without any. */
function DayBars({ monday, colour }: { monday: string; colour: string }) {
  const api = useApi();
  const calendar = useQuery(calendarQuery(api, { from: monday, to: addDays(monday, 7) }));
  const byDay = new Map(
    ((calendar.data ?? []) as CalendarDay[]).map((d) => [
      d.day,
      d.activities.reduce((s, a) => s + (a.load ?? 0), 0),
    ]),
  );
  const days = weekDays(monday);
  const values = days.map((d) => byDay.get(d) ?? 0);
  const max = Math.max(1, ...values);
  return (
    <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-end', height: 150, marginTop: 20 }}>
      {days.map((d, i) => (
        <View key={d} style={{ alignItems: 'center', gap: 8 }}>
          <View
            style={{
              width: 14,
              height: values[i] ? Math.max(8, (values[i] / max) * 110) : 2,
              backgroundColor: colour,
            }}
          />
          <Text style={{ color: colour, fontSize: 13 }}>
            {at(d).toLocaleDateString(locale, { weekday: 'narrow' }).toUpperCase()}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Twelve weeks from `first`: their ranges as a band, their scores as rings, the picked one filled. */
function WeeksChart({
  weeks,
  index,
  first,
  onPick,
}: {
  weeks: EffortWeek[];
  index: number;
  /** The first of the twelve weeks shown. */
  first: number;
  onPick: (i: number) => void;
}) {
  const c = useTheme();
  const [width, setWidth] = useState(0);
  const ready = useCanvasReady(width);
  const shown = weeks.slice(first, first + WINDOW);
  const height = 260;
  const top = 34;
  const base = height - 34;
  const axis = 44;
  const plot = Math.max(0, width - axis);
  const max = Math.max(1, ...shown.map((w) => Math.max(w.score, w.range?.hi ?? 0)));
  const step = shown.length > 1 ? plot / (shown.length - 0.5) : 0;
  const x = (i: number) => step * (i + 0.5);
  const y = (v: number) => base - (v / max) * (base - top);
  const banded = shown.map((w, i) => ({ i, r: w.range })).filter((p) => p.r);
  const band = banded.length
    ? [
        ...banded.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)} ${y(p.r?.hi ?? 0)}`),
        ...banded.reverse().map((p) => `L${x(p.i)} ${y(p.r?.lo ?? 0)}`),
        'Z',
      ].join('')
    : '';
  const sel = index - first;
  const colour = statusPaint(c, weeks[index].status);
  const pick = (px: number) =>
    onPick(first + Math.max(0, Math.min(shown.length - 1, Math.round(px / (step || 1) - 0.5))));
  const gesture = Gesture.Race(
    Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-6, 6])
      .failOffsetY([-12, 12])
      .onUpdate((e) => pick(e.x)),
    Gesture.Tap()
      .runOnJS(true)
      .onEnd((e) => pick(e.x)),
  );
  const labels = monthLabels(shown.map((w) => w.monday));
  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ height, opacity: ready ? 1 : 0 }}
      >
        {width > 0 && (
          <>
            <Canvas style={{ width, height }}>
              {ready && (
                <>
                  {shown.map((_, i) => (
                    <Line key={i} p1={vec(x(i), top)} p2={vec(x(i), base)} color={c.line} strokeWidth={1} />
                  ))}
                  {band ? <Path path={band} color={c.muted} opacity={0.35} /> : null}
                  <Line p1={vec(x(sel), 6)} p2={vec(x(sel), base)} color={colour} strokeWidth={1.5} />
                  {shown.map((w, i) =>
                    i === sel ? null : (
                      <Circle
                        key={i}
                        cx={x(i)}
                        cy={y(w.score)}
                        r={5}
                        style="stroke"
                        strokeWidth={2}
                        color={c.fg}
                      />
                    ),
                  )}
                  <Circle cx={x(sel)} cy={y(shown[sel].score)} r={16} color={colour} opacity={0.3} />
                  <Circle cx={x(sel)} cy={y(shown[sel].score)} r={8} color={colour} />
                  {[0.25, 0.5, 0.75, 1].map((f) => (
                    <Line
                      key={f}
                      p1={vec(plot + 16, y(max * f))}
                      p2={vec(plot + 28, y(max * f))}
                      color={c.muted}
                      strokeWidth={1}
                    />
                  ))}
                </>
              )}
            </Canvas>
            <Text style={{ position: 'absolute', right: 0, top: top - 22, color: c.fg, fontSize: 13 }}>
              {max}
            </Text>
            {labels.map(({ index: i, text }) => (
              <Text
                key={i}
                style={{ position: 'absolute', top: base + 8, left: x(i) - 6, color: c.fg, fontSize: 13 }}
              >
                {text}
              </Text>
            ))}
          </>
        )}
      </View>
    </GestureDetector>
  );
}

/** The week's activities, newest last: when, what, how long, and their effort in its band's colour. */
function WeekActivities({ monday }: { monday: string }) {
  const api = useApi();
  const c = useTheme();
  const calendar = useQuery(calendarQuery(api, { from: monday, to: addDays(monday, 7) }));
  const activities = ((calendar.data ?? []) as CalendarDay[]).flatMap((d) => d.activities);
  if (!activities.length) return null;
  const band = { light: c.fitness, moderate: accent(c), hard: c.zone5 };
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: c.fg, fontSize: 14, fontWeight: '700', marginBottom: 8 }}>
        {t('progress.weekActivities')}
      </Text>
      {activities.map((a) => {
        const start = new Date(a.start);
        const minutes = Math.round(a.moving_s / 60);
        const effort = Math.round(a.load ?? 0);
        return (
          <Pressable
            key={a.id}
            accessibilityRole="button"
            onPress={() => router.push(`/activity/${a.id}`)}
            style={{ flexDirection: 'row', gap: 16, paddingVertical: 14 }}
          >
            <Icon name={SPORT_ICONS[asSport(a.sport)]} color={c.fg} size={26} />
            <View style={{ flex: 1, gap: 4 }}>
              <Muted style={{ color: c.fg, fontSize: 13 }}>
                {t('progress.activityWhen', {
                  date: start.toLocaleDateString(locale, { day: 'numeric', month: 'long' }),
                  time: start.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }),
                })}
              </Muted>
              <Text style={{ color: c.fg, fontSize: 16 }}>{a.name ?? t(`sport.${asSport(a.sport)}`)}</Text>
              <Text style={{ color: c.fg, fontSize: 14 }}>
                {Math.floor(minutes / 60)} h {minutes % 60} min
              </Text>
            </View>
            <Text
              style={{
                alignSelf: 'center',
                color: band[activityBand(effort)],
                fontSize: 22,
                fontWeight: '800',
                fontVariant: ['tabular-nums'],
              }}
            >
              {effort}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
