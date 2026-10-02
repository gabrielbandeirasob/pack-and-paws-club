import { act, renderHook, waitFor } from '@testing-library/react-native';

/**
 * `useCalendarConnection` — a conexão do Google Calendar (uma via: app → Google).
 * Módulo com 3,5% de cobertura até aqui e é o coração da integração.
 *
 * O que se prova: sem conexão, o estado é "disconnected"; com tokens no cofre, "connected" com o
 * e-mail; `connect()` traduz o resultado do navegador; `disconnect()` limpa estado E cofre; a
 * renovação automática do token funciona; e — o ponto sensível — quando o token EXPIROU e a
 * renovação é recusada (401/invalid_grant), o app NÃO pode continuar dizendo que está conectado.
 *
 * Toda a I/O é falsificada: `expo-auth-session`, `expo-secure-store` (cofre) e a config do app.
 */

const CHAVE_COFRE = 'packpaws.google.tokens.v1';

let mockClientId: string | null = 'client-1.apps.googleusercontent.com';

jest.mock('@/features/integrations/google/config', () => ({
  googleIosClientId: () => mockClientId,
  googleRedirectScheme: () =>
    mockClientId ? mockClientId.split('.').reverse().join('.') : null,
  CALENDAR_SCOPES: ['https://www.googleapis.com/auth/calendar.events'],
}));

const mockCofre: Record<string, string> = {};

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

const mockPromptAsync = jest.fn();
const mockRefreshAsync = jest.fn();
const mockExchangeCodeAsync = jest.fn();
const mockRedirectFixo = jest.fn((..._a: unknown[]) => 'packandpaws://oauthredirect');

jest.mock('expo-auth-session', () => ({
  useAuthRequest: () => [{ codeVerifier: 'verifier-1' }, null, mockPromptAsync],
  exchangeCodeAsync: (...a: unknown[]) => mockExchangeCodeAsync(...a),
  refreshAsync: (...a: unknown[]) => mockRefreshAsync(...a),
  makeRedirectUri: (...a: unknown[]) => mockRedirectFixo(...a),
  ResponseType: { Code: 'code' },
  Prompt: { Consent: 'consent' },
}));

jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));

import { useCalendarConnection } from '@/features/integrations/google/useCalendarConnection';

/** Semeia o cofre (é assim que o app encontra uma conexão já feita). */
function semearTokens(tokens: Record<string, unknown>) {
  mockCofre[CHAVE_COFRE] = JSON.stringify(tokens);
}

const TOKENS_VALIDOS = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: Date.now() + 60 * 60 * 1000,
  email: 'raphael@packandpawsclub.com',
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const chave of Object.keys(mockCofre)) delete mockCofre[chave];
  mockClientId = 'client-1.apps.googleusercontent.com';
  mockPromptAsync.mockResolvedValue({ type: 'success' });
  mockRefreshAsync.mockResolvedValue({ accessToken: 'access-renovado', refreshToken: 'refresh-2', expiresIn: 3600 });
});

