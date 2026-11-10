/**
 * What drives the activity map, on the map itself: play and pause at the bottom left, the colour
 * legend along the bottom, and an options button at the top right that opens a panel with what the
 * route is coloured by and the replay speed.
 */
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '../Icon';
import { t } from '../i18n';
import { useTheme } from '../theme';
import { Choice } from '../ui';
import { SPEEDS, type ReplaySpeed } from './Tools';

type Props<M extends string> = {
  replay: { playing: boolean; toggle: () => void; speed: ReplaySpeed; setSpeed: (s: ReplaySpeed) => void };
  metric: M | null;
  metrics: { value: M; label: string }[];
  onMetric: (m: M) => void;
  /** The ends of the colour ramp, already written out, and its colours from low to high. */
  legend: { low: string; high: string; colours: readonly string[] } | null;
};

export function MapControls<M extends string>({ replay, metric, metrics, onMetric, legend }: Props<M>) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const button = {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.line,
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('activity.mapOptions')}
        onPress={() => setOpen(true)}
        hitSlop={6}
        style={[button, { position: 'absolute', top: 12, right: 12 }]}
      >
        <Icon name="tune" color={c.fg} size={22} />
      </Pressable>
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: 12,
          right: 44,
          bottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={replay.playing ? t('replay.pause') : t('replay.play')}
          onPress={replay.toggle}
          hitSlop={6}
          style={button}
        >
          <Icon name={replay.playing ? 'pause' : 'play_arrow'} color={c.fg} size={24} />
        </Pressable>
        {legend && (
          <View
            accessible={false}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 10,
              height: 28,
              borderRadius: 14,
              backgroundColor: c.surface,
              borderWidth: 1,
              borderColor: c.line,
              flexShrink: 1,
            }}
          >
            <Text style={{ color: c.muted, fontSize: 11 }}>{legend.low}</Text>
            <View style={{ width: 64, flexDirection: 'row', height: 5, borderRadius: 3, overflow: 'hidden' }}>
              {legend.colours.map((colour) => (
                <View key={colour} style={{ flex: 1, backgroundColor: colour }} />
              ))}
            </View>
            <Text style={{ color: c.muted, fontSize: 11 }}>{legend.high}</Text>
          </View>
        )}
      </View>
      <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
        <Pressable
          accessibilityLabel={t('common.close')}
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }}
        >
          <Pressable onPress={() => {}}>
            <SafeAreaView
              edges={['bottom']}
              style={{
                backgroundColor: c.surface,
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                padding: 20,
                gap: 18,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: c.fg, fontSize: 18, fontWeight: '700', flex: 1 }}>
                  {t('activity.mapOptions')}
                </Text>
                <Pressable accessibilityRole="button" onPress={() => setOpen(false)} hitSlop={12}>
                  <Icon name="close" color={c.fg} size={24} />
                </Pressable>
              </View>
              {metrics.length > 1 && metric && (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: c.muted, fontSize: 13 }}>{t('activity.colourBy')}</Text>
                  <Choice
                    label={t('activity.colourBy')}
                    value={metric}
                    onChange={onMetric}
                    options={metrics}
                  />
                </View>
              )}
              <View style={{ gap: 8 }}>
                <Text style={{ color: c.muted, fontSize: 13 }}>{t('replay.speed')}</Text>
                <Choice
                  label={t('replay.speed')}
                  value={String(replay.speed)}
                  onChange={(v) => replay.setSpeed(Number(v) as ReplaySpeed)}
                  options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))}
                />
              </View>
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
