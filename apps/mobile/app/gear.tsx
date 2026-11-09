/**
 * Gear on the phone (OS-514), as in the PWA (OS-410): shoes and bikes with their mileage against the
 * limit, and adding, editing, retiring and deleting them, with the sports they are the default for.
 */
import { gearQuery, SPORTS, type GearOut } from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';

import { useApi } from '../src/auth';
import { locale, t } from '../src/i18n';
import { useFormat } from '../src/prefs';
import { useTheme } from '../src/theme';
import { Badge, Button, Card, Choice, Field, Heading, Muted, ProgressBar, Screen } from '../src/ui';

type Kind = 'shoe' | 'bike' | 'other';

const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium' });

/** "Brand Model", without the brand twice when the model already starts with it. */
function gearModel(g: GearOut): string {
  const brand = g.brand ?? '';
  const model = g.model ?? '';
  return model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`.trim();
}

export default function GearScreen() {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const gear = useQuery(gearQuery(api));
  const [editing, setEditing] = useState<GearOut | 'new' | null>(null);
  const list = gear.data ?? [];
  const sorted = [...list.filter((g) => !g.retired), ...list.filter((g) => g.retired)];

  if (editing)
    return (
      <Screen header>
        <GearForm gear={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      </Screen>
    );

  return (
    <Screen header>
      <Muted>{t('gear.help')}</Muted>
      <Button primary onPress={() => setEditing('new')}>
        {t('gear.add')}
      </Button>
      {gear.data && list.length === 0 && <Muted>{t('gear.empty')}</Muted>}
      {sorted.map((g) => (
        <Card key={g.id} style={g.retired ? { opacity: 0.6 } : undefined}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: c.fg, fontSize: 16, fontWeight: '700', flex: 1 }}>{g.name}</Text>
            {g.retired && <Badge>{t('gear.retired')}</Badge>}
          </View>
          <Text style={{ color: g.over_limit ? c.zone5 : c.fg, fontVariant: ['tabular-nums'] }}>
            <Text style={{ fontWeight: '700' }}>{format.distance(g.distance_m)}</Text>
            {g.limit_m ? ` / ${format.distance(g.limit_m)}` : ''}
          </Text>
          {g.limit_m ? (
            <ProgressBar
              value={g.distance_m}
              max={g.limit_m}
              color={g.over_limit ? c.zone5 : undefined}
              label={t('gear.mileage')}
            />
          ) : null}
          {g.over_limit && <Text style={{ color: c.zone5 }}>{t('gear.overLimit')}</Text>}
          <Muted>
            {t(`gear.kind.${g.kind as Kind}`)}
            {g.brand || g.model ? ` · ${gearModel(g)}` : ''} · {t('gear.activities', { count: g.activities })}
            {g.last_used ? ` · ${t('gear.lastUsed', { date: date(g.last_used) })}` : ''}
            {g.sports.length > 0 &&
              ` · ${t('gear.defaultFor', { sports: g.sports.map((s) => t(`sport.${s as 'run'}`)).join(', ') })}`}
          </Muted>
          <Button onPress={() => setEditing(g)}>{t('activity.edit')}</Button>
        </Card>
      ))}
    </Screen>
  );
}

function GearForm({ gear, onDone }: { gear: GearOut | null; onDone: () => void }) {
  const api = useApi();
  const c = useTheme();
  const queryClient = useQueryClient();
  const [name, setName] = useState(gear?.name ?? '');
  const [kind, setKind] = useState<Kind>((gear?.kind as Kind | undefined) ?? 'shoe');
  const [brand, setBrand] = useState(gear?.brand ?? '');
  const [model, setModel] = useState(gear?.model ?? '');
  const [sports, setSports] = useState<string[]>(gear?.sports ?? []);
  const [initial, setInitial] = useState(gear ? String(Math.round(gear.initial_m / 1000)) : '0');
  const [limit, setLimit] = useState(
    gear?.limit_m ? String(Math.round(gear.limit_m / 1000)) : gear ? '' : '800',
  );
  const save = useMutation({
    mutationFn: async (extra: { retired?: boolean; remove?: boolean } = {}) => {
      if (gear && extra.remove) {
        await api.DELETE('/api/gear/{gear_id}', { params: { path: { gear_id: gear.id } } });
        return;
      }
      const km = (text: string) => Number(text.replace(',', '.')) * 1000;
      const body = {
        name: name.trim(),
        kind,
        brand: brand.trim() || null,
        model: model.trim() || null,
        sports: sports as ('run' | 'ride')[],
        initial_m: km(initial || '0'),
        limit_m: limit.trim() ? km(limit) : null,
      };
      const { error } = gear
        ? await api.PATCH('/api/gear/{gear_id}', {
            params: { path: { gear_id: gear.id } },
            body: { ...body, ...(extra.retired != null ? { retired: extra.retired } : {}) },
          })
        : await api.POST('/api/gear', { body });
      if (error) throw new Error((error as { detail?: string }).detail ?? t('common.error'));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: gearQuery(api).queryKey });
      onDone();
    },
  });
  const remove = () =>
    Alert.alert(gear?.name ?? '', t('gear.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('gear.delete'), style: 'destructive', onPress: () => save.mutate({ remove: true }) },
    ]);
  return (
    <>
      <Heading>{gear ? gear.name : t('gear.add')}</Heading>
      <Field label={t('activity.name')} value={name} onChangeText={setName} maxLength={120} />
      <Text style={{ color: c.fg, fontWeight: '600' }}>{t('gear.kindLabel')}</Text>
      <Choice
        label={t('gear.kindLabel')}
        value={kind}
        onChange={setKind}
        options={(['shoe', 'bike', 'other'] as const).map((k) => ({ value: k, label: t(`gear.kind.${k}`) }))}
      />
      <Field label={t('gear.brand')} value={brand} onChangeText={setBrand} maxLength={120} />
      <Field label={t('gear.model')} value={model} onChangeText={setModel} maxLength={120} />
      <Field label={t('gear.initial')} value={initial} onChangeText={setInitial} keyboardType="numeric" />
      <Field label={t('gear.limit')} value={limit} onChangeText={setLimit} keyboardType="numeric" />
      <Text style={{ color: c.fg, fontWeight: '600' }}>{t('gear.defaultSports')}</Text>
      <Card>
        {SPORTS.filter((s) => s !== 'other').map((s) => (
          <View key={s} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: c.fg, flex: 1 }}>{t(`sport.${s}`)}</Text>
            <Switch
              accessibilityLabel={t(`sport.${s}`)}
              value={sports.includes(s)}
              onValueChange={(on) => setSports(on ? [...sports, s] : sports.filter((x) => x !== s))}
            />
          </View>
        ))}
      </Card>
      <Button primary disabled={save.isPending || !name.trim()} onPress={() => save.mutate({})}>
        {t('settings.save')}
      </Button>
      {gear && (
        <Button disabled={save.isPending} onPress={() => save.mutate({ retired: !gear.retired })}>
          {gear.retired ? t('gear.unretire') : t('gear.retire')}
        </Button>
      )}
      {gear && (
        <Button disabled={save.isPending} onPress={remove}>
          {t('gear.delete')}
        </Button>
      )}
      <Button onPress={onDone}>{t('common.cancel')}</Button>
      {save.isError && <Muted accessibilityRole="alert">{save.error.message}</Muted>}
    </>
  );
}
