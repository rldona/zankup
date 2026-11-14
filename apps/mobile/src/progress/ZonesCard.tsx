/**
 * Training zones on Progress (as Strava's): the card says where most of the last month's time went
 * (HR, every sport) beside a bar per zone; app/zones.tsx has the zones in full. The zone colours, the
 * card's change badge and the zone rows are shared by both.
 */
import { zonesQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../auth';
import { Icon } from '../Icon';
import { t } from '../i18n';
import { CardSkeleton } from '../Skeleton';
import { useTheme, type Palette } from '../theme';
import { accent, Card, Muted } from '../ui';
import { isoDay } from './fitness';
import { changeText } from './raceTimes';
import { rangeOf } from './volume';
import { shareChange, topZone, zoneRange, type ZoneKind } from './zones';

/** The theme's five zone colours, spread over seven for power. */
export function zoneColours(c: Palette, count: number): string[] {
  const five = [c.zone1, c.zone2, c.zone3, c.zone4, c.zone5].map(String);
  return Array.from({ length: count }, (_, i) => five[Math.round((i * 4) / Math.max(1, count - 1))]);
}

/** A change in points of share: ▲ 4 % or ▼ 3 %. */
export function ShareBadge({ points }: { points: number }) {
  const c = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: c.surface2,
      }}
    >
      <Text style={{ color: c.muted, fontSize: 11 }}>{points >= 0 ? '▲' : '▼'}</Text>
      <Text style={{ color: c.fg, fontSize: 14, fontVariant: ['tabular-nums'] }}>{Math.abs(points)} %</Text>
    </View>
  );
}

export function ZonesCard() {
  const api = useApi();
  const c = useTheme();
  const { current } = rangeOf('1m', isoDay(new Date()));
  const zones = useQuery(zonesQuery(api, 'hr', current));
  if (zones.isPending) return <CardSkeleton lines={3} />;
  const seconds = zones.data?.seconds ?? [];
  const top = topZone(seconds);
  const change = top ? shareChange(seconds, zones.data?.previous ?? [], top.index) : null;
  const most = Math.max(1, ...seconds);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('progress.zones')}: ${top ? t('progress.zonesTop', { share: top.share, zone: top.index + 1 }) : t('progress.noZones')}`}
      onPress={() => router.push('/zones')}
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="monitor_heart" color={accent(c)} size={26} />
          <Text numberOfLines={1} style={{ flex: 1, color: c.fg, fontSize: 16, fontWeight: '700' }}>
            {t('progress.zones')}
          </Text>
          <Muted style={{ fontSize: 14 }}>{t('progress.lastMonth')}</Muted>
          <Icon name="chevron_right" color={c.muted} size={22} />
        </View>
        {!top ? (
          <Muted style={{ marginTop: 12 }}>{t('progress.noZones')}</Muted>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 8, gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: c.fg, fontSize: 14 }}>{t('progress.mostTime')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Text style={{ color: c.fg, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                  {t('progress.zonesTop', { share: top.share, zone: top.index + 1 })}
                </Text>
                {change != null && change !== 0 && <ShareBadge points={change} />}
              </View>
            </View>
            {/* A bar per zone, the highest on top: the one with the most time in its colour. */}
            <View style={{ width: 120, gap: 4 }}>
              {seconds
                .map((s, i) => ({ s, i }))
                .reverse()
                .map(({ s, i }) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ width: 18, color: c.muted, fontSize: 11 }}>
                      {i === top.index ? `Z${i + 1}` : ''}
                    </Text>
                    <View
                      style={{
                        height: 7,
                        borderRadius: 4,
                        width: `${Math.max(12, (s / most) * 100) * 0.8}%`,
                        backgroundColor:
                          i === top.index ? zoneColours(c, seconds.length)[i] : (c.surface2 as string),
                      }}
                    />
                  </View>
                ))}
            </View>
          </View>
        )}
      </Card>
    </Pressable>
  );
}

/** The zones in full, the highest on top: each one's time as a bar, the time and its range. */
export function ZoneRows({ kind, seconds, bounds }: { kind: ZoneKind; seconds: number[]; bounds: number[] }) {
  const c = useTheme();
  const colours = zoneColours(c, seconds.length);
  const most = Math.max(1, ...seconds);
  const unit = kind === 'hr' ? t('progress.bpm') : 'W';
  return (
    <View style={{ gap: 14 }}>
      {seconds
        .map((s, i) => ({ s, i }))
        .reverse()
        .map(({ s, i }) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ width: 24, color: c.fg, fontSize: 14, fontWeight: '800' }}>Z{i + 1}</Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View
                style={{
                  width: `${Math.max(2, (s / most) * 62)}%`,
                  minWidth: 8,
                  height: 22,
                  borderRadius: 6,
                  backgroundColor: colours[i],
                }}
              />
              <Text style={{ color: c.fg, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                {changeText(s)}
              </Text>
            </View>
            <Muted style={{ fontSize: 13, fontVariant: ['tabular-nums'] }}>
              {bounds.length ? `${zoneRange(bounds, i)} ${unit}` : ''}
            </Muted>
          </View>
        ))}
    </View>
  );
}
