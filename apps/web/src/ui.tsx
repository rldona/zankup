import type { ReactNode } from 'react';

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
