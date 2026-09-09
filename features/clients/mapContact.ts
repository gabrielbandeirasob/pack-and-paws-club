import type { NewClientInput, PhoneContactCandidate } from '@/features/clients/types';

export function mapContactToClientInput(
  contact: PhoneContactCandidate,
  contactIdentifier: string,
  options: { instructions?: string | null } = {},
): NewClientInput {
  const address = contact.address ?? null;
  const note = options.instructions ?? contact.note ?? null;
  return {
    name: contact.name.trim(),
    phone: contact.phone?.trim() || null,
    address_line_1: address?.street?.trim() || null,
    address_line_2: null,
    city: address?.city?.trim() || null,
    state: address?.region?.trim() || null,
    postal_code: address?.postalCode?.trim() || null,
    source_contact_identifier: contactIdentifier,
    ...(note?.trim() ? { pickup_access_instructions: note.trim() } : {}),
  };
}
