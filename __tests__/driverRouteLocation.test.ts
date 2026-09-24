import { resolveDriverOptimizationOrigin } from '@/features/driver/driverRouteLocation';
import type { LocationUpdate } from '@/features/driver/locationService';

const cached = (capturedAt: number): LocationUpdate => ({
  latitude: 37.7749,
  longitude: -122.4194,
  capturedAt,
});

describe('resolveDriverOptimizationOrigin', () => {
  it('requests and prefers a fresh high-accuracy reading even when a cached position exists', async () => {
    const fresh = { latitude: 37.78, longitude: -122.42, capturedAt: 1_000 };
    const readFresh = jest.fn().mockResolvedValue(fresh);

    await expect(resolveDriverOptimizationOrigin(readFresh, cached(900), 1_000)).resolves.toEqual(fresh);
    expect(readFresh).toHaveBeenCalledTimes(1);
  });

  it('falls back to a recent cached position when the fresh read fails', async () => {
    const recent = cached(950);
    const readFresh = jest.fn().mockRejectedValue(new Error('GPS timeout'));

    await expect(resolveDriverOptimizationOrigin(readFresh, recent, 1_000, 100)).resolves.toEqual(recent);
  });

  it('rejects a stale cached fallback when the fresh read is unavailable', async () => {
    const readFresh = jest.fn().mockResolvedValue(null);

    await expect(resolveDriverOptimizationOrigin(readFresh, cached(899), 1_000, 100)).resolves.toBeNull();
  });
});
