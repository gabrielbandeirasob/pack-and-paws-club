/**
 * IMPORTACAO Google Calendar -> app (o caminho de volta do espelho).
 *
 * Pedido do dono (23/09/2026): "ao sincronizar, as datas que estao marcadas no calendario do cliente
 * fossem para o aplicativo".
 *
 * REGRA NOVA (dono, 24/09/2026 — INVERTE o cadastro automatico dos builds 52-54):
 *  1. O titulo do evento traz SO o nome do cao ("Pietro"): sem palavra de servico, sem tutor.
 *  2. O app so importa o agendamento de um cao que JA existe no cadastro da organizacao (nome
 *     normalizado: caixa e acento nao contam — "Filó" == "filo"). NAO se cria cliente e NAO se cria
 *     cao: nome fora do cadastro NAO entra e aparece na lista "not registered in the app" do cartao,
 *     para o escritorio cadastrar e sincronizar de novo. Silencio total foi recusado pelo dono.
 *     Nome que casa com DOIS caes tambem vai para essa lista, com o motivo — nada de escolher no chute.
 *  3. O SERVICO vem da COR do evento (`colorId`), nunca do titulo: verde = boarding, azul = daycare,
 *     vermelho = CANCELAMENTO (cancela a reserva daquele cao naquele dia, se existir; numa serie,
 *     pula o dia). Sem cor ou com cor fora do mapa o app NAO chuta servico: vai para a lista
 *     "color not recognized" (ver `features/calendar/googleColors`).
 *  4. O vinculo com o Google e por EVENTO (`googleEventId`), nunca por nome: o segundo Sync nao cria
 *     de novo, e renomear o cao no app tambem nao faz o proximo Sync criar outro cadastro.
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
import { addDaysISO, weekdayOfISO } from '@/features/calendar/dates';
import { meaningOfColor, type BookingServiceType, type ColorMeaning } from '@/features/calendar/googleColors';
import type { RemoteEvent } from './calendarSync';

export type { BookingServiceType };

export type ParsedBooking = {
  /**
   * Servico lido da COR do evento. `null` = cor ausente ou fora da paleta mapeada: sem servico nao se
   * importa (o banco exige `service_type`), e a pendencia aparece como "color not recognized".
   */
  serviceType: BookingServiceType | null;
  /** Evento na cor de CANCELAMENTO (vermelho): cancela a reserva daquele cao naquele dia. */
  cancels: boolean;
  /** Nome do cao, lido do titulo (a regra nova: o titulo e so o nome). */
  dogName: string;
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

