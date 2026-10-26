export type DogRef = {
  id: string;
  dogName: string;
  clientName: string;
  /**
   * Cliente (a CASA) do cão. É o que diz quem mora junto no Dispatch: dois cães do mesmo cliente vão
   * com o mesmo motorista e viram uma parada só para o motorista (áudio do dono, 29/09/2026:
   * *"se eu mandar o Sam para um driver, o Oli vai para o mesmo driver… não faz sentido eu ter que
   * clicar duas vezes para a mesma casa"*). Opcional porque nem todo consumidor do `DogRef` carrega
   * o cliente; sem ele a regra simplesmente não agrupa.
   */
  clientId?: string | null;
};

export type ReservationRecord = {
  id: string;
  dog: DogRef;
  /** Omitido apenas por consumidores legados que já consultam confirmadas. */
  status?: 'confirmed' | 'cancelled';
  serviceType: 'daycare' | 'boarding';
  startDate: string;
  endDate: string;
  transportRequired: boolean;
  /** Per-leg override; omitted legacy records use transportRequired. */
  pickupRequired?: boolean;
  dropoffRequired?: boolean;
  /**
   * O cão passa pelo DAYCARE neste dia (entra no Total Pack e na seção "já está na van"). Contrato do
   * cliente, escrito em 28/09/2026: *"por via de regra todo boarding vai pro daycare (ou seja eles no
   * início do dia já estarão dentro da van esperando o driver)"*. A única exceção é a **chegada fora do
   * horário** (Cocoa no pick-up): *"ele entra no total de cães mas não entra no total pack porque o cão
   * não estará no day care"*. Omitido = `true` (reserva antiga/criada no app, série de daycare).
   */
  goesToDaycare?: boolean;
  /**
   * Aquele dia da hospedagem é o de CHEGADA/SAÍDA (avocado no calendário do escritório): o cão está na
   * casa e quem busca/entrega é o motorista — parada normal da rota, NUNCA "já está na van". Omitido =
   * `false` (dia de hotel/estadia, o cão já está lá dentro). Ver migração
   * `202610060041_dia_de_movimento_na_reserva.sql` e a decisão do dono de 06/10/2026.
   */
  movementDay?: boolean;
  /**
   * O TUTOR BUSCA DE MANHÃ (☀️): o cão conta no dia mas não pede van nenhuma — fora do pickup E da
   * entrega. Ver `ParsedBooking.ownerPickup` e a migração `202610260900`.
   */
  ownerPickup?: boolean;
  /**
   * Dias DESTA reserva que o escritório cancelou pintando o VERMELHO naquele dia (migração
   * `202610150045`). A linha continua ativa e o dia simplesmente não existe para o cão: sai do dia, do
   * Total Pack, da fila do Dispatch e da entrega, e aparece como cancelado no resumo da semana.
   *
   * ⚠️ MUDANÇA DE 14/10/2026 (item 2 do relatório da sincronização): antes o vermelho num dia de uma
   * barra cancelava a reserva INTEIRA (`status = 'cancelled'`), então o cão sumia também dos dias que o
   * escritório não cancelou — e a série ainda tentava restaurar a linha, o que produzia o vaivém de 15
   * em 15 minutos. Agora o dia é que é cancelado, não a linha.
   */
  cancelledDays?: string[];
  /** Evento do Google que originou a reserva (reserva importada) — ver migration 025. */
  googleEventId?: string | null;
  /** 'google' = nasceu no Google Calendar (lá manda); 'app' = nasceu no aplicativo. */
  source?: 'app' | 'google' | null;
};

export type RecurringScheduleRecord = {
  id: string;
  dog: DogRef;
  weekdays: number[]; // 0 = Sunday .. 6 = Saturday
  startDate: string;
  endDate: string | null;
  active: boolean;
  transportRequired: boolean;
  /** Per-leg override; omitted legacy records use transportRequired. */
  pickupRequired?: boolean;
  dropoffRequired?: boolean;
  /** Evento do Google que originou a série (importada) — ver migration 025. */
  googleEventId?: string | null;
  /** 'google' = nasceu no Google Calendar (lá manda); 'app' = nasceu no aplicativo. */
  source?: 'app' | 'google' | null;
};

