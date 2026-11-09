/**
 * Activity detail (OS-504): the map with the route, the figures, the elevation and heart-rate profile
 * with a cursor that follows the finger (synced with the map, on the UI thread) and section selection,
 * then photos, splits and laps. Sharing creates the same expiring, privacy-trimmed link as the PWA.
 * The series come from the phone when kept (OS-505).
 */
import {
  activityQuery,
  formatActivityDate,
  formatDuration,
  localStart,
  usesPace,
  type ActivityDetail,
} from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Share, Text, useWindowDimensions, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { useApi } from '../../src/auth';
import { Profile } from '../../src/detail/Profile';
import { RouteMap } from '../../src/detail/RouteMap';
import { buildTrack, sectionStats, type SectionStats } from '../../src/detail/track';
import { locale, t } from '../../src/i18n';
import { streamsQuery } from '../../src/offline';
import { asSport, useFormat } from '../../src/prefs';
import { webOrigin } from '../../src/links';
import { accessToken, instanceUrl } from '../../src/session';
import { useTheme } from '../../src/theme';
import { accent, Button, Card, Empty, Heading, Loading, Muted, Stat, styles as ui } from '../../src/ui';

export default function ActivityScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const api = useApi();
  const activity = useQuery({ ...activityQuery(api, id), enabled: Number.isInteger(id) });
  if (activity.data) return <Detail activity={activity.data} />;
  if (activity.isError) return <Empty>{t('activity.notFound')}</Empty>;
  return <Loading />;
}

