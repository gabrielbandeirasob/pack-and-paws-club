/**
 * Navegação para a parada: o app NÃO faz turn-by-turn (decisão de produto).
 * Ele calcula a ordem das paradas e redireciona para o app de mapa preferido do motorista.
 */
import { appleMapsUrl, googleMapsUrl, wazeUrl, type NavTarget } from './links';

/** 'waze' entrou em 25/09/2026 (pedido do dono: "pode adicionar Waze tbm"). */
export type NavApp = 'google' | 'apple' | 'waze';

export const NAV_APPS: NavApp[] = ['google', 'apple', 'waze'];

export function labelFor(app: NavApp): string {
  if (app === 'google') return 'Google Maps';
  if (app === 'waze') return 'Waze';
  return 'Apple Maps';
}

/** URL de navegação para o app escolhido. */
export function navigationUrlFor(app: NavApp, target: NavTarget): string {
  if (app === 'google') return googleMapsUrl(target);
  if (app === 'waze') return wazeUrl(target);
  return appleMapsUrl(target);
}

/** Escolha normaliza o que vier do storage (qualquer coisa estranha → null = perguntar de novo). */
export function parseNavApp(value: string | null | undefined): NavApp | null {
  return value === 'google' || value === 'apple' || value === 'waze' ? value : null;
}
