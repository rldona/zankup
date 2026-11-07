"""Genera docs/prototipos/data.js a partir de data/activities/*.fit|json (datos reales)."""
import csv, glob, gzip, io, json, math, os, sys
import xml.etree.ElementTree as ET
from concurrent.futures import ProcessPoolExecutor
from zoneinfo import ZoneInfo
from datetime import datetime, date, timedelta
import fitdecode

ROOT = sys.argv[1]
OUT = os.path.join(ROOT, 'docs/prototipos/data.js')
HR_MAX, HR_REST = 185, 50
ZB = [0.5, 0.6, 0.7, 0.8, 0.9]  # límites inferiores Z1..Z5 en % FC máx
K = 180 / 2**31
BEST = [(400, '400 m'), (805, '½ milla'), (1000, '1 km'), (1609, '1 milla'), (3219, '2 millas'), (5000, '5 km'), (10000, '10 km'), (21097, 'Media'), (42195, 'Maratón')]
PDUR = [5, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600]

def sport_of(meta):
    t = (meta.get('activityType') or {}).get('typeKey', '')
    if 'run' in t: return 'run'
    if 'ride' in t or 'cycl' in t or 'bik' in t: return 'ride'
    if 'strength' in t or 'fitness' in t: return 'strength'
    if 'walk' in t or 'hik' in t: return 'walk'
    return 'other'

def read_fit(p):
    recs, laps, ses, prof = [], [], {}, {}
    with fitdecode.FitReader(p) as fr:
        for m in fr:
            if not isinstance(m, fitdecode.FitDataMessage): continue
            g = lambda n: m.get_value(n, fallback=None)
            if m.name == 'record':
                ts = g('timestamp')
                if ts is None: continue
                lat, lon = g('position_lat'), g('position_long')
                recs.append(dict(t=ts.timestamp(), d=g('distance'), lat=lat*K if lat is not None else None,
                                 lon=lon*K if lon is not None else None, ele=g('enhanced_altitude') or g('altitude'),
                                 hr=g('heart_rate'), cad=g('cadence'), v=g('enhanced_speed') or g('speed'), pw=g('power')))
            elif m.name == 'lap':
                laps.append(dict(d=round(g('total_distance') or 0), t=round(g('total_timer_time') or 0), hr=g('avg_heart_rate'),
                                 asc=g('total_ascent'), desc=g('total_descent'), pw=g('avg_power')))
            elif m.name == 'session':
                ses = dict(np=g('normalized_power'), ap=g('avg_power'))
            elif m.name == 'user_profile':
                prof = dict(weight=g('weight'), height=g('height'), gender=g('gender'))
    return recs, laps, ses, prof

def trimp(recs):
    s, prev = 0.0, None
    for r in recs:
        if prev is not None and r['hr']:
            dt = min(r['t'] - prev, 10)
            x = max(0.0, (r['hr'] - HR_REST) / (HR_MAX - HR_REST))
            s += dt / 60 * x * 0.64 * math.exp(1.92 * x)
        prev = r['t']
    return round(s)

def zones(recs):
    z, prev = [0] * 5, None
    for r in recs:
        if prev is not None and r['hr']:
            dt = min(r['t'] - prev, 10); f = r['hr'] / HR_MAX
            i = max([k for k, b in enumerate(ZB) if f >= b], default=-1)
            if i >= 0: z[i] += dt
        prev = r['t']
    return [round(x) for x in z]

def best_efforts(recs):
    pts = [(r['t'], r['d']) for r in recs if r['d'] is not None]
    out = []
    for D, lab in BEST:
        if not pts or pts[-1][1] - pts[0][1] < D: break
        best, j = 1e9, 0
        for i in range(len(pts)):
            while j < len(pts) and pts[j][1] - pts[i][1] < D: j += 1
            if j == len(pts): break
            best = min(best, pts[j][0] - pts[i][0])
        if D / best > 6.0: continue   # más rápido que 2:47/km: error de GPS, se descarta
        out.append(dict(d=D, label=lab, t=round(best)))
    return out

