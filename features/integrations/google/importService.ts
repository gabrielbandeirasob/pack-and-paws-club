/**
 * Executor da importação (Google Calendar -> app): lista os eventos, planeja pelo módulo puro e
 * aplica no banco. Falha em um item NÃO aborta os outros — o resumo diz o que passou e o que falhou.
 *
 * As escritas no banco entram por "portas" (`ports`), o que mantém este módulo testável sem Supabase
 * e deixa o SQL/RLS na tela que chama (é a sessão do gestor que grava).
 *
 * Pedido do dono (24/09/2026): "quando clicar para sincronizar, puxe TODOS os agendamentos do Google
 * do cliente". Por isso o evento cujo título não casa com nenhum cão do app também entra: a porta
 * `createClient` + `createDog` cadastra o cão (e o cliente) com o nome do título e a reserva nasce em
 * seguida, já ligada ao evento.
 */
import type { CalendarFetch } from './calendarApi';
import { listAllEvents } from './calendarApi';
import { DEFAULT_CALENDAR_ID } from './calendarChoice';
import {
  kindOf,
  planCalendarImport,
  type BookingForImport,
  type DogForImport,
  type ExistingBookingKind,
  type ImportFailure,
  type ImportOutcome,
  type ImportWindow,
  type NewDogForCreate,
  type ParsedBooking,
  type ReviewReason,
} from './importPlan';

export type ImportReviewItem = {
  eventId: string;
  title: string;
  date: string;
  reason: ReviewReason;
  parsed: ParsedBooking;
};

export type ImportSummary = {
  created: number;
  updated: number;
  cancelled: number;
  review: ImportReviewItem[];
  /** Itens que falharam, com o motivo cru — a tela mostra o motivo da PRIMEIRA (`describeImportFailure`). */
  failures: ImportFailure[];
};

export type ImportPorts = {
  /**
   * Cliente da reserva que nasceu de um título sem cão no cadastro (o cliente nasce com o nome do
   * tutor, ou com o próprio nome do cão quando o título traz um nome só).
   *
   * `criadoAgora` diz se a porta CRIOU o cliente (a porta procura antes de criar). Sem o campo, conta
   * como NÃO criado: apagar um cliente que já existia seria destrutivo, e a limpeza é só do que esta
   * rodada fez.
   */
  createClient: (input: { name: string }) => Promise<{ clientId: string; criadoAgora?: boolean }>;
  /**
   * Cão do mesmo caso: entra sob o cliente informado.
   *
   * `criadoAgora` diz se a porta CRIOU o cão (ela também procura antes de criar). Sem o campo, conta
   * como criado agora — é o que uma porta simples faz (devolve um id novo) e é o caso que precisa de
   * limpeza quando a reserva falha.
   */
  createDog: (input: { clientId: string; name: string }) => Promise<{ dogId: string; criadoAgora?: boolean }>;
  /** Cria a reserva (data avulsa) ou a série (dias da semana) conforme o formato do evento. */
  createBooking: (input: { eventId: string; dogId: string; kind: ExistingBookingKind; parsed: ParsedBooking }) => Promise<void>;
  updateBooking: (input: { bookingId: string; kind: ExistingBookingKind; eventId: string; dogId: string; parsed: ParsedBooking }) => Promise<void>;
  /** Cancela a reserva (marca cancelada) ou desativa a série — o cliente desmarcou no Google. */
  cancelBooking: (input: { bookingId: string; kind: ExistingBookingKind; eventId: string }) => Promise<void>;
  /**
   * Desfaz o CÃO que esta rodada criou quando a reserva falhou depois dele (senão o Sync deixa cão
   * sem reserva no cadastro — foi o que aconteceu na org do cliente: 2 cães "dog pietro" órfãos).
   * A implementação real sempre oferece esta porta; ela é opcional no tipo para não quebrar portas
   * de mentira, e a limpeza é melhor esforço (o erro que a tela mostra é o da reserva).
   */
  removeDog?: (input: { dogId: string }) => Promise<void>;
  /** Cliente que esta rodada criou e que ficou SEM cão nenhum depois da limpeza acima. */
  removeClientIfEmpty?: (input: { clientId: string }) => Promise<void>;
};

export type ImportParams = {
  accessToken: string;
  range: { timeMin: string; timeMax: string };
  /** Janela em datas (ISO) — usada para decidir o que conta como "evento apagado". */
  window: ImportWindow;
  dogs: DogForImport[];
  reservations: BookingForImport[];
  doFetch: CalendarFetch;
  ports: ImportPorts;
  /** Calendario escolhido pela organizacao (o mesmo do espelho). Padrao: o principal. */
  calendarId?: string;
};

