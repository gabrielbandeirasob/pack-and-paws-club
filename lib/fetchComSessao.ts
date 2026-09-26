/**
 * Cinto de segurança do boot: uma consulta disparada ANTES de o cliente Supabase terminar de
 * restaurar a sessão sai sem o token e o PostgREST responde **401**. Foi assim que apareceu a tela
 * "Your account isn't linked yet" (26/09/2026 — intermitente: 2 vezes em 16 logins, vista no
 * navegador e no app), e também consultas voltando vazias logo depois do login.
 *
 * Aqui a resposta 401 — e SÓ ela — ganha uma segunda chance: pega o token atual da sessão e repete
 * a MESMA requisição com `Authorization: Bearer <token>`. Nada de laço: no máximo 2 requisições.
 * Qualquer outro status passa direto; sem token, devolve a resposta original (não mascara erro).
 */
export type FetchLike = (input: any, init?: any) => Promise<any>;
export type ObterToken = () => Promise<string | null>;

export function criarFetchComRetryDeSessao(fetchBase: FetchLike, obterToken: ObterToken): FetchLike {
  return async (input, init) => {
    const resposta = await fetchBase(input, init);
    if (resposta?.status !== 401) return resposta;

    const token = await obterToken();
    if (!token) return resposta;

    const cabecalhos = new Headers(
      init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined),
    );
    cabecalhos.set('Authorization', `Bearer ${token}`);
    return fetchBase(input, { ...(init ?? {}), headers: cabecalhos });
  };
}
