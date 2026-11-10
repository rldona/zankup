import { t } from '../i18n';
import { GoalsPanel } from '../stats/panels';

/** Goals as their own section (OS-903), as the app's Goals tab; OS-911 brings its editing and charts. */
export function Goals() {
  return (
    <section className="page">
      <h1>{t('nav.goals')}</h1>
      <GoalsPanel editable />
    </section>
  );
}