describe('useCalendarConnection', () => {
  it('sem conexão: fica "disconnected", sem e-mail, e getAccessToken recusa', async () => {
    const hook = await renderHook(() => useCalendarConnection());

    await waitFor(() => expect(hook.result.current.status).toBe('disconnected'));
    expect(hook.result.current.email).toBeNull();
    await expect(hook.result.current.getAccessToken()).rejects.toThrow(/não está conectado/i);
  });

  it('sem Client ID no build: "not_configured" e conectar devolve erro (não abre o Google)', async () => {
    mockClientId = null;
    const hook = await renderHook(() => useCalendarConnection());

    expect(hook.result.current.status).toBe('not_configured');

    let retorno: string | undefined;
    await act(async () => {
      retorno = await hook.result.current.connect();
    });
    expect(retorno).toBe('error');
    expect(mockPromptAsync).not.toHaveBeenCalled();
  });

  it('conexão já feita: "connected" com o e-mail e o token válido sai sem renovar', async () => {
    semearTokens(TOKENS_VALIDOS);
    const hook = await renderHook(() => useCalendarConnection());

    await waitFor(() => expect(hook.result.current.status).toBe('connected'));
    expect(hook.result.current.email).toBe('raphael@packandpawsclub.com');

    let token = '';
    await act(async () => {
      token = await hook.result.current.getAccessToken();
    });
    expect(token).toBe('access-1');
    expect(mockRefreshAsync).not.toHaveBeenCalled();
  });

  it('connect() traduz o resultado do navegador (sucesso / cancelado / erro)', async () => {
    const hook = await renderHook(() => useCalendarConnection());
    await waitFor(() => expect(hook.result.current.status).toBe('disconnected'));

    let sucesso: string | undefined;
    await act(async () => {
      sucesso = await hook.result.current.connect();
    });
    expect(sucesso).toBe('connected');

    mockPromptAsync.mockResolvedValue({ type: 'dismiss' });
    let cancelado: string | undefined;
    await act(async () => {
      cancelado = await hook.result.current.connect();
    });
    expect(cancelado).toBe('cancelled');

    mockPromptAsync.mockResolvedValue({ type: 'error' });
    let erro: string | undefined;
    await act(async () => {
      erro = await hook.result.current.connect();
    });
    expect(erro).toBe('error');
  });

  it('disconnect() limpa o estado e o cofre', async () => {
    semearTokens(TOKENS_VALIDOS);
    const hook = await renderHook(() => useCalendarConnection());
    await waitFor(() => expect(hook.result.current.status).toBe('connected'));

    await act(async () => {
      await hook.result.current.disconnect();
    });

    await waitFor(() => expect(hook.result.current.status).toBe('disconnected'));
    expect(hook.result.current.email).toBeNull();
    expect(mockCofre[CHAVE_COFRE]).toBeUndefined();
  });

  it('token expirado com refresh válido: renova sozinho e continua conectado', async () => {
    semearTokens({ ...TOKENS_VALIDOS, expiresAt: Date.now() - 1000 });
    const hook = await renderHook(() => useCalendarConnection());
    await waitFor(() => expect(hook.result.current.status).toBe('connected'));

    let token = '';
    await act(async () => {
      token = await hook.result.current.getAccessToken();
    });

    expect(token).toBe('access-renovado');
    expect(mockRefreshAsync).toHaveBeenCalled();
    expect(hook.result.current.status).toBe('connected');
  });

  /**
   * DEFEITO (file:line abaixo). Token expirado e o Google recusou a renovação (401 / invalid_grant,
   * ex.: acesso revogado pelo dono). O gestor PRECISA ver que tem de reconectar — hoje a tela
   * continua dizendo "Connected as … — bookings travel both ways now." porque o estado nunca sai de
   * 'connected'; o único aviso é o erro que só aparece DEPOIS de tentar sincronizar.
   *
   *   features/integrations/google/useCalendarConnection.ts:134-136 (refresh engole o erro e não
   *   limpa os tokens) + :148 (`tokens ? 'connected'`).
   *
   * O comportamento CORRETO: ao falhar a renovação, voltar a 'disconnected' (pedir reconexão).
   */
  it('token expirado e refresh RECUSADO (401): tem de pedir reconexão, não dizer que está conectado', async () => {
    semearTokens({ ...TOKENS_VALIDOS, expiresAt: Date.now() - 1000 });
    mockRefreshAsync.mockRejectedValue(new Error('invalid_grant: Token has been revoked'));

    const hook = await renderHook(() => useCalendarConnection());
    await waitFor(() => expect(hook.result.current.status).toBe('connected'));

    await act(async () => {
      await expect(hook.result.current.getAccessToken()).rejects.toThrow(/expirou|Conecte novamente/i);
    });

    // O ponto do vetor: a conexão está MORTA, então o status não pode ser 'connected'.
    expect(hook.result.current.status).not.toBe('connected');
  });

  it('rememberEmail grava o e-mail no cofre e o expõe (identidade real da conta)', async () => {
    // Conexão antiga sem e-mail (o token OAuth do app não pede escopo de e-mail): o cartão caía no
    // nome do calendário e o `connected_email` do servidor vivia null (auditoria, 02/10/2026).
    semearTokens({ ...TOKENS_VALIDOS, email: null });
    const hook = await renderHook(() => useCalendarConnection());
    await waitFor(() => expect(hook.result.current.status).toBe('connected'));
    expect(hook.result.current.email).toBeNull();

    let mudou = false;
    await act(async () => {
      mudou = await hook.result.current.rememberEmail('office@paw.test');
    });

    expect(mudou).toBe(true);
    await waitFor(() => expect(hook.result.current.email).toBe('office@paw.test'));
    expect(JSON.parse(mockCofre[CHAVE_COFRE]).email).toBe('office@paw.test');

    // Idempotente: gravar o mesmo e-mail de novo não é mudança.
    await act(async () => {
      mudou = await hook.result.current.rememberEmail('office@paw.test');
    });
    expect(mudou).toBe(false);
  });

  it('erro de REDE na renovação NÃO apaga a credencial nem diz "expired"', async () => {
    semearTokens({ ...TOKENS_VALIDOS, expiresAt: Date.now() - 1000 });
    mockRefreshAsync.mockRejectedValue(new Error('Network request failed'));

    const hook = await renderHook(() => useCalendarConnection());
    await waitFor(() => expect(hook.result.current.status).toBe('connected'));

    await act(async () => {
      await expect(hook.result.current.getAccessToken()).rejects.toThrow(/expirou|Conecte novamente/i);
    });

    // A credencial continua boa: a próxima rodada renova. Só `invalid_grant`/401 é credencial morta.
    expect(hook.result.current.status).toBe('connected');
    expect(mockCofre[CHAVE_COFRE]).toBeDefined();
  });
});
