/**
 * Placeholders while data loads: grey shapes where the content will be, pulsing softly as one block.
 * `Bone` is one shape; the rest are the shapes of the app's screens and cards, so what arrives
 * replaces them without the layout jumping.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Animated, View, type DimensionValue, type ViewStyle } from 'react-native';

import { useTheme } from './theme';

/** A block that pulses between full and half opacity while its bones wait for data. */
export function Pulse({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      style={[{ opacity }, style]}
    >
      {children}
    </Animated.View>
  );
}

/** One grey shape. */
export function Bone({
  width = '100%',
  height = 12,
  radius = 6,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const c = useTheme();
  return <View style={[{ width, height, borderRadius: radius, backgroundColor: c.surface2 }, style]} />;
}

function CardBox({ children, gap = 10 }: { children: ReactNode; gap?: number }) {
  const c = useTheme();
  return (
    <View
      style={{
        borderRadius: 16,
        padding: 14,
        gap,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.line,
      }}
    >
      {children}
    </View>
  );
}

/** A card with a title and a few lines. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <CardBox>
      <Bone width="45%" height={16} />
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} width={i === lines - 1 ? '70%' : '100%'} />
      ))}
    </CardBox>
  );
}

/** A screen of cards: what a list or a page looks like before it loads. */
export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <Pulse style={{ gap: 12, padding: 16 }}>
      {Array.from({ length: cards }, (_, i) => (
        <CardSkeleton key={i} lines={i === 0 ? 2 : 3} />
      ))}
    </Pulse>
  );
}

/** One activity in the feed: the sport tile, the name and date, three figures and the route. */
function ActivityBone() {
  return (
    <CardBox gap={14}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Bone width={36} height={36} radius={10} />
        <View style={{ flex: 1, gap: 6 }}>
          <Bone width="60%" height={14} />
          <Bone width="35%" height={10} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-end' }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ gap: 6 }}>
            <Bone width={48} height={9} />
            <Bone width={60} height={16} />
          </View>
        ))}
        <Bone width={84} height={56} radius={10} style={{ marginLeft: 'auto' }} />
      </View>
    </CardBox>
  );
}

export function FeedSkeleton() {
  return (
    <Pulse style={{ gap: 12 }}>
      {[0, 1, 2, 3].map((i) => (
        <ActivityBone key={i} />
      ))}
    </Pulse>
  );
}

/** The week card: a title, seven day circles and four figures. */
export function WeekSkeleton() {
  return (
    <Pulse>
      <CardBox gap={14}>
        <Bone width="40%" height={16} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {Array.from({ length: 7 }, (_, i) => (
            <Bone key={i} width={34} height={34} radius={17} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ gap: 6 }}>
              <Bone width={56} height={9} />
              <Bone width={48} height={16} />
            </View>
          ))}
        </View>
      </CardBox>
    </Pulse>
  );
}

/** An activity before it loads: the map, the title and the six figures. */
export function ActivitySkeleton() {
  return (
    <Pulse>
      <Bone height={300} radius={0} />
      <View style={{ padding: 16, gap: 18 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Bone width={44} height={44} radius={12} />
          <View style={{ flex: 1, gap: 6 }}>
            <Bone width="65%" height={16} />
            <Bone width="40%" height={10} />
          </View>
        </View>
        {[0, 1, 2].map((row) => (
          <View key={row} style={{ flexDirection: 'row' }}>
            {[0, 1].map((col) => (
              <View key={col} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                <Bone width={70} height={9} />
                <Bone width={80} height={16} />
              </View>
            ))}
          </View>
        ))}
        <CardSkeleton lines={2} />
      </View>
    </Pulse>
  );
}

/** A chart's card: a title and the plot. */
export function ChartSkeleton({ height = 160 }: { height?: number }) {
  return (
    <CardBox>
      <Bone width="50%" height={16} />
      <Bone height={height} radius={10} />
    </CardBox>
  );
}

/** Health before it loads: last night, the day's figures and a chart. */
export function HealthSkeleton() {
  return (
    <Pulse style={{ gap: 12 }}>
      <CardSkeleton lines={3} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        {[0, 1].map((i) => (
          <View key={i} style={{ flex: 1 }}>
            <CardSkeleton lines={1} />
          </View>
        ))}
      </View>
      <ChartSkeleton />
    </Pulse>
  );
}

/** Goals before they load: two cards with their bar. */
export function GoalsSkeleton() {
  return (
    <Pulse style={{ gap: 12 }}>
      {[0, 1].map((i) => (
        <CardBox key={i}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Bone width="50%" height={14} />
            <Bone width={36} height={14} />
          </View>
          <Bone height={8} radius={4} />
          <Bone width="40%" height={14} />
        </CardBox>
      ))}
    </Pulse>
  );
}

/** The routes: each a name, a line of figures and the route's shape on the right. */
export function RoutesSkeleton() {
  return (
    <Pulse style={{ gap: 12 }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <CardBox key={i}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, gap: 8 }}>
              <Bone width="55%" height={14} />
              <Bone width="80%" height={10} />
            </View>
            <Bone width={88} height={64} radius={10} />
          </View>
        </CardBox>
      ))}
    </Pulse>
  );
}
