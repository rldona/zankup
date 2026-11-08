/**
 * The activity detail, the only screen of the proof of concept: map, numbers, and the profile with
 * the synced cursor and section selection.
 */
import { formatDuration, formatPace, type ApiClient, type ApiPaths } from '@zankup/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useColorScheme, useWindowDimensions, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { FpsMeter, logPerf, msSinceBundleStart } from './perf';
import { Profile } from './Profile';
import { RouteMap } from './RouteMap';
import { buildTrack, sectionStats, type SectionStats, type Track } from './track';

type Detail = ApiPaths['/api/activities/{activity_id}']['get']['responses'][200]['content']['application/json'];

const LIGHT = {
  bg: '#ffffff',
  text: '#16181d',
  muted: '#646a75',
  card: '#f3f4f6',
  route: '#fc4c02',
  section: '#2563eb',
  cursor: '#16181d',
  alt: '#6b7280',
  altFill: 'rgba(107,114,128,0.22)',
  hr: '#dc2626',
  band: 'rgba(37,99,235,0.16)',
};
const DARK = {
  ...LIGHT,
  bg: '#0e1013',
  text: '#eef0f3',
  muted: '#9aa1ad',
  card: '#1a1d22',
  cursor: '#eef0f3',
  alt: '#9aa1ad',
  altFill: 'rgba(154,161,173,0.22)',
  band: 'rgba(96,165,250,0.22)',
  section: '#60a5fa',
};

