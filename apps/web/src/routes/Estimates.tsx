import { estimatesQuery } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api';
import { t } from '../i18n';
import { CardSkeleton, Pulse } from '../Skeleton';
import { EstimatesPanel } from '../stats/panels';

/**
 * Estimates as their own page (OS-913), as the app's, reached from You: the main ones (VO₂ max, FTP,
 * threshold pace…) each on its card with where it comes from and its trend, then the race predictions.
 */
export function Estimates() {
  const estimates = useQuery(estimatesQuery(api));
  return (
    <section className="page estimates">
      <h1>{t('stats.estimates')}</h1>
      {estimates.data ? (
        <EstimatesPanel estimates={estimates.data} />
      ) : (
        <Pulse>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </Pulse>
      )}
    </section>
  );
}
