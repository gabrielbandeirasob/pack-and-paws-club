import type { LocationUpdate } from '@/features/driver/locationService';

export const DRIVER_LOCATION_CACHE_MAX_AGE_MS = 2 * 60 * 1000;

/**
 * Always asks the device for a fresh high-accuracy position. A recent live-sharing sample is only
 * a bounded fallback when that fresh request fails or is unavailable.
 */
export async function resolveDriverOptimizationOrigin(
  readFresh: () => Promise<LocationUpdate | null>,
  cached: LocationUpdate | null,
  now = Date.now(),
  maxCacheAgeMs = DRIVER_LOCATION_CACHE_MAX_AGE_MS,
): Promise<LocationUpdate | null> {
  try {
    const fresh = await readFresh();
    if (fresh) return fresh;
  } catch {
    // A recent sharing sample remains usable when the one-shot GPS request times out.
  }

  if (
    cached
    && typeof cached.capturedAt === 'number'
    && now - cached.capturedAt >= 0
    && now - cached.capturedAt <= maxCacheAgeMs
  ) {
    return cached;
  }
  return null;
}