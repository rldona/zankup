/**
 * Measurements for the decision (OS-501): frames per second on the UI thread (Reanimated frame
 * callback) and on the JS thread (requestAnimationFrame), plus the startup time to the first full
 * detail. Shown on screen and written to the log (`adb logcat -s ReactNativeJS`), lines starting "PERF".
 */
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

export function logPerf(message: string): void {
  console.log(`PERF ${message}`);
}

export function msSinceBundleStart(): number {
  const start = (globalThis as { __bundleStart?: number }).__bundleStart ?? Date.now();
  return Date.now() - start;
}

type Window = { fps: number; worst: number; slow: number };

export function FpsMeter({ color }: { color: string }) {
  const [ui, setUi] = useState<Window>({ fps: 0, worst: 0, slow: 0 });
  const [js, setJs] = useState(0);
  const frames = useSharedValue(0);
  const elapsed = useSharedValue(0);
  const worst = useSharedValue(0);
  const slow = useSharedValue(0);

  useFrameCallback((info) => {
    'worklet';
    const dt = info.timeSincePreviousFrame;
    if (dt == null) return;
    frames.value += 1;
    elapsed.value += dt;
    if (dt > worst.value) worst.value = dt;
    if (dt > 1000 / 55) slow.value += 1; // a frame that missed 60 fps
    if (elapsed.value >= 1000) {
      const window = { fps: (frames.value * 1000) / elapsed.value, worst: worst.value, slow: slow.value };
      frames.value = 0;
      elapsed.value = 0;
      worst.value = 0;
      slow.value = 0;
      scheduleOnRN(setUi, window);
    }
  });

  const jsFrames = useRef({ n: 0, t0: 0 });
  useEffect(() => {
    let handle = 0;
    const tick = (now: number) => {
      const s = jsFrames.current;
      if (!s.t0) s.t0 = now;
      s.n += 1;
      if (now - s.t0 >= 1000) {
        setJs((s.n * 1000) / (now - s.t0));
        s.n = 0;
        s.t0 = now;
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, []);

  useEffect(() => {
    if (ui.fps > 0) logPerf(`fps ui=${ui.fps.toFixed(1)} worst=${ui.worst.toFixed(1)}ms slow=${ui.slow} js=${js.toFixed(1)}`);
  }, [ui, js]);

  return (
    <View style={styles.box} pointerEvents="none">
      <Text style={[styles.text, { color }]}>
        UI {ui.fps.toFixed(0)} fps · worst {ui.worst.toFixed(0)} ms · JS {js.toFixed(0)} fps
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { paddingVertical: 2 },
  text: { fontSize: 11, fontVariant: ['tabular-nums'] },
});
