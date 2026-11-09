/** You (OS-508): who you are, this year by sport, your gear and its mileage, and Settings. */
import { formatHoursMinutes, gearQuery, meQuery, profileSummaryQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { useApi } from '../../src/auth';
import { t } from '../../src/i18n';
import { asSport, useFormat } from '../../src/prefs';
import { useTheme } from '../../src/theme';
import { Button, Card, Heading, Muted, Screen, Title } from '../../src/ui';

export default function ProfileScreen() {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const me = useQuery(meQuery(api));
  const summary = useQuery(profileSummaryQuery(api));
  const gear = useQuery(gearQuery(api));
  return (
    <Screen>
      <Title>{me.data?.display_name ?? t('nav.you')}</Title>
      {me.data && <Muted>{me.data.email}</Muted>}
      {summary.data && summary.data.this_year.length > 0 && (
        <Card>
          <Heading>{String(summary.data.year)}</Heading>
          {summary.data.this_year.map((s) => (
            <View
              key={s.sport}
              style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}
            >
              <Text style={{ color: c.fg }}>
                {t(`sport.${asSport(s.sport)}`)} · {s.count}
              </Text>
              <Text style={{ color: c.fg, fontVariant: ['tabular-nums'] }}>
                {s.distance_m ? format.distance(s.distance_m) : formatHoursMinutes(s.moving_s)}
              </Text>
            </View>
          ))}
        </Card>
      )}
      {(gear.data ?? []).filter((g) => !g.retired).length > 0 && (
        <Card>
          <Heading>{t('gear.title')}</Heading>
          {gear.data
            ?.filter((g) => !g.retired)
            .map((g) => (
              <View key={g.id} style={{ gap: 4, paddingVertical: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: c.fg, fontWeight: '600' }}>{g.name}</Text>
                  <Text style={{ color: g.over_limit ? c.zone5 : c.fg, fontVariant: ['tabular-nums'] }}>
                    {format.distance(g.distance_m)}
                  </Text>
                </View>
                {g.limit_m ? (
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: c.line }}>
                    <View
                      style={{
                        height: 4,
                        borderRadius: 2,
                        width: `${Math.min(100, (g.distance_m / g.limit_m) * 100)}%`,
                        backgroundColor: g.over_limit ? c.zone5 : c.accent,
                      }}
                    />
                  </View>
                ) : null}
              </View>
            ))}
        </Card>
      )}
      <Button onPress={() => router.push('/settings')}>{t('nav.settings')}</Button>
    </Screen>
  );
}
