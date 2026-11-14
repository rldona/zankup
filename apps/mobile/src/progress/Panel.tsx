/**
 * A panel over the screen, dimmed behind: from the bottom with a handle (Series' month, the log's
 * filters, the Coach's report) or from the right (the log's months). A tap on the dimmed part or Back
 * closes it.
 *
 * From the bottom it is a sheet, as LatestActivity's: the backdrop covers the whole screen, also behind
 * its rounded corners, and its top can be dragged. A short swipe down leaves it at half its height, a
 * long or fast one closes it; from half, up brings it back.
 */
import { useEffect, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { t } from '../i18n';
import { useTheme } from '../theme';

/** Where a drag ends, from how far the sheet is down (px) and how fast it moves (px/s). */
export function settle(position: number, velocity: number, height: number): 'open' | 'half' | 'close' {
  'worklet';
  // Where it would come to rest a moment later: a flick carries further than a slow drag.
  const projected = position + velocity * 0.2;
  if (projected > height * 0.75 || velocity > 2000) return 'close';
  if (projected > height * 0.25) return 'half';
  return 'open';
}

export function Panel({
  open,
  onClose,
  side = 'bottom',
  children,
}: {
  open: boolean;
  onClose: () => void;
  side?: 'bottom' | 'right';
  children: ReactNode;
}) {
  if (side === 'right')
    return (
      <SidePanel open={open} onClose={onClose}>
        {children}
      </SidePanel>
    );
  return (
    <Modal
      transparent
      visible={open}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      {open && <Sheet onClose={onClose}>{children}</Sheet>}
    </Modal>
  );
}

function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const drag = useSharedValue(900); // how far down the sheet is, px
  const start = useSharedValue(0);
  const height = useSharedValue(600);
  useEffect(() => {
    drag.set(withTiming(0, { duration: 260 }));
  }, [drag]);
  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onStart(() => {
      start.set(drag.get());
    })
    .onUpdate((e) => {
      drag.set(Math.max(0, start.get() + e.translationY));
    })
    .onEnd((e) => {
      const h = height.get();
      const where = settle(drag.get(), e.velocityY, h);
      if (where === 'close')
        drag.set(
          withTiming(h + 40, { duration: 200, easing: Easing.out(Easing.cubic) }, () =>
            scheduleOnRN(onClose),
          ),
        );
      // A plain glide to where it rests, no bounce.
      else
        drag.set(
          withTiming(where === 'half' ? h / 2 : 0, { duration: 220, easing: Easing.out(Easing.cubic) }),
        );
    });
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.get() }] }));
  // The backdrop lightens as the sheet goes down.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, 1 - drag.get() / Math.max(1, height.get())),
  }));
  return (
    // A modal is its own window on Android: gestures need their own root inside it.
    <GestureHandlerRootView style={{ flex: 1, justifyContent: 'flex-end' }}>
      {/* The dimmed backdrop covers the whole screen, also behind the sheet's rounded corners. */}
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
        />
      </Animated.View>
      <Animated.View
        onLayout={(e) => height.set(e.nativeEvent.layout.height)}
        style={[
          sheetStyle,
          {
            maxHeight: '88%',
            backgroundColor: c.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            overflow: 'hidden',
            paddingBottom: insets.bottom + 12,
          },
        ]}
      >
        {/* The handle and a strip round it are what is dragged: the content below keeps its scroll. */}
        <GestureDetector gesture={pan}>
          <View
            accessibilityHint={t('common.close')}
            style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 14 }}
          >
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: c.line }} />
          </View>
        </GestureDetector>
        {children}
      </Animated.View>
    </GestureHandlerRootView>
  );
}

function SidePanel({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      transparent
      visible={open}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}
        />
        <View
          style={{
            width: '68%',
            backgroundColor: c.surface,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          }}
        >
          {children}
        </View>
      </View>
    </Modal>
  );
}
