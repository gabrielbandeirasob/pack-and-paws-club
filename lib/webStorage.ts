export type StringStorage = {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
};

export function createWebStorageAdapter(storage: StringStorage, isServer: boolean) {
  return {
    async getItem(key: string) {
      if (isServer) return null;
      return storage.getItem(key);
    },
    async setItem(key: string, value: string) {
      if (isServer) return;
      await storage.setItem(key, value);
    },
    async removeItem(key: string) {
      if (isServer) return;
      await storage.removeItem(key);
    },
  };
}
