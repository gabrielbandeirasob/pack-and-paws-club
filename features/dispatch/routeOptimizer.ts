// Route optimizer: window/priority aware ordering with feasibility detection.
// Pure module — no I/O, fully unit-testable. Tempos reais de transito entram por
// `options.travel` (ver travelMatrix.ts); sem eles, cai na linha reta + velocidade media.

import type { TravelTimes } from '@/features/dispatch/travelMatrix';

export type OptimizeStop = {
  dogId: string;
  clientName: string;
  dogName: string;
  latitude: number | null;
  longitude: number | null;
  windowStart: string | null; // 'HH:MM'
  windowEnd: string | null;
  exactTime: string | null; // 'HH:MM' — must be reached by this time
  priority: 'normal' | 'priority';
  serviceMinutes?: number;
};

export type OptimizedStop = OptimizeStop & {
  sequence: number;
  plannedArrival: string | null; // 'HH:MM' local
  waitsMinutes: number;
};

export type OptimizeResult = {
  stops: OptimizedStop[];
  feasible: boolean;
  reason: string | null;
};

export type OptimizeOptions = {
  startAtMinutes?: number; // departure from base (default 08:00)
  speedKph?: number; // average urban speed (default 25)
  serviceMinutes?: number; // default service time per stop (default 8)
  homeLatitude?: number | null; // driver origin; travel to the first stop counts from here
  homeLongitude?: number | null;
  /**
   * DE ONDE A ENTREGA COMEÇA — pedido do CLIENTE (02/10/2026): *"Posição do driver inicia rota dos drop
   * offs"*. Na prática ele começa a entregar vindo do YARD (é onde os cães passam o dia), então a
   * primeira perna da entrega conta daqui; sem esta origem, ela conta da base (a van), que estava errada.
   */
  dropoffLatitude?: number | null;
  dropoffLongitude?: number | null;
  /**
   * DESTINO FIXO da perna — onde a rota TERMINA (regra de negócio do dono, 05/10/2026):
   * **PICK-UP SEMPRE TERMINA NO YARD** e **ENTREGA SEMPRE TERMINA NA VAN**.
   *
   * Van e Yard são PONTAS FIXAS: nunca entram no meio da rota e nunca são reordenados — o otimizador
   * mexe SÓ nas paradas de cliente que ficam entre as duas pontas. O destino entra na CONTA (última
   * perna) e é isso que faz o otimizador escolher bem QUEM fica por último: sem ele, a última parada
   * podia ser a mais longe da yard (o motorista terminava longe de onde tem de fechar o dia).
   *
   * Sem coordenada (organização sem yard cadastrado, por exemplo) a última perna não entra na conta e
   * nada mais muda — o app nunca inventa um ponto.
   */
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  /** Tempos reais (Google, via servidor). Ausente/incompleto = estimativa por linha reta. */
  travel?: TravelTimes | null;
};

const DEFAULT_START = 8 * 60;
const DEFAULT_SPEED_KPH = 25;
const DEFAULT_SERVICE_MIN = 8;

export function hhmmToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesToHHMM(minutes: number): string {
  const clamped = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/** Great-circle distance in kilometers (haversine). */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(s));
}

function travelMinutesBetween(a: OptimizeStop, b: OptimizeStop, options: OptimizeOptions): number {
  const real = options.travel?.between(a.dogId, b.dogId);
  if (typeof real === 'number' && Number.isFinite(real)) return real;
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) return 0;
  const km = haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);
  return (km / (options.speedKph ?? DEFAULT_SPEED_KPH)) * 60;
}

/** A origem de uma sequência: a base (van) ou, na ENTREGA, de onde o motorista está saindo (o yard). */
type Origem = { latitude: number | null | undefined; longitude: number | null | undefined };

