import { Link } from 'react-router';

import { t } from '../i18n';

export function NotFound() {
  return (
    <section className="page">
      <h1>{t('notFound.title')}</h1>
      <Link to="/">{t('notFound.home')}</Link>
    </section>
  );
}
