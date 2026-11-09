/**
 * The parts of the profile on the phone (OS-523), as in the PWA (OS-218): editing who you are, the
 * year and all-time numbers by sport, records, the physical data, goals you can add and delete, and
 * the account (sign-in methods, passkeys, Google, sources).
 */
import {
  formatDuration,
  formatHoursMinutes,
  gearQuery,
  goalsQuery,
  passkeysQuery,
  providersQuery,
  queryKeys,
  sourcesQuery,
  SPORTS,
  type Me,
  type MessageKey,
  type ProfileSummary,
} from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, Pressable, Text, View } from 'react-native';

import { useApi, useAuth } from '../auth';
import { Sheet } from '../detail/Tools';
import { ageOn, goalTarget, initials, validDate } from './helpers';
import { effortName } from '../estimates';
import { locale, t } from '../i18n';
import { asSport, useFormat, useHrMax } from '../prefs';
import { addPasskey, passkeysSupported, SignInError } from '../session';
import { GoalCard } from '../stats/Sections';
import { useTheme } from '../theme';
import {
  Badge,
  Button,
  Card,
  Choice,
  Field,
  Heading,
  ListRow,
  MenuRow,
  Muted,
  ProgressBar,
  styles as ui,
} from '../ui';

type Format = ReturnType<typeof useFormat>;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

// --- the header ------------------------------------------------------------------------------------

