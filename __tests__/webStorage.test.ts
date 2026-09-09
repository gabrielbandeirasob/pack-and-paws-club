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
});
