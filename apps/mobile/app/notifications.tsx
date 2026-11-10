/**
 * Notifications (OS-527): what the engine noticed lately, the same events that send a notification:
 * a new record, an estimate going up, a risky jump in load. Each opens its activity when it has one.
 */
import { eventsQuery, eventShown } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useApi } from '../src/auth';
import { Icon, type IconName } from '../src/Icon';
import { locale, t } from '../src/i18n';
import { useFormat } from '../src/prefs';
import { eventText } from '../src/stats/Sections';
import { useTheme } from '../src/theme';
import { Card, Loading, Muted, Screen } from '../src/ui';

const ICONS: Record<string, IconName> = { record: 'trophy', estimate_up: 'trending_up', ramp: 'warning' };

export default function NotificationsScreen() {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const events = useQuery(eventsQuery(api));
  if (events.isPending) return <Loading />;
  const list = (events.data ?? []).filter((e) => eventShown(e, format.unit));
  return (
    <Screen header>
      {list.length === 0 && <Muted>{t('notifications.empty')}</Muted>}
      {list.length > 0 && (
        <Card style={{ paddingVertical: 0, gap: 0 }}>
          {list.map((e, i) => {
            const activity = typeof e.payload.activity_id === 'number' ? e.payload.activity_id : null;
            return (
              <Pressable
                key={e.id}
                accessibilityRole={activity ? 'link' : 'text'}
                disabled={!activity}
                onPress={() => activity && router.push(`/activity/${activity}`)}
                style={{
                  flexDirection: 'row',
                  gap: 12,
                  paddingVertical: 14,
                  borderBottomWidth: i === list.length - 1 ? 0 : 1,
                  borderColor: c.line,
                }}
              >
                <Icon
                  name={ICONS[e.kind] ?? 'notifications'}
                  color={e.kind === 'ramp' ? c.zone5 : c.accent}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: c.fg, fontSize: 15 }}>{eventText(e, format)}</Text>
                  <Muted>
                    {new Date(e.created_at).toLocaleDateString(locale, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </Muted>
                </View>
              </Pressable>
            );
          })}
        </Card>
      )}
    </Screen>
  );
}
