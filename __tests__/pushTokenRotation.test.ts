/**
 * ROTAÇÃO DO TOKEN DE PUSH — achado da auditoria de integrações (02/10/2026).
 *
 * O Expo TROCA o token do aparelho (reinstalar, atualizar, restaurar backup). O upsert por `token`
 * deixava a linha antiga no banco para sempre e o aparelho acumulava tokens mortos (`5 de 6` no banco
 * de produção eram de set/12–25). O aparelho agora LEMBRA qual token registrou (SecureStore) e apaga a
 * linha anterior quando o token muda.
 *
 * Este arquivo isola o estado do módulo (a memória de token é por arquivo), por isso o mock do
 * SecureStore é controlado aqui.
 */
const CHAVE = 'packpaws.push.token.v1';

let mockCofre: Record<string, string> = {};

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (chave: string) => mockCofre[chave] ?? null),
  setItemAsync: jest.fn(async (chave: string, valor: string) => {
    mockCofre[chave] = valor;
  }),
  deleteItemAsync: jest.fn(async (chave: string) => {
    delete mockCofre[chave];
  }),
  WHEN_UNLOCKED: 'when-unlocked',
}));

const mockUpsert = jest.fn();
const mockDeleteEq = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      upsert: mockUpsert,
      delete: () => ({ eq: mockDeleteEq }),
    })),
  },
}));

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetToken = jest.fn();

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...a: unknown[]) => mockGetPermissions(...a),
  requestPermissionsAsync: (...a: unknown[]) => mockRequestPermissions(...a),
  getExpoPushTokenAsync: (...a: unknown[]) => mockGetToken(...a),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'projeto-teste' } } },
}));

import { registerDeviceForPush, unregisterDeviceForPush } from '@/features/notifications/pushRegistration';

const ANTIGO = 'ExponentPushToken[antigo]';
const NOVO = 'ExponentPushToken[novo]';

beforeEach(() => {
  jest.clearAllMocks();
  mockCofre = {};
  mockGetPermissions.mockResolvedValue({ status: 'granted' });
  mockRequestPermissions.mockResolvedValue({ status: 'granted' });
  mockGetToken.mockResolvedValue({ data: NOVO });
  mockUpsert.mockResolvedValue({ error: null });
  mockDeleteEq.mockResolvedValue({ error: null });
});

describe('rotação do token de push', () => {
  it('token MUDOU: apaga a linha do token anterior antes de gravar o novo', async () => {
    mockCofre[CHAVE] = ANTIGO;

    const resultado = await registerDeviceForPush({ userId: 'u1', organizationId: 'org-1' });

    expect(resultado).toEqual({ token: NOVO });
    expect(mockDeleteEq).toHaveBeenCalledWith('token', ANTIGO);
    expect(mockUpsert).toHaveBeenCalledWith(
      { organization_id: 'org-1', user_id: 'u1', token: NOVO, platform: 'ios' },
      { onConflict: 'token' },
    );
    // O aparelho guarda o token NOVO para a próxima rotação.
    expect(mockCofre[CHAVE]).toBe(NOVO);
  });

  it('mesmo token chegando de novo: NÃO apaga nada (não derruba a própria linha)', async () => {
    mockCofre[CHAVE] = NOVO;

    await registerDeviceForPush({ userId: 'u1', organizationId: 'org-1' });

    expect(mockDeleteEq).not.toHaveBeenCalled();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('primeiro registro (nada guardado): não apaga nada', async () => {
    await registerDeviceForPush({ userId: 'u1', organizationId: 'org-1' });

    expect(mockDeleteEq).not.toHaveBeenCalled();
    expect(mockCofre[CHAVE]).toBe(NOVO);
  });

  it('logout esquece o token do aparelho, mesmo que o banco recuse', async () => {
    mockCofre[CHAVE] = NOVO;

    await unregisterDeviceForPush(NOVO);

    expect(mockDeleteEq).toHaveBeenCalledWith('token', NOVO);
    expect(mockCofre[CHAVE]).toBeUndefined();
  });
});
