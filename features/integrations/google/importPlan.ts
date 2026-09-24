/**
 * IMPORTACAO Google Calendar -> app (o caminho de volta do espelho).
 *
 * Pedido do dono (23/09/2026): "ao sincronizar, as datas que estao marcadas no calendario do cliente
 * fossem para o aplicativo".
 *
 * Como o app escreve os eventos (formato que esta importacao le de volta):
 *   `Daycare · Bella (Leigh Ann)`  +  `RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260930` + `EXDATE...`
 *
 * Regras desta camada (tudo puro, coberto por teste):
 *  1. Evento COM a marca do app (`appKey`) e o nosso espelho: nao se importa (evita ping-pong).
 *  2. O calendario conectado e exclusivo do negocio: todo evento entra. Palavra de servico define
 *     daycare/boarding; sem ela o evento assume daycare e o titulo inteiro e tratado como nome do cao.
 *  3. Nome do cao que NAO casa com o cadastro (zero OU mais de um) deixou de virar pendencia: o
 *     evento entra igual, criando cliente + cao com o nome do titulo (decisao do dono, 24/09/2026:
 *     "quero que o aplicativo, quando clicar para sincronizar, puxe TODOS os agendamentos"). Sem
 *     palavra de servico o titulo inteiro e o nome do cao; "Leigh Ann · Kona" e "Kona — Leigh Ann"
 *     trazem os DOIS nomes (cao + tutor). Titulo vazio (ou so espacos) e a unica coisa que nao vira
 *     cadastro: sem nome nao se cria cliente nem cao.
 *  4. O vinculo com o Google e por EVENTO (`googleEventId`), nunca por nome: o segundo Sync nao
 *     cria de novo, e renomear o cao no app tambem nao faz o proximo Sync criar outro cadastro.
 *  5. Reserva que nasceu no Google: se o evento mudar, a reserva muda; se o evento sumir, a reserva
 *     e CANCELADA — mas so dentro da janela consultada (evento fora da janela nao conta como
 *     "apagado").
 *  6. NADA DO PASSADO: a janela da importacao comeca em HOJE (quem chama passa `from` = data local
 *     de hoje), e nenhum evento/data anterior a `window.from` e criado, alterado ou cancelado.
 *  7. Evento igual a uma reserva que ja existe no app nao duplica: vai para revisao para o gestor
 *     ligar o evento a reserva existente.
 *  8. FIM DO EVENTO: esta camada recebe o fim EXCLUSIVO (o `parseEvent` do `calendarApi` normaliza o
 *     evento COM HORA para esse formato) e devolve o fim INCLUSIVO que a reserva guarda — e ele
 *     NUNCA pode ser anterior ao comeco (`fimNaoAntesDoInicio`): o banco recusa `end_date < start_date`
 *     e derruba o insert inteiro (era o defeito de producao de 24/09/2026).
 */
import { addDaysISO } from '@/features/calendar/dates';
import type { RemoteEvent } from './calendarSync';

export type BookingServiceType = 'daycare' | 'boarding';

export type ParsedBooking = {
  serviceType: BookingServiceType;
  dogName: string;
  clientName: string | null;
  /** Inicio (data do evento). */
  startDate: string;
  /** Fim INCLUSIVO (o evento do Google usa fim exclusivo). */
  endDate: string;
  /** 0 = domingo … 6 = sabado. Vazio = evento de um dia so. */
  weekdays: number[];
  /** Datas (ISO) de pausa (viram EXDATE no evento). */
  skipDates: string[];
  /** Serie sem data de fim (RRULE sem UNTIL). */
  openEnded: boolean;
};

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const SERVICE_PATTERNS: { padrao: RegExp; tipo: BookingServiceType }[] = [
  { padrao: /\bboarding\b|\bhospedagem\b|\bpernoite\b|\bhotel\b/i, tipo: 'boarding' },
  { padrao: /\bday\s*care\b|\bdaycare\b|\bcreche\b|\bdi[aá]ria\b/i, tipo: 'daycare' },
];

