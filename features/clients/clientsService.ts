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
  /**
   * Foto do cao. Enquanto o gestor nao salva, pode ser o caminho LOCAL do aparelho
   * (file://...); no banco, e sempre a URL publica do bucket dog-photos
   * (ver features/dogs/dogPhoto.ts).
   */
  photo_url: string | null;
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
    photo_url: normalizeText(values.photo_url),
  };
}

/* ------------------------------------------------------------------ *
 * FOTO DO CAO E SALVAMENTO DOS CAES
 *
 * O cadastro do cao nao tinha foto em lugar nenhum do app (o campo
 * `dogs.photo_url` existia no banco desde o schema inicial e nenhuma tela
 * escrevia nele). O plano abaixo e puro de proposito: decidir o que
 * atualizar, o que inserir e o que apagar e o que o teste trava.
 * ------------------------------------------------------------------ */

export type DogSavePlan = {
  /** ids de caes deste cliente que saem do cadastro (e cuja foto sai junto) */
  idsToDelete: string[];
  /** caes mantidos: o que gravar em cada um (inclusive foto nova / foto removida) */
  updates: { id: string; values: DogFormValues }[];
  /** caes novos de verdade: sem repetir nome dos que ja existem nem entre si */
  inserts: DogFormValues[];
};

/**
 * Plano do salvamento dos caes de um cliente.
 *
 * Regras:
 *  - so apaga cao que e DESTE cliente (dogRemovalPlan);
 *  - cao mantido sem nome valido continua sendo erro (nao se apaga cadastro por engano);
 *  - cao novo sem nome e ignorado (o gestor pode ter adicionado o cartao e desistido);
 *  - cao novo com nome que o cliente ja tem NAO e inserido de novo (era assim que o
 *    cadastro ganhava "Luna" duas vezes).
 */