export function ActivityDetail({
  api,
  activityId,
  onOpenList,
}: {
  api: ApiClient;
  activityId: number;
  onOpenList: () => void;
}) {
  const dark = useColorScheme() === 'dark';
  const c = dark ? DARK : LIGHT;
  const { width } = useWindowDimensions();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursorIndex, setCursorIndex] = useState(-1);
  const [section, setSection] = useState<[number, number] | null>(null);
  const [stats, setStats] = useState<SectionStats | null>(null);
  const [selecting, setSelecting] = useState(false);
  const cursor = useSharedValue(-1);
  const selection = useSharedValue<[number, number] | null>(null);
  const reported = useRef(false);
  const mapReady = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t0 = Date.now();
      const [d, s] = await Promise.all([
        api.GET('/api/activities/{activity_id}', { params: { path: { activity_id: activityId } } }),
        api.GET('/api/activities/{activity_id}/streams', { params: { path: { activity_id: activityId } } }),
      ]);
      if (cancelled) return;
      if (!d.data) {
        setError('Could not load the activity');
        return;
      }
      const built = s.data ? buildTrack(s.data) : null;
      logPerf(`fetch detail+streams ${Date.now() - t0}ms samples=${built?.n ?? 0}`);
      setDetail(d.data);
      setTrack(built);
    })().catch((e: unknown) => setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [api, activityId]);

  const report = useCallback((what: string) => {
    if (what === 'map') mapReady.current = true;
    if (!reported.current && mapReady.current) {
      reported.current = true;
      logPerf(`detail ready ${msSinceBundleStart()}ms after bundle start`);
    }
  }, []);

  // The map cursor follows the finger through JS; coalesce to one update per frame.
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
      if (!track) return;
      if (final) {
        setSection(range);
        setStats(range ? sectionStats(track, range[0], range[1]) : null);
      }
    },
    [track],
  );

  const clearSection = () => {
    selection.value = null;
    setSection(null);
    setStats(null);
  };

  const mapColors = useMemo(() => ({ route: c.route, section: c.section, cursor: c.route }), [c]);

  if (error) return <Centered c={c}><Text style={{ color: c.text }}>{error}</Text></Centered>;
  if (!detail) return <Centered c={c}><ActivityIndicator color={c.route} /></Centered>;

  const pace = detail.distance_m && detail.moving_s ? detail.distance_m / detail.moving_s : null;
  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={styles.map}>
        {track?.hasGps ? (
          <RouteMap
            track={track}
            bbox={detail.bbox ?? null}
            cursor={cursorIndex}
            section={section}
            dark={dark}
            colors={mapColors}
            onReady={() => report('map')}
          />
        ) : (
          <Centered c={c} onLayout={() => report('map')}>
            <Text style={{ color: c.muted }}>No GPS track</Text>
          </Centered>
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
            {detail.name ?? detail.sport}
          </Text>
          <Pressable onPress={onOpenList} hitSlop={12}>
            <Text style={{ color: c.route, fontWeight: '600' }}>All</Text>
          </Pressable>
        </View>
        <Text style={{ color: c.muted }}>{new Date(detail.start_utc).toLocaleString()}</Text>
        <View style={styles.stats}>
          <Stat c={c} label="Distance" value={detail.distance_m ? `${(detail.distance_m / 1000).toFixed(2)} km` : '–'} />
          <Stat c={c} label="Moving time" value={formatDuration(detail.moving_s ?? detail.duration_s)} />
          <Stat c={c} label={detail.sport === 'run' ? 'Pace' : 'Avg HR'} value={detail.sport === 'run' && pace ? `${formatPace(pace, { units: 'metric' })} /km` : detail.avg_hr ? `${detail.avg_hr} bpm` : '–'} />
          <Stat c={c} label="Elevation" value={detail.ascent_m != null ? `${Math.round(detail.ascent_m)} m` : '–'} />
        </View>

        {track && track.n > 1 ? (
          <>
            <View style={styles.toolbar}>
              <Pressable
                onPress={() => setSelecting((v) => !v)}
                style={[styles.chip, { backgroundColor: selecting ? c.section : c.card }]}
              >
                <Text style={{ color: selecting ? '#fff' : c.text, fontWeight: '600' }}>
                  {selecting ? 'Selecting section' : 'Select section'}
                </Text>
              </Pressable>
              {section && (
                <Pressable onPress={clearSection} hitSlop={8}>
                  <Text style={{ color: c.muted }}>Clear</Text>
                </Pressable>
              )}
            </View>
            <Profile
              track={track}
              width={width - 32}
              height={150}
              cursor={cursor}
              selection={selection}
              selecting={selecting}
              onCursor={onCursor}
              onSelection={onSelection}
              colors={{ alt: c.alt, altFill: c.altFill, hr: c.hr, cursor: c.cursor, band: c.band, text: c.text }}
            />
            {stats && (
              <View style={[styles.section, { backgroundColor: c.card }]}>
                <Stat c={c} label="Section" value={`${(stats.distance / 1000).toFixed(2)} km`} />
                <Stat c={c} label="Time" value={formatDuration(stats.time)} />
                <Stat c={c} label="Pace" value={stats.distance > 0 ? `${formatPace(stats.distance / Math.max(stats.time, 1), { units: 'metric' })} /km` : '–'} />
                <Stat c={c} label="Gain" value={`${Math.round(stats.ascent)} m`} />
                <Stat c={c} label="Avg HR" value={stats.avgHr ? `${Math.round(stats.avgHr)}` : '–'} />
              </View>
            )}
          </>
        ) : (
          <Text style={{ color: c.muted, marginTop: 16 }}>This activity has no series.</Text>
        )}
        <FpsMeter color={c.muted} />
      </View>
    </View>
  );
}

function Stat({ c, label, value }: { c: typeof LIGHT; label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: c.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: c.muted }]}>{label}</Text>
    </View>
  );
}

function Centered({ c, children, onLayout }: { c: typeof LIGHT; children: React.ReactNode; onLayout?: () => void }) {
  return (
    <View onLayout={onLayout} style={[styles.centered, { backgroundColor: c.bg }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  map: { height: '42%' },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  title: { fontSize: 20, fontWeight: '700', flexShrink: 1 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 14 },
  stat: { minWidth: 60 },
  statValue: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 11, marginTop: 2 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 2 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  section: { flexDirection: 'row', justifyContent: 'space-between', padding: 12, borderRadius: 12, marginTop: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
