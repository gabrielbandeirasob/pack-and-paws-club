import { proximaParadaDoDia } from '@/features/driver/dayOrder';
import { entregue, ordenarParadasDoDia } from '@/features/driver/dayOrder';
import { haversineKm } from '@/features/dispatch/routeOptimizer';

export type EtaPosition = { latitude: number; longitude: number };

export type EtaStop = {
  id: string;
  sequence: number;
  dropoffSequence?: number | null;
  clientName: string;
  dogName: string;
  latitude?: number | null;
  longitude?: number | null;
  windowEnd?: string | null;
  exactTime?: string | null;
  status: string;
  /** Marco de ENTREGA (ISO, carimbado no servidor). Ausente = entrega pendente. */
  deliveredAt?: string | null;
  /**
   * Perna de viagem que CHEGA nesta parada, em segundos, gravada pelo Optimize do gestor com a matriz
   * do Google (migração 041). `travelSeconds` = ordem da BUSCA; `dropoffTravelSeconds` = ordem da ENTREGA.
   * Sem esses dados (rota não otimizada com tráfego) o ETA cai na estimativa de linha reta — como era.
   */
  travelSeconds?: number | null;
  dropoffTravelSeconds?: number | null;
};

export type EtaResult = {
  stopId: string;
  clientName: string;
  dogName: string;
  minutes: number;
  lateMinutes: number; // > 0 when the projected arrival is past the window/deadline
  /**
   * O número tem base REAL? (perna da rota gravada pelo Optimize, ou a posição do motorista)
   *
   * 🪤 ACHADO DA VISTORIA (02/10/2026): sem perna na rota e sem posição o cálculo caía em `minutes = 0`
   * e a faixa do topo dizia **"~0 min away"** — contraditório ("chegando" quando o app não sabe). Agora
   * quem usa pode dizer "route not timed yet" em vez de inventar zero.
   */
  temBase: boolean;
};

const DEFAULT_SPEED_KPH = 25;

/**
 * Os 3 minutos do pedido do cliente (áudios de 30/09/2026), decididos pelo dono.
 *
 * O MESMO número governa DUAS contas, de propósito ("os 3 minutos valem tanto no cálculo da rota
 * quanto na tolerância de atraso"):
 *  1. TOLERÂNCIA DE ATRASO — a parada só aparece como atrasada depois de 3 min do prazo
 *     (`isPastDeadline`, `lateMinutesForStop`, `nextStopEta`, neste módulo): o motorista desce,
 *     toca a campainha e pega o cão sem que o app marque "late" na hora;
 *  2. TEMPO POR PICK-UP na rota — o Optimize do gestor soma 3 min de serviço por parada
 *     (`app/(tabs)/dispatch.tsx`), no lugar do padrão de 8 min.
 * Um número só = uma verdade sobre "3 minutos"; mudar aqui muda os dois lugares.
 */
export const GRACE_MINUTES = 3;

function hhmmToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesBetweenKm(km: number, speedKph = DEFAULT_SPEED_KPH): number {
  return (km / speedKph) * 60;
}

/**
 * Local minutes since midnight for a Date (used to compare against windows).
 * Inclui a fração de segundo: a tolerância de 3 min (GRACE_MINUTES) é conferida no segundo, não
 * arredondada para o minuto — "3 min 01 s depois do prazo" já é atraso.
 */
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

/**
 * True when the current local time is past the stop's deadline (window end or exact time) PLUS the
 * tolerance of GRACE_MINUTES: até 3 minutos depois do prazo a parada NÃO é atrasada (pedido do
 * cliente, 30/09/2026 — "imagina, eu vou descer para pegar um cachorro, vai levar uns dois
 * minutinhos, três minutinhos").
 */
export function isPastDeadline(windowEnd?: string | null, exactTime?: string | null, now: Date = new Date()): boolean {
  const deadline = hhmmToMinutes(exactTime ?? windowEnd);
  if (deadline == null) return false;
  return minutesOfDay(now) > deadline + GRACE_MINUTES;
}

/** Minutes elapsed since an ISO timestamp (never negative). */
export function minutesAgo(isoTimestamp: string, now: Date = new Date()): number {
  const then = new Date(isoTimestamp).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.round((now.getTime() - then) / 60_000));
}

