/**
 * Search in Activities (OS-508): a bar for words in the name, description or place, and a chip per
 * sport, over the list. With nothing typed and every sport, the list is the feed (offline, pull to
 * refresh); otherwise it is what the search finds, newest first, from the same API as the PWA.
 */
import { FlashList } from '@shopify/flash-list';
import { searchQuery, SPORTS, type SearchParams } from '@zankup/core';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useApi } from './auth';
import { ActivityCard, Feed } from './Feed';
import { Icon } from './Icon';
import { t } from './i18n';
import { useFormat } from './prefs';
import { FeedSkeleton } from './Skeleton';
import { useTheme } from './theme';
import { accent, onAccent, Empty, Muted } from './ui';

export function ActivitiesSearch() {
  const c = useTheme();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [sport, setSport] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const searching = query !== '' || sport !== null;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 10 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: c.line,
            backgroundColor: c.surface,
          }}
        >
          <Icon name="search" color={c.muted} size={20} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('search.placeholder')}
            placeholderTextColor={c.muted}
            accessibilityLabel={t('nav.search')}
            returnKeyType="search"
            style={{ flex: 1, color: c.fg, fontSize: 16, paddingVertical: 10 }}
          />
          {text !== '' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('search.clear')}
              hitSlop={10}
              onPress={() => setText('')}
            >
              <Icon name="close" color={c.muted} size={20} />
            </Pressable>
          )}
        </View>
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
      </View>
      {searching ? <Results query={query} sport={sport} /> : <Feed />}
    </View>
  );
}

function Results({ query, sport }: { query: string; sport: string | null }) {
  const api = useApi();
  const format = useFormat();
  const params = useMemo<SearchParams>(
    () => ({ ...(query ? { q: query } : {}), ...(sport ? { sport: [sport] } : {}) }),
    [query, sport],
  );
  const results = useInfiniteQuery(searchQuery(api, params, 30));
  const items = results.data?.pages.flatMap((p) => p.items) ?? [];
  const totals = results.data?.pages[0]?.totals;
  return (
    <FlashList
      data={items}
      keyExtractor={(a) => String(a.id)}
      renderItem={({ item }) => <ActivityCard activity={item} format={format} />}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      ListHeaderComponent={
        totals ? (
          <View style={{ paddingBottom: 10 }}>
            <Muted>{t('mobile.results', { count: totals.count })}</Muted>
          </View>
        ) : null
      }
      ListEmptyComponent={results.isFetched ? <Empty>{t('search.none')}</Empty> : <FeedSkeleton />}
      onEndReached={() => results.hasNextPage && !results.isFetchingNextPage && void results.fetchNextPage()}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
    />
  );
}
