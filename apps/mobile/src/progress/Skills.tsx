/**
 * Skills on Progress (as Strava's): the radar of a rider's best power over twelve durations, each on
 * the nine-level scale (skills.ts), ringed by the three skills in their colours, for the last eight
 * weeks over all time. The card shows the strongest skill beside the radar, small; app/skills.tsx the
 * radar in full with each skill's level.
 */
import { curvesQuery, meQuery } from '@zankup/core';
import { Canvas, Circle, Group, Line, Path, vec } from '@shopify/react-native-skia';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../auth';
import { useCanvasReady } from '../charts';
import { Icon } from '../Icon';
import { t } from '../i18n';
import { CardSkeleton } from '../Skeleton';
import { useTheme, type Palette } from '../theme';
import { accent, Card, Muted } from '../ui';
import { isoDay } from './fitness';
import { DURATIONS, durationLabel, LEVELS, levelAt, SKILLS, strongest, type Skill } from './skillLevels';
import { addDays } from './weeks';

/** Without a weight in the profile, the scale is read for a rider of this much. */
export const REFERENCE_KG = 75;

export const skillColour = (c: Palette, skill: Skill) =>
  String(skill === 'sprint' ? c.fitness : skill === 'attack' ? c.formPositive : c.zone4);

/** The two radars' colours: all time, and the last eight weeks over it. */
export const radarColours = (c: Palette) => ({ all: String(c.sleepRem), recent: String(c.fatigue) });

/** The best power at each duration, for the last eight weeks and for all time, and the weight. */
export function useSkills() {
  const api = useApi();
  const today = isoDay(new Date());
  const recent = useQuery(curvesQuery(api, 'power', { from: addDays(today, -55), to: addDays(today, 1) }));
  const all = useQuery(curvesQuery(api, 'power', { from: '2000-01-01', to: addDays(today, 1) }));
  const me = useQuery(meQuery(api));
  const map = (points?: { duration_s: number; value: number }[]) =>
    new Map((points ?? []).map((p) => [p.duration_s, p.value]));
  const weight = me.data?.weight_kg ?? null;
  return {
    recent: map(recent.data),
    all: map(all.data),
    weight: weight ?? REFERENCE_KG,
    hasWeight: weight != null,
    isPending: recent.isPending || all.isPending,
  };
}

/** The radar: rings for the levels, a spoke per duration, the skills round it and one or two shapes. */
export function SkillsRadar({
  size,
  shapes,
  labels = true,
}: {
  size: number;
  /** Each shape's best power by duration and its colour, the first drawn first (under). */
  shapes: { bests: Map<number, number>; colour: string; weight: number }[];
  labels?: boolean;
}) {
  const c = useTheme();
  const ready = useCanvasReady(size);
  const centre = size / 2;
  const band = labels ? size * 0.055 : size * 0.07;
  const outer = labels ? size * 0.31 : size / 2 - band / 2 - 1;
  const inner = outer - band / 2 - 2;
  const step = (Math.PI * 2) / DURATIONS.length;
  const angle = (i: number) => -Math.PI / 2 + i * step;
  const at = (i: number, r: number) => vec(centre + r * Math.cos(angle(i)), centre + r * Math.sin(angle(i)));
  // Paths as SVG: this Skia builds them from strings.
  const shape = (bests: Map<number, number>, weight: number) =>
    DURATIONS.map((d, i) => {
      const p = at(i, (inner * levelAt(bests.get(d) ?? 0, d, weight)) / LEVELS);
      return `${i ? 'L' : 'M'}${p.x} ${p.y}`;
    }).join('') + 'Z';
  const arc = (from: number, to: number) => {
    const gap = 0.014;
    const a0 = angle(from) - step / 2 + gap;
    const a1 = angle(to) + step / 2 - gap;
    const p = (a: number) => `${centre + outer * Math.cos(a)} ${centre + outer * Math.sin(a)}`;
    return `M${p(a0)}A${outer} ${outer} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`;
  };
  return (
    <View style={{ width: size, height: size }}>
      <Canvas style={{ width: size, height: size, opacity: ready ? 1 : 0 }}>
        {ready && (
          <Group>
            {labels &&
              Array.from({ length: LEVELS }, (_, k) => (
                <Circle
                  key={k}
                  cx={centre}
                  cy={centre}
                  r={(inner * (k + 1)) / LEVELS}
                  style="stroke"
                  strokeWidth={1}
                  color={c.line}
                />
              ))}
            {labels &&
              DURATIONS.map((_, i) => (
                <Line key={i} p1={vec(centre, centre)} p2={at(i, inner)} color={c.line} strokeWidth={1} />
              ))}
            {SKILLS.map(({ skill, durations }, k) => {
              // Where the skill's first spoke is: after the durations of the skills before it.
              const from = SKILLS.slice(0, k).reduce((n, x) => n + x.durations.length, 0);
              return (
                <Path
                  key={skill}
                  path={arc(from, from + durations.length - 1)}
                  style="stroke"
                  strokeWidth={band}
                  color={skillColour(c, skill)}
                />
              );
            })}
            {shapes.map((s, i) => (
              <Path key={i} path={shape(s.bests, s.weight)} color={s.colour} opacity={0.85} />
            ))}
          </Group>
        )}
      </Canvas>
      {labels &&
        DURATIONS.map((d, i) => {
          const p = at(i, outer + band / 2 + 22);
          const w = shapes.at(-1)?.bests.get(d);
          return (
            <View
              key={d}
              style={{ position: 'absolute', left: p.x - 34, top: p.y - 18, width: 68, alignItems: 'center' }}
            >
              <Text style={{ color: c.fg, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                {w ? `${Math.round(w)} W` : '–'}
              </Text>
              <Text style={{ color: c.muted, fontSize: 11 }}>{durationLabel(d)}</Text>
            </View>
          );
        })}
    </View>
  );
}

export function SkillsCard() {
  const c = useTheme();
  const skills = useSkills();
  if (skills.isPending) return <CardSkeleton lines={3} />;
  const best = strongest(skills.recent, skills.weight);
  const colours = radarColours(c);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('progress.skills')}${best ? `: ${t(`progress.skill.${best.skill}`)} ${durationLabel(best.duration)} ${Math.round(best.watts)} W` : ''}`}
      onPress={() => router.push('/skills')}
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="bolt" color={accent(c)} size={26} />
          <Text numberOfLines={1} style={{ flex: 1, color: c.fg, fontSize: 16, fontWeight: '700' }}>
            {t('progress.skills')}
          </Text>
          <Muted style={{ fontSize: 14 }}>{t('progress.last8Weeks')}</Muted>
          <Icon name="chevron_right" color={c.muted} size={22} />
        </View>
        {!best ? (
          <Muted style={{ marginTop: 12 }}>{t('progress.noSkills')}</Muted>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 8 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.fg, fontSize: 14 }}>
                {t(`progress.skill.${best.skill}`)} · {durationLabel(best.duration)}
              </Text>
              <Text style={{ color: c.fg, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                {Math.round(best.watts)} W
              </Text>
            </View>
            <SkillsRadar
              size={112}
              labels={false}
              shapes={[{ bests: skills.recent, colour: colours.recent, weight: skills.weight }]}
            />
          </View>
        )}
      </Card>
    </Pressable>
  );
}