def power_curve(recs):
    pw = [r['pw'] or 0 for r in recs if r['pw'] is not None]
    if len(pw) < 60: return []
    cs = [0]
    for x in pw: cs.append(cs[-1] + x)
    out = []
    for D in PDUR:
        if D > len(pw): break
        out.append(dict(s=D, w=round(max(cs[i + D] - cs[i] for i in range(len(pw) - D + 1)) / D)))
    return out

def simplify(pts, n):
    if len(pts) <= n: return pts
    step = len(pts) / n
    return [pts[int(i * step)] for i in range(n)] + [pts[-1]]

def derived(recs, sp):
    """Métricas y series a partir de los registros a 1 Hz (común a Garmin y Strava)."""
    t0 = recs[0]['t'] if recs else 0
    keep = simplify(recs, 600)
    gps = [r for r in recs if r['lat'] is not None]
    st = dict(t=[round(r['t'] - t0) for r in keep], d=[round(r['d'] or 0, 1) for r in keep],
              hr=[r['hr'] for r in keep], ele=[round(r['ele'], 1) if r['ele'] is not None else None for r in keep])
    if gps:
        st['lat'] = [round(r['lat'], 5) if r['lat'] is not None else None for r in keep]
        st['lon'] = [round(r['lon'], 5) if r['lon'] is not None else None for r in keep]
        st['v'] = [round(r['v'] or 0, 2) for r in keep]
    if any(r['pw'] for r in recs): st['pw'] = [r['pw'] for r in keep]
    if sp == 'run': st['cad'] = [(r['cad'] or 0) * 2 for r in keep]
    route = [[round(r['lat'], 5), round(r['lon'], 5)] for r in simplify(gps, 60)] if gps else None
    return dict(trimp=trimp(recs), zones=zones(recs), best=best_efforts(recs) if sp == 'run' else [],
                pcurve=power_curve(recs), route=route, streams=st if recs else None)

acts = []
LAST_PROFILE = ['', {}]
OWNER = {}
for jp in sorted(glob.glob(os.path.join(ROOT, 'data/activities/*.json'))):
    meta = json.load(open(jp)); aid = meta['activityId']
    fp = jp[:-5] + '.fit'
    recs, laps, ses, prof = read_fit(fp) if os.path.exists(fp) else ([], [], {}, {})
    if prof and meta.get('startTimeLocal', '') > LAST_PROFILE[0]: LAST_PROFILE[:] = [meta['startTimeLocal'], prof]
    OWNER.update(name=meta.get('ownerFullName'), display=meta.get('ownerDisplayName'))
    dur = meta.get('duration') or 0
    if dur < 120: continue  # descartamos fragmentos de menos de 2 min
    sp = sport_of(meta)
    der = derived(recs, sp)
    acts.append(dict(
        id=aid, name=meta.get('activityName'), sport=sp, type=(meta.get('activityType') or {}).get('typeKey'),
        start=meta.get('startTimeLocal'), dist=round(meta.get('distance') or 0), dur=round(dur),
        moving=round(meta.get('movingDuration') or dur), asc=meta.get('elevationGain'), desc=meta.get('elevationLoss'),
        hr=meta.get('averageHR'), hrmax=meta.get('maxHR'), kcal=meta.get('calories'),
        te=meta.get('aerobicTrainingEffect'), ate=meta.get('anaerobicTrainingEffect'), load=meta.get('activityTrainingLoad'),
        location=meta.get('locationName'), avgpw=ses.get('ap') or meta.get('avgPower'), np=ses.get('np') or meta.get('normPower'),
        laps=laps, device=(meta.get('deviceName') or 'fēnix 6X Pro'), gmt=meta.get('startTimeGMT'), source='garmin', **der))

