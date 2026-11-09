/** The PWA's interface icons (24×24 strokes), drawn with Skia. */
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { GOOGLE_G } from '@zankup/core';
import type { ColorValue } from 'react-native';

const PATHS = {
  feed: 'M4 6h16M4 12h16M4 18h10',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  profile: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  settings:
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  sync: 'M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5',
  coach: 'M4 5h16v10H9l-5 4V5zM8 10h.01M12 10h.01M16 10h.01',
  health: 'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z',
  gear: 'M3 16c3 0 4-2 6-6l3 1c1 3 4 4 9 4v3H3v-2zM9 10l1.5-3',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  passkey:
    'M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM2 21c1-4 3.5-6 6-6 1.5 0 3 .6 4 1.6M15 11a3 3 0 1 1 3 3v6l-1.5 1.5L15 20v-1l1-1-1-1v-3.2',
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

// Google's G in one colour (packages/core), white on the "Continue with Google" button.
const GOOGLE_RING = Skia.Path.MakeFromSVGString(GOOGLE_G.ring.d);
const GOOGLE_BAR = Skia.Path.MakeFromSVGString(GOOGLE_G.bar.d);

export function GoogleIcon({ color, size = 20 }: { color: ColorValue; size?: number }) {
  if (!GOOGLE_RING || !GOOGLE_BAR) return null;
  const transform = [{ scale: size / GOOGLE_G.size }];
  return (
    <Canvas style={{ width: size, height: size }}>
      <Path
        path={GOOGLE_RING}
        style="stroke"
        strokeWidth={GOOGLE_G.ring.strokeWidth}
        color={String(color)}
        transform={transform}
      />
      <Path path={GOOGLE_BAR} color={String(color)} transform={transform} />
    </Canvas>
  );
}
