/** Small building blocks shared by the screens, drawn with the theme's tokens. */
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from './Icon';
import { t } from './i18n';
import { PageSkeleton } from './Skeleton';
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
  title,
  toolbar,
  actions,
  busy = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  /** Under a stack header, which already keeps clear of the status bar. */
  header?: boolean;
  /** A title that stays put while the screen scrolls under it (the tabs). */
  title?: string;
  /** Controls that stay put under the title (Stats' period). */
  toolbar?: ReactNode;
  /** Buttons on the title's right (the calendar on Activities). */
  actions?: ReactNode;
  /** Something is updating (a sync): a thin bar moves under the header, as Google Health does. */
  busy?: boolean;
}) {
  const c = useTheme();
  const keyboard = useFieldAboveKeyboard();
  const top = useTopInset(!header);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: top }}>
      {title ? (
        <View style={styles.headerBar}>
          <View style={{ flex: 1 }}>
            <Title>{title}</Title>
          </View>
          {actions}
        </View>
      ) : null}
      {title ? <BusyBar busy={busy} /> : null}
      {toolbar ? <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}>{toolbar}</View> : null}
      {scroll ? (
        // "handled": a tap on a button works at once, even with the keyboard open.
        <ScrollView
          {...keyboard}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.page, title ? { paddingTop: 12 } : null]}
        >
          {children}
        </ScrollView>
      ) : (
        children
      )}
      <KeyboardSpace />
    </View>
  );
}

/**
 * Room for the status bar at the top of a screen, from the insets the provider already knows. Not
 * SafeAreaView: it applies its padding natively a frame late, so a tab opened for the first time
 * showed its header under the status bar and then jumped down.
 */
export function useTopInset(apply = true): number {
  const insets = useSafeAreaInsets();
  return apply ? insets.top : 0;
}

/**
 * Room for the keyboard at the bottom of a screen or a sheet. The app draws edge to edge, so Android
 * no longer shrinks the window for the keyboard (adjustResize is ignored): this grows by as much of
 * the keyboard as covers it, measured from where it sits, so the content above shrinks and the field
 * being typed in stays in sight, whatever header is above.
 */
/** How much room is left under the field being typed in, above the keyboard. */
const ROOM_UNDER_FIELD = 110;

/**
 * Keeps the field being typed in well above the keyboard: once the keyboard is up (and the screen has
 * shrunk for it), a field closer than ROOM_UNDER_FIELD to it scrolls up, so the button under it shows
 * too. Pass the returned ref and onScroll to the ScrollView.
 */
export function useFieldAboveKeyboard() {
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const offset = useRef(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      const top =
        event.endCoordinates.screenY || Dimensions.get('window').height - event.endCoordinates.height;
      // After the room for the keyboard has been laid out.
      setTimeout(() => {
        const field = TextInput.State.currentlyFocusedInput();
        field?.measureInWindow((_x, y, _w, h) => {
          const short = y + h + ROOM_UNDER_FIELD - top;
          if (short > 0) scroll.current?.scrollTo({ y: offset.current + short, animated: true });
        });
      }, 120);
    });
    return () => show.remove();
  }, []);
  return {
    ref: scroll,
    onScroll: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      offset.current = e.nativeEvent.contentOffset.y;
    },
    scrollEventThrottle: 32,
  };
}

