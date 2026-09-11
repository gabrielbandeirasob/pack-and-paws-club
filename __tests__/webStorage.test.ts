import { createWebStorageAdapter } from '@/lib/webStorage';

describe('web auth storage', () => {
  it('does not touch browser storage during server rendering', async () => {
    const storage = {
      getItem: jest.fn(() => { throw new Error('window is not defined'); }),
      setItem: jest.fn(() => { throw new Error('window is not defined'); }),
      removeItem: jest.fn(() => { throw new Error('window is not defined'); }),
    };
    const adapter = createWebStorageAdapter(storage, true);

    await expect(adapter.getItem('session')).resolves.toBeNull();
    await expect(adapter.setItem('session', 'value')).resolves.toBeUndefined();
    await expect(adapter.removeItem('session')).resolves.toBeUndefined();
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it('reads and writes through to browser storage in the browser', async () => {
    const store: Record<string, string> = {};
    const storage = {
      getItem: jest.fn((key: string) => store[key] ?? null),
      setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
      removeItem: jest.fn((key: string) => { delete store[key]; }),
    };
    const adapter = createWebStorageAdapter(storage, false);

    await adapter.setItem('session', 'abc');
    await expect(adapter.getItem('session')).resolves.toBe('abc');
    await adapter.removeItem('session');
    await expect(adapter.getItem('session')).resolves.toBeNull();

    expect(storage.setItem).toHaveBeenCalledWith('session', 'abc');
    expect(storage.removeItem).toHaveBeenCalledWith('session');
  });

  it('accepts a plain synchronous storage (AsyncStorage-like or memory store)', async () => {
    const storage = {
      getItem: (key: string) => (key === 'route' ? 'cached-route' : null),
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    const adapter = createWebStorageAdapter(storage, false);

    await expect(adapter.getItem('route')).resolves.toBe('cached-route');
    await expect(adapter.setItem('route', 'x')).resolves.toBeUndefined();
    await expect(adapter.removeItem('route')).resolves.toBeUndefined();
  });
});
