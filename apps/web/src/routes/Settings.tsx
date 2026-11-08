import { THEME_CHOICES, themes, type MessageKey, type ThemeChoice } from '@zankup/core';
import type { CSSProperties } from 'react';

import { t } from '../i18n';
import { useSetTheme, useThemeChoice } from '../theme';

// The "System" preview is half light, half dark: the two themes the device can pick between.
const SPLIT = { '--light-bg': themes.light.bg, '--dark-bg': themes.dark.bg } as CSSProperties;

const NOTES: Partial<Record<ThemeChoice, MessageKey>> = {
  system: 'theme.systemNote',
  oled: 'theme.oledNote',
  highContrast: 'theme.highContrastNote',
};

/** Settings. For now the theme picker (OS-214); the rest arrives with OS-212. */
export function Settings() {
  const current = useThemeChoice();
  const setTheme = useSetTheme();

  return (
    <section className="page">
      <h1>{t('nav.settings')}</h1>
      <h2>{t('settings.appearance')}</h2>
      <p className="note">{t('settings.themeHelp')}</p>
      <div className="themes">
        {THEME_CHOICES.map((choice) => {
          const note = NOTES[choice];
          return (
            <button
              key={choice}
              type="button"
              className="theme"
              aria-pressed={current === choice}
              onClick={() => setTheme(choice)}
            >
              {/* Each preview carries its own data-theme, so it is drawn with that theme's variables. */}
              <span
                className="tprev"
                aria-hidden="true"
                data-theme={choice === 'system' ? undefined : choice}
                style={choice === 'system' ? SPLIT : undefined}
              >
                <i className="tbar" />
                <i className="tcard">
                  <b />
                  <b />
                </i>
                <i className="tdot" />
              </span>
              <span className="tname">{t(`theme.${choice}`)}</span>
              {note && <span className="note">{t(note)}</span>}
            </button>
          );
        })}
      </div>
      <p className="state">{t('soon.settings')}</p>
    </section>
  );
}
