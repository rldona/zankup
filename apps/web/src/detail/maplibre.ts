/**
 * MapLibre GL, loaded on demand with its stylesheet and its worker. MapLibre looks for the worker
 * next to its own file, which the bundler moves: it gets the worker as Vite builds it.
 */
let loading: Promise<typeof import('maplibre-gl')> | null = null;

export function loadMapLibre() {
  loading ??= Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl.css'),
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
  ]).then(([maplibre, , worker]) => {
    maplibre.setWorkerUrl(worker.default);
    return maplibre;
  });
  return loading;
}

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}
