/**
 * AUTENTICAÇÃO DAS FUNÇÕES DE API PAGA (`geocode`, `travel-times`).
 *
 * Achado da auditoria de integrações (02/10/2026): as duas usam a CHAVE PAGA do Google e só exigiam
 * a anon key (pública no bundle) — qualquer um com a URL drenava a chave. A regra (extrair o Bearer e
 * decidir se há usuário logado) é pura, vive em
 * `supabase/functions/_shared/usuarioLogado.ts`, e é provada aqui.
 */
import {
  exigirUsuarioLogado,
  tokenDoCabecalho,
} from '../supabase/functions/_shared/usuarioLogado';

describe('tokenDoCabecalho', () => {
  it('extrai o token de um Bearer (maiúsculas/minúsculas e espaços extras)', () => {
    expect(tokenDoCabecalho('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(tokenDoCabecalho('bearer   abc')).toBe('abc');
    expect(tokenDoCabecalho('Bearer abc ')).toBe('abc');
  });

  it('sem Bearer válido devolve null', () => {
    expect(tokenDoCabecalho(null)).toBeNull();
    expect(tokenDoCabecalho(undefined)).toBeNull();
    expect(tokenDoCabecalho('')).toBeNull();
    expect(tokenDoCabecalho('abc')).toBeNull();
    expect(tokenDoCabecalho('Basic abc')).toBeNull();
    expect(tokenDoCabecalho('Bearer')).toBeNull();
    expect(tokenDoCabecalho('Bearer ')).toBeNull();
  });
});

describe('exigirUsuarioLogado', () => {
  it('Bearer válido e usuário existente: devolve o usuário e repassa o token', async () => {
    const verificar = jest.fn(async (token: string) => ({ id: 'user-1', token }));
    await expect(exigirUsuarioLogado('Bearer jw-token', verificar)).resolves.toEqual({ id: 'user-1' });
    expect(verificar).toHaveBeenCalledWith('jw-token');
  });

  it('sem Bearer: nem chama o verificador (não gasta Auth à toa)', async () => {
    const verificar = jest.fn(async () => ({ id: 'user-1' }));
    await expect(exigirUsuarioLogado('', verificar)).resolves.toBeNull();
    await expect(exigirUsuarioLogado(null, verificar)).resolves.toBeNull();
    expect(verificar).not.toHaveBeenCalled();
  });

  it('usuário inexistente (token inválido): null', async () => {
    await expect(exigirUsuarioLogado('Bearer x', async () => null)).resolves.toBeNull();
    await expect(exigirUsuarioLogado('Bearer x', async () => undefined)).resolves.toBeNull();
    await expect(exigirUsuarioLogado('Bearer x', async () => ({ id: '' }))).resolves.toBeNull();
    await expect(exigirUsuarioLogado('Bearer x', async () => ({ id: null }))).resolves.toBeNull();
  });

  it('erro do Auth (getUser que lança) vira null, nunca uma exceção', async () => {
    await expect(
      exigirUsuarioLogado('Bearer x', async () => {
        throw new Error('auth fora do ar');
      }),
    ).resolves.toBeNull();
  });
});
