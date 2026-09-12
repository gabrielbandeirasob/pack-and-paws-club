/**
 * Push: o que o app faz hoje (registro desligado) e o que ele faria quando a credencial
 * existir (formato do payload, rota da notificacao). O corpo "ligado" fica no git (b003c86).
 */
import {
  buildDeviceTokenRow,
  pushPlatformFor,
  routeForNotificationData,
  routeNotificationText,
} from '@/features/notifications/pushPayload';
import {
  configureForegroundNotifications,
  onNotificationTap,
  registerDeviceForPush,
  unregisterDeviceForPush,
} from '@/features/notifications/pushRegistration';

describe('payload da notificacao (funcoes puras)', () => {
  it('mapeia o sistema para a plataforma gravada no banco', () => {
    expect(pushPlatformFor('ios')).toBe('ios');
    expect(pushPlatformFor('android')).toBe('android');
    expect(pushPlatformFor('web')).toBe('web');
    expect(pushPlatformFor('windows')).toBe('web');
  });

  it('monta a linha de device_tokens', () => {
    expect(buildDeviceTokenRow({ userId: 'u1', organizationId: 'o1', token: 'ExponentPushToken[abc]', os: 'ios' })).toEqual({
      organization_id: 'o1',
      user_id: 'u1',
      token: 'ExponentPushToken[abc]',
      platform: 'ios',
    });
  });

  it('manda para a rota do motorista so nos avisos de rota', () => {
    expect(routeForNotificationData({ type: 'route_published' })).toBe('/(tabs)/driver');
    expect(routeForNotificationData({ type: 'route_cancelled' })).toBe('/(tabs)/driver');
    expect(routeForNotificationData({ type: 'outra_coisa' })).toBeNull();
    expect(routeForNotificationData(null)).toBeNull();
    expect(routeForNotificationData(undefined)).toBeNull();
    expect(routeForNotificationData('texto')).toBeNull();
  });

  it('escreve o texto igual ao do banco', () => {
    expect(routeNotificationText(1)).toBe('1 parada hoje. Toque para abrir.');
    expect(routeNotificationText(3)).toBe('3 paradas hoje. Toque para abrir.');
    expect(routeNotificationText(0)).toBe('Toque para abrir sua rota.');
  });
});

/**
 * Enquanto a chave APNs nao existir, o pacote expo-notifications fica DESINSTALADO (so
 * instalar ja injeta a entitlement aps-environment e derruba o build). Neste estado o app
 * tem de continuar funcionando sem quebrar nada nem chamar o banco.
 */
describe('registro do aparelho (desligado ate a credencial de push)', () => {
  it('nao registra nada e informa o motivo', async () => {
    await expect(registerDeviceForPush({ userId: 'u1', organizationId: 'o1' })).resolves.toEqual({
      token: null,
      reason: 'push-desligado-ate-credencial-apns',
    });
  });

  it('sair da conta nao quebra', async () => {
    await expect(unregisterDeviceForPush('ExponentPushToken[abc]')).resolves.toBeUndefined();
    await expect(unregisterDeviceForPush()).resolves.toBeUndefined();
  });

  it('assinar o toque devolve uma funcao de cancelamento (nada explode)', () => {
    const cancelar = onNotificationTap(() => undefined);
    expect(typeof cancelar).toBe('function');
    expect(() => cancelar()).not.toThrow();
    expect(() => configureForegroundNotifications()).not.toThrow();
  });
});
