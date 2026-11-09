/** One segment: its line, your efforts on it and deleting it (OS-520, OS-325). */
import { formatDuration, segmentQuery, segmentsQuery } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, Text } from 'react-native';

import { useApi } from '../../src/auth';
import { shortDay } from '../../src/estimates';
import { t } from '../../src/i18n';
import { useFormat } from '../../src/prefs';
import { useTheme } from '../../src/theme';
import { TrackMap } from '../../src/TrackMap';
import { Button, Card, Heading, Loading, Muted, Screen } from '../../src/ui';

export default function SegmentScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const queryClient = useQueryClient();
  const segment = useQuery({ ...segmentQuery(api, id), enabled: Number.isInteger(id) });
  const remove = useMutation({
    mutationFn: async () => {
      await api.DELETE('/api/segments/{segment_id}', { params: { path: { segment_id: id } } });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: segmentsQuery(api).queryKey });
      router.back();
    },
  });
  if (!segment.data) return <Loading />;
  const s = segment.data;
  const best = s.best_s;
  return (
    <Screen header>
      <Stack.Screen options={{ title: s.name }} />
      <Muted>
        {format.distance(s.distance_m)}
        {s.ascent_m != null && ` · +${format.elevation(s.ascent_m)}`} ·{' '}
        {t('segments.efforts', { count: s.efforts })}
      </Muted>
      <TrackMap tracks={[s.track]} precision={6} colour={String(c.accent)} height={260} />
      <Card>
        <Heading>{t('segments.history')}</Heading>
        {[...s.history].reverse().map((e) => (
          <Pressable
            key={e.activity_id}
            accessibilityRole="link"
            onPress={() => router.push(`/activity/${e.activity_id}`)}
            style={{ flexDirection: 'row', paddingVertical: 6, gap: 8 }}
          >
            <Text style={{ flex: 1.3, color: c.accent, fontWeight: '600' }}>{shortDay(e.day)}</Text>
            <Text style={{ flex: 1, color: c.fg, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
              {formatDuration(e.elapsed_s)}
            </Text>
            <Text style={{ flex: 1, color: c.muted, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
              {e.avg_hr ? `${e.avg_hr} bpm` : e.avg_power ? `${e.avg_power} W` : '—'}
            </Text>
            <Text style={{ flex: 0.9, color: c.muted, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
              {best != null && e.elapsed_s === best
                ? '🏆'
                : best != null
                  ? `+${formatDuration(e.elapsed_s - best)}`
                  : ''}
            </Text>
          </Pressable>
        ))}
      </Card>
      <Button
        disabled={remove.isPending}
        onPress={() =>
          Alert.alert(s.name, t('segments.delete'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('segments.delete'), style: 'destructive', onPress: () => remove.mutate() },
          ])
        }
      >
        {t('segments.delete')}
      </Button>
    </Screen>
  );
}
