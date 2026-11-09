/** Search (OS-508): words in the name or description, a sport, newest first; the same API as the PWA. */
import { FlashList } from '@shopify/flash-list';
import { searchQuery, SPORTS, type SearchParams } from '@zankup/core';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useApi } from '../../src/auth';
import { ActivityCard } from '../../src/Feed';
import { t } from '../../src/i18n';
import { useFormat } from '../../src/prefs';
import { useTheme } from '../../src/theme';
import { accent, onAccent, Empty, Muted, Screen, styles as ui } from '../../src/ui';

export default function SearchScreen() {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [sport, setSport] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const params = useMemo<SearchParams>(
    () => ({ ...(query ? { q: query } : {}), ...(sport ? { sport: [sport] } : {}) }),
    [query, sport],
  );
  const results = useInfiniteQuery(searchQuery(api, params, 30));
  const items = results.data?.pages.flatMap((p) => p.items) ?? [];
  const totals = results.data?.pages[0]?.totals;
  return (
    <Screen scroll={false}>
      <View style={{ padding: 16, gap: 10 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('search.placeholder')}
          placeholderTextColor={c.muted}
          accessibilityLabel={t('nav.search')}
          style={[ui.input, { color: c.fg, backgroundColor: c.surface, borderColor: c.line }]}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {[null, ...SPORTS].map((s) => {
            const on = s === sport;
            return (
              <Pressable
                key={s ?? 'all'}
                onPress={() => setSport(s)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: on ? 'transparent' : c.line,
                  backgroundColor: on ? accent(c) : c.surface,
                }}
              >
                <Text style={{ color: on ? onAccent(c) : c.fg }}>{s ? t(`sport.${s}`) : t('feed.all')}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {totals && <Muted>{t('mobile.results', { count: totals.count })}</Muted>}
      </View>
      <FlashList
        data={items}
        keyExtractor={(a) => String(a.id)}
        renderItem={({ item }) => <ActivityCard activity={item} format={format} />}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={results.isFetched ? <Empty>{t('search.none')}</Empty> : null}
        onEndReached={() =>
          results.hasNextPage && !results.isFetchingNextPage && void results.fetchNextPage()
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
    </Screen>
  );
}
