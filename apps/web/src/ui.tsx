import type { MaterialIcon as MaterialIconName } from '@zankup/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { t } from './i18n';
import { MaterialIcon } from './MaterialIcon';

/**
 * The title at the top of a card (OS-902), as `CardTitle` on the app: the card's own padding above, a
 * fixed room below, and `right` (chips, a figure, a link) on the same line.
 */
export function CardTitle({
  children,
  right,
  id,
  info,
}: {
  children: ReactNode;
  right?: ReactNode;
  id?: string;
  /** An (i) on the right that opens this as a tooltip, instead of a note under the card (as the app). */
  info?: string;
}) {
  return (
    <div className="ph">
      <h2 id={id}>{children}</h2>
      {right}
      {info && <InfoTip text={info} />}
    </div>
  );
}

/** An (i) button and the tooltip it opens under it; a click anywhere, or Escape, closes it. */
export function InfoTip({ text, label = t('common.moreInfo') }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div className="menuwrap" ref={wrap}>
      <button
        type="button"
        className="iconbtn"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MaterialIcon name="info" />
      </button>
      {open && (
        <p className="popmenu tip" role="note" onClick={() => setOpen(false)}>
          {text}
        </p>
      )}
    </div>
  );
}

/** A card of rows that lead somewhere, as the app's `MenuRow`s: icon, label (and a note), then ›. */
export function Menu({
  items,
  label,
}: {
  label: string;
  items: { to: string; icon: MaterialIconName; label: string; note?: string }[];
}) {
  return (
    <nav className="panel menu" aria-label={label}>
      {items.map((item) => (
        <Link key={item.to} to={item.to}>
          <MaterialIcon name={item.icon} />
          <span>
            <b>{item.label}</b>
            {item.note && <small>{item.note}</small>}
          </span>
          <i aria-hidden="true">›</i>
        </Link>
      ))}
    </nav>
  );
}
