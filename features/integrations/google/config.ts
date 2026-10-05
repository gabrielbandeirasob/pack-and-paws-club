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
 * Escopos pedidos ao usuário — **SOMENTE LEITURA** (decisão do dono, 05/10/2026):
 * *"quero que o aplicativo apenas importe do cliente… quero remover essa capacidade dele de criar ou
 * mudar o calendário do cliente"*.
 *
 * Antes desta data o app pedia `calendar.events` (leitura **e** escrita) porque tinha o ESPELHO
 * (reserva do app virava evento no calendário do escritório). Com o espelho removido — não existe mais
 * nenhuma chamada de escrita no app — o escopo de leitura basta, e pedir o mínimo é o que transforma a
 * regra em GARANTIA: com o token de leitura o Google recusa escrita mesmo que um bug tente.
 *
 *  * `calendar.events.readonly` — ler os eventos do calendário escolhido (a importação).
 *  * `calendar.calendarlist.readonly` — listar os calendários da conta (o seletor de calendário):
 *    `users/me/calendarList` NÃO aceita `calendar.events` (HTTP 403 "insufficient authentication
 *    scopes"), e sem esta lista o gestor não tem como escolher o calendário do escritório
 *    ("bot venda"), que é onde os agendamentos estão. É o escopo mais estreito que resolve: só a
 *    LISTA de calendários, nada de evento.
 *  * `calendar.calendars.readonly` — ler as PROPRIEDADES do calendário (bug 56: as etiquetas de cor
 *    de `labelProperties.eventLabels` só saem de `GET /calendars/{id}`, que não aceita
 *    `calendar.events` nem `calendar.calendarlist.readonly`).
 *
 * CONSEQUÊNCIA: **conta conectada antes desta mudança tem um token com poder de escrita** e precisa
 * reconectar uma vez para receber o token de leitura (o token gravado no Keychain/Keychain do
 * servidor não muda de escopo sozinho). Enquanto não reconectar, tudo continua funcionando (o app
 * só lê) — o que não pode é alguém confiar no escopo velho como se fosse de leitura. Ao desconectar
 * e conectar de novo, o token de leitura substitui o antigo no aparelho **e** no servidor.
 */
export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.calendars.readonly',
];
