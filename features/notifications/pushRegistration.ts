/**
 * Registro do aparelho para receber push (iOS/Android).
 *
 * Fluxo: pede permissao -> pega o ExpoPushToken -> grava em `device_tokens` (a RLS garante
 * que cada usuario so mexe no proprio aparelho, na propria organizacao).
 * Ao sair da conta, o token e removido para nao continuar recebendo avisos.
 *
 * ACHADOS DA AUDITORIA DE INTEGRACOES (02/10/2026):
 *  * o token do Expo MUDA (reinstalar, atualizar, restaurar backup) e o upsert por `token` deixava a
 *    linha antiga no banco para sempre — o aparelho acumulava tokens mortos. Agora o aparelho LEMBRA
 *    qual token registrou (SecureStore) e remove a linha anterior quando o token troca;
 *  * o motivo quando NAO da para registrar (permissao negada, sem projectId, erro do banco) tem de
 *    chegar a tela/registro — quem chama nao pode so receber `token: null` em silencio.
 */
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

import { supabase } from '@/lib/supabase'
import { buildDeviceTokenRow } from '@/features/notifications/pushPayload'

export type PushRegistration = { token: string | null; reason?: string }

const CHAVE_TOKEN_REGISTRADO = 'packpaws.push.token.v1'

/** Fallback quando nao ha SecureStore (web/testes): o valor vive so nesta execucao. */
let tokenEmMemoria: string | null = null

async function lerTokenRegistrado(): Promise<string | null> {
  try {
    const guardado = await SecureStore.getItemAsync(CHAVE_TOKEN_REGISTRADO)
    return guardado ?? tokenEmMemoria
  } catch {
    return tokenEmMemoria
  }
}

async function guardarTokenRegistrado(token: string): Promise<void> {
  tokenEmMemoria = token
  try {
    await SecureStore.setItemAsync(CHAVE_TOKEN_REGISTRADO, token)
  } catch {
    // Sem SecureStore (web/testes): a memoria acima ja cumpre o papel.
  }
}

async function esquecerTokenRegistrado(): Promise<void> {
  tokenEmMemoria = null
  try {
    await SecureStore.deleteItemAsync(CHAVE_TOKEN_REGISTRADO)
  } catch {
    // idem
  }
}

/** Mostra o aviso mesmo com o app aberto (padrao do Expo: sem isso o push fica silencioso). */
export function configureForegroundNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  })
}

function projectId(): string | null {
  const extra = Constants?.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  return extra?.eas?.projectId ?? (Constants as unknown as { easConfig?: { projectId?: string } })?.easConfig?.projectId ?? null
}

export async function registerDeviceForPush(input: { userId: string; organizationId: string }): Promise<PushRegistration> {
  try {
    let { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status
    }
    if (status !== 'granted') return { token: null, reason: 'permissao-negada' }

    const id = projectId()
    if (!id) return { token: null, reason: 'project-id-ausente' }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id })
    if (!token) return { token: null, reason: 'token-vazio' }

    /**
     * O token do Expo muda sem o dono do aparelho saber. Antes de gravar o novo, apaga a linha do token
     * ANTERIOR deste aparelho — e o que a auditoria chamou de "tokens velhos acumulam". O alvo e o token
     * que ESTE aparelho registrou por ultimo (guardado no cofre), nao os outros aparelhos do usuario.
     */
    const anterior = await lerTokenRegistrado()
    if (anterior && anterior !== token) {
      await supabase.from('device_tokens').delete().eq('token', anterior)
    }

    const row = buildDeviceTokenRow({ userId: input.userId, organizationId: input.organizationId, token, os: Platform.OS })
    const { error } = await supabase.from('device_tokens').upsert(row, { onConflict: 'token' })
    if (error) return { token: null, reason: error.message }

    await guardarTokenRegistrado(token)
    return { token }
  } catch (e) {
    return { token: null, reason: e instanceof Error ? e.message : 'erro-desconhecido' }
  }
}

/** Chamado no logout / troca de usuario. */
export async function unregisterDeviceForPush(token: string): Promise<void> {
  try {
    await supabase.from('device_tokens').delete().eq('token', token)
  } catch {
    // sair da conta nunca pode falhar por causa do push
  } finally {
    // Mesmo que o banco recuse, o aparelho esquece o token: o proximo login registra do zero.
    await esquecerTokenRegistrado()
  }
}

/** Assina o toque na notificacao; devolve a funcao para cancelar. */
export function onNotificationTap(handler: (data: unknown) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((resposta) => {
    handler(resposta?.notification?.request?.content?.data)
  })
  return () => sub.remove()
}

/**
 * RESUMO DA NOTIFICACAO QUE ABRIU O APP (cold start).
 *
 * O `onNotificationTap` so cobre o app JA rodando: quem toca na notificacao com o app FECHADO recebe a
 * resposta em `getLastNotificationResponseAsync`, e o listener nao dispara retroativamente — o toque se
 * perdia. Devolve o `data` (ou `null`); nunca lanca. Em plataformas/versoes sem a API devolve `null`.
 */
export async function initialNotificationData(): Promise<unknown | null> {
  try {
    if (typeof Notifications.getLastNotificationResponseAsync !== 'function') return null
    const resposta = await Notifications.getLastNotificationResponseAsync()
    return resposta?.notification?.request?.content?.data ?? null
  } catch {
    return null
  }
}
