import { render, waitFor } from '@testing-library/react-native';

/**
 * `PushRegistrar` — registra/desregistra o aparelho para push e roteia o toque na notificação.
 * Módulo sem cobertura até aqui e é justamente onde o usuário sente: permissão negada, banco
 * recusando o token e o token que chega de novo.
 *
 * Aqui o `pushRegistration` roda de VERDADE (só o `expo-notifications`, o `expo-constants` e o
 * `supabase` entram mockados), para provar o que o componente faz com cada resposta.
 */

let mockSession: { user: { id: string } } | null = { user: { id: 'u1' } };

jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: mockSession }),
}));

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUpsert = jest.fn();
const mockDeletarEq = jest.fn();
const mockMaybeSingle = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn((tabela: string) => {
      if (tabela === 'device_tokens') {
        return { upsert: mockUpsert, delete: () => ({ eq: mockDeletarEq }) };
      }
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.limit = () => b;
      b.maybeSingle = () => mockMaybeSingle();
      return b;
    }),
  },
}));

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockGetToken = jest.fn();
const mockSetHandler = jest.fn();
const mockAddListener = jest.fn();
const mockGetLastResponse = jest.fn();

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: (...a: unknown[]) => mockGetPermissions(...a),
  requestPermissionsAsync: (...a: unknown[]) => mockRequestPermissions(...a),
  getExpoPushTokenAsync: (...a: unknown[]) => mockGetToken(...a),
  setNotificationHandler: (...a: unknown[]) => mockSetHandler(...a),
  addNotificationResponseReceivedListener: (...a: unknown[]) => mockAddListener(...a),
  getLastNotificationResponseAsync: (...a: unknown[]) => mockGetLastResponse(...a),
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'projeto-teste' } } },
}));

import { PushRegistrar } from '@/features/notifications/PushRegistrar';

const TOKEN = 'ExponentPushToken[abc]';

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = { user: { id: 'u1' } };
  mockMaybeSingle.mockResolvedValue({ data: { organization_id: 'org-1' }, error: null });
  mockGetPermissions.mockResolvedValue({ status: 'granted' });
  mockRequestPermissions.mockResolvedValue({ status: 'granted' });
  mockGetToken.mockResolvedValue({ data: TOKEN });
  mockUpsert.mockResolvedValue({ error: null });
  mockDeletarEq.mockResolvedValue({ error: null });
  // Sem notificação que tenha aberto o app (o padrão do cold start): nada a navegar.
  mockGetLastResponse.mockResolvedValue(null);
  // A assinatura do toque precisa devolver a inscrição com `remove` (senão o cleanup do efeito
  // quebra ao desmontar).
  mockAddListener.mockImplementation(() => ({ remove: jest.fn() }));
});

