import { t } from '../i18n';
import { EventsList } from '../stats/panels';

/** Notifications (OS-916), from the bell in Home's header, as the app's screen. */
export function Notifications() {
  return (
    <section className="page notifications">
      <h1>{t('home.notifications')}</h1>
      <EventsList />
    </section>
  );
}