/** Compara nomes de cão/cliente sem acento e sem caixa ("Filó" == "filo"). */
export function normalizar(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Palavras de SERVICO e de OPERACAO que podem acompanhar o nome no titulo.
 *
 * Pela regra nova o titulo traz so o nome do cao, e quem diz o servico e a cor. Estas palavras NAO
 * definem mais serviço nenhum: elas sao descartadas para achar o NOME num evento escrito no formato
 * antigo ("Daycare · Bella (Leigh Ann)", "Pick filó", "Boarding - Luna"), que ainda existe no
 * calendario do escritorio. Sem isso, um evento desses viraria "cao chamado 'Daycare · Bella'".
 */
const PALAVRAS_DE_SERVICO_E_OPERACAO = /\b(boarding|hospedagem|pernoite|hotel|day\s*care|daycare|creche|di[áa]ria|pick\s*up|pickup|drop\s*off|dropoff|pick|drop|buscar|pegar|levar|van|walk)\b/gi;

/**
 * Mesma lista para PERGUNTAR ("isto é palavra de serviço?"). Sem a flag `/g`: em regex global o
 * `test` guarda `lastIndex` entre chamadas e passa a mentir (uma chamada sim, a seguinte nao).
 */
const EH_PALAVRA_DE_SERVICO = /\b(boarding|hospedagem|pernoite|hotel|day\s*care|daycare|creche|di[áa]ria|pick\s*up|pickup|drop\s*off|dropoff|pick|drop|buscar|pegar|levar|van|walk)\b/i;

/** Limpa separadores que sobram depois de tirar a palavra de servico. */
function limpar(valor: string): string {
  return valor.replace(/^[\s·\-–—:,;|]+/, '').replace(/[\s·\-–—:,;|]+$/, '').trim();
}

/** Separa os pedaços de um título de dois nomes, na convenção do app e na do escritório. */
const SEPARADOR_CONVENCAO_APP = /\s*[·|]\s*|\s+\/\s+/;
const SEPARADOR_TRACO = /\s+[–—-]\s+/;

function pedacos(valor: string, separador: RegExp): string[] {
  return valor
    .split(separador)
    .map((pedaco) => limpar(pedaco))
    .filter((pedaco) => pedaco.length > 0);
}

/**
 * Título com DOIS nomes.
 *
 * Na maioria das vezes o título traz um nome só e esse nome é o cão. Quando trazem dois:
 *   - ponto médio / barra: é a convenção do próprio app, que escreve os campos TERMINANDO no cão
 *     ("Daycare · Bella") → o CÃO é a última parte;
 *   - travessão com espaço em volta: o escritório escreve "Kona — Leigh Ann" → o CÃO é a primeira.
 * Pedaço que é palavra de serviço ou de operação nunca é o cão ("Pick · Bella" → Bella).
 */
function nomeEntreDois(valor: string): string | null {
  const grupos: { partes: string[]; caoPrimeiro: boolean }[] = [
    { partes: pedacos(valor, SEPARADOR_CONVENCAO_APP), caoPrimeiro: false },
    { partes: pedacos(valor, SEPARADOR_TRACO), caoPrimeiro: true },
  ];

  for (const grupo of grupos) {
    if (grupo.partes.length < 2) continue;
    const primeiro = grupo.partes[0];
    const ultimo = grupo.partes[grupo.partes.length - 1];
    if (EH_PALAVRA_DE_SERVICO.test(primeiro) && !EH_PALAVRA_DE_SERVICO.test(ultimo)) return ultimo;
    if (EH_PALAVRA_DE_SERVICO.test(ultimo) && !EH_PALAVRA_DE_SERVICO.test(primeiro)) return primeiro;
    if (EH_PALAVRA_DE_SERVICO.test(primeiro) && EH_PALAVRA_DE_SERVICO.test(ultimo)) return null;
    return grupo.caoPrimeiro ? primeiro : ultimo;
  }

  return null;
}

/**
 * Nome do cao lido do titulo do evento — a unica coisa que o titulo carrega na regra nova.
 *
 * Tolerante de propósito com o formato ANTIGO (palavra de serviço, "Pick", tutor entre parênteses),
 * porque esses eventos continuam no calendário do escritório: o que interessa é o NOME. Devolve
 * `null` quando não sobra nome nenhum (título vazio, só espaços ou só palavra de serviço).
 */
export function dogNameFromTitle(title: string): string | null {
  const semServico = limpar(title.replace(PALAVRAS_DE_SERVICO_E_OPERACAO, ' '));
  if (!semServico) return null;
  // "Bella (Leigh Ann)": o tutor entre parênteses não é o cão.
  const parenteses = semServico.match(/^(.*?)[\s]*\(([^)]+)\)\s*$/);
  const resto = limpar(parenteses ? parenteses[1] ?? '' : semServico);
  if (!resto) return null;
  return nomeEntreDois(resto) ?? resto;
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

/**
 * Evento do Google -> agendamento lido. Só um evento SEM NOME utilizável retorna null (aí o plano
 * monta a pendência "unreadable"). O serviço sai da COR; o nome sai do TÍTULO.
 */
export function parseBookingEvent(event: RemoteEvent): ParsedBooking | null {
  const dogName = dogNameFromTitle(event.summary);
  if (!dogName) return null;
  const cor = meaningOfColor(event.colorId);
  const recorrencia = parseRecurrence(event.recurrence, event.startDate, event.endDate);
  return {
    serviceType: cor?.kind === 'service' ? cor.serviceType : null,
    cancels: cor?.kind === 'cancel',
    dogName,
    startDate: event.startDate,
    ...recorrencia,
  };
}

/* ------------------------------- plano da importação ------------------------------- */

export type DogForImport = {
  id: string;
  name: string;
  /** Nome do tutor — só informativo (o casamento é pelo nome do cão, como o dono decidiu). */
  clientName?: string | null;
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
  /** Pausas (dias já pulados) de uma série — evita pular o mesmo dia duas vezes. */
  skipDates?: string[] | null;
  /** 'confirmed' (reserva) ou 'active' (série) — comparado como texto. */
  status: string;
};

export type ImportWindow = { from: string; to: string };

export type ReviewReason = 'unknown dog' | 'ambiguous dog' | 'unreadable' | 'duplicate' | 'unrecognized color';

export type ImportOutcome =
  | { kind: 'create'; eventId: string; dogId: string; parsed: ParsedBooking }
  | { kind: 'update'; eventId: string; bookingKind: ExistingBookingKind; bookingId: string; dogId: string; parsed: ParsedBooking }
  | { kind: 'cancel'; eventId: string; bookingKind: ExistingBookingKind; bookingId: string }
  /** Dia de uma série pulado (evento vermelho sobre uma escala: não se desativa a série inteira). */
  | { kind: 'skip'; eventId: string; scheduleId: string; date: string }
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

/** A data (ISO) cai dentro do período da reserva/série? (fim INCLUSIVO, como o app guarda) */
function cobreODia(item: BookingForImport, date: string): boolean {
  if (date < item.startDate) return false;
  if (item.kind === 'reservation') return date <= (item.endDate ?? item.startDate);
  if (!item.weekdays?.includes(weekdayOfISO(date))) return false;
  return !item.endDate || date <= item.endDate;
}

/**
 * O que o evento VERMELHO cancela: a reserva daquele cão NAQUELE dia, se existir.
 *
 * Ordem: o que já está ligado ao evento (o vínculo manda), depois uma reserva avulsa que cobre o dia
 * e, por último, uma série ativa que cai naquele dia. Quando o alvo é uma SÉRIE — ligada ou não — o
 * certo é PULAR o dia (uma exceção `skip`, a mesma que a tela do app usa): desativar a escala inteira
 * por causa de um dia marcado de vermelho destruiria o agendamento do cliente.
 * Nada encontrado = nada a fazer (o escritório marcou vermelho num dia sem agendamento).
 */
function alvoDoCancelamento(
  eventId: string,
  ligada: BookingForImport | null,
  dogId: string | null,
  date: string,
  reservations: BookingForImport[],
): ImportOutcome | null {
  if (ligada) {
    if (ligada.kind === 'recurring') {
      return (ligada.skipDates ?? []).includes(date) ? null : { kind: 'skip', eventId, scheduleId: ligada.id, date };
    }
    return { kind: 'cancel', eventId, bookingKind: ligada.kind, bookingId: ligada.id };
  }
  if (!dogId) return null;

  const avulsa = reservations.find(
    (item) => item.kind === 'reservation' && item.dogId === dogId && item.status === 'confirmed' && cobreODia(item, date),
  );
  if (avulsa) return { kind: 'cancel', eventId, bookingKind: 'reservation', bookingId: avulsa.id };

  const serie = reservations.find(
    (item) =>
      item.kind === 'recurring' &&
      item.dogId === dogId &&
      item.status === 'active' &&
      cobreODia(item, date) &&
      !(item.skipDates ?? []).includes(date),
  );
  if (serie) return { kind: 'skip', eventId, scheduleId: serie.id, date };

  return null;
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
      const cor = meaningOfColor(evento.colorId);
      const recorrencia = parseRecurrence(evento.recurrence, evento.startDate, evento.endDate);
      resultados.push({
        kind: 'review',
        eventId: evento.id,
        title: evento.summary,
        date: evento.startDate,
        parsed: {
          serviceType: cor?.kind === 'service' ? cor.serviceType : null,
          cancels: cor?.kind === 'cancel',
          dogName: '(no title)',
          startDate: evento.startDate,
          ...recorrencia,
        },
        reason: 'unreadable',
      });
      continue;
    }

    if (antesDaJanela(parsed.startDate, window)) continue;

    // 3. O serviço vem da COR. Sem cor (ou cor fora do mapa) NÃO se chuta serviço: o evento entra na
    //    lista "color not recognized" e o escritório pinta e sincroniza de novo.
    const cor: ColorMeaning | null = meaningOfColor(evento.colorId);
    if (!cor) {
      resultados.push({ kind: 'review', eventId: evento.id, title: evento.summary, date: evento.startDate, parsed, reason: 'unrecognized color' });
      continue;
    }

    // 4. Casa o cao pelo NOME do titulo (normalizado). Nome repetido em dois cadastros nao e
    //    desempatado por tutor: a regra nova nao traz tutor no titulo, entao isso e pendencia.
    const alvo = normalizar(parsed.dogName);
    const candidatos = dogs.filter((cao) => normalizar(cao.name) === alvo);
    const dogDoTitulo = candidatos.length === 1 ? candidatos[0].id : null;

    // 5. Vínculo por EVENTO (não por nome): se o evento já tem reserva no app, ela é a referência.
    //    Título que não aponta para nenhum cão do cadastro (o caso do cão RENOMEADO no app depois da
    //    importação) NÃO cria cadastro novo: a reserva segue com o cão dela, que é o mesmo evento.
    const ligada = porEvento.get(evento.id) ?? null;

    // 6. Evento VERMELHO = cancelamento do dia daquele cão.
    if (cor.kind === 'cancel') {
      vistos.add(evento.id);
      const alvo2 = alvoDoCancelamento(evento.id, ligada, dogDoTitulo, evento.startDate, reservations);
      if (alvo2) {
        resultados.push(alvo2);
      } else if (!dogDoTitulo) {
        // Não há o que cancelar E o cão não está no cadastro: o escritório precisa saber disso.
        resultados.push({
          kind: 'review',
          eventId: evento.id,
          title: evento.summary,
          date: evento.startDate,
          parsed,
          reason: candidatos.length > 1 ? 'ambiguous dog' : 'unknown dog',
        });
      }
      continue;
    }

    if (ligada) {
      vistos.add(evento.id);
      const dogId = dogDoTitulo ?? ligada.dogId;
      const servico: ParsedBooking = { ...parsed, serviceType: cor.serviceType };
      if (ligada.source === 'google' && precisaAtualizar(ligada, servico, dogId)) {
        resultados.push({ kind: 'update', eventId: evento.id, bookingKind: ligada.kind, bookingId: ligada.id, dogId, parsed: servico });
      }
      continue;
    }

    // 7. Cão que não está no cadastro (nenhum ou mais de um) NÃO é importado — e não se cadastra
    //    ninguém: o evento aparece na lista "not registered in the app" para o escritório cadastrar.
    if (candidatos.length === 0) {
      resultados.push({ kind: 'review', eventId: evento.id, title: evento.summary, date: evento.startDate, parsed, reason: 'unknown dog' });
      continue;
    }
    if (candidatos.length > 1) {
      resultados.push({ kind: 'review', eventId: evento.id, title: evento.summary, date: evento.startDate, parsed, reason: 'ambiguous dog' });
      continue;
    }

    const dogId = candidatos[0].id;
    const servico: ParsedBooking = { ...parsed, serviceType: cor.serviceType };
    vistos.add(evento.id);

    // 8. Igual a uma reserva que o app ja tem = duplicata: o gestor decide (liga o evento a ela).
    const tipo = kindOf(servico);
    const gemea = reservations.find(
      (reserva) =>
        reserva.kind === tipo &&
        reserva.dogId === dogId &&
        reserva.serviceType === servico.serviceType &&
        reserva.startDate === servico.startDate &&
        (tipo === 'recurring' ? mesmosDias(reserva.weekdays, servico.weekdays) : reserva.endDate === servico.endDate) &&
        reserva.status === 'confirmed',
    );
    if (gemea) {
      resultados.push({ kind: 'review', eventId: evento.id, title: evento.summary, date: evento.startDate, parsed: servico, reason: 'duplicate' });
      continue;
    }

    resultados.push({ kind: 'create', eventId: evento.id, dogId, parsed: servico });
  }

  // 9. Reserva vinda do Google cujo evento sumiu: cancelar — so dentro da janela consultada.
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