/** Compara nomes de cão/cliente sem acento e sem caixa ("Filó" == "filo"). */
export function normalizar(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Tem palavra de servico no titulo? Usado para interpretar o tipo, não para filtrar eventos. */
export function looksLikeBooking(title: string): boolean {
  return SERVICE_PATTERNS.some(({ padrao }) => padrao.test(title));
}

export function serviceOf(title: string): BookingServiceType | null {
  for (const { padrao, tipo } of SERVICE_PATTERNS) {
    if (padrao.test(title)) return tipo;
  }
  return null;
}

/**
 * Palavras de OPERAÇÃO do dia a dia: "Pick filó", "Drop Bella", "Pickup Mowgli (Amor)".
 * É assim que o escritório escreve na pressa — e essas datas TÊM de vir para o app. A reclamação do
 * dono (23/09/2026) foi exatamente um "Pick filó" que ficou de fora: sem palavra de serviço no
 * título, o evento era tratado como compromisso pessoal e ignorado.
 */
const ACTION_PATTERN = /\b(pick\s*up|pickup|drop\s*off|dropoff|pick|drop|buscar|pegar|levar|van|walk)\b/i;

/** Título que manda buscar/entregar o cão (com ou sem palavra de serviço). */
export function looksLikeTransport(title: string): boolean {
  return ACTION_PATTERN.test(title);
}

/**
 * Lê um título de operação: "Pick filó" → filó; "Drop off Bella (Amor)" → Bella, Amor.
 * O serviço não vem no título, então fica daycare (o caso comum de quem pede van no dia).
 */
export function parseTransportTitle(title: string): { dogName: string; clientName: string | null } | null {
  // A palavra de operação é OBRIGATÓRIA: sem ela isto não é um título de van, é um compromisso
  // pessoal qualquer ("Dentist 3pm") — e tratá-lo como reserva criaria um cão fantasma na revisão.
  if (!looksLikeTransport(title)) return null;
  let resto = limpar(title.replace(ACTION_PATTERN, ' '));
  let clientName: string | null = null;
  const parenteses = resto.match(/^(.*?)[\s]*\(([^)]+)\)\s*$/);
  if (parenteses) {
    resto = parenteses[1] ?? '';
    clientName = limpar(parenteses[2] ?? '') || null;
  }
  const dogName = limpar(resto);
  if (!dogName) return null;
  // "Pick up Kona — Leigh Ann": dois nomes no título de operação também são lidos.
  return comDoisNomes({ dogName, clientName });
}

/** Limpa separadores que sobram depois de tirar a palavra de servico. */
function limpar(valor: string): string {
  return valor.replace(/^[\s·\-–—:,;|]+/, '').replace(/[\s·\-–—:,;|]+$/, '').trim();
}

/**
 * Dois nomes no mesmo título: "Leigh Ann · Kona" (tutor · cão) e "Kona — Leigh Ann" (cão — tutor).
 *
 * Na maioria das vezes o título traz UM nome só e esse nome é o cão (o cliente nasce com o mesmo
 * nome, como placeholder que o gestor renomeia). Quando trazem DOIS, o dono pediu (24/09/2026) que
 * os dois sejam usados como cão e tutor:
 *   - ponto médio / barra: é a convenção do próprio app, que escreve os campos TERMINANDO no cão
 *     ("Daycare · Bella") → o CÃO é a última parte;
 *   - travessão com espaço em volta: o escritório escreve "Kona — Leigh Ann" → o CÃO é a primeira.
 * Com mais de dois pedaços valem o primeiro e o último. Pedaço que é palavra de serviço ou de
 * operação nunca vira tutor (senão "Pick · Bella" criaria um cliente chamado "Pick").
 */
const SEPARADOR_CONVENCAO_APP = /\s*[·|]\s*|\s+\/\s+/;
const SEPARADOR_TRACO = /\s+[–—-]\s+/;

function pedacos(valor: string, separador: RegExp): string[] {
  return valor
    .split(separador)
    .map((pedaco) => limpar(pedaco))
    .filter((pedaco) => pedaco.length > 0);
}

function ehQualificador(valor: string): boolean {
  return serviceOf(valor) !== null || ACTION_PATTERN.test(valor);
}

/**
 * Cão (e tutor, quando o título traz dois nomes) lidos de um título sem palavra-chave.
 * Devolve null quando não há dois nomes para separar (aí o nome do cão é o texto inteiro).
 */
