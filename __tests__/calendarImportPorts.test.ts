/**
 * Ligação manual de um evento do Google a um cão (quando o título não casou sozinho).
 *
 * Regra travada aqui: se JÁ existe a mesma reserva no app, o certo é LIGAR o evento a ela — não
 * criar uma segunda reserva igual na agenda.
 *
 * Desde 24/09/2026 este arquivo também trava o CADASTRO que o Sync faz: `createDog` procura antes de
 * criar (era o cão duplicado a cada toque em "Sync now") e as portas de limpeza desfazem o cadastro
 * da rodada quando a reserva falha depois dele.
 */
import { escolhaDaRevisao, supabaseImportPorts } from '@/features/integrations/google/importPorts';
import type { BookingForImport, ParsedBooking } from '@/features/integrations/google/importPlan';

type Resposta = { data?: unknown; error?: { message: string } | null };

/**
 * Cliente Supabase de mentira, com o encadeamento que as portas usam
 * (`from(t).select(...).eq(...).eq(...)`, `.insert(...).select('id').single()`, `.delete().eq().eq()`).
 *
 * Cada nó é "awaitável" e responde pela resposta cujo PREFIXO mais longo casa com o caminho chamado; o
 * caminho inteiro (tabela + colunas + filtros) vai para `chamadas`, então o teste confere exatamente o
 * que foi lido e escrito, em que ordem.
 */
function clienteFalso(respostas: Record<string, Resposta> = {}, chamadas: string[] = []) {
  const no = (caminho: string): unknown => {
    const resultado = async (): Promise<Resposta> => {
      chamadas.push(caminho);
      const chave = Object.keys(respostas)
        .filter((candidata) => caminho.startsWith(candidata))
        .sort((a, b) => b.length - a.length)[0];
      return chave ? respostas[chave] : { data: [], error: null };
    };
    return {
      eq: (coluna: string, valor: unknown) => no(`${caminho}:eq(${coluna}=${String(valor)})`),
      // `select` também depois de `insert` (a porta usa `.insert(...).select('id').single()`).
      select: (colunas?: string) => no(`${caminho}:select(${colunas ?? '*'})`),
      limit: (quantidade: number) => no(`${caminho}:limit(${quantidade})`),
      single: () => resultado(),
      maybeSingle: () => resultado(),
      then: (resolve: (valor: Resposta) => unknown, reject?: (erro: unknown) => unknown) => resultado().then(resolve, reject),
    };
  };
  return {
    from: (tabela: string) => ({
      select: (colunas?: string) => no(`${tabela}:select(${colunas ?? '*'})`),
      insert: (linha: unknown) => no(`${tabela}:insert(${JSON.stringify(linha)})`),
      update: (valores: unknown) => no(`${tabela}:update(${JSON.stringify(valores)})`),
      delete: () => no(`${tabela}:delete`),
    }),
  } as never;
}

const parsed: ParsedBooking = {
  serviceType: 'boarding',
  dogName: 'Luna',
  clientName: null,
  startDate: '2026-10-05',
  endDate: '2026-10-08',
  weekdays: [],
  skipDates: [],
  openEnded: false,
};

const existente: BookingForImport = {
  id: 'r-existente',
  kind: 'reservation',
  dogId: 'dog-luna',
  googleEventId: null,
  source: 'app',
  serviceType: 'boarding',
  startDate: '2026-10-05',
  endDate: '2026-10-08',
  weekdays: [],
  skipDates: [],
  status: 'confirmed',
};

describe('escolhaDaRevisao', () => {
  it('liga o evento à reserva que já existe (nada de duplicar)', () => {
    expect(escolhaDaRevisao({ parsed, dogId: 'dog-luna', bookings: [existente] })).toEqual({ kind: 'reservation', id: 'r-existente' });
  });

  it('cria quando não existe nada igual', () => {
    expect(escolhaDaRevisao({ parsed, dogId: 'dog-luna', bookings: [] })).toEqual({ criar: true });
  });

  it('reserva parecida mas de outro cão não serve de ligação', () => {
    expect(escolhaDaRevisao({ parsed, dogId: 'dog-outro', bookings: [existente] })).toEqual({ criar: true });
  });

  it('data diferente não é a mesma reserva', () => {
    const outra = { ...existente, startDate: '2026-10-12', endDate: '2026-10-15' };
    expect(escolhaDaRevisao({ parsed, dogId: 'dog-luna', bookings: [outra] })).toEqual({ criar: true });
  });

  it('série recorrente casa por dias da semana', () => {
    const serieDoGoogle: ParsedBooking = { ...parsed, weekdays: [1, 3], openEnded: true };
    const serieExistente: BookingForImport = {
      ...existente,
      id: 'serie-1',
      kind: 'recurring',
      weekdays: [3, 1],
      status: 'active',
    };
    expect(escolhaDaRevisao({ parsed: serieDoGoogle, dogId: 'dog-luna', bookings: [serieExistente] })).toEqual({ kind: 'recurring', id: 'serie-1' });
  });
});

