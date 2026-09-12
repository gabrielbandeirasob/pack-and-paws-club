/**
 * Versao web: push nativo nao existe no navegador. Mantem a MESMA interface da versao
 * nativa (platform split do Metro) para o resto do app nao precisar de `if (web)`.
 */
import type { PushRegistration } from '@/features/notifications/pushRegistration'

export function configureForegroundNotifications(): void {}

export async function registerDeviceForPush(): Promise<PushRegistration> {
  return { token: null, reason: 'web-sem-push' }
}

export async function unregisterDeviceForPush(): Promise<void> {}

export function onNotificationTap(): () => void {
  return () => {}
}
