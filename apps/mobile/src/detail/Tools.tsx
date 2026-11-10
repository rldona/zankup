/**
 * What the PWA's detail lets you do, on the phone (OS-516, OS-517): gear and weather under the title,
 * editing the activity, adding and removing photos, replaying it, and saving the selected section as
 * a segment.
 */
import { gearQuery, SPORTS, type ActivityDetail, type Sport } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { Children, Fragment, isValidElement, useEffect, useRef, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApi } from '../auth';
import { Icon } from '../Icon';
import { t } from '../i18n';
import { accessToken, instanceUrl } from '../session';
import { useTheme } from '../theme';
import { Button, Choice, Field, Heading, KeyboardSpace, Muted, styles as ui } from '../ui';
import { indexAt } from './track';

function useRefreshActivity(id: number) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['activity', id] });
    void queryClient.invalidateQueries({ queryKey: ['activities'] });
  };
}

/** Gear and weather, as under the PWA's title. */
export function metaLine(activity: ActivityDetail, units: 'metric' | 'imperial'): string {
  const parts: string[] = [];
  const w = activity.weather;
  if (w) {
    const bits = [
      w.condition,
      w.temperature != null
        ? `${Math.round(units === 'imperial' ? w.temperature * 1.8 + 32 : w.temperature)}°`
        : null,
      w.wind_speed != null ? `${t('activity.wind')} ${Math.round(w.wind_speed * 3.6)} km/h` : null,
    ].filter(Boolean);
    if (bits.length) parts.push(bits.join(', '));
  }
  return parts.join(' · ');
}

/** A full-screen sheet with a title and a close button. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** The sheet's main actions (Save, Cancel), fixed at the bottom while the content scrolls. */
  footer?: React.ReactNode;
}) {
  const c = useTheme();
  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 }}>
          <Text style={{ color: c.fg, fontSize: 20, fontWeight: '700', flex: 1 }}>{title}</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
            <Text style={{ color: c.accent, fontSize: 16, fontWeight: '600' }}>{t('common.close')}</Text>
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.page}>
          {children}
        </ScrollView>
        {footer ? (
          <View
            style={{
              flexDirection: 'row',
              padding: 16,
              gap: 12,
              borderTopWidth: 1,
              borderColor: c.line,
              backgroundColor: c.bg,
            }}
          >
            {Children.toArray(
              isValidElement<{ children?: React.ReactNode }>(footer) && footer.type === Fragment
                ? footer.props.children
                : footer,
            ).map((child, i) => (
              <View key={i} style={{ flex: 1 }}>
                {child}
              </View>
            ))}
          </View>
        ) : null}
        <KeyboardSpace />
      </SafeAreaView>
    </Modal>
  );
}

export function EditActivity({ activity, onClose }: { activity: ActivityDetail; onClose: () => void }) {
  const api = useApi();
  const c = useTheme();
  const gear = useQuery(gearQuery(api));
  const refresh = useRefreshActivity(activity.id);
  const [name, setName] = useState(activity.name ?? '');
  const [description, setDescription] = useState(activity.description ?? '');
  const [sport, setSport] = useState(activity.sport as Sport);
  const [gearId, setGearId] = useState(String(activity.gear?.id ?? 0));
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH('/api/activities/{activity_id}', {
        params: { path: { activity_id: activity.id } },
        body: { name, description, sport, gear_id: Number(gearId) },
      });
      if (error) throw new Error('save');
    },
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const choices = (gear.data ?? []).filter((g) => !g.retired || g.id === activity.gear?.id);
  return (
    <Sheet
      title={t('activity.edit')}
      onClose={onClose}
      footer={
        <>
          <Button primary disabled={save.isPending} onPress={() => save.mutate()}>
            {t('settings.save')}
          </Button>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
        </>
      }
    >
      <Field label={t('activity.name')} value={name} onChangeText={setName} maxLength={255} />
      <Field
        label={t('activity.description')}
        value={description}
        onChangeText={setDescription}
        multiline
        style={[
          ui.input,
          {
            minHeight: 96,
            textAlignVertical: 'top',
            color: c.fg,
            backgroundColor: c.surface,
            borderColor: c.line,
          },
        ]}
      />
      <Text style={{ color: c.fg, fontWeight: '600' }}>{t('activity.sport')}</Text>
      <Choice
        label={t('activity.sport')}
        value={sport}
        onChange={setSport}
        options={SPORTS.map((s) => ({ value: s, label: t(`sport.${s}`) }))}
      />
      <Text style={{ color: c.fg, fontWeight: '600' }}>{t('gear.title')}</Text>
      <Choice
        label={t('gear.title')}
        value={gearId}
        onChange={setGearId}
        options={[
          { value: '0', label: t('gear.none') },
          ...choices.map((g) => ({ value: String(g.id), label: g.name })),
        ]}
      />
      <Text style={{ color: c.fg, fontWeight: '600' }}>{t('photos.title')}</Text>
      <Photos activity={activity} editable />
      <Muted>{t('activity.editNote')}</Muted>
      {save.isError && <Muted accessibilityRole="alert">{t('common.error')}</Muted>}
    </Sheet>
  );
}

/**
 * The activity's photos, each opening full size. Editing the activity (`editable`) adds new ones from
 * the phone and removes them.
 */
