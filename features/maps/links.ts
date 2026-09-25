/**
 * Links de navegacao para as paradas da rota.
 * iOS abre o Google Maps ou o Apple Maps por URL universal (sem SDK, sem chave);
 * se o app nao estiver instalado, o proprio iOS resolve no navegador.
 */

export type NavTarget = {
  /** Endereco em texto (fallback quando nao ha coordenadas). */
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type NavigationOption = { id: 'google' | 'apple' | 'waze'; label: string; url: string };

function hasCoords(target: NavTarget): boolean {
  return typeof target.latitude === 'number' && typeof target.longitude === 'number';
}

function encode(value: string): string {
  return encodeURIComponent(value.trim());
}

/** Google Maps: navegacao turn-by-turn (ou busca, se só houver endereco). */
export function googleMapsUrl(target: NavTarget): string {
  if (hasCoords(target)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${target.latitude},${target.longitude}&travelmode=driving`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encode(target.address ?? '')}&travelmode=driving`;
}

/** Apple Maps: navegacao turn-by-turn (daddr) ou busca (q). */
export function appleMapsUrl(target: NavTarget): string {
  if (hasCoords(target)) {
    return `https://maps.apple.com/?daddr=${target.latitude},${target.longitude}&dirflg=d`;
  }
  return `https://maps.apple.com/?q=${encode(target.address ?? '')}`;
}

/**
 * Waze: app de motorista (pedido do dono em 25/09/2026 - "pode adicionar Waze tbm").
 * Universal link (abre o Waze instalado; sem o app, cai no navegador). Com coordenadas usa `ll`
 * (navegacao direta), so com endereco usa `q` (busca).
 */
export function wazeUrl(target: NavTarget): string {
  if (hasCoords(target)) {
    return `https://waze.com/ul?ll=${target.latitude},${target.longitude}&navigate=yes`;
  }
  return `https://waze.com/ul?q=${encode(target.address ?? '')}&navigate=yes`;
}

/**
 * Opcoes de navegacao na ordem em que devem aparecer pro motorista:
 * Google primeiro (pedido do produto), Apple como alternativa nativa.
 */
export function navigationOptions(target: NavTarget): NavigationOption[] {
  return [
    { id: 'google', label: 'Google Maps', url: googleMapsUrl(target) },
    { id: 'apple', label: 'Apple Maps', url: appleMapsUrl(target) },
    { id: 'waze', label: 'Waze', url: wazeUrl(target) },
  ];
}
