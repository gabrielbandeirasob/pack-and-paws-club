/**
 * Registro do aparelho para receber push (iOS/Android).
 *
 * Fluxo: pede permissao -> pega o ExpoPushToken -> grava em `device_tokens` (a RLS garante
 * que cada usuario so mexe no proprio aparelho, na propria organizacao).
 * Ao sair da conta, o token e removido para nao continuar recebendo avisos.
 */
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { Platform } from 'react-native'

import { supabase } from '@/lib/supabase'
import { buildDeviceTokenRow } from '@/features/notifications/pushPayload'

export type PushRegistration = { token: string | null; reason?: string }

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

    const row = buildDeviceTokenRow({ userId: input.userId, organizationId: input.organizationId, token, os: Platform.OS })
    const { error } = await supabase.from('device_tokens').upsert(row, { onConflict: 'token' })
    if (error) return { token: null, reason: error.message }

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
  }
}

/** Assina o toque na notificacao; devolve a funcao para cancelar. */
export function onNotificationTap(handler: (data: unknown) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((resposta) => {
    handler(resposta?.notification?.request?.content?.data)
  })
  return () => sub.remove()
}
