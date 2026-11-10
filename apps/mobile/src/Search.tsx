/**
 * Search in Activities (OS-508, OS-919): a bar for words in the name, description or place, a filters
 * button beside it and a chip per sport, over the list. The filters are the useful ones of the PWA's
 * advanced search: period, distance, time, elevation, with a record, with a description, with a GPS
 * track, and the order. With nothing typed or chosen the list is the feed (offline, pull to refresh);
 * otherwise it is what the search finds, with a summary of every match, from the same API as the PWA.
 */
import { FlashList } from '@shopify/flash-list';
import { formatHoursMinutes, searchQuery, SPORTS, type SearchParams } from '@zankup/core';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useApi } from './auth';
import { ActivityCard, Feed } from './Feed';
import { Icon } from './Icon';
import { t } from './i18n';
import { Sheet } from './detail/Tools';
import { useFormat, useUnits } from './prefs';
import { FeedSkeleton } from './Skeleton';
import { useTheme } from './theme';
import { accent, Button, Choice, Empty, Field, Muted, onAccent, SwitchRow } from './ui';

export function ActivitiesSearch() {
  const c = useTheme();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [sport, setSport] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [open, setOpen] = useState(false);
  const active = activeFilters(filters);
  const searching = query !== '' || sport !== null || active > 0;
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('search.filters')}
            hitSlop={10}
            onPress={() => setOpen(true)}
          >
            <Icon name="tune" color={active ? c.accent : c.muted} size={22} />
          </Pressable>
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
      {searching ? <Results query={query} sport={sport} filters={filters} /> : <Feed />}
      {open && (
        <FiltersSheet
          value={filters}
          onClose={() => setOpen(false)}
          onApply={(next) => {
            setFilters(next);
            setOpen(false);
          }}
        />
      )}
    </View>
  );
}

type Sort = 'date' | 'distance' | 'duration' | 'elevation' | 'speed';
type Filters = {
  period: 'all' | 'year' | 'last12';
  dmin: string;
  dmax: string;
  tmin: string;
  tmax: string;
  amin: string;
  record: boolean;
  desc: boolean;
  gps: boolean;
  sort: Sort;
  order: 'desc' | 'asc';
};

const NO_FILTERS: Filters = {
  period: 'all',
  dmin: '',
  dmax: '',
  tmin: '',
  tmax: '',
  amin: '',
  record: false,
  desc: false,
  gps: false,
  sort: 'date',
  order: 'desc',
};

const SORTS: Sort[] = ['date', 'distance', 'duration', 'elevation', 'speed'];

const number = (text: string) => {
  const n = Number(text.replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) ? n : undefined;
};

/** How many filters are on (the order is not one), for the button's colour. */
function activeFilters(f: Filters): number {
  return [
    f.period !== 'all',
    f.dmin,
    f.dmax,
    f.tmin,
    f.tmax,
    f.amin,
    f.record,
    f.desc,
    f.gps,
    f.sort !== 'date' || f.order !== 'desc',
  ].filter(Boolean).length;
}

/** The filters as the API's, in metres, seconds and ISO instants (as the PWA's search). */
function filterParams(f: Filters, units: 'metric' | 'imperial', today: Date): SearchParams {
  const scale = units === 'imperial' ? 1609.344 : 1000;
  const km = (text: string) => (number(text) == null ? undefined : (number(text) as number) * scale);
  const min = (text: string) => (number(text) == null ? undefined : (number(text) as number) * 60);
  const from =
    f.period === 'year'
      ? new Date(today.getFullYear(), 0, 1)
      : f.period === 'last12'
        ? new Date(today.getFullYear() - 1, today.getMonth(), today.getDate())
        : null;
  const params: SearchParams = {
    from: from?.toISOString(),
    min_distance: km(f.dmin),
    max_distance: km(f.dmax),
    min_duration: min(f.tmin),
    max_duration: min(f.tmax),
    min_ascent: number(f.amin),
    with_record: f.record || undefined,
    with_description: f.desc || undefined,
    with_gps: f.gps || undefined,
    sort: f.sort === 'date' ? undefined : f.sort,
    order: f.order === 'desc' ? undefined : f.order,
  };
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as SearchParams;
}

