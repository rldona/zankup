import {
  aiStatusQuery,
  formatHoursMinutes,
  formatters,
  meQuery,
  passkeysQuery,
  profileSummaryQuery,
  providersQuery,
  queryKeys,
  SPORTS,
  type Me,
  type MessageKey,
  type ProfileSummary,
  type Sport,
  effortShown,
} from '@zankup/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';

import { api } from '../api';
import { Modal } from '../detail/Tools';
import { forgetOfflineData } from '../offline';
import { locale, t } from '../i18n';
import { usePrefs } from '../prefs';
import { deviceName } from '../signin/device';
import { attestationJson, creationOptions, passkeysSupported } from '../signin/webauthn';
import { SportIcon } from '../SportIcon';
import { CardTitle, Menu } from '../ui';
import { MaterialIcon } from '../MaterialIcon';
import { DESKTOP } from '../media';
import { CardSkeleton, PageSkeleton, Pulse } from '../Skeleton';

const asSport = (value: string): Sport =>
  (SPORTS as readonly string[]).includes(value) ? (value as Sport) : 'other';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Profile (OS-218): header with name, location, streak and watch; the year's numbers; tabs for the
 * summary, goals, estimates, gear and the account (sources, sign-in methods with passkeys). On
 * mobile it is the "You" tab and leads to Settings.
 */
export function Profile() {
  const me = useQuery(meQuery(api));
  const summary = useQuery(profileSummaryQuery(api));
  const ai = useQuery({ ...aiStatusQuery(api), retry: false });
  const [params] = useSearchParams();
  const [editing, setEditing] = useState(false);

  // You's old tabs each have their own page now.
  const tab = params.get('tab');
  const moved: Record<string, string> = {
    goals: '/goals',
    estimates: '/estimates',
    gear: '/gear',
    account: '/settings/account',
  };
  if (tab && moved[tab]) return <Navigate to={moved[tab]} replace />;
  if (!me.data) return <PageSkeleton />;

  return (
    <section className="page profile">
      {/* Desktop: the profile and the menu in a fixed column on the left, the numbers on the right. */}
      <div className="youside">
        <Header me={me.data} summary={summary.data} onEdit={() => setEditing(true)} />
        {editing && (
          <Modal title={t('profile.edit')} onClose={() => setEditing(false)}>
            <EditProfile me={me.data} onDone={() => setEditing(false)} />
          </Modal>
        )}
        <Menu
          label={t('nav.you')}
          items={[
            { to: '/stats', icon: 'bar_chart', label: t('nav.stats') },
            { to: '/estimates', icon: 'speed', label: t('stats.estimates') },
            ...(ai.data?.available && ai.data.enabled
              ? [{ to: '/coach', icon: 'wand_stars' as const, label: t('coach.title') }]
              : []),
            { to: '/gear', icon: 'footprint', label: t('gear.title') },
            { to: '/settings/import', icon: 'upload', label: t('import.title') },
            { to: '/settings/account', icon: 'account_circle', label: t('profile.tab.account') },
            { to: '/settings', icon: 'settings', label: t('nav.settings') },
          ]}
        />
      </div>
      <div className="youmain">
        {summary.data && <YearNumbers summary={summary.data} />}
        <Summary me={me.data} summary={summary.data} />
      </div>
    </section>
  );
}