export async function runCalendarImport({
  accessToken,
  range,
  window,
  dogs,
  reservations,
  doFetch,
  ports,
  calendarId = DEFAULT_CALENDAR_ID,
}: ImportParams): Promise<ImportSummary> {
  const eventos = await listAllEvents(accessToken, range, doFetch, calendarId);
  const plano = planCalendarImport(eventos, dogs, reservations, window);

  const resumo: ImportSummary = { created: 0, updated: 0, cancelled: 0, review: [], failures: [] };

  for (const item of plano) {
    if (item.kind === 'review') {
      resumo.review.push({ eventId: item.eventId, title: item.title, date: item.date, reason: item.reason, parsed: item.parsed });
      continue;
    }
    try {
      await aplicar(item, ports);
      if (item.kind === 'create') resumo.created += 1;
      else if (item.kind === 'update') resumo.updated += 1;
      else resumo.cancelled += 1;
    } catch (error) {
      resumo.failures.push({
        eventId: item.eventId,
        reservationId: item.kind === 'create' ? undefined : item.bookingId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return resumo;
}

async function aplicar(item: Exclude<ImportOutcome, { kind: 'review' }>, ports: ImportPorts): Promise<void> {
  if (item.kind === 'create') {
    // Cão que ainda não existe no app: cadastra cliente e cão ANTES da reserva (a reserva precisa do
    // id do cão). O vínculo continua sendo o evento (`eventId`), então um segundo Sync não repete.
    const cadastro: CadastroDaRodada = 'newDog' in item
      ? await criarCadastro(item.newDog, ports)
      : { dogId: item.dogId, criadoAgora: false, clientId: null, clienteCriadoAgora: false };
    try {
      await ports.createBooking({ eventId: item.eventId, dogId: cadastro.dogId, kind: kindOf(item.parsed), parsed: item.parsed });
    } catch (error) {
      // A reserva não nasceu: o cadastro que ESTA rodada criou não pode ficar pendurado sem nada
      // (foi assim que a org do cliente ficou com 2 cães "dog pietro" sem reserva). O erro que sobe
      // continua sendo o da reserva — é ele que a tela mostra.
      await desfazerCadastro(cadastro, ports);
      throw error;
    }
    return;
  }
  if (item.kind === 'update') {
    await ports.updateBooking({
      bookingId: item.bookingId,
      kind: item.bookingKind,
      eventId: item.eventId,
      dogId: item.dogId,
      parsed: item.parsed,
    });
    return;
  }
  await ports.cancelBooking({ bookingId: item.bookingId, kind: item.bookingKind, eventId: item.eventId });
}

/** O que a rodada acabou de criar, para poder desfazer se a reserva falhar depois. */
type CadastroDaRodada = {
  dogId: string;
  /** Falso = cão que já estava no cadastro: nunca é apagado por causa de uma falha da reserva. */
  criadoAgora: boolean;
  clientId: string | null;
  /** Cliente criado NESTA rodada (a porta procura antes de criar — ver `ImportPorts.createClient`). */
  clienteCriadoAgora: boolean;
};

/**
 * Cliente + cão que o título pede e que ainda não existem. O cliente só é criado quando o título não
 * trouxe um tutor que já está no cadastro (aí a porta devolve o cliente existente).
 */
async function criarCadastro(novo: NewDogForCreate, ports: ImportPorts): Promise<CadastroDaRodada> {
  const clienteExistente = novo.clientId ?? null;
  let clientId = clienteExistente;
  let clienteCriadoAgora = false;
  if (!clientId) {
    const criado = await ports.createClient({ name: novo.clientName });
    clientId = criado.clientId;
    // Só conta como "criado agora" quando a porta AFIRMA que criou: ela procura antes de criar, e um
    // cliente que já existia não pode ser apagado por causa de uma falha da reserva.
    clienteCriadoAgora = criado.criadoAgora === true;
  }
  const cao = await ports.createDog({ clientId, name: novo.name });
  return { dogId: cao.dogId, criadoAgora: cao.criadoAgora !== false, clientId, clienteCriadoAgora };
}

/**
 * Desfaz o cadastro da rodada quando a reserva falhou (melhor esforço: nunca esconde o erro original).
 *
 * Regras: cão que já existia no cadastro NÃO é apagado (pode ter reservas/histórico); cliente só sai
 * quando a porta afirmou que o criou e ele ficou sem cão nenhum (a porta real confere isso no banco).
 */
async function desfazerCadastro(cadastro: CadastroDaRodada, ports: ImportPorts): Promise<void> {
  if (!cadastro.criadoAgora) return;
  try {
    if (!ports.removeDog) return;
    await ports.removeDog({ dogId: cadastro.dogId });
    if (cadastro.clienteCriadoAgora && cadastro.clientId && ports.removeClientIfEmpty) {
      await ports.removeClientIfEmpty({ clientId: cadastro.clientId });
    }
  } catch {
    // Limpeza é melhor esforço: o que interessa na tela é o motivo da reserva que falhou.
  }
}

export function hasImportChanges(resumo: ImportSummary): boolean {
  return resumo.created + resumo.updated + resumo.cancelled > 0 || resumo.review.length > 0;
}
