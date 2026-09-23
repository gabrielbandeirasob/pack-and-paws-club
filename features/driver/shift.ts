/**
 * JORNADA DO MOTORISTA (clock in / clock out).
 *
 * Pedido do cliente em áudio (16/09/2026): "quando o driver chegar, ele tem que dar o clock in
 * e depois o clock out".
 *
 * Desenho aprovado: a jornada é DEDUZIDA dos eventos da rota (primeira chegada → última
 * conclusão) — o motorista não aperta nada no dia normal. Clock in/out manual é a EXCEÇÃO
 * (esqueceu, imprevisto) e por isso exige motivo e aparece marcado como manual.
 *
 * Este módulo é puro: toda a conta (deduzir, somar, resumir, exportar) mora aqui, com teste.
 * A hora oficial é do servidor (`status_updated_at`); a hora do evento pode ter vindo do
 * aparelho quando o registro foi feito sem sinal (ver migration 024).
 */

export type StopMilestones = {
  id: string;
  sequence: number;
  status: string;
  arrivedAt?: string | null;
  pickedUpAt?: string | null;
  completedAt?: string | null;
  skippedAt?: string | null;
};

export type ManualShift = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  startReason: string;
  endReason?: string | null;
};

export type ShiftSource = 'route' | 'manual' | 'none';

export type ShiftState = {
  /** open = jornada em andamento; closed = já terminou; none = não começou */
  kind: 'open' | 'closed' | 'none';
  /** de onde veio o começo: dos eventos da rota (automático) ou do registro manual */
  source: ShiftSource;
  startedAt: string | null;
  endedAt: string | null;
  /** minutos trabalhados (até agora, se estiver aberta) */
  minutes: number;
  /** true quando existe jornada manual aberta (o gestor precisa saber que foi exceção) */
  manualOpen: boolean;
};

function quando(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Momento do primeiro contato do motorista com a rota (chegada na primeira parada). */
export function firstArrival(stops: StopMilestones[]): string | null {
  const marcas = stops
    .map((stop) => quando(stop.arrivedAt))
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);
  return marcas.length > 0 ? new Date(marcas[0]).toISOString() : null;
}

/** Momento em que a rota terminou de fato (última conclusão ou último "problema"). */
export function lastCompletion(stops: StopMilestones[]): string | null {
  const marcas = stops
    .flatMap((stop) => [quando(stop.completedAt), quando(stop.skippedAt)])
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);
  return marcas.length > 0 ? new Date(marcas[marcas.length - 1]).toISOString() : null;
}

/** Jornada que os eventos da rota contam sozinhos. null = a rota ainda não começou. */
export function deduceShift(stops: StopMilestones[]): { startedAt: string; endedAt: string | null } | null {
  const startedAt = firstArrival(stops);
  if (!startedAt) return null;
  return { startedAt, endedAt: lastCompletion(stops) };
}

/** Jornada manual aberta (uma por vez, garantido no banco). */
export function openManualShift(shifts: ManualShift[]): ManualShift | null {
  return shifts.find((shift) => shift.endedAt === null) ?? null;
}

/** Minutos entre dois horários (nunca negativo; sem fim = até agora). */
export function shiftMinutes(startedAt: string | null, endedAt: string | null, now: Date = new Date()): number {
  const inicio = quando(startedAt);
  if (inicio === null) return 0;
  const fim = quando(endedAt) ?? now.getTime();
  return Math.max(0, Math.round((fim - inicio) / 60_000));
}

/**
 * Estado da jornada que a tela mostra.
 *
 * Regra de precedência: jornada MANUAL aberta manda (é exceção declarada pelo motorista). Sem
 * manual aberta, vale a dedução dos eventos da rota — e, se a dedução já fechou (última parada
 * concluída), a jornada é considerada fechada mesmo sem registro manual de saída.
 */
