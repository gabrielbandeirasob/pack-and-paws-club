/**
 * Endereco -> coordenada, pelo servidor (funcao `geocode` do Supabase).
 *
 * Mesma regra do `travel-times`: o app NUNCA carrega chave privilegiada do Google. Aqui vive
 * so o FORMATO da resposta, a traducao para o app e o comportamento quando o servidor nao
 * responde — funcoes puras, testaveis, sem rede.
 *
 * Por que isso importa na operacao: a rota do Pack & Paws depende de coordenada para montar o
 * mapa e para pedir os tempos de transito. Cliente salvo com endereco e sem coordenada ficava
 * fora dos dois. Sem resposta valida, o app segue exatamente como antes (endereco sem pino) e
 * a navegacao por endereco continua funcionando.
 */
import { supabase } from '@/lib/supabase';

export const GEOCODE_FUNCTION = 'geocode';
export const GEOCODE_TIMEOUT_MS = 5000;
/** Limite da funcao no servidor (uma chamada, um lote). */
export const MAX_PLACES_POR_CHAMADA = 25;

export type GeocodePrecision = 'rooftop' | 'street' | 'approximate';

/** O que o app manda para o servidor. */
export type GeocodePlace = {
  id: string;
  addressLine1: string;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

export type GeocodePoint = {
  id: string;
  latitude: number;
  longitude: number;
  formattedAddress: string | null;
  precision: GeocodePrecision;
};

export type GeocodeOutcome = {
  points: GeocodePoint[];
  /** 'live' = o servidor respondeu; 'unavailable' = sem funcao/chave/internet/timeout. */
  source: 'live' | 'unavailable';
  /** Motivo quando nao veio do servidor (log/relatorio, nunca na tela). */
  reason?: string;
};

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

function coordenadaValida(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= LAT_MIN &&
    latitude <= LAT_MAX &&
    longitude >= LNG_MIN &&
    longitude <= LNG_MAX &&
    // (0, 0) e "Null Island": endereco nao geocodificado que o Google devolve as vezes.
    !(latitude === 0 && longitude === 0)
  );
}

function precisaoValida(valor: unknown): GeocodePrecision {
  return valor === 'rooftop' || valor === 'street' || valor === 'approximate' ? valor : 'approximate';
}

/**
 * Le a resposta da funcao `geocode` e devolve so o que e confiavel.
 * Ponto fora de faixa, id que nao foi pedido ou resposta torta sao DESCARTADOS (nunca
 * chutamos coordenada: pino errado manda o motorista para o lugar errado).
 */
export function parseGeocode(resposta: unknown, idsEsperados: string[]): GeocodePoint[] | null {
  if (!resposta || typeof resposta !== 'object') return null;

  const bruto = resposta as { results?: unknown };
  if (!Array.isArray(bruto.results)) return null;

  const pedidos = new Set(idsEsperados);
  const pontos: GeocodePoint[] = [];
  const vistos = new Set<string>();

  for (const item of bruto.results) {
    if (!item || typeof item !== 'object') continue;
    const linha = item as Record<string, unknown>;
    const id = typeof linha.id === 'string' ? linha.id : null;
    if (!id || !pedidos.has(id) || vistos.has(id)) continue;
    if (!coordenadaValida(linha.latitude, linha.longitude)) continue;

    vistos.add(id);
    pontos.push({
      id,
      latitude: linha.latitude as number,
      longitude: linha.longitude as number,
      formattedAddress: typeof linha.formattedAddress === 'string' && linha.formattedAddress.length > 0 ? linha.formattedAddress : null,
      precision: precisaoValida(linha.precision),
    });
  }

  return pontos;
}

/** Um minuto de espera e demais: o gestor nao pode ficar parado por causa de um pino. */
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

