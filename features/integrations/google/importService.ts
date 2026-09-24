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
  type DogForImport,
  type BookingForImport,
  type ExistingBookingKind,
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
  failures: { eventId?: string; reservationId?: string; error: string }[];
};

export type ImportPorts = {
  /**
   * Cliente da reserva que nasceu de um título sem cão no cadastro (o cliente nasce com o nome do
   * tutor, ou com o próprio nome do cão quando o título traz um nome só).
   */
  createClient: (input: { name: string }) => Promise<{ clientId: string }>;
  /** Cão do mesmo caso: entra sob o cliente informado. */
  createDog: (input: { clientId: string; name: string }) => Promise<{ dogId: string }>;
  /** Cria a reserva (data avulsa) ou a série (dias da semana) conforme o formato do evento. */
  createBooking: (input: { eventId: string; dogId: string; kind: ExistingBookingKind; parsed: ParsedBooking }) => Promise<void>;
  updateBooking: (input: { bookingId: string; kind: ExistingBookingKind; eventId: string; dogId: string; parsed: ParsedBooking }) => Promise<void>;
  /** Cancela a reserva (marca cancelada) ou desativa a série — o cliente desmarcou no Google. */
  cancelBooking: (input: { bookingId: string; kind: ExistingBookingKind; eventId: string }) => Promise<void>;
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
    const dogId = item.dogId ?? (await criarCadastro(item.newDog, ports));
    await ports.createBooking({ eventId: item.eventId, dogId, kind: kindOf(item.parsed), parsed: item.parsed });
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

/**
 * Cliente + cão que o título pede e que ainda não existem. O cliente só é criado quando o título não
 * trouxe um tutor que já está no cadastro (aí a porta devolve o cliente existente).
 */
async function criarCadastro(novo: NewDogForCreate, ports: ImportPorts): Promise<string> {
  const clientId = novo.clientId ?? (await ports.createClient({ name: novo.clientName })).clientId;
  const { dogId } = await ports.createDog({ clientId, name: novo.name });
  return dogId;
}

export function hasImportChanges(resumo: ImportSummary): boolean {
  return resumo.created + resumo.updated + resumo.cancelled > 0 || resumo.review.length > 0;
}
