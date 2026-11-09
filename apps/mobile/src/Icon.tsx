/** The PWA's interface icons (24×24 strokes), drawn with Skia. */
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import type { ColorValue } from 'react-native';

const PATHS = {
  feed: 'M4 6h16M4 12h16M4 18h10',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  profile: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
} as const;

export type IconName = keyof typeof PATHS;
const parsed = Object.fromEntries(
  Object.entries(PATHS).map(([name, d]) => [name, Skia.Path.MakeFromSVGString(d)]),
) as Record<IconName, ReturnType<typeof Skia.Path.MakeFromSVGString>>;

export function Icon({ name, color, size = 24 }: { name: IconName; color: ColorValue; size?: number }) {
  const path = parsed[name];
  if (!path) return null;
  return (
    <Canvas style={{ width: size, height: size }}>
      <Path
        path={path}
        style="stroke"
        strokeWidth={2}
        strokeCap="round"
        strokeJoin="round"
        color={String(color)}
        transform={[{ scale: size / 24 }]}
      />
    </Canvas>
  );
}
