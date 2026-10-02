/**
 * AUTENTICAÇÃO DAS FUNÇÕES DE API PAGA — lógica pura compartilhada pelas Edge Functions.
 *
 * 🚨 ACHADO DA AUDITORIA DE INTEGRAÇÕES (02/10/2026): `geocode` e `travel-times` usam a CHAVE PAGA do
 * Google (Geocoding / Routes) e não checavam QUEM chamava — só a anon key, que é pública no bundle.
 * Qualquer um com a URL gastava a chave do cliente. Agora as duas exigem um usuário LOGADO (o
 * `functions.invoke` do app manda o JWT da sessão).
 *
 * A verificação de fato é do Supabase Auth (`admin.auth.getUser(token)`); aqui vive só a REGRA
 * (extrair o Bearer e decidir se há usuário), para poder ser testada no Jest
 * (`__tests__/funcao-auth.test.ts`) — os módulos Deno não entram no Jest.
 */

/** Extrai o token de um cabeçalho `Authorization: Bearer <token>`. `null` se não for um Bearer válido. */
export function tokenDoCabecalho(authorization: string | null | undefined): string | null {
  const cabecalho = (authorization ?? '').trim();
  if (!/^Bearer\s+\S+/i.test(cabecalho)) return null;
  return cabecalho.replace(/^Bearer\s+/i, '').trim();
}

/** Verificador injetado pela função (em produção: `admin.auth.getUser`). */
export type VerificadorDeUsuario = (
  accessToken: string,
) => Promise<{ id?: string | null } | null | undefined>;

/**
 * Devolve o usuário logado ou `null`. Nunca lança: cabeçalho ausente, token inválido, erro do Auth —
 * tudo cai em `null` (a função responde 401).
 */
export async function exigirUsuarioLogado(
  authorization: string | null | undefined,
  verificar: VerificadorDeUsuario,
): Promise<{ id: string } | null> {
  const token = tokenDoCabecalho(authorization);
  if (!token) return null;
  try {
    const usuario = await verificar(token);
    const id = (usuario?.id ?? '').trim();
    return id.length > 0 ? { id } : null;
  } catch {
    return null;
  }
}
