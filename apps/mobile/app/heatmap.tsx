/** The personal heatmap on the phone (OS-520), as in the PWA (OS-310): every route with GPS. */
import { heatmapQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useApi } from '../src/auth';
import { t } from '../src/i18n';
import { useTheme } from '../src/theme';
import { TrackMap } from '../src/TrackMap';
import { Choice, Loading, Muted, Screen } from '../src/ui';

export default function HeatmapScreen() {
  const api = useApi();
  const c = useTheme();
  const [sport, setSport] = useState('');
  const routes = useQuery(heatmapQuery(api, {}, sport ? [sport] : undefined));
  return (
    <Screen header>
      <Choice
        label={t('feed.sports')}
        value={sport}
        onChange={setSport}
        options={[
          { value: '', label: t('feed.all') },
          ...(['run', 'ride', 'walk'] as const).map((s) => ({ value: s, label: t(`sport.${s}`) })),
        ]}
      />
      <Muted>
        {t('heatmap.note')} {routes.data && t('heatmap.count', { count: routes.data.routes.length })}
      </Muted>
      {routes.isPending && <Loading />}
      {routes.data && routes.data.routes.length > 0 && (
        <TrackMap key={sport} tracks={routes.data.routes} colour={c.run} heat height={520} />
      )}
    </Screen>
  );
}