describe('PushRegistrar', () => {
  it('permissão concedida: grava o token com a organização e o usuário', async () => {
    const tela = await render(<PushRegistrar />);

    await waitFor(() => expect(mockUpsert).toHaveBeenCalled());

    expect(mockUpsert).toHaveBeenCalledWith(
      { organization_id: 'org-1', user_id: 'u1', token: TOKEN, platform: 'ios' },
      { onConflict: 'token' },
    );
    // O aviso em primeiro plano é configurado no mount.
    expect(mockSetHandler).toHaveBeenCalled();
    // O componente não desenha nada.
    expect(tela.toJSON()).toBeNull();
  });

  it('permissão NEGADA: não insiste (não pede token) e não quebra o app', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });

    const tela = await render(<PushRegistrar />);

    await waitFor(() => expect(mockRequestPermissions).toHaveBeenCalledTimes(1));
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(tela.toJSON()).toBeNull();
  });

  it('erro do banco no registro: não derruba a tela nem repete a escrita', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'row-level security' } });

    const tela = await render(<PushRegistrar />);

    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));
    // Passou um tico para pegar qualquer nova tentativa fora de hora.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(tela.toJSON()).toBeNull();
  });

  it('o MESMO token chegando de novo não vira linha duplicada (grava com onConflict)', async () => {
    // O aparelho registra o push, o usuário sai e entra de novo: o token é o mesmo e chega uma
    // segunda vez. As DUAS escritas precisam mirar o mesmo conflito — o banco ATUALIZA a linha do
    // token em vez de inserir duas. Trocar por um `insert` cego reprova este vetor.
    const tela = await render(<PushRegistrar />);
    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));

    mockSession = null;
    tela.rerender(<PushRegistrar />);
    await waitFor(() => expect(mockDeletarEq).toHaveBeenCalled());

    mockSession = { user: { id: 'u1' } };
    tela.rerender(<PushRegistrar />);
    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(2));

    for (const chamada of mockUpsert.mock.calls) {
      expect(chamada[1]).toEqual({ onConflict: 'token' });
      expect(chamada[0]).toEqual({ organization_id: 'org-1', user_id: 'u1', token: TOKEN, platform: 'ios' });
    }
  });

  it('sair da conta remove o token que este aparelho registrou', async () => {
    const tela = await render(<PushRegistrar />);
    await waitFor(() => expect(mockUpsert).toHaveBeenCalled());

    mockSession = null;
    tela.rerender(<PushRegistrar />);

    await waitFor(() => expect(mockDeletarEq).toHaveBeenCalledWith('token', TOKEN));
  });

  it('o toque na notificação de rota manda o usuário para a tela do motorista', async () => {
    let capturado: ((r: unknown) => void) | null = null;
    mockAddListener.mockImplementation((cb: (r: unknown) => void) => {
      capturado = cb;
      return { remove: jest.fn() };
    });

    await render(<PushRegistrar />);
    expect(typeof capturado).toBe('function');

    (capturado as unknown as (r: unknown) => void)({
      notification: { request: { content: { data: { type: 'route_published' } } } },
    });

    // `routeForNotificationData` (real) devolve '/(tabs)/driver' para avisos de rota.
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/driver');
  });

  it('notificação desconhecida não navega para lugar nenhum', async () => {
    let capturado: ((r: unknown) => void) | null = null;
    mockAddListener.mockImplementation((cb: (r: unknown) => void) => {
      capturado = cb;
      return { remove: jest.fn() };
    });

    await render(<PushRegistrar />);
    (capturado as unknown as (r: unknown) => void)({
      notification: { request: { content: { data: { type: 'outra_coisa' } } } },
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  // ------------------------------------------------- cold start (auditoria de integrações, 02/10/2026)
  it('app aberto PELA notificação (cold start): navega para a tela da rota', async () => {
    // Com o app FECHADO o listener não vê o toque; a resposta fica em `getLastNotificationResponseAsync`.
    mockGetLastResponse.mockResolvedValue({
      notification: { request: { content: { data: { type: 'route_published' } } } },
    });

    await render(<PushRegistrar />);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(tabs)/driver'));
  });

  it('o MESMO toque no listener e na resposta inicial não navega duas vezes', async () => {
    let capturado: ((r: unknown) => void) | null = null;
    mockAddListener.mockImplementation((cb: (r: unknown) => void) => {
      capturado = cb;
      return { remove: jest.fn() };
    });
    mockGetLastResponse.mockResolvedValue({
      notification: { request: { content: { data: { type: 'route_published' } } } },
    });

    await render(<PushRegistrar />);
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

    // O listener entrega o MESMO toque em seguida (app que abriu pela notificação): não pode repetir.
    (capturado as unknown as (r: unknown) => void)({
      notification: { request: { content: { data: { type: 'route_published' } } } },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('permissão negada: o motivo vai para o registro (não falha em silêncio)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGetPermissions.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissions.mockResolvedValue({ status: 'denied' });

    await render(<PushRegistrar />);

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('permissao-negada')),
    );
    warn.mockRestore();
  });
});
