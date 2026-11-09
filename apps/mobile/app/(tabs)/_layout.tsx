import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MATERIAL_ICONS } from '@zankup/core';

import { Icon, type IconName } from '../../src/Icon';
import { t } from '../../src/i18n';
import { useTheme } from '../../src/theme';

const TABS: { name: string; icon: IconName; label: Parameters<typeof t>[0] }[] = [
  { name: 'index', icon: 'home', label: 'nav.home' },
  { name: 'activities', icon: 'list', label: 'nav.feed' },
  { name: 'search', icon: 'search', label: 'nav.search' },
  { name: 'health', icon: 'favorite', label: 'nav.health' },
  { name: 'profile', icon: 'person', label: 'nav.you' },
];

/** The filled version for the tab you are on, when Material Symbols has one. */
const filled = (icon: IconName): IconName =>
  `${icon}-fill` in MATERIAL_ICONS ? (`${icon}-fill` as IconName) : icon;

export default function TabsLayout() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Taller than the default, with room above the icons and above the system's gesture bar.
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.line,
          height: 76 + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom + 16,
        },
        tabBarLabelStyle: { fontSize: 12, marginTop: 4 },
        tabBarIconStyle: { width: 28, height: 28 },
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
              <Icon name={focused ? filled(tab.icon) : tab.icon} color={color} size={28} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
