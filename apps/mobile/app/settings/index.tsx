/**
 * Settings on the phone (OS-522): one row per section, as the PWA's page has them, and sign-out.
 * Each section opens its own screen.
 */
import { router } from 'expo-router';

import { useAuth } from '../../src/auth';
import { t } from '../../src/i18n';
import { SETTINGS_SECTIONS } from '../../src/links';
import { sectionNote, sectionTitle } from '../../src/settings/titles';
import { Button, Card, MenuRow, Screen } from '../../src/ui';

export default function SettingsScreen() {
  const { signOut } = useAuth();
  return (
    <Screen header>
      <Card style={{ paddingVertical: 0, gap: 0 }}>
        {SETTINGS_SECTIONS.map((section, i) => (
          <MenuRow
            key={section}
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
