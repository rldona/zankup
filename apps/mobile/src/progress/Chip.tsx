/**
 * A chip of Progress: a choice in a row that scrolls sideways (sport, measure, race, distance), an
 * outline in the accent when on. One size for all, so they read alike and fit the screen.
 */
import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';

import { useTheme } from '../theme';
import { accent } from '../ui';

export function Chip({
  on,
  label,
  onPress,
  icon,
  role = 'radio',
}: {
  on: boolean;
  label: string;
  onPress: () => void;
  /** An icon before the label, given its colour. */
  icon?: (colour: string) => ReactNode;
  role?: 'radio' | 'button';
}) {
  const c = useTheme();
  const colour = on ? accent(c) : c.fg;
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={role === 'radio' ? { checked: on } : { selected: on }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1.25,
        borderColor: on ? accent(c) : c.line,
      }}
    >
      {icon?.(colour as string)}
      <Text style={{ color: colour, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

/** The size of a chip's icon. */
export const CHIP_ICON = 18;
