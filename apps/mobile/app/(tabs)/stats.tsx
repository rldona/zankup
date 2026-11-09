/**
 * Stats (OS-508): today's form, last night's sleep and readiness (OS-606), the last 28 days against the same span a year before, the estimates
 * and predictions, and the records. All read from what the engine precomputed.
 */
import {
  estimatesQuery,
  fitnessQuery,
  formatDuration,
  formatHoursMinutes,
  healthDaysQuery,
  recordsQuery,
  summaryQuery,
} from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../../src/auth';
import { effortName, ESTIMATE_ORDER, estimateName, estimateValue, RACES } from '../../src/estimates';
import { t } from '../../src/i18n';
import { useFormat } from '../../src/prefs';
import { useTheme } from '../../src/theme';
import { Card, Heading, Muted, Screen, Stat, styles as ui, Title } from '../../src/ui';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function StatsScreen() {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const now = new Date();
  const period = {
    from: iso(new Date(now.getTime() - 28 * 86_400_000)),
    to: iso(new Date(now.getTime() + 86_400_000)),
  };
  const fitness = useQuery(fitnessQuery(api, { from: iso(new Date(now.getTime() - 3 * 86_400_000)) }));
  const summary = useQuery(summaryQuery(api, period));
  const estimates = useQuery(estimatesQuery(api));
  const records = useQuery(recordsQuery(api, period));
  const health = useQuery(healthDaysQuery(api, iso(new Date(now.getTime() - 3 * 86_400_000)), period.to));
  const today = health.data?.at(-1);
  const night = [...(health.data ?? [])].reverse().find((d) => d.sleep)?.sleep;
  const form = fitness.data?.at(-1);
  const current = summary.data?.current;
  const previous = summary.data?.previous;
  const change = (a: number, b: number) =>
    b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)} %` : '';
  const byKind = new Map((estimates.data ?? []).map((e) => [e.kind, e]));
  return (
    <Screen>
      <Title>{t('nav.stats')}</Title>
      {form && (
        <Card>
          <Heading>{t('stats.now')}</Heading>
          <View style={ui.stats}>
            <Stat label={t('stats.ctl')} value={form.ctl.toFixed(0)} />
            <Stat label={t('stats.atl')} value={form.atl.toFixed(0)} />
            <Stat label={t('stats.tsb')} value={`${form.tsb > 0 ? '+' : ''}${form.tsb.toFixed(0)}`} />
          </View>
        </Card>
      )}
      {(night || today?.readiness) && (
        <Pressable accessibilityRole="button" onPress={() => router.push('/health')}>
          <Card>
            <Heading>{t('nav.health')} ›</Heading>
            <View style={ui.stats}>
              {today?.readiness && (
                <Stat label={t('health.readiness')} value={String(today.readiness.score)} />
              )}
              {night && <Stat label={t('health.score')} value={String(night.score ?? '–')} />}
              {night?.asleep_s != null && (
                <Stat label={t('health.asleep')} value={formatHoursMinutes(night.asleep_s)} />
              )}
              {today?.hrv && <Stat label={t('health.hrv')} value={`${today.hrv.value.toFixed(0)} ms`} />}
              {today?.resting_hr && (
                <Stat label={t('health.restingHr')} value={`${today.resting_hr.value.toFixed(0)} bpm`} />
              )}
            </View>
          </Card>
        </Pressable>
      )}
      {current && (
        <Card>
          <Heading>{t('mobile.last28')}</Heading>
          <View style={ui.stats}>
            <Stat label={t('feed.title')} value={String(current.count)} />
            <Stat label={t('feed.stat.distance')} value={format.distance(current.distance_m)} />
            <Stat label={t('feed.stat.time')} value={formatHoursMinutes(current.moving_s)} />
            <Stat label={t('feed.stat.ascent')} value={format.elevation(current.ascent_m)} />
          </View>
          {previous && previous.distance_m > 0 && (
            <Muted>
              {t('mobile.vsLastYear', { change: change(current.distance_m, previous.distance_m) })}
            </Muted>
          )}
        </Card>
      )}
      {byKind.size > 0 && (
        <Card>
          <Heading>{t('stats.estimates')}</Heading>
          {[...ESTIMATE_ORDER, ...RACES].map((kind) => {
            const e = byKind.get(kind);
            if (!e) return null;
            return (
              <View
                key={kind}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}
              >
                <Text style={{ color: c.fg }}>{estimateName(kind)}</Text>
                <Text style={{ color: c.fg, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                  {estimateValue(kind, e.value, format)}
                </Text>
              </View>
            );
          })}
        </Card>
      )}
      {(records.data?.all_time.length ?? 0) > 0 && (
        <Card>
          <Heading>{t('stats.records')}</Heading>
          {records.data?.all_time.map((r) => (
            <Pressable
              key={r.distance_key}
              accessibilityRole="link"
              onPress={() => router.push(`/activity/${r.activity_id}`)}
              style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}
            >
              <Text style={{ color: c.fg }}>{effortName(r.distance_key)}</Text>
              <Text style={{ color: c.accent, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                {formatDuration(r.time_s)}
              </Text>
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}