function initials(me: Me): string {
  const name = me.display_name ?? me.email;
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function Header({ me, summary, onEdit }: { me: Me; summary?: ProfileSummary; onEdit: () => void }) {
  return (
    <header className="phead">
      {me.avatar_url ? (
        <img className="avatar" src={me.avatar_url} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span className="avatar" aria-hidden="true">
          {initials(me)}
        </span>
      )}
      <div className="grow">
        <h1>{me.display_name ?? me.email}</h1>
        {me.location && <p className="note">{me.location}</p>}
        {summary && (
          <span className="badge streak">{t('profile.streak', { count: summary.streak_weeks })}</span>
        )}
      </div>
      <div className="actions">
        <button type="button" onClick={onEdit}>
          {t('profile.edit')}
        </button>
      </div>
    </header>
  );
}

function YearNumbers({ summary }: { summary: ProfileSummary }) {
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  const total = summary.this_year.reduce(
    (sum, s) => ({
      count: sum.count + s.count,
      distance: sum.distance + s.distance_m,
      time: sum.time + s.moving_s,
      ascent: sum.ascent + s.ascent_m,
    }),
    { count: 0, distance: 0, time: 0, ascent: 0 },
  );
  return (
    <>
      <h2>{t('profile.year', { year: summary.year })}</h2>
      <dl className="kpis num">
        <div className="kpi">
          <dd>{total.count.toLocaleString(locale)}</dd>
          <dt>{t('feed.title')}</dt>
        </div>
        <div className="kpi">
          <dd>{format.distance(total.distance)}</dd>
          <dt>{t('feed.stat.distance')}</dt>
        </div>
        <div className="kpi">
          <dd>{formatHoursMinutes(total.time)}</dd>
          <dt>{t('feed.stat.time')}</dt>
        </div>
        <div className="kpi">
          <dd>{format.elevation(total.ascent)}</dd>
          <dt>{t('feed.stat.ascent')}</dt>
        </div>
      </dl>
    </>
  );
}

/**
 * A table that scrolls sideways on a narrow screen instead of wrapping inside its cells; reachable with
 * the keyboard, so it can be scrolled without a mouse.
 */
function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tablescroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

function SportTable({ rows, label }: { rows: ProfileSummary['this_year']; label: string }) {
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  return (
    <TableScroll label={label}>
      <table className="num">
        <tbody>
          {rows.map((s) => {
            const sport = asSport(s.sport);
            return (
              <tr key={s.sport}>
                <th scope="row">
                  <span className="cell-sport">
                    <SportIcon sport={sport} />
                    {t(`sport.${sport}`)}
                  </span>
                </th>
                <td>{t('profile.activities', { count: s.count })}</td>
                <td>{s.distance_m ? format.distance(s.distance_m) : '—'}</td>
                <td>{formatHoursMinutes(s.moving_s)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}

const EFFORTS: Record<string, MessageKey> = {
  '400m': 'effort.400m',
  half_mile: 'effort.half_mile',
  '1k': 'effort.1k',
  '1mile': 'effort.1mile',
  '2mile': 'effort.2mile',
  '5k': 'effort.5k',
  '10k': 'effort.10k',
  '15k': 'effort.15k',
  '10mile': 'effort.10mile',
  half_marathon: 'effort.half_marathon',
  marathon: 'effort.marathon',
};

function effortLabel(key: string): string | null {
  const label = EFFORTS[key];
  return label ? t(label) : null;
}

const HIDDEN_KEY = 'zankup-physical-hidden';

/**
 * Whether the physical data start hidden: as left in this browser, else hidden on a large screen (where
 * others may see it, docs/prototypes/web) and shown on a phone, as the app.
 */
function readHidden(): boolean {
  const large = typeof matchMedia !== 'undefined' && matchMedia(DESKTOP).matches;
  try {
    const stored = localStorage.getItem(HIDDEN_KEY);
    return stored === null ? large : stored === '1';
  } catch {
    return large;
  }
}

function writeHidden(hidden: boolean) {
  try {
    localStorage.setItem(HIDDEN_KEY, hidden ? '1' : '0');
  } catch {
    // Storage blocked: hidden for this page only.
  }
}

function Summary({ me, summary }: { me: Me; summary?: ProfileSummary }) {
  const [today] = useState(() => new Date());
  const [hidden, setHidden] = useState(readHidden);
  const prefs = usePrefs();
  const format = useMemo(() => formatters(prefs), [prefs]);
  if (!summary)
    return (
      <Pulse>
        <CardSkeleton />
        <CardSkeleton />
      </Pulse>
    );
  const age = me.birth_date ? ageOn(me.birth_date, today) : null;
  const physical: [MessageKey, string][] = [];
  if (age != null) physical.push(['profile.age', t('profile.years', { count: age })]);
  if (me.sex) physical.push(['profile.sex', t(`profile.sex.${me.sex}`)]);
  if (me.weight_kg) physical.push(['profile.weight', me.weight_kg.toLocaleString(locale)]);
  if (me.height_cm) physical.push(['profile.height', String(me.height_cm)]);
  if (prefs.hrMax) physical.push(['settings.hrMax', `${prefs.hrMax} bpm`]);
  return (
    <div className="grid2">
      <section className="panel">
        <div className="ph">
          <h2>{t('profile.byYear')}</h2>
        </div>
        <SportTable rows={summary.this_year} label={t('profile.byYear')} />
      </section>
      <section className="panel">
        <div className="ph">
          <h2>{t('profile.allTime')}</h2>
          {summary.since && <span className="note">{t('profile.since', { date: day(summary.since) })}</span>}
        </div>
        <SportTable rows={summary.all_time} label={t('profile.allTime')} />
      </section>
      <section className="panel">
        <div className="ph">
          <h2>{t('profile.records')}</h2>
        </div>
        {summary.records.length ? (
          <TableScroll label={t('profile.records')}>
            <table className="num">
              <tbody>
                {summary.records
                  .filter((r) => effortShown(r.distance_key, format.unit))
                  .map((r) => (
                    <tr key={r.distance_key}>
                      <th scope="row">{effortLabel(r.distance_key) ?? format.distance(r.distance_m)}</th>
                      <td>{formatHoursMinutesOrClock(r.time_s)}</td>
                      <td>{format.pace(r.distance_m / r.time_s)}</td>
                      <td>
                        <Link to={`/activities/${r.activity_id}`}>{day(r.date)}</Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </TableScroll>
        ) : (
          <p className="note">{t('profile.noRecords')}</p>
        )}
      </section>
      <section className="panel">
        {/* As on the app: an eye hides what you would rather not show (age, weight…), and remembers it. */}
        <CardTitle
          right={
            <button
              type="button"
              className="mapbtn flat"
              aria-label={t(hidden ? 'profile.showPhysical' : 'profile.hidePhysical')}
              title={t(hidden ? 'profile.showPhysical' : 'profile.hidePhysical')}
              aria-pressed={hidden}
              onClick={() => {
                writeHidden(!hidden);
                setHidden(!hidden);
              }}
            >
              <MaterialIcon name={hidden ? 'visibility_off' : 'visibility'} />
            </button>
          }
        >
          {t('profile.physical')}
        </CardTitle>
        <dl className="pairs">
          {physical.map(([label, value]) => (
            <div key={label}>
              <dt>{t(label)}</dt>
              <dd className={hidden ? 'masked' : undefined}>{hidden ? '•••' : value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/** Whole years from a date of birth ("YYYY-MM-DD") to a day. */
function ageOn(birth: string, today: Date): number {
  const [y = 0, m = 1, d = 1] = birth.split('-').map(Number);
  const before = today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d);
  return today.getFullYear() - y - (before ? 1 : 0);
}

function formatHoursMinutesOrClock(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
}

function EditProfile({ me, onDone }: { me: Me; onDone: () => void }) {
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
      const { data, error } = await api.PATCH('/api/auth/me', {
        body: {
          ...(form.display_name.trim() ? { display_name: form.display_name.trim() } : {}),
          location: form.location.trim() || null,
          birth_date: form.birth_date || null,
          sex: (form.sex || null) as Me['sex'],
          weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
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
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [name]: e.target.value }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <form className="editprofile" onSubmit={submit}>
      <div className="fields">
        <label className="field">
          <b>{t('profile.name')}</b>
          <input {...field('display_name')} autoComplete="name" required maxLength={120} />
        </label>
        <label className="field">
          <b>{t('profile.location')}</b>
          <input {...field('location')} maxLength={120} />
        </label>
        <label className="field">
          <b>{t('profile.birth')}</b>
          <input type="date" {...field('birth_date')} />
        </label>
        <label className="field">
          <b>{t('profile.sex')}</b>
          <select {...field('sex')}>
            <option value="">{t('profile.sex.none')}</option>
            <option value="female">{t('profile.sex.female')}</option>
            <option value="male">{t('profile.sex.male')}</option>
            <option value="other">{t('profile.sex.other')}</option>
          </select>
        </label>
        <label className="field">
          <b>{t('profile.weight')}</b>
          <input type="number" step="0.1" min={20} max={300} inputMode="decimal" {...field('weight_kg')} />
        </label>
        <label className="field">
          <b>{t('profile.height')}</b>
          <input type="number" min={100} max={250} inputMode="numeric" {...field('height_cm')} />
        </label>
      </div>
      {save.isError && (
        <p className="note" role="alert">
          {save.error.message || t('common.error')}
        </p>
      )}
      <div className="actions end">
        <button type="button" onClick={onDone}>
          {t('profile.cancel')}
        </button>
        <button type="submit" className="primary" disabled={save.isPending}>
          {t('settings.save')}
        </button>
      </div>
    </form>
  );
}

/** How you sign in (email, code, passkeys, Google) and signing out: Settings › Account (OS-914). */
export function Account({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signOut = async () => {
    await api.POST('/api/auth/logout');
    queryClient.clear();
    await forgetOfflineData();
    void navigate('/sign-in', { replace: true });
  };

  return (
    <section className="panel">
      <CardTitle>{t('profile.signIn')}</CardTitle>
      <p>
        <b>{me.email}</b>
      </p>
      <p className="note">
        {t('profile.passwordTotp')}: {me.totp_enabled ? t('profile.on') : '—'}
      </p>
      <Passkeys />
      <Google me={me} />
      <div className="actions signout">
        <button type="button" onClick={() => void signOut()}>
          {t('nav.signOut')}
        </button>
      </div>
    </section>
  );
}

/** Link or unlink a Google account (OS-220), when this instance offers it. */
function Google({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const providers = useQuery({ ...providersQuery(api), retry: false });
  const [params] = useSearchParams();
  const unlink = useMutation({
    mutationFn: async () => {
      const { response } = await api.DELETE('/api/auth/google');
      if (!response.ok)
        throw new Error(response.status === 409 ? t('profile.googleNeedsOther') : t('common.error'));
    },
    onSuccess: () => queryClient.setQueryData(queryKeys.me, { ...me, google_linked: false }),
  });
  if (!providers.data?.google) return null;
  return (
    <>
      <h3>{t('profile.google')}</h3>
      {params.get('google') === 'error' && (
        <p className="note" role="alert">
          {t('profile.googleError')}
        </p>
      )}
      {me.google_linked ? (
        <div className="rows">
          <p className="note">{t('profile.googleLinked')}</p>
          <button type="button" onClick={() => unlink.mutate()} disabled={unlink.isPending}>
            {t('profile.googleUnlink')}
          </button>
          {unlink.isError && (
            <p className="note" role="alert">
              {unlink.error.message}
            </p>
          )}
        </div>
      ) : (
        <a className="button" href="/api/auth/google/start?mode=link">
          {t('profile.googleLink')}
        </a>
      )}
    </>
  );
}

function Passkeys() {
  const queryClient = useQueryClient();
  const passkeys = useQuery(passkeysQuery(api));
  const [message, setMessage] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: passkeysQuery(api).queryKey });

  const add = useMutation({
    mutationFn: async () => {
      const { data } = await api.POST('/api/auth/passkeys/register/options');
      if (!data) throw new Error('options');
      const credential = (await navigator.credentials.create({
        publicKey: creationOptions(data.options),
      })) as PublicKeyCredential | null;
      if (!credential) throw new Error('cancelled');
      const done = await api.POST('/api/auth/passkeys/register', {
        body: { credential: attestationJson(credential), name: deviceName() },
      });
      if (!done.data) throw new Error('register');
    },
    onSuccess: () => {
      setMessage(t('profile.passkeyAdded'));
      void refresh();
    },
    onError: () => setMessage(t('profile.passkeyFailed')),
  });
  const remove = useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/api/auth/passkeys/{passkey_id}', { params: { path: { passkey_id: id } } });
    },
    onSuccess: () => void refresh(),
  });

  return (
    <>
      <h3>{t('profile.passkeys')}</h3>
      <p className="note">{t('profile.passkeysHelp')}</p>
      {passkeys.data?.length === 0 && <p className="note">{t('profile.noPasskeys')}</p>}
      <ul className="rows">
        {passkeys.data?.map((p) => (
          <li key={p.id}>
            <span>
              <b>{p.name}</b>
              <small className="note">
                {t('profile.passkeyMeta', {
                  created: day(p.created_at),
                  used: p.last_used_at
                    ? t('profile.lastUsed', { date: day(p.last_used_at) })
                    : t('profile.neverUsed'),
                })}
              </small>
            </span>
            <button type="button" onClick={() => remove.mutate(p.id)} disabled={remove.isPending}>
              {t('profile.removePasskey')}
            </button>
          </li>
        ))}
      </ul>
      {passkeysSupported() ? (
        <button type="button" onClick={() => add.mutate()} disabled={add.isPending}>
          {t('profile.addPasskey')}
        </button>
      ) : (
        <p className="note">{t('profile.passkeyUnsupported')}</p>
      )}
      {message && (
        <p className="note" role="status">
          {message}
        </p>
      )}
    </>
  );
}
