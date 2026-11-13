/**
 * A panel over the screen, dimmed behind: from the bottom with a handle (Series' month, the log's
 * filters) or from the right (the log's months). A tap on the dimmed part or Back closes it.
 */
import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { useTheme } from '../theme';

export function Panel({
  open,
  onClose,
  side = 'bottom',
  children,
}: {
  open: boolean;
  onClose: () => void;
  side?: 'bottom' | 'right';
  children: ReactNode;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = side === 'bottom';
  return (
    <Modal
      transparent
      visible={open}
      animationType={bottom ? 'slide' : 'fade'}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, flexDirection: bottom ? 'column' : 'row' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }}
        />
        <View
          style={
            bottom
              ? {
                  maxHeight: '88%',
                  backgroundColor: c.surface,
                  borderTopLeftRadius: 20,
                  borderTopRightRadius: 20,
                  paddingBottom: insets.bottom + 12,
                }
              : {
                  width: '68%',
                  backgroundColor: c.surface,
                  paddingTop: insets.top,
                  paddingBottom: insets.bottom,
                }
          }
        >
          {bottom && (
            <View
              style={{
                alignSelf: 'center',
                width: 40,
                height: 5,
                borderRadius: 3,
                backgroundColor: c.line,
                marginVertical: 10,
              }}
            />
          )}
          {children}
        </View>
      </View>
    </Modal>
  );
}
