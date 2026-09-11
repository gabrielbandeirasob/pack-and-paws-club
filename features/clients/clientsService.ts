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

/** Nomes de cao limpos: sem vazios e sem repeticao (ignora maiusculas e acentos). */
export function uniqueDogNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = normalizeText(raw);
    if (!name) continue;
    const key = normalizeForSearch(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Nomes novos digitados num campo so ("Luna, Thor") — sem repetir (ignora maiusculas). */
export function splitDogNames(raw: string): string[] {
  return uniqueDogNames(raw.split(/[,;\n]/));
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

/**
 * Cliente que JA veio desse contato do telefone (mesmo organization_id + source_contact_identifier).
 * O banco tem UNIQUE (organization_id, source_contact_identifier): nao existe (nem pode existir)
 * dois cadastros para o mesmo contato.
 */
export type ExistingContactClient = {
  id: string;
  name: string;
  hasInstructions: boolean;
  dogs: string[];
};

export type ContactAddPlan = {
  /** create = primeiro cadastro desse contato; reuse = contato que ja e cliente. */
  mode: 'create' | 'reuse';
  /** id do cliente existente (so no modo reuse). */
  clientId: string | null;
  /** Cachorros que realmente precisam ser inseridos (sem repetir os que o cliente ja tem). */
  dogsToAdd: string[];
  /** Instrucoes de acesso a inserir (no reuse, so quando o cliente ainda nao tem nenhuma). */
  instructionsToAdd: string | null;
};

/**
 * Decide o que fazer ao adicionar um contato: criar o cliente ou reaproveitar o cadastro.
 *
 * Caso real: o mesmo dono tem dois caes (Mowgli e Kona) e entra pelo mesmo contato duas vezes.
 * Sem isso, a segunda vez estourava "duplicate key value violates unique constraint
 * clients_organization_id_source_contact_identifier_key" na cara do usuario.
 */
export function planContactAdd(
  existing: ExistingContactClient | null,
  input: { pickup_access_instructions?: string | null },
  typedDogNames: string[],
): ContactAddPlan {
  const typed = uniqueDogNames(typedDogNames);
  const instructions = normalizeText(input.pickup_access_instructions);
  if (!existing) {
    return { mode: 'create', clientId: null, dogsToAdd: typed, instructionsToAdd: instructions };
  }
  const alreadyThere = new Set(existing.dogs.map((name) => normalizeForSearch(name)));
  return {
    mode: 'reuse',
    clientId: existing.id,
    dogsToAdd: typed.filter((name) => !alreadyThere.has(normalizeForSearch(name))),
    instructionsToAdd: existing.hasInstructions ? null : instructions,
  };
}

/**
 * A API do Supabase devolve o embed de `client_instructions` como **OBJETO**, nao como
 * lista: existe UNIQUE em client_id (uma instrucao por cliente), entao o PostgREST
 * entende a relacao como "para um".
 *
 * O motorista ja tratava como objeto (por isso via as instrucoes); as telas do gerente
 * faziam `[0]` no objeto e viam tudo vazio — e, achando que nao existia, tentavam
 * INSERIR de novo e batiam no UNIQUE. Estas duas funcoes aceitam as duas formas.
 */
export type InstructionEmbed<T extends { id: string }> = T | T[] | null | undefined;

export function firstInstruction<T extends { id: string }>(value: InstructionEmbed<T>): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** O cliente ja tem instrucoes de acesso? (usado para nao inserir duas vezes) */
export function clientHasInstructions(value: InstructionEmbed<{ id: string }>): boolean {
  return firstInstruction(value) !== null;
}

/**
 * Como gravar as instrucoes no salvar:
 * - ja existe linha -> update (inclusive para limpar, mandando null)
 * - nao existe e o texto foi preenchido -> upsert por client_id (idempotente: se outro
 *   aparelho criou a linha primeiro, atualiza em vez de estourar o UNIQUE)
 * - nao existe e o texto esta vazio -> nao faz nada
 */
export type InstructionWritePlan = { mode: 'update'; id: string } | { mode: 'upsert' } | { mode: 'skip' };

export function instructionWritePlan(instructionId: string | null, instructions: string | null): InstructionWritePlan {
  if (instructionId) return { mode: 'update', id: instructionId };
  if (instructions) return { mode: 'upsert' };
  return { mode: 'skip' };
}

/**
 * Separa o nome do contato do telefone em nome do cliente + dica de nome de cachorro.
 *
 * O chefe salva o contato com o cachorro colado no nome: "Leigh Ann(Mowgli)". O app
 * usava esse texto inteiro como nome do cliente e ainda pedia o nome do cachorro de
 * novo. Aqui o parenteses no FIM do nome vira dica de cachorro — e a dica ja entra
 * preenchida no formulario, que continua editavel.
 *
 * Regras: parenteses repetidos no fim sao somados ("Ana(Mowgli)(Kona)" -> "Mowgli, Kona");
 * " e " / " & " dentro do parenteses viram virgula; se o que sobrar for vazio
 * ("(Mowgli)"), o nome do cliente fica o texto original — melhor manter do que
 * cadastrar cliente sem nome.
 */
export function splitContactName(raw: string): { clientName: string; dogHint: string } {
  const original = (raw ?? '').trim();
  if (!original) return { clientName: '', dogHint: '' };

  const trailingParentheses = /\(\s*([^()]*?)\s*\)\s*$/;
  const hints: string[] = [];
  let rest = original;
  let match = trailingParentheses.exec(rest);
  while (match) {
    const inner = match[1].replace(/\s+(?:e|&)\s+/gi, ', ').trim();
    if (inner) hints.unshift(inner);
    rest = rest.slice(0, match.index).trim();
    match = trailingParentheses.exec(rest);
  }

  const dogHint = uniqueDogNames(hints.flatMap((hint) => hint.split(','))).join(', ');
  return { clientName: rest || original, dogHint };
}
