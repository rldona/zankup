/** The sport filter of Progress's screens, in a panel from the bottom. */
import { SPORTS } from '@zankup/core';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Icon } from '../Icon';
import { locale, t } from '../i18n';
import { asSport } from '../prefs';
import { useTheme } from '../theme';
import { accent } from '../ui';
import { sportIcon } from './VolumeCard';

/** "Filter by sport": every sport, or one, with a search over their names. */
export function SportSheet({
  sport,
  found,
  onPick,
}: {
  sport: string | null;
  found: string[];
  onPick: (sport: string | null) => void;
}) {
  const c = useTheme();
  const [query, setQuery] = useState('');
  const list = (found.length ? found : [...SPORTS]).filter((s) =>
    t(`sport.${asSport(s)}`)
      .toLocaleLowerCase(locale)
      .includes(query.trim().toLocaleLowerCase(locale)),
  );
  const row = (s: string | null, title: string, note?: string) => {
    const on = s === sport;
    return (
      <Pressable
        key={s ?? 'all'}
        accessibilityRole="radio"
        accessibilityState={{ checked: on }}
        onPress={() => onPick(s)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14 }}
      >
        <Icon name={sportIcon(s)} color={on ? accent(c) : c.fg} size={26} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: on ? accent(c) : c.fg, fontSize: 15 }}>{title}</Text>
          {note ? <Text style={{ color: on ? accent(c) : c.fg, fontSize: 13 }}>{note}</Text> : null}
        </View>
        {on && <Icon name="check" color={accent(c)} size={26} />}
      </Pressable>
    );
  };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}
    >
      <Text style={{ color: c.fg, fontSize: 17, fontWeight: '800', marginBottom: 12 }}>
        {t('progress.filterSport')}
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 16,
          borderRadius: 999,
          backgroundColor: c.surface2,
          marginBottom: 6,
        }}
      >
        <Icon name="search" color={c.muted} size={22} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('nav.search')}
          placeholderTextColor={c.muted}
          style={{ flex: 1, color: c.fg, fontSize: 15, paddingVertical: 12 }}
        />
      </View>
      {!query && row(null, t('progress.allSports'), t('progress.allSportsNote'))}
      {list.map((s) => row(s, t(`sport.${asSport(s)}`)))}
    </ScrollView>
  );
}
