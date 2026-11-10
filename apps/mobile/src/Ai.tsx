/**
 * The AI assistant on the phone (phase 7): the summary of an activity (OS-703) and the switches in
 * Settings (OS-708). The Coach itself lives in the PWA; the phone opens it from the weekly report's
 * notification.
 */
import { activitySummaryQuery, aiStatusQuery, settingsQuery, type AiPrefs } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from './auth';
import { Icon } from './Icon';
import { t } from './i18n';
import { keys, readSync, storage } from './storage';
import { useTheme } from './theme';
import { Body, Button, Card, Heading, Muted, SwitchRow } from './ui';

export function SummaryCard({ activityId }: { activityId: number }) {
  const { api } = useAuth();
  const c = useTheme();
  const queryClient = useQueryClient();
  const status = useQuery({ ...aiStatusQuery(api), retry: false });
  const summary = useQuery(activitySummaryQuery(api, activityId));
  const write = useMutation({
    mutationFn: async () => {
      const { data } = await api.POST('/api/activities/{activity_id}/summary', {
        params: { path: { activity_id: activityId } },
      });
      if (!data) throw new Error('summary');
      return data;
    },
    onSuccess: (data) => queryClient.setQueryData(activitySummaryQuery(api, activityId).queryKey, data),
  });
  // Folded or open, remembered on this phone for every activity.
  const [folded, setFolded] = useState(() => readSync(keys.coachFolded) === '1');
  const fold = () => {
    const next = !folded;
    setFolded(next);
    void storage.setItem(keys.coachFolded, next ? '1' : '0');
  };
  const can = status.data?.available && status.data.enabled && status.data.summaries;
  const row = summary.data;
  if (!row && !can) return null;
  const wand = (
    <View
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: c.accentSoft,
      }}
    >
      <Icon name="wand_stars" color={String(c.accent)} size={20} />
    </View>
  );
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: !folded }}
        accessibilityLabel={`${t('summary.aiTitle')}, ${t(folded ? 'summary.show' : 'summary.hide')}`}
        onPress={fold}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        {wand}
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.fg, fontSize: 17, fontWeight: '700' }}>{t('summary.aiTitle')}</Text>
          <Text style={{ color: c.muted, fontSize: 13 }}>{t('summary.aiSubtitle')}</Text>
        </View>
        <Icon name={folded ? 'keyboard_arrow_down' : 'keyboard_arrow_up'} color={c.muted} size={26} />
      </Pressable>
      {folded ? null : row ? (
        <>
          <Body>{row.summary}</Body>
          {row.highlights.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {row.highlights.map((item) => (
                <Text
                  key={item}
                  style={{
                    color: c.fg,
                    fontSize: 13,
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                    borderRadius: 999,
                    backgroundColor: c.surface2,
                  }}
                >
                  {item}
                </Text>
              ))}
            </View>
          )}
        </>
      ) : (
        <>
          <Muted>{t('summary.pitch')}</Muted>
          <Button
            primary
            icon={<Icon name="wand_stars" color={String(c.accentFg)} size={20} />}
            onPress={() => write.mutate()}
            disabled={write.isPending}
          >
            {write.isPending ? t('summary.writing') : t('summary.write')}
          </Button>
        </>
      )}
      {write.isError && <Muted accessibilityRole="alert">{t('summary.failed')}</Muted>}
    </Card>
  );
}

export function AiCard() {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const status = useQuery({ ...aiStatusQuery(api), retry: false });
  const settings = useQuery(settingsQuery(api));
  const save = useMutation({
    mutationFn: async (ai: AiPrefs) => {
      const { data } = await api.PATCH('/api/settings', { body: { ai } });
      if (data) queryClient.setQueryData(settingsQuery(api).queryKey, data);
    },
  });
  const prefs = settings.data?.ai;
  const info = status.data;
  if (!info?.available || !prefs) return null;
  const set = (changes: Partial<AiPrefs>) => save.mutate({ ...prefs, ...changes });
  return (
    <Card>
      <Heading>{t('ai.title')}</Heading>
      <Muted>{t('ai.help', { model: info.model ?? '' })}</Muted>
      <SwitchRow label={t('ai.enabled')} value={prefs.enabled} onChange={(on) => set({ enabled: on })} />
      <SwitchRow
        label={t('ai.summaries')}
        value={prefs.summaries}
        disabled={!prefs.enabled}
        onChange={(on) => set({ summaries: on })}
      />
      <SwitchRow
        label={t('ai.weekly')}
        value={prefs.weekly}
        disabled={!prefs.enabled}
        onChange={(on) => set({ weekly: on })}
      />
      {info.budget?.exceeded && <Muted>{t('ai.budgetExceeded')}</Muted>}
    </Card>
  );
}
