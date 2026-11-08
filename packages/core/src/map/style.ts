/**
 * Zankup's own map style (OS-206): OpenMapTiles vector data from OpenFreeMap (free, no key) drawn in
 * the colours of the current theme, quiet enough for the route on top to stand out. The same object
 * works in MapLibre GL JS (PWA) and MapLibre Native (Android).
 */
import type { Theme } from '../tokens';
import { mix } from './colour';

export const MAP_TILES = 'https://tiles.openfreemap.org/planet';
export const MAP_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const MAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

const WATER = '#4a90c2';
const GREEN = '#4f9a5a';

type Layer = Record<string, unknown>;

export function mapStyle(theme: Theme): Record<string, unknown> {
  const dark = theme.scheme === 'dark';
  const land = theme.bg;
  const water = mix(land, WATER, dark ? 0.35 : 0.3);
  const green = mix(land, GREEN, dark ? 0.18 : 0.16);
  const building = mix(land, theme.fg, dark ? 0.1 : 0.07);
  const minor = dark ? mix(land, theme.fg, 0.16) : theme.surface;
  const major = dark ? mix(land, theme.fg, 0.26) : mix(theme.surface, theme.line, 0.4);
  const casing = mix(land, theme.fg, dark ? 0.06 : 0.18);
  const label = theme.muted;
  const halo = land;
  const width = (base: number) => [
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    10,
    base * 0.4,
    18,
    base * 6,
  ];
  const roads = (id: string, classes: string[], colour: string, w: number): Layer => ({
    id,
    type: 'line',
    source: 'omt',
    'source-layer': 'transportation',
    filter: ['in', ['get', 'class'], ['literal', classes]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': colour, 'line-width': width(w) },
  });
  const text = (id: string, filter: unknown[], size: number, minzoom = 0): Layer => ({
    id,
    type: 'symbol',
    source: 'omt',
    'source-layer': 'place',
    minzoom,
    filter,
    layout: {
      'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
      'text-font': ['Noto Sans Regular'],
      'text-size': size,
      'text-max-width': 8,
    },
    paint: { 'text-color': label, 'text-halo-color': halo, 'text-halo-width': 1.2 },
  });

  const layers: Layer[] = [
    { id: 'land', type: 'background', paint: { 'background-color': land } },
    {
      id: 'green',
      type: 'fill',
      source: 'omt',
      'source-layer': 'landcover',
      filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland']]],
      paint: { 'fill-color': green, 'fill-opacity': 0.6 },
    },
    {
      id: 'park',
      type: 'fill',
      source: 'omt',
      'source-layer': 'park',
      paint: { 'fill-color': green },
    },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': water } },
    {
      id: 'waterway',
      type: 'line',
      source: 'omt',
      'source-layer': 'waterway',
      paint: { 'line-color': water, 'line-width': width(0.8) },
    },
    {
      id: 'building',
      type: 'fill',
      source: 'omt',
      'source-layer': 'building',
      minzoom: 14,
      paint: { 'fill-color': building },
    },
    {
      id: 'path',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      minzoom: 13,
      filter: ['in', ['get', 'class'], ['literal', ['path', 'track']]],
      paint: { 'line-color': casing, 'line-width': width(0.4), 'line-dasharray': [2, 1.5] },
    },
    roads('road-minor', ['minor', 'service', 'tertiary'], minor, 1),
    roads('road-major', ['secondary', 'primary', 'trunk', 'motorway'], major, 1.6),
    {
      id: 'rail',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      filter: ['==', ['get', 'class'], 'rail'],
      paint: { 'line-color': casing, 'line-width': 1 },
    },
    {
      id: 'boundary',
      type: 'line',
      source: 'omt',
      'source-layer': 'boundary',
      filter: ['<=', ['get', 'admin_level'], 4],
      paint: { 'line-color': casing, 'line-dasharray': [3, 2] },
    },
    text(
      'place-small',
      ['in', ['get', 'class'], ['literal', ['village', 'hamlet', 'suburb', 'neighbourhood']]],
      11,
      12,
    ),
    text('place-town', ['==', ['get', 'class'], 'town'], 12, 9),
    text('place-city', ['==', ['get', 'class'], 'city'], 14, 5),
  ];

  return {
    version: 8,
    glyphs: MAP_GLYPHS,
    sources: { omt: { type: 'vector', url: MAP_TILES, attribution: MAP_ATTRIBUTION } },
    layers,
  };
}

/**
 * Colour ramp for a route coloured by a metric, low to high, as stops for a MapLibre `interpolate`
 * expression and for the legend. Uses the HR zone colours, which read as "easy → hard" in every theme.
 */
export const RAMP = ['#a5d8ff', '#69db7c', '#ffd43b', '#ff922b', '#f03e3e'] as const;
