/**
 * Testes do registro de push — aqui esta o que o usuario sente na pratica:
 * permissao negada, projeto ausente, gravacao do token e o toque na notificacao.
 */
const mockUpsert = jest.fn();
const mockDelete = jest.fn();
const mockEq = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetToken = jest.fn();
const mockSetHandler = jest.fn();
const mockAddListener = jest.fn();

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...a: unknown[]) => mockGetPermissions(...a),
  requestPermissionsAsync: (...a: unknown[]) => mockRequestPermissions(...a),
  getExpoPushTokenAsync: (...a: unknown[]) => mockGetToken(...a),
  setNotificationHandler: (...a: unknown[]) => mockSetHandler(...a),
  addNotificationResponseReceivedListener: (...a: unknown[]) => mockAddListener(...a),
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'projeto-teste' } } },
}));

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

beforeEach(() => {
  jest.clearAllMocks();
  mockFrom.mockReturnValue({ upsert: mockUpsert, delete: () => ({ eq: mockEq }) });
  mockUpsert.mockResolvedValue({ error: null });
  mockEq.mockResolvedValue({ error: null });
});

describe('pushPayload', () => {
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

describe('registerDeviceForPush', () => {
  it('grava o token quando o usuario autoriza', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'granted' });
    mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' });

    const r = await registerDeviceForPush({ userId: 'u1', organizationId: 'o1' });

    expect(r).toEqual({ token: 'ExponentPushToken[abc]' });
    expect(mockFrom).toHaveBeenCalledWith('device_tokens');
    expect(mockUpsert).toHaveBeenCalledWith(
      { organization_id: 'o1', user_id: 'u1', token: 'ExponentPushToken[abc]', platform: 'ios' },
      { onConflict: 'token' },
    );
  });

  it('nao grava nada quando o usuario nega a permissao', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });

    const r = await registerDeviceForPush({ userId: 'u1', organizationId: 'o1' });

    expect(r).toEqual({ token: null, reason: 'permissao-negada' });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('devolve o motivo quando o banco recusa', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'granted' });
    mockGetToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    mockUpsert.mockResolvedValue({ error: { message: 'row-level security' } });

    const r = await registerDeviceForPush({ userId: 'u1', organizationId: 'o1' });

    expect(r).toEqual({ token: null, reason: 'row-level security' });
  });

  it('nao quebra se o expo falhar', async () => {
    mockGetPermissions.mockRejectedValue(new Error('sem rede'));

    const r = await registerDeviceForPush({ userId: 'u1', organizationId: 'o1' });

    expect(r.token).toBeNull();
    expect(r.reason).toBe('sem rede');
  });
});

describe('unregisterDeviceForPush', () => {
  it('remove o token do aparelho ao sair da conta', async () => {
    await unregisterDeviceForPush('ExponentPushToken[abc]');
    expect(mockFrom).toHaveBeenCalledWith('device_tokens');
    expect(mockEq).toHaveBeenCalledWith('token', 'ExponentPushToken[abc]');
  });

  it('sair da conta nunca falha por causa do push', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('banco fora do ar');
    });
    await expect(unregisterDeviceForPush('ExponentPushToken[abc]')).resolves.toBeUndefined();
  });
});

describe('onNotificationTap', () => {
  it('entrega o data da notificacao para quem assinou', () => {
    let capturado: ((r: unknown) => void) | null = null;
    mockAddListener.mockImplementation((cb: (r: unknown) => void) => {
      capturado = cb;
      return { remove: jest.fn() };
    });
    const recebido: unknown[] = [];

    const cancelar = onNotificationTap((d) => recebido.push(d));
    (capturado as unknown as (r: unknown) => void)({ notification: { request: { content: { data: { type: 'route_published' } } } } });

    expect(recebido).toEqual([{ type: 'route_published' }]);
    expect(typeof cancelar).toBe('function');
  });

  it('configura o aviso em primeiro plano', () => {
    configureForegroundNotifications();
    expect(mockSetHandler).toHaveBeenCalled();
  });
});
