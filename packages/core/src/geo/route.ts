/**
 * Route thumbnails: the simplified route of an activity (an encoded polyline, precision 5) drawn into a
 * small box. Pure functions, so the PWA (SVG) and the Android app (Skia) draw the same shape.
 */

export type LatLon = readonly [lat: number, lon: number];

/** Google's encoded polyline algorithm. Stops at the first malformed point instead of throwing. */
export function decodePolyline(encoded: string, precision = 5): LatLon[] {
  const factor = 10 ** precision;
  const points: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (index >= encoded.length) return null;
      const byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) return null;
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (byte < 0x20) break;
      if (shift > 30) return null;
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    const dLat = next();
    const dLon = next();
    if (dLat === null || dLon === null) break;
    lat += dLat;
    lon += dLon;
    points.push([lat / factor, lon / factor]);
  }
  return points;
}

/**
 * The route fitted into a `width`×`height` box with `pad` around it, north up and keeping its shape
 * (longitude scaled by the cosine of the latitude). Returns the points as "x,y x,y …" for an SVG
 * polyline, or null when there is nothing to draw.
 */
export function routeThumbnail(encoded: string | null | undefined, width = 88, height = 64, pad = 6) {
  if (!encoded) return null;
  const points = decodePolyline(encoded);
  if (points.length < 2) return null;
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const [lat0, lat1] = [Math.min(...lats), Math.max(...lats)];
  const [lon0, lon1] = [Math.min(...lons), Math.max(...lons)];
  const kx = Math.cos((((lat0 + lat1) / 2) * Math.PI) / 180);
  const w = (lon1 - lon0) * kx || 1e-6;
  const h = lat1 - lat0 || 1e-6;
  const boxW = width - 2 * pad;
  const boxH = height - 2 * pad;
  const scale = Math.min(boxW / w, boxH / h);
  const dx = pad + (boxW - w * scale) / 2;
  const dy = pad + (boxH - h * scale) / 2;
  return points
    .map(
      ([lat, lon]) =>
        `${(dx + (lon - lon0) * kx * scale).toFixed(1)},${(dy + (lat1 - lat) * scale).toFixed(1)}`,
    )
    .join(' ');
}

/**
 * The lines a map of many routes should open on: those within 40 km of the median centre, so a few
 * far-away ones (virtual rides abroad) are still drawn but do not zoom the map out to the world.
 * Points are [lon, lat].
 */
export function focusLines(lines: [number, number][][]): [number, number][][] {
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
