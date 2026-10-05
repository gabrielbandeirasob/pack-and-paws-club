/**
 * Rótulo do "quanto falta" da próxima parada, na Home (dono, 05/10/2026).
 *
 * Dois defeitos no cartão do dia: (a) `~23306 min` — a estimativa em linha reta a partir de uma
 * posição LONGE (ou velha) produz número absurdo; (b) `80 min` em vez de `1 hr 20 min`.
 *
 * Regra PURA: ou devolve um rótulo legível, ou `null` — e aí a Home cai na hora exata / janela da
 * parada. O limite de plausibilidade é o MESMO do app do motorista e do Dispatch
 * (`ETA_MAXIMO_PLAUSIVEL_MIN`): número inventado é pior que nenhum.
 */
import { ETA_MAXIMO_PLAUSIVEL_MIN } from '@/features/driver/eta';

/** `12 min` · `1 hr 20 min` · `2 hr 5 min` · `2 hr`. `null` quando o número não é utilizável. */
export function rotuloDeEtaMinutos(minutos: number | null | undefined): string | null {
  if (typeof minutos !== 'number' || !Number.isFinite(minutos) || minutos < 0) return null;
  if (minutos > ETA_MAXIMO_PLAUSIVEL_MIN) return null;
  const total = Math.round(minutos);
  if (total < 60) return `${total} min`;
  const horas = Math.floor(total / 60);
  const resto = total % 60;
  return resto === 0 ? `${horas} hr` : `${horas} hr ${resto} min`;
}
