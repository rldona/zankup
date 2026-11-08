import { describe, expect, it } from 'vitest';

import { decodePolyline, routeThumbnail } from './route';

// The example from Google's documentation of the format.
const GOOGLE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

describe('route thumbnails', () => {
  it('decodes encoded polylines', () => {
    expect(decodePolyline(GOOGLE)).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it('stops at malformed input instead of throwing', () => {
    expect(decodePolyline(GOOGLE.slice(0, 12))).toEqual([[38.5, -120.2]]);
    expect(decodePolyline('\u0001\u0002')).toEqual([]);
  });

  it('fits the route inside the box, north up', () => {
    const points = (routeThumbnail(GOOGLE, 88, 64, 6) ?? '')
      .split(' ')
      .map((p) => p.split(',').map(Number) as [number, number]);
    expect(points).toHaveLength(3);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(6);
      expect(x).toBeLessThanOrEqual(82);
      expect(y).toBeGreaterThanOrEqual(6);
      expect(y).toBeLessThanOrEqual(58);
    }
    const [[startX, startY], , [endX, endY]] = points as [[number, number], unknown, [number, number]];
    expect(startY).toBeGreaterThan(endY); // the start is south of the end: lower
    expect(startX).toBeGreaterThan(endX); // and east of it: to the right
  });

  it('draws nothing without a route', () => {
    expect(routeThumbnail(null)).toBeNull();
    expect(routeThumbnail('_p~iF~ps|U')).toBeNull(); // a single point
  });
});
