export type ClientWithDogs = {
  id: string;
  name: string;
  phone: string | null;
  address_line_1: string | null;
  city: string | null;
  state: string | null;
  active: boolean;
  dogs: string[];
};

export type ContactAddress = {
  street?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
};

export type PhoneContactCandidate = {
  id: string;
  name: string;
  phone?: string | null;
  address?: ContactAddress | null;
  note?: string | null;
};

export type NewClientInput = {
  name: string;
  phone: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  source_contact_identifier: string | null;
  pickup_access_instructions?: string;
  contains_access_code?: boolean;
};
