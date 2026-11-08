import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';

import { t } from '../i18n';

/**
 * Six code boxes: focus advances on its own, Backspace goes back, a pasted or autofilled code is
 * spread across the boxes, and a complete code submits itself once. `onCode` returns an error message
 * to show (the boxes are cleared for another try) or null when the code was accepted.
 */
export function CodeForm({
  submitLabel,
  onCode,
}: {
  submitLabel: string;
  onCode: (code: string) => Promise<string | null>;
}) {
  const [digits, setDigits] = useState<string[]>(() => Array(6).fill(''));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const submitted = useRef('');

  useEffect(() => boxes.current[0]?.focus(), []);

  const verify = async (code: string) => {
    if (code.length < 6) return setError(t('signIn.error.incomplete'));
    if (submitted.current === code) return; // auto-submit fires once per complete code
    submitted.current = code;
    setError('');
    setBusy(true);
    const problem = await onCode(code);
    setBusy(false);
    if (problem) {
      setError(problem);
      setDigits(Array(6).fill(''));
      submitted.current = '';
      boxes.current[0]?.focus();
    }
  };

  const update = (next: string[]) => {
    setDigits(next);
    if (next.every(Boolean)) void verify(next.join(''));
  };

  /** Fills from box i: one digit when typed, several when autofilled or typed faster than focus moves. */
  const fill = (i: number, typed: string) => {
    const next = [...digits];
    if (!typed) next[i] = '';
    typed.split('').forEach((digit, k) => {
      if (i + k < 6) next[i + k] = digit;
    });
    update(next);
    if (typed) boxes.current[Math.min(i + typed.length, 5)]?.focus();
  };

  const onInput = (i: number, value: string) => {
    const typed = value.replace(/\D/g, '');
    // A box holding one digit gets a second keystroke appended: keep the new one.
    fill(i, typed.length === 2 && digits[i] ? typed.slice(-1) : typed.slice(0, 6 - i));
  };

  const onKeyDown = (i: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[i]) boxes.current[i - 1]?.focus();
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    fill(pasted.length === 6 ? 0 : digits.findIndex((d) => !d), pasted);
  };

  return (
    <>
      <ErrorBox message={error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void verify(digits.join(''));
        }}
        noValidate
      >
        <div className="otp">
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                boxes.current[i] = el;
              }}
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              maxLength={6}
              aria-label={t('signIn.digit', { n: i + 1 })}
              value={digit}
              onChange={(e) => onInput(i, e.target.value)}
              onKeyDown={(e) => onKeyDown(i, e)}
              onPaste={onPaste}
            />
          ))}
        </div>
        <button className="primary block" type="submit" disabled={busy}>
          {busy ? <span className="spin" aria-label={t('common.loading')} /> : submitLabel}
        </button>
      </form>
    </>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className={`lerr${message ? ' show' : ''}`} role="alert">
      {message}
    </div>
  );
}
