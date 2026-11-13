import {
  fillGaps,
  mapStyle,
  metricValues,
  quantile,
  RAMP,
  sampleIndices,
  themes,
  trackPoints,
  type Metric,
  type Series,
  type ThemeName,
} from '@zankup/core';
import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibre } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';

import { t } from '../i18n';
import { hasWebGL, loadMapLibre } from './maplibre';

const MAX_POINTS = 1500;

type Track = { index: number; lonLat: [number, number] }[];

/** Each step of the track as its own segment carrying the metric's value, for a coloured line. */
function segments(track: Track, values: (number | null)[] | null) {
  return {
    type: 'FeatureCollection' as const,
    features: track.slice(1).map((p, i) => ({
      type: 'Feature' as const,
      properties: { v: values?.[p.index] ?? null },
      geometry: { type: 'LineString' as const, coordinates: [track[i]?.lonLat ?? p.lonLat, p.lonLat] },
    })),
  };
}

const line = (coordinates: [number, number][]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates },
});

const point = (coordinates: [number, number] | undefined) => ({
  type: 'FeatureCollection' as const,
  features: coordinates
    ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates } }]
    : [],
});

/**
 * The route on a map (OS-206): MapLibre with Zankup's own style, the line coloured by the chosen
 * metric (low → high), start and finish, and the point under the cursor shared with the profile
 * (OS-207) and the selected section highlighted (OS-216). Without WebGL, the route's shape in SVG.
 */
