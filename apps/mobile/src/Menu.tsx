/**
 * Menus for a header: an icon opens a small list in the top-right corner, in the app's own style.
 * `MenuButton` picks a value (Health's period, Stats' reviews) and ticks the current one; `ActionMenu`
 * runs an action (an activity's share: as an image or a link). Tapping outside closes them.
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
              minWidth: 220,
              paddingVertical: 8,
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
                    paddingVertical: 13,
                    backgroundColor: pressed ? c.surface2 : 'transparent',
                  })}
                >
                  <Text numberOfLines={1} style={{ color: c.fg, fontSize: 16, flexGrow: 1 }}>
                    {o.label}
                  </Text>
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

export type MenuAction = { icon: IconName; label: string; onPress: () => void };

export function ActionMenu({
  label,
  icon,
  actions,
}: {
  label: string;
  icon: IconName;
  actions: MenuAction[];
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        hitSlop={10}
        onPress={() => setOpen(true)}
      >
        <Icon name={icon} color={c.fg} />
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)}>
          <View
            accessibilityRole="menu"
            accessibilityLabel={label}
            style={{
              position: 'absolute',
              top: insets.top + 52,
              right: 12,
              minWidth: 220,
              paddingVertical: 8,
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
            {actions.map((a) => (
              <Pressable
                key={a.label}
                accessibilityRole="menuitem"
                onPress={() => {
                  setOpen(false);
                  a.onPress();
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  paddingHorizontal: 16,
                  paddingVertical: 13,
                  backgroundColor: pressed ? c.surface2 : 'transparent',
                })}
              >
                <Icon name={a.icon} color={c.fg} size={22} />
                <Text numberOfLines={1} style={{ color: c.fg, fontSize: 16, flexGrow: 1 }}>
                  {a.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
