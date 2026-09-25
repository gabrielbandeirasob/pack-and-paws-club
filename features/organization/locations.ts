/**
 * LOCAL DA ORGANIZAÇÃO (sede / van / yard) — onde a rota começa e termina.
 *
 * Pedido da OPERAÇÃO do cliente em áudio (25/09/2026): "só quando eu chegar na van que eu sou
 * apto a dar o clock in (...) no raio lá" e "a posição de cada driver começar vai ser definida
 * pela administradora (...) ele tem que ser apto a botar onde cada driver vai terminar".
 *
 * TRAVA OPT-IN (o mais importante daqui): o bloqueio do clock in SÓ existe quando a organização
 * tem sede cadastrada (`vanLocationForRoute` devolve algo). Organização sem sede — o caso de todo
 * mundo em produção hoje — passa por `clockInGate` e recebe `allowed: true` sem nenhuma pergunta:
 * comportamento idêntico ao de antes. Localização indisponível (web, permissão negada, GPS sem
 * fix) também NÃO bloqueia: o motorista nunca fica sem conseguir trabalhar por causa de sinal.
 *
 * A conta (distância, raio, texto do motivo) mora aqui, pura e testável; o acesso ao banco fica
 * nos serviços do fim do arquivo. O app não guarda a distância: ela é recalculada a cada tentativa.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { haversineKm } from '@/features/dispatch/routeOptimizer';
import type { LocationUpdate } from '@/features/driver/locationService';

/** Tolerância default do raio da van, em metros (mesmo default da migração 034). */
export const VAN_RADIUS_DEFAULT_METERS = 300;
export const VAN_RADIUS_MIN_METERS = 25;
export const VAN_RADIUS_MAX_METERS = 5000;

export type LocationKind = 'van' | 'yard' | 'other';

export type OrganizationLocation = {
  id: string;
  /** rótulo escolhido pelo gestor — ex.: "Van — Palo Alto" */
  name: string;
  kind: LocationKind;
  addressLine1: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  /** raio de tolerância do clock in, em metros */
  radiusMeters: number;
  /** sede padrão da organização (vale quando a rota não aponta uma) */
  isDefault: boolean;
};

/** Linha crua de `organization_locations` (PostgREST). */
export type OrganizationLocationRow = {
  id: string;
  name: string;
  kind?: string | null;
  address_line_1?: string | null;
  city?: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  radius_meters?: number | string | null;
  is_default?: boolean | null;
};

