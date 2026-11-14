/**
 * A strength workout on the phone (OS-518), as in the PWA (OS-225): the totals in large figures, the
 * session's flow (each set in its exercise's shade, the rests between them), then each exercise with
 * its sets, reps drawn as a bar, weight, time and rest, and the front/back body map drawn with Skia
 * from the same shapes as the PWA. With `cover`, the body map is left out: it is already the cover.
 */
import {
  BACK,
  BODY_DETAIL,
  BODY_SHAPES,
  BODY_SILHOUETTE,
  FRONT,
  formatDuration,
  groupSets,
  mix,
  musclesWorked,
  strengthFlow,
  strengthTotals,
  type MessageKey,
  type Muscle,
  type StrengthSet,
} from '@zankup/core';
import { Canvas, Group, Path, RadialGradient, Skia, vec } from '@shopify/react-native-skia';
import { Text, View } from 'react-native';

import { locale, t } from '../i18n';
import { useTheme } from '../theme';
import { Card, CardTitle, Muted } from '../ui';

export function Strength({ sets, cover = false }: { sets: StrengthSet[]; cover?: boolean }) {
  const c = useTheme();
  const groups = groupSets(sets);
  if (!groups.length) return null;
  const totals = strengthTotals(sets);
  const flow = strengthFlow(sets);
  const worked = musclesWorked(sets);
  const most = Math.max(1, ...groups.flatMap((g) => g.sets.map((s) => s.reps ?? 0)));
  // Each exercise in its own shade of the strength colour, as on the PWA.
  const shades = [
    c.strength,
    mix(c.strength, c.fg, 0.45),
    mix(c.strength, c.surface2, 0.45),
    mix(c.strength, c.fg, 0.75),
  ];
  const shade = (group: number) => shades[group % shades.length] ?? c.strength;
  const exercise = (category: string | null) => t(`exercise.${category ?? 'unknown'}` as MessageKey);
  const kg = (value: number) => `${Math.round(value).toLocaleString(locale)} kg`;
  const figures: [string, string][] = [
    [t('strength.sets'), String(totals.sets)],
    [t('strength.reps'), String(totals.reps)],
    ...(totals.volume_kg > 0 ? ([[t('strength.volume'), kg(totals.volume_kg)]] as [string, string][]) : []),
    [t('strength.work'), formatDuration(totals.work_s)],
    ...(totals.rest_s > 0
      ? ([[t('strength.rest'), formatDuration(totals.rest_s)]] as [string, string][])
      : []),
  ];
  const head = (label: string, flex: number, align: 'left' | 'right' = 'right') => (
    <Text key={label} style={{ flex, color: c.muted, fontSize: 11, textAlign: align }}>
      {label}
    </Text>
  );
  const cell = (text: string, flex = 1) => (
    <Text style={{ flex, color: c.fg, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{text}</Text>
  );
  return (
    <>
      <Card>
        <CardTitle>{t('strength.sets')}</CardTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {figures.map(([label, value], i) => (
            <View
              key={label}
              style={{
                flexBasis: '30%',
                flexGrow: 1,
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderRadius: 12,
                backgroundColor: c.surface2,
              }}
            >
              <Text style={{ color: c.muted, fontSize: 12 }}>{label}</Text>
              <Text
                numberOfLines={1}
                style={{
                  color: i === 0 ? c.strength : c.fg,
                  fontSize: 20,
                  fontWeight: '700',
                  fontVariant: ['tabular-nums'],
                }}
              >
                {value}
              </Text>
            </View>
          ))}
        </View>
        {flow.length > 1 && (
          <View style={{ gap: 6, marginTop: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: 14 }}>
              {flow.map((segment, i) => (
                <View
                  key={i}
                  style={{
                    flexGrow: segment.share,
                    flexBasis: 0,
                    minWidth: 3,
                    height: segment.kind === 'rest' ? 4 : 14,
                    borderRadius: 3,
                    backgroundColor: segment.group != null ? shade(segment.group) : c.line,
                  }}
                />
              ))}
            </View>
            <Muted>
              {t('strength.flow')} · {formatDuration(totals.work_s + totals.rest_s)}
            </Muted>
          </View>
        )}
        {groups.map((group, g) => (
          <View
            key={g}
            style={{
              marginTop: 4,
              padding: 10,
              paddingLeft: 12,
              borderRadius: 12,
              borderLeftWidth: 4,
              borderLeftColor: shade(g),
              backgroundColor: c.surface2,
              gap: 4,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: shade(g) }} />
              <Text style={{ flex: 1, color: c.fg, fontWeight: '700', fontSize: 16 }}>
                {exercise(group.category)}
              </Text>
              <Muted>
                {t('strength.exerciseSummary', { sets: group.sets.length, reps: group.reps })}
                {group.volume_kg > 0 ? ` · ${kg(group.volume_kg)}` : ''}
              </Muted>
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {head(t('strength.set'), 0.5, 'left')}
              {head(t('strength.reps'), 1.6, 'left')}
              {head(t('strength.weight'), 1.1)}
              {head(t('strength.time'), 0.9)}
              {head(t('strength.rest'), 1)}
            </View>
            {group.sets.map((set, i) => (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingVertical: 5,
                  borderTopWidth: 1,
                  borderTopColor: c.line,
                }}
              >
                <View style={{ flex: 0.5 }}>
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: c.surface,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: c.fg, fontSize: 11, fontWeight: '600' }}>{i + 1}</Text>
                  </View>
                </View>
                <View style={{ flex: 1.6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ flex: 1 }}>
                    <View
                      style={{
                        width: `${Math.max(8, ((set.reps ?? 0) / most) * 100)}%`,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: shade(g),
                      }}
                    />
                  </View>
                  <Text
                    style={{
                      minWidth: 22,
                      color: c.fg,
                      fontWeight: '700',
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {set.reps ?? '—'}
                  </Text>
                </View>
                {cell(
                  set.weight_kg ? `${set.weight_kg.toLocaleString(locale)} kg` : t('strength.bodyweight'),
                  1.1,
                )}
                {cell(formatDuration(set.duration_s), 0.9)}
                <Text style={{ flex: 1, color: c.muted, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
                  {set.rest_s != null ? formatDuration(set.rest_s) : '—'}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </Card>
      {!cover && worked.size > 0 && (
        <Card>
          <CardTitle>{t('strength.muscles')}</CardTitle>
          <BodyMap worked={worked} />
          <Muted>{[...worked.keys()].map((m) => t(`muscle.${m}`)).join(' · ')}</Muted>
        </Card>
      )}
    </>
  );
}

const SIZE = { width: 120, height: 240 };

/** Where each muscle's glow is centred, and how far it reaches: its shape's bounds, worked out once. */
const glows = new Map<string, { x: number; y: number; r: number }>();
function glowOf(d: string) {
  let g = glows.get(d);
  if (!g) {
    const b = Skia.Path.MakeFromSVGString(d)?.getBounds();
    g = b
      ? { x: b.x + b.width / 2, y: b.y + b.height / 2, r: Math.max(b.width, b.height) * 0.6 }
      : { x: 50, y: 100, r: 10 };
    glows.set(d, g);
  }
  return g;
}

/**
 * One side of the figure, drawn 100 wide: the outline over the background, the muscles in grey, and
 * those worked glowing in the strength colour, brighter in their middle and stronger the more sets.
 */
function Side({
  side,
  worked,
  scale,
}: {
  side: 'front' | 'back';
  worked: Map<Muscle, number>;
  scale: number;
}) {
  const c = useTheme();
  const most = Math.max(1, ...worked.values());
  const rest = mix(c.muted, c.bg, 0.55);
  const core = mix(c.strength, '#ffd27a', 0.45);
  return (
    <Group transform={[{ scale }]}>
      <Path path={BODY_SILHOUETTE} color={c.bg} />
      <Path
        path={BODY_SILHOUETTE}
        style="stroke"
        strokeWidth={1.1}
        strokeJoin="round"
        color={mix(c.muted, c.fg, 0.3)}
      />
      {BODY_DETAIL[side].map((d, i) => (
        <Path key={`detail-${i}`} path={d} color={rest} />
      ))}
      {Object.entries(BODY_SHAPES[side]).flatMap(([muscle, paths]) =>
        paths.map((d, i) => {
          const sets = worked.get(muscle as Muscle) ?? 0;
          if (!sets) return <Path key={`${muscle}-${i}`} path={d} color={rest} />;
          const g = glowOf(d);
          return (
            <Path key={`${muscle}-${i}`} path={d} opacity={0.55 + 0.45 * (sets / most)}>
              <RadialGradient c={vec(g.x, g.y)} r={g.r} colors={[core, c.strength]} />
            </Path>
          );
        }),
      )}
    </Group>
  );
}

function BodyMap({ worked, size = SIZE }: { worked: Map<Muscle, number>; size?: typeof SIZE }) {
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
          <Canvas style={size}>
            <Side side={side} worked={worked} scale={size.width / 100} />
          </Canvas>
          <Muted>{t(side === 'front' ? 'strength.front' : 'strength.back')}</Muted>
        </View>
      ))}
    </View>
  );
}

/**
 * A strength workout's cover, where a route has its map: the body map large across the top of the
 * detail, under the see-through header (`top`), with the muscles worked named under it.
 */
export function MuscleCover({
  worked,
  top,
  height,
}: {
  worked: Map<Muscle, number>;
  top: number;
  height: number;
}) {
  const c = useTheme();
  // The figures fill what the header and the legend leave, two to one.
  const tall = Math.max(120, height - top - 64);
  return (
    <View
      accessibilityLabel={t('strength.muscles')}
      style={{
        height,
        paddingTop: top + 4,
        paddingBottom: 12,
        justifyContent: 'space-between',
        backgroundColor: c.surface,
      }}
    >
      <BodyMap worked={worked} size={{ width: tall / 2, height: tall }} />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingHorizontal: 16,
        }}
      >
        <View style={{ width: 24, height: 6, borderRadius: 3, backgroundColor: c.strength }} />
        <Text numberOfLines={1} style={{ flexShrink: 1, color: c.muted, fontSize: 13 }}>
          {[...worked.keys()].map((m) => t(`muscle.${m}`)).join(' · ')}
        </Text>
      </View>
    </View>
  );
}

/** Both sides small, on a feed card's tile in place of a route (88 × 64, as the route's). */
export function BodyThumb({ worked }: { worked: Map<Muscle, number> }) {
  const c = useTheme();
  const scale = 56 / 200;
  const width = 100 * scale;
  return (
    <View
      style={{
        width: 88,
        height: 64,
        borderRadius: 8,
        backgroundColor: c.surface2,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 2,
      }}
    >
      {(['front', 'back'] as const).map((side) => (
        <Canvas key={side} style={{ width, height: 56 }}>
          <Side side={side} worked={worked} scale={scale} />
        </Canvas>
      ))}
    </View>
  );
}