export function nomesDoTitulo(resto: string): { dogName: string; clientName: string | null } | null {
  const grupos: { pedacos: string[]; caoPrimeiro: boolean }[] = [
    { pedacos: pedacos(resto, SEPARADOR_CONVENCAO_APP), caoPrimeiro: false },
    { pedacos: pedacos(resto, SEPARADOR_TRACO), caoPrimeiro: true },
  ];

  for (const grupo of grupos) {
    if (grupo.pedacos.length < 2) continue;
    const primeiro = grupo.pedacos[0];
    const ultimo = grupo.pedacos[grupo.pedacos.length - 1];
    // Um dos lados é serviço/operação ("Pick · Bella", "Bella · Daycare"): o outro é o cão.
    if (ehQualificador(primeiro) && !ehQualificador(ultimo)) return { dogName: ultimo, clientName: null };
    if (ehQualificador(ultimo) && !ehQualificador(primeiro)) return { dogName: primeiro, clientName: null };
    if (ehQualificador(primeiro) && ehQualificador(ultimo)) return null;
    return grupo.caoPrimeiro ? { dogName: primeiro, clientName: ultimo } : { dogName: ultimo, clientName: primeiro };
  }

  return null;
}

/** Aplica a leitura de dois nomes ao que o parser já leu (só quando não veio tutor entre parênteses). */
function comDoisNomes(lido: { dogName: string; clientName: string | null }): { dogName: string; clientName: string | null } {
  if (lido.clientName) return lido;
  const par = nomesDoTitulo(lido.dogName);
  return par ? { dogName: par.dogName, clientName: par.clientName } : lido;
}

/**
 * Le o titulo. Aceita o formato do app (`Daycare · Bella (Leigh Ann)`) e o que o escritorio digita
 * à mão (`Boarding - Bella`, `Bella daycare`, `creche: Mowgli`).
 */
export function parseBookingTitle(title: string): { serviceType: BookingServiceType; dogName: string; clientName: string | null } | null {
  const serviceType = serviceOf(title);
  if (!serviceType) return null;
  let resto = limpar(title.replace(SERVICE_PATTERNS.find((p) => p.tipo === serviceType)!.padrao, ' '));

  // Tutor entre parenteses (formato do app).
  let clientName: string | null = null;
  const parenteses = resto.match(/^(.*?)[\s]*\(([^)]+)\)\s*$/);
  if (parenteses) {
    resto = parenteses[1] ?? '';
    clientName = limpar(parenteses[2] ?? '') || null;
  }

  const dogName = limpar(resto);
  if (!dogName) return null;
  // "Daycare · Leigh Ann · Kona" (sem parênteses): o segundo nome é o tutor.
  const nomes = comDoisNomes({ dogName, clientName });
  return { serviceType, dogName: nomes.dogName, clientName: nomes.clientName };
}

/**
 * Fallback do calendário dedicado: sem palavra-chave, o título é o nome do cão.
 * Mantém o tutor opcional entre parênteses para desempatar cães com nomes iguais e reconhece os
 * dois nomes separados ("Leigh Ann · Kona" / "Kona — Leigh Ann").
 */
function parseDedicatedCalendarTitle(title: string): { dogName: string; clientName: string | null } | null {
  let resto = limpar(title);
  if (!resto) return null;
  let clientName: string | null = null;
  const parenteses = resto.match(/^(.*?)[\s]*\(([^)]+)\)\s*$/);
  if (parenteses) {
    resto = limpar(parenteses[1] ?? '');
    clientName = limpar(parenteses[2] ?? '') || null;
  }
  if (!resto) return null;
  return comDoisNomes({ dogName: resto, clientName });
}

/**
 * GARANTIA DURA: `end_date` nunca pode ser anterior a `start_date`.
 *
 * O banco tem `check (end_date >= start_date)` (migração 202609090002, linha 19) e um insert que
 * viole isso é recusado INTEIRO — foi assim que o gestor viu "1 item(s) from Google could not be
 * saved" em produção (24/09/2026): o evento com hora virava `start_date = 25/09`, `end_date = 24/09`.
 * Nenhum caminho desta camada pode produzir esse par, nem com evento malformado: fim vazio (o evento
 * sem `end` nenhum vira "NaN-NaN-NaN" e compara MAIOR que qualquer data ISO), fim antes do começo,
 * `UNTIL` anterior ao início. No pior caso o fim é o começo.
 * Comparação de texto serve — `YYYY-MM-DD` ordena igual a data.
 */
export function fimNaoAntesDoInicio(startDate: string, endDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return startDate;
  return endDate < startDate ? startDate : endDate;
}

