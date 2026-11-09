/**
 * The wordmark (docs/brand/README.md, section 3): ZANKUP as one path from `packages/core`, drawn with Skia in
 * the theme's foreground. Shown alone on sign-in and the lock screen; the mark is the launcher icon and splash.
 */
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { WORDMARK_PATH, WORDMARK_VIEWBOX } from '@zankup/core';
import { View } from 'react-native';

import { useTheme } from './theme';

const path = Skia.Path.MakeFromSVGString(WORDMARK_PATH);

/** `height` is the height of the capitals, in pixels. */
export function Wordmark({ height = 22 }: { height?: number }) {
  const c = useTheme();
  if (!path) return null;
  const scale = height / WORDMARK_VIEWBOX.capHeight;
  const width = WORDMARK_VIEWBOX.width * scale;
  const full = WORDMARK_VIEWBOX.height * scale;
  return (
    <View accessibilityRole="header" accessibilityLabel="Zankup" style={{ width, height: full }}>
      <Canvas style={{ width, height: full }}>
        <Path path={path} style="fill" color={String(c.fg)} transform={[{ scale }]} />
      </Canvas>
    </View>
  );
}