function Detail({ activity: a }: { activity: ActivityDetail }) {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const { width } = useWindowDimensions();
  const sport = asSport(a.sport);
  const pace = usesPace(sport);
  const streams = useQuery({ ...streamsQuery(api, a.id), enabled: a.streams != null });
  const track = useMemo(() => (streams.data ? buildTrack(streams.data) : null), [streams.data]);
  const [cursorIndex, setCursorIndex] = useState(-1);
  const [section, setSection] = useState<[number, number] | null>(null);
  const [stats, setStats] = useState<SectionStats | null>(null);
  const [selecting, setSelecting] = useState(false);
  const cursor = useSharedValue(-1);
  const selection = useSharedValue<[number, number] | null>(null);

  // The map cursor follows the finger through JS: one update per frame at most.
  const pending = useRef<number | null>(null);
  const onCursor = useCallback((i: number) => {
    if (pending.current == null) {
      requestAnimationFrame(() => {
        if (pending.current != null) setCursorIndex(pending.current);
        pending.current = null;
      });
    }
    pending.current = i;
  }, []);
  const onSelection = useCallback(
    (range: [number, number] | null, final: boolean) => {
      if (!track || !final) return;
      setSection(range);
      setStats(range ? sectionStats(track, range[0], range[1]) : null);
    },
    [track],
  );

  const moving = a.moving_s ?? a.duration_s;
  const figures: [string, string][] = [];
  if (a.distance_m) figures.push([t('feed.stat.distance'), format.distance(a.distance_m)]);
  figures.push([t('feed.stat.time'), formatDuration(moving)]);
  if (a.distance_m && moving)
    figures.push([
      t(pace ? 'feed.stat.pace' : 'feed.stat.speed'),
      format.speedFor(a.distance_m / moving, pace),
    ]);
  if (a.ascent_m) figures.push([t('feed.stat.ascent'), format.elevation(a.ascent_m)]);
  if (a.avg_hr) figures.push([t('feed.stat.hr'), `${a.avg_hr} bpm`]);
  if (a.avg_power) figures.push([t('activity.power'), `${a.avg_power} W`]);
  if (a.metrics?.trimp != null) figures.push([t('activity.effort'), String(Math.round(a.metrics.trimp))]);
  const kcal = a.calories ?? a.metrics?.calories;
  if (kcal) figures.push([t('activity.calories'), `${Math.round(kcal)} kcal`]);

  const share = async () => {
    const { data } = await api.POST('/api/activities/{activity_id}/shares', {
      params: { path: { activity_id: a.id } },
      body: { days: 7, show_map: true },
    });
    if (!data?.path) return;
    const web = webOrigin(instanceUrl() ?? '');
    await Share.share({ message: `${a.name ?? ''} ${web}${data.path}`.trim() });
  };

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      <Stack.Screen options={{ title: a.name ?? t(`sport.${sport}`) }} />
      {track?.hasGps && (
        <View style={{ height: 300 }}>
          <RouteMap
            track={track}
            bbox={a.bbox ?? null}
            cursor={cursorIndex}
            section={section}
            dark={c.scheme === 'dark'}
            colors={{ route: c[sport], section: String(c.accent), cursor: c[sport] }}
          />
        </View>
      )}
      <View style={ui.page}>
        <View>
          <Text style={{ color: c.fg, fontSize: 22, fontWeight: '700' }}>
            {a.name ?? t(`sport.${sport}`)}
          </Text>
          <Muted>
            {formatActivityDate(localStart(a.start_utc, a.timezone), locale)}
            {a.gear ? ` · ${a.gear.name}` : ''}
          </Muted>
        </View>
        <View style={ui.stats}>
          {figures.map(([label, value]) => (
            <Stat key={label} label={label} value={value} />
          ))}
        </View>
        {track && track.n > 1 && (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Heading>{t('activity.profile')}</Heading>
              <Pressable
                onPress={() => setSelecting((v) => !v)}
                accessibilityRole="switch"
                accessibilityState={{ checked: selecting }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: selecting ? accent(c) : c.surface2,
                }}
              >
                <Text style={{ color: selecting ? c.accentFg : c.fg, fontWeight: '600' }}>
                  {t('mobile.selectSection')}
                </Text>
              </Pressable>
            </View>
            <Profile
              track={track}
              width={width - 60}
              height={150}
              cursor={cursor}
              selection={selection}
              selecting={selecting}
              onCursor={onCursor}
              onSelection={onSelection}
              colors={{
                alt: c.muted,
                altFill: `${c.muted}33`,
                hr: c.zone5,
                cursor: c.fg,
                band: `${String(c.accent)}33`,
                text: c.fg,
              }}
            />
            {stats && (
              <View style={ui.stats}>
                <Stat label={t('feed.stat.distance')} value={format.distance(stats.distance)} />
                <Stat label={t('feed.stat.time')} value={formatDuration(stats.time)} />
                <Stat
                  label={t(pace ? 'feed.stat.pace' : 'feed.stat.speed')}
                  value={
                    stats.distance > 0 ? format.speedFor(stats.distance / Math.max(stats.time, 1), pace) : '–'
                  }
                />
                <Stat label={t('feed.stat.ascent')} value={format.elevation(stats.ascent)} />
              </View>
            )}
          </Card>
        )}
        <Photos activity={a} />
        {a.splits.length > 1 && (
          <Card>
            <Heading>{t('activity.splits')}</Heading>
            {a.splits.map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Muted>{i + 1}</Muted>
                <Text style={{ color: c.fg, fontVariant: ['tabular-nums'] }}>
                  {s.time_s ? format.speedFor(s.distance_m / s.time_s, pace) : '–'}
                </Text>
                <Muted>{s.avg_hr ? `${s.avg_hr} bpm` : ''}</Muted>
              </View>
            ))}
          </Card>
        )}
        {a.description ? (
          <Card>
            <Text style={{ color: c.fg }}>{a.description}</Text>
          </Card>
        ) : null}
        <Button onPress={() => void share()}>{t('activity.share')}</Button>
      </View>
    </ScrollView>
  );
}

function Photos({ activity }: { activity: ActivityDetail }) {
  const api = useApi();
  const base = instanceUrl();
  const token = accessToken(api);
  if (!activity.photo_list?.length || !base || !token) return null;
  return (
    <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
      {activity.photo_list.map((p) => (
        <Image
          key={p.id}
          accessibilityLabel={p.caption ?? t('photos.title')}
          source={{
            uri: `${base}/api/photos/${p.id}?thumb=true`,
            headers: { Authorization: `Bearer ${token}` },
          }}
          style={{ width: 140, height: 140, borderRadius: 12 }}
        />
      ))}
    </ScrollView>
  );
}
