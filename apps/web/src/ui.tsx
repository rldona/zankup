import type { MaterialIcon as MaterialIconName } from '@zankup/core';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { MaterialIcon } from './MaterialIcon';

/**
 * The title at the top of a card (OS-902), as `CardTitle` on the app: the card's own padding above, a
 * fixed room below, and `right` (chips, a figure, a link) on the same line.
 */
export function CardTitle({ children, right, id }: { children: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div className="ph">
      <h2 id={id}>{children}</h2>
      {right}
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
