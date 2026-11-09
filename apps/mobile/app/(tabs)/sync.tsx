/** The Sync tab (OS-511): sync now, load the whole history, what the current run is doing and the latest runs. */
import type { SyncRun } from '@zankup/core';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Text, View } from 'react-native';

import { locale, t } from '../../src/i18n';
import { active, useSync } from '../../src/sync';
import { useTheme } from '../../src/theme';
import { Badge, Body, Button, Card, Heading, Muted, ProgressBar, Screen } from '../../src/ui';

export default function SyncScreen() {
  const { runs, latest, running, start, refetch } = useSync();
  const c = useTheme();
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  return (
    <Screen title={t('sync.title')}>
      <Muted>{t('sync.auto')}</Muted>
      <Button primary onPress={() => start.mutate(false)} disabled={running || start.isPending}>
        {t('sync.now')}
      </Button>
      {start.isError && <Muted accessibilityRole="alert">{start.error.message}</Muted>}
      {latest && (
        <Card>
          <Progress run={latest} />
        </Card>
      )}

      <Heading>{t('sync.history')}</Heading>
      <Muted>{t('sync.historyHelp')}</Muted>
      <Button onPress={() => start.mutate(true)} disabled={running || start.isPending}>
        {t('sync.historyStart')}
      </Button>

      {runs.length > 0 && (
        <>
          <Heading>{t('sync.recent')}</Heading>
          <Card>
            {runs.map((run) => (
              <View
                key={run.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.fg, fontWeight: '600' }}>{t(`sync.trigger.${run.trigger}`)}</Text>
                  <Muted>
                    {new Date(run.started_at).toLocaleString(locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {run.status === 'success' && ` · ${t('sync.success', { count: run.new_count })}`}
                    {run.error && ` · ${run.error}`}
                  </Muted>
                </View>
                <Badge tone={run.status === 'success' ? 'good' : run.status === 'error' ? 'bad' : undefined}>
                  {t(`sync.status.${run.status}`)}
                </Badge>
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

/** What a run is doing or how it ended, and its numbers. */
function Progress({ run }: { run: SyncRun }) {
  const p = run.progress;
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: 6 }}>
      <Body>
        {run.status === 'queued' && t('sync.queued')}
        {run.status === 'running' && t('sync.running')}
        {run.status === 'success' && t('sync.success', { count: run.new_count })}
        {run.status === 'error' && t('sync.error', { error: run.error ?? '' })}
      </Body>
      {active(run) && p.windows != null && p.windows > 1 && p.window != null && (
        <>
          <ProgressBar value={p.window} max={p.windows} label={t('sync.title')} />
          <Muted>{t('sync.window', { window: p.window, windows: p.windows })}</Muted>
        </>
      )}
      {p.listed != null && (
        <Muted>
          {t('sync.counts', { listed: p.listed, new: p.new ?? 0, downloaded: p.downloaded ?? 0 })}
        </Muted>
      )}
      {run.pending_imports > 0 && <Muted>{t('sync.pending', { count: run.pending_imports })}</Muted>}
      {!!p.no_fit && <Muted>{t('sync.noFit', { count: p.no_fit })}</Muted>}
    </View>
  );
}
