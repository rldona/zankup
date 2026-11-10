/**
 * One or many tracks on a map (OS-520), as the PWA's TrackMap: a route, a segment, or with `heat`
 * many faint lines whose overlaps build up into a heatmap. Tracks arrive as encoded polylines.
 */
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { decodePolyline, focusLines } from '@zankup/core';
import { useMemo } from 'react';
import { View } from 'react-native';

import { useMapCover } from './MapCover';
import { useTheme } from './theme';

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';

/** The bounds [west, south, east, north] the map opens on, or null with fewer than two points. */
export function boundsOf(lines: [number, number][][]): [number, number, number, number] | null {
  const all = lines.flat();
  if (all.length < 2) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of all) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}

export function TrackMap({
  tracks,
  precision = 5,
  colour,
  heat = false,
  height = 300,
}: {
  tracks: string[];
  precision?: number;
  colour: string;
  heat?: boolean;
  height?: number;
}) {
  const c = useTheme();
  const lines = useMemo(
    () =>
      tracks.map((track) =>
        decodePolyline(track, precision).map(([lat, lon]) => [lon, lat] as [number, number]),
      ),
    [tracks, precision],
  );
  const bounds = useMemo(() => boundsOf(heat ? focusLines(lines) : lines), [lines, heat]);
  const data = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: lines
        .filter((l) => l.length > 1)
        .map((coordinates) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates },
        })),
    }),
    [lines],
  );
  const { cover, reveal } = useMapCover(c.scheme === 'dark');
  if (!bounds) return null;
  return (
    <View style={{ height, borderRadius: 16, overflow: 'hidden' }}>
      <Map
        style={{ flex: 1 }}
        mapStyle={c.scheme === 'dark' ? STYLE_DARK : STYLE_LIGHT}
        attribution
        logo={false}
        compass={false}
        scaleBar={false}
        touchRotate={false}
        touchPitch={false}
        onDidFinishLoadingStyle={reveal}
      >
        <Camera initialViewState={{ bounds, padding: { top: 24, right: 24, bottom: 24, left: 24 } }} />
        <GeoJSONSource id="tracks" data={data} tolerance={0}>
          <Layer
            type="line"
            id="tracks-line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={
              heat
                ? {
                    'line-color': colour,
                    'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 15, 3],
                    'line-opacity': 0.25,
                  }
                : { 'line-color': colour, 'line-width': 4 }
            }
          />
        </GeoJSONSource>
      </Map>
      {cover}
    </View>
  );
}
