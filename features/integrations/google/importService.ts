/**
 * Executor da importação (Google Calendar -> app): lista os eventos, planeja pelo módulo puro e
 * aplica no banco. Falha em um item NÃO aborta os outros — o resumo diz o que passou e o que falhou.
 *
 * As escritas no banco entram por "portas" (`ports`), o que mantém este módulo testável sem Supabase
 * e deixa o SQL/RLS na tela que chama (é a sessão do gestor que grava).
 *
 * REGRA NOVA (dono, 24/09/2026): o app só importa agendamento de cão que JÁ existe no cadastro e o
 * serviço vem da COR do evento. Por isso este executor NÃO tem mais porta de cadastro
 * (`createClient`/`createDog`) nem limpeza de cadastro: cão fora do cadastro não é criado — vira
 * pendência na tela (`unknown dog`/`ambiguous dog`), que o escritório resolve cadastrando e
 * sincronizando de novo.
 */
import type { CalendarFetch } from './calendarApi';
import { listAllEvents } from './calendarApi';
import { DEFAULT_CALENDAR_ID } from './calendarChoice';
import type { EventLabel } from '@/features/calendar/googleColors';
import {
  kindOf,
  planCalendarImport,
  type BookingForImport,
  type DogForImport,
  type ExistingBookingKind,
  type ImportFailure,
  type ImportOutcome,
  type ImportWindow,
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
  /** Cria a reserva (data avulsa) ou a série (dias da semana) conforme o formato do evento. */
  createBooking: (input: { eventId: string; dogId: string; kind: ExistingBookingKind; parsed: ParsedBooking }) => Promise<void>;
  updateBooking: (input: { bookingId: string; kind: ExistingBookingKind; eventId: string; dogId: string; parsed: ParsedBooking }) => Promise<void>;
  /** Cancela a reserva (marca cancelada) ou desativa a série — o cliente desmarcou no Google. */
  cancelBooking: (input: { bookingId: string; kind: ExistingBookingKind; eventId: string }) => Promise<void>;
  /**
   * Pula UM dia de uma série: é o que o evento vermelho faz quando o dia cancelado pertence a uma
   * escala (desativar a série inteira por causa de um dia seria destruir o agendamento do cliente).
   */
  skipRecurringDay: (input: { scheduleId: string; date: string; eventId: string }) => Promise<void>;
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
  /**
   * Etiquetas de cor do calendario escolhido (paleta NOVA do Google). Quem as le e o cartao, que ja
   * precisa delas para o espelho; sem etiqueta a importacao le so o `colorId` legado.
   */
  labels?: EventLabel[];
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
  labels = [],
}: ImportParams): Promise<ImportSummary> {
  const eventos = await listAllEvents(accessToken, range, doFetch, calendarId);
  const plano = planCalendarImport(eventos, dogs, reservations, window, { labels });

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
      const alvo = 'bookingId' in item ? item.bookingId : 'scheduleId' in item ? item.scheduleId : undefined;
      resumo.failures.push({
        eventId: item.eventId,
        reservationId: item.kind === 'create' ? undefined : alvo,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return resumo;
}

async function aplicar(item: Exclude<ImportOutcome, { kind: 'review' }>, ports: ImportPorts): Promise<void> {
  if (item.kind === 'create') {
    await ports.createBooking({ eventId: item.eventId, dogId: item.dogId, kind: kindOf(item.parsed), parsed: item.parsed });
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
  if (item.kind === 'skip') {
    await ports.skipRecurringDay({ scheduleId: item.scheduleId, date: item.date, eventId: item.eventId });
    return;
  }
  await ports.cancelBooking({ bookingId: item.bookingId, kind: item.bookingKind, eventId: item.eventId });
}

export function hasImportChanges(resumo: ImportSummary): boolean {
  return resumo.created + resumo.updated + resumo.cancelled > 0 || resumo.review.length > 0;
}