export function KeyboardSpace() {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const height = useRef(0);
  const [space, setSpace] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      const top =
        event.endCoordinates.screenY || Dimensions.get('window').height - event.endCoordinates.height;
      ref.current?.measureInWindow((_x, y) => {
        // y is this view's top; with room already given, its bottom is y + that room.
        const next = Math.max(0, Math.round(y + height.current - top));
        height.current = next;
        setSpace(next);
      });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      height.current = 0;
      setSpace(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return <View ref={ref} collapsable={false} style={{ height: space }} />;
}

export function Title({ children }: { children: ReactNode }) {
  const c = useTheme();
  return <Text style={[styles.title, { color: c.fg }]}>{children}</Text>;
}

export function Heading({ children, first }: { children: ReactNode; first?: boolean }) {
  const c = useTheme();
  // `first`: the screen's first heading, right under a fixed title, without the gap above sections.
  return <Text style={[styles.heading, { color: c.fg }, first && { marginTop: 0 }]}>{children}</Text>;
}

/**
 * The title at the top of a card (Zones, Splits, Power curve…): no gap above, beyond the card's own
 * padding, and the same room below as the activity's chart cards; `right` sits on its line. `info`
 * puts an (i) on the right that opens it as a tooltip under the title, instead of a note under the
 * card; a tap on the tooltip closes it.
 */
export function CardTitle({
  children,
  right,
  info,
}: {
  children: ReactNode;
  right?: ReactNode;
  info?: string;
}) {
  return (
    <View
      style={{
        marginBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <View style={{ flexShrink: 1 }}>
        <Heading first>{children}</Heading>
      </View>
      {/* What changes the card (chips such as Hours | Distance), on the title's line. */}
      {right}
      {info ? <InfoButton text={info} /> : null}
    </View>
  );
}

/**
 * An (i) that opens `text` as a tooltip under it (a card's title, the Coach's header). The tooltip sits
 * on a transparent layer over the whole screen, so a tap anywhere, on it or outside it, closes it.
 */
export function InfoButton({ text, label = t('common.moreInfo') }: { text: string; label?: string }) {
  const c = useTheme();
  const anchor = useRef<ComponentRef<typeof View>>(null);
  const [below, setBelow] = useState<number | null>(null);
  const open = () => anchor.current?.measureInWindow((_x, y, _w, h) => setBelow(y + h + 8));
  const close = () => setBelow(null);
  return (
    <>
      <Pressable
        ref={anchor}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: below !== null }}
        hitSlop={10}
        onPress={below === null ? open : close}
      >
        <Icon name="info" color={c.fg} size={22} />
      </Pressable>
      <Modal
        transparent
        visible={below !== null}
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={close}
      >
        <Pressable accessibilityRole="button" accessibilityLabel={text} onPress={close} style={{ flex: 1 }}>
          <View
            style={{
              position: 'absolute',
              top: below ?? 0,
              left: 16,
              right: 16,
              elevation: 6,
              backgroundColor: c.surface2,
              borderColor: c.line,
              borderWidth: 1,
              borderRadius: 12,
              padding: 12,
            }}
          >
            <Text style={{ color: c.fg, fontSize: 14, lineHeight: 20 }}>{text}</Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
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

export function Stat({
  label,
  value,
  labelFirst,
}: {
  label: string;
  value: string;
  /** The label above the figure instead of under it (the week's numbers above the feed). */
  labelFirst?: boolean;
}) {
  const c = useTheme();
  const caption = (
    <Text style={[styles.statLabel, { color: c.muted }, labelFirst && { marginTop: 0, marginBottom: 2 }]}>
      {label}
    </Text>
  );
  return (
    <View style={styles.stat}>
      {labelFirst && caption}
      <Text style={[styles.statValue, { color: c.fg }]}>{value}</Text>
      {!labelFirst && caption}
    </View>
  );
}

export function Button({
  children,
  onPress,
  primary,
  disabled,
  accessibilityLabel,
  icon,
  labelColor,
}: {
  children: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** Drawn before the label (Google's G on "Continue with Google"). */
  icon?: ReactNode;
  /** The label's colour, when it is not the button's usual one (white on "Continue with Google"). */
  labelColor?: string;
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
          backgroundColor: primary ? accent(c) : 'transparent',
          borderColor: primary ? 'transparent' : c.muted,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {icon}
        <Text
          style={{ color: labelColor ?? (primary ? onAccent(c) : c.fg), fontWeight: '600', fontSize: 15 }}
        >
          {children}
        </Text>
      </View>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: 10 }}>
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

/** While a screen's data loads: the shape of its cards, pulsing (see Skeleton). */
export function Loading() {
  const c = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageSkeleton />
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

/** An indeterminate bar for "updating": a segment sliding across, or 3 px of nothing when idle. */
export function BusyBar({ busy }: { busy: boolean }) {
  const c = useTheme();
  const [x] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!busy) {
      x.stopAnimation();
      x.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(x, {
        toValue: 1,
        duration: 1200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, x]);
  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.4, width] });
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityState={{ busy }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: 3, overflow: 'hidden', backgroundColor: busy ? c.line : 'transparent' }}
    >
      {busy && (
        <Animated.View
          style={{
            width: '40%',
            height: 3,
            borderRadius: 2,
            backgroundColor: accent(c),
            transform: [{ translateX }],
          }}
        />
      )}
    </View>
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

/** A label with a switch, for one setting that is on or off. */
export function SwitchRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ color: c.fg, flex: 1 }}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

/** A row of a list: a title, a note under it and what can be done with it on the right. */
export function ListRow({ title, note, children }: { title: string; note?: string; children?: ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.fg, fontWeight: '600' }}>{title}</Text>
        {note ? <Muted>{note}</Muted> : null}
      </View>
      {children}
    </View>
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
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.2 },
  /** The fixed header of the tabs and Home: one height everywhere. */
  headerBar: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingHorizontal: 16, height: 60 },
  heading: { fontSize: 17, fontWeight: '700', marginTop: 8 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8 },
  stat: { minWidth: 72, paddingVertical: 4 },
  statValue: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 11, marginTop: 2, textTransform: 'uppercase' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  /** Pill-shaped, so a button never reads as a field (fields keep their soft corners and fill). */
  button: {
    borderRadius: 999,
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
