import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { MaterialIcon } from './MaterialIcon';

export type SelectOption = {
  value: string;
  label: string;
  icon?: ReactNode;
};

/**
 * A select with the app's look: a button and a themed listbox. The native <select> cannot style its
 * dropdown, so every place that needs one uses this instead.
 */
export function Select({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    current.current?.focus();
    const close = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const choose = (option: string) => {
    onChange(option);
    setOpen(false);
    trigger.current?.focus();
  };

  /** Arrow keys move the focus between the options, as in a native list. */
  const arrows = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  };

  return (
    <div className="zselect" ref={box}>
      <button
        type="button"
        ref={trigger}
        className="zselect-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected?.label ?? ''}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{selected?.label ?? ''}</span>
        <MaterialIcon name={open ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} />
      </button>
      {open && (
        <ul className="zselect-list" role="listbox" aria-label={label} onKeyDown={arrows}>
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                ref={option.value === value ? current : undefined}
                aria-selected={option.value === value}
                className={option.value === value ? 'on' : undefined}
                onClick={() => choose(option.value)}
              >
                {option.icon}
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
