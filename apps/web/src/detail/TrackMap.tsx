import { decodePolyline, mapStyle, themes, type ThemeName } from '@zankup/core';
import type { Map as MapLibre } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

import { t } from '../i18n';
import { hasWebGL, loadMapLibre } from './maplibre';

/**
 * One or many tracks on a map in the theme's style (OS-309, OS-310, OS-325). With `heat`, many faint
 * lines whose overlaps build up into a heatmap. Without WebGL it says so.
 */
export function TrackMap({
  tracks,
  precision = 5,
  colour,
  theme,
  heat = false,
  height = 340,
}: {
  tracks: string[];
  precision?: number;
  colour: string;
  theme: ThemeName;
  heat?: boolean;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const [webgl] = useState(hasWebGL);

  useEffect(() => {
    const element = box.current;
    if (!webgl || !element || tracks.length === 0) return;
    const lines = tracks.map((track) =>
      decodePolyline(track, precision).map(([lat, lon]) => [lon, lat] as [number, number]),
    );
    // A heatmap opens where most routes are (median of their centres, 40 km around): a few far-away
    // ones, like virtual rides abroad, are still drawn but do not zoom the map out to the world.
    const focus = heat ? around(lines) : lines;
    const all = focus.flat();
    if (all.length < 2) return;
    let disposed = false;
    void loadMapLibre().then((maplibre) => {
      if (disposed) return;
      const lons = all.map((p) => p[0]);
      const lats = all.map((p) => p[1]);
      const instance = new maplibre.Map({
        container: element,
        style: mapStyle(themes[theme]) as never,
        bounds: [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        fitBoundsOptions: { padding: 24 },
        attributionControl: { compact: true },
        cooperativeGestures: true,
      });
      instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      instance.on('load', () => {
        instance.addSource('tracks', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: lines.map((coordinates) => ({
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates },
            })),
          },
        });
        instance.addLayer({
          id: 'tracks',
          type: 'line',
          source: 'tracks',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: heat
            ? {
                'line-color': colour,
                'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 15, 3],
                'line-opacity': 0.25,
              }
            : { 'line-color': colour, 'line-width': 4 },
        });
      });
      map.current = instance;
    });
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
  }, [webgl, tracks, precision, colour, theme, heat]);

  if (!webgl) return <p className="note">{t('activity.mapFallback')}</p>;
  return <div ref={box} className="map" style={{ height }} />;
}

function around(lines: [number, number][][]): [number, number][][] {
  const centres = lines
    .filter((l) => l.length)
    .map(
      (l) =>
        [l.reduce((s, p) => s + p[0], 0) / l.length, l.reduce((s, p) => s + p[1], 0) / l.length] as const,
    );
  if (centres.length < 3) return lines;
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
  const lon = median(centres.map((c) => c[0]));
  const lat = median(centres.map((c) => c[1]));
  const near = lines.filter((l, i) => {
    const c = centres[i];
    if (!c || !l.length) return false;
    const dx = (c[0] - lon) * 111 * Math.cos((lat * Math.PI) / 180);
    const dy = (c[1] - lat) * 111;
    return Math.hypot(dx, dy) <= 40;
  });
  return near.length ? near : lines;
}