/** O DESTINO fixo da perna (pick-up: yard; entrega: van) — só quando tem coordenada utilizável. */
function destinoDe(options: OptimizeOptions): { latitude: number; longitude: number } | null {
  const { destinationLatitude: lat, destinationLongitude: lon } = options;
  const ok = (valor: unknown): valor is number => typeof valor === 'number' && Number.isFinite(valor);
  if (!ok(lat) || !ok(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
  return { latitude: lat, longitude: lon };
}

/**
 * Minutos da ÚLTIMA perna — da última parada até o destino fixo (yard no pick-up, van na entrega).
 *
 * Linha reta de propósito: a matriz real do servidor tem UMA base só (a van, `homeTo`) e nada sobre o
 * destino, então usar a matriz aqui misturaria fontes. É a mesma conta que o resto do fallback usa.
 */
function travelMinutesToDestination(ultima: OptimizeStop | undefined, options: OptimizeOptions): number {
  if (!ultima) return 0;
  const destino = destinoDe(options);
  if (!destino) return 0;
  if (ultima.latitude == null || ultima.longitude == null) return 0;
  const km = haversineKm(ultima.latitude, ultima.longitude, destino.latitude, destino.longitude);
  return (km / (options.speedKph ?? DEFAULT_SPEED_KPH)) * 60;
}

function travelMinutesFromHome(stop: OptimizeStop, options: OptimizeOptions, origem?: Origem | null): number {
  const temOrigemPropria = Boolean(origem && origem.latitude != null && origem.longitude != null);
  // A matriz real tem UMA base (a van): só vale quando a origem pedida é a própria base.
  if (!temOrigemPropria) {
    const real = options.travel?.homeTo(stop.dogId);
    if (typeof real === 'number' && Number.isFinite(real)) return real;
  }
  if (stop.latitude == null || stop.longitude == null) return 0;
  const lat = temOrigemPropria ? origem!.latitude! : options.homeLatitude;
  const lon = temOrigemPropria ? origem!.longitude! : options.homeLongitude;
  if (lat == null || lon == null) return 0;
  const km = haversineKm(lat, lon, stop.latitude, stop.longitude);
  return (km / (options.speedKph ?? DEFAULT_SPEED_KPH)) * 60;
}

/**
 * Minutos de DESLOCAMENTO + SERVIÇO de uma ordem JÁ definida, com as MESMAS contas do otimizador.
 *
 * Existe para o gestor CONFERIR o que o Optimize fez (dúvida do dono, 01/10/2026: *"cliquei em otimizar e
 * fez algumas mudanças, só não consigo confirmar se está realmente fazendo a melhor rota"*): com o número
 * das duas ordens ele lê "Pick-up: 52 min → 41 min (-11)" em vez de confiar na palavra do app.
 *
 * Devolve null quando falta dado para a conta (id desconhecido ou parada sem coordenada e sem matriz
 * real) — número inventado seria pior do que nenhum número.
 */
export function minutosDaOrdem(
  stops: OptimizeStop[],
  ordemDeIds: string[],
  options: OptimizeOptions = {},
  /** De onde esta sequência SAI (na entrega: de onde o motorista está — o yard). */
  origem?: Origem | null,
): number | null {
  const porId = new Map(stops.map((stop) => [stop.dogId, stop]));
  const ids = ordemDeIds.filter((id) => porId.has(id));
  if (ids.length === 0) return null;

  let total = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const parada = porId.get(ids[i]) as OptimizeStop;
    const anterior = i === 0 ? null : (porId.get(ids[i - 1]) as OptimizeStop);
    if (parada.latitude == null || parada.longitude == null) {
      // Sem coordenada a estimativa de linha reta não existe; só a matriz real cobre essa perna.
      const temOrigemPropria = Boolean(origem && origem.latitude != null && origem.longitude != null);
      const real = anterior
        ? options.travel?.between(anterior.dogId, parada.dogId)
        : (temOrigemPropria ? null : options.travel?.homeTo(parada.dogId));
      if (typeof real !== 'number' || !Number.isFinite(real)) return null;
      total += real + serviceOf(parada, options);
      continue;
    }
    total += (anterior ? travelMinutesBetween(anterior, parada, options) : travelMinutesFromHome(parada, options, origem))
      + serviceOf(parada, options);
  }
  /**
   * A ÚLTIMA perna conta: quem fecha a rota é o destino fixo (yard no pick-up, van na entrega) — sem
   * ela o número do gestor seria o da rota que não termina em lugar nenhum.
   */
  return total + travelMinutesToDestination(porId.get(ids[ids.length - 1]), options);
}

/**
 * QUILÔMETROS de uma ordem JÁ definida — a distância que o cartão do Optimize mostra como
 * *"4.2 mi saved"*. Linha reta (mesma base do fallback de tempo do otimizador).
 *
 * Devolve `null` quando falta coordenada em qualquer parada ou ponta: número inventado seria pior do
 * que nenhum número (a mesma regra de `minutosDaOrdem`).
 */
export function quilometrosDaOrdem(
  stops: OptimizeStop[],
  ordemDeIds: string[],
  origem?: Origem | null,
  destino?: Origem | null,
): number | null {
  const porId = new Map(stops.map((stop) => [stop.dogId, stop]));
  const ids = ordemDeIds.filter((id) => porId.has(id));
  if (ids.length === 0) return null;
  const ponto = (valor: { latitude?: number | null; longitude?: number | null } | null | undefined) =>
    valor && typeof valor.latitude === 'number' && typeof valor.longitude === 'number'
      && Number.isFinite(valor.latitude) && Number.isFinite(valor.longitude)
      ? { latitude: valor.latitude, longitude: valor.longitude }
      : null;

  let total = 0;
  let anterior = ponto(origem);
  for (const id of ids) {
    const parada = porId.get(id) as OptimizeStop;
    if (parada.latitude == null || parada.longitude == null) return null;
    const atual = { latitude: parada.latitude, longitude: parada.longitude };
    if (anterior) total += haversineKm(anterior.latitude, anterior.longitude, atual.latitude, atual.longitude);
    anterior = atual;
  }
  const fim = ponto(destino);
  if (fim && anterior) total += haversineKm(anterior.latitude, anterior.longitude, fim.latitude, fim.longitude);
  return total;
}

/**
 * FUZZING (auditoria de 02/10/2026) — o ganancioso sozinho às vezes piora a rota.
 *
 * Sorteando 400 rotas, em ~3% delas a ordem "otimizada" ficava PIOR que a ordem que já estava na tela
 * (ex.: 154 min -> 170 min). O vizinho mais próximo erra porque decide a ÚLTIMA perna tarde: deixa o
 * cão mais longe por último e chega nele vindo de um lugar ruim.
 *
 * Duas correções aqui:
 *  1. `doisOpt` — troca trechos enquanto isso ENCURTA a viagem (é o conserto clássico do ganancioso);
 *  2. se mesmo assim o resultado não for melhor que a ordem que já estava lá, a ordem ORIGINAL é mantida
 *     — o Optimize NUNCA propõe uma rota pior do que a que o gestor já tinha.
 *
 * As duas só valem quando NÃO há janela/horário marcado: com janela quem manda é o prazo, e a comparação
 * por distância não diz nada (q presta).
 */
function totalDaOrdem(ordem: OptimizeStop[], options: OptimizeOptions, origem: Origem | null): number {
  return minutosDaOrdem(ordem, ordem.map((parada) => parada.dogId), options, origem) ?? Number.POSITIVE_INFINITY;
}

function doisOpt(ordem: OptimizeStop[], options: OptimizeOptions, origem: Origem | null): OptimizeStop[] {
  let melhor = [...ordem];
  let melhorTotal = totalDaOrdem(melhor, options, origem);
  let melhorou = true;
  let voltas = 0;
  while (melhorou && voltas < 25) {
    melhorou = false;
    voltas += 1;
    for (let i = 0; i < melhor.length - 1; i += 1) {
      for (let j = i + 1; j < melhor.length; j += 1) {
        const tentativa = [...melhor];
        const trecho = tentativa.slice(i, j + 1).reverse();
        tentativa.splice(i, trecho.length, ...trecho);
        const total = totalDaOrdem(tentativa, options, origem);
        if (total < melhorTotal - 1e-9) {
          melhor = tentativa;
          melhorTotal = total;
          melhorou = true;
        }
      }
    }
  }
  return melhor;
}

/** O que a tela mostra: a ordem final com a hora prevista de cada parada (mesma conta do ganancioso). */
function materializar(ordem: OptimizeStop[], options: OptimizeOptions, origem: Origem | null): OptimizedStop[] {
  let agora = options.startAtMinutes ?? DEFAULT_START;
  return ordem.map((parada, indice) => {
    const anterior = indice === 0 ? null : ordem[indice - 1];
    const travel = anterior
      ? travelMinutesBetween(anterior, parada, options)
      : travelMinutesFromHome(parada, options, origem);
    const inicio = windowStartOf(parada);
    const bruto = agora + travel;
    const espera = inicio != null && bruto < inicio ? inicio - bruto : 0;
    const chegada = inicio != null ? Math.max(bruto, inicio) : bruto;
    agora = chegada + serviceOf(parada, options);
    return { ...parada, sequence: indice + 1, plannedArrival: minutesToHHMM(chegada), waitsMinutes: espera };
  });
}

function serviceOf(stop: OptimizeStop, options: OptimizeOptions): number {
  return stop.serviceMinutes ?? options.serviceMinutes ?? DEFAULT_SERVICE_MIN;
}

/** Latest minute by which the stop must be reached (window end or exact time). */
function deadlineOf(stop: OptimizeStop): number | null {
  const exact = hhmmToMinutes(stop.exactTime);
  if (exact != null) return exact;
  return hhmmToMinutes(stop.windowEnd);
}

/** Earliest minute at which service may start (window start; exact time has no wait). */
function windowStartOf(stop: OptimizeStop): number | null {
  return hhmmToMinutes(stop.windowStart);
}

export function optimizeRoute(
  stops: OptimizeStop[],
  options: OptimizeOptions = {},
  /** Na ENTREGA o cliente pediu que a rota comece da POSIÇÃO do motorista (na prática, o yard). */
  origem?: Origem | null,
): OptimizeResult {
  const missing = stops.filter((stop) => stop.latitude == null || stop.longitude == null).map((stop) => stop.dogName);
  if (missing.length > 0) {
    return {
      stops: [],
      feasible: false,
      reason: `Missing coordinates for: ${missing.join(', ')}. Add an address to these clients first.`,
    };
  }
  if (stops.length <= 1) {
    return {
      stops: stops.map((stop, index) => ({ ...stop, sequence: index + 1, plannedArrival: null, waitsMinutes: 0 })),
      feasible: true,
      reason: null,
    };
  }

  const pending = [...stops];
  const ordered: OptimizedStop[] = [];
  let now = options.startAtMinutes ?? DEFAULT_START;

  while (pending.length > 0) {
    const previous = ordered[ordered.length - 1] ?? null;
    let bestIndex = -1;
    let bestArrival = 0;
    let bestWaits = 0;
    let bestKey: number | null = null;

    const withDeadline = pending.filter((candidate) => deadlineOf(candidate) != null);

    // Windows dominate: while any pending stop has a window, only windowed stops are candidates.
    const candidates = withDeadline.length > 0 ? withDeadline : pending;

    for (let index = 0; index < pending.length; index += 1) {
      const candidate = pending[index];
      if (!candidates.includes(candidate)) continue;
      const travel = previous ? travelMinutesBetween(previous, candidate, options) : travelMinutesFromHome(candidate, options, origem);
      const rawArrival = now + travel;
      const windowStart = windowStartOf(candidate);
      const deadline = deadlineOf(candidate);
      const waits = windowStart != null && rawArrival < windowStart ? windowStart - rawArrival : 0;
      const arrival = windowStart != null ? Math.max(rawArrival, windowStart) : rawArrival;

      if (deadline != null && arrival > deadline) continue; // cannot honor this stop's window from here

      // Multi-criteria key: deadline first (windowed stops only), then priority, then distance.
      const deadlineKey = deadline ?? 0;
      const key = deadlineKey * 1_000_000 + (candidate.priority === 'priority' ? 0 : 1000) + travel;
      if (bestKey === null || key < bestKey) {
        bestKey = key;
        bestIndex = index;
        bestArrival = arrival;
        bestWaits = waits;
      }
    }

    if (bestIndex < 0) {
      const firstWindowed = withDeadline[0];
      const target = firstWindowed ?? pending[0];
      return {
        stops: [],
        feasible: false,
        reason: `Infeasible schedule: cannot reach "${target.dogName}" (${target.clientName}) within its time window after the previous stops.`,
      };
    }

    const [chosen] = pending.splice(bestIndex, 1);
    ordered.push({ ...chosen, sequence: ordered.length + 1, plannedArrival: minutesToHHMM(bestArrival), waitsMinutes: bestWaits });
    now = bestArrival + serviceOf(chosen, options);
  }

  // Sem janela/horário marcado: 2-opt + só aceita se ficar MELHOR que a ordem que já estava lá.
  const temJanela = stops.some((parada) => deadlineOf(parada) != null || windowStartOf(parada) != null);
  // 🪤 Regressão pega pelos testes: o 2-opt compara por DISTÂNCIA e passava por cima da regra de
  // "cão PRIORITÁRIO vai primeiro" (pedido do dono). Com prioridade em jogo, fica o ganancioso como
  // sempre foi — a garantia de "nunca pior que a tela" vale para rota sem janela e sem prioridade.
  const temPrioridade = stops.some((parada) => parada.priority === 'priority');
  if (!temJanela && !temPrioridade) {
    // 2-opt a partir das DUAS ordens candidatas (a gananciosa e a que já estava na tela) e fica com a
    // melhor: nunca piora a rota do gestor e, na prática, chega na melhor das duas.
    const doGanancioso = doisOpt(ordered, options, origem ?? null);
    const daOriginal = doisOpt(stops, options, origem ?? null);
    const escolhida = totalDaOrdem(daOriginal, options, origem ?? null)
      <= totalDaOrdem(doGanancioso, options, origem ?? null)
      ? daOriginal
      : doGanancioso;
    return { stops: materializar(escolhida, options, origem ?? null), feasible: true, reason: null };
  }

  return { stops: ordered, feasible: true, reason: null };
}
