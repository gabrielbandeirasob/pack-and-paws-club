import type { PhoneContactCandidate } from '@/features/clients/types';

export type ContactsService = {
  requestPermission: () => Promise<'granted' | 'denied'>;
  search: (query: string) => Promise<PhoneContactCandidate[]>;
};

export function createContactsService(): ContactsService {
  return {
    async requestPermission() {
      throw new Error('Contacts are only available on the iPhone app.');
    },
    async search() {
      return [];
    },
  };
}