export function Header({ me, summary, onEdit }: { me: Me; summary?: ProfileSummary; onEdit: () => void }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      {me.avatar_url ? (
        <Image
          accessible={false}
          source={{ uri: me.avatar_url }}
          style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.surface2 }}
        />
      ) : (
        <View
          accessible={false}
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: c.surface2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: c.fg, fontSize: 22, fontWeight: '700' }}>{initials(me)}</Text>
        </View>
      )}
      <View style={{ flex: 1, gap: 4 }}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={[ui.title, { color: c.fg }]}
        >
          {me.display_name ?? me.email}
        </Text>
        {[me.location, summary?.device].some(Boolean) && (
          <Muted>{[me.location, summary?.device].filter(Boolean).join(' · ')}</Muted>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {summary && <Badge tone="good">{t('profile.streak', { count: summary.streak_weeks })}</Badge>}
          <Pressable accessibilityRole="button" onPress={onEdit} hitSlop={12}>
            <Text style={{ color: c.accent, fontWeight: '600' }}>{t('profile.edit')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function YearNumbers({ summary }: { summary: ProfileSummary }) {
  const c = useTheme();
  const format = useFormat();
  const total = summary.this_year.reduce(
    (sum, s) => ({
      count: sum.count + s.count,
      distance: sum.distance + s.distance_m,
      time: sum.time + s.moving_s,
      ascent: sum.ascent + s.ascent_m,
    }),
    { count: 0, distance: 0, time: 0, ascent: 0 },
  );
  const figures: [string, string][] = [
    [t('feed.title'), total.count.toLocaleString(locale)],
    [t('feed.stat.distance'), format.distance(total.distance)],
    [t('feed.stat.time'), formatHoursMinutes(total.time)],
    [t('feed.stat.ascent'), format.elevation(total.ascent)],
  ];
  return (
    <Card>
      <Heading>{t('profile.year', { year: summary.year })}</Heading>
      <View style={ui.stats}>
        {figures.map(([label, value]) => (
          <View key={label} style={ui.stat}>
            <Text style={[ui.statValue, { color: c.fg, fontSize: 20 }]}>{value}</Text>
            <Text style={[ui.statLabel, { color: c.muted }]}>{label}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

// --- editing ---------------------------------------------------------------------------------------

export function EditProfile({ me, onDone }: { me: Me; onDone: () => void }) {
  const api = useApi();
  const c = useTheme();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    display_name: me.display_name ?? '',
    location: me.location ?? '',
    birth_date: me.birth_date ?? '',
    sex: me.sex ?? '',
    weight_kg: me.weight_kg?.toString() ?? '',
    height_cm: me.height_cm?.toString() ?? '',
  });
  const save = useMutation({
    mutationFn: async () => {
      if (form.birth_date && !validDate(form.birth_date)) throw new Error(t('mobile.invalidDate'));
      const { data, error } = await api.PATCH('/api/auth/me', {
        body: {
          ...(form.display_name.trim() ? { display_name: form.display_name.trim() } : {}),
          location: form.location.trim() || null,
          birth_date: form.birth_date || null,
          sex: (form.sex || null) as Me['sex'],
          weight_kg: form.weight_kg ? Number(form.weight_kg.replace(',', '.')) : null,
          height_cm: form.height_cm ? Number(form.height_cm) : null,
        },
      });
      if (!data) throw new Error(String((error as { detail?: unknown } | undefined)?.detail ?? ''));
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.me, data);
      onDone();
    },
  });
  const field = (name: keyof typeof form) => ({
    value: form[name],
    onChangeText: (value: string) => setForm({ ...form, [name]: value }),
  });
  return (
    <Sheet title={t('profile.edit')} onClose={onDone}>
      <Field label={t('profile.name')} autoComplete="name" maxLength={120} {...field('display_name')} />
      <Field label={t('profile.location')} maxLength={120} {...field('location')} />
      <Field
        label={t('profile.birth')}
        placeholder={t('mobile.dateFormat')}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        {...field('birth_date')}
      />
      <Text style={{ color: c.fg, fontWeight: '600' }}>{t('profile.sex')}</Text>
      <Choice
        label={t('profile.sex')}
        value={form.sex}
        onChange={(sex) => setForm({ ...form, sex })}
        options={[
          { value: '', label: t('profile.sex.none') },
          { value: 'female', label: t('profile.sex.female') },
          { value: 'male', label: t('profile.sex.male') },
          { value: 'other', label: t('profile.sex.other') },
        ]}
      />
      <Field label={t('profile.weight')} keyboardType="decimal-pad" {...field('weight_kg')} />
      <Field label={t('profile.height')} keyboardType="number-pad" {...field('height_cm')} />
      {save.isError && <Muted accessibilityRole="alert">{save.error.message || t('common.error')}</Muted>}
      <Button primary disabled={save.isPending} onPress={() => save.mutate()}>
        {t('settings.save')}
      </Button>
      <Button onPress={onDone}>{t('profile.cancel')}</Button>
    </Sheet>
  );
}

// --- the summary -----------------------------------------------------------------------------------

function SportRows({ rows, format }: { rows: ProfileSummary['this_year']; format: Format }) {
  const c = useTheme();
  return (
    <>
      {rows.map((s) => (
        <View
          key={s.sport}
          style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontWeight: '600' }}>{t(`sport.${asSport(s.sport)}`)}</Text>
            <Muted>{t('profile.activities', { count: s.count })}</Muted>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: c.fg, fontVariant: ['tabular-nums'] }}>
              {s.distance_m ? format.distance(s.distance_m) : '—'}
            </Text>
            <Muted>{formatHoursMinutes(s.moving_s)}</Muted>
          </View>
        </View>
      ))}
    </>
  );
}

export function Summary({ me, summary }: { me: Me; summary: ProfileSummary }) {
  const c = useTheme();
  const format = useFormat();
  const { hrMax } = useHrMax();
  const [today] = useState(() => new Date());
  const age = me.birth_date ? ageOn(me.birth_date, today) : null;
  const physical: [MessageKey, string][] = [];
  if (age != null) physical.push(['profile.age', t('profile.years', { count: age })]);
  if (me.sex) physical.push(['profile.sex', t(`profile.sex.${me.sex}`)]);
  if (me.weight_kg) physical.push(['profile.weight', me.weight_kg.toLocaleString(locale)]);
  if (me.height_cm) physical.push(['profile.height', String(me.height_cm)]);
  if (hrMax) physical.push(['settings.hrMax', `${hrMax} bpm`]);
  return (
    <>
      {summary.this_year.length > 0 && (
        <Card>
          <Heading>{t('profile.byYear')}</Heading>
          <SportRows rows={summary.this_year} format={format} />
        </Card>
      )}
      <Card>
        <Heading>{t('profile.allTime')}</Heading>
        {summary.since && <Muted>{t('profile.since', { date: day(summary.since) })}</Muted>}
        <SportRows rows={summary.all_time} format={format} />
      </Card>
      <Card>
        <Heading>{t('profile.records')}</Heading>
        {summary.records.length === 0 && <Muted>{t('profile.noRecords')}</Muted>}
        {summary.records.map((r) => (
          <Pressable
            key={r.distance_key}
            accessibilityRole="link"
            onPress={() => router.push(`/activity/${r.activity_id}`)}
            style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.accent, fontWeight: '600' }}>{effortName(r.distance_key)}</Text>
              <Muted>
                {format.pace(r.distance_m / r.time_s)} · {day(r.date)}
              </Muted>
            </View>
            <Text style={{ color: c.fg, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
              {formatDuration(r.time_s)}
            </Text>
          </Pressable>
        ))}
      </Card>
      {physical.length > 0 && (
        <Card>
          <Heading>{t('profile.physical')}</Heading>
          <View style={ui.stats}>
            {physical.map(([label, value]) => (
              <View key={label} style={ui.stat}>
                <Text style={[ui.statValue, { color: c.fg }]}>{value}</Text>
                <Text style={[ui.statLabel, { color: c.muted }]}>{t(label)}</Text>
              </View>
            ))}
          </View>
        </Card>
      )}
      <GearCard format={format} />
    </>
  );
}

function GearCard({ format }: { format: Format }) {
  const api = useApi();
  const c = useTheme();
  const gear = useQuery(gearQuery(api));
  const active = (gear.data ?? []).filter((g) => !g.retired);
  if (!active.length) return null;
  return (
    <Pressable accessibilityRole="link" onPress={() => router.push('/gear')}>
      <Card>
        <Heading>{t('gear.title')}</Heading>
        {active.map((g) => (
          <View key={g.id} style={{ gap: 4, paddingVertical: 4 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: c.fg, fontWeight: '600' }}>{g.name}</Text>
              <Text style={{ color: g.over_limit ? c.zone5 : c.fg, fontVariant: ['tabular-nums'] }}>
                {format.distance(g.distance_m)}
              </Text>
            </View>
            {g.limit_m ? (
              <ProgressBar
                value={g.distance_m}
                max={g.limit_m}
                color={g.over_limit ? c.zone5 : c.accent}
                label={g.name}
              />
            ) : null}
          </View>
        ))}
      </Card>
    </Pressable>
  );
}

const goalName = (g: { period: string; sport: string | null }) =>
  `${t(`goals.period.${g.period}` as MessageKey)} · ${g.sport ? t(`sport.${asSport(g.sport)}`) : t('goals.allSports')}`;

// --- goals -----------------------------------------------------------------------------------------

/** The goals; with `withForm`, the form to add one under them (the modal on the Goals tab does without). */
export function Goals({ withForm = true }: { withForm?: boolean }) {
  const api = useApi();
  const c = useTheme();
  const format = useFormat();
  const queryClient = useQueryClient();
  const goals = useQuery(goalsQuery(api));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: goalsQuery(api).queryKey });
  const remove = useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/api/goals/{goal_id}', { params: { path: { goal_id: id } } });
    },
    onSuccess: refresh,
  });
  if (!goals.data) return null;
  return (
    <>
      {goals.data.length === 0 && <Muted>{t('goals.empty')}</Muted>}
      {goals.data.map((g) => (
        <GoalCard key={g.id} goal={g} format={format}>
          <Pressable
            accessibilityRole="button"
            disabled={remove.isPending}
            onPress={() =>
              Alert.alert(goalName(g), undefined, [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('goals.delete'), style: 'destructive', onPress: () => remove.mutate(g.id) },
              ])
            }
          >
            <Text style={{ color: c.accent, fontWeight: '600' }}>{t('goals.delete')}</Text>
          </Pressable>
        </GoalCard>
      ))}
      {withForm && <GoalForm unit={format.unit} onDone={refresh} />}
    </>
  );
}