export type RecurringExceptionAction = 'skip' | 'extra' | 'transport_on' | 'transport_off';

export type RecurringExceptionRecord = {
  id: string;
  scheduleId: string;
  action: RecurringExceptionAction;
  startDate: string;
  endDate: string;
  reason?: string | null;
};

export type DayItem = {
  kind: 'daycare' | 'boarding' | 'recurring-daycare';
  dog: DogRef;
  reservationId: string | null;
  recurringScheduleId: string | null;
  dogId: string;
  dogName: string;
  clientName: string;
  /** A casa do cão (`dogs.client_id`) — ver `DogRef.clientId`. */
  clientId?: string | null;
  transportRequired: boolean;
  /** Per-leg override; omitted legacy records use transportRequired. */
  pickupRequired?: boolean;
  dropoffRequired?: boolean;
  /** O cão passa pelo daycare hoje (ver `ReservationRecord.goesToDaycare`). */
  goesToDaycare: boolean;
  /** Dia de CHEGADA/SAÍDA da hospedagem (avocado) — ver `ReservationRecord.movementDay`. */
  movementDay?: boolean;
  /**
   * DIREÇÃO do dia de movimento (cliente em áudio, 26/10/2026): *"a última lá da casinha foi embora de
   * manhã cedo, e os outros dois, o Lucky e o Levi Miller, vão embora à tarde — como a gente consegue
   * fazer pra ele ter essa leitura?"*. O calendário marca chegada e saída com a MESMA cor, então o
   * booleano `movementDay` não dizia para onde o cão anda: `arrival` = o cão está em casa e o motorista
   * busca; `departure` = o cão está na van/hotel e o motorista leva para casa.
   *
   * Sai das DATAS (a linha da estadia que termina hoje = saída), nunca do horário do bloco: o escritório
   * confirmou em 26/10/2026 que a hora do evento 🏠 é só marcador do dia.
   */
  movementToday?: 'arrival' | 'departure' | null;
  /** ☀️ neste dia: o tutor busca de manhã — nenhuma perna da rota pede este cão. */
  ownerPickupToday?: boolean;
  /** Dias cancelados pelo VERMELHO dentro da barra — ver `ReservationRecord.cancelledDays`. */
  cancelledDays?: string[];
  // True when this recurring occurrence is currently overridden to skip (paused) on the built day.
  paused?: boolean;
};

export type DaySummary = { daycare: DayItem[]; boarding: DayItem[] };

/**
 * Cães que já começam o dia DENTRO da van (não precisam de pickup).
 *
 * Pedido do cliente em áudio (23/09/2026): "se o cachorro está boarding… ele já vai começar dentro da
 * van aquele dia. Então ele não tem necessidade de aparecer para fazer rota de pickup, porque ele está
 * boarding."
 *
 * CONTRATO ESCRITO (28/09/2026) — o que fecha a regra: *"por via de regra todo boarding vai pro daycare
 * (ou seja eles no início do dia já estarão dentro da van esperando o driver e na rota de drop off eles
 * voltam pro ponto de drop da van junto com o motorista — **não entra como parada na rota**, mas entram
 * na lista de total pack e contagem do dia)"*. Então quem está na van é o dia de HOTEL **sem movimento**
 * (`transport_required = false`: Basil e a saída fora do horário) que passa pelo daycare — não é mais
 * preciso o calendário ter DOIS eventos no mesmo dia.
 *
 * A chegada fora do horário (Cocoa no pick-up) fica de fora: `goesToDaycare = false` ("o cão não estará
 * no day care"). Dia de movimento (avocado, chegada ou saída com o driver) também fica de fora — ele
 * ENTRA como parada normal da rota.
 *
 * ✅ Implementado em 06/10/2026 com a marca `movement_day` da reserva (migração `202610060041`): o dia de
 * CHEGADA/SAÍDA da hospedagem (avocado) é `movement_day = true` e sai daqui — o cão está na casa e o
 * motorista busca. Antes o filtro só olhava `goesToDaycare` e o cão de chegada ficava preso em "já está
 * na van" (caso Scarlet do print do cliente de 06/10/2026), porque o `transport_required` do dia de
 * chegada e o do dia de hotel são iguais. Quem NÃO tem a marca (reserva antiga, dia de hotel/verde)
 * continua com o comportamento de sempre.
 */