# ---------- histórico de Strava (exportación masiva) ----------
SDIR = os.path.join(ROOT, 'strava/export_95859')
MES = {'ene':1,'feb':2,'mar':3,'abr':4,'may':5,'jun':6,'jul':7,'ago':8,'sept':9,'sep':9,'oct':10,'nov':11,'dic':12}
S_SPORT = {'Carrera':'run', 'Bicicleta':'ride', 'Bicicleta virtual':'ride', 'Entrenamiento con pesas':'strength', 'Entrenamiento':'strength',
           'Caminata':'walk', 'Senderismo':'walk', 'Remo':'row', 'Natación':'swim'}
MADRID = ZoneInfo('Europe/Madrid')

def s_date(s):
    d, tm = s.split(', '); dd, mm, yy = d.split(' '); h, mi, se = map(int, tm.split(':'))
    return datetime(int(yy), MES[mm.strip('.')], int(dd), h, mi, se, tzinfo=ZoneInfo('UTC'))

def hav(a, b):
    R = 6371008.8; p1, p2 = math.radians(a[0]), math.radians(b[0]); dp = p2 - p1; dl = math.radians(b[1] - a[1])
    return 2 * R * math.asin(math.sqrt(math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2))

def local(tag): return tag.rsplit('}', 1)[-1]
def child(el, name):
    for c in el.iter():
        if local(c.tag) == name: return c
    return None
def fnum(el):
    try: return float(el.text) if el is not None and el.text else None
    except ValueError: return None
def ptime(s): return datetime.fromisoformat(s.strip().replace('Z', '+00:00')).timestamp()

def read_xml(raw, kind):
    root = ET.fromstring(raw.lstrip()); recs = []   # los TCX de Strava traen espacios antes de la cabecera XML
    pts = [e for e in root.iter() if local(e.tag) == ('Trackpoint' if kind == 'tcx' else 'trkpt')]
    for e in pts:
        tm = child(e, 'Time' if kind == 'tcx' else 'time')
        if tm is None or not tm.text: continue
        if kind == 'tcx':
            la, lo = fnum(child(e, 'LatitudeDegrees')), fnum(child(e, 'LongitudeDegrees'))
            ele, d = fnum(child(e, 'AltitudeMeters')), fnum(child(e, 'DistanceMeters'))
            hrv = child(e, 'HeartRateBpm'); hr = fnum(child(hrv, 'Value')) if hrv is not None else None
            cad, pw, v = fnum(child(e, 'Cadence')) or fnum(child(e, 'RunCadence')), fnum(child(e, 'Watts')), fnum(child(e, 'Speed'))
        else:
            la, lo = float(e.get('lat')), float(e.get('lon'))
            ele, d = fnum(child(e, 'ele')), None
            hr, cad = fnum(child(e, 'hr')), fnum(child(e, 'cad'))
            pw, v = fnum(child(e, 'power')) or fnum(child(e, 'PowerInWatts')), None
        recs.append(dict(t=ptime(tm.text), d=d, lat=la, lon=lo, ele=ele, hr=int(hr) if hr else None, cad=cad, v=v, pw=pw))
    recs.sort(key=lambda r: r['t'])
    if recs and all(r['d'] is None for r in recs):   # GPX: distancia acumulada por haversine
        acc, prev = 0.0, None
        for r in recs:
            if r['lat'] is not None and prev is not None: acc += hav((prev['lat'], prev['lon']), (r['lat'], r['lon']))
            if r['lat'] is not None: prev = r
            r['d'] = acc
    return recs

def strava_one(row):
    """Se ejecuta en un proceso aparte: lee el fichero de una actividad y calcula sus métricas."""
    sp, fn = row['sport'], row['file']
    recs, laps, ses = [], [], {}
    if fn:
        try:
            p = os.path.join(SDIR, fn)
            raw = gzip.open(p).read() if p.endswith('.gz') else open(p, 'rb').read()
            if '.fit' in fn:
                recs, laps, ses, _ = read_fit(io.BytesIO(raw))
            else:
                recs = read_xml(raw, 'tcx' if '.tcx' in fn else 'gpx')
        except Exception as e:
            row['error'] = f'{type(e).__name__}: {e}'[:120]
    row.update(laps=laps if len(laps) > 1 else [], **derived(recs, sp))
    if '.gpx' in (fn or ''): row['best'] = []   # GPX: distancia calculada con GPS, demasiado ruidosa para récords
    if ses.get('np'): row['np'] = ses['np']
    return row