/** Adding a goal; `bare` drops its card and heading, for a sheet that has its own title. */
export function GoalForm({ unit, onDone, bare }: { unit: string; onDone: () => void; bare?: boolean }) {
  const api = useApi();
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('week');
  const [metric, setMetric] = useState<'distance' | 'time' | 'count'>('distance');
  const [sport, setSport] = useState('');
  const [target, setTarget] = useState('');
  const value = Number(target.replace(',', '.'));

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/api/goals', {
        body: { period, metric, sport: sport || null, target: goalTarget(metric, value, unit) },
      });
      if (error) throw new Error('goal');
    },
    onSuccess: () => {
      setTarget('');
      onDone();
    },
  });
  return (
    <Card style={bare ? { borderWidth: 0, padding: 0, backgroundColor: 'transparent' } : undefined}>
      {!bare && <Heading>{t('goals.add')}</Heading>}
      <Muted>{t('stats.period')}</Muted>
      <Choice
        label={t('stats.period')}
        value={period}
        onChange={setPeriod}
        options={(['week', 'month', 'year'] as const).map((p) => ({
          value: p,
          label: t(`goals.period.${p}`),
        }))}
      />
      <Muted>{t('goals.measure')}</Muted>
      <Choice
        label={t('goals.measure')}
        value={metric}
        onChange={setMetric}
        options={(['distance', 'time', 'count'] as const).map((m) => ({
          value: m,
          label: t(`goals.metric.${m}`),
        }))}
      />
      <Muted>{t('feed.sports')}</Muted>
      <Choice
        scroll
        label={t('feed.sports')}
        value={sport}
        onChange={setSport}
        options={[
          { value: '', label: t('goals.allSports') },
          ...SPORTS.filter((s) => s !== 'other').map((s) => ({ value: s as string, label: t(`sport.${s}`) })),
        ]}
      />
      <Field
        label={`${t('goals.target')} (${metric === 'distance' ? unit : metric === 'time' ? 'h' : '#'})`}
        keyboardType="decimal-pad"
        value={target}
        onChangeText={setTarget}
      />
      <Button primary disabled={!(value > 0) || save.isPending} onPress={() => save.mutate()}>
        {t('goals.add')}
      </Button>
      {save.isError && <Muted accessibilityRole="alert">{t('common.error')}</Muted>}
    </Card>
  );
}

