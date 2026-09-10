import * as Location from 'expo-location';

import type { LocationHandle, LocationUpdate } from '@/features/driver/locationService';

/**
 * Starts sharing the driver's position while a route is active.
 * Requires explicit foreground permission; returns null when denied.
 * Samples are throttled (45s / 50m) to keep battery and data usage low.
 */
export async function startLocationSharing(onUpdate: (update: LocationUpdate) => void): Promise<LocationHandle | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;

  const subscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.Balanced, timeInterval: 45_000, distanceInterval: 50 },
    (position) => onUpdate({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
  );

  return { stop: () => subscription.remove() };
}
