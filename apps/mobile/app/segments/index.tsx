/** Your segments on the phone (OS-520), as in the PWA (OS-325). */
import { formatDuration, segmentsQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';

import { useApi } from '../../src/auth';
import { t } from '../../src/i18n';
import { useFormat } from '../../src/prefs';
import { Card, MenuRow, Muted, Screen } from '../../src/ui';

export default function SegmentsScreen() {
  const api = useApi();
  const format = useFormat();
  const segments = useQuery(segmentsQuery(api));
  const list = segments.data ?? [];
  return (
    <Screen header>
      {segments.data?.length === 0 && <Muted>{t('segments.empty')}</Muted>}
      {list.length > 0 && (
        <Card style={{ paddingVertical: 0, gap: 0 }}>
          {list.map((s, i) => (
            <MenuRow
              key={s.id}
              label={s.name}
              note={`${format.distance(s.distance_m)} · ${t('segments.efforts', { count: s.efforts })}${
                s.best_s != null ? ` · ${t('routes.best')} ${formatDuration(s.best_s)}` : ''
              }`}
              onPress={() => router.push(`/segments/${s.id}`)}
              last={i === list.length - 1}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}
