import { t, type MessageKeyOf } from '../i18n';

/** Sections whose screen arrives with a later ticket: the frame exists so navigation is complete. */
export function Soon({ title, body }: { title: MessageKeyOf; body: MessageKeyOf }) {
  return (
    <section className="page">
      <h1>{t(title)}</h1>
      <p className="state">{t(body)}</p>
    </section>
  );
}
