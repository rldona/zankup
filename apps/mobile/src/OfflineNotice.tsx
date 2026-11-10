/**
 * The notice that the server cannot be reached (no coverage, or it is turning requests away): a small
 * pill above the tab bar while it lasts. The screens keep showing what was kept; it goes away as soon as
 * a request goes through again. It never takes a touch.
 */
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from './Icon';
import { t } from './i18n';
import { useServerUnreachable } from './offline';
import { useTheme } from './theme';

export function OfflineNotice() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const unreachable = useServerUnreachable();
  if (!unreachable) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 88, alignItems: 'center' }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: c.surface,
          borderWidth: 1,
          borderColor: c.line,
          elevation: 4,
        }}
      >
        <Icon name="cloud_off" color={c.muted} size={18} />
        <Text style={{ color: c.fg, fontSize: 13, flexShrink: 1 }}>{t('offline.server')}</Text>
      </View>
    </View>
  );
}
