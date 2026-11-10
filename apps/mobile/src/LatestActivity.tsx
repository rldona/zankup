/**
 * The latest activity, as a sheet from below when the app opens or a sync brings a new one (as Strava
 * does): it says a new activity arrived and lets you name it, describe it, choose its gear and add
 * photos right there; "Advanced editing" opens the activity. Each activity is shown once on this phone;
 * the first time the app runs it only remembers the newest, so older ones never pop up.
 */
import {
  activitiesQuery,
  activityQuery,
  formatDuration,
  gearQuery,
  type ActivitySummary,
} from '@zankup/core';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApi } from './auth';
import { Photos } from './detail/Tools';
import { t } from './i18n';
import { SportIcon } from './Icon';
import { asSport, useFormat } from './prefs';
import { TrackMap } from './TrackMap';
import { keys, readSync, storage } from './storage';
import { useTheme } from './theme';
import { Button, Choice, Field, KeyboardSpace, Muted, Stat, styles as ui, useFieldAboveKeyboard } from './ui';

/** Older than this, an activity is not news any more: it is only remembered, never shown. */
const FRESH_MS = 3 * 24 * 3600 * 1000;

/** The activity to show, if the newest one is new to this phone; remembers the first one silently. */
function useNewest(items: ActivitySummary[]): [ActivitySummary | null, () => void] {
  const newest = items[0] ?? null;
  const [seen, setSeen] = useState(() => readSync(keys.latestSeen));
  const [now] = useState(() => Date.now());
  useEffect(() => {
    if (newest && seen === null) {
      // First run on this phone: nothing is "new" yet.
      void storage.setItem(keys.latestSeen, String(newest.id));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeen(String(newest.id));
    }
  }, [newest, seen]);
  const fresh =
    newest !== null &&
    seen !== null &&
    seen !== String(newest.id) &&
    now - new Date(newest.start_utc).getTime() < FRESH_MS;
  const done = () => {
    if (!newest) return;
    void storage.setItem(keys.latestSeen, String(newest.id));
    setSeen(String(newest.id));
  };
  return [fresh ? newest : null, done];
}

export function LatestActivity() {
  const api = useApi();
  const feed = useInfiniteQuery(activitiesQuery(api));
  const items = feed.data?.pages[0]?.items ?? [];
  const [activity, done] = useNewest(items);
  if (!activity) return null;
  return <LatestSheet key={activity.id} activity={activity} onClose={done} />;
}

