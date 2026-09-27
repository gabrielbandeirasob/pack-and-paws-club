/**
 * CREDENCIAL DO GOOGLE NO SERVIDOR (áudio do dono, 27/09/2026 + autorização de 27/09/2026).
 *
 * O que se prova aqui é o CONTRATO do aparelho com a função `google-calendar-token`: o app pergunta
 * se o servidor tem credencial, manda o token do Keychain quando não tem, e revoga ao desconectar —
 * nunca explodindo (sem rede o app tem de continuar funcionando com a credencial só no aparelho).
 */
jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));
jest.mock('@/features/integrations/google/tokenStore', () => ({
  loadTokens: jest.fn(),
}));

import { supabase } from '@/lib/supabase';
import { loadTokens } from '@/features/integrations/google/tokenStore';
import {
  enviarCredencialAoServidor,
  revogarCredencialDoServidor,
  servidorTemCredencial,
} from '@/features/integrations/google/serverCredential';

const invoke = supabase.functions.invoke as jest.Mock;
const tokens = loadTokens as jest.Mock;

const TOKEN = '1//refresh-token-de-prova-com-tamanho-suficiente-0123456789';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('servidorTemCredencial', () => {
  it('pergunta pelo check e devolve o booleano da função', async () => {
    invoke.mockResolvedValue({ data: { ok: true, has_credential: true }, error: null });
    await expect(servidorTemCredencial()).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('google-calendar-token', { body: { check: true } });
  });

  it('sem credencial no servidor, devolve false', async () => {
    invoke.mockResolvedValue({ data: { ok: true, has_credential: false }, error: null });
    await expect(servidorTemCredencial()).resolves.toBe(false);
  });

  it('função fora do ar devolve null (não é "não tem") — senão o app reenviaria token em looping', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'Failed to send a request' } });
    await expect(servidorTemCredencial()).resolves.toBeNull();
    invoke.mockRejectedValue(new Error('sem rede'));
    await expect(servidorTemCredencial()).resolves.toBeNull();
  });
});

describe('enviarCredencialAoServidor', () => {
  it('manda o refresh token do aparelho com o e-mail e o calendário escolhido', async () => {
    tokens.mockResolvedValue({ accessToken: 'a', refreshToken: TOKEN, expiresAt: 0, email: 'office@paw.test' });
    invoke.mockResolvedValue({ data: { ok: true }, error: null });

    await expect(enviarCredencialAoServidor('cal@group.calendar.google.com')).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('google-calendar-token', {
      body: {
        refresh_token: TOKEN,
        email: 'office@paw.test',
        calendar_id: 'cal@group.calendar.google.com',
      },
    });
  });

  it('sem refresh token no aparelho não chama a função (nada para mandar)', async () => {
    tokens.mockResolvedValue({ accessToken: 'a', refreshToken: null, expiresAt: 0 });
    await expect(enviarCredencialAoServidor()).resolves.toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('token curto demais (lixo) também não vai', async () => {
    tokens.mockResolvedValue({ accessToken: 'a', refreshToken: 'curto', expiresAt: 0 });
    await expect(enviarCredencialAoServidor()).resolves.toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('função recusando devolve false, sem exceção', async () => {
    tokens.mockResolvedValue({ accessToken: 'a', refreshToken: TOKEN, expiresAt: 0 });
    invoke.mockResolvedValue({ data: null, error: { message: '403' } });
    await expect(enviarCredencialAoServidor()).resolves.toBe(false);
  });
});

describe('revogarCredencialDoServidor', () => {
  it('pede a revogação', async () => {
    invoke.mockResolvedValue({ data: { ok: true, revoked: true }, error: null });
    await expect(revogarCredencialDoServidor()).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('google-calendar-token', { body: { revoke: true } });
  });

  it('falha de rede na revogação não derruba a tela de desconectar', async () => {
    invoke.mockRejectedValue(new Error('sem rede'));
    await expect(revogarCredencialDoServidor()).resolves.toBe(false);
  });
});
