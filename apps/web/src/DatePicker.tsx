import { useEffect, useRef, useState } from 'react';

import { locale, t } from './i18n';
import { MaterialIcon } from './MaterialIcon';

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dateOf = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};
const shown = (value: string) => (value ? value.split('-').reverse().join('/') : 'dd/mm/aaaa');

/** A date field with the app's own calendar, so no native picker appears. */
export function DatePicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => dateOf(value) ?? new Date());
  const [drop, setDrop] = useState({ top: 0, left: 0 });
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const button = trigger.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const width = 300;
      const height = 350;
      const left = Math.min(rect.left, Math.max(8, window.innerWidth - width - 8));
      const below = window.innerHeight - rect.bottom - 12;
      const top = below < height ? Math.max(8, rect.top - height - 4) : rect.bottom + 4;
      setDrop({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    const close = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const toggle = () => {
    if (!open) setView(dateOf(value) ?? new Date());
    setOpen((state) => !state);
  };

  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7)); // back to Monday
  const days = Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return date;
  });
  const today = isoOf(new Date());
  const move = (delta: number) => setView(new Date(view.getFullYear(), view.getMonth() + delta, 1));
  const pick = (date: Date) => {
    onChange(isoOf(date));
    setOpen(false);
    trigger.current?.focus();
  };
  const clear = () => {
    onChange('');
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div className="datepicker" ref={box}>
      <button
        type="button"
        ref={trigger}
        className="dp-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${value ? shown(value) : ''}`}
        onClick={toggle}
      >
        <span>{shown(value)}</span>
        <MaterialIcon name="calendar_month" />
      </button>
      {open && (
        <div className="dp-pop" role="dialog" aria-label={label} style={{ top: drop.top, left: drop.left }}>
          <div className="dp-head">
            <button type="button" aria-label={t('calendar.prev')} onClick={() => move(-1)}>
              <MaterialIcon name="chevron_left" />
            </button>
            <span>{first.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</span>
            <button type="button" aria-label={t('calendar.next')} onClick={() => move(1)}>
              <MaterialIcon name="chevron_right" />
            </button>
          </div>
          <div className="dp-grid">
            {Array.from({ length: 7 }, (_, i) => (
              <span className="dp-week" key={i}>
                {new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'narrow' })}
              </span>
            ))}
          </div>
          <div className="dp-grid">
            {days.map((date) => {
              const iso = isoOf(date);
              return (
                <button
                  key={iso}
                  type="button"
                  className={`dp-day${date.getMonth() !== view.getMonth() ? ' out' : ''}${
                    iso === value ? ' on' : ''
                  }${iso === today ? ' today' : ''}`}
                  aria-pressed={iso === value}
                  onClick={() => pick(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="dp-foot">
            <button type="button" onClick={() => pick(new Date())}>
              {t('datepicker.today')}
            </button>
            <button type="button" onClick={clear}>
              {t('datepicker.clear')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
