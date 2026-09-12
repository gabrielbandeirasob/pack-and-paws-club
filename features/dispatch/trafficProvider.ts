/**
 * Busca os tempos reais de deslocamento na funcao `travel-times` do Supabase (a chave do
 * Google vive no servidor — regra do plano §5.4, o app nunca carrega chave privilegiada).
 *
 * Se a funcao nao estiver implantada, sem chave, sem internet ou passar do tempo limite,
 * devolve `source: 'estimated'` e o app segue com a estimativa de linha reta. O gestor nunca
 * fica esperando: o timeout e curto e o resultado e sempre utilizavel.
 */
import type { OptimizeStop } from '@/features/dispatch/routeOptimizer';
import { parseTravelTimes, type TravelTimes } from '@/features/dispatch/travelMatrix';
import { supabase } from '@/lib/supabase';

export type TrafficSource = 'live' | 'estimated';

export type TrafficResult = {
  travel: TravelTimes | null;
  source: TrafficSource;
  /** Motivo quando caiu na estimativa (vai para o log/relatorio, nao para a tela). */
  reason?: string;
};

export const TRAFFIC_TIMEOUT_MS = 4000;
export const TRAVEL_TIMES_FUNCTION = 'travel-times';

type Ponto = { dogId: string; latitude: number; longitude: number };

function comCoordenada(stop: OptimizeStop): stop is OptimizeStop & Ponto {
  return typeof stop.latitude === 'number' && typeof stop.longitude === 'number';
}

function esperar<T>(promessa: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return new Promise((resolve) => {
    const relogio = setTimeout(() => resolve('timeout'), ms);
    promessa
      .then((valor) => {
        clearTimeout(relogio);
        resolve(valor);
      })
      .catch(() => {
        clearTimeout(relogio);
        resolve('timeout');
      });
  });
}

export async function fetchTravelTimes(
  stops: OptimizeStop[],
  home?: { latitude: number | null; longitude: number | null } | null,
  opcoes: { timeoutMs?: number } = {},
): Promise<TrafficResult> {
  const pontos = stops.filter(comCoordenada);
  if (pontos.length < 2) return { travel: null, source: 'estimated', reason: 'poucas-paradas' };

  const base =
    home && typeof home.latitude === 'number' && typeof home.longitude === 'number'
      ? { latitude: home.latitude, longitude: home.longitude }
      : null;

  try {
    const chamada = supabase.functions.invoke(TRAVEL_TIMES_FUNCTION, {
      body: { home: base, stops: pontos.map(({ dogId, latitude, longitude }) => ({ dogId, latitude, longitude })) },
    });

    const resposta = await esperar(chamada as Promise<{ data: unknown; error: unknown }>, opcoes.timeoutMs ?? TRAFFIC_TIMEOUT_MS);
    if (resposta === 'timeout') return { travel: null, source: 'estimated', reason: 'timeout' };
    if (!resposta || resposta.error) {
      return { travel: null, source: 'estimated', reason: 'funcao-indisponivel' };
    }

    const travel = parseTravelTimes(resposta.data, pontos.map((ponto) => ponto.dogId));
    if (!travel) return { travel: null, source: 'estimated', reason: 'resposta-invalida' };

    return { travel, source: 'live' };
  } catch {
    return { travel: null, source: 'estimated', reason: 'erro-inesperado' };
  }
}
