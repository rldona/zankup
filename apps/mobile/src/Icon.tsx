/**
 * The app's icons: Material Symbols (Rounded) from packages/core, filled and drawn with Skia, as the PWA shows
 * them. `SportIcon` is a sport's icon in its colour on a soft tile, like the PWA's.
 */
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import {
  GOOGLE_G,
  MATERIAL_ICONS,
  SOURCE_ICONS,
  SPORT_ICONS,
  type HealthSourceName,
  type MaterialIcon,
  type Sport,
} from '@zankup/core';
import type { ColorValue } from 'react-native';
import { View } from 'react-native';

import { useTheme } from './theme';

export type IconName = MaterialIcon;

const parsed = new Map<IconName, ReturnType<typeof Skia.Path.MakeFromSVGString>>();
function path(name: IconName) {
  if (!parsed.has(name)) parsed.set(name, Skia.Path.MakeFromSVGString(MATERIAL_ICONS[name]));
  return parsed.get(name) ?? null;
}

export function Icon({ name, color, size = 24 }: { name: IconName; color: ColorValue; size?: number }) {
  const shape = path(name);
  if (!shape) return null;
  // The icons sit in a 960-unit box from y = -960 to 0.
  return (
    <Canvas style={{ width: size, height: size }}>
      <Path path={shape} color={String(color)} transform={[{ scale: size / 960 }, { translateY: 960 }]} />
    </Canvas>
  );
}

/** A sport's icon in its colour, on a tile of the same colour, faint. */
export function SportIcon({ sport, size = 36 }: { sport: Sport; size?: number }) {
  const c = useTheme();
  const colour = c[sport];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        backgroundColor: `${colour}26`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={SPORT_ICONS[sport]} color={colour} size={size * 0.62} />
    </View>
  );
}

// Google's G in one colour (Ionicons' logo-google, from packages/core), white on "Continue with Google".
const GOOGLE = Skia.Path.MakeFromSVGString(GOOGLE_G.d);

export function GoogleIcon({ color, size = 20 }: { color: ColorValue; size?: number }) {
  if (!GOOGLE) return null;
  return (
    <Canvas style={{ width: size, height: size }}>
      <Path path={GOOGLE} color={String(color)} transform={[{ scale: size / GOOGLE_G.size }]} />
    </Canvas>
  );
}

const sources = new Map<HealthSourceName, ReturnType<typeof Skia.Path.MakeFromSVGString>>();

/** A health source's mark (Garmin, Google Health, Health Connect), in the corner of a health widget. */
export function SourceIcon({
  source,
  color,
  size = 16,
}: {
  source: HealthSourceName;
  color: ColorValue;
  size?: number;
}) {
  const icon = SOURCE_ICONS[source];
  if (!sources.has(source)) sources.set(source, Skia.Path.MakeFromSVGString(icon.d));
  const shape = sources.get(source);
  if (!shape) return null;
  const [x = 0, y = 0, w = 24, h = 24] = icon.viewBox.split(' ').map(Number);
  const scale = size / Math.max(w, h);
  return (
    <Canvas style={{ width: size, height: size }}>
      <Path
        path={shape}
        color={String(color)}
        transform={[{ scale }, { translateX: -x }, { translateY: -y }]}
      />
    </Canvas>
  );
}