export function shiftState(stops: StopMilestones[], shifts: ManualShift[], now: Date = new Date()): ShiftState {
  const manual = openManualShift(shifts);
  if (manual) {
    return {
      kind: 'open',
      source: 'manual',
      startedAt: manual.startedAt,
      endedAt: null,
      minutes: shiftMinutes(manual.startedAt, null, now),
      manualOpen: true,
    };
  }

  const maisRecente = [...shifts].sort((a, b) => (quando(b.startedAt) ?? 0) - (quando(a.startedAt) ?? 0))[0] ?? null;
  const deduzida = deduceShift(stops);

  if (deduzida && (!maisRecente || (quando(deduzida.startedAt) ?? 0) >= (quando(maisRecente.startedAt) ?? 0))) {
    return {
      kind: deduzida.endedAt ? 'closed' : 'open',
      source: 'route',
      startedAt: deduzida.startedAt,
      endedAt: deduzida.endedAt,
      minutes: shiftMinutes(deduzida.startedAt, deduzida.endedAt, now),
      manualOpen: false,
    };
  }

  if (maisRecente) {
    return {
      kind: maisRecente.endedAt ? 'closed' : 'open',
      source: 'manual',
      startedAt: maisRecente.startedAt,
      endedAt: maisRecente.endedAt,
      minutes: shiftMinutes(maisRecente.startedAt, maisRecente.endedAt, now),
      manualOpen: maisRecente.endedAt === null,
    };
  }

  return { kind: 'none', source: 'none', startedAt: null, endedAt: null, minutes: 0, manualOpen: false };
}

/** "07:12" no fuso do aparelho (é o horário que o motorista enxerga no relógio dele). */
export function clockText(iso: string | null | undefined): string | null {
  const t = quando(iso);
  if (t === null) return null;
  const d = new Date(t);
  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
}

/** "3h05" (a partir de 60 min) ou "45 min". */
export function durationText(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  return `${horas}h${`${resto}`.padStart(2, '0')}`;
}

/** Texto do cartão da jornada, montado a partir do estado (o que o motorista lê). */
export function shiftLabel(state: ShiftState): string {
  const entrada = clockText(state.startedAt);
  const saida = clockText(state.endedAt);
  if (state.kind === 'none') return 'Journey not started yet';
  if (state.kind === 'open') {
    const base = entrada ? `On the clock since ${entrada}` : 'On the clock';
    return `${base} · ${durationText(state.minutes)} so far${state.manualOpen ? ' · manual' : ''}`;
  }
  return `${entrada ?? '—'} → ${saida ?? '—'} · ${durationText(state.minutes)}${state.source === 'manual' ? ' · manual' : ''}`;
}

/* ------------------------------------------------------------------ *
 * RESUMO PARA O GESTOR
 * ------------------------------------------------------------------ */

export type DriverDayInput = {
  driverId: string;
  driverName: string;
  /** dia local (YYYY-MM-DD) dos registros */
  day: string;
  /** paradas do motorista naquele dia (para a dedução) */
  stops: StopMilestones[];
  /** jornadas manuais daquele dia */
  shifts: ManualShift[];
};

export type DriverDaySummary = {
  driverId: string;
  driverName: string;
  day: string;
  /** primeira entrada do dia (só manual) */
  manualIn: string | null;
  /** última saída do dia (só manual) */
  manualOut: string | null;
  /** primeira chegada em parada (automático) */
  routeIn: string | null;
  /** última conclusão (automático) */
  routeOut: string | null;
  /** tempo total considerado: da primeira marca (manual ou rota) até a última */
  minutes: number;
  /** quantas jornadas manuais entraram no dia */
  manualCount: number;
  /** true = o dia tem algo fora da dedução automática */
  hasManual: boolean;
};

/**
 * Resumo de um dia de um motorista: junta o que a rota conta sozinha com os registros manuais.
 * O tempo total usa a marca MAIS CEDO como entrada e a MAIS TARDE como saída — é o intervalo em
 * que o motorista esteve trabalhando de fato (minutos de almoço/intervalo não são inferidos aqui;
 * o gestor vê os horários e o tempo por rota no detalhe).
 */
export function summarizeDriverDay(entrada: DriverDayInput): DriverDaySummary {
  const iso = (valor: string | null | undefined): string | null => {
    const t = quando(valor);
    return t === null ? null : new Date(t).toISOString();
  };
  const manualIn = iso(entrada.shifts.map((s) => s.startedAt).filter(Boolean).sort()[0] ?? null);
  const saidas = entrada.shifts.map((s) => s.endedAt).filter((v): v is string => Boolean(v)).sort();
  const manualOut = iso(saidas.length > 0 ? saidas[saidas.length - 1] : null);
  const routeIn = firstArrival(entrada.stops);
  const routeOut = lastCompletion(entrada.stops);

  const inicios = [manualIn, routeIn].filter((v): v is string => Boolean(v)).sort();
  const fins = [manualOut, routeOut].filter((v): v is string => Boolean(v)).sort();
  const startedAt = inicios[0] ?? null;
  const endedAt = fins.length > 0 ? fins[fins.length - 1] : null;

  return {
    driverId: entrada.driverId,
    driverName: entrada.driverName,
    day: entrada.day,
    manualIn,
    manualOut,
    routeIn,
    routeOut,
    minutes: shiftMinutes(startedAt, endedAt, endedAt ? new Date(endedAt) : new Date()),
    manualCount: entrada.shifts.length,
    hasManual: entrada.shifts.length > 0,
  };
}

