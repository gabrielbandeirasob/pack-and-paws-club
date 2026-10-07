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
 *  3. O SERVICO vem da COR do evento, nunca do titulo: verde = boarding, azul = daycare,
 *     vermelho = CANCELAMENTO (cancela a reserva daquele cao naquele dia, se existir; numa serie,
 *     pula o dia). Sao DOIS esquemas de cor: a etiqueta do calendario (paleta nova, classificada pelo
 *     TOM do hex — o "Cobalto" #4A86E8 do cliente) manda, e o `colorId` legado (1..11) e o fallback
 *     (ver `features/calendar/googleColors`). **Sem cor NENHUMA = day care** (palavra do dono,
 *     28/09/2026: "as cores de Daycare e a cor chamada default do Google calendario ou Peacock");
 *     cor pintada que o app nao conhece (cinza, rosa, laranja) continua indo para
 *     "color not recognized" — ai o escritorio pintou de proposito. **Cocoa (marrom) = fora do horario
 *     de funcionamento**: o cao conta no dia (lista de day care) mas NAO pede van (o administrador
 *     busca/entrega).
 *  4. O vinculo com o Google e por EVENTO (`googleEventId`), nunca por nome: o segundo Sync nao cria
 *     de novo, e renomear o cao no app tambem nao faz o proximo Sync criar outro cadastro.
 *  5. Reserva que nasceu no Google: se o evento mudar, a reserva muda; se o evento sumir, a reserva
 *     e CANCELADA — mas so dentro da janela consultada (evento fora da janela nao conta como
 *     "apagado") e quando a origem do vínculo é o MESMO calendário consultado.
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
import { movimentaOCao, readEventColor, serviceTypeOfMeaning, type BookingServiceType, type ColorMeaning, type EventColorRead, type EventLabel } from '@/features/calendar/googleColors';
import type { RemoteEvent } from './eventMarkers';
import { DEFAULT_CALENDAR_ID } from './calendarChoice';

export type { BookingServiceType };

export type ParsedBooking = {
  /**
   * Servico lido da COR do evento. `null` = cor ausente ou fora do mapa mapeado: sem servico nao se
   * importa (o banco exige `service_type`), e a pendencia aparece como "color not recognized".
   */
  serviceType: BookingServiceType | null;
  /** O que foi LIDO da cor — etiqueta (nome + hex) e/ou `colorId` legado. É o que a tela mostra. */
  color: EventColorRead;
  /** Evento na cor de CANCELAMENTO (vermelho): cancela a reserva daquele cao naquele dia. */
  cancels: boolean;
  /** Nome do cao, lido do titulo (a regra nova: o titulo e so o nome). */
  dogName: string;
  /** Inicio (data do evento). */
  startDate: string;
  /** Fim INCLUSIVO (o evento do Google usa fim exclusivo). */
  endDate: string;
  /**
   * O cão passa pelo DAYCARE neste dia (entra no Total Pack e na van). Contrato do cliente, escrito em
   * 28/09/2026: *"por via de regra todo boarding vai pro daycare (ou seja eles no início do dia já
   * estarão dentro da van esperando o driver)"* — a ÚNICA exceção é a **CHEGADA fora do horário**
   * (Cocoa no pick-up): *"ele entra no total de cães mas não entra no total pack porque o cão não
   * estará no day care"*.
   */
  goesToDaycare: boolean;
  /** 0 = domingo … 6 = sabado. Vazio = evento de um dia so. */
  weekdays: number[];
  /** Datas (ISO) de pausa (viram EXDATE no evento). */
  skipDates: string[];
  /** Serie sem data de fim (RRULE sem UNTIL). */
  openEnded: boolean;
  /**
   * O cao ANDA nesse dia (entra na van)? Day care: `true` sempre. HOSPEDAGEM: **true** no dia de
   * CHEGADA/SAIDA (amarelo/verde-claro — o "avocado" do escritorio) e **false** no dia do meio, com o
   * cao no hotel (verde). Quem confirma o `false` e o PLANO: so vale quando aquele cao tem chegada/saida
   * marcada na janela (calendario que ainda nao usa a convencao continua entrando na van).
   */
  transportRequired?: boolean;
  /**
   * O dia da HOSPEDAGEM é o dia de CHEGADA/SAÍDA (o "avocado" do escritório — verde-claro/amarelo)?
   *
   * É o dia em que o cão ANDA: na chegada ele está na casa e quem busca é o motorista; na saída ele vai
   * para casa. O `transport_required` dos dois dias de hospedagem era igual (no dia de hotel o app
   * restaura a van quando o calendário não marca chegada/saída), então o Dispatch não conseguia separar
   * "o cão já está lá dentro" de "o cão precisa ser buscado" — e a chegada ficava fora da fila de pickup
   * (print do cliente de 06/10/2026, Scarlet). Decisão do dono (06/10/2026): guardar a marca na reserva
   * (`movement_day`) e o dia de movimento entra como parada normal da rota, sem entrega.
   */
  movementDay?: boolean;
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
/**
 * Palavras de MARCADOR/OPERAÇÃO do calendário do escritório: títulos que NÃO são cão nenhum.
 *
 * Medido no calendário do cliente (26/09/2026): `Rotas`, `ROTAS FIXAS`, `Mentoria + Consulta` e o typo
 * `BOADING` (de "boarding") apareciam no cartão do Google Calendar como "cão não cadastrado", poluindo
 * a lista de pendências do gestor. Não é dado faltando: é evento que não representa cão.
 * `BOARDING 🐶` cai pela outra porta — depois de tirar a palavra de serviço não sobra LETRA.
 *
 * 06/10/2026: o print do cliente (dias 7-9/10) trouxe **`Inspeção building`** — barra vermelha de um
 * compromisso do escritório, que caía em "não cadastrado" como se fosse um cão. Pedido do dono no mesmo
 * dia: *"somar 'inspeção/inspection' à lista de marcadores (some sem virar pendência), com teste"*.
 * Daí `inspe[çc][ãa]o|inspection|vistoria` (o `\b` funciona com a cedilha porque a palavra começa com
 * letra ASCII).
 */
const PALAVRAS_DE_OPERACAO = /\b(rotas?|rotas?\s+fixas?|mentoria|consulta|boading|bording|baording|inspe[çc][ãa]o|inspection|vistoria)\b/i;

/** Nome só é nome de cão se tiver LETRA: resto de "BOARDING 🐶" é emoji e não vira cão. */
const TEM_LETRA = /[a-zA-ZÀ-ÿ]/;

/**
 * SIMBOLO que o escritório escreve JUNTO do nome, colado nas pontas — e que **não é nome de cão**.
 *
 * Pedido do dono (06/10/2026), na simulação do print do cliente: *"o emoji tem um significado para o
 * cliente"*. O significado (ex.: `🏠` = o cão NÃO vai ser entregue na casa) já é lido da COR e das
 * reservas do dia — o que o emoji **não** pode fazer é virar parte do NOME: com ele, `"Scarlet 🏠"` não
 * casava com o cadastro da `Scarlet` e o dia da chegada/saída dela caía em "não cadastrado" (medido no
 * fixture do print de 06/10/2026). Aqui só as PONTAS são limpas: o miolo continua intacto para não
 * destruir separador de nome ("Kona — Leigh Ann" é tratado antes, por `nomeEntreDois`).
 */
const SIMBOLO_DE_FORA = /^[^0-9A-Za-zÀ-ÿ]+|[^0-9A-Za-zÀ-ÿ]+$/g;

/**
 * Evento de marcador/operação do escritório — não é cão e **não é pendência** para o gestor.
 *
 * Duas portas, as duas MEDIDAS no calendário do cliente (26/09/2026):
 *  1. o título traz palavra de operação (`ROTAS FIXAS`, `Mentoria + Consulta`, `BOADING`);
 *  2. o título é palavra de SERVIÇO e não sobra letra nenhuma (`BOARDING 🐶`, o marcador do dia).
 * Título vazio NÃO entra aqui: continua indo para revisão, como decidido pelo dono ("o calendário é
 * exclusivo do negócio" — evento ilegível precisa aparecer). Cuidado com regex com `/g`: só `replace`.
 */
export function ehEventoDeOperacao(title: string): boolean {
  const texto = limpar(title);
  if (texto.length === 0) return false;
  if (PALAVRAS_DE_OPERACAO.test(texto)) return true;
  if (!EH_PALAVRA_DE_SERVICO.test(texto)) return false;
  const semServico = limpar(texto.replace(PALAVRAS_DE_SERVICO_E_OPERACAO, ' '));
  return !TEM_LETRA.test(semServico);
}

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
 * NOMES dos cães lidos do título — regra do dono (26/09/2026) para casa com DOIS cães.
 *
 * O escritório escreve **"Cão A/Cão B"** (barra, colada ou com espaços) quando os DOIS vão no mesmo
 * dia; quando só um deles vai, escreve **um nome só**. A barra separa CÃES — o `·` continua sendo
 * separador de CAMPO da convenção do app ("Daycare · Bella (Leigh Ann)" é UM cão). O tutor entre
 * parênteses e as palavras de serviço/operação continuam sendo descartados, como na regra antiga.
 *
 * Devolve [] quando não sobra nome nenhum (título vazio ou só palavra de serviço).
 */
export function dogNamesFromTitle(title: string): string[] {
  const semServico = limpar(title.replace(PALAVRAS_DE_SERVICO_E_OPERACAO, ' '));
  if (!semServico) return [];
  const nomes: string[] = [];
  for (const pedaco of semServico.split('/')) {
    const parte = limpar(pedaco);
    if (!parte) continue;
    // "Bella (Leigh Ann)" / "Milo (Daycare)": o parêntese não é o cão.
    const parenteses = parte.match(/^(.*?)[\s]*\(([^)]+)\)\s*$/);
    const resto = limpar(parenteses ? parenteses[1] ?? '' : parte);
    if (!resto) continue;
    const nome = limpar((nomeEntreDois(resto) ?? resto).replace(SIMBOLO_DE_FORA, ''));
    // "BOARDING 🐶" sobra emoji: emoji não é nome de cão. O emoji pode vir COLADO no nome ("Scarlet 🏠",
    // print de 06/10/2026): a ponta é limpa acima e o que sobra é o nome do cadastro.
    if (!TEM_LETRA.test(nome)) continue;
    if (!nomes.some((ja) => normalizar(ja) === normalizar(nome))) nomes.push(nome);
  }
  return nomes;
}

/**
 * Nome do cao lido do titulo do evento — a unica coisa que o titulo carrega na regra nova.
 *
 * Tolerante de propósito com o formato ANTIGO (palavra de serviço, "Pick", tutor entre parênteses),
 * porque esses eventos continuam no calendário do escritório: o que interessa é o NOME. Devolve
 * `null` quando não sobra nome nenhum (título vazio, só espaços ou só palavra de serviço).
 * Título com DOIS cães devolve o primeiro — quem precisa de todos usa `dogNamesFromTitle`.
 */
export function dogNameFromTitle(title: string): string | null {
  return dogNamesFromTitle(title)[0] ?? null;
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
 * Evento do Google -> agendamento lido. Só um evento SEM NOME utilizável retorna [] (aí o plano
 * monta a pendência "unreadable"). O serviço sai da COR — etiqueta da paleta nova (tom do hex) ou,
 * na falta dela, o `colorId` legado —; o nome sai do TÍTULO.
 *
 * `labels` são as etiquetas do calendário escolhido: sem elas um evento pintado na paleta nova não
 * tem como dizer serviço (ele chega sem `colorId`) e vira pendência "cor não reconhecida".
 *
 * O evento pode trazer MAIS DE UM cão ("Cão A/Cão B" — casa com dois cães, pedido do dono em
 * 26/09/2026): devolve um `ParsedBooking` por cão, todos com a MESMA cor/recorrência. O agrupamento
 * em UMA parada não é feito aqui — o banco já agrupa paradas do mesmo cliente na mesma rota
 * (`route_stops.stop_group_id`), então dois cães da mesma casa caem na mesma parada sozinhos.
 */
export function parseBookingEvents(event: RemoteEvent, labels: EventLabel[] = []): ParsedBooking[] {
  const nomes = dogNamesFromTitle(event.summary);
  if (nomes.length === 0) return [];
  const color = readEventColor(event, labels);
  const recorrencia = parseRecurrence(event.recurrence, event.startDate, event.endDate);
  // Chegada/saida de hospedagem manda na van; day care sempre pede (`movimentaOCao` devolve null fora
  // de hospedagem, e aí vale `true`).
  const movimenta = movimentaOCao(color);
  const transportRequired = movimenta ?? true;

  return nomes.map((dogName) => ({
    serviceType: serviceTypeOfMeaning(color.meaning),
    // Padrão do dia: o cão passa pelo daycare. Quem tira é o plano, e só na CHEGADA fora do horário
    // (Cocoa no pick-up), que depende do contexto da hospedagem — ver `leituraDoDia`.
    goesToDaycare: true,
    color,
    cancels: color.meaning?.kind === 'cancel',
    transportRequired,
    // Dia de chegada/saída da hospedagem (avocado/amarelo): o cão está na casa — é parada de rota.
    movementDay: movimenta === true,
    dogName,
    startDate: event.startDate,
    ...recorrencia,
  }));
}

/** Primeiro cão do evento (o caso de um nome só, que é quase sempre). */
export function parseBookingEvent(event: RemoteEvent, labels: EventLabel[] = []): ParsedBooking | null {
  return parseBookingEvents(event, labels)[0] ?? null;
}

/* ------------------------------- plano da importação ------------------------------- */

export type DogForImport = {
  id: string;
  name: string;
  /** Nome do tutor — só informativo (o casamento é pelo nome do cão, como o dono decidiu). */
  clientName?: string | null;
  /** Identidade do tutor para recuperar o vínculo legado; nome igual não prova mesma casa. */
  clientId?: string | null;
};

/** O que já existe no app e pode estar ligado a um evento do Google. */
export type ExistingBookingKind = 'reservation' | 'recurring';

export type BookingForImport = {
  id: string;
  /** O cão passa pelo daycare nesse dia (Total Pack/van). `false` só na chegada fora do horário. */
  goesToDaycare?: boolean;
  /** Aquele dia da hospedagem é o de CHEGADA/SAÍDA (avocado) — o cão está na casa, é parada de rota. */
  movementDay?: boolean | null;
  /**
   * 'reservation' = data avulsa (`reservations`); 'recurring' = série de dias da semana
   * (`recurring_schedules`). O Google não distingue os dois: quem distingue é o RRULE do evento e
   * o tipo da linha que já está ligada a ele.
   */
  kind: ExistingBookingKind;
  dogId: string;
  googleEventId: string | null;
  /** Agenda de origem do vínculo; legado sem origem não prova que um evento foi apagado. */
  googleCalendarId?: string | null;
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

export type ReviewReason =
  | 'unknown dog'
  | 'ambiguous dog'
  | 'unreadable'
  | 'duplicate'
  | 'unrecognized color'
  /** Evento ROXO (alteração de dia) num cão que NÃO tem escala fixa ativa — não há onde encaixar. */
  | 'purple without schedule';

export type ImportOutcome =
  | { kind: 'create'; eventId: string; dogId: string; parsed: ParsedBooking }
  /** `calendarId` só é preenchido no reparo legado com origem conhecida. */
  | { kind: 'update'; eventId: string; bookingKind: ExistingBookingKind; bookingId: string; dogId: string; parsed: ParsedBooking; semVinculo?: boolean; calendarId?: string }
  | { kind: 'cancel'; eventId: string; bookingKind: ExistingBookingKind; bookingId: string }
  /** Dia de uma série pulado (evento vermelho sobre uma escala: não se desativa a série inteira). */
  | { kind: 'skip'; eventId: string; scheduleId: string; date: string }
  /**
   * Evento ROXO = alteração de cliente de dia fixo: o dia entra na ESCALA daquele cão como dia extra
   * (`recurring_exceptions.action = 'extra'`), e não como reserva avulsa. `looseBookingId` traz uma
   * reserva solta que já existia para esse evento (evento que tinha sido pintado de azul) — ela é
   * cancelada junto, para o serviço não ficar em dobro.
   */
  | { kind: 'extraDay'; eventId: string; dogId: string; scheduleId: string; date: string; looseBookingId: string | null }
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

/**
 * Identidade de uma reserva **dentro de uma mesma rodada** de importação: cão + serviço + dia (na série,
 * os dias da semana). É o que define "a mesma coisa" para não criar duas reservas iguais de uma vez só.
 */
function chaveDaMesmaReserva(kind: ExistingBookingKind, dogId: string, servico: ParsedBooking): string {
  const quando =
    kind === 'recurring'
      ? `dias:${[...servico.weekdays].sort((a, b) => a - b).join(',')}`
      : `${servico.startDate}..${servico.endDate}`;
  return `${kind}|${dogId}|${servico.serviceType}|${quando}`;
}

/** Compara só o que a importação controla (e ignora pausas, que na série moram em outra tabela). */
function precisaAtualizar(reserva: BookingForImport, parsed: ParsedBooking, dogId: string): boolean {
  const serie = reserva.kind === 'recurring';
  return (
    reserva.dogId !== dogId ||
    reserva.serviceType !== parsed.serviceType ||
    // A porta preserva goes_to_daycare nas reservas existentes: comparar aqui
    // pediria a mesma atualização em todo Sync, sem jamais mudar esse campo.
    (serie && (reserva.goesToDaycare ?? true) !== parsed.goesToDaycare) ||
    // O dia de MOVIMENTO é o que o evento diz (avocado = chegada/saída): quando o escritório repinta o
    // dia, a reserva tem de acompanhar — é ele que decide se o cão entra na fila de pickup.
    (reserva.movementDay ?? false) !== (parsed.movementDay ?? false) ||
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
    return ligada.status === 'cancelled' ? null : { kind: 'cancel', eventId, bookingKind: ligada.kind, bookingId: ligada.id };
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
 * EM QUE DIAS o cão está DENTRO de uma hospedagem (os dias de verde/Basil do calendário do escritório).
 *
 * É o que decide o lado do dia quando o evento está pintado de **Cocoa (marrom)** — a cor de "fora do
 * horário de funcionamento". Regra do dono (áudio de 28/09/2026): *"se for o drop-off e for cor cocoa
 * você pode botar ele na lista do daycare do dia"* e *"no dia da saída, se for cocoa, ainda assim o
 * cachorro vai para o daycare, mesmo que ele seja entregue depois do horário de funcionamento"* — já a
 * CHEGADA é outra coisa: *"na chegada não tem como ele ter chegado antes do daycare"*, o cão veio para
 * FICAR, então o dia da chegada é **boarding**.
 *
 * O "lado" se lê sem o escritório escrever nada extra: **se a hospedagem cobre o dia SEGUINTE ao
 * Cocoa, aquele Cocoa é uma chegada** (a estadia veio depois dele); se não cobre, o Cocoa é saída (a
 * estadia ficou para trás) ou dia de daycare com entrega tardia.
 */
export function coberturaDaHospedagem(events: RemoteEvent[], labels: EventLabel[] = []): Map<string, Set<string>> {
  const cobertura = new Map<string, Set<string>>();
  for (const evento of events) {
    if (ehEventoDeOperacao(evento.summary)) continue;
    for (const lido of parseBookingEvents(evento, labels)) {
      const cor = lido.color.meaning;
      if (cor?.kind !== 'service' || cor.serviceType !== 'boarding') continue;
      const cao = normalizar(lido.dogName);
      const dias = cobertura.get(cao) ?? new Set<string>();
      let dia = lido.startDate;
      // Teto de segurança: série aberta (`openEnded`) não pode virar laço infinito.
      for (let passo = 0; passo < 400 && dia <= lido.endDate; passo += 1) {
        dias.add(dia);
        dia = addDaysISO(dia, 1);
      }
      cobertura.set(cao, dias);
    }
  }
  return cobertura;
}

/**
 * Serviço E "vai pro daycare" daquele dia, a partir da COR. O único caso que depende de contexto é o
 * **Cocoa (marrom, fora do horário)**, que o cliente descreveu (28/09/2026) como *"o mesmo que o
 * Avocado, a diferença está no horário"*: ele é uma CHEGADA ou uma SAÍDA do boarding, e o lado se lê da
 * sequência (a hospedagem continua no dia seguinte? então é chegada; vinha do dia anterior? é saída).
 * Nos dois casos o cão NÃO pede van (`movimentaOCao` devolve `false` para fora do horário) — quem
 * busca/entrega é o administrador, de carro.
 */
function leituraDoDia(
  cor: ColorMeaning,
  parsed: ParsedBooking,
  hospedagem: Map<string, Set<string>>,
  cao: string,
): Pick<ParsedBooking, 'serviceType' | 'goesToDaycare'> {
  if (cor.kind === 'out_of_hours') {
    const dias = hospedagem.get(cao);
    const continuaDepois = dias?.has(addDaysISO(parsed.startDate, 1)) ?? false;
    const vinhaDeAntes = dias?.has(addDaysISO(parsed.startDate, -1)) ?? false;
    // CHEGADA fora do horário: o cão veio para ficar e NÃO passa pelo daycare.
    if (continuaDepois) return { serviceType: 'boarding', goesToDaycare: false };
    // SAÍDA fora do horário: dormia no hotel, vai pro daycare e volta pra casa depois do horário.
    if (vinhaDeAntes) return { serviceType: 'boarding', goesToDaycare: true };
    // Sem hospedagem em volta: cão de daycare entregue tarde.
    return { serviceType: 'daycare', goesToDaycare: true };
  }
  return { serviceType: serviceTypeOfMeaning(cor), goesToDaycare: true };
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
  options: { labels?: EventLabel[]; calendarId?: string | null } = {},
): ImportOutcome[] {
  const labels = options.labels ?? [];
  const calendarId = options.calendarId === undefined ? DEFAULT_CALENDAR_ID : options.calendarId;
  const porEvento = new Map<string, BookingForImport[]>();
  const recuperadas = new Set<string>();
  // Medido em 07/10/2026: Teddy tinha vínculo e Billy não. Só recuperamos uma linha Google
  // quando há UM evento possível na mesma casa (ID, nunca nome), período e agenda conhecida.
  // A busca usa o período ANTIGO da reserva: mover/apagar o evento não perde o segundo cão.
  // Não escolhemos entre eventos concorrentes nem tocamos em reservas criadas no app.
  reservations = reservations.map((reserva) => {
    if (reserva.googleEventId || reserva.source !== 'google' || reserva.status !== 'confirmed' ||
        antesDaJanela(reserva.startDate, window) || reserva.startDate > window.to) return reserva;
    const tutor = dogs.find((cao) => cao.id === reserva.dogId)?.clientId;
    if (!tutor) return reserva;
    const candidatas = reservations.filter((outra) =>
      outra.googleEventId && outra.source === 'google' && outra.status === 'confirmed' &&
      outra.googleCalendarId === calendarId && Boolean(calendarId) && calendarId !== DEFAULT_CALENDAR_ID &&
      (!reserva.googleCalendarId || reserva.googleCalendarId === calendarId) &&
      outra.dogId !== reserva.dogId && outra.kind === reserva.kind &&
      outra.startDate === reserva.startDate && outra.endDate === reserva.endDate &&
      mesmosDias(outra.weekdays, reserva.weekdays) &&
      dogs.find((cao) => cao.id === outra.dogId)?.clientId === tutor);
    const eventosPossiveis = new Set(candidatas.map((item) => item.googleEventId));
    const origem = candidatas[0];
    if (eventosPossiveis.size !== 1 || !origem || reservations.some((outra) =>
      outra.id !== reserva.id && outra.dogId === reserva.dogId && outra.kind === reserva.kind &&
      (outra.googleEventId === origem.googleEventId || (!outra.googleEventId &&
        outra.source === 'google' && outra.startDate === reserva.startDate && outra.endDate === reserva.endDate)))) return reserva;
    recuperadas.add(reserva.id);
    return { ...reserva, googleEventId: origem.googleEventId, googleCalendarId: origem.googleCalendarId };
  });

  // GUARDA DA CONVENCAO NOVA (escritorio, 27/09/2026): dia de hotel (verde) perde a van SOMENTE quando
  // aquele cao tem um dia de CHEGADA/SAIDA (amarelo/verde-claro) na janela. Calendario que ainda nao
  // adotou a marcacao segue exatamente como antes — nenhum cao some da van por causa desta regra.
  const caesComChegadaOuSaida = new Set<string>();
  for (const evento of events) {
    if (ehEventoDeOperacao(evento.summary)) continue;
    for (const lido of parseBookingEvents(evento, labels)) {
      if (antesDaJanela(lido.startDate, window)) continue;
      // Dia de movimento = o cão ANDA de van (amarelo/Avocado) **ou** fora do horário (marrom/Cocoa,
      // em que quem busca é o administrador). Nos dois casos o cão hospedado não pode seguir na rota
      // nos dias do meio, quando ninguém busca ele (dono, 28/09/2026).
      if (lido.transportRequired === true || lido.color.meaning?.kind === 'out_of_hours') {
        caesComChegadaOuSaida.add(normalizar(lido.dogName));
      }
    }
  }
  for (const reserva of reservations) {
    if (reserva.googleEventId && (!reserva.googleCalendarId || reserva.googleCalendarId === calendarId)) {
      const grupo = porEvento.get(reserva.googleEventId) ?? [];
      grupo.push(reserva);
      porEvento.set(reserva.googleEventId, grupo);
    }
  }

  // Lado do dia para o COCOA (marrom, fora do horário): chegada de hospedagem x saída/dia de daycare.
  const hospedagem = coberturaDaHospedagem(events, labels);

  const resultados: ImportOutcome[] = [];
  const vistos = new Set<string>();
  /** Reservas que ESTA rodada já decidiu criar (chave = cão + serviço + dia/série). */
  const criadasNaRodada = new Map<string, string>();

  for (const evento of [...events].sort((a, b) => a.id.localeCompare(b.id))) {
    // 1. Evento com marca do app é o nosso espelho: o espelho cuida dele, não a importação.
    if (evento.appKey) continue;

    // Um evento pode trazer DOIS cães ("Cão A/Cão B", regra do dono 26/09/2026): cada cão é
    // decidido por si e vira uma reserva própria; a parada é UMA só porque o agrupamento por
    // cliente é do banco (`route_stops.stop_group_id`).
    // 1. Marcador do escritório ("ROTAS FIXAS", "BOARDING 🐶", "Mentoria + Consulta", o typo "BOADING")
    //    não é cão e não é pendência: some da tela EM SILÊNCIO, sem poluir "not registered in the app".
    if (ehEventoDeOperacao(evento.summary)) {
      vistos.add(evento.id);
      continue;
    }

    const parsedTodos = parseBookingEvents(evento, labels);
    const primeiro = parsedTodos[0] ?? null;
    // 2. Até evento sem título precisa aparecer para revisão; o calendário é exclusivo do negócio.
    //    Exceção: evento que COMEÇOU antes de hoje não gera nada — nem reserva, nem pendência
    //    (senão uma hospedagem em curso criaria/alteraria/cancelaria data passada).
    if (!primeiro) {
      if (antesDaJanela(evento.startDate, window)) continue;
      const color = readEventColor(evento, labels);
      const recorrencia = parseRecurrence(evento.recurrence, evento.startDate, evento.endDate);
      resultados.push({
        kind: 'review',
        eventId: evento.id,
        title: evento.summary,
        date: evento.startDate,
        parsed: {
          serviceType: serviceTypeOfMeaning(color.meaning),
          goesToDaycare: true,
          color,
          cancels: color.meaning?.kind === 'cancel',
          dogName: '(no title)',
          startDate: evento.startDate,
          ...recorrencia,
        },
        reason: 'unreadable',
      });
      continue;
    }

    if (antesDaJanela(primeiro.startDate, window)) continue;

    // 3. O serviço vem da COR (etiqueta da paleta nova pelo TOM do hex, senão `colorId` legado). Sem
    //    cor (ou cor fora do mapa) NÃO se chuta serviço: o evento entra na lista "color not recognized"
    //    — que mostra o que foi lido (nome da etiqueta + hex + colorId) — e o escritório pinta e
    //    sincroniza de novo.
    const cor: ColorMeaning | null = primeiro.color.meaning;
    if (!cor) {
      resultados.push({ kind: 'review', eventId: evento.id, title: evento.summary, date: evento.startDate, parsed: primeiro, reason: 'unrecognized color' });
      continue;
    }

    // Um vínculo por evento E cão. Medido em 28/09: reutilizar a linha do primeiro cão
    // para o segundo alternava dog_id e deixava 7 cães no dia em vez de 8.
    const grupo = porEvento.get(evento.id) ?? [];
    const nomesDoEvento = new Set(parsedTodos.map((item) => normalizar(item.dogName)));
    // Um vínculo cancelado do antigo segundo cão não torna ambíguo o único cão ainda ativo.
    const ativas = grupo.filter((item) => item.status === 'confirmed' || item.status === 'active');
    const referenciaUnica = ativas.length === 1 ? ativas[0] : grupo.length === 1 ? grupo[0] : null;
    const renomeado = parsedTodos.length === 1 && Boolean(referenciaUnica) &&
      !dogs.some((cao) => normalizar(cao.name) === normalizar(primeiro.dogName));
    for (const reserva of grupo) {
      const nome = dogs.find((cao) => cao.id === reserva.dogId)?.name;
      if (!renomeado && nome && !nomesDoEvento.has(normalizar(nome)) &&
          reserva.source === 'google' && Boolean(calendarId) && reserva.googleCalendarId === calendarId &&
          !antesDaJanela(reserva.startDate, window) && reserva.startDate <= window.to &&
          (reserva.status === 'confirmed' || reserva.status === 'active')) {
        resultados.push({ kind: 'cancel', eventId: evento.id, bookingKind: reserva.kind, bookingId: reserva.id });
      }
    }
    for (const parsed of parsedTodos) {
      // 4. Casa o cao pelo NOME do titulo (normalizado). Nome repetido em dois cadastros nao e
      //    desempatado por tutor: a regra nova nao traz tutor no titulo, entao isso e pendencia.
      const alvo = normalizar(parsed.dogName);
      const candidatos = dogs.filter((cao) => normalizar(cao.name) === alvo);
      const dogDoTitulo = candidatos.length === 1 ? candidatos[0].id : null;

      // 4.1 Dia de hotel (verde) sem chegada/saída marcada para este cão na janela: mantém a van
      //     (comportamento antigo). Com a marcação, o dia do meio fica FORA da van — é o pedido do
      //     escritório ("um cão hospedado não pode aparecer na rota nos dias em que ninguém busca").
      if (cor.kind === 'service' && cor.serviceType === 'boarding' && parsed.transportRequired === false && !caesComChegadaOuSaida.has(alvo)) {
        parsed.transportRequired = true;
      }

      // Um nome desconhecido em A/B precisa aparecer na revisão. Só UM nome e UMA
      // reserva permitem o caso do cão renomeado no app, sem inventar cadastro.
      const vinculada = grupo.find((item) => item.dogId === dogDoTitulo) ??
        (renomeado ? referenciaUnica : null);
      const ligada = vinculada ?? (dogDoTitulo && grupo.length > 0 ? reservations.find((item) =>
        item.source === 'google' && !item.googleEventId &&
        (!item.googleCalendarId || item.googleCalendarId === calendarId) &&
        item.status === 'confirmed' && item.dogId === dogDoTitulo &&
        item.kind === kindOf(parsed) && item.startDate === parsed.startDate &&
        (item.kind === 'recurring' ? mesmosDias(item.weekdays, parsed.weekdays) : item.endDate === parsed.endDate)) : null) ?? null;

      // 07/10/2026: a agenda governa o status. Evento de serviço presente restaura
      // a reserva cancelada na mesma linha; vermelho é decidido antes da atualização.
      // Roxo mantém a regra existente de alteração de escala.
      if (cor.kind === 'schedule_change' && ligada?.kind === 'reservation' && ligada.status === 'cancelled') {
        vistos.add(evento.id);
        continue;
      }

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

      // 6.1 Evento ROXO = alteração de cliente de DIA FIXO (dia extra/alterado, cliente fora da ordem).
      //     O dia entra na ESCALA daquele cão como dia extra — não vira reserva avulsa: é literalmente o
      //     "não ficar serviço solto" do dono (24/09/2026). Sem escala ativa não há onde encaixar, e o
      //     app não inventa escala: vai para a lista de revisão do cartão.
      if (cor.kind === 'schedule_change') {
        vistos.add(evento.id);
        const dogId = dogDoTitulo ?? ligada?.dogId ?? null;
        const escala =
          ligada?.kind === 'recurring' && ligada.status === 'active'
            ? ligada
            : dogId
              ? (reservations.find((item) => item.kind === 'recurring' && item.dogId === dogId && item.status === 'active') ?? null)
              : null;
        if (!escala) {
          resultados.push({
            kind: 'review',
            eventId: evento.id,
            title: evento.summary,
            date: evento.startDate,
            parsed,
            reason: dogId ? 'purple without schedule' : candidatos.length > 1 ? 'ambiguous dog' : 'unknown dog',
          });
          continue;
        }
        resultados.push({
          kind: 'extraDay',
          eventId: evento.id,
          dogId: escala.dogId,
          scheduleId: escala.id,
          date: evento.startDate,
          looseBookingId: ligada?.kind === 'reservation' ? ligada.id : null,
        });
        continue;
      }

      if (ligada) {
        vistos.add(evento.id);
        const dogId = dogDoTitulo ?? ligada.dogId;
        const servico: ParsedBooking = { ...parsed, ...leituraDoDia(cor, parsed, hospedagem, alvo) };
        if ((ligada.source === 'google' || (ligada.kind === 'reservation' && ligada.status === 'cancelled')) && (precisaAtualizar(ligada, servico, dogId) || recuperadas.has(ligada.id))) {
          resultados.push({
            kind: 'update',
            eventId: evento.id,
            bookingKind: ligada.kind,
            bookingId: ligada.id,
            dogId,
            parsed: servico,
            // O reparo herda a origem da única âncora compatível; âncora sem origem continua protegida.
            ...(recuperadas.has(ligada.id) ? { calendarId: ligada.googleCalendarId! } : {}),
            semVinculo: false,
          });
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
      const servico: ParsedBooking = { ...parsed, ...leituraDoDia(cor, parsed, hospedagem, alvo) };
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

      /**
       * 8.1 Repetido DENTRO desta mesma leitura — e não no banco ainda.
       *
       * Medido no calendário do cliente (print de 06/10/2026): `Sammy` aparece DUAS vezes no mesmo dia
       * (3:30AM e 9AM) e `Penny` duas vezes também. A regra do dono é "o mesmo cão, mesmo serviço, mesmo
       * dia aparece UMA vez", mas a única comparação era com as reservas JÁ GRAVADAS (`gemea`, acima) e o
       * banco não tem índice único para (cão, serviço, dia) — só para `google_event_id`. Resultado medido
       * no fixture: a rodada devolvia **2 `create` iguais** (o dia no app mostrava o cão uma vez e o banco
       * ficava com duas linhas). Agora o PRIMEIRO evento cria e os seguintes viram pendência `duplicate`,
       * do mesmo jeito que o evento repetido contra o banco — o gestor decide, nada é criado em dobro.
       */
      const chave = chaveDaMesmaReserva(tipo, dogId, servico);
      if (criadasNaRodada.has(chave)) {
        resultados.push({ kind: 'review', eventId: evento.id, title: evento.summary, date: evento.startDate, parsed: servico, reason: 'duplicate' });
        continue;
      }
      criadasNaRodada.set(chave, evento.id);

      resultados.push({ kind: 'create', eventId: evento.id, dogId, parsed: servico });
    }
  }

  // 9. Reserva vinda do Google cujo evento sumiu: cancelar — so dentro da janela consultada.
  for (const reserva of reservations) {
    if (reserva.source !== 'google' || !reserva.googleEventId) continue;
    // Medido em 07/10/2026, 12:50 UTC: trocar a agenda cancelou Enso, Oreo e Rani.
    // Ausência só prova exclusão na MESMA agenda. Legado sem origem fica protegido:
    // atribuir a agenda atual retroativamente repetiria o defeito na segunda rodada.
    if (!reserva.googleCalendarId || reserva.googleCalendarId !== calendarId) continue;
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
export function describeImport(resumo: { created: number; already?: number; updated: number; cancelled: number; extraDays?: number; review: number }): string {
  const partes: string[] = [];
  if (resumo.created) partes.push(`${resumo.created} from Google`);
  // Evento que já tinha reserva (ver `ImportSummary.already`): informação, não erro.
  if (resumo.already) partes.push(`${resumo.already} already in the app`);
  if (resumo.updated) partes.push(`${resumo.updated} updated`);
  if (resumo.extraDays) partes.push(`${resumo.extraDays} linked to a recurring schedule`);
  if (resumo.cancelled) partes.push(`${resumo.cancelled} cancelled`);
  if (resumo.review) partes.push(`${resumo.review} to review`);
  return partes.length ? partes.join(' · ') : '';
}

/**
 * Falha de um item da importação: o evento (ou a reserva) e a mensagem que veio do banco.
 *
 * `dogId`/`serviceType`/`semVinculo` entraram em 28/09/2026: o relógio do servidor devolvia
 * *"1 falhas [<evento>: duplicate key…]"* e **não dizia de qual cão era** — com dois cães no mesmo
 * evento, contar falha não diagnostica. Agora o registro diz quem era e se a reserva ia nascer sem
 * vínculo (é o que separa "faltou o vínculo" de "o plano tentou ligar duas vezes").
 */
export type ImportFailure = {
  eventId?: string;
  reservationId?: string;
  dogId?: string;
  serviceType?: 'daycare' | 'boarding' | null;
  semVinculo?: boolean;
  error: string;
};

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
