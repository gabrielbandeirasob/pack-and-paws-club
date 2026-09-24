/**
 * Estado da configuração do Google no app.
 *
 * O app NUNCA carrega a chave privilegiada das APIs de mapas (Geocoding/Routes ficam no
 * servidor — plano §5.4). Aqui só vivem: o Client ID OAuth (público) e a chave do Maps SDK
 * (restrita ao bundle ID, também pública por natureza).
 */
import Constants from 'expo-constants';

type ExpoConfigExtra = { googleIosClientId?: string | null };
type ExpoConfigIos = { config?: { googleMapsApiKey?: string | null } | null };

const expoConfig = Constants.expoConfig as (typeof Constants.expoConfig & { extra?: ExpoConfigExtra; ios?: ExpoConfigIos }) | null;

/** Client ID OAuth do iOS (null enquanto o projeto Google Cloud não estiver configurado). */
export function googleIosClientId(): string | null {
  const value = expoConfig?.extra?.googleIosClientId ?? null;
  return value && value.length > 0 ? value : null;
}

/** Esquema de retorno do OAuth (client ID invertido), usado pelo fluxo de conexão. */
export function googleRedirectScheme(): string | null {
  const clientId = googleIosClientId();
  if (!clientId) return null;
  return clientId.split('.').reverse().join('.');
}

/** Chave do Maps SDK for iOS embutida no build (lida do Info.plist pelo SDK nativo). */
export function googleMapsKey(): string | null {
  const value = expoConfig?.ios?.config?.googleMapsApiKey ?? null;
  return value && value.length > 0 ? value : null;
}

/** O calendário só pode ser conectado quando o Client ID existir no build. */
export function isCalendarConfigured(): boolean {
  return googleIosClientId() !== null;
}

/** O mapa nativo só renderiza quando a chave do Maps SDK estiver no build. */
export function isMapsConfigured(): boolean {
  return googleMapsKey() !== null;
}

/**
 * Escopos pedidos ao usuário (o mínimo necessário para espelhar as reservas e listar os calendários).
 *
 * `calendar.calendarlist.readonly` entrou em 24/09/2026 junto com o seletor de calendário: a API
 * `users/me/calendarList` NÃO aceita `calendar.events` (responde HTTP 403 "insufficient
 * authentication scopes"), e sem ela o gestor não tem como escolher o calendário do escritório
 * ("bot venda"), que é onde os agendamentos realmente estão. É o escopo mais estreito que resolve:
 * só a LISTA de calendários, nada de ler ou escrever evento a mais.
 */
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];