/** Resolve enderecos em coordenadas. Nunca lanca: sem servidor, devolve 'unavailable'. */
export async function fetchCoordinates(
  places: GeocodePlace[],
  opcoes: { timeoutMs?: number } = {},
): Promise<GeocodeOutcome> {
  const validos = places.filter((place) => typeof place?.id === 'string' && typeof place?.addressLine1 === 'string' && place.addressLine1.trim().length > 0);
  if (validos.length === 0) return { points: [], source: 'unavailable', reason: 'sem-enderecos' };

  try {
    const chamada = supabase.functions.invoke(GEOCODE_FUNCTION, {
      body: { places: validos.map(({ id, addressLine1, addressLine2, city, state, postalCode, country }) => ({ id, addressLine1, addressLine2, city, state, postalCode, country })) },
    });

    const resposta = await esperar(chamada as Promise<{ data: unknown; error: unknown }>, opcoes.timeoutMs ?? GEOCODE_TIMEOUT_MS);
    if (resposta === 'timeout') return { points: [], source: 'unavailable', reason: 'timeout' };
    if (!resposta || resposta.error) return { points: [], source: 'unavailable', reason: 'funcao-indisponivel' };

    const pontos = parseGeocode(resposta.data, validos.map((place) => place.id));
    if (!pontos) return { points: [], source: 'unavailable', reason: 'resposta-invalida' };
    if (pontos.length === 0) return { points: [], source: 'unavailable', reason: 'nada-encontrado' };

    return { points: pontos, source: 'live' };
  } catch {
    return { points: [], source: 'unavailable', reason: 'erro-inesperado' };
  }
}

/** Campos de endereco aceitos por `addressForGeocoding` (mesmo formato de `clients`). */
export type AddressFields = {
  id?: string | null;
  address_line_1: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
};

/**
 * Da linha do cliente para o pedido de geocoding. Devolve null quando nao ha rua: sem
 * `address_line_1` o Google responde com o centro da cidade e o pino sai errado — melhor
 * ficar sem pino.
 */
export function addressForGeocoding(client: AddressFields, id: string): GeocodePlace | null {
  const rua = client.address_line_1?.trim();
  if (!rua) return null;
  return {
    id,
    addressLine1: rua,
    addressLine2: client.address_line_2 ?? null,
    city: client.city ?? null,
    state: client.state ?? null,
    postalCode: client.postal_code ?? null,
    country: 'US',
  };
}

/** Cliente precisa de coordenada? (tem endereco e nao tem pino) */
export function needsCoordinates(client: AddressFields & { latitude?: number | null; longitude?: number | null }): boolean {
  const temPino = typeof client.latitude === 'number' && typeof client.longitude === 'number' && Number.isFinite(client.latitude) && Number.isFinite(client.longitude);
  if (temPino) return false;
  return addressForGeocoding(client, 'x') !== null;
}

/** O que aconteceu ao tentar preencher o pino (util para log/teste, nunca para a tela). */
export type FillCoordinatesOutcome = 'preenchido' | 'nao-precisava' | 'sem-endereco' | 'indisponivel';

/**
 * Preenche a coordenada de um cliente que TEM endereco e NAO tem pino, gravando no banco.
 *
 * Best-effort de proposito: nunca lanca, nunca segura a tela do gestor. Se o servidor nao
 * responder (sem chave do Google, sem internet, timeout), o cadastro fica como esta — endereco
 * salvo, sem pino — e a navegacao por endereco continua funcionando. Nao ha pino "chutado".
 */
export async function fillClientCoordinates(
  clientId: string,
  client: AddressFields & { latitude?: number | null; longitude?: number | null },
  opcoes: { timeoutMs?: number } = {},
): Promise<FillCoordinatesOutcome> {
  if (!clientId) return 'nao-precisava';
  const place = addressForGeocoding(client, clientId);
  if (!place) return 'sem-endereco';
  if (!needsCoordinates(client)) return 'nao-precisava';

  try {
    const { points, source } = await fetchCoordinates([place], opcoes);
    const alvo = source === 'live' ? points[0] : undefined;
    if (!alvo) return 'indisponivel';

    const { error } = await supabase.from('clients').update({ latitude: alvo.latitude, longitude: alvo.longitude }).eq('id', clientId);
    return error ? 'indisponivel' : 'preenchido';
  } catch {
    return 'indisponivel';
  }
}