export function dogsJaNaVan(day: DaySummary): Set<string> {
  return new Set(
    day.boarding
      /**
       * 🪤 CLIENTE (print de 02/10/2026, encaminhado pelo dono): *"tô fazendo as rota e tá aparecendo os
       * boarding na lista"*. O contrato escrito (28/09/2026) é literal — *"por via de regra todo boarding
       * vai pro daycare (ou seja eles no início do dia já estarão dentro da van … não entra como parada na
       * rota, mas entram na lista de total pack e contagem do dia)"* — mas o código exigia
       * `transport_required = false`, então o boarding de UM DIA com transporte (casos reais de 02/10:
       * Honey Bea e Archie) voltava a ser parada de pickup.
       *
       * Agora TODO boarding que passa pelo daycare nasce DENTRO da van: sai da fila de pickup e aparece
       * na seção "Boarding — already in the van" (recolhida), onde o gestor inclui à mão quando algum
       * tiver de voltar para casa. Quem NÃO vai pro daycare (`goesToDaycare = false`, chegada fora do
       * horário) continua sendo parada normal da rota.
       */
      .filter((item) => item.goesToDaycare && item.movementToday !== 'arrival')
      .map((item) => item.dogId),
  );
}

/**
 * Fila de transporte do dia: precisa de transporte E não é cão que já está na van (boarding+daycare).
 *
 * É ESTA lista que o Dispatch oferece para montar rota. Antes dela o cão em boarding aparecia para
 * pickup mesmo já estando no daycare — era o que o cliente apontou.
 */
export function transportPool(day: DaySummary): DayItem[] {
  return transportPoolForPhase(day, 'pickup');
}

/** Independent candidate lists. Boarding never creates a delivery stop. */
export function transportPoolForPhase(day: DaySummary, phase: 'pickup' | 'dropoff'): DayItem[] {
  const jaNaVan = dogsJaNaVan(day);
  const boarding = new Set(day.boarding.map(item => item.dogId));
  const vistos = new Set<string>();
  return [...day.daycare, ...day.boarding].filter((item) => {
    /* ☀️ — o tutor busca de manhã (cliente, 26/10/2026): conta no dia, mas não pede van nenhuma. */
    if (item.ownerPickupToday) return false;
    const required = phase === 'pickup' ? item.pickupRequired : item.dropoffRequired;
    if (!(required ?? item.transportRequired)) return false;
    if (phase === 'pickup' && jaNaVan.has(item.dogId)) return false;
    if (phase === 'dropoff' && boarding.has(item.dogId) && item.movementToday !== 'departure') return false;
    if (vistos.has(item.dogId)) return false;
    vistos.add(item.dogId);
    return true;
  });
}

/**
 * Cães que JÁ ESTÃO NA VAN, para a seção separada do Dispatch ("Boarding — already in the van").
 *
 * Por que existem mesmo sem precisar de pickup (áudio do cliente, 23/09/2026): "pode ser que algum que
 * vai pro daycare precise voltar para a casa… então é melhor que o administrador possa dizer quais
 * cachorros estão para aquele dia, ou pelo menos confirmar manualmente". Ou seja: saem da fila
 * principal, mas continuam à mão do gestor para incluir na rota quando precisarem voltar.
 *
 * Contrato escrito (28/09/2026): o dia de hotel sem movimento entra aqui sozinho (Basil e a saída fora
 * do horário) — `dogsJaNaVan` é quem decide.
 */
