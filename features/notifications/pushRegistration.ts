/**
 * Registro do aparelho para push — DESLIGADO ate a credencial de push existir.
 *
 * POR QUE ESTA ASSIM: o push exige a capacidade "Push Notifications" no perfil da Apple, e o
 * EAS so consegue criar isso com acesso a conta Apple (Apple ID + 2FA) — nao tenho e nao vou
 * adivinhar credencial. Alem disso, so INSTALAR o `expo-notifications` ja injeta a
 * entitlement `aps-environment` no projeto nativo (autolinking do Expo), o que FAZ O BUILD
 * FALHAR enquanto o perfil nao tiver a capacidade:
 *
 *   "Provisioning profile doesn't include the Push Notifications capability"
 *
 * Por isso o pacote foi desinstalado e esta interface virou neutra: o app continua igual, so
 * nao registra o aparelho nem recebe aviso automatico (o motorista ve a rota ao abrir o app).
 *
 * PARA RELIGAR (quando a chave APNs estiver no EAS — ver docs/PUSH-DESTRAVAR.md):
 *   1) npm install expo-notifications        (o plugin volta sozinho pelo autolinking)
 *   2) git show b003c86:mobile/features/notifications/pushRegistration.ts  → restaurar o corpo
 *   3) subir uma nova build (sera a 1.1) e publicar
 *
 * O resto do push continua pronto e testado: tabela `device_tokens` com RLS, trigger
 * `routes_notify_driver` (banco -> Expo Push API via pg_net), `pushPayload.ts` (puro) e o
 * componente `PushRegistrar` chamando esta interface.
 */

export type PushRegistration = { token: string | null; reason?: string };

export function configureForegroundNotifications(): void {
  // nada a fazer enquanto o push esta desligado
}

export async function registerDeviceForPush(_input?: { userId: string; organizationId: string }): Promise<PushRegistration> {
  return { token: null, reason: 'push-desligado-ate-credencial-apns' };
}

export async function unregisterDeviceForPush(_token?: string): Promise<void> {
  // nada a fazer
}

export function onNotificationTap(_handler?: (data: unknown) => void): () => void {
  return () => undefined;
}
