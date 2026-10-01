import { proximaParadaDoDia } from '@/features/driver/dayOrder';
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
};

export type EtaResult = {
  stopId: string;
  clientName: string;
  dogName: string;
  minutes: number;
  lateMinutes: number; // > 0 when the projected arrival is past the window/deadline
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

/**
 * ETA for the next pending stop from the driver's current position.
 * Also reports how many minutes past its window/deadline the arrival would be.
 */
export function nextStopEta(stops: EtaStop[], position: EtaPosition | null, now: Date = new Date(), speedKph = DEFAULT_SPEED_KPH): EtaResult | null {
  const next = proximaParadaDoDia(stops);
  if (!next) return null;

  const minutes =
    position && next.latitude != null && next.longitude != null
      ? minutesBetweenKm(haversineKm(position.latitude, position.longitude, next.latitude, next.longitude), speedKph)
      : 0;

  const deadline = hhmmToMinutes(next.exactTime ?? next.windowEnd);
  const projected = minutesOfDay(now) + minutes;
  const lateMinutes = minutosDeAtraso(projected, deadline);

  return {
    stopId: next.id,
    clientName: next.clientName,
    dogName: next.dogName,
    minutes: Math.round(minutes),
    lateMinutes,
  };
}