function FiltersSheet({
  value,
  onClose,
  onApply,
}: {
  value: Filters;
  onClose: () => void;
  onApply: (filters: Filters) => void;
}) {
  const c = useTheme();
  const units = useUnits();
  const [f, setF] = useState(value);
  const set = <K extends keyof Filters>(key: K, v: Filters[K]) =>
    setF((current) => ({ ...current, [key]: v }));
  const unit = units === 'imperial' ? 'mi' : 'km';
  const pair = (label: string, low: keyof Filters, high: keyof Filters | null, suffix: string) => (
    <View style={{ gap: 10 }}>
      <Text style={{ color: c.fg, fontWeight: '600' }}>{`${label} (${suffix})`}</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Field
            label={t('search.min')}
            keyboardType="decimal-pad"
            value={String(f[low])}
            onChangeText={(v) => set(low, v as never)}
          />
        </View>
        {high && (
          <View style={{ flex: 1 }}>
            <Field
              label={t('search.max')}
              keyboardType="decimal-pad"
              value={String(f[high])}
              onChangeText={(v) => set(high, v as never)}
            />
          </View>
        )}
      </View>
    </View>
  );
  return (
    <Sheet
      title={t('search.filters')}
      onClose={onClose}
      footer={
        <>
          <Button primary onPress={() => onApply(f)}>
            {t('search.show')}
          </Button>
          <Button onPress={() => onApply(NO_FILTERS)}>{t('search.clear')}</Button>
        </>
      }
    >
      <View style={{ gap: 10 }}>
        <Text style={{ color: c.fg, fontWeight: '600' }}>{t('search.period')}</Text>
        <Choice
          label={t('search.period')}
          value={f.period}
          onChange={(v) => set('period', v)}
          options={(['all', 'year', 'last12'] as const).map((p) => ({
            value: p,
            label: t(`search.period.${p}`),
          }))}
        />
      </View>
      {pair(t('search.distance'), 'dmin', 'dmax', unit)}
      {pair(t('search.duration'), 'tmin', 'tmax', 'min')}
      {pair(t('search.minAscent'), 'amin', null, units === 'imperial' ? 'ft' : 'm')}
      <SwitchRow label={t('search.withRecord')} value={f.record} onChange={(v) => set('record', v)} />
      <SwitchRow label={t('search.withDescription')} value={f.desc} onChange={(v) => set('desc', v)} />
      <SwitchRow label={t('search.withGps')} value={f.gps} onChange={(v) => set('gps', v)} />
      <View style={{ gap: 10 }}>
        <Text style={{ color: c.fg, fontWeight: '600' }}>{t('search.sort')}</Text>
        <Choice
          label={t('search.sort')}
          value={f.sort}
          onChange={(v) => set('sort', v)}
          options={SORTS.map((s) => ({ value: s, label: t(`search.sort.${s}`) }))}
        />
        <Choice
          label={t('search.sort')}
          value={f.order}
          onChange={(v) => set('order', v)}
          options={[
            { value: 'desc', label: t('search.descending') },
            { value: 'asc', label: t('search.ascending') },
          ]}
        />
      </View>
    </Sheet>
  );
}

function Results({ query, sport, filters }: { query: string; sport: string | null; filters: Filters }) {
  const api = useApi();
  const format = useFormat();
  const units = useUnits();
  const [today] = useState(() => new Date());
  const params = useMemo<SearchParams>(
    () => ({
      ...(query ? { q: query } : {}),
      ...(sport ? { sport: [sport] } : {}),
      ...filterParams(filters, units, today),
    }),
    [query, sport, filters, units, today],
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
            {/* Every match, not only the page shown: as the PWA's search. */}
            <Muted>
              {t('search.summary', {
                count: totals.count,
                distance: format.distance(totals.distance_m),
                time: formatHoursMinutes(totals.moving_s),
                ascent: format.elevation(totals.ascent_m),
              })}
            </Muted>
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
