import { mapContactToClientInput } from '@/features/clients/mapContact';

describe('mapContactToClientInput', () => {
  const baseContact = {
    id: 'contact-1',
    name: 'Maria Silva',
    phone: '+55 62 99999-0000',
    address: { street: '123 Main St', city: 'Goiania', region: 'GO', postalCode: '74000-000' },
  };

  it('maps name, phone and formatted address into a client payload', () => {
    expect(mapContactToClientInput(baseContact, 'contact-1')).toEqual({
      name: 'Maria Silva',
      phone: '+55 62 99999-0000',
      address_line_1: '123 Main St',
      address_line_2: null,
      city: 'Goiania',
      state: 'GO',
      postal_code: '74000-000',
      source_contact_identifier: 'contact-1',
    });
  });

  it('moves the contact note into pickup/access instructions', () => {
    const withNote = {
      ...baseContact,
      note: 'Call box 185. Third floor. Apartment 301. Key inside lockbox.',
    };
    expect(mapContactToClientInput(withNote, 'contact-1').pickup_access_instructions).toBe(
      'Call box 185. Third floor. Apartment 301. Key inside lockbox.',
    );
  });

  it('handles a contact without address and keeps a full single-line address', () => {
    const sparse = { id: 'contact-2', name: 'Joao', phone: null, note: null };
    expect(mapContactToClientInput(sparse, 'contact-2')).toEqual({
      name: 'Joao',
      phone: null,
      address_line_1: null,
      address_line_2: null,
      city: null,
      state: null,
      postal_code: null,
      source_contact_identifier: 'contact-2',
    });
  });
});
