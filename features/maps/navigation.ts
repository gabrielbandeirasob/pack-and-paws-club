/**
 * Navegação para a parada: o app NÃO faz turn-by-turn (decisão de produto).
 * Ele calcula a ordem das paradas e redireciona para o app de mapa preferido do motorista.
 */
import { appleMapsUrl, googleMapsUrl, type NavTarget } from './links';

export type NavApp = 'google' | 'apple';

export const NAV_APPS: NavApp[] = ['google', 'apple'];

export function labelFor(app: NavApp): string {
  return app === 'google' ? 'Google Maps' : 'Apple Maps';
}

/** URL de navegação para o app escolhido. */
export function navigationUrlFor(app: NavApp, target: NavTarget): string {
  return app === 'google' ? googleMapsUrl(target) : appleMapsUrl(target);
}

/** Escolha normaliza o que vier do storage (qualquer coisa estranha → null = perguntar de novo). */
export function parseNavApp(value: string | null | undefined): NavApp | null {
  return value === 'google' || value === 'apple' ? value : null;
}
