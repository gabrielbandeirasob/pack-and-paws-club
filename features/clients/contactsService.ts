import type { PhoneContactCandidate } from '@/features/clients/types';

export type ContactsService = {
  requestPermission: () => Promise<'granted' | 'denied'>;
  search: (query: string) => Promise<PhoneContactCandidate[]>;
};

/**
 * Platform entry point used only for typing and static resolution.
 * Metro resolves contactsService.native.ts on devices and
 * contactsService.web.ts on the web.
 */
export function createContactsService(): ContactsService {
  throw new Error('Contacts service is not available on this platform.');
}