/**
 * O cão duplicado da org do cliente (24/09/2026): 2 cães "dog pietro" para um cliente só, porque o
 * `createDog` inseria sem procurar e o gestor tocou "Sync now" duas vezes.
 */
describe('createDog procura antes de criar', () => {
  const consulta = 'dogs:select(id, name):eq(organization_id=org-1):eq(client_id=cli-1)';

  it('reusa o cão do cadastro quando o nome normalizado bate (Filó = filo)', async () => {
    const chamadas: string[] = [];
    const client = clienteFalso({ [consulta]: { data: [{ id: 'dog-filo', name: 'Filó' }], error: null } }, chamadas);
    const ports = supabaseImportPorts(client, 'org-1');

    await expect(ports.createDog({ clientId: 'cli-1', name: 'filo' })).resolves.toEqual({ dogId: 'dog-filo', criadoAgora: false });
    // O `ilike` do Postgres não enxerga acento (o cão existe como "Filó"), então a conta é feita no
    // app — e o que importa é que NÃO houve insert.
    expect(chamadas).toEqual([consulta]);
    expect(chamadas.some((caminho) => caminho.startsWith('dogs:insert'))).toBe(false);
  });

  it('dois eventos do MESMO cão na mesma rodada criam um cão só', async () => {
    const chamadas: string[] = [];
    const client = clienteFalso({ 'dogs:insert': { data: { id: 'dog-novo' }, error: null } }, chamadas);
    const ports = supabaseImportPorts(client, 'org-1');

    const primeiro = await ports.createDog({ clientId: 'cli-1', name: 'Kona' });
    const segundo = await ports.createDog({ clientId: 'cli-1', name: 'KONA ' });

    expect(primeiro).toEqual({ dogId: 'dog-novo', criadoAgora: true });
    expect(segundo).toEqual({ dogId: 'dog-novo', criadoAgora: false });
    expect(chamadas.filter((caminho) => caminho.startsWith('dogs:insert'))).toHaveLength(1);
  });

  it('nome igual sob OUTRO cliente continua sendo outro cão (homônimo de outro tutor)', async () => {
    const chamadas: string[] = [];
    const client = clienteFalso(
      {
        'dogs:select(id, name):eq(organization_id=org-1):eq(client_id=cli-1)': { data: [{ id: 'dog-kona-1', name: 'Kona' }], error: null },
        'dogs:select(id, name):eq(organization_id=org-1):eq(client_id=cli-2)': { data: [], error: null },
        'dogs:insert': { data: { id: 'dog-kona-2' }, error: null },
      },
      chamadas,
    );
    const ports = supabaseImportPorts(client, 'org-1');

    await expect(ports.createDog({ clientId: 'cli-1', name: 'Kona' })).resolves.toEqual({ dogId: 'dog-kona-1', criadoAgora: false });
    await expect(ports.createDog({ clientId: 'cli-2', name: 'Kona' })).resolves.toEqual({ dogId: 'dog-kona-2', criadoAgora: true });
  });
});

describe('limpeza do cadastro da rodada que ficou sem reserva', () => {
  it('removeDog apaga SÓ o cão indicado, dentro da organização', async () => {
    const chamadas: string[] = [];
    const ports = supabaseImportPorts(clienteFalso({}, chamadas), 'org-1');

    await ports.removeDog?.({ dogId: 'dog-orfao' });

    expect(chamadas).toEqual(['dogs:delete:eq(id=dog-orfao):eq(organization_id=org-1)']);
  });

  it('removeClientIfEmpty NÃO apaga cliente que ainda tem cão', async () => {
    const chamadas: string[] = [];
    const client = clienteFalso({ 'dogs:select(id):eq(client_id=cli-1)': { data: [{ id: 'dog-1' }], error: null } }, chamadas);
    const ports = supabaseImportPorts(client, 'org-1');

    await ports.removeClientIfEmpty?.({ clientId: 'cli-1' });

    expect(chamadas).toEqual(['dogs:select(id):eq(client_id=cli-1):limit(1)']);
    expect(chamadas.some((caminho) => caminho.startsWith('clients:delete'))).toBe(false);
  });

  it('removeClientIfEmpty apaga o cliente que ficou sem cão nenhum', async () => {
    const chamadas: string[] = [];
    const client = clienteFalso({ 'dogs:select(id):eq(client_id=cli-1)': { data: [], error: null } }, chamadas);
    const ports = supabaseImportPorts(client, 'org-1');

    await ports.removeClientIfEmpty?.({ clientId: 'cli-1' });

    expect(chamadas).toContain('clients:delete:eq(id=cli-1):eq(organization_id=org-1)');
  });
});
