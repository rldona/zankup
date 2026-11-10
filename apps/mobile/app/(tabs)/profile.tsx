/**
 * You (OS-508, OS-511, OS-523): who you are (editable), the way to the rest of the app (Stats, the
 * Coach when the server has a model, Gear, Import, Account, Settings), then this year's summary.
 * Estimates live in Stats; the account in Settings › Account.
 */
import { aiStatusQuery, meQuery, profileSummaryQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { useApi } from '../../src/auth';
import { Icon } from '../../src/Icon';
import { t } from '../../src/i18n';
import { EditProfile, Header, Summary } from '../../src/profile/Sections';
import { useTheme } from '../../src/theme';
import { Card, Loading, MenuRow, Screen } from '../../src/ui';

export default function ProfileScreen() {
  const api = useApi();
  const c = useTheme();
  const me = useQuery(meQuery(api));
  const summary = useQuery(profileSummaryQuery(api));
  const ai = useQuery({ ...aiStatusQuery(api), retry: false });
  const [editing, setEditing] = useState(false);
  if (!me.data) return <Loading />;
  return (
    <Screen>
      <Header me={me.data} summary={summary.data} onEdit={() => setEditing(true)} />
      {editing && <EditProfile me={me.data} onDone={() => setEditing(false)} />}
      <Card style={{ paddingVertical: 0, gap: 0 }}>
        <MenuRow
          icon={<Icon name="bar_chart" color={c.fg} />}
          label={t('nav.stats')}
          onPress={() => router.push('/stats')}
        />
        {ai.data?.available && (
          <MenuRow
            icon={<Icon name="wand_stars" color={c.fg} />}
            label={t('coach.title')}
            onPress={() => router.push('/coach')}
          />
        )}
        <MenuRow
          icon={<Icon name="footprint" color={c.fg} />}
          label={t('gear.title')}
          onPress={() => router.push('/gear')}
        />
        <MenuRow
          icon={<Icon name="upload" color={c.fg} />}
          label={t('import.title')}
          onPress={() => router.push('/import')}
        />
        <MenuRow
          icon={<Icon name="account_circle" color={c.fg} />}
          label={t('profile.tab.account')}
          onPress={() => router.push('/settings/account')}
        />
        <MenuRow
          icon={<Icon name="settings" color={c.fg} />}
          label={t('nav.settings')}
          onPress={() => router.push('/settings')}
          last
        />
      </Card>
      {summary.data ? <Summary me={me.data} summary={summary.data} /> : <Loading />}
    </Screen>
  );
}
