/**
 * MapLibre map with the route, the selected section and the cursor. Tiles from OpenFreeMap (no key).
 * The route can be coloured by a metric (OS-517): one line with a gradient along it, painted over the
 * shared ramp from the 2nd to the 98th percentile, as in the PWA. Switching the metric only restyles
 * the line; its geometry is sent to the map once.
 * The cursor is its own small component so that following the finger re-renders only one source.
 */
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { memo, useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { useMapCover } from '../MapCover';
import { gradientExpression, lineFeature, positionAt, type Track } from './track';

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';

type Props = {
  track: Track;
  bbox: number[] | null;
  cursor: number;
  section: [number, number] | null;
  dark: boolean;
  colors: { route: string; section: string; cursor: string };
  /** One value per sample to colour the route by, and the range the ramp spans. */
  values?: (number | null)[] | null;
  range?: [number, number] | null;
  onReady?: () => void;
};

export const RouteMap = memo(function RouteMap({
  track,
  bbox,
  cursor,
  section,
  dark,
  colors,
  values,
  range,
  onReady,
}: Props) {
  const route = useMemo(() => lineFeature(track), [track]);
  const gradient = useMemo(
    () => (values && range ? gradientExpression(track, values, range, colors.route) : null),
    [track, values, range, colors.route],
  );
  const bounds = useMemo<[number, number, number, number] | undefined>(
    () => (bbox && bbox.length === 4 ? [bbox[1], bbox[0], bbox[3], bbox[2]] : undefined),
    [bbox],
  );
  const { cover, reveal } = useMapCover(dark);
  return (
    <>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={dark ? STYLE_DARK : STYLE_LIGHT}
        attribution
        logo={false}
        compass={false}
        scaleBar={false}
        touchRotate={false}
        touchPitch={false}
        onDidFinishLoadingStyle={reveal}
        onDidFinishLoadingMap={onReady}
      >
        {bounds && (
          <Camera initialViewState={{ bounds, padding: { top: 32, right: 32, bottom: 32, left: 32 } }} />
        )}
        <GeoJSONSource id="route" data={route} tolerance={0} lineMetrics>
          <Layer
            type="line"
            id="route-line"
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={
              gradient
                ? // A plain array built at runtime: the style spec's expression type is too strict to type it.
                  { 'line-gradient': gradient as never, 'line-width': 3.5 }
                : { 'line-color': colors.route, 'line-width': 3.5 }
            }
          />
        </GeoJSONSource>
        <SectionLine track={track} section={section} color={colors.section} />
        <CursorPoint track={track} cursor={cursor} color={colors.cursor} />
      </Map>
      {cover}
    </>
  );
});

const SectionLine = memo(function SectionLine({
  track,
  section,
  color,
}: {
  track: Track;
  section: [number, number] | null;
  color: string;
}) {
  // Always a FeatureCollection: an empty LineString is invalid GeoJSON and MapLibre drops the source.
  const data = useMemo<GeoJSON.FeatureCollection>(() => {
    const line = section ? lineFeature(track, Math.min(...section), Math.max(...section)) : null;
    return {
      type: 'FeatureCollection',
      features: line && line.geometry.coordinates.length > 1 ? [line] : [],
    };
  }, [track, section]);
  return (
    <GeoJSONSource id="section" data={data}>
      <Layer type="line" id="section-line" paint={{ 'line-color': color, 'line-width': 6 }} />
    </GeoJSONSource>
  );
});

const CursorPoint = memo(function CursorPoint({
  track,
  cursor,
  color,
}: {
  track: Track;
  cursor: number;
  color: string;
}) {
  const position = cursor >= 0 ? positionAt(track, cursor) : null;
  const data = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: position
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: position } }]
        : [],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [position?.[0], position?.[1]],
  );
  return (
    <GeoJSONSource id="cursor" data={data}>
      <Layer
        type="circle"
        id="cursor-dot"
        paint={{
          'circle-radius': 7,
          'circle-color': color,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.5,
        }}
      />
    </GeoJSONSource>
  );
});
