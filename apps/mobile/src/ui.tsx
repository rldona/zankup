/** Small building blocks shared by the screens, drawn with the theme's tokens. */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { dynamicAccent, dynamicOnAccent, useTheme, type Palette } from './theme';

const scheme = (c: Palette) => (c.scheme === 'dark' ? 'dark' : 'light');

/** The accent for filled controls: Material You's when the theme follows the phone. */
export function accent(c: Palette) {
  return c.dynamic ? dynamicAccent[scheme(c)] : c.accent;
}

/** Text on `accent()`. */
export function onAccent(c: Palette) {
  return c.dynamic ? dynamicOnAccent[scheme(c)] : c.accentFg;
}

export function Screen({
  children,
  scroll = true,
  header = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  /** Under a stack header, which already keeps clear of the status bar. */
  header?: boolean;
}) {
  const c = useTheme();
  return (
    <SafeAreaView edges={header ? [] : ['top']} style={{ flex: 1, backgroundColor: c.bg }}>
      {scroll ? (
        // "handled": a tap on a button works at once, even with the keyboard open.
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const c = useTheme();
  return <Text style={[styles.title, { color: c.fg }]}>{children}</Text>;
}

export function Heading({ children }: { children: ReactNode }) {
  const c = useTheme();
  return <Text style={[styles.heading, { color: c.fg }]}>{children}</Text>;
}

export function Muted({
  children,
  style,
  accessibilityRole,
}: {
  children: ReactNode;
  style?: object;
  accessibilityRole?: 'alert' | 'text';
}) {
  const c = useTheme();
  return (
    <Text accessibilityRole={accessibilityRole} style={[{ color: c.muted, fontSize: 13 }, style]}>
      {children}
    </Text>
  );
}

export function Body({ children }: { children: ReactNode }) {
  const c = useTheme();
  return <Text style={{ color: c.fg, fontSize: 15 }}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }, style]}>{children}</View>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  const c = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: c.fg }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: c.muted }]}>{label}</Text>
    </View>
  );
}

export function Button({
  children,
  onPress,
  primary,
  disabled,
  accessibilityLabel,
}: {
  children: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? accent(c) : c.surface,
          borderColor: primary ? 'transparent' : c.line,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={{ color: primary ? onAccent(c) : c.fg, fontWeight: '600', fontSize: 15 }}>{children}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.fg, fontWeight: '600' }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        style={[styles.input, { color: c.fg, backgroundColor: c.surface, borderColor: c.line }]}
        {...props}
      />
    </View>
  );
}

export function Loading() {
  const c = useTheme();
  return (
    <View style={[styles.centered, { backgroundColor: c.bg }]}>
      <ActivityIndicator color={c.accent} />
    </View>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <View style={{ padding: 24, alignItems: 'center' }}>
      <Muted>{children}</Muted>
    </View>
  );
}

/** One choice among a few, as pills (language, theme, units, a period). */
export function Choice<T extends string>({
  options,
  value,
  onChange,
  label,
  scroll,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** One row that scrolls sideways, for long lists (years). */
  scroll?: boolean;
}) {
  const c = useTheme();
  const Wrapper = (scroll ? ScrollView : View) as typeof View;
  return (
    <Wrapper
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      {...(scroll
        ? { horizontal: true, showsHorizontalScrollIndicator: false, contentContainerStyle: { gap: 6 } }
        : { style: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 } })}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(o.value)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: on ? 'transparent' : c.line,
              backgroundColor: on ? accent(c) : c.surface,
            }}
          >
            <Text style={{ color: on ? onAccent(c) : c.fg }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </Wrapper>
  );
}

/** A bar from 0 to `max`, for uploads, syncs and gear mileage. */
export function ProgressBar({
  value,
  max,
  color,
  label,
}: {
  value: number;
  max: number;
  color?: string;
  label?: string;
}) {
  const c = useTheme();
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}
      style={{ height: 6, borderRadius: 3, backgroundColor: c.line, overflow: 'hidden' }}
    >
      <View
        style={{ height: 6, borderRadius: 3, width: `${share * 100}%`, backgroundColor: color ?? c.accent }}
      />
    </View>
  );
}

/** A row of a menu: an icon, a label, an optional note and a chevron. */
export function MenuRow({
  icon,
  label,
  note,
  onPress,
  last,
}: {
  icon?: ReactNode;
  label: string;
  note?: string;
  onPress: () => void;
  /** The last row of its card: no line under it. */
  last?: boolean;
}) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={note ? `${label}, ${note}` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderColor: c.line, opacity: pressed ? 0.7 : 1 },
        last && { borderBottomWidth: 0 },
      ]}
    >
      {icon}
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.fg, fontSize: 16, fontWeight: '600' }}>{label}</Text>
        {note ? <Text style={{ color: c.muted, fontSize: 13 }}>{note}</Text> : null}
      </View>
      <Text style={{ color: c.muted, fontSize: 20 }}>›</Text>
    </Pressable>
  );
}

/** A small rounded label: a status, a highlight. */
export function Badge({ children, tone }: { children: string; tone?: 'good' | 'bad' }) {
  const c = useTheme();
  const bg = tone === 'good' ? c.accent : tone === 'bad' ? c.zone5 : c.surface2;
  const fg = tone === 'good' ? c.accentFg : tone ? '#fff' : c.fg;
  return (
    <Text
      style={{
        color: fg,
        backgroundColor: bg,
        fontSize: 12,
        fontWeight: '600',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        overflow: 'hidden',
      }}
    >
      {children}
    </Text>
  );
}

export const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, paddingBottom: 32 },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '700', marginTop: 8 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8 },
  stat: { minWidth: 72, paddingVertical: 4 },
  statValue: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 11, marginTop: 2, textTransform: 'uppercase' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  button: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