/** Posição do motorista com mais tempo que isto já merece aviso no Dispatch (minutos). */
export const POSICAO_VELHA_MINUTOS = 15;
/** Posição com mais tempo que isto: o ETA deixa de ser mostrado (número velho engana o escritório). */
export const POSICAO_MUITO_VELHA_MINUTOS = 45;

export type FrescorDaPosicao = {
  minutos: number;
  /** Texto pronto: "just now" · "8 min ago" · "1 h 12 min ago". */
  texto: string;
  /** Passou de POSICAO_VELHA_MINUTOS: vale avisar que está ficando velha. */
  velha: boolean;
  /** Passou de POSICAO_MUITO_VELHA_MINUTOS: não mostrar ETA como se fosse agora. */
  muitoVelha: boolean;
};

/**
 * Idade da última posição publicada pelo motorista, pronta para a tela.
 *
 * Motivo (melhoria 3 da revisão das contas, 25/09/2026): o Dispatch escrevia sempre "📍 N min ago" — com
 * 4 horas de silêncio aparecia "240 min ago" e o ETA continuava sendo calculado e mostrado como se a
 * posição fosse de agora. Aqui a idade vem legível E com o aviso de que está velha; quem decide esconder o
 * ETA é a tela (ver DispatchBoard).
 */
export function frescorDaPosicao(isoTimestamp: string, agora: Date = new Date()): FrescorDaPosicao {
  // Sem data confiável não se afirma idade NEM se mostra ETA: "time unknown" e tratada como velha.
  if (Number.isNaN(new Date(isoTimestamp).getTime())) {
    return { minutos: 0, texto: 'time unknown', velha: true, muitoVelha: true };
  }
  const minutos = minutesAgo(isoTimestamp, agora);
  const texto = minutos < 1
    ? 'just now'
    : minutos < 60
      ? `${minutos} min ago`
      : `${Math.floor(minutos / 60)} h ${minutos % 60} min ago`;
  return {
    minutos,
    texto,
    velha: minutos > POSICAO_VELHA_MINUTOS,
    muitoVelha: minutos > POSICAO_MUITO_VELHA_MINUTOS,
  };
}

/** Acima disso o ETA do motorista não ajuda ninguém: vira "~23324 min away" (16 dias!) quando o
 *  aparelho está longe das paradas (ex.: demo no Brasil com clientes nos EUA). Defeito visto no
 *  print do dono em 25/09/2026 — acima de 4 h a tela passa a dizer que está longe, sem inventar número. */
export const ETA_MAXIMO_PLAUSIVEL_MIN = 240;

/**
 * Minutos de atraso que a tela mostra, com a tolerância de GRACE_MINUTES:
 *  - dentro da tolerância (até 3 min depois do prazo) = 0 (o app não marca atrasado na hora);
 *  - passada a tolerância = o atraso REAL, arredondado (nada de maquiar o quanto passou do prazo).
 */
function minutosDeAtraso(projected: number, deadline: number | null): number {
  if (deadline == null) return 0;
  const atraso = projected - deadline;
  return atraso > GRACE_MINUTES ? Math.round(atraso) : 0;
}

/**
 * Atraso projetado para UMA parada: quanto a chegada passaria da janela/horário exato.
 * Mesma conta do banner da próxima parada, usada no botão "avisar o tutor" (âmbar quando atrasa).
 */
export function lateMinutesForStop(
  stop: { exactTime?: string | null; windowEnd?: string | null },
  minutes: number,
  now: Date = new Date(),
): number {
  const deadline = hhmmToMinutes(stop.exactTime ?? stop.windowEnd);
  if (deadline == null) return 0;
  return minutosDeAtraso(minutesOfDay(now) + Math.max(0, minutes), deadline);
}

/**
 * Minutos até UMA parada (mesma conta do ETA da próxima parada). Usado no botão "avisar o tutor"
 * de qualquer parada, não só da próxima: o motorista avisa a entrega depois de embarcar.
 */
export function minutesToStop(
  position: EtaPosition | null,
  stop: { latitude?: number | null; longitude?: number | null },
  speedKph = DEFAULT_SPEED_KPH,
): number | null {
  if (!position || stop.latitude == null || stop.longitude == null) return null;
  return Math.round(minutesBetweenKm(haversineKm(position.latitude, position.longitude, stop.latitude, stop.longitude), speedKph));
}

/** Fase da trilha usada para escolher a perna gravada pelo Optimize. */
type FaseDaRota = 'pickup' | 'dropoff';

