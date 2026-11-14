/**
 * A crisp haptic click on Android, as strong as asked (0 to 1): the system's slider tick, stronger.
 * Does nothing where the native module is missing (an older build of Zankup Dev, the web).
 */
import { requireOptionalNativeModule } from 'expo';

const HapticClick = requireOptionalNativeModule<{ click(strength: number): void }>('HapticClick');

export const hapticClick = (strength: number) => HapticClick?.click(strength);
