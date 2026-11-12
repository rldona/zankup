import { keysQuery, queryKeys, type ServiceKey } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { api } from '../api';
import { DatePicker } from '../DatePicker';
import { locale, t } from '../i18n';

const day = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * A service key in Settings (Garmin's Personal API key, Anthropic's): whether it is set and where
 * from, a hidden field for a new one and, for Garmin, the day it expires. The server tries the key
 * before saving it and never sends it back: only its last characters show.
 */
export function ServiceKeyForm({ name }: { name: ServiceKey['name'] }) {
  const queryClient = useQueryClient();
  const keys = useQuery(keysQuery(api));
  const key = keys.data?.find((k) => k.name === name);
  const [value, setValue] = useState('');
  const [expires, setExpires] = useState('');
  const refresh = (data: ServiceKey) => {
    queryClient.setQueryData(keysQuery(api).queryKey, (list: ServiceKey[] | undefined) =>
      (list ?? []).map((k) => (k.name === data.name ? data : k)),
    );
    void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
    void queryClient.invalidateQueries({ queryKey: ['ai'] });
  };
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.PUT('/api/keys/{name}', {
        params: { path: { name } },
        body: { value: value.trim(), expires_on: expires || null },
      });
      if (!data)
        throw new Error(String((error as { detail?: unknown } | undefined)?.detail ?? t('common.error')));
      return data;
    },
    onSuccess: (data) => {
      setValue('');
      setExpires('');
      refresh(data);
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      const { data } = await api.DELETE('/api/keys/{name}', { params: { path: { name } } });
      if (!data) throw new Error(t('common.error'));
      return data;
    },
    onSuccess: refresh,
  });
  if (!key) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim().length >= 8) save.mutate();
  };
  return (
    <form className="service-key" onSubmit={submit}>
      <p className={key.configured ? 'ok' : 'warn'}>
        {key.configured
          ? t(key.source === 'env' ? 'keys.fromServer' : 'keys.fromApp', { last4: key.last4 ?? '' })
          : t('keys.notSet')}
        {key.expires_on && ` · ${t('keys.expires', { date: day(key.expires_on) })}`}
      </p>
      {key.source === 'env' && <p className="note">{t('keys.envNote')}</p>}
      <div className="fields">
        <label className="field">
          <span>
            <b>{key.configured ? t('keys.replace') : t('keys.paste')}</b>
          </span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {name === 'garmin' && (
          <div className="field">
            <span>
              <b>{t('keys.expiresOn')}</b>
            </span>
            <DatePicker label={t('keys.expiresOn')} value={expires} onChange={setExpires} />
          </div>
        )}
      </div>
      <p className="actions">
        <button type="submit" className="primary" disabled={value.trim().length < 8 || save.isPending}>
          {save.isPending ? t('keys.checking') : t('settings.save')}
        </button>
        {key.source === 'app' && (
          <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {t('keys.remove')}
          </button>
        )}
      </p>
      {(save.isError || remove.isError) && (
        <p className="note" role="alert">
          {(save.error ?? remove.error)?.message}
        </p>
      )}
    </form>
  );
}