def load_strava():
    rows = list(csv.reader(open(os.path.join(SDIR, 'activities.csv'), encoding='utf-8')))
    h = rows[0]
    col = lambda name, occ=0: [i for i, x in enumerate(h) if x == name][occ]
    C = dict(id=col('ID de actividad'), date=col('Fecha de la actividad'), name=col('Nombre de la actividad'), type=col('Tipo de actividad'),
             desc=col('Descripción de la actividad'), gear=col('Equipamiento de la actividad'), file=col('Nombre del archivo'),
             el=col('Tiempo transcurrido', 1), mv=col('Tiempo en movimiento'), dist=col('Distancia', 1), asc=col('Desnivel positivo'),
             dsc=col('Desnivel negativo'), hrmax=col('Frecuencia cardiaca máxima', 1), hr=col('Frecuencia cardiaca promedio'),
             kcal=col('Calorías'), re=col('Esfuerzo Relativo', 1), w=col('Vatios promedio'), np=col('Potencia promedio ponderada'),
             gap=col('Distancia ajustada en pendientes'), wx=col('Condición meteorológica'), tw=col('Temperatura meteorológica'))
    num = lambda r, k: (float(r[C[k]]) if r[C[k]].strip() else None) if C[k] < len(r) else None
    out = []
    for r in rows[1:]:
        utc = s_date(r[C['date']]); loc = utc.astimezone(MADRID)
        el = num(r, 'el') or 0
        if el < 120: continue
        out.append(dict(id='s' + r[C['id']], strava_id=r[C['id']], name=r[C['name']], sport=S_SPORT.get(r[C['type']], 'other'), type=r[C['type']],
                        start=loc.strftime('%Y-%m-%d %H:%M:%S'), gmt=utc.strftime('%Y-%m-%d %H:%M:%S'), dist=round(num(r, 'dist') or 0),
                        dur=round(el), moving=round(num(r, 'mv') or el), asc=num(r, 'asc'), desc=num(r, 'dsc'),
                        hr=round(num(r, 'hr')) if num(r, 'hr') else None, hrmax=round(num(r, 'hrmax')) if num(r, 'hrmax') else None,
                        kcal=round(num(r, 'kcal')) if num(r, 'kcal') else None, te=None, ate=None, load=None, location=None,
                        avgpw=round(num(r, 'w')) if num(r, 'w') else None, np=round(num(r, 'np')) if num(r, 'np') else None,
                        description=r[C['desc']].strip() or None, gear=r[C['gear']].strip() or None,
                        strava_re=round(num(r, 're')) if num(r, 're') else None, gap_dist=num(r, 'gap'),
                        weather=(r[C['wx']].strip() + (f" · {round(num(r, 'tw'))} °C" if num(r, 'tw') is not None else '')) if C['wx'] < len(r) and r[C['wx']].strip() else None,
                        file=r[C['file']].strip(), device=None, source='strava'))
    return out

strava_rows = load_strava() if os.path.isdir(SDIR) else []
g_by_time = sorted(((datetime.fromisoformat(a['gmt']).timestamp(), a) for a in acts if a.get('gmt')), key=lambda x: x[0])
import bisect
g_keys = [k for k, _ in g_by_time]
todo, merged = [], 0
for s in strava_rows:
    ts = datetime.fromisoformat(s['gmt']).timestamp()
    i = bisect.bisect_left(g_keys, ts - 120)
    match = next((a for k, a in g_by_time[i:i+3] if abs(k - ts) <= 120), None)
    if match:   # misma actividad: gana el FIT de Garmin y se conservan los datos que pone el usuario en Strava
        match.update(name=s['name'] or match['name'], description=s['description'], gear=s['gear'], strava_re=s['strava_re'],
                     gap_dist=s['gap_dist'], weather=s['weather'], strava_id=s['strava_id'], source='garmin+strava')
        merged += 1
    else:
        todo.append(s)
