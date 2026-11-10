/**
 * Hides a map until its style has loaded. Before that, MapLibre's surface is blank white, which flashes
 * in dark mode. A view painted with the style's own background sits over the map and fades out
 * once the style is ready. The map's GL surface ignores a parent's opacity, so the cover goes on top.
 */
import { useCallback, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';

/** The background colour of the OpenFreeMap styles the apps use (dark and positron). */
export const MAP_BACKGROUND = { dark: 'rgb(12,12,12)', light: 'rgb(242,243,240)' };

export function useMapCover(dark: boolean) {
  const [opacity] = useState(() => new Animated.Value(1));
  const [shown, setShown] = useState(true);
  const reveal = useCallback(() => {
    Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() =>
      setShown(false),
    );
  }, [opacity]);
  const cover = shown ? (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: dark ? MAP_BACKGROUND.dark : MAP_BACKGROUND.light, opacity },
      ]}
    />
  ) : null;
  return { cover, reveal };
}