export function vanPool(day: DaySummary): DayItem[] {
  const jaNaVan = dogsJaNaVan(day);
  const vistos = new Set<string>();
  return day.boarding.filter((item) => {
    if (!jaNaVan.has(item.dogId)) return false;
    if (vistos.has(item.dogId)) return false;
    vistos.add(item.dogId);
    return true;
  });
}

function dateToWeekday(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

function isWithin(isoDate: string, start: string, end: string): boolean {
  return isoDate >= start && isoDate <= end;
}

function itemize(kind: DayItem['kind'], reservation: ReservationRecord | null, schedule: RecurringScheduleRecord | null, isoDate?: string): DayItem {
  const source = reservation ?? schedule;
  if (!source) throw new Error('itemize requires a reservation or a schedule');
  const dog = source.dog;
  return {
    kind,
    dog,
    dogId: dog.id,
    dogName: dog.dogName,
    clientName: dog.clientName,
    clientId: dog.clientId ?? null,
    reservationId: reservation?.id ?? null,
    recurringScheduleId: schedule?.id ?? null,
    transportRequired: source.transportRequired,
    pickupRequired: source.pickupRequired,
    dropoffRequired: source.dropoffRequired,
    goesToDaycare: reservation?.goesToDaycare ?? true,
    movementDay: reservation?.movementDay ?? false,
    movementToday: direcaoDoMovimento(reservation, isoDate),
    ownerPickupToday: reservation?.ownerPickup === true,
    cancelledDays: reservation?.cancelledDays ?? [],
  };
}

/**
 * Para onde o cão anda no dia de movimento da hospedagem.
 *
 * `departure` vence `arrival`: no dia em que a estadia termina o escritório costuma ter DUAS linhas
 * cobrindo o dia (a barra da estadia, que termina hoje, e a linha de um dia com `movement_day`). A
 * barra é a que diz a verdade sobre a direção — o cão dormiu aqui, então hoje ele vai para casa.
 *
 * Uma linha de UM dia só (`startDate === endDate === hoje`, sem barra) fica como `arrival`: sem o
 * histórico da estadia o app não tem como provar que o cão já estava com a gente — e inventar saída
 * mandaria a van para a casa de um cão que ainda está chegando.
 */
function direcaoDoMovimento(reservation: ReservationRecord | null, isoDate?: string): 'arrival' | 'departure' | null {
  if (!reservation || !isoDate || reservation.serviceType !== 'boarding') return null;
  /* A estadia que termina hoje é SAÍDA mesmo sem marca: o cão dormiu aqui. */
  if (reservation.endDate === isoDate && reservation.startDate < isoDate) return 'departure';
  /* A CHEGADA só é chegada quando o escritório marcou o dia (avocado/amarelo). Sem a marca vale a
   * guarda antiga do dia de hotel — o cão já está na van — para não mexer em reserva legada. */
  if (reservation.startDate === isoDate && reservation.movementDay === true) return 'arrival';
  return null;
}

function compareByName(a: DayItem, b: DayItem): number {
  return a.clientName.localeCompare(b.clientName) || a.dogName.localeCompare(b.dogName);
}

/** Effective transport for a recurring schedule on a date, after per-occurrence overrides. */
function transportForSchedule(schedule: RecurringScheduleRecord, isoDate: string, exceptions: RecurringExceptionRecord[]): boolean {
  let transport = schedule.transportRequired;
  for (const exception of exceptions) {
    if (exception.scheduleId !== schedule.id) continue;
    if (!isWithin(isoDate, exception.startDate, exception.endDate)) continue;
    if (exception.action === 'transport_on') transport = true;
    if (exception.action === 'transport_off') transport = false;
  }
  return transport;
}

/** True when a skip exception (pause/absence) covers this date for the schedule. */
export function isSkipped(scheduleId: string, isoDate: string, exceptions: RecurringExceptionRecord[]): boolean {
  return exceptions.some(
    (exception) =>
      exception.scheduleId === scheduleId && exception.action === 'skip' && isWithin(isoDate, exception.startDate, exception.endDate),
  );
}

/**
 * True when this date is an EXTRA day of the schedule (evento ROXO no Google): o cliente de dia fixo
 * mudou o dia / veio fora da ordem, e o dia fica LIGADO à escala em vez de virar reserva avulsa —
 * é o "não ficar serviço solto" do pedido do dono (24/09/2026).
 */
export function isExtraDay(scheduleId: string, isoDate: string, exceptions: RecurringExceptionRecord[]): boolean {
  return exceptions.some(
    (exception) =>
      exception.scheduleId === scheduleId && exception.action === 'extra' && isWithin(isoDate, exception.startDate, exception.endDate),
  );
}

export function buildDay(
  isoDate: string,
  reservations: ReservationRecord[],
  recurring: RecurringScheduleRecord[],
  exceptions: RecurringExceptionRecord[] = [],
): DaySummary {
  const daycare: DayItem[] = [];
  const boarding: DayItem[] = [];

  /** Dias que o vermelho do escritório tirou de um cão (ver `ReservationRecord.cancelledDays`). */
  const diasCanceladosDoCao = new Set<string>();
  for (const reserva of reservations) {
    for (const dia of reserva.cancelledDays ?? []) diasCanceladosDoCao.add(`${reserva.dog.id}|${dia}`);
  }

  for (const reservation of reservations) {
    if (reservation.status === 'cancelled') continue;
    if (!isWithin(isoDate, reservation.startDate, reservation.endDate)) continue;
    /**
     * ⚠️ DIA CANCELADO DENTRO DA BARRA (14/10/2026, migração `202610150045`): o escritório pintou o
     * vermelho naquele dia, não na barra toda. A linha continua ativa nos outros dias — antes o vermelho
     * cancelava a reserva inteira e o cão sumia também dos dias que ninguém cancelou.
     *
     * A marca vale para o CÃO no dia (não só para a linha): se o escritório cancelou aquele dia, ele não
     * vem — mesmo que outra reserva do mesmo cão cubra a data (barra de daycare + hospedagem, por
     * exemplo). Por isso o conjunto é montado antes do laço.
     */
    if (diasCanceladosDoCao.has(`${reservation.dog.id}|${isoDate}`)) continue;
    if (reservation.serviceType === 'boarding') {
      boarding.push(itemize('boarding', reservation, null, isoDate));
    } else {
      /**
       * ⚠️ MUDANÇA DE 14/10/2026 (quebra do escritório: *"tá faltando 1 cachorro lá ainda"*, no grupo
       * do app). A barra de DAYCARE de VÁRIOS dias é o cão vindo **todo dia** dela: o escritório pinta
       * UMA barra por semana (medido no banco: `Charlie` 12→17 e `Tiger` 13→16) e a lista de trabalho
       * dele traz os dois com horário de busca em cada dia (7:25 e 7:35). Antes o dia exigia
       * `isoDate === reservation.startDate`, então do 2º dia em diante o cão desaparecia do dia, do
       * Total Pack e da fila do Dispatch — em 14/10 o Tiger e o Charlie sumiram da tela enquanto o
       * escritório os esperava na rota. O intervalo já é inclusivo pelas duas pontas
       * (`isWithin`), então cobrir todo dia coberto é o que a barra significa.
       */
      daycare.push(itemize('daycare', reservation, null, isoDate));
    }
  }

  const weekday = dateToWeekday(isoDate);
  for (const schedule of recurring) {
    if (!schedule.active) continue;
    if (isoDate < schedule.startDate) continue;
    if (schedule.endDate && isoDate > schedule.endDate) continue;
    if (!schedule.weekdays.includes(weekday)) continue;
    if (isSkipped(schedule.id, isoDate, exceptions)) continue;
    daycare.push({ ...itemize('recurring-daycare', null, schedule, isoDate), transportRequired: transportForSchedule(schedule, isoDate, exceptions) });
  }

  // Dia EXTRA (evento ROXO no Google): o dia não está nos `weekdays`, mas faz parte da escala daquele
  // cão. Entra na agenda ligado à escala (mesmo cartão "Repeats weekly"), não como reserva avulsa.
  for (const schedule of recurring) {
    if (!schedule.active) continue;
    if (isoDate < schedule.startDate) continue;
    if (schedule.endDate && isoDate > schedule.endDate) continue;
    if (schedule.weekdays.includes(weekday)) continue; // dia normal da escala: já entrou acima
    if (!isExtraDay(schedule.id, isoDate, exceptions)) continue;
    if (isSkipped(schedule.id, isoDate, exceptions)) continue;
    daycare.push({ ...itemize('recurring-daycare', null, schedule, isoDate), transportRequired: transportForSchedule(schedule, isoDate, exceptions) });
  }

  daycare.sort(compareByName);
  boarding.sort(compareByName);
  // Agregação de tela: uma entrada por cão/serviço, sem alterar reservas no banco.
  // Transporte continua disponível se qualquer agendamento desse serviço o pedir.
  const uniqueDogs = (items: DayItem[]): DayItem[] => {
    const dogs = new Map<string, DayItem>();
    for (const item of items) {
      const existing = dogs.get(item.dogId);
      dogs.set(item.dogId, existing
        ? { ...existing, transportRequired: existing.transportRequired || item.transportRequired,
          pickupRequired: (existing.pickupRequired ?? existing.transportRequired) || (item.pickupRequired ?? item.transportRequired),
          dropoffRequired: (existing.dropoffRequired ?? existing.transportRequired) || (item.dropoffRequired ?? item.transportRequired),
          /**
           * ⚠️ 14/10/2026 — a ORDEM das linhas do SELECT decidia o dia do cão. Uma chegada/saída de
           * hospedagem (a linha de UM dia com `movement_day = true`) e a linha da ESTADIA (a barra, sem
           * a marca) cobrem o mesmo dia, e a agregação antiga deixava valer o que viesse PRIMEIRO: o cão
           * que devia ser parada da rota ficava preso em "já está na van". Medido com as funções reais
           * sobre o banco do cliente: 15/10 dava fila 17 × 19 (Elvis e Levi S) e 16/10 dava 12 × 13
           * (Jasper, Ruby e Skippy) só trocando a ordem das linhas — e as telas consultam sem `order`.
           * Regra do dia de movimento (cliente, 06/10/2026): o dia de CHEGADA/SAÍDA é parada normal, e
           * `movementDay` é a marca que manda — então aqui vale o "OU": se QUALQUER linha do dia diz que
           * o cão se move com o motorista, ele é parada, independente da ordem.
           */
          movementDay: existing.movementDay === true || item.movementDay === true,
          /** Direção: saída vence chegada quando as duas linhas do dia discordam (ver `direcaoDoMovimento`). */
          ownerPickupToday: existing.ownerPickupToday === true || item.ownerPickupToday === true,
          movementToday: existing.movementToday === 'departure' || item.movementToday === 'departure'
            ? 'departure'
            : existing.movementToday === 'arrival' || item.movementToday === 'arrival' ? 'arrival' : null,
          // Mesmo motivo: `goesToDaycare` também não pode depender da ordem. Vale o "OU" (contrato
          // escrito de 28/09: *"por via de regra todo boarding vai pro daycare"*) — hoje o banco não
          // tem nenhum dia com as duas linhas discordando, então isso não muda o dia de ninguém; só
          // tira a sorte de quem chega primeiro.
          goesToDaycare: existing.goesToDaycare || item.goesToDaycare,
          // Dias cancelados do MESMO cão somam (união) — mesma razão: não pode depender da ordem.
          // Se qualquer linha do dia diz que aquele dia foi cancelado, o cão não aparece naquele dia.
          cancelledDays: [...new Set([...(existing.cancelledDays ?? []), ...(item.cancelledDays ?? [])])] }
        : item);
    }
    return [...dogs.values()];
  };
  return { daycare: uniqueDogs(daycare), boarding: uniqueDogs(boarding) };
}