t_start = datetime.now()
import multiprocessing  # 'fork': el script no tiene __main__ y en Python 3.14 el método por defecto es forkserver
with ProcessPoolExecutor(mp_context=multiprocessing.get_context('fork')) as ex:
    parsed = list(ex.map(strava_one, todo, chunksize=8))
errors = [p for p in parsed if p.get('error')]
for p in parsed: p.pop('file', None)
acts.extend(parsed)
print(f'Strava: {len(strava_rows)} filas, {merged} fusionadas con Garmin, {len(parsed)} añadidas, {len(errors)} con error de lectura, {(datetime.now()-t_start).seconds} s')
for e in errors[:5]: print('   ', e['id'], e['type'], e['error'])
acts.sort(key=lambda a: a['start'], reverse=True)
for a in acts[80:]:
    a['streams'] = None

# Forma (CTL 42 d), fatiga (ATL 7 d) y frescura (TSB) por día
byday = {}
for a in acts:
    d = a['start'][:10]; byday[d] = byday.get(d, 0) + a['trimp']
d0 = date.fromisoformat(min(byday)); d1 = date.fromisoformat(max(a['start'][:10] for a in acts))
d1 = max(d1, date(2026, 11, 7))
ctl = atl = 0.0; daily = []
d = d0
while d <= d1:
    tr = byday.get(d.isoformat(), 0)
    tsb = ctl - atl
    ctl += (tr - ctl) / 42; atl += (tr - atl) / 7
    daily.append(dict(date=d.isoformat(), trimp=tr, ctl=round(ctl, 1), atl=round(atl, 1), tsb=round(tsb, 1)))
    d += timedelta(days=1)

# Récords personales (mejor marca entre todas las carreras)
prs = {}
for a in acts:
    for b in a['best']:
        if b['label'] not in prs or b['t'] < prs[b['label']]['t']:
            prs[b['label']] = dict(**b, id=a['id'], date=a['start'][:10])
pcurve = {}
for a in acts:
    for p in a['pcurve']:
        if p['s'] not in pcurve or p['w'] > pcurve[p['s']]['w']:
            pcurve[p['s']] = dict(**p, id=a['id'])

# ---------- racha, totales, estimaciones, estado diario ----------
TODAY = date(2026, 11, 7)
def monday(d): return d - timedelta(days=d.weekday())
weeks_active = {monday(date.fromisoformat(a['start'][:10])) for a in acts}
streak, w = 0, monday(TODAY)
if w not in weeks_active: w -= timedelta(days=7)   # la semana en curso aún puede llenarse
while w in weeks_active: streak += 1; w -= timedelta(days=7)

def totals(lst):
    out = {}
    for a in lst:
        s = out.setdefault(a['sport'], dict(n=0, dist=0, time=0, asc=0))
        s['n'] += 1; s['dist'] += a['dist']; s['time'] += a['moving']; s['asc'] += a['asc'] or 0
    return out
year = [a for a in acts if a['start'].startswith(str(TODAY.year))]

def vdot(dist_m, t_s):
    v = dist_m / (t_s / 60); tm = t_s / 60
    vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v
    pct = 0.8 + 0.1894393 * math.exp(-0.012778 * tm) + 0.2989558 * math.exp(-0.1932605 * tm)
    return vo2 / pct
def pace_at(vd, frac):   # velocidad (m/s) a una fracción del VO2max
    target = vd * frac; a, b, c = 0.000104, 0.182258, -4.60 - target
    return (-b + math.sqrt(b*b - 4*a*c)) / (2*a) / 60
