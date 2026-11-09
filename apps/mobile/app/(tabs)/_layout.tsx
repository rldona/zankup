import { Tabs } from 'expo-router';

import { MATERIAL_ICONS } from '@zankup/core';

import { Icon, type IconName } from '../../src/Icon';
import { t } from '../../src/i18n';
import { useTheme } from '../../src/theme';

const TABS: { name: string; icon: IconName; label: Parameters<typeof t>[0] }[] = [
  { name: 'index', icon: 'list', label: 'nav.feed' },
  { name: 'stats', icon: 'bar_chart', label: 'nav.stats' },
  { name: 'search', icon: 'search', label: 'nav.search' },
  { name: 'sync', icon: 'sync', label: 'nav.sync' },
  { name: 'profile', icon: 'person', label: 'nav.you' },
];

/** The filled version for the tab you are on, when Material Symbols has one. */
const filled = (icon: IconName): IconName =>
  `${icon}-fill` in MATERIAL_ICONS ? (`${icon}-fill` as IconName) : icon;

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
            tabBarIcon: ({ color, focused }) => (
              <Icon name={focused ? filled(tab.icon) : tab.icon} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