export function dogSavePlan(
  existing: { id: string; name: string }[],
  rows: ({ id: string } & DogFormValues)[],
  removedIds: string[],
  newDogs: DogFormValues[],
): DogSavePlan {
  const { idsToDelete } = dogRemovalPlan(existing, removedIds);
  const mantidos = rows.filter((dog) => !idsToDelete.includes(dog.id));
  const updates = mantidos.map((dog) => ({ id: dog.id, values: dogUpdatePayload(dog) }));

  const conhecidos = new Set(updates.map((item) => normalizeForSearch(item.values.name)));
  const inserts: DogFormValues[] = [];
  for (const novo of newDogs) {
    if (!normalizeText(novo.name)) continue;
    const values = dogUpdatePayload(novo);
    const chave = normalizeForSearch(values.name);
    if (conhecidos.has(chave)) continue;
    conhecidos.add(chave);
    inserts.push(values);
  }

  return { idsToDelete, updates, inserts };
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

/* ------------------------------------------------------------------ *
 * EXCLUSAO DE CLIENTE E DE CAO
 *
 * O app nao tinha como excluir cliente nem motorista: cadastro errado (import de
 * contato duplicado, cliente de teste) ficava para sempre, e a lista so crescia.
 *
 * Regra de seguranca (a parte que importa): apagar cliente NAO e a mesma coisa que
 * tirar da lista. `clients` apaga em cascata -> dogs -> reservations -> route_stops.
 * Ou seja: no banco, apagar o cliente apaga junto o historico de reservas e a passagem
 * dele pelas rotas ja feitas. Entao a tela precisa AVISAR o que vai junto — e oferecer
 * o caminho reversivel (o toggle "Active client", que ja existe) quando ha historico.
 * ------------------------------------------------------------------ */

export type ClientHistoryCounts = {
  /** cachorros ligados a este cliente */
  dogs: number;
  /** reservas registradas para os cachorros dele (todo o historico) */
  reservations: number;
  /** reservas de hoje em diante (o que ainda vai acontecer) */
  upcomingReservations: number;
  /** paradas de rota em que ele aparece */
  routeStops: number;
};

export type ClientDeletePlan = {
  title: string;
  message: string;
  /** true = existe historico; apagar leva o historico junto */
  hasHistory: boolean;
  /** true = oferecer "Archive instead" (desligar o Active) antes de apagar */
  offerArchive: boolean;
};

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Texto do alerta de exclusao do cliente, montado a partir do que existe ligado a ele.
 * Puro de proposito: o texto e a decisao de oferecer "arquivar" sao testaveis sem tela.
 */
export function clientDeletePlan(counts: ClientHistoryCounts): ClientDeletePlan {
  const dogs = Math.max(0, counts.dogs);
  const reservations = Math.max(0, counts.reservations);
  const upcoming = Math.max(0, counts.upcomingReservations);
  const routeStops = Math.max(0, counts.routeStops);
  const hasHistory = reservations > 0 || routeStops > 0;

  const parts: string[] = [];
  if (dogs > 0) parts.push(count(dogs, 'dog', 'dogs'));
  if (reservations > 0) parts.push(count(reservations, 'booking', 'bookings'));
  if (routeStops > 0) parts.push(`their ${count(routeStops, 'route stop', 'route stops')}`);

  if (!hasHistory) {
    return {
      title: 'Delete this client?',
      message:
        parts.length > 0
          ? `This permanently deletes the client and ${parts.join(', ')}. This cannot be undone.`
          : 'This permanently deletes the client. This cannot be undone.',
      hasHistory: false,
      offerArchive: false,
    };
  }

  const upcomingNote =
    upcoming > 0
      ? ` ${count(upcoming, 'booking', 'bookings')} of them ${upcoming === 1 ? 'is' : 'are'} still to come.`
      : '';

  return {
    title: 'Delete client with history?',
    message:
      `This client has ${parts.join(', ')}.${upcomingNote} ` +
      'Deleting removes all of that history — the records of past bookings and routes will be gone for good. ' +
      'If you just want them out of the list, choose “Keep history (inactive)” instead: the client stops appearing as active and everything stays saved.',
    hasHistory: true,
    offerArchive: true,
  };
}

/**
 * Quais cachorros podem ser realmente apagados: so os que pertencem a ESTE cliente.
 * Guarda de seguranca contra apagar o id de um cao de outra familia por engano.
 */
export function dogRemovalPlan(dogs: { id: string }[], removedIds: string[]): { idsToDelete: string[] } {
  const owned = new Set(dogs.map((dog) => dog.id));
  const unique = Array.from(new Set(removedIds));
  return { idsToDelete: unique.filter((id) => owned.has(id)) };
}

/** Confirmacao antes de remover um cao do cadastro. */
export function dogRemovalMessage(dogName: string): string {
  const name = normalizeText(dogName) ?? 'This dog';
  return `${name} is removed when you save the client. Bookings already made for ${name} stay in the calendar until you delete them there.`;
}

/* ------------------------------------------------------------------ *
 * LISTA DE CLIENTES: ordem, filtro de inativos e aviso de duplicado
 * ------------------------------------------------------------------ */

/** Ativos primeiro, depois por nome (ignorando maiusculas e acentos). */
export function sortClientsForList<T extends { active: boolean; name: string }>(
  clients: T[],
  options?: { showInactive?: boolean },
): T[] {
  const visiveis = options?.showInactive === false ? clients.filter((client) => client.active) : clients;
  return [...visiveis].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return normalizeForSearch(a.name).localeCompare(normalizeForSearch(b.name));
  });
}

/** Quantos clientes estao inativos (rotula o filtro da lista). */
export function inactiveCount(clients: { active: boolean }[]): number {
  return clients.filter((client) => !client.active).length;
}

export type DuplicateCandidate = { id: string; name: string; dogs: string[] };

/**
 * Possiveis duplicados ao cadastrar: MESMO nome de cliente ou MESMO nome de cao.
 * O banco impede dois cadastros para o mesmo contato do telefone, mas dois contatos
 * diferentes da mesma familia passariam batido — e a familia ficaria partida em dois
 * cadastros, com a rota buscando em um endereco e o historico no outro.
 */