recent = [a for a in acts if date.fromisoformat(a['start'][:10]) >= TODAY - timedelta(days=90)]
cands = [(vdot(b['d'], b['t']), a, b) for a in recent for b in a['best'] if b['d'] in (5000, 10000)]
est = {}
if cands:
    vd, a, b = max(cands, key=lambda x: x[0])
    est['vdot'] = dict(value=round(vd, 1), method=f"VDOT de Daniels a partir de tu mejor {b['label']} reciente",src=a['id'], date=a['start'][:10], label=b['label'], t=b['t'])
    est['threshold_pace'] = dict(value=round(pace_at(vd, 0.88), 3), method='Ritmo al 88 % del VO₂máx (VDOT)', src=a['id'])
p20 = [(p['w'], a) for a in recent for p in a['pcurve'] if p['s'] == 1200]
if p20:
    w20, a = max(p20, key=lambda x: x[0])
    est['ftp'] = dict(value=round(w20 * 0.95), method=f'95 % de tu mejor 20 min ({w20} W)', src=a['id'], date=a['start'][:10])
hrmax = max(((a['hrmax'] or 0), a['id'], a['start'][:10]) for a in acts if date.fromisoformat(a['start'][:10]) >= TODAY - timedelta(days=365))
est['hr_max'] = dict(value=hrmax[0], method='FC más alta registrada en los últimos 12 meses', src=hrmax[1], date=hrmax[2])

def status(tsb):
    return 'fresco' if tsb > 5 else 'neutro' if tsb > -10 else 'productivo' if tsb > -30 else 'sobrecarga'
last28 = [dict(date=x['date'], st=status(x['tsb']), trimp=x['trimp']) for x in daily[-28:]]
wk_now = sum(x['trimp'] for x in daily if date.fromisoformat(x['date']) >= monday(TODAY))
wk_avg = sum(x['trimp'] for x in daily[-35:-7]) / 4 if len(daily) > 35 else 0
prof = LAST_PROFILE[1]
profile = dict(name=OWNER.get('name'), display=OWNER.get('display'), location='',
               since=min(a['start'] for a in acts)[:10], device='Garmin fēnix 6X Pro',
               weight=prof.get('weight'), height=prof.get('height'), gender=prof.get('gender'),
               streak=streak, year=totals(year), all=totals(acts), n_all=len(acts), n_year=len(year),
               load=dict(week=wk_now, avg=round(wk_avg)), status28=last28, estimates=est,
               goals=[dict(id='w_km', label='Distancia semanal', period='semana', metric='dist', target=30000),
                      dict(id='m_h', label='Horas al mes', period='mes', metric='time', target=20*3600),
                      dict(id='y_km', label='Distancia en 2026', period='año', metric='dist', target=2500000)])

gear = {}
for a in acts:
    if a.get('gear'):
        g = gear.setdefault(a['gear'], dict(name=a['gear'], n=0, dist=0, time=0, sports=set(), first=a['start'][:10], last=a['start'][:10]))
        g['n'] += 1; g['dist'] += a['dist']; g['time'] += a['moving']; g['sports'].add(a['sport'])
        g['first'] = min(g['first'], a['start'][:10]); g['last'] = max(g['last'], a['start'][:10])
profile['gear'] = sorted(({**g, 'sports': sorted(g['sports'])} for g in gear.values()), key=lambda g: -g['dist'])
profile['since'] = min(a['start'] for a in acts)[:10]
for a in acts:
    if not a.get('route'): a.pop('route', None)
data = dict(generated=datetime.now().isoformat(timespec='minutes'), settings=dict(hr_max=HR_MAX, hr_rest=HR_REST, zones=ZB),
            activities=acts, daily=daily, profile=profile, prs=list(prs.values()), pcurve=sorted(pcurve.values(), key=lambda p: p['s']))
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    f.write('window.OS_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
from collections import Counter
print(len(acts), 'actividades', Counter(a['sport'] for a in acts), os.path.getsize(OUT) // 1024, 'KB')
print('PRs', [(p['label'], p['t']) for p in prs.values()])
print('pcurve', [(p['s'], p['w']) for p in pcurve.values()])
print('daily last', daily[-1])
print('profile', {k: v for k, v in profile.items() if k not in ('status28', 'year', 'all')})
