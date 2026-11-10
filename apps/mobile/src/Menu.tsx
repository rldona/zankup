/**
 * A menu for a header: the three dots (or another icon) open a small list in the top-right corner,
 * with the current choice ticked (Health's period, Stats' reviews). Tapping outside closes it.
 */
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from './Icon';
import { useTheme } from './theme';

export function MenuButton<T extends string>({
  label,
  value,
  options,
  onChange,
  icon = 'more_vert',
}: {
  icon?: IconName;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={10}
        onPress={() => setOpen(true)}
      >
        <Icon name={icon} color={c.fg} size={26} />
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)}>
          <View
            accessibilityRole="menu"
            style={{
              position: 'absolute',
              top: insets.top + 52,
              right: 12,
              minWidth: 190,
              paddingVertical: 6,
              borderRadius: 14,
              backgroundColor: c.surface,
              borderWidth: 1,
              borderColor: c.line,
              elevation: 8,
              shadowColor: '#000',
              shadowOpacity: 0.25,
              shadowRadius: 12,
            }}
          >
            {options.map((o) => {
              const on = o.value === value;
              return (
                <Pressable
                  key={o.value}
                  accessibilityRole="menuitem"
                  accessibilityState={{ checked: on }}
                  onPress={() => {
                    setOpen(false);
                    onChange(o.value);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    backgroundColor: pressed ? c.surface2 : 'transparent',
                  })}
                >
                  <Text style={{ color: c.fg, fontSize: 16, flex: 1 }}>{o.label}</Text>
                  {on && <Icon name="check" color={c.accent} size={20} />}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
