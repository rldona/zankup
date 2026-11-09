import { t } from '../i18n';
import type { SettingsSection } from '../links';

export function sectionTitle(section: SettingsSection): string {
  switch (section) {
    case 'general':
      return t('mobile.section.general');
    case 'heart':
      return t('mobile.section.heart');
    case 'notifications':
      return t('notifications.title');
    case 'ai':
      return t('mobile.section.ai');
    case 'privacy':
      return t('privacy.title');
    case 'health':
      return t('health.settings');
    case 'data':
      return t('data.title');
    case 'account':
      return t('mobile.section.account');
  }
}

const NOTES = {
  general: 'mobile.section.generalNote',
  heart: 'mobile.section.heartNote',
  notifications: 'mobile.section.notificationsNote',
  ai: 'mobile.section.aiNote',
  privacy: 'mobile.section.privacyNote',
  health: 'mobile.section.healthNote',
  data: 'mobile.section.dataNote',
  account: 'mobile.section.accountNote',
} as const;

export const sectionNote = (section: SettingsSection): string => t(NOTES[section]);
