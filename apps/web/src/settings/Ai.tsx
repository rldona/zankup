import { aiStatusQuery, settingsQuery, type AiPrefs } from '@zankup/core';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api';
import { locale, t } from '../i18n';
import { useSaveSettings } from '../settings';
import { CardTitle } from '../ui';
import { CoachSettings } from './Instance';
import { ServiceKeyForm } from './ServiceKey';

const money = (value: number) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(
    value,
  );

/** The AI assistant (OS-708): the global switch, what each feature does, what the model receives and
 * never receives, and this month's spend against the budget (OS-706). */
export function Ai() {
  const status = useQuery({ ...aiStatusQuery(api), retry: false });
  const settings = useQuery(settingsQuery(api));
  const save = useSaveSettings();
  const prefs = settings.data?.ai;
  const set = (changes: Partial<AiPrefs>) => prefs && save.mutate({ ai: { ...prefs, ...changes } });
  const info = status.data;
  return (
    <>
      <section className="panel">
        <CardTitle id="ai">{t('ai.title')}</CardTitle>
        <p className="note">{t('keys.anthropicHelp')}</p>
        <ServiceKeyForm name="anthropic" />
        {info && !info.available && <p className="note">{t('ai.off')}</p>}
        {info?.available && (
          <>
            <p className="note">{t('ai.help', { model: info.model ?? '' })}</p>
            {prefs && (
              <fieldset className="checks">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={prefs.enabled}
                    onChange={(e) => set({ enabled: e.target.checked })}
                  />
                  {t('ai.enabled')}
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={prefs.summaries}
                    disabled={!prefs.enabled}
                    onChange={(e) => set({ summaries: e.target.checked })}
                  />
                  {t('ai.summaries')}
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={prefs.weekly}
                    disabled={!prefs.enabled}
                    onChange={(e) => set({ weekly: e.target.checked })}
                  />
                  {t('ai.weekly')}
                </label>
              </fieldset>
            )}
            {info.budget && (
              <p
                className={info.budget.exceeded ? 'warn' : 'note'}
                role={info.budget.warning ? 'status' : undefined}
              >
                {t('ai.spend', {
                  spent: money(info.budget.month_cost_usd),
                  limit: money(info.budget.limit_usd),
                })}
                {info.budget.exceeded
                  ? ` ${t('ai.budgetExceeded')}`
                  : info.budget.warning
                    ? ` ${t('ai.budgetWarning')}`
                    : ''}
              </p>
            )}
            <div className="aiprivacy">
              <div>
                <h3>{t('ai.sends')}</h3>
                <ul>
                  {info.sends.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3>{t('ai.neverSends')}</h3>
                <ul>
                  {info.never_sends.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
            {save.isError && (
              <span className="note" role="alert">
                {t('common.error')}
              </span>
            )}
          </>
        )}
      </section>
      <CoachSettings />
    </>
  );
}
