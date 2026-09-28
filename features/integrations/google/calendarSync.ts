/**
 * Planejamento do espelhamento (uma via) das reservas do Pack & Paws para o Google Calendar.
 *
 * Modulo puro: recebe as reservas locais e os eventos que ja existem no Google e devolve a
 * lista MINIMA de operacoes (criar / atualizar / apagar). Nada de rede aqui — o executor em
 * `calendarClient` faz as chamadas, e este modulo e coberto por testes.
 *
 * Idempotencia: cada evento carrega `extendedProperties.private.appKey = <id da reserva>`,
 * entao reexecutar o sync nao duplica eventos.
 */
import { buildGoogleEvent, type GoogleEventInput, type ReservationForSync } from '@/features/calendar/googleEvents';
import { COLOR_OF_CANCELAMENTO } from '@/features/calendar/googleColors';
import type { EventLabel } from '@/features/calendar/googleColors';

export const APP_KEY_PROPERTY = 'appKey';

/**
 * Marca fixa que TODO evento do espelho carrega, além do appKey.
 *
 * Por que existe: `events.list` só filtra propriedade no formato `nome=valor` — mandar a chave
 * sozinha devolve HTTP 400 "A key or value missing in the extended_properties_match" (erro
 * aconteceu de verdade em 16/09/2026, no primeiro sync do gestor). Como o appKey muda a cada
 * reserva, ele não serve para filtrar a listagem: é esta marca constante que separa os nossos
 * eventos dos eventos do dono do calendário.
 */
export const MIRROR_MARKER_PROPERTY = 'packpawsMirror';
export const MIRROR_MARKER_VALUE = 'v1';

export type LocalReservation = ReservationForSync & {
  id: string;
  /**
   * Evento do Google que originou esta reserva (reserva importada do Google ou ligada à mão pelo
   * gestor). Presente = NÃO criar evento novo; o espelho atualiza ESTE (e adota com a marca do app).
   */
  googleEventId?: string | null;
  /** 'google' = nasceu no Google Calendar (lá manda); 'app' = nasceu no aplicativo. */
  source?: 'app' | 'google' | null;
  /**
   * Reserva CANCELADA **pelo app**: o espelho NÃO apaga o evento — pinta de vermelho (Tomato). Dono,
   * 28/09/2026: *"se a gente cancelar pelo app, eu não quero que você apague o evento do calendário"*.
   * Quem monta a lista precisa incluir as canceladas com esta marca (senão o evento cai no caminho de
   * exclusão de órfão).
   */
  cancelled?: boolean;
};

export type RemoteEvent = {
  id: string;
  /** Valor de extendedProperties.private.appKey, quando existir. */
  appKey?: string | null;
  summary: string;
  startDate: string;
  /**
   * Fim do evento em forma EXCLUSIVA (o primeiro dia FORA do evento), igual ao que o Google usa no
   * evento de dia inteiro — quem monta isto (`parseEvent`, em `calendarApi`) já normaliza o evento com
   * hora para esse formato. É o formato que o espelho compara com o que ele mesmo escreve
   * (`eventsEqual`) e o que a importação recua um dia para virar o fim INCLUSIVO da reserva.
   */
  endDate: string;
  /**
   * `colorId` do evento na paleta fixa do Google (1..11) — é ele que diz o SERVIÇO na importação
   * (verde boarding, azul daycare, vermelho cancelamento: `features/calendar/googleColors`). `null`
   * quando o evento não tem cor marcada.
   */
  colorId?: string | null;
  /**
   * Etiqueta de cor do evento (`eventLabelId`, paleta NOVA do Google). Um evento pintado com a paleta
   * nova NÃO traz `colorId` — a cor (e portanto o serviço) sai do TOM do hex da etiqueta.
   */
  eventLabelId?: string | null;
  recurrence?: string[] | null;
};

export type SyncAction =
  | { type: 'create'; reservationId: string; event: GoogleEventInput }
  | { type: 'update'; reservationId: string; eventId: string; event: GoogleEventInput }
  | { type: 'delete'; eventId: string };

export function appKeyOf(reservation: LocalReservation): string {
  return reservation.id;
}

/**
 * Evento do app para uma reserva CANCELADA pelo app (dono, 28/09/2026): *"eu não quero que você apague o
 * evento do calendário. Eu quero que você mude a cor para vermelho (tomato)"*. Fica o mesmo nome e as
 * mesmas datas; muda a cor (e limpa a etiqueta, que senão venceria o `colorId` na API).
 */