export function findDuplicateClients(
  existing: DuplicateCandidate[],
  input: { name: string; dogs: string[] },
): DuplicateCandidate[] {
  const nome = normalizeForSearch(input.name);
  const caes = new Set(input.dogs.map((dog) => normalizeForSearch(dog)).filter((dog) => dog.length > 0));
  return existing.filter((client) => {
    if (nome.length > 0 && normalizeForSearch(client.name) === nome) return true;
    if (caes.size === 0) return false;
    return client.dogs.some((dog) => caes.has(normalizeForSearch(dog)));
  });
}

/** Texto do aviso (null = nada a avisar). */
export function duplicateHint(candidates: DuplicateCandidate[]): string | null {
  if (candidates.length === 0) return null;
  const lista = candidates
    .slice(0, 2)
    .map((client) => (client.dogs.length > 0 ? `${client.name} (dogs: ${client.dogs.join(', ')})` : client.name))
    .join(' · ');
  const extra = candidates.length > 2 ? ` and ${candidates.length - 2} more` : '';
  return `Possible duplicate: ${lista}${extra}. If it is the same family, open that client and add this dog there instead of creating a new record.`;
}

/* ------------------------------------------------------------------ *
 * DESFAZER A EXCLUSAO (so quando nao havia historico)
 * ------------------------------------------------------------------ */

/**
 * Desfazer so e honesto quando NADA foi perdido: sem reservas e sem paradas de rota, o
 * que existia era o cliente, os caes e as instrucoes — tudo isso cabe num INSERT.
 * Com historico, desfazer nao traria as reservas e as rotas de volta, entao nao se oferece.
 */
export function canUndoClientDelete(counts: ClientHistoryCounts): boolean {
  return Math.max(0, counts.reservations) === 0 && Math.max(0, counts.routeStops) === 0;
}

export type ClientSnapshot = {
  organizationId: string;
  client: {
    id: string;
    name: string;
    phone?: string | null;
    address_line_1?: string | null;
    address_line_2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    notes?: string | null;
    special_scheduling_instructions?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    active?: boolean;
    source_contact_identifier?: string | null;
  };
  dogs: { id: string; name: string; breed?: string | null; behavior_notes?: string | null; medical_notes?: string | null; photo_url?: string | null }[];
  instructions: { id: string; text: string | null } | null;
};

export type ClientRestoreRows = {
  client: Record<string, unknown>;
  dogs: Record<string, unknown>[];
  instruction: Record<string, unknown> | null;
};

/**
 * Linhas para reinserir o cliente exatamente como estava — **com os mesmos ids**.
 * Reaproveitar os ids e o que mantem qualquer referencia viva (link de mapa, cache do
 * aparelho do motorista) apontando para o mesmo registro, em vez de criar um cliente
 * "novo" que na pratica e o mesmo.
 */
export function clientRestoreRows(snapshot: ClientSnapshot): ClientRestoreRows {
  const { client, organizationId } = snapshot;
  return {
    client: {
      id: client.id,
      organization_id: organizationId,
      name: client.name,
      phone: client.phone ?? null,
      address_line_1: client.address_line_1 ?? null,
      address_line_2: client.address_line_2 ?? null,
      city: client.city ?? null,
      state: client.state ?? null,
      postal_code: client.postal_code ?? null,
      notes: client.notes ?? null,
      special_scheduling_instructions: client.special_scheduling_instructions ?? null,
      latitude: client.latitude ?? null,
      longitude: client.longitude ?? null,
      active: client.active ?? true,
      source_contact_identifier: client.source_contact_identifier ?? null,
    },
    dogs: snapshot.dogs.map((dog) => ({
      id: dog.id,
      organization_id: organizationId,
      client_id: client.id,
      name: dog.name,
      breed: dog.breed ?? null,
      behavior_notes: dog.behavior_notes ?? null,
      medical_notes: dog.medical_notes ?? null,
      photo_url: dog.photo_url ?? null,
    })),
    instruction: snapshot.instructions
      ? { id: snapshot.instructions.id, organization_id: organizationId, client_id: client.id, pickup_access_instructions: snapshot.instructions.text }
      : null,
  };
}
