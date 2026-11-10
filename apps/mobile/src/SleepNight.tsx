/**
 * A night of sleep: the score and the hours asleep in two cards, each with the band it falls in, then
 * the stages as one lane each (awake, REM, light, deep) with how long was spent in it. A stretch is a
 * rounded block in its lane, squared off on the side a thin line joins it to the stage before or after,
 * so the night reads as one path going up and down; the clock runs underneath.
 */
import {
  sleepBlocks,
  sleepDurationBand,
  formatHoursMinutes,
  SLEEP_LANES,
  sleepScoreBand,
  stageTotals,
  type HealthDay,
  type HealthNight,
  type SleepLane,
  type MessageKey,
} from '@zankup/core';
import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { t } from './i18n';
import { useTheme } from './theme';

type Sleep = NonNullable<HealthDay['sleep']>;

const TRACK = 30;
const LABEL = 22;
const ROW = LABEL + 6 + TRACK + 14;
const trackTop = (lane: number) => lane * ROW + LABEL + 6;

function Pill({ color, children }: { color: string; children: string }) {
  const c = useTheme();
  return (
    <Text
      style={{
        alignSelf: 'flex-start',
        color: c.fg,
        backgroundColor: `${color}40`,
        fontSize: 12,
        fontWeight: '600',
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 999,
        overflow: 'hidden',
      }}
    >
      {children}
    </Text>
  );
}

function Tile({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  const c = useTheme();
  return (
    <View
      style={{
        flex: 1,
        gap: 4,
        padding: 14,
        borderRadius: 16,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.line,
      }}
    >
      <Text style={{ color: c.muted, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={{ color: c.fg, fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {children}
    </View>
  );
}

/** The score and the hours asleep, side by side. */
export function SleepTiles({ sleep }: { sleep: Sleep }) {
  const c = useTheme();
  const tone = { excellent: c.sleepLight, good: c.sleepLight, fair: c.sleepAwake, poor: c.zone5 };
  const asleep = sleep.asleep_s ?? 0;
  const length = sleepDurationBand(asleep);
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <Tile label={t('health.score')} value={sleep.score != null ? String(sleep.score) : '–'}>
        {sleep.score != null && (
          <Pill color={tone[sleepScoreBand(sleep.score)]}>
            {t(`health.band.${sleepScoreBand(sleep.score)}`)}
          </Pill>
        )}
      </Tile>
      <Tile label={t('health.duration')} value={formatHoursMinutes(asleep)}>
        <Pill color={length === 'met' ? c.sleepLight : length === 'almost' ? c.sleepAwake : c.zone5}>
          {t(`health.goal.${length}` as MessageKey)}
        </Pill>
      </Tile>
    </View>
  );
}

/** The night's stages, lane by lane, with the clock underneath. */
export function StageLanes({
  night,
  sleep,
  colors,
}: {
  night: HealthNight;
  sleep: Sleep;
  colors: Record<SleepLane, string>;
}) {
  const c = useTheme();
  const [width, setWidth] = useState(0);
  const list = sleepBlocks(night.stages);
  const spent = stageTotals(night.stages);
  const total = list.reduce((end, b) => Math.max(end, b.end), 0) || 1;
  const x = (s: number) => (s / total) * width;
  const start = new Date(sleep.start_utc).getTime() + (sleep.utc_offset_s ?? 0) * 1000;
  const clock = (s: number) => {
    const d = new Date(start + s * 1000);
    return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  };
  const height = SLEEP_LANES.length * ROW - 14;
  return (
    <View accessible accessibilityLabel={t('health.stagesLabel')} style={{ gap: 8 }}>
      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {SLEEP_LANES.map((lane, i) => (
          <View
            key={lane}
            style={{
              position: 'absolute',
              top: trackTop(i),
              left: 0,
              right: 0,
              height: TRACK,
              borderRadius: TRACK / 2,
              backgroundColor: c.surface2,
            }}
          />
        ))}
        {width > 0 &&
          list.slice(1).map((b, i) => {
            // The line from the stage before to this one.
            const prev = list[i];
            if (!prev || !b.from) return null;
            // From the upper block's base to the lower block's top: it never shows past either colour.
            const top = Math.min(trackTop(prev.lane), trackTop(b.lane)) + TRACK;
            const bottom = Math.max(trackTop(prev.lane), trackTop(b.lane));
            return (
              <View
                key={`line-${b.start}`}
                style={{
                  position: 'absolute',
                  left: x(b.start) - 0.5,
                  top,
                  height: bottom - top,
                  width: 1,
                  backgroundColor: c.muted,
                  opacity: 0.45,
                }}
              />
            );
          })}
        {width > 0 &&
          list.map((b) => {
            const w = Math.max(2, x(b.end) - x(b.start));
            const r = Math.min(TRACK / 2, w / 2);
            return (
              <View
                key={b.start}
                style={{
                  position: 'absolute',
                  left: x(b.start),
                  width: w,
                  top: trackTop(b.lane),
                  height: TRACK,
                  backgroundColor: colors[SLEEP_LANES[b.lane] ?? 'light'],
                  borderTopLeftRadius: b.from === 'above' ? 0 : r,
                  borderBottomLeftRadius: b.from === 'below' ? 0 : r,
                  borderTopRightRadius: b.to === 'above' ? 0 : r,
                  borderBottomRightRadius: b.to === 'below' ? 0 : r,
                }}
              />
            );
          })}
        {/* The names over the lines, on the card's colour, so a line never runs through them. */}
        {SLEEP_LANES.map((lane, i) => (
          <Text
            key={lane}
            style={{
              position: 'absolute',
              top: i * ROW,
              left: 0,
              paddingRight: 8,
              backgroundColor: c.surface,
              color: c.fg,
              fontSize: 15,
              fontWeight: '500',
            }}
          >
            {t(`health.stage.${lane}`)} · {formatHoursMinutes(spent[lane])}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {[0, total / 2, total].map((s) => (
          <Text key={s} style={{ color: c.muted, fontSize: 13, fontVariant: ['tabular-nums'] }}>
            {clock(s)}
          </Text>
        ))}
      </View>
    </View>
  );
}