export function RouteMap({
  series,
  metric,
  theme,
  hover,
  section,
  onHover,
  colour,
}: {
  series: Series;
  metric: Metric | null;
  theme: ThemeName;
  hover: number | null;
  section: [number, number] | null;
  onHover: (index: number | null) => void;
  colour: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [webgl] = useState(hasWebGL);
  const track = useMemo(() => {
    const all = trackPoints(series);
    return sampleIndices(all.length, MAX_POINTS)
      .map((i) => all[i])
      .filter((p) => p !== undefined);
  }, [series]);
  const values = useMemo(() => {
    if (!metric) return null;
    const raw = metricValues(series, metric);
    return raw ? fillGaps(raw) : null;
  }, [series, metric]);
  const hoverRef = useRef(onHover);
  useEffect(() => {
    hoverRef.current = onHover;
  });

  // Create the map (again when the theme changes: the style is generated from its tokens).
  useEffect(() => {
    const element = box.current;
    if (!webgl || !element || track.length < 2) return;
    let disposed = false;
    const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    void loadMapLibre().then((maplibre) => {
      if (disposed) return;
      const lons = track.map((p) => p.lonLat[0]);
      const lats = track.map((p) => p.lonLat[1]);
      const bounds: LngLatBoundsLike = [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ];
      const instance = new maplibre.Map({
        container: element,
        style: mapStyle(themes[theme]) as never,
        bounds,
        // The route clears what floats over the map: the activity's bar (or a phone's floating buttons)
        // over the top 56 px, and the replay bar over the bottom 52 px.
        fitBoundsOptions: { padding: { top: 32 + 56, bottom: 12 + 52, left: 32, right: 32 } },
        attributionControl: { compact: true },
        // With a mouse, the wheel scrolls the page, never the map (zoom is on its buttons, a double
        // click or a pinch), so there is no "use ⌘ + scroll" overlay. On a touch screen one finger
        // still scrolls the page and two move the map.
        cooperativeGestures: touch,
        scrollZoom: touch,
      });
      // The credits start folded behind their (i): MapLibre unfolds them once, when the map's data
      // first arrives, so they are folded when it first settles.
      instance.once('idle', () =>
        element.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'),
      );
      instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      const start = track[0]?.lonLat ?? [0, 0];
      const finish = track.at(-1)?.lonLat ?? start;
      instance.on('load', () => {
        const tokens = themes[theme];
        instance.addSource('route', { type: 'geojson', data: segments(track, null) });
        // A continuous line below the coloured segments: no gap if one segment is not drawn.
        instance.addSource('route-base', {
          type: 'geojson',
          data: line(track.map((p) => p.lonLat)),
        });
        instance.addSource('section', { type: 'geojson', data: point(undefined) });
        instance.addSource('cursor', { type: 'geojson', data: point(undefined) });
        instance.addSource('ends', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                properties: { end: 'start' },
                geometry: { type: 'Point', coordinates: start },
              },
              {
                type: 'Feature',
                properties: { end: 'finish' },
                geometry: { type: 'Point', coordinates: finish },
              },
            ],
          },
        });
        instance.addLayer({
          id: 'route-casing',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': tokens.surface, 'line-width': 7 },
        });
        instance.addLayer({
          id: 'route-base',
          type: 'line',
          source: 'route-base',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': colour, 'line-width': 4 },
        });
        instance.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': colour, 'line-width': 4 },
        });
        instance.addLayer({
          id: 'section',
          type: 'line',
          source: 'section',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': tokens.fg, 'line-width': 7, 'line-opacity': 0.85 },
        });
        instance.addLayer({
          id: 'ends',
          type: 'circle',
          source: 'ends',
          paint: {
            'circle-radius': 6,
            'circle-color': ['match', ['get', 'end'], 'start', tokens.walk, tokens.fg],
            'circle-stroke-color': tokens.surface,
            'circle-stroke-width': 2,
          },
        });
        instance.addLayer({
          id: 'cursor',
          type: 'circle',
          source: 'cursor',
          paint: {
            'circle-radius': 7,
            'circle-color': tokens.accent,
            'circle-stroke-color': tokens.surface,
            'circle-stroke-width': 3,
          },
        });
        setLoaded((n) => n + 1);
      });
      // Hovering the map moves the cursor on the profile too: the nearest point of the track.
      instance.on('mousemove', (event) => {
        let best = -1;
        let bestDistance = 28 * 28;
        for (const sample of track) {
          const p = instance.project(sample.lonLat);
          const d = (p.x - event.point.x) ** 2 + (p.y - event.point.y) ** 2;
          if (d < bestDistance) {
            best = sample.index;
            bestDistance = d;
          }
        }
        hoverRef.current(best >= 0 ? best : null);
      });
      instance.on('mouseout', () => hoverRef.current(null));
      map.current = instance;
    });
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
  }, [webgl, track, theme, colour]);

  // Colour by the metric: 2nd to 98th percentile over the ramp.
  useEffect(() => {
    const instance = map.current;
    const source = instance?.getSource<GeoJSONSource>('route');
    if (!instance || !source) return;
    void source.setData(segments(track, values));
    const lo = values ? quantile(values, 0.02) : null;
    const hi = values ? quantile(values, 0.98) : null;
    if (lo == null || hi == null || hi <= lo) {
      instance.setPaintProperty('route', 'line-color', colour);
      return;
    }
    const step = (hi - lo) / (RAMP.length - 1);
    instance.setPaintProperty('route', 'line-color', [
      'case',
      ['==', ['get', 'v'], null],
      colour,
      ['interpolate', ['linear'], ['get', 'v'], ...RAMP.flatMap((c, i) => [lo + i * step, c])],
    ]);
  }, [values, track, colour, loaded]);

  useEffect(() => {
    const cursor = map.current?.getSource<GeoJSONSource>('cursor');
    if (!cursor) return;
    const lat = hover == null ? null : series.lat?.[hover];
    const lon = hover == null ? null : series.lon?.[hover];
    void cursor.setData(point(lat != null && lon != null ? [lon, lat] : undefined));
  }, [hover, series, loaded]);

  useEffect(() => {
    const source = map.current?.getSource<GeoJSONSource>('section');
    if (!source) return;
    if (!section) {
      void source.setData(point(undefined));
      return;
    }
    const [a, b] = section;
    const inside = trackPoints(series).filter((p) => p.index >= a && p.index <= b);
    const coordinates = sampleIndices(inside.length, MAX_POINTS)
      .map((i) => inside[i]?.lonLat)
      .filter((c): c is [number, number] => c !== undefined);
    void source.setData(coordinates.length > 1 ? line(coordinates) : point(undefined));
  }, [section, series, loaded]);

  if (!webgl) return <ShapeFallback track={track} colour={colour} />;
  return <div ref={box} className="map" />;
}

/** Without WebGL: the route drawn in SVG, north up, keeping its proportions. */
function ShapeFallback({ track, colour }: { track: Track; colour: string }) {
  if (track.length < 2) return null;
  const lons = track.map((p) => p.lonLat[0]);
  const lats = track.map((p) => p.lonLat[1]);
  const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const w = (x1 - x0) * k || 1e-6;
  const h = y1 - y0 || 1e-6;
  const s = Math.min(560 / w, 280 / h);
  const points = track
    .map(
      (p) =>
        `${(20 + (p.lonLat[0] - x0) * k * s + (560 - w * s) / 2).toFixed(1)},${(20 + (y1 - p.lonLat[1]) * s + (280 - h * s) / 2).toFixed(1)}`,
    )
    .join(' ');
  return (
    <figure className="map fallback">
      <svg viewBox="0 0 600 320" role="img" aria-label={t('activity.route')}>
        <polyline points={points} style={{ stroke: colour }} />
      </svg>
      <figcaption className="note">{t('activity.mapFallback')}</figcaption>
    </figure>
  );
}
