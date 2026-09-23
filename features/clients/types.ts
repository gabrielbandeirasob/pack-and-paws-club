/**
 * Cao como a LISTA de clientes carrega: nome + foto.
 *
 * Antes a lista trazia so os nomes e a foto so aparecia abrindo o cliente (relato do Gabriel,
 * 23/09/2026: "quero que na parte dos clientes tenha foto dos cachorros na primeira tela").
 */
export type ClientDog = { name: string; photo_url?: string | null };

export type ClientWithDogs = {
  id: string;
  name: string;
  phone: string | null;
  address_line_1: string | null;
  city: string | null;
  state: string | null;
  active: boolean;
  dogs: ClientDog[];
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