/** Resumo de vários dias, ordenado por dia e motorista (o que a tela e o CSV mostram). */
export function summarizeDriverDays(entradas: DriverDayInput[]): DriverDaySummary[] {
  return entradas
    .map(summarizeDriverDay)
    .sort((a, b) => (a.day === b.day ? a.driverName.localeCompare(b.driverName) : b.day.localeCompare(a.day)));
}

/* --- montagem dos dados do gestor (rotas + jornadas → um registro por motorista/dia) --- */

export type RouteForSummary = {
  id: string;
  /** dia local da rota (YYYY-MM-DD) */
  day: string;
  driverId: string | null;
  driverName: string;
  stops: StopMilestones[];
};

export type ShiftForSummary = {
  driverId: string;
  driverName: string;
  startedAt: string;
  endedAt: string | null;
  startReason: string;
  endReason?: string | null;
};

/**
 * Junta rotas e jornadas num registro por motorista/dia.
 *
 * O dia de uma jornada é o do seu INÍCIO (uma jornada que começa 23h e vira a noite pertence ao
 * dia em que começou — a alternativa dividiria a noite em dois dias e confundiria quem paga).
 * Motorista com jornada e sem rota também aparece: ele trabalhou.
 */
export function buildDriverDayInputs(routes: RouteForSummary[], shifts: ShiftForSummary[]): DriverDayInput[] {
  const mapa = new Map<string, DriverDayInput>();

  const chave = (driverId: string, day: string) => `${driverId}|${day}`;

  for (const rota of routes) {
    if (!rota.driverId) continue;
    const k = chave(rota.driverId, rota.day);
    const atual = mapa.get(k) ?? { driverId: rota.driverId, driverName: rota.driverName, day: rota.day, stops: [], shifts: [] };
    atual.stops = [...atual.stops, ...rota.stops];
    if (!atual.driverName && rota.driverName) atual.driverName = rota.driverName;
    mapa.set(k, atual);
  }

  for (const jornada of shifts) {
    const dia = dayKey(new Date(jornada.startedAt));
    const k = chave(jornada.driverId, dia);
    const atual = mapa.get(k) ?? { driverId: jornada.driverId, driverName: jornada.driverName, day: dia, stops: [], shifts: [] };
    atual.shifts = [
      ...atual.shifts,
      {
        id: `${jornada.driverId}-${jornada.startedAt}`,
        startedAt: jornada.startedAt,
        endedAt: jornada.endedAt,
        startReason: jornada.startReason,
        endReason: jornada.endReason ?? null,
      },
    ];
    if (!atual.driverName && jornada.driverName) atual.driverName = jornada.driverName;
    mapa.set(k, atual);
  }

  return [...mapa.values()];
}

/** "2026-09-23" no fuso do aparelho. */
export function dayKey(date: Date = new Date()): string {
  const mes = `${date.getMonth() + 1}`.padStart(2, '0');
  const dia = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${mes}-${dia}`;
}

/** Planilha (CSV) do resumo — o gestor abre no Excel/Numbers ou manda por mensagem. */
export function summaryToCsv(summaries: DriverDaySummary[]): string {
  const cabecalho = ['day', 'driver', 'in', 'out', 'total', 'total_minutes', 'manual_shifts'];
  const linhas = summaries.map((s) => [
    s.day,
    s.driverName,
    clockText(s.manualIn ?? s.routeIn) ?? '',
    clockText(s.manualOut ?? s.routeOut) ?? '',
    durationText(s.minutes),
    `${s.minutes}`,
    s.hasManual ? `${s.manualCount}` : '0',
  ]);
  return [cabecalho, ...linhas]
    .map((colunas) => colunas.map((valor) => (/[",;\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor)).join(';'))
    .join('\n');
}

/** Frase que o motorista entende quando o registro falha. */
export function shiftErrorMessage(reason: unknown): string {
  const mensagem = reason instanceof Error ? reason.message : String(reason ?? '');
  if (/duplicate key|driver_shifts_uma_aberta/i.test(mensagem)) return 'You already have a journey open.';
  if (/motivo|reason|check constraint/i.test(mensagem)) return 'Write a short reason (at least 3 letters).';
  if (/network|fetch|timeout|internet/i.test(mensagem)) return 'No connection: saved on your phone and will be sent when you are back online.';
  return mensagem || 'Could not save the journey record.';
}