const esperaBusca = (stop: { status: string }) => stop.status === 'pending' || stop.status === 'arrived';

const pendenteDeEntrega = (stop: EtaStop) =>
  !entregue(stop) && (stop.status === 'picked_up' || stop.status === 'completed');

/** A fase do dia: enquanto alguma parada espera busca, é a busca; quando as buscas acabam, a entrega. */
function faseDaTrilha(ordenadas: readonly EtaStop[]): FaseDaRota {
  return ordenadas.some(esperaBusca) ? 'pickup' : 'dropoff';
}

/** Índice da primeira parada que a fase ainda precisa atender (`-1` = não falta nada nesta fase). */
function inicioDaFase(ordenadas: readonly EtaStop[], fase: FaseDaRota): number {
  return ordenadas.findIndex((stop) => (fase === 'pickup' ? esperaBusca(stop) : pendenteDeEntrega(stop)));
}

/** Perna (em minutos) que chega nesta parada, na ordem da fase. `null` = sem dado confiável. */
function pernaDaParada(stop: EtaStop, fase: FaseDaRota): number | null {
  const segundos = fase === 'dropoff' ? stop.dropoffTravelSeconds : stop.travelSeconds;
  if (typeof segundos !== 'number' || !Number.isFinite(segundos) || segundos <= 0) return null;
  return segundos / 60;
}

/** Um ponto no mapa: aceita tanto a posição do motorista quanto uma parada. */
type Ponto = { latitude?: number | null; longitude?: number | null };

/**
 * ACUMULA, na ORDEM DA ROTA, o tempo até a parada `alvoId`:
 *   perna(inicio) + serviço + perna(inicio+1) + … + perna(alvo)
 * O serviço (GRACE_MINUTES) entra nas paradas INTERMEDIÁRIAS — o MESMO número que o Optimize usa e que
 * vale como tolerância de atraso. `pernaEm` decide de onde sai cada perna (rota gravada ou estimativa).
 * `null` quando alguma perna é desconhecida: nunca inventa zero.
 *
 * É o ÚNICO caminho do ETA por parada, de propósito: tela e aviso ao tutor têm de mostrar o mesmo
 * número, e a conta é monotônica na ordem (a parada j nunca fica antes da i < j).
 */
function acumularAteAlvo(
  stops: EtaStop[],
  alvoId: string,
  pernaEm: (ordenadas: EtaStop[], indice: number, inicio: number, fase: FaseDaRota) => number | null,
  servicoMin = GRACE_MINUTES,
): number | null {
  const ordenadas = ordenarParadasDoDia(stops);
  const fase = faseDaTrilha(ordenadas);
  const alvo = ordenadas.findIndex((stop) => stop.id === alvoId);
  if (alvo < 0) return null;
  const inicio = inicioDaFase(ordenadas, fase);
  if (inicio < 0 || alvo < inicio) return null;

  let minutos = 0;
  for (let i = inicio; i <= alvo; i += 1) {
    const perna = pernaEm(ordenadas, i, inicio, fase);
    if (perna == null) return null;
    minutos += perna;
    // Parada intermediária ainda custa o serviço (o MESMO número do Optimize e da tolerância).
    if (i < alvo) minutos += servicoMin;
  }
  return Math.round(minutos);
}

/**
 * ETA POR ROTA (cliente, áudios de 01/10/2026): *"o tempo do driver até chegar ao cliente está contando
 * errado… as mensagens não estão contando a rota, e sim a posição do motorista"*.
 *
 * Aqui a conta SEGUE A TRILHA: soma as pernas que o Optimize gravou (`route_stops.travel_seconds` na
 * ordem da busca, `dropoff_travel_seconds` na ordem da entrega) da primeira parada que ainda falta até
 * a parada alvo, mais o tempo de serviço de cada parada intermediária. Não chama a API paga de novo:
 * a matriz já foi paga uma vez, no Optimize do gestor.
 *
 * Devolve `null` quando a trilha não tem AS pernas (rota nunca otimizada com tráfego) — quem chama cai
 * na estimativa acumulada da posição (ver `minutosAteParadaAcumulada`), nunca em zero.
 */
export function minutosAteParadaPorRota(
  stops: EtaStop[],
  alvoId: string,
  opcoes: { servicoMin?: number } = {},
): number | null {
  return acumularAteAlvo(
    stops,
    alvoId,
    (ordenadas, indice, _inicio, fase) => pernaDaParada(ordenadas[indice], fase),
    opcoes.servicoMin,
  );
}