function LatestSheet({ activity: a, onClose }: { activity: ActivitySummary; onClose: () => void }) {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const insets = useSafeAreaInsets();
  const keyboard = useFieldAboveKeyboard();
  const queryClient = useQueryClient();
  const detail = useQuery(activityQuery(api, a.id));
  const gear = useQuery(gearQuery(api));
  const sport = asSport(a.sport);
  const [name, setName] = useState(a.name ?? '');
  const [description, setDescription] = useState<string | null>(null);
  const [gearId, setGearId] = useState<string | null>(null);
  const currentGear = String(detail.data?.gear?.id ?? 0);
  const currentDescription = detail.data?.description ?? '';

  const save = useMutation({
    mutationFn: async () => {
      const body: { name?: string; description?: string; gear_id?: number } = {};
      if (name.trim() && name.trim() !== (a.name ?? '')) body.name = name.trim();
      if (description !== null && description !== currentDescription) body.description = description;
      if (gearId !== null && gearId !== currentGear) body.gear_id = Number(gearId);
      if (Object.keys(body).length === 0) return;
      const { error } = await api.PATCH('/api/activities/{activity_id}', {
        params: { path: { activity_id: a.id } },
        body,
      });
      if (error) throw new Error('save');
      void queryClient.invalidateQueries({ queryKey: ['activity', a.id] });
      void queryClient.invalidateQueries({ queryKey: ['activities'] });
    },
    onSuccess: onClose,
  });

  // Dragging the top of the sheet down past a third of its way, or flicking it, closes it.
  // It rises on its own (the modal only fades, so the backdrop does not slide up with it).
  const drag = useSharedValue(900);
  useEffect(() => {
    drag.value = withTiming(0, { duration: 260 });
  }, [drag]);
  const dismiss = Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate((e) => {
      drag.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 900) {
        drag.value = withTiming(800, { duration: 180 }, () => scheduleOnRN(onClose));
      } else {
        drag.value = withSpring(0, { damping: 20 });
      }
    });
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }));
  // The backdrop lightens as the sheet goes down.
  const backdropStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - drag.value / 600) }));

  const choices = (gear.data ?? []).filter((g) => !g.retired);
  const time = formatDuration(a.moving_s ?? a.duration_s);
  const stats: [string, string][] = a.distance_m
    ? [
        [t('feed.stat.distance'), format.distance(a.distance_m)],
        [t('feed.stat.ascent'), format.elevation(a.ascent_m ?? 0)],
        [t('feed.stat.time'), time],
      ]
    : [
        [t('feed.stat.time'), time],
        ...(a.avg_hr ? ([[t('metric.hr'), `${Math.round(a.avg_hr)} bpm`]] as [string, string][]) : []),
      ];

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* A modal is its own window on Android: gestures need their own root inside it. */}
      <GestureHandlerRootView style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* The dimmed backdrop covers the whole screen, also behind the sheet's rounded corners. */}
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable
            accessibilityLabel={t('common.close')}
            onPress={onClose}
            style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
          />
        </Animated.View>
        <Animated.View
          style={[
            sheetStyle,
            {
              maxHeight: '88%',
              // The card colour and a thin edge, so the rounded top shows against the dimmed app.
              backgroundColor: c.surface,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              borderWidth: 1,
              borderBottomWidth: 0,
              borderColor: c.line,
              overflow: 'hidden',
              paddingBottom: insets.bottom,
            },
          ]}
        >
          <GestureDetector gesture={dismiss}>
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4, gap: 14 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: c.line }} />
              <Text
                accessibilityRole="header"
                style={{ color: c.fg, fontSize: 20, fontWeight: '700', textAlign: 'center' }}
              >
                {t('latest.title')}
              </Text>
            </View>
          </GestureDetector>
          <ScrollView {...keyboard} keyboardShouldPersistTaps="handled" contentContainerStyle={ui.page}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <SportIcon sport={sport} size={28} />
              <Muted>
                {t(`sport.${sport}`)} ·{' '}
                {new Date(a.start_utc).toLocaleString(undefined, {
                  weekday: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Muted>
            </View>
            <Field label={t('activity.name')} value={name} onChangeText={setName} maxLength={255} />
            <Field
              label={t('latest.description')}
              value={description ?? currentDescription}
              onChangeText={setDescription}
              multiline
              style={[
                ui.input,
                {
                  minHeight: 72,
                  textAlignVertical: 'top',
                  color: c.fg,
                  backgroundColor: c.surface,
                  borderColor: c.line,
                },
              ]}
            />
            <View style={{ flexDirection: 'row', gap: 24 }}>
              {stats.map(([label, value]) => (
                <Stat key={label} label={label} value={value} labelFirst />
              ))}
            </View>
            {detail.data && (
              <Photos
                activity={detail.data}
                editable
                beside={
                  a.route ? (
                    // The route on the map, as a picture: it does not move with the finger.
                    <View pointerEvents="none" style={{ flex: 1 }}>
                      <TrackMap tracks={[a.route]} colour={c[sport]} height={150} />
                    </View>
                  ) : null
                }
              />
            )}
            {choices.length > 0 && (
              <>
                <Text style={{ color: c.fg, fontWeight: '600' }}>{t('gear.title')}</Text>
                <Choice
                  label={t('gear.title')}
                  value={gearId ?? currentGear}
                  onChange={setGearId}
                  options={[
                    { value: '0', label: t('gear.none') },
                    ...choices.map((g) => ({ value: String(g.id), label: g.name })),
                  ]}
                />
              </>
            )}
            {save.isError && <Muted accessibilityRole="alert">{t('common.error')}</Muted>}
            <Button primary disabled={save.isPending} onPress={() => save.mutate()}>
              {t('latest.ok')}
            </Button>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onClose();
                router.push(`/activity/${a.id}`);
              }}
              hitSlop={8}
              style={{ alignSelf: 'center', paddingVertical: 6 }}
            >
              <Text style={{ color: c.accent, fontWeight: '600', fontSize: 15 }}>{t('latest.advanced')}</Text>
            </Pressable>
          </ScrollView>
          <KeyboardSpace />
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}
