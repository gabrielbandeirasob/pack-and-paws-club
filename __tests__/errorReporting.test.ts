/**
 * Testes do monitoramento de erros: o que sai do aparelho, o que NAO pode sair
 * (dado sensivel) e o comportamento quando o banco esta fora.
 */
const mockInsert = jest.fn();
const mockFrom = jest.fn();
const mockGetSession = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => mockFrom(...a),
    auth: { getSession: (...a: unknown[]) => mockGetSession(...a) },
  },
}));

jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0' } }));

import {
  buildErrorReport,
  normalizeErrorMessage,
  normalizeErrorStack,
  sanitizeContext,
} from '@/features/errors/errorPayload';
import { installGlobalErrorHandler, reportError } from '@/features/errors/errorReporter';

function cenarioBanco(opts: { org?: string | null; falhaInsert?: boolean } = {}) {
  mockFrom.mockImplementation((tabela: string) => {
    if (tabela === 'organization_members') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              limit: () => ({ maybeSingle: async () => ({ data: opts.org ? { organization_id: opts.org } : null }) }),
            }),
          }),
        }),
      };
    }
    return { insert: mockInsert };
  });
  mockInsert.mockResolvedValue({ error: opts.falhaInsert ? { message: 'rls' } : null });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  cenarioBanco({ org: 'o1' });
});

describe('montagem do relatorio', () => {
  it('normaliza a mensagem', () => {
    expect(normalizeErrorMessage(new Error('falhou ao salvar'))).toBe('falhou ao salvar');
    expect(normalizeErrorMessage('texto solto')).toBe('texto solto');
    expect(normalizeErrorMessage(null)).toBe('erro sem mensagem');
    expect(normalizeErrorMessage(new Error(''))).toBe('erro sem mensagem');
    expect(normalizeErrorMessage('x'.repeat(900)).length).toBe(501); // 500 + reticencias
  });

  it('limita a pilha', () => {
    expect(normalizeErrorStack(new Error('x'))).toContain('Error: x');
    expect(normalizeErrorStack(null)).toBeNull();
    expect(normalizeErrorStack('y'.repeat(9000))!.length).toBeLessThan(4100);
  });

  it('NAO deixa passar dado sensivel no contexto', () => {
    const limpo = sanitizeContext({
      origem: 'boundary',
      appState: 'active',
      gateCode: '4821',
      access_code: '9999',
      pickup_access_instructions: 'Dog is in the backyard',
      password: 'segredo',
      pushToken: 'ExponentPushToken[abc]',
      anotacao: 'x'.repeat(400),
    });
    expect(limpo).toEqual({ origem: 'boundary', appState: 'active', anotacao: `${'x'.repeat(200)}…` });
    expect(JSON.stringify(limpo)).not.toContain('4821');
    expect(JSON.stringify(limpo)).not.toContain('segredo');
    expect(JSON.stringify(limpo)).not.toContain('backyard');
  });

  it('monta o relatorio completo', () => {
    const rel = buildErrorReport({
      error: new Error('quebrou'),
      context: { origem: 'global' },
      userId: 'u1',
      organizationId: 'o1',
      appVersion: '1.0.0',
      platform: 'ios',
    });
    expect(rel.message).toBe('quebrou');
    expect(rel.user_id).toBe('u1');
    expect(rel.organization_id).toBe('o1');
    expect(rel.platform).toBe('ios');
    expect(rel.context).toEqual({ origem: 'global' });
  });
});

describe('envio para o banco', () => {
  it('grava o erro com usuario e organizacao', async () => {
    const ok = await reportError(new Error('quebrou'), { origem: 'boundary' });
    expect(ok).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('client_errors');
    const linha = mockInsert.mock.calls[0][0];
    expect(linha.message).toBe('quebrou');
    expect(linha.user_id).toBe('u1');
    expect(linha.organization_id).toBe('o1');
    expect(linha.platform).toBe('ios');
  });

  it('devolve false quando o banco recusa (sem derrubar o app)', async () => {
    cenarioBanco({ org: 'o1', falhaInsert: true });
    await expect(reportError(new Error('x'))).resolves.toBe(false);
  });

  it('nao quebra quando nem tem sessao', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    cenarioBanco({ org: null });
    await expect(reportError(new Error('sem login'))).resolves.toBe(true);
    expect(mockInsert.mock.calls[0][0].user_id).toBeNull();
  });

  it('nao quebra se a rede cair no meio', async () => {
    mockGetSession.mockRejectedValue(new Error('offline'));
    await expect(reportError(new Error('x'))).resolves.toBe(false);
  });
});

describe('captura global', () => {
  it('instala o handler uma unica vez', () => {
    const setGlobalHandler = jest.fn();
    (globalThis as unknown as { ErrorUtils?: unknown }).ErrorUtils = { setGlobalHandler, getGlobalHandler: () => jest.fn() };
    installGlobalErrorHandler();
    installGlobalErrorHandler();
    expect(setGlobalHandler).toHaveBeenCalledTimes(1);
  });
});
