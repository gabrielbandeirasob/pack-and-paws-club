/**
 * Tempos de deslocamento REAIS (transito) vindos do servidor.
 *
 * Regra do projeto (plano §5.4): o app NUNCA carrega chave privilegiada do Google. Quem fala
 * com as APIs de Rotas e a funcao `travel-times` no Supabase (a chave fica em segredo do
 * servidor). Aqui so entram: o FORMATO da resposta e a traducao para o otimizador — funcoes
 * puras, testaveis, sem rede.
 *
 * Sem resposta valida (funcao nao implantada, sem chave, sem internet, timeout), o app segue
 * com a estimativa de linha reta: o otimizador nunca depende do Google para funcionar.
 */

export type TravelTimes = {
  /** Minutos do ponto de saida (base do motorista) ate a parada. */
  homeTo: (dogId: string) => number | null;
  /** Minutos entre duas paradas. */
  between: (fromDogId: string, toDogId: string) => number | null;
};

export const MAX_MATRIX_SIZE = 27; // 26 paradas + base: limite pratico da API de rotas
export const MAX_PLAUSIBLE_MINUTES = 600; // 10h entre duas paradas = dado invalido
/** Marcador da base do motorista na matriz (nao e uma parada). */
export const BASE_ID = '__base__';

/** Resposta esperada da funcao `travel-times`: { dogIds: string[], durations: number[][] } (segundos). */
export function parseTravelTimes(resposta: unknown, dogIdsEsperados: string[]): TravelTimes | null {
  if (!resposta || typeof resposta !== 'object') return null;

  const bruto = resposta as { dogIds?: unknown; durations?: unknown };
  if (!Array.isArray(bruto.dogIds) || !Array.isArray(bruto.durations)) return null;

  const ids = bruto.dogIds.map((id) => (typeof id === 'string' && id.length > 0 ? id : BASE_ID));
  const linhas = bruto.durations;
  if (ids.length < 2 || linhas.length !== ids.length) return null;
  if (ids.length > MAX_MATRIX_SIZE) return null;

  // a matriz precisa ser quadrada e numerica
  for (const linha of linhas) {
    if (!Array.isArray(linha) || linha.length !== ids.length) return null;
    for (const valor of linha) {
      if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) return null;
    }
  }

  // A base pode vir sem id (o servidor manda a linha/coluna 0 como a saida do motorista).
  // Normalizamos: tudo que nao for id de parada vira BASE_ID, e so os ids de parada sao
  // conferidos contra o que pedimos — senao a base derrubava a matriz inteira.
  const idsNormalizados = ids.map((id) => (id === BASE_ID ? BASE_ID : id));
  const temBase = idsNormalizados.length > dogIdsEsperados.length;
  const idsParadas = temBase ? idsNormalizados.slice(1) : idsNormalizados;

  const conjuntoPedido = new Set(dogIdsEsperados);
  if (idsParadas.length !== dogIdsEsperados.length) return null;
  if (!idsParadas.every((id) => conjuntoPedido.has(id))) return null;

  const indice = new Map(idsNormalizados.map((id, posicao) => [id, posicao]));

  const minutos = (segundos: number): number | null => {
    const valor = segundos / 60;
    return valor < MAX_PLAUSIBLE_MINUTES ? valor : null;
  };

  return {
    homeTo: (dogId) => {
      if (!temBase) return null;
      const destino = indice.get(dogId);
      if (destino === undefined) return null;
      return minutos(linhas[0][destino]);
    },
    between: (fromDogId, toDogId) => {
      const origem = indice.get(fromDogId);
      const destino = indice.get(toDogId);
      if (origem === undefined || destino === undefined) return null;
      return minutos(linhas[origem][destino]);
    },
  };
}

/** Formato que a funcao do servidor devolve na matriz (segundos), util para os testes e docs. */
export function matrixFromMinutes(minutos: number[][]): number[][] {
  return minutos.map((linha) => linha.map((valor) => Math.round(valor * 60)));
}
