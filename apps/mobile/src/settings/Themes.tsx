/**
 * The themes as the PWA shows them: a card per theme with a small picture drawn in that theme's own
 * colours (a side bar, a card with two lines of text, a dot of its accent), its name and, for some, a
 * note. "System" is half light, half dark. The chosen one is ringed in the current accent.
 */
import { themes, type MessageKey, type ThemeChoice, THEME_CHOICES } from '@zankup/core';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { t } from '../i18n';
import { useTheme } from '../theme';

const NOTES: Partial<Record<ThemeChoice, MessageKey>> = {
  system: 'theme.systemNote',
  oled: 'theme.oledNote',
  highContrast: 'theme.highContrastNote',
};

/** "System": light above the diagonal, dark below, as the PWA's gradient draws it. */
function SystemPreview() {
  const [width, setWidth] = useState(0);
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        height: 68,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: themes.dark.bg,
        borderWidth: 1,
        borderColor: themes.dark.line,
      }}
    >
      {width > 0 && (
        <View
          style={{
            width: 0,
            height: 0,
            borderTopWidth: 68,
            borderRightWidth: width,
            borderTopColor: themes.light.bg,
            borderRightColor: 'transparent',
          }}
        />
      )}
    </View>
  );
}

function Preview({ choice }: { choice: ThemeChoice }) {
  if (choice === 'system') return <SystemPreview />;
  const p = themes[choice];
  const border = choice === 'highContrast' ? 2 : 1;
  return (
    <View
      style={{
        height: 68,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: p.bg,
        borderWidth: border,
        borderColor: p.line,
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '22%',
          backgroundColor: p.surface,
          borderRightWidth: border,
          borderColor: p.line,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: '30%',
          right: '8%',
          top: 12,
          height: 40,
          borderRadius: 6,
          backgroundColor: p.surface,
          borderWidth: border,
          borderColor: p.line,
          padding: 7,
          gap: 5,
        }}
      >
        <View style={{ height: 5, width: '70%', borderRadius: 3, backgroundColor: p.fg, opacity: 0.75 }} />
        <View style={{ height: 5, width: '45%', borderRadius: 3, backgroundColor: p.muted, opacity: 0.6 }} />
      </View>
      <View
        style={{
          position: 'absolute',
          right: '12%',
          bottom: 20,
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: p.accent,
        }}
      />
    </View>
  );
}

export function ThemePicker({ value, onChange }: { value: ThemeChoice; onChange: (c: ThemeChoice) => void }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {THEME_CHOICES.map((choice) => {
        const on = choice === value;
        const note = NOTES[choice];
        return (
          <Pressable
            key={choice}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(`theme.${choice}`)}
            onPress={() => onChange(choice)}
            style={{
              width: '47.5%',
              gap: 6,
              padding: 8,
              borderRadius: 12,
              borderWidth: on ? 2 : 1,
              borderColor: on ? String(c.accent) : c.line,
              backgroundColor: c.surface,
            }}
          >
            <Preview choice={choice} />
            <Text style={{ color: c.fg, fontWeight: '600', fontSize: 13 }}>{t(`theme.${choice}`)}</Text>
            {note && <Text style={{ color: c.muted, fontSize: 12, marginTop: -4 }}>{t(note)}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}
