import { useEffect } from 'react';
import { Link, useRouteError } from 'react-router';

import { t } from '../i18n';

/**
 * What a screen shows when it throws: a short message and a way out, instead of React Router's
 * developer page. Inside the frame, the sidebar and tab bar stay usable.
 */
export function AppError() {
  const error = useRouteError();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <section className="page" role="alert">
      <h1>{t('error.title')}</h1>
      <p className="state">{t('error.body')}</p>
      <div className="actions">
        <button type="button" className="primary" onClick={() => location.reload()}>
          {t('error.reload')}
        </button>
        <Link to="/">{t('error.home')}</Link>
      </div>
    </section>
  );
}
