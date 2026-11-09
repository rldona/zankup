/**
 * You (OS-508, OS-511): who you are, this year by sport, your gear and its mileage, and the way to the
 * rest of the app: Health, the Coach (when the server has a model), Gear, Import and Settings.
 */
import { aiStatusQuery, formatHoursMinutes, gearQuery, meQuery, profileSummaryQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { useApi } from '../../src/auth';
import { Icon } from '../../src/Icon';
import { t } from '../../src/i18n';
import { asSport, useFormat } from '../../src/prefs';
import { useTheme } from '../../src/theme';
import { Card, Heading, MenuRow, Muted, Screen, Title } from '../../src/ui';

export default function ProfileScreen() {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const me = useQuery(meQuery(api));
  const summary = useQuery(profileSummaryQuery(api));
  const gear = useQuery(gearQuery(api));
  const ai = useQuery({ ...aiStatusQuery(api), retry: false });
  return (
    <Screen>
      <Title>{me.data?.display_name ?? t('nav.you')}</Title>
      {me.data && <Muted>{me.data.email}</Muted>}
      <Card style={{ paddingVertical: 0, gap: 0 }}>
        <MenuRow
          icon={<Icon name="health" color={c.fg} />}
          label={t('nav.health')}
          onPress={() => router.push('/health')}
        />
        {ai.data?.available && (
          <MenuRow
            icon={<Icon name="coach" color={c.fg} />}
            label={t('nav.coach')}
            onPress={() => router.push('/coach')}
          />
        )}
        <MenuRow
          icon={<Icon name="gear" color={c.fg} />}
          label={t('gear.title')}
          onPress={() => router.push('/gear')}
        />
        <MenuRow
          icon={<Icon name="upload" color={c.fg} />}
          label={t('import.title')}
          onPress={() => router.push('/import')}
        />
        <MenuRow
          icon={<Icon name="settings" color={c.fg} />}
          label={t('nav.settings')}
          onPress={() => router.push('/settings')}
          last
        />
      </Card>
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
    </Screen>
  );
}
