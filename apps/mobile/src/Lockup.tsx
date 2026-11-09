/**
 * The brand lock-up (docs/brand/README.md, sections 2 to 4): the mark drawn with Skia from the geometry in
 * `packages/core`, the single source of truth, and the wordmark in Momo Trust Display, bundled with the app
 * (assets/fonts, under its OFL). Both take the theme's foreground.
 */
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { MARK_SHAPES, MARK_VIEWBOX } from '@zankup/core';
import { Text, View, type ColorValue } from 'react-native';

import { useTheme } from './theme';

const path = Skia.Path.MakeFromSVGString(MARK_SHAPES.path.d);

/** The mark alone, `height` pixels high, in one colour. */
export function Mark({ height = 24, color }: { height?: number; color: ColorValue }) {
  if (!path) return null;
  const scale = height / MARK_VIEWBOX.height;
  return (
    <Canvas style={{ width: MARK_VIEWBOX.width * scale, height }}>
      <Path
        path={path}
        style="stroke"
        strokeWidth={MARK_SHAPES.path.strokeWidth}
        strokeCap="round"
        strokeJoin="round"
        color={String(color)}
        transform={[{ scale }]}
      />
    </Canvas>
  );
}

/** Momo Trust Display's cap height, as a fraction of the font size. */
const CAP_HEIGHT = 0.75;

/** Mark on the left, wordmark on the right, on the same baseline; the mark as high as the capitals. */
export function Lockup({ size = 28 }: { size?: number }) {
  const c = useTheme();
  const mark = Math.round(size * CAP_HEIGHT);
  return (
    <View
      accessibilityRole="header"
      accessibilityLabel="Zankup"
      style={{ flexDirection: 'row', alignItems: 'baseline', gap: Math.round(mark / 2) }}
    >
      <Mark height={mark} color={c.fg} />
      <Text
        style={{
          fontFamily: 'MomoTrustDisplay-Regular',
          fontSize: size,
          lineHeight: Math.round(size * 1.15),
          includeFontPadding: false,
          color: c.fg,
        }}
      >
        Zankup
      </Text>
    </View>
  );
}
