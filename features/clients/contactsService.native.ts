import { Contact, ContactField, ContactsSortOrder, requestPermissionsAsync } from 'expo-contacts';
import type { PhoneContactCandidate } from '@/features/clients/types';

export type ContactsService = {
  requestPermission: () => Promise<'granted' | 'denied'>;
  search: (query: string) => Promise<PhoneContactCandidate[]>;
};

const FIELDS = [ContactField.FULL_NAME, ContactField.PHONES, ContactField.ADDRESSES, ContactField.NOTE] as const;

export function createContactsService(): ContactsService {
  return {
    async requestPermission() {
      const { status } = await requestPermissionsAsync();
      return status === 'granted' ? 'granted' : 'denied';
    },
    async search(query: string) {
      const details = await Contact.getAllDetails(FIELDS, {
        sortOrder: ContactsSortOrder.GivenName,
        ...(query.trim() ? { name: query.trim() } : {}),
      });
      return details
        .filter((contact) => Boolean(contact.fullName?.trim()))
        .map((contact) => ({
          id: contact.id,
          name: (contact.fullName ?? '').trim(),
          phone: contact.phones?.[0]?.number ?? null,
          address: (() => {
            const first = contact.addresses?.[0];
            if (!first) return null;
            return {
              street: first.street ?? null,
              city: first.city ?? null,
              region: first.region ?? first.state ?? null,
              postalCode: first.postcode ?? null,
            };
          })(),
          note: (() => {
            try {
              return contact.note ?? null;
            } catch {
              // The iOS contact-note entitlement may be missing.
              return null;
            }
          })(),
        }));
    },
  };
}