/** Le a recorrencia (RRULE + EXDATE) de volta para o modelo do app. */
export function parseRecurrence(
  recurrence: string[] | null | undefined,
  startDate: string,
  endDateExclusive: string,
): { weekdays: number[]; endDate: string; skipDates: string[]; openEnded: boolean } {
  const blocos = recurrence ?? [];
  const skipDates = blocos
    .filter((bloco) => bloco.startsWith('EXDATE'))
    .flatMap((bloco) => bloco.replace(/^EXDATE[^:]*:/, '').split(','))
    .map((valor) => valor.trim().slice(0, 8))
    .filter((valor) => /^\d{8}$/.test(valor))
    .map((valor) => `${valor.slice(0, 4)}-${valor.slice(4, 6)}-${valor.slice(6, 8)}`)
    .filter((valor) => valor.length === 10)
    .sort();

  const rrule = blocos.find((bloco) => bloco.startsWith('RRULE'));
  if (!rrule) {
    // Evento de um dia só: `endDateExclusive` é o primeiro dia FORA do evento (é o formato do Google
    // e o que `fimExclusivoDoEvento`, em `calendarApi`, garante também para evento COM HORA), então o
    // fim INCLUSIVO que o app guarda é o dia anterior.
    return { weekdays: [], endDate: fimNaoAntesDoInicio(startDate, addDaysISO(endDateExclusive, -1)), skipDates, openEnded: false };
  }

  const byday = /BYDAY=([^;]+)/.exec(rrule)?.[1];
  const weekdays = (byday ?? '')
    .split(',')
    .map((dia) => BYDAY.indexOf(dia.trim().slice(0, 2).toUpperCase()))
    .filter((indice) => indice >= 0)
    .sort((a, b) => a - b);

  const until = /UNTIL=(\d{8})/.exec(rrule)?.[1];
  const openEnded = !until;
  // `UNTIL` é INCLUSIVO no RRULE: a data dele é o último dia da série (não recua, diferente do fim
  // do evento avulso). Série sem UNTIL termina onde começa — o fim real é "aberto" (`openEnded`).
  const endDate = fimNaoAntesDoInicio(startDate, until ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}` : startDate);

  return { weekdays, endDate, skipDates, openEnded };
}

/** Evento do Google -> reserva; só um evento sem título legível retorna null. */
export function parseBookingEvent(event: RemoteEvent): ParsedBooking | null {
  // Calendário dedicado: formato do app, operação do escritório ou título livre (normalmente só o
  // nome do cão). Não existe mais filtro por palavra-chave — decisão do dono em 24/09/2026.
  const titulo = parseBookingTitle(event.summary);
  const lido = titulo ?? parseTransportTitle(event.summary) ?? parseDedicatedCalendarTitle(event.summary);
  if (!lido) return null;
  const recorrencia = parseRecurrence(event.recurrence, event.startDate, event.endDate);
  return {
    serviceType: titulo?.serviceType ?? 'daycare',
    dogName: lido.dogName,
    clientName: lido.clientName,
    startDate: event.startDate,
    ...recorrencia,
  };
}

/* ------------------------------- plano da importação ------------------------------- */

export type DogForImport = {
  id: string;
  name: string;
  clientName?: string | null;
  /** Cliente do cão no cadastro — permite pendurar um cão novo em cliente que já existe. */
  clientId?: string | null;
};

/** O que já existe no app e pode estar ligado a um evento do Google. */
export type ExistingBookingKind = 'reservation' | 'recurring';

export type BookingForImport = {
  id: string;
  /**
   * 'reservation' = data avulsa (`reservations`); 'recurring' = série de dias da semana
   * (`recurring_schedules`). O Google não distingue os dois: quem distingue é o RRULE do evento e
   * o tipo da linha que já está ligada a ele.
   */
  kind: ExistingBookingKind;
  dogId: string;
  googleEventId: string | null;
  source: 'app' | 'google';
  serviceType: BookingServiceType;
  startDate: string;
  endDate: string | null;
  weekdays?: number[] | null;
  skipDates?: string[] | null;
  /** 'confirmed' (reserva) ou 'active' (série) — comparado como texto. */
  status: string;
};

export type ImportWindow = { from: string; to: string };

export type ReviewReason = 'unknown dog' | 'ambiguous dog' | 'unreadable' | 'duplicate';

/**
 * Cão que o título pede e que AINDA NÃO existe no cadastro (decisão do dono, 24/09/2026: o
 * agendamento do Google entra e o app cadastra o cão).
 *
 * Regra dos nomes: o título com dois nomes ("Leigh Ann · Kona", "Kona — Leigh Ann") dá cão E tutor;
 * com um nome só, esse nome é o cão e o cliente nasce com o MESMO nome (placeholder que o gestor
 * renomeia depois). Nome vazio nunca vira cadastro — vira pendência de revisão.
 */
export type NewDogForCreate = {
  /** Nome do cão — vem do título, nunca vazio. */
  name: string;
  /** Nome do cliente a cadastrar quando ele ainda não existe (tutor do título, ou o nome do cão). */
  clientName: string;
  /** Cliente que JÁ existe no cadastro (tutor casado pelo nome): não cria cliente repetido. */
  clientId?: string | null;
};

export type ImportOutcome =
  | { kind: 'create'; eventId: string; dogId: string; parsed: ParsedBooking }
  | { kind: 'create'; eventId: string; dogId: null; newDog: NewDogForCreate; parsed: ParsedBooking }
  | { kind: 'update'; eventId: string; bookingKind: ExistingBookingKind; bookingId: string; dogId: string; parsed: ParsedBooking }
  | { kind: 'cancel'; eventId: string; bookingKind: ExistingBookingKind; bookingId: string }
  | { kind: 'review'; eventId: string; title: string; date: string; parsed: ParsedBooking; reason: ReviewReason };

function mesmosDias(a?: number[] | null, b?: number[] | null): boolean {
  const left = [...(a ?? [])].sort((x, y) => x - y);
  const right = [...(b ?? [])].sort((x, y) => x - y);
  return left.length === right.length && left.every((valor, indice) => valor === right[indice]);
}

function mesmaLista(a?: string[] | null, b?: string[] | null): boolean {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  return left.length === right.length && left.every((valor, indice) => valor === right[indice]);
}

/** Série (vários dias da semana) ou data avulsa? */
export function kindOf(parsed: ParsedBooking): ExistingBookingKind {
  return parsed.weekdays.length > 0 ? 'recurring' : 'reservation';
}

/** Compara só o que a importação controla (e ignora pausas, que na série moram em outra tabela). */
function precisaAtualizar(reserva: BookingForImport, parsed: ParsedBooking, dogId: string): boolean {
  const serie = reserva.kind === 'recurring';
  return (
    reserva.dogId !== dogId ||
    reserva.serviceType !== parsed.serviceType ||
    reserva.startDate !== parsed.startDate ||
    (serie ? (reserva.endDate ?? null) !== (parsed.openEnded ? null : parsed.endDate) : reserva.endDate !== parsed.endDate) ||
    (serie ? !mesmosDias(reserva.weekdays, parsed.weekdays) : false) ||
    (serie ? false : !mesmaLista(reserva.skipDates, parsed.skipDates)) ||
    reserva.status !== (serie ? 'active' : 'confirmed')
  );
}

/**
 * Data (ISO) anterior ao começo da janela? A janela é o contrato da importação: quem chama passa
 * `from` = HOJE (data local), então isto é o que garante "nada do passado" — nenhum evento com data
 * anterior a hoje é criado, alterado ou cancelado (comparação de texto serve: `YYYY-MM-DD` ordena
 * igual a data).
 */
function antesDaJanela(date: string | null | undefined, window: ImportWindow): boolean {
  return !date || date < window.from;
}

/** Cliente que já existe no cadastro, casado pelo nome do tutor que veio no título. */
function clienteConhecido(clientName: string | null, dogs: DogForImport[]): string | null {
  if (!clientName) return null;
  const alvo = normalizar(clientName);
  const dono = dogs.find((cao) => cao.clientId && cao.clientName && normalizar(cao.clientName) === alvo);
  return dono?.clientId ?? null;
}

/**
 * Cadastro que o título pede: nome do cão + cliente (tutor do título; sem tutor, o próprio nome do
 * cão como placeholder). Se o tutor já tem cão no cadastro, o cão novo entra NO cliente que existe —
 * dois eventos do mesmo tutor não podem virar dois clientes iguais.
 */
export function novoCadastro(parsed: ParsedBooking, dogs: DogForImport[]): NewDogForCreate {
  const name = parsed.dogName.trim();
  const tutor = parsed.clientName?.trim() || null;
  const clientId = clienteConhecido(tutor, dogs);
  return clientId ? { name, clientName: tutor ?? name, clientId } : { name, clientName: tutor ?? name };
}

/**
 * O que fazer com o que está no Google. Determinístico e sem rede.
 *
 * `events` já vem recortado pela janela da consulta (timeMin/timeMax), e `window` é a mesma janela
 * em datas — nada anterior a `window.from` (hoje) entra no plano, seja criar, alterar ou cancelar.
 */
export function planCalendarImport(
  events: RemoteEvent[],
  dogs: DogForImport[],
  reservations: BookingForImport[],
  window: ImportWindow,
): ImportOutcome[] {
  const porEvento = new Map<string, BookingForImport>();
  for (const reserva of reservations) {
    if (reserva.googleEventId) porEvento.set(reserva.googleEventId, reserva);
  }

  const resultados: ImportOutcome[] = [];
  const vistos = new Set<string>();

  for (const evento of [...events].sort((a, b) => a.id.localeCompare(b.id))) {
    // 1. Evento com marca do app é o nosso espelho: o espelho cuida dele, não a importação.
    if (evento.appKey) continue;

    const parsed = parseBookingEvent(evento);
    // 2. Até evento sem título precisa aparecer para revisão; o calendário é exclusivo do negócio.
    //    Exceção: evento que COMEÇOU antes de hoje não gera nada — nem reserva, nem pendência
    //    (senão uma hospedagem em curso criaria/alteraria/cancelaria data passada).
    if (!parsed) {
      if (antesDaJanela(evento.startDate, window)) continue;
      const recorrencia = parseRecurrence(evento.recurrence, evento.startDate, evento.endDate);
      resultados.push({
        kind: 'review',
        eventId: evento.id,
        title: evento.summary,
        date: evento.startDate,
        parsed: {
          serviceType: serviceOf(evento.summary) ?? 'daycare',
          dogName: evento.summary.trim() || '(no title)',
          clientName: null,
          startDate: evento.startDate,
          ...recorrencia,
        },
        reason: 'unreadable',
      });
      continue;
    }

    if (antesDaJanela(parsed.startDate, window)) continue;

    // 3. Casa o cao pelo nome (e pelo tutor quando o titulo traz).
    const alvo = normalizar(parsed.dogName);
    let candidatos = dogs.filter((cao) => normalizar(cao.name) === alvo);
    if (candidatos.length > 1 && parsed.clientName) {
      const tutor = normalizar(parsed.clientName);
      const filtrados = candidatos.filter((cao) => (cao.clientName ? normalizar(cao.clientName) === tutor : false));
      if (filtrados.length > 0) candidatos = filtrados;
    }
    /** Cão do cadastro que o título aponta agora (null = o título não aponta para nenhum). */
    const dogDoTitulo = candidatos.length === 1 ? candidatos[0].id : null;

    // 4. Vínculo por EVENTO (não por nome): se o evento já tem reserva no app, ela é a referência.
    //    Título que não aponta para nenhum cão do cadastro (o caso do cão RENOMEADO no app depois da
    //    importação) NÃO cria cadastro novo: a reserva segue com o cão dela, que é o mesmo evento.
    const ligada = porEvento.get(evento.id) ?? null;
    if (ligada) {
      vistos.add(evento.id);
      const dogId = dogDoTitulo ?? ligada.dogId;
      if (ligada.source === 'google' && precisaAtualizar(ligada, parsed, dogId)) {
        resultados.push({ kind: 'update', eventId: evento.id, bookingKind: ligada.kind, bookingId: ligada.id, dogId, parsed });
      }
      continue;
    }

    // 5. Cão que NÃO casa (nenhum ou mais de um): decisão do dono (24/09/2026) — o agendamento entra
    //    igual, criando cliente + cão com o nome do título. Sem nome não se cria cadastro: vai para
    //    a revisão, onde o gestor escolhe o cão.
    if (!dogDoTitulo) {
      if (!parsed.dogName.trim()) {
        resultados.push({ kind: 'review', eventId: evento.id, title: evento.summary, date: evento.startDate, parsed, reason: 'unreadable' });
        continue;
      }
      vistos.add(evento.id);
      resultados.push({ kind: 'create', eventId: evento.id, dogId: null, newDog: novoCadastro(parsed, dogs), parsed });
      continue;
    }

    const dogId = dogDoTitulo;
    vistos.add(evento.id);

    // 6. Igual a uma reserva que o app ja tem = duplicata: o gestor decide (liga o evento a ela).
    const tipo = kindOf(parsed);
    const gemea = reservations.find(
      (reserva) =>
        reserva.kind === tipo &&
        reserva.dogId === dogId &&
        reserva.serviceType === parsed.serviceType &&
        reserva.startDate === parsed.startDate &&
        (tipo === 'recurring' ? mesmosDias(reserva.weekdays, parsed.weekdays) : reserva.endDate === parsed.endDate) &&
        reserva.status === 'confirmed',
    );
    if (gemea) {
      resultados.push({ kind: 'review', eventId: evento.id, title: evento.summary, date: evento.startDate, parsed, reason: 'duplicate' });
      continue;
    }

    resultados.push({ kind: 'create', eventId: evento.id, dogId, parsed });
  }

  // 7. Reserva vinda do Google cujo evento sumiu: cancelar — so dentro da janela consultada.
  for (const reserva of reservations) {
    if (reserva.source !== 'google' || !reserva.googleEventId) continue;
    if (reserva.status !== 'confirmed') continue;
    if (vistos.has(reserva.googleEventId)) continue;
    const dentroDaJanela = !antesDaJanela(reserva.startDate, window) && reserva.startDate <= window.to;
    if (!dentroDaJanela) continue;
    const aindaExiste = events.some((evento) => evento.id === reserva.googleEventId);
    if (!aindaExiste) {
      resultados.push({ kind: 'cancel', eventId: reserva.googleEventId, bookingKind: reserva.kind, bookingId: reserva.id });
    }
  }

  return resultados;
}

/** Resumo curto para a tela (mesmo tom do resumo do espelho e no idioma da interface: inglês). */
export function describeImport(resumo: { created: number; updated: number; cancelled: number; review: number }): string {
  const partes: string[] = [];
  if (resumo.created) partes.push(`${resumo.created} from Google`);
  if (resumo.updated) partes.push(`${resumo.updated} updated`);
  if (resumo.cancelled) partes.push(`${resumo.cancelled} cancelled`);
  if (resumo.review) partes.push(`${resumo.review} to review`);
  return partes.length ? partes.join(' · ') : '';
}

/** Falha de um item da importação: o evento (ou a reserva) e a mensagem que veio do banco. */
export type ImportFailure = { eventId?: string; reservationId?: string; error: string };

/**
 * Motivos conhecidos, na língua da tela.
 *
 * O erro cru do Postgres não serve para o suporte: `new row for relation "reservations" violates check
 * constraint "reservations_check"` não diz o que aconteceu nem onde olhar. O caso que apareceu em
 * produção (24/09/2026) é justamente o `check (end_date >= start_date)` da migração 202609090002.
 */
const MOTIVOS_CONHECIDOS: { padrao: RegExp; texto: string }[] = [
  { padrao: /check constraint "(public\.)?reservations_check"/i, texto: 'end_date before start_date' },
  { padrao: /check constraint "(public\.)?reservations_(service_type|status)_check"/i, texto: 'reservation with an invalid value' },
  { padrao: /duplicate key value.*reservations/i, texto: 'this event already has a reservation' },
];

/** Motivo curto e legível de uma falha (usado na tela; erro cru cortado para não estourar o layout). */
export function motivoDaFalha(error: string): string {
  const texto = (error ?? '').trim();
  for (const { padrao, texto: legivel } of MOTIVOS_CONHECIDOS) {
    if (padrao.test(texto)) return legivel;
  }
  return texto.length > 140 ? `${texto.slice(0, 137)}...` : texto;
}

/**
 * Erro da importação para a tela: quantos itens falharam E o motivo da PRIMEIRA falha.
 *
 * Pedido do dono (24/09/2026): a tela mostrava só "1 item(s) from Google could not be saved" e nem o
 * gestor nem o suporte sabiam se era rede, permissão ou uma data inválida — o motivo da primeira
 * falha é o que aponta o caminho (e é o que torna o defeito reproduzível pelo relato de tela).
 */
export function describeImportFailure(failures: ImportFailure[]): string {
  if (failures.length === 0) return '';
  return `${failures.length} item(s) from Google could not be saved. First: ${motivoDaFalha(failures[0].error)}`;
}
