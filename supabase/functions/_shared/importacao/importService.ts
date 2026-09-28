// GERADO por scripts/gera-importacao-compartilhada.mjs — NÃO EDITE ESTE ARQUIVO.
// Edite o original no app (features/...) e rode o gerador: o teste importacao-compartilhada falha
// se esta cópia ficar desatualizada.
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
import type { CalendarFetch } from './calendarApi.ts';
import { listAllEvents } from './calendarApi.ts';
import { DEFAULT_CALENDAR_ID } from './calendarChoice.ts';
import type { EventLabel } from './googleColors.ts';
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
} from './importPlan.ts';

export type ImportReviewItem = {
  eventId: string;
  title: string;
  date: string;
  reason: ReviewReason;
  parsed: ParsedBooking;
};

export type ImportSummary = {
  created: number;
  /**
   * Eventos que já tinham reserva no app (o banco recusou por único). Entrou em 27/09/2026, quando o
   * escritório viu *"26 item(s) from Google could not be saved"* numa rodada em que a lista local estava
   * desatualizada: o certo é dizer "já está no app", não acusar falha.
   */
  already: number;
  updated: number;
  cancelled: number;
  /** Dias extras ligados a escalas (evento ROXO) — o dia entrou na escala, não virou reserva avulsa. */
  extraDays: number;
  review: ImportReviewItem[];
  /** Itens que falharam, com o motivo cru — a tela mostra o motivo da PRIMEIRA (`describeImportFailure`). */
  failures: ImportFailure[];
};

export type ImportPorts = {
  /**
   * Cria a reserva (data avulsa) ou a série (dias da semana) conforme o formato do evento.
   *
   * `semVinculo` = o evento JÁ ficou ligado a outra reserva desta mesma rodada (casa com dois cães:
   * cada um tem a sua reserva). O banco só aceita UM `google_event_id` por organização
   * (`reservations_google_event_unico`), então a partir da segunda reserva o vínculo não é repetido —
   * sem isso, a segunda tentativa virava o erro "this event already has a reservation" na tela.
   */
  createBooking: (input: { eventId: string; dogId: string; kind: ExistingBookingKind; parsed: ParsedBooking; semVinculo?: boolean }) => Promise<'created' | 'already'>;
  updateBooking: (input: { bookingId: string; kind: ExistingBookingKind; eventId: string; dogId: string; parsed: ParsedBooking; semVinculo?: boolean }) => Promise<void>;
  /** Cancela a reserva (marca cancelada) ou desativa a série — o cliente desmarcou no Google. */
  cancelBooking: (input: { bookingId: string; kind: ExistingBookingKind; eventId: string }) => Promise<void>;
  /**
   * Pula UM dia de uma série: é o que o evento vermelho faz quando o dia cancelado pertence a uma
   * escala (desativar a série inteira por causa de um dia seria destruir o agendamento do cliente).
   */
  skipRecurringDay: (input: { scheduleId: string; date: string; eventId: string }) => Promise<void>;
  /**
   * Dia EXTRA na escala (evento ROXO): o cliente de dia fixo mudou o dia / veio fora da ordem. O dia
   * fica ligado à escala em vez de virar reserva avulsa ("não ficar serviço solto", dono 24/09/2026).
   * Idempotente: regravar o mesmo dia substitui a linha em vez de acumular.
   */
  addScheduleExtraDay: (input: { scheduleId: string; date: string; eventId: string }) => Promise<void>;
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

  const resumo: ImportSummary = { created: 0, already: 0, updated: 0, cancelled: 0, extraDays: 0, review: [], failures: [] };

  /**
   * Eventos que JÁ ganharam reserva nesta rodada: a segunda reserva do mesmo evento (casa com dois cães)
   * nasce sem o vínculo do evento, porque o índice do banco é único por evento.
   *
   * Começa com os eventos que JÁ têm uma reserva vinculada no app: o vínculo daquele evento está
   * tomado, então qualquer reserva NOVA para ele (o segundo cão do mesmo evento) precisa nascer sem o
   * vínculo. Sem esta semente o insert do segundo cão batia no índice único, a rodada respondia
   * "already in the app" e **o segundo cão ficava sem reserva nenhuma** (medido em 28/09/2026).
   */
  const eventosComReserva = new Set<string>(
    reservations.map((reserva) => reserva.googleEventId).filter((id): id is string => Boolean(id)),
  );

  for (const item of plano) {
    if (item.kind === 'review') {
      resumo.review.push({ eventId: item.eventId, title: item.title, date: item.date, reason: item.reason, parsed: item.parsed });
      continue;
    }
    // O vínculo do evento já está tomado (por uma reserva que existe ou por outra criação desta
    // rodada)? Então a reserva NOVA nasce sem ele — e o mesmo valor vai para o registro da falha.
    const semVinculo =
      item.kind === 'create' ? eventosComReserva.has(item.eventId) : item.kind === 'update' ? Boolean(item.semVinculo) : false;
    try {
      const resultado = await aplicar(item, ports, { semVinculo });
      if (item.kind === 'create') {
        // Evento que já tinha reserva não é erro nem criação: é o app confirmando o que já existe.
        if (resultado === 'already') {
          resumo.already += 1;
        } else {
          resumo.created += 1;
          eventosComReserva.add(item.eventId);
        }
      }
      else if (item.kind === 'update') resumo.updated += 1;
      else if (item.kind === 'extraDay') resumo.extraDays += 1;
      else resumo.cancelled += 1;
    } catch (error) {
      const alvo = 'bookingId' in item ? item.bookingId : 'scheduleId' in item ? item.scheduleId : undefined;
      resumo.failures.push({
        eventId: item.eventId,
        reservationId: item.kind === 'create' ? undefined : alvo,
        dogId: 'dogId' in item ? item.dogId : undefined,
        serviceType: 'parsed' in item ? item.parsed.serviceType : undefined,
        semVinculo,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return resumo;
}

async function aplicar(
  item: Exclude<ImportOutcome, { kind: 'review' }>,
  ports: ImportPorts,
  opcoes: { semVinculo?: boolean } = {},
): Promise<'created' | 'already' | null> {
  if (item.kind === 'create') {
    return ports.createBooking({ eventId: item.eventId, dogId: item.dogId, kind: kindOf(item.parsed), parsed: item.parsed, semVinculo: opcoes.semVinculo });
  }
  if (item.kind === 'update') {
    await ports.updateBooking({
      bookingId: item.bookingId,
      kind: item.bookingKind,
      eventId: item.eventId,
      dogId: item.dogId,
      parsed: item.parsed,
      semVinculo: item.semVinculo,
    });
    return null;
  }
  if (item.kind === 'skip') {
    await ports.skipRecurringDay({ scheduleId: item.scheduleId, date: item.date, eventId: item.eventId });
    return null;
  }
  if (item.kind === 'extraDay') {
    // O dia entra na ESCALA (dia extra). Se o evento já tinha virado reserva solta (antes estava azul),
    // ela é cancelada — senão o mesmo serviço apareceria duas vezes no dia.
    if (item.looseBookingId) {
      await ports.cancelBooking({ bookingId: item.looseBookingId, kind: 'reservation', eventId: item.eventId });
    }
    await ports.addScheduleExtraDay({ scheduleId: item.scheduleId, date: item.date, eventId: item.eventId });
    return null;
  }
  await ports.cancelBooking({ bookingId: item.bookingId, kind: item.bookingKind, eventId: item.eventId });
  return null;
}

export function hasImportChanges(resumo: ImportSummary): boolean {
  return resumo.created + resumo.updated + resumo.cancelled + resumo.extraDays > 0 || resumo.review.length > 0;
}