export function Photos({ activity, editable = false }: { activity: ActivityDetail; editable?: boolean }) {
  const api = useApi();
  const c = useTheme();
  const refresh = useRefreshActivity(activity.id);
  const [open, setOpen] = useState<number | null>(null);
  const base = instanceUrl();
  const token = accessToken(api);
  const add = useMutation({
    mutationFn: async (assets: DocumentPicker.DocumentPickerAsset[]) => {
      for (const asset of assets) {
        const bytes = await new File(asset.uri).bytes();
        const send = () =>
          fetch(`${base ?? ''}/api/activities/${activity.id}/photos`, {
            method: 'POST',
            body: bytes,
            headers: {
              'Content-Type': asset.mimeType ?? 'image/jpeg',
              Authorization: `Bearer ${accessToken(api)}`,
            },
          });
        let response = await send();
        if (response.status === 401) {
          await api.GET('/api/auth/me'); // refreshes an expired access token
          response = await send();
        }
        if (!response.ok) throw new Error(String(response.status));
      }
    },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/api/photos/{photo_id}', { params: { path: { photo_id: id } } });
    },
    onSuccess: () => {
      setOpen(null);
      refresh();
    },
  });
  const choose = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'image/*',
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets.length) add.mutate(result.assets);
  };
  const photos = activity.photo_list ?? [];
  const source = (id: number, thumb: boolean) => ({
    uri: `${base}/api/photos/${id}${thumb ? '?thumb=true' : ''}`,
    headers: { Authorization: `Bearer ${token}` },
  });
  const current = photos.find((p) => p.id === open);
  return (
    <>
      {photos.length > 0 && base && token && (
        <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
          {photos.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="imagebutton"
              accessibilityLabel={p.caption ?? t('photos.open')}
              onPress={() => setOpen(p.id)}
            >
              <Image source={source(p.id, true)} style={{ width: 140, height: 140, borderRadius: 12 }} />
            </Pressable>
          ))}
        </ScrollView>
      )}
      {editable && (
        <Button
          icon={<Icon name="photo_camera" color={c.fg} size={20} />}
          disabled={add.isPending}
          onPress={() => void choose()}
        >
          {add.isPending ? t('photos.uploading') : t('photos.add')}
        </Button>
      )}
      {add.isError && <Muted accessibilityRole="alert">{t('photos.error')}</Muted>}
      {current && (
        <Sheet title={current.caption ?? t('photos.title')} onClose={() => setOpen(null)}>
          <Image
            source={source(current.id, false)}
            resizeMode="contain"
            style={{
              width: '100%',
              aspectRatio: current.width && current.height ? current.width / current.height : 1,
            }}
          />
          {editable && (
            <Button
              disabled={remove.isPending}
              onPress={() =>
                Alert.alert(t('photos.remove'), '', [
                  { text: t('common.cancel'), style: 'cancel' },
                  {
                    text: t('photos.remove'),
                    style: 'destructive',
                    onPress: () => remove.mutate(current.id),
                  },
                ])
              }
            >
              {t('photos.remove')}
            </Button>
          )}
        </Sheet>
      )}
    </>
  );
}

export const SPEEDS = [10, 30, 100] as const;
export type ReplaySpeed = (typeof SPEEDS)[number];

/**
 * Replay (OS-414 on the phone): moves the shared cursor along the activity at 10× to 100×. A hook, so
 * the play button can sit on the map and the speed in the map's options.
 */
export function useReplay(times: number[], onIndex: (index: number) => void) {
  const total = times[times.length - 1] ?? 0;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(30);
  const position = useRef(0);
  const report = useRef(onIndex);
  useEffect(() => {
    report.current = onIndex;
  });
  useEffect(() => {
    if (!playing) return;
    let last = Date.now();
    let frame = 0;
    const loop = () => {
      const now = Date.now();
      position.current = Math.min(total, position.current + ((now - last) / 1000) * speed);
      last = now;
      report.current(indexAt(times, position.current));
      if (position.current >= total) setPlaying(false);
      else frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, times, total]);
  const toggle = () => {
    if (!playing && position.current >= total) position.current = 0;
    setPlaying(!playing);
  };
  return { playing, toggle, speed, setSpeed };
}

/** Save the selected section as a personal segment (OS-325). */
export function SaveSegment({ activityId, section }: { activityId: number; section: [number, number] }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST('/api/segments', {
        body: {
          activity_id: activityId,
          start_index: Math.min(...section),
          end_index: Math.max(...section),
          name: name.trim(),
        },
      });
      if (!data)
        throw new Error(String((error as { detail?: unknown } | undefined)?.detail ?? t('common.error')));
      return data;
    },
    onSuccess: () => {
      setOpen(false);
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['activities', 'segments'] });
    },
  });
  if (!open)
    return (
      <>
        <Button onPress={() => setOpen(true)}>{t('segments.save')}</Button>
        {save.isSuccess && <Muted>{t('segments.saved')}</Muted>}
      </>
    );
  return (
    <View style={{ gap: 8 }}>
      <Heading>{t('segments.save')}</Heading>
      <Field label={t('segments.name')} value={name} onChangeText={setName} maxLength={120} autoFocus />
      <Button primary disabled={save.isPending || !name.trim()} onPress={() => save.mutate()}>
        {t('settings.save')}
      </Button>
      <Button onPress={() => setOpen(false)}>{t('common.cancel')}</Button>
      {save.isError && <Muted accessibilityRole="alert">{save.error.message}</Muted>}
    </View>
  );
}
