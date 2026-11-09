import { Tabs } from 'expo-router';

import { Icon, type IconName } from '../../src/Icon';
import { t } from '../../src/i18n';
import { useTheme } from '../../src/theme';

const TABS: { name: string; icon: IconName; label: Parameters<typeof t>[0] }[] = [
  { name: 'index', icon: 'feed', label: 'nav.feed' },
  { name: 'stats', icon: 'stats', label: 'nav.stats' },
  { name: 'search', icon: 'search', label: 'nav.search' },
  { name: 'profile', icon: 'profile', label: 'nav.you' },
];

export default function TabsLayout() {
  const c = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line },
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.muted,
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.label),
            tabBarIcon: ({ color }) => <Icon name={tab.icon} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
