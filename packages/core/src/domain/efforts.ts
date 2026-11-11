/**
 * Best efforts and records come at fixed distances, some in miles (½, 1, 2 and 10 miles). With metric
 * units those are left out of every list of records: they mean nothing to someone who thinks in km.
 */
export const MILE_EFFORTS: ReadonlySet<string> = new Set(['half_mile', '1mile', '2mile', '10mile']);

/** Whether a best effort's distance is shown with these units (`format.unit`). */
export function effortShown(distanceKey: string, unit: 'km' | 'mi'): boolean {
  return unit === 'mi' || !MILE_EFFORTS.has(distanceKey);
}

/** Whether an event is shown with these units: a record at a mile distance is not, with km. */
export function eventShown(
  event: { kind: string; payload: Record<string, unknown> },
  unit: 'km' | 'mi',
): boolean {
  return event.kind !== 'record' || effortShown(String(event.payload.distance_key), unit);
}
