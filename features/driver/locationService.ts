export type LocationUpdate = {
  latitude: number;
  longitude: number;
  /** Device timestamp used to bound cached GPS fallback for route optimization. */
  capturedAt?: number;
};
export type LocationHandle = { stop: () => void };

/**
 * Web-safe base: browsers/SSR do not share background position.
 * The native build (.native.ts) uses expo-location with explicit permission.
 */
export async function startLocationSharing(_onUpdate: (update: LocationUpdate) => void): Promise<LocationHandle | null> {
  return null;
}

/** Web/SSR não fornece a posição nativa usada para recalcular a rota. */
export async function getCurrentDriverLocation(): Promise<LocationUpdate | null> {
  return null;
}