// --- the account -----------------------------------------------------------------------------------

export function Account({ me }: { me: Me }) {
  const { api, signOut } = useAuth();
  const c = useTheme();
  const queryClient = useQueryClient();
  const sources = useQuery(sourcesQuery(api));
  const garmin = sources.data?.find((s) => s.kind === 'garmin');
  const providers = useQuery({ ...providersQuery(api), retry: false });
  const unlink = useMutation({
    mutationFn: async () => {
      const { response } = await api.DELETE('/api/auth/google');
      if (!response.ok)
        throw new Error(response.status === 409 ? t('profile.googleNeedsOther') : t('common.error'));
    },
    onSuccess: () => queryClient.setQueryData(queryKeys.me, { ...me, google_linked: false }),
  });
  return (
    <>
      <Card>
        <Heading>{t('profile.signIn')}</Heading>
        <Text selectable style={{ color: c.fg, fontWeight: '700' }}>
          {me.email}
        </Text>
        <Muted>
          {t('profile.passwordTotp')}: {me.totp_enabled ? t('profile.on') : '—'}
        </Muted>
        {providers.data?.google && (
          <>
            <Heading>{t('profile.google')}</Heading>
            {me.google_linked ? (
              <>
                <Muted>{t('profile.googleLinked')}</Muted>
                <Button onPress={() => unlink.mutate()} disabled={unlink.isPending}>
                  {t('profile.googleUnlink')}
                </Button>
                {unlink.isError && <Muted accessibilityRole="alert">{unlink.error.message}</Muted>}
              </>
            ) : (
              <Muted>{t('mobile.googleLinkOnWeb')}</Muted>
            )}
          </>
        )}
      </Card>
      <Passkeys />
      <Card style={{ paddingVertical: 0, gap: 0 }}>
        {garmin && (
          <MenuRow
            label={t('settings.garmin')}
            note={garmin.configured ? t('settings.garminOn') : t('settings.garminOff')}
            onPress={() => router.push('/settings/account')}
          />
        )}
        <MenuRow label={t('settings.sessions')} onPress={() => router.push('/settings/account')} last />
      </Card>
      <Button onPress={() => void signOut()}>{t('nav.signOut')}</Button>
    </>
  );
}

/** Passkeys are created in a browser (WebAuthn); the phone lists them and removes them. */
function Passkeys() {
  const api = useApi();
  const queryClient = useQueryClient();
  const passkeys = useQuery(passkeysQuery(api));
  const remove = useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/api/auth/passkeys/{passkey_id}', { params: { path: { passkey_id: id } } });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: passkeysQuery(api).queryKey }),
  });
  const add = useMutation({
    mutationFn: () => addPasskey(api),
    onSuccess: (added) => {
      if (added) void queryClient.invalidateQueries({ queryKey: passkeysQuery(api).queryKey });
    },
  });
  return (
    <Card>
      <Heading>{t('profile.passkeys')}</Heading>
      <Muted>{t('profile.passkeysHelp')}</Muted>
      <Muted>{t('mobile.passkeysOnWeb')}</Muted>
      {passkeys.data?.length === 0 && <Muted>{t('profile.noPasskeys')}</Muted>}
      {passkeys.data?.map((p) => (
        <ListRow
          key={p.id}
          title={p.name}
          note={t('profile.passkeyMeta', {
            created: day(p.created_at),
            used: p.last_used_at
              ? t('profile.lastUsed', { date: day(p.last_used_at) })
              : t('profile.neverUsed'),
          })}
        >
          <Button
            disabled={remove.isPending}
            onPress={() =>
              Alert.alert(p.name, t('profile.removePasskey'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('profile.removePasskey'),
                  style: 'destructive',
                  onPress: () => remove.mutate(p.id),
                },
              ])
            }
          >
            {t('profile.removePasskey')}
          </Button>
        </ListRow>
      ))}
      {passkeysSupported() && (
        <Button disabled={add.isPending} onPress={() => add.mutate()}>
          {t('profile.addPasskey')}
        </Button>
      )}
      {add.data === true && <Muted accessibilityRole="alert">{t('profile.passkeyAdded')}</Muted>}
      {add.isError && (
        <Muted accessibilityRole="alert">
          {add.error instanceof SignInError ? add.error.message : t('profile.passkeyFailed')}
        </Muted>
      )}
    </Card>
  );
}
