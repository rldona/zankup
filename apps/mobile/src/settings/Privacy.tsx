/**
 * Privacy zones on the phone (OS-522), as in the PWA (OS-407): places hidden from anything shared.
 * Tap the map to place one, pick its radius and name, and save.
 */
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { activitiesQuery, decodePolyline, settingsQuery, type PrivacyZone } from '@zankup/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useApi } from '../auth';
import { t } from '../i18n';
import { useTheme } from '../theme';
import { Button, Card, Choice, Field, Heading, ListRow, Muted } from '../ui';
import { useSaveSettings } from './save';

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const RADII = ['200', '400', '800', '1000', '1600'] as const;

const radiusText = (r: number) => (r >= 1000 ? `${r / 1000} km` : `${r} m`);

/** A circle as a polygon ring of [lon, lat], for drawing a zone on the map. */
export function circle(lat: number, lon: number, radius: number): [number, number][] {
  const points: [number, number][] = [];
  const dLat = radius / 111_320;
  const dLon = radius / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    points.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return points;
}

export function PrivacyZones() {
  const api = useApi();
  const c = useTheme();
  const settings = useQuery(settingsQuery(api));
  const latest = useInfiniteQuery(activitiesQuery(api)); // the feed's first page, already cached
  const save = useSaveSettings();
  const zones = useMemo(() => settings.data?.privacy_zones ?? [], [settings.data]);
  const [draft, setDraft] = useState<PrivacyZone | null>(null);
  const [name, setName] = useState('');
  const [radius, setRadius] = useState(400);

  const first = zones[0];
  const recent = latest.data?.pages[0]?.items.find((a) => a.route)?.route;
  const centre = useMemo<[number, number] | null>(() => {
    if (first) return [first.lon, first.lat];
    const p = recent ? decodePolyline(recent)[0] : undefined;
    return p ? [p[1], p[0]] : null;
  }, [first, recent]);

  const data = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: [...zones, ...(draft ? [draft] : [])].map((z) => ({
        type: 'Feature',
        properties: { draft: z === draft ? 1 : 0 },
        geometry: { type: 'Polygon', coordinates: [circle(z.lat, z.lon, z.radius_m)] },
      })),
    }),
    [zones, draft],
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
  const ready = settings.isSuccess && (centre !== null || latest.isFetched);

  return (
    <>
      <Card>
        <Heading>{t('privacy.title')}</Heading>
        <Muted>{t('privacy.help')}</Muted>
        {ready && (
          <View style={{ height: 300, borderRadius: 16, overflow: 'hidden' }}>
            <Map
              style={{ flex: 1 }}
              mapStyle={c.scheme === 'dark' ? STYLE_DARK : STYLE_LIGHT}
              attribution
              logo={false}
              compass={false}
              scaleBar={false}
              touchRotate={false}
              touchPitch={false}
              onPress={(e) => {
                const [lon, lat] = e.nativeEvent.lngLat;
                setDraft({ id: `zone-${Date.now()}`, name, lat, lon, radius_m: radius });
              }}
            >
              <Camera initialViewState={centre ? { center: centre, zoom: 13 } : { zoom: 1.5 }} />
              <GeoJSONSource id="zones" data={data}>
                <Layer
                  type="fill"
                  id="zones-fill"
                  paint={{
                    'fill-color': c.accent,
                    'fill-opacity': ['case', ['==', ['get', 'draft'], 1], 0.35, 0.2],
                  }}
                />
                <Layer type="line" id="zones-edge" paint={{ 'line-color': c.accent, 'line-width': 2 }} />
              </GeoJSONSource>
            </Map>
          </View>
        )}
        <Muted>{t('privacy.tap')}</Muted>
        <Field
          label={t('privacy.name')}
          value={name}
          maxLength={120}
          placeholder={t('privacy.namePlaceholder')}
          onChangeText={setName}
        />
        <Muted>{t('privacy.radius')}</Muted>
        <Choice
          label={t('privacy.radius')}
          value={String(radius) as (typeof RADII)[number]}
          onChange={(r) => {
            setRadius(Number(r));
            if (draft) setDraft({ ...draft, radius_m: Number(r) });
          }}
          options={RADII.map((r) => ({ value: r, label: radiusText(Number(r)) }))}
        />
        <Button primary onPress={add} disabled={!draft || save.isPending}>
          {t('privacy.add')}
        </Button>
        {save.isError && <Muted accessibilityRole="alert">{save.error.message || t('common.error')}</Muted>}
      </Card>
      {zones.length > 0 && (
        <Card>
          {zones.map((z) => (
            <ListRow key={z.id} title={z.name || t('privacy.unnamed')} note={radiusText(z.radius_m)}>
              <Button
                disabled={save.isPending}
                onPress={() => save.mutate({ privacy_zones: zones.filter((x) => x.id !== z.id) })}
              >
                {t('privacy.remove')}
              </Button>
            </ListRow>
          ))}
        </Card>
      )}
    </>
  );
}
