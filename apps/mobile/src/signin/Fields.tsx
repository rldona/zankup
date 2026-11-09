/**
 * The sign-in's own controls (OS-524), as in the PWA: a password field that can be shown, six code
 * boxes, and the error box.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';

import { Icon } from '../Icon';
import { t } from '../i18n';
import { useTheme } from '../theme';
import { Button, styles as ui } from '../ui';
import { codeDigits } from './rules';

export function PasswordField({ label, ...props }: TextInputProps & { label: string }) {
  const c = useTheme();
  const [show, setShow] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.fg, fontWeight: '600' }}>{label}</Text>
      <View
        style={[
          ui.input,
          {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 0,
            backgroundColor: c.surface,
            borderColor: c.line,
          },
        ]}
      >
        <TextInput
          accessibilityLabel={label}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          placeholderTextColor={c.muted}
          style={{ flex: 1, color: c.fg, fontSize: 16, paddingVertical: 10 }}
          {...props}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={show ? t('signIn.hidePassword') : t('signIn.showPassword')}
          accessibilityState={{ selected: show }}
          hitSlop={12}
          onPress={() => setShow((v) => !v)}
        >
          <Icon name="eye" color={show ? c.accent : c.muted} size={22} />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Six boxes over one hidden field: typing advances on its own, a pasted or autofilled code fills them
 * all, and a complete code is submitted once. `onCode` returns an error to show (the boxes empty for
 * another try) or null when the code was accepted.
 */
export function CodeBoxes({
  submitLabel,
  onCode,
}: {
  submitLabel: string;
  onCode: (code: string) => Promise<string | null>;
}) {
  const c = useTheme();
  const input = useRef<TextInputInstance>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitted = useRef('');

  useEffect(() => {
    const timer = setTimeout(() => input.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, []);

  const verify = async (value: string) => {
    if (value.length < 6) return setError(t('signIn.error.incomplete'));
    if (submitted.current === value) return; // a complete code is sent once
    submitted.current = value;
    setError('');
    setBusy(true);
    const problem = await onCode(value);
    setBusy(false);
    if (problem) {
      setError(problem);
      setCode('');
      submitted.current = '';
      input.current?.focus();
    }
  };

  const change = (value: string) => {
    const digits = codeDigits(value);
    setCode(digits);
    if (digits.length === 6) void verify(digits);
  };

  return (
    <View style={{ gap: 12 }}>
      <ErrorBox message={error} />
      <Pressable
        accessible={false}
        onPress={() => input.current?.focus()}
        style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}
      >
        {Array.from({ length: 6 }, (_, i) => {
          const current = i === Math.min(code.length, 5);
          return (
            <View
              key={i}
              style={{
                width: 46,
                height: 56,
                borderRadius: 12,
                borderWidth: current ? 2 : 1,
                borderColor: current ? c.accent : c.line,
                backgroundColor: c.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: c.fg, fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                {code[i] ?? ''}
              </Text>
            </View>
          );
        })}
      </Pressable>
      <TextInput
        ref={input}
        value={code}
        onChangeText={change}
        accessibilityLabel={t('signIn.codeTitle')}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        caretHidden
        style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
      />
      <Button primary disabled={busy} onPress={() => void verify(code)}>
        {busy ? t('common.loading') : submitLabel}
      </Button>
    </View>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  const c = useTheme();
  if (!message) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.zone5,
        padding: 12,
        backgroundColor: c.surface,
      }}
    >
      <Text style={{ color: c.fg }}>{message}</Text>
    </View>
  );
}
