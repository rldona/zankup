import { settingsQuery, type NotificationPrefs } from '@zankup/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { api } from '../api';
import { t } from '../i18n';
import { disablePush, enablePush, pushState, type PushState } from '../push';
import { useSaveSettings } from '../settings';

const KINDS = ['activity', 'record', 'sync_error', 'garmin_key', 'estimate', 'import', 'weekly'] as const;

/** Push notifications (OS-401, OS-402): this browser on or off, which kinds, and a test. */
export function Notifications() {
  const settings = useQuery(settingsQuery(api));
  const save = useSaveSettings();
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => {
    void pushState().then(setState);
  }, []);
  const toggle = useMutation({
    mutationFn: async () => (state === 'on' ? disablePush() : enablePush()),
    onSuccess: setState,
  });
  const test = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/api/notifications/test');
      if (error) throw new Error('test');
    },
  });
  const prefs = settings.data?.notifications;
  return (
    <>
      <p className="note">{t('notifications.help')}</p>
      {state === 'unsupported' && <p className="note">{t('notifications.unsupported')}</p>}
      {state === 'denied' && <p className="warn">{t('notifications.denied')}</p>}
      {state && state !== 'unsupported' && state !== 'denied' && (
        <div className="actions">
          <button
            type="button"
            className={state === 'on' ? undefined : 'primary'}
            onClick={() => toggle.mutate()}
            disabled={toggle.isPending}
          >
            {state === 'on' ? t('notifications.off') : t('notifications.on')}
          </button>
          {state === 'on' && (
            <button type="button" onClick={() => test.mutate()} disabled={test.isPending}>
              {t('notifications.test')}
            </button>
          )}
          {test.isSuccess && <span className="note">{t('notifications.sent')}</span>}
          {(toggle.isError || test.isError) && (
            <span className="note" role="alert">
              {t('common.error')}
            </span>
          )}
        </div>
      )}
      {prefs && (
        <fieldset className="checks">
          <legend>{t('notifications.which')}</legend>
          {KINDS.map((kind) => (
            <label key={kind} className="check">
              <input
                type="checkbox"
                checked={prefs[kind]}
                onChange={(e) =>
                  save.mutate({ notifications: { ...prefs, [kind]: e.target.checked } as NotificationPrefs })
                }
              />
              {t(`notifications.kind.${kind}`)}
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
}
