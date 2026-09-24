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
 *  3. Nome do cao tem de casar com UM cao do cadastro. Zero ou dois = vai para REVISAO (o app nao
 *     cria cadastro fantasma por causa de um titulo mal escrito).
 *  4. Reserva que nasceu no Google: se o evento mudar, a reserva muda; se o evento sumir, a reserva
 *     e CANCELADA — mas so se a reserva for da janela consultada (evento fora da janela nao conta
 *     como "apagado").
 *  5. Evento igual a uma reserva que ja existe no app nao duplica: vai para revisao para o gestor
 *     ligar o evento a reserva existente.
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

function normalizar(valor: string): string {
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
  return { dogName, clientName };
}

/** Limpa separadores que sobram depois de tirar a palavra de servico. */
function limpar(valor: string): string {
  return valor.replace(/^[\s·\-–—:,;|]+/, '').replace(/[\s·\-–—:,;|]+$/, '').trim();
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
  return { serviceType, dogName, clientName };
}

/**
 * Fallback do calendário dedicado: sem palavra-chave, o título é o nome do cão.
 * Mantém o tutor opcional entre parênteses para desempatar cães com nomes iguais.
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
  return { dogName: resto, clientName };
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
    // Evento de um dia só: o Google manda o fim exclusivo (dia seguinte).
    return { weekdays: [], endDate: addDaysISO(endDateExclusive, -1), skipDates, openEnded: false };
  }

  const byday = /BYDAY=([^;]+)/.exec(rrule)?.[1];
  const weekdays = (byday ?? '')
    .split(',')
    .map((dia) => BYDAY.indexOf(dia.trim().slice(0, 2).toUpperCase()))
    .filter((indice) => indice >= 0)
    .sort((a, b) => a - b);

  const until = /UNTIL=(\d{8})/.exec(rrule)?.[1];
  const openEnded = !until;
  const endDate = until ? `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}` : startDate;

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

export type DogForImport = { id: string; name: string; clientName?: string | null };

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

export type ImportOutcome =
  | { kind: 'create'; eventId: string; dogId: string; parsed: ParsedBooking }
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
 * O que fazer com o que está no Google. Determinístico e sem rede.
 *
 * `events` já vem recortado pela janela da consulta (timeMin/timeMax).
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
    if (!parsed) {
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

    const ligada = porEvento.get(evento.id) ?? null;

    // 3. Casa o cao pelo nome (e pelo tutor quando o titulo traz).
    const alvo = normalizar(parsed.dogName);
    let candidatos = dogs.filter((cao) => normalizar(cao.name) === alvo);
    if (candidatos.length > 1 && parsed.clientName) {
      const tutor = normalizar(parsed.clientName);
      const filtrados = candidatos.filter((cao) => (cao.clientName ? normalizar(cao.clientName) === tutor : false));
      if (filtrados.length > 0) candidatos = filtrados;
    }

    if (candidatos.length === 0) {
      resultados.push({ kind: 'review', eventId: evento.id, title: evento.summary, date: evento.startDate, parsed, reason: 'unknown dog' });
      continue;
    }
    if (candidatos.length > 1) {
      resultados.push({ kind: 'review', eventId: evento.id, title: evento.summary, date: evento.startDate, parsed, reason: 'ambiguous dog' });
      continue;
    }

    const dogId = candidatos[0].id;
    vistos.add(evento.id);

    if (ligada && ligada.source === 'google') {
      if (precisaAtualizar(ligada, parsed, dogId)) {
        resultados.push({ kind: 'update', eventId: evento.id, bookingKind: ligada.kind, bookingId: ligada.id, dogId, parsed });
      }
      continue;
    }

    if (ligada) {
      vistos.add(evento.id);
      continue;
    }

    // 4. Igual a uma reserva que o app ja tem = duplicata: o gestor decide (liga o evento a ela).
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

  // 5. Reserva vinda do Google cujo evento sumiu: cancelar — so dentro da janela consultada.
  for (const reserva of reservations) {
    if (reserva.source !== 'google' || !reserva.googleEventId) continue;
    if (reserva.status !== 'confirmed') continue;
    if (vistos.has(reserva.googleEventId)) continue;
    const dentroDaJanela = reserva.startDate >= window.from && reserva.startDate <= window.to;
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
