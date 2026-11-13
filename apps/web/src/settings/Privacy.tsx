import {
  decodePolyline,
  mapStyle,
  settingsQuery,
  themes,
  activitiesQuery,
  type PrivacyZone,
} from '@zankup/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';

import { api } from '../api';
import { hasWebGL, loadMapLibre } from '../detail/maplibre';
import { t } from '../i18n';
import { useSaveSettings } from '../settings';
import { useResolvedTheme } from '../theme';

const RADII = [200, 400, 800, 1000, 1600] as const;

/** A circle as a polygon, for drawing a zone on the map. */
function circle(lat: number, lon: number, radius: number): [number, number][] {
  const points: [number, number][] = [];
  const dLat = radius / 111_320;
  const dLon = radius / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    points.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return points;
}

function zonesGeoJson(zones: PrivacyZone[], draft: PrivacyZone | null) {
  return {
    type: 'FeatureCollection' as const,
    features: [...zones, ...(draft ? [draft] : [])].map((z) => ({
      type: 'Feature' as const,
      properties: { draft: z === draft },
      geometry: { type: 'Polygon' as const, coordinates: [circle(z.lat, z.lon, z.radius_m)] },
    })),
  };
}

/**
 * Privacy zones (OS-407): places hidden from anything shared. Tap the map (or use your location) to
 * place one, pick its radius, and save.
 */
export function PrivacyZones() {
  const settings = useQuery(settingsQuery(api));
  const save = useSaveSettings();
  const zones = settings.data?.privacy_zones ?? [];
  const [draft, setDraft] = useState<PrivacyZone | null>(null);
  const [name, setName] = useState('');
  const locate = () =>
    navigator.geolocation?.getCurrentPosition((p) =>
      setDraft({
        id: `zone-${Date.now()}`,
        name,
        lat: p.coords.latitude,
        lon: p.coords.longitude,
        radius_m: draft?.radius_m ?? 400,
      }),
    );
  const add = () => {
    if (!draft) return;
    save.mutate(
      { privacy_zones: [...zones, { ...draft, name: name.trim() }] },
      {
        onSuccess: () => {
          setDraft(null);
          setName('');
        },
      },
    );
  };
  return (
    <section className="panel" aria-label={t('privacy.title')}>
      <p className="note">{t('privacy.help')}</p>
      <ZoneMap
        zones={zones}
        draft={draft}
        onPick={(lat, lon) =>
          setDraft({ id: `zone-${Date.now()}`, name, lat, lon, radius_m: draft?.radius_m ?? 400 })
        }
      />
      <div className="fields">
        <label className="field">
          <span>
            <b>{t('privacy.name')}</b>
          </span>
          <input
            value={name}
            maxLength={120}
            placeholder={t('privacy.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>
            <b>{t('privacy.radius')}</b>
          </span>
          <select
            value={draft?.radius_m ?? 400}
            onChange={(e) => draft && setDraft({ ...draft, radius_m: Number(e.target.value) })}
            disabled={!draft}
          >
            {RADII.map((r) => (
              <option key={r} value={r}>
                {r >= 1000 ? `${r / 1000} km` : `${r} m`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="actions">
        <button type="button" onClick={locate}>
          {t('privacy.here')}
        </button>
        <button type="button" className="primary" onClick={add} disabled={!draft || save.isPending}>
          {t('privacy.add')}
        </button>
        {!draft && <span className="note">{t('privacy.tap')}</span>}
      </div>
      {zones.length > 0 && (
        <ul className="rows">
          {zones.map((z) => (
            <li key={z.id}>
              <span>
                <b>{z.name || t('privacy.unnamed')}</b>
                <small className="note">
                  {z.radius_m >= 1000 ? `${z.radius_m / 1000} km` : `${z.radius_m} m`}
                </small>
              </span>
              <button
                type="button"
                onClick={() => save.mutate({ privacy_zones: zones.filter((x) => x.id !== z.id) })}
                disabled={save.isPending}
              >
                {t('privacy.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ZoneMap({
  zones,
  draft,
  onPick,
}: {
  zones: PrivacyZone[];
  draft: PrivacyZone | null;
  onPick: (lat: number, lon: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const theme = useResolvedTheme();
  const [webgl] = useState(hasWebGL);
  const latest = useInfiniteQuery(activitiesQuery(api)); // the feed's first page, already cached
  const pick = useRef(onPick);
  const ready = useRef(false);
  const draw = useRef(() => {});
  useEffect(() => {
    pick.current = onPick;
  });
  const first = zones[0];
  const recent = latest.data?.pages[0]?.items.find((a) => a.route)?.route;
  const centre: [number, number] | null = first
    ? [first.lon, first.lat]
    : recent
      ? (() => {
          const p = decodePolyline(recent)[0];
          return p ? ([p[1], p[0]] as [number, number]) : null;
        })()
      : null;
  const canBuild = centre !== null || latest.isFetched;

  useEffect(() => {
    const element = box.current;
    if (!webgl || !element || !canBuild) return;
    let disposed = false;
    void loadMapLibre().then((maplibre) => {
      if (disposed) return;
      const instance = new maplibre.Map({
        container: element,
        style: mapStyle(themes[theme]) as never,
        center: centre ?? [0, 30],
        zoom: centre ? 13 : 1.5,
        attributionControl: { compact: true },
        cooperativeGestures: true,
      });
      instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      instance.on('load', () => {
        instance.addSource('zones', { type: 'geojson', data: zonesGeoJson([], null) });
        instance.addLayer({
          id: 'zones',
          type: 'fill',
          source: 'zones',
          paint: {
            'fill-color': themes[theme].accent,
            'fill-opacity': ['case', ['get', 'draft'], 0.35, 0.2],
          },
        });
        instance.addLayer({
          id: 'zones-edge',
          type: 'line',
          source: 'zones',
          paint: { 'line-color': themes[theme].accent, 'line-width': 2 },
        });
        ready.current = true;
        draw.current();
      });
      instance.on('click', (e) => pick.current(e.lngLat.lat, e.lngLat.lng));
      map.current = instance;
    });
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
      ready.current = false;
    };
    // The map is built once per theme; zones are drawn by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webgl, theme, canBuild]);

  useEffect(() => {
    draw.current = () =>
      (map.current?.getSource('zones') as GeoJSONSource | undefined)?.setData(zonesGeoJson(zones, draft));
    if (ready.current) draw.current();
  }, [zones, draft]);

  if (!webgl) return <p className="note">{t('activity.mapFallback')}</p>;
  return <div ref={box} className="map zonemap" style={{ height: 280 }} />;
}
