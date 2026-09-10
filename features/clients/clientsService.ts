/**
 * Regras de edicao de cliente / cao (puras, testaveis).
 *
 * Decisao: quando o ENDERECO muda, as coordenadas antigas sao DESCARTADAS (null).
 * Pino de mapa em endereco antigo e pior do que pino nenhum: o motorista iria ao
 * lugar errado sem perceber. A navegacao por endereco continua funcionando sem coordenada.
 */

export type EditableClient = {
  name: string;
  phone: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  notes: string | null;
  special_scheduling_instructions: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type ClientFormValues = {
  name: string;
  phone: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  notes: string | null;
  special_scheduling_instructions: string | null;
};

export type DogFormValues = {
  name: string;
  breed: string | null;
  behavior_notes: string | null;
  medical_notes: string | null;
};

export type ClientUpdatePayload = ClientFormValues & {
  latitude?: number | null;
  longitude?: number | null;
  address_changed: boolean;
};

/** Texto: tira espacos e transforma vazio em null (banco nao guarda string vazia). */
export function normalizeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sameText(a: string | null, b: string | null): boolean {
  return normalizeText(a) === normalizeText(b);
}

/** O endereco mudou? (qualquer campo de endereco) */
export function addressChanged(current: EditableClient, values: ClientFormValues): boolean {
  return (
    !sameText(current.address_line_1, values.address_line_1) ||
    !sameText(current.address_line_2, values.address_line_2) ||
    !sameText(current.city, values.city) ||
    !sameText(current.state, values.state) ||
    !sameText(current.postal_code, values.postal_code)
  );
}

/** Payload do UPDATE do cliente (sem organization_id/id: quem manda e o chamador). */
export function clientUpdatePayload(current: EditableClient, values: ClientFormValues): ClientUpdatePayload {
  const name = normalizeText(values.name);
  if (!name) throw new Error('Client name is required.');
  const changed = addressChanged(current, values);
  const payload: ClientUpdatePayload = {
    name,
    phone: normalizeText(values.phone),
    address_line_1: normalizeText(values.address_line_1),
    address_line_2: normalizeText(values.address_line_2),
    city: normalizeText(values.city),
    state: normalizeText(values.state),
    postal_code: normalizeText(values.postal_code),
    notes: normalizeText(values.notes),
    special_scheduling_instructions: normalizeText(values.special_scheduling_instructions),
    address_changed: changed,
  };
  if (changed) {
    payload.latitude = null;
    payload.longitude = null;
  }
  return payload;
}

/** Payload do UPDATE/INSERT do cachorro. */
export function dogUpdatePayload(values: DogFormValues): DogFormValues {
  const name = normalizeText(values.name);
  if (!name) throw new Error('Dog name is required.');
  return {
    name,
    breed: normalizeText(values.breed),
    behavior_notes: normalizeText(values.behavior_notes),
    medical_notes: normalizeText(values.medical_notes),
  };
}

/** Nomes novos digitados num campo so ("Luna, Thor") — sem repetir (ignora maiusculas). */
export function splitDogNames(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]/)) {
    const name = normalizeText(part);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Compara ignorando maiusculas e acentos (buscar "joao" acha "João"). */
export function normalizeForSearch(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export type SearchableClient = {
  name: string;
  phone: string | null;
  address_line_1: string | null;
  city: string | null;
  dogs: string[];
};

/**
 * Filtra a lista de clientes por nome, telefone, endereco, cidade ou nome do cao.
 * Sem termo, devolve tudo (mesma referencia de ordem).
 */
export function filterClients<T extends SearchableClient>(clients: T[], query: string): T[] {
  const term = normalizeForSearch(query);
  if (!term) return clients;
  return clients.filter((client) => {
    const haystack = [client.name, client.phone, client.address_line_1, client.city, ...client.dogs]
      .map((value) => normalizeForSearch(value as string | null))
      .join(' | ');
    return haystack.includes(term);
  });
}
