import { criarFetchComRetryDeSessao } from '../lib/fetchComSessao';

/**
 * O defeito: no boot (login novo ou recarregar a página), uma consulta pode sair antes de o cliente
 * Supabase ter o token e o PostgREST devolve 401 — o app mostrava "Your account isn't linked yet"
 * e telas com números zerados. Estes vetores travam a correção: 401 ganha UMA segunda tentativa
 * com o token, e nenhum outro status é repetido.
 */
type Chamada = { url: string; autorizacao: string | null };

const resposta = (status: number) => ({ status }) as any;

function espiao(respostas: any[]) {
  const chamadas: Chamada[] = [];
  const fetchBase = async (input: any, init?: any) => {
    const cabecalhos = new Headers(init?.headers);
    chamadas.push({ url: String(input), autorizacao: cabecalhos.get('Authorization') });
    return respostas[Math.min(chamadas.length - 1, respostas.length - 1)];
  };
  return { fetchBase, chamadas };
}

describe('retry de sessão no fetch do Supabase (defeito "not linked")', () => {
  it('200 passa direto: uma única requisição', async () => {
    const { fetchBase, chamadas } = espiao([resposta(200)]);
    const fetch = criarFetchComRetryDeSessao(fetchBase, async () => 'token-novo');
    const r = await fetch('https://x.supabase.co/rest/v1/organization_members');
    expect(r.status).toBe(200);
    expect(chamadas).toHaveLength(1);
  });

  it('401 repete UMA vez com o token da sessão', async () => {
    const { fetchBase, chamadas } = espiao([resposta(401), resposta(200)]);
    const fetch = criarFetchComRetryDeSessao(fetchBase, async () => 'token-novo');
    const r = await fetch('https://x.supabase.co/rest/v1/organization_members', {
      headers: { 'Content-Type': 'application/json' },
    });
    expect(r.status).toBe(200);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0].autorizacao).toBeNull();
    expect(chamadas[1].autorizacao).toBe('Bearer token-novo');
  });

  it('nunca repete mais que uma vez (401 → 401 para)', async () => {
    const { fetchBase, chamadas } = espiao([resposta(401), resposta(401), resposta(200)]);
    const fetch = criarFetchComRetryDeSessao(fetchBase, async () => 'token-novo');
    const r = await fetch('https://x.supabase.co/rest/v1/organization_members');
    expect(r.status).toBe(401);
    expect(chamadas).toHaveLength(2);
  });

  it('sem token na sessão, devolve o 401 original (não mascara o erro)', async () => {
    const { fetchBase, chamadas } = espiao([resposta(401), resposta(200)]);
    const fetch = criarFetchComRetryDeSessao(fetchBase, async () => null);
    const r = await fetch('https://x.supabase.co/rest/v1/organization_members');
    expect(r.status).toBe(401);
    expect(chamadas).toHaveLength(1);
  });

  it('erro que não é 401 (500) não é repetido', async () => {
    const { fetchBase, chamadas } = espiao([resposta(500), resposta(200)]);
    const fetch = criarFetchComRetryDeSessao(fetchBase, async () => 'token-novo');
    const r = await fetch('https://x.supabase.co/rest/v1/organization_members');
    expect(r.status).toBe(500);
    expect(chamadas).toHaveLength(1);
  });

  it('mantém os cabeçalhos originais e troca só o Authorization', async () => {
    const { fetchBase, chamadas } = espiao([resposta(401), resposta(200)]);
    const fetch = criarFetchComRetryDeSessao(fetchBase, async () => 'token-novo');
    await fetch('https://x.supabase.co/rest/v1/organization_members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer velho' },
    });
    expect(chamadas[1].autorizacao).toBe('Bearer token-novo');
  });
});