/**
 * Perna estimada (linha reta ÷ velocidade padrão) até a parada `indice`, usada SÓ quando a rota não
 * gravou aquela perna:
 *  - a PRIMEIRA parada da fase é medida DA POSIÇÃO ATUAL do motorista;
 *  - as seguintes são medidas da parada ANTERIOR na ordem da rota.
 *
 * Nunca mede as paradas seguintes DE NOVO a partir da posição — era exatamente esse o defeito relatado
 * pelo dono em 02/10/2026: sem rota gravada a 3ª parada aparecia ANTES da 2ª porque cada uma era medida
 * da posição atual, e não ao longo da rota. `null` = falta coordenada; não se inventa perna.
 */
function pernaEstimada(
  ordenadas: EtaStop[],
  indice: number,
  inicio: number,
  position: EtaPosition | null,
  speedKph: number,
): number | null {
  const destino = ordenadas[indice];
  if (destino.latitude == null || destino.longitude == null) return null;
  const origem: Ponto | null | undefined = indice === inicio ? position : ordenadas[indice - 1];
  if (!origem || origem.latitude == null || origem.longitude == null) return null;
  return minutesBetweenKm(haversineKm(origem.latitude, origem.longitude, destino.latitude, destino.longitude), speedKph);
}

/**
 * Tempo até a parada somando a ROTA INTEIRA na ordem da fase: a perna gravada pelo Optimize quando ela
 * existe e, quando não existe, a linha reta da posição atual até a 1ª parada da fase e dali parada a
 * parada — mais o atendimento das paradas anteriores. É o cálculo que a tela do motorista e o aviso ao
 * tutor compartilham, e o que garante ETA CRONOLÓGICO.
 */
export function minutosAteParadaAcumulada(
  stops: EtaStop[],
  alvoId: string,
  position: EtaPosition | null,
  speedKph = DEFAULT_SPEED_KPH,
): number | null {
  return acumularAteAlvo(stops, alvoId, (ordenadas, indice, inicio, fase) =>
    pernaDaParada(ordenadas[indice], fase) ?? pernaEstimada(ordenadas, indice, inicio, position, speedKph));
}

/**
 * Minutos até uma parada: SEMPRE a conta ACUMULADA na ordem da rota (a ROTA manda; sem os dados da rota,
 * a linha reta entra perna a perna, a partir da posição na primeira e da parada anterior nas demais).
 *
 * 🪤 DEFEITO DO DONO (02/10/2026): até aqui, sem as pernas gravadas, este número era a linha reta da
 * POSIÇÃO ATUAL até a parada alvo — cada parada medida isoladamente. A 3ª parada podia aparecer antes da
 * 2ª (8:06 / 8:10 / 8:04 no áudio dele). Agora o ETA de uma parada é >= o de todas as anteriores.
 */
export function minutosAteParada(
  stops: EtaStop[],
  alvoId: string,
  position: EtaPosition | null,
  speedKph = DEFAULT_SPEED_KPH,
): number | null {
  return minutosAteParadaAcumulada(stops, alvoId, position, speedKph);
}

/**
 * ETA for the next pending stop from the driver's current position.
 * Also reports how many minutes past its window/deadline the arrival would be.
 *
 * Usa o MESMO cálculo acumulado por parada (`minutosAteParadaAcumulada`): a próxima parada é a primeira
 * da fase, então o número já é o dela. Sem trilha gravada e sem posição não há base (`temBase: false`,
 * `minutes: 0`) — a tela escreve "route not timed yet" em vez de inventar zero como se fosse chegada.
 */
export function nextStopEta(stops: EtaStop[], position: EtaPosition | null, now: Date = new Date(), speedKph = DEFAULT_SPEED_KPH): EtaResult | null {
  const next = proximaParadaDoDia(stops);
  if (!next) return null;

  const daRota = minutosAteParadaAcumulada(stops, next.id, position, speedKph);
  const minutes = daRota ?? 0;

  const deadline = hhmmToMinutes(next.exactTime ?? next.windowEnd);
  const projected = minutesOfDay(now) + minutes;
  const lateMinutes = minutosDeAtraso(projected, deadline);

  return {
    stopId: next.id,
    clientName: next.clientName,
    dogName: next.dogName,
    minutes: Math.round(minutes),
    lateMinutes,
    temBase: daRota != null,
  };
}