function eventoCancelado(reservation: LocalReservation): GoogleEventInput {
  return {
    ...buildGoogleEvent(reservation),
    colorId: COLOR_OF_CANCELAMENTO,
    eventLabelId: null,
  };
}

/** Evento do Google pronto para envio, com a chave de idempotencia embutida. */
export function eventFor(reservation: LocalReservation, options: { labels?: EventLabel[] } = {}): GoogleEventInput {
  return {
    ...(reservation.cancelled ? eventoCancelado(reservation) : buildGoogleEvent(reservation, options)),
    extendedProperties: {
      private: {
        [APP_KEY_PROPERTY]: appKeyOf(reservation),
        [MIRROR_MARKER_PROPERTY]: MIRROR_MARKER_VALUE,
      },
    },
  };
}

function sameRecurrence(a?: string[] | null, b?: string[] | null): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((rule, index) => rule === right[index]);
}

/** Compara o que esta no Google com o que o app quer publicar. */
export function eventsEqual(desired: GoogleEventInput, remote: RemoteEvent): boolean {
  // Etiqueta SUPERA colorId na API. Com uma etiqueta desejada, o Google pode devolver colorId nulo:
  // comparar também o legado causaria PATCH infinito. Sem etiqueta lida pelo app, preservamos uma
  // etiqueta remota em vez de substituí-la por colorId; se nenhum lado usa etiqueta, vale o legado.
  // `eventLabelId: null` = o app quer LIMPAR a etiqueta e mandar só o `colorId` (é o caso do
  // cancelamento: pinta de Tomato). Aqui a comparação tem de olhar os DOIS, senão o PATCH nunca sai e a
  // cor nova não chega ao calendário — foi o que o vetor do cancelamento pegou (28/09/2026).
  const corOk = desired.eventLabelId === null
    ? (remote.eventLabelId ?? null) === null && (desired.colorId ?? null) === (remote.colorId ?? null)
    : desired.eventLabelId !== undefined
      ? (desired.eventLabelId ?? null) === (remote.eventLabelId ?? null)
      : remote.eventLabelId
        ? true
        : (desired.colorId ?? null) === (remote.colorId ?? null);
  return (
    desired.summary === remote.summary &&
    desired.start.date === remote.startDate &&
    desired.end.date === remote.endDate &&
    corOk &&
    sameRecurrence(desired.recurrence, remote.recurrence)
  );
}

/**
 * Operacoes necessarias. Deterministico: reservas fora de ordem produzem o mesmo plano.
 * Eventos remotos sem `appKey` sao ignorados (podem ser do dono do calendario, nao nossos).
 *
 * `options.labels` são as etiquetas do calendário escolhido: quando há uma com o tom do serviço, o
 * evento sai com ela (`eventLabelId`); senão sai só com o `colorId` legado.
 */
export function planCalendarSync(local: LocalReservation[], remote: RemoteEvent[], options: { labels?: EventLabel[] } = {}): SyncAction[] {
  const byKey = new Map<string, RemoteEvent>();
  const byId = new Map<string, RemoteEvent>();
  for (const event of remote) {
    byId.set(event.id, event);
    if (event.appKey) byKey.set(event.appKey, event);
  }

  const actions: SyncAction[] = [];
  const seen = new Set<string>();

  for (const reservation of [...local].sort((a, b) => a.id.localeCompare(b.id))) {
    const key = appKeyOf(reservation);
    seen.add(key);
    const desired = eventFor(reservation, options);
    // Reserva ligada a um evento do Google: o espelho cuida DESSE evento (nada de criar um segundo).
    const existing = byKey.get(key) ?? (reservation.googleEventId ? byId.get(reservation.googleEventId) ?? null : null);
    if (!existing) {
      if (reservation.googleEventId && reservation.source === 'google') {
        // Evento do Google apagado (o cliente desmarcou): quem cancela a reserva é a importação.
        continue;
      }
      // Reserva cancelada que nunca foi espelhada: não se cria evento — não há nada para cancelar.
      if (reservation.cancelled) continue;
      actions.push({ type: 'create', reservationId: reservation.id, event: desired });
    } else if (!eventsEqual(desired, existing)) {
      actions.push({ type: 'update', reservationId: reservation.id, eventId: existing.id, event: desired });
    }
  }

  for (const event of remote) {
    if (event.appKey && !seen.has(event.appKey)) {
      actions.push({ type: 'delete', eventId: event.id });
    }
  }

  return actions;
}
