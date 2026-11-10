/**
 * A service key in Settings (Garmin's Personal API key, Anthropic's): whether it is set and where
 * from, a hidden field to paste a new one, and for Garmin the day it expires. The server tries the key
 * before saving it and never sends it back, so only its last characters show.
 */
import { keysQuery, queryKeys, type ServiceKey as Key } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';

import { useApi } from '../auth';
import { t } from '../i18n';
import { fromDayMonthYear, toDayMonthYear, typeDayMonthYear } from '../profile/helpers';
import { Badge, Button, Field, Muted } from '../ui';

export function ServiceKeyEditor({ name }: { name: Key['name'] }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const keys = useQuery(keysQuery(api));
  const key = keys.data?.find((k) => k.name === name);
  const [value, setValue] = useState('');
  const [expires, setExpires] = useState('');
  const refresh = (data: Key) => {
    queryClient.setQueryData(keysQuery(api).queryKey, (list: Key[] | undefined) =>
      (list ?? []).map((k) => (k.name === data.name ? data : k)),
    );
    // Everything that depends on the key: Garmin's state, the Coach's availability.
    void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
    void queryClient.invalidateQueries({ queryKey: ['ai'] });
  };
  const save = useMutation({
    mutationFn: async () => {
      const expiresOn = expires ? fromDayMonthYear(expires) : null;
      if (expires && !expiresOn) throw new Error(t('mobile.invalidDate'));
      const { data, error } = await api.PUT('/api/keys/{name}', {
        params: { path: { name } },
        body: { value: value.trim(), expires_on: expiresOn },
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
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone={key.configured ? 'good' : 'bad'}>
          {key.configured
            ? t(key.source === 'env' ? 'keys.fromServer' : 'keys.fromApp', { last4: key.last4 ?? '' })
            : t('keys.notSet')}
        </Badge>
        {key.expires_on && <Muted>{t('keys.expires', { date: toDayMonthYear(key.expires_on) })}</Muted>}
      </View>
      {key.source === 'env' && <Muted>{t('keys.envNote')}</Muted>}
      <Field
        label={key.configured ? t('keys.replace') : t('keys.paste')}
        value={value}
        onChangeText={setValue}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
      />
      {name === 'garmin' && (
        <Field
          label={t('keys.expiresOn')}
          placeholder={t('mobile.dateFormat')}
          keyboardType="number-pad"
          maxLength={10}
          value={expires}
          onChangeText={(text) => setExpires(typeDayMonthYear(text))}
        />
      )}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button primary disabled={value.trim().length < 8 || save.isPending} onPress={() => save.mutate()}>
            {save.isPending ? t('keys.checking') : t('settings.save')}
          </Button>
        </View>
        {key.source === 'app' && (
          <View style={{ flex: 1 }}>
            <Button disabled={remove.isPending} onPress={() => remove.mutate()}>
              {t('keys.remove')}
            </Button>
          </View>
        )}
      </View>
      {save.isError && <Muted accessibilityRole="alert">{save.error.message}</Muted>}
      {remove.isError && <Muted accessibilityRole="alert">{remove.error.message}</Muted>}
    </View>
  );
}
