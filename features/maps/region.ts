/**
 * Região inicial do mapa que enquadra todas as paradas (pura, testável).
 */
export type MapPoint = { latitude: number; longitude: number };

export type MapRegion = MapPoint & { latitudeDelta: number; longitudeDelta: number };

const MIN_DELTA = 0.01; // ~1 km: evita "zoom infinito" quando as paradas estão no mesmo quarteirão
const PADDING = 1.4; // folga nas bordas

export function regionForPoints(points: MapPoint[]): MapRegion | null {
  const valid = points.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  if (valid.length === 0) return null;

  const lats = valid.map((point) => point.latitude);
  const lngs = valid.map((point) => point.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * PADDING, MIN_DELTA),
    longitudeDelta: Math.max((maxLng - minLng) * PADDING, MIN_DELTA),
  };
}