function numero(valor: unknown): number | null {
  const n = typeof valor === 'string' ? Number(valor) : valor;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function tipoDe(valor: unknown): LocationKind {
  return valor === 'yard' || valor === 'other' ? valor : 'van';
}

/** Coordenada utilizável? Faixa válida e fora de "Null Island" (o GPS sem fix devolve 0,0). */
export function coordenadaUtilizavel(latitude: unknown, longitude: unknown): boolean {
  const lat = numero(latitude);
  const lng = numero(longitude);
  if (lat === null || lng === null) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

/** Linha do banco → modelo do app. Linha sem coordenada utilizável é descartada (null). */
export function locationFromRow(row: OrganizationLocationRow): OrganizationLocation | null {
  if (!row || typeof row.id !== 'string' || !coordenadaUtilizavel(row.latitude, row.longitude)) return null;
  const raio = numero(row.radius_meters);
  return {
    id: row.id,
    name: (row.name ?? '').trim() || 'Van',
    kind: tipoDe(row.kind),
    addressLine1: row.address_line_1 ?? null,
    city: row.city ?? null,
    latitude: numero(row.latitude) as number,
    longitude: numero(row.longitude) as number,
    radiusMeters: raio === null ? VAN_RADIUS_DEFAULT_METERS : Math.min(Math.max(Math.round(raio), VAN_RADIUS_MIN_METERS), VAN_RADIUS_MAX_METERS),
    isDefault: row.is_default === true,
  };
}

/** As colunas que o app pede (uma lista só, para a tela do gestor e a do motorista não divergirem). */
export const LOCATION_COLUMNS = 'id, name, kind, address_line_1, city, latitude, longitude, radius_meters, is_default';

/** Sites da organização já prontos para uso (linha torta é descartada, nunca "chutada"). */
export function locationsFromRows(rows: unknown): OrganizationLocation[] {
  return ((rows ?? []) as OrganizationLocationRow[])
    .map(locationFromRow)
    .filter((item): item is OrganizationLocation => item !== null);
}

/**
 * Qual sede vale para uma rota.
 *
 * Precedência: a sede ESCOLHIDA na rota → a sede PADRÃO da organização → a única sede cadastrada.
 * Com DUAS ou mais sedes e nenhuma marcada como padrão, devolve null de propósito: travar o clock
 * in na van errada seria pior do que não travar (o gestor marca a padrão em um toque).
 */
export function vanLocationForRoute(
  locations: OrganizationLocation[],
  startLocationId?: string | null,
): OrganizationLocation | null {
  if (!locations || locations.length === 0) return null;
  if (startLocationId) {
    const daRota = locations.find((item) => item.id === startLocationId);
    if (daRota) return daRota;
  }
  const padrao = locations.find((item) => item.isDefault);
  if (padrao) return padrao;
  return locations.length === 1 ? locations[0] : null;
}

export type ClockInGateKind = 'no-location' | 'no-position' | 'inside' | 'outside';

export type ClockInGate = {
  /** false = o clock in NÃO pode ser gravado */
  allowed: boolean;
  kind: ClockInGateKind;
  /** distância até a van em km (null quando não deu para calcular) */
  distanceKm: number | null;
  radiusMeters: number | null;
  location: OrganizationLocation | null;
  /** motivo que o motorista lê quando não pode (e quando não deu para conferir) */
  message: string | null;
};

/** Mensagem do caso "não deu para conferir" (o registro continua liberado). */
export const SEM_POSICAO_MENSAGEM =
  'Não foi possível conferir sua posição agora — o clock in está liberado.';

/** "850 m" / "3,2 km" — o número que o motorista lê no motivo. */
export function distanceText(km: number): string {
  const seguro = Number.isFinite(km) && km > 0 ? km : 0;
  if (seguro < 1) {
    const metros = Math.max(0, Math.round((seguro * 1000) / 10) * 10);
    return `${metros} m`;
  }
  return `${seguro.toFixed(1).replace('.', ',')} km`;
}

/** O motivo em PT-BR do motorista (a operação é brasileira; o resto da tela segue em inglês). */
export function foraDoRaioMensagem(location: Pick<OrganizationLocation, 'name' | 'radiusMeters'>, km: number): string {
  return `Você está a ${distanceText(km)} da van "${location.name}" — o ponto abre quando você chegar (raio de ${location.radiusMeters} m).`;
}

/**
 * A trava do clock in.
 *
 * Regra: sem sede → liberado (opt-in); sem posição → liberado com aviso; dentro do raio → liberado;
 * fora do raio → NÃO liberado, com o motivo. Nada aqui grava: quem decide o que fazer com o
 * resultado é a tela.
 */
export function clockInGate(entrada: {
  location: OrganizationLocation | null | undefined;
  position: LocationUpdate | null | undefined;
}): ClockInGate {
  const { location, position } = entrada;

  if (!location) {
    return { allowed: true, kind: 'no-location', distanceKm: null, radiusMeters: null, location: null, message: null };
  }

  const base: Pick<ClockInGate, 'radiusMeters' | 'location'> = { radiusMeters: location.radiusMeters, location };

  if (!position || !coordenadaUtilizavel(position.latitude, position.longitude)) {
    return { allowed: true, kind: 'no-position', distanceKm: null, ...base, message: SEM_POSICAO_MENSAGEM };
  }

  const km = haversineKm(position.latitude, position.longitude, location.latitude, location.longitude);

  if (km * 1000 <= location.radiusMeters) {
    return { allowed: true, kind: 'inside', distanceKm: km, ...base, message: null };
  }

  return { allowed: false, kind: 'outside', distanceKm: km, ...base, message: foraDoRaioMensagem(location, km) };
}

/** Atalho para a tela: o motorista está no raio da van? (falso quando não dá para saber) */
export function estaNaVan(location: OrganizationLocation | null | undefined, position: LocationUpdate | null | undefined): boolean {
  return clockInGate({ location, position }).kind === 'inside';
}

/* ------------------------------------------------------------------ *
 * FORMULÁRIO DO GESTOR (puro: valida o rascunho antes de gravar)
 * ------------------------------------------------------------------ */

export type LocationDraft = {
  name: string;
  kind: LocationKind;
  addressLine1: string;
  city: string;
  /** texto do formulário — aceita vírgula decimal ("37,77") */
  latitude: string;
  longitude: string;
  radiusMeters: string;
  isDefault: boolean;
};

export const EMPTY_LOCATION_DRAFT: LocationDraft = {
  name: '',
  kind: 'van',
  addressLine1: '',
  city: '',
  latitude: '',
  longitude: '',
  radiusMeters: `${VAN_RADIUS_DEFAULT_METERS}`,
  isDefault: false,
};

/** "37,7749" ou "37.7749" → número. Vazio, texto solto ou fora da faixa → null. */
export function parseCoordinate(valor: string): number | null {
  const limpo = (valor ?? '').trim().replace(',', '.');
  if (limpo.length === 0) return null;
  if (!/^-?\d+(\.\d+)?$/.test(limpo)) return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/** Raio digitado → metros inteiros dentro da faixa aceita (default quando vazio). */
export function parseRadius(valor: string): number | null {
  const limpo = (valor ?? '').trim().replace(',', '.');
  if (limpo.length === 0) return VAN_RADIUS_DEFAULT_METERS;
  const n = Number(limpo);
  if (!Number.isFinite(n)) return null;
  const metros = Math.round(n);
  if (metros < VAN_RADIUS_MIN_METERS || metros > VAN_RADIUS_MAX_METERS) return null;
  return metros;
}

/** Erro do rascunho (string para a tela) ou null quando está pronto para gravar. */
export function locationDraftError(draft: LocationDraft): string | null {
  if ((draft.name ?? '').trim().length < 2) return 'Give this van a name (at least 2 letters).';
  const lat = parseCoordinate(draft.latitude);
  const lng = parseCoordinate(draft.longitude);
  const temUmSo = (draft.latitude ?? '').trim().length > 0 !== (draft.longitude ?? '').trim().length > 0;
  if (temUmSo) return 'Fill in both latitude and longitude — or leave both empty and save an address.';
  if ((draft.latitude ?? '').trim().length > 0 || (draft.longitude ?? '').trim().length > 0) {
    if (lat === null || lng === null || !coordenadaUtilizavel(lat, lng)) {
      return 'Those coordinates do not look right (and 0,0 is not a place).';
    }
  } else if ((draft.addressLine1 ?? '').trim().length === 0) {
    return 'Where is this van? Save an address or the coordinates.';
  }
  if (parseRadius(draft.radiusMeters) === null) {
    return `The radius must be between ${VAN_RADIUS_MIN_METERS} and ${VAN_RADIUS_MAX_METERS} meters.`;
  }
  return null;
}

/** Rascunho → números prontos (coordenada digitada tem prioridade; senão vem do geocoding). */
export function draftCoordinates(draft: LocationDraft): { latitude: number; longitude: number } | null {
  const lat = parseCoordinate(draft.latitude);
  const lng = parseCoordinate(draft.longitude);
  if (lat === null || lng === null || !coordenadaUtilizavel(lat, lng)) return null;
  return { latitude: lat, longitude: lng };
}

/* ------------------------------------------------------------------ *
 * ACESSO AO BANCO
 * ------------------------------------------------------------------ */

/** Todas as sedes da organização (a tela do gestor mostra a lista inteira). */
export async function loadOrganizationLocations(
  client: SupabaseClient,
  organizationId: string,
): Promise<OrganizationLocation[]> {
  const { data, error } = await client
    .from('organization_locations')
    .select(LOCATION_COLUMNS)
    .eq('organization_id', organizationId)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return locationsFromRows(data);
}

/**
 * A sede que vale para o motorista AGORA: a da rota (quando ela aponta uma) ou a padrão.
 * Best-effort de propósito: qualquer falha devolve null — e null significa "sem trava".
 */
export async function loadVanLocationForDriver(
  client: SupabaseClient,
  params: { organizationId: string; startLocationId?: string | null },
): Promise<OrganizationLocation | null> {
  try {
    const { data, error } = await client
      .from('organization_locations')
      .select(LOCATION_COLUMNS)
      .eq('organization_id', params.organizationId);
    if (error) return null;
    return vanLocationForRoute(locationsFromRows(data), params.startLocationId ?? null);
  } catch {
    return null;
  }
}

export type SaveLocationParams = {
  organizationId: string;
  /** id existente = edição; ausente = sede nova */
  id?: string | null;
  name: string;
  kind: LocationKind;
  addressLine1: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  /** marcar como a sede padrão da organização (a troca é atômica, no banco) */
  isDefault: boolean;
};

/**
 * Grava a sede (nova ou editada). `is_default` sai sempre false daqui: quem marca a padrão é a
 * função `set_default_organization_location`, que troca a padrão em UMA transação — duas
 * requisições do app deixariam a organização sem padrão no meio do caminho.
 */
export async function saveOrganizationLocation(
  client: SupabaseClient,
  params: SaveLocationParams,
): Promise<OrganizationLocation | null> {
  const payload = {
    organization_id: params.organizationId,
    name: params.name.trim(),
    kind: params.kind,
    address_line_1: params.addressLine1?.trim() || null,
    city: params.city?.trim() || null,
    latitude: params.latitude,
    longitude: params.longitude,
    radius_meters: params.radiusMeters,
    is_default: false,
  };

  const { data, error } = params.id
    ? await client.from('organization_locations').update(payload).eq('id', params.id).select(LOCATION_COLUMNS).single()
    : await client.from('organization_locations').insert(payload).select(LOCATION_COLUMNS).single();
  if (error) throw new Error(error.message);

  const salva = locationFromRow(data as unknown as OrganizationLocationRow);
  if (params.isDefault && salva) await setDefaultOrganizationLocation(client, salva.id);
  return salva;
}

/** Marca uma sede como a padrão da organização (atômico no banco). */
export async function setDefaultOrganizationLocation(client: SupabaseClient, locationId: string): Promise<void> {
  const { error } = await client.rpc('set_default_organization_location', { p_location_id: locationId });
  if (error) throw new Error(error.message);
}

/** Apaga a sede. As rotas que apontavam para ela ficam com a referência em branco (on delete set null). */
export async function removeOrganizationLocation(client: SupabaseClient, locationId: string): Promise<void> {
  const { error } = await client.from('organization_locations').delete().eq('id', locationId);
  if (error) throw new Error(error.message);
}
