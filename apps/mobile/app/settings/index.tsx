/**
 * Settings on the phone (OS-522): one row per section, as the PWA's page has them, and sign-out.
 * Each section opens its own screen.
 */
import { router } from 'expo-router';

import { useAuth } from '../../src/auth';
import { t } from '../../src/i18n';
import { Icon, type IconName } from '../../src/Icon';
import { SETTINGS_SECTIONS, type SettingsSection } from '../../src/links';
import { sectionNote, sectionTitle } from '../../src/settings/titles';
import { useTheme } from '../../src/theme';
import { Button, Card, MenuRow, Screen } from '../../src/ui';

const SECTION_ICONS: Record<SettingsSection, IconName> = {
  general: 'tune',
  heart: 'ecg_heart',
  notifications: 'notifications',
  ai: 'wand_stars',
  privacy: 'location_off',
  health: 'health_and_safety',
  data: 'database',
  account: 'lock',
};

export default function SettingsScreen() {
  const { signOut } = useAuth();
  const c = useTheme();
  return (
    <Screen header>
      <Card style={{ paddingVertical: 0, gap: 0 }}>
        {SETTINGS_SECTIONS.map((section, i) => (
          <MenuRow
            key={section}
            icon={<Icon name={SECTION_ICONS[section]} color={c.fg} />}
            label={sectionTitle(section)}
            note={sectionNote(section)}
            onPress={() => router.push(`/settings/${section}`)}
            last={i === SETTINGS_SECTIONS.length - 1}
          />
        ))}
      </Card>
      <Button onPress={() => void signOut()}>{t('nav.signOut')}</Button>
    </Screen>
  );
}
