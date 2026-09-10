export type LocationUpdate = { latitude: number; longitude: number };
export type LocationHandle = { stop: () => void };

/**
 * Web-safe base: browsers/SSR do not share background position.
 * The native build (.native.ts) uses expo-location with explicit permission.
 */
export async function startLocationSharing(_onUpdate: (update: LocationUpdate) => void): Promise<LocationHandle | null> {
  return null;
}
