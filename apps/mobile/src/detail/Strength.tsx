/**
 * A strength workout on the phone (OS-518), as in the PWA (OS-225): sets grouped by exercise with
 * reps, weight, time and rest, the total volume, and the front/back body map drawn with Skia from the
 * same shapes as the PWA.
 */
import {
  BACK,
  BODY_SHAPES,
  BODY_SILHOUETTE,
  FRONT,
  formatDuration,
  groupSets,
  musclesWorked,
  type MessageKey,
  type Muscle,
  type StrengthSet,
} from '@zankup/core';
import { Canvas, Group, Path } from '@shopify/react-native-skia';
import { Text, View } from 'react-native';

import { locale, t } from '../i18n';
import { useTheme } from '../theme';
import { Card, Heading, Muted } from '../ui';

export function Strength({ sets }: { sets: StrengthSet[] }) {
  const c = useTheme();
  const groups = groupSets(sets);
  if (!groups.length) return null;
  const active = groups.reduce((n, g) => n + g.sets.length, 0);
  const reps = groups.reduce((n, g) => n + g.reps, 0);
  const volume = groups.reduce((n, g) => n + g.volume_kg, 0);
  const worked = musclesWorked(sets);
  const exercise = (category: string | null) => t(`exercise.${category ?? 'unknown'}` as MessageKey);
  const cell = (text: string, first = false) => (
    <Text
      style={{
        flex: first ? 0.6 : 1,
        color: c.fg,
        textAlign: first ? 'left' : 'right',
        fontVariant: ['tabular-nums'],
      }}
    >
      {text}
    </Text>
  );
  return (
    <>
      <Card>
        <Heading>{t('strength.sets')}</Heading>
        <Muted>
          {t('strength.summary', { sets: active, reps, volume: Math.round(volume).toLocaleString(locale) })}
        </Muted>
        {groups.map((group, g) => (
          <View key={g} style={{ gap: 2, marginTop: 6 }}>
            <Text style={{ color: c.fg, fontWeight: '700' }}>{exercise(group.category)}</Text>
            <View style={{ flexDirection: 'row' }}>
              {[
                t('strength.set'),
                t('strength.reps'),
                t('strength.weight'),
                t('strength.time'),
                t('strength.rest'),
              ].map((label, i) => (
                <Text
                  key={label}
                  style={{
                    flex: i === 0 ? 0.6 : 1,
                    color: c.muted,
                    fontSize: 12,
                    textAlign: i === 0 ? 'left' : 'right',
                  }}
                >
                  {label}
                </Text>
              ))}
            </View>
            {group.sets.map((set, i) => (
              <View key={i} style={{ flexDirection: 'row' }}>
                {cell(String(i + 1), true)}
                {cell(set.reps != null ? String(set.reps) : '—')}
                {cell(
                  set.weight_kg ? `${set.weight_kg.toLocaleString(locale)} kg` : t('strength.bodyweight'),
                )}
                {cell(formatDuration(set.duration_s))}
                {cell(set.rest_s != null ? formatDuration(set.rest_s) : '—')}
              </View>
            ))}
          </View>
        ))}
      </Card>
      <Card>
        <Heading>{t('strength.muscles')}</Heading>
        <BodyMap worked={worked} />
        <Muted>
          {worked.size === 0
            ? t('strength.noMuscles')
            : [...worked.keys()].map((m) => t(`muscle.${m}`)).join(' · ')}
        </Muted>
      </Card>
    </>
  );
}

const SIZE = { width: 120, height: 240 };

function BodyMap({ worked }: { worked: Map<Muscle, number> }) {
  const c = useTheme();
  const most = Math.max(1, ...worked.values());
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
      {(['front', 'back'] as const).map((side) => (
        <View
          key={side}
          accessible
          accessibilityLabel={`${t(side === 'front' ? 'strength.front' : 'strength.back')}: ${
            (side === 'front' ? FRONT : BACK)
              .filter((m) => worked.has(m))
              .map((m) => t(`muscle.${m}`))
              .join(', ') || '—'
          }`}
          style={{ alignItems: 'center', gap: 4 }}
        >
          <Canvas style={SIZE}>
            <Group transform={[{ scale: SIZE.width / 100 }]}>
              <Path path={BODY_SILHOUETTE} color={c.surface2} />
              {Object.entries(BODY_SHAPES[side]).flatMap(([muscle, paths]) =>
                paths.map((d, i) => {
                  const sets = worked.get(muscle as Muscle) ?? 0;
                  return (
                    <Path
                      key={`${muscle}-${i}`}
                      path={d}
                      color={sets ? c.strength : c.line}
                      opacity={sets ? 0.45 + 0.55 * (sets / most) : 1}
                    />
                  );
                }),
              )}
            </Group>
          </Canvas>
          <Muted>{t(side === 'front' ? 'strength.front' : 'strength.back')}</Muted>
        </View>
      ))}
    </View>
  );
}
