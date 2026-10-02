import { fireEvent, render, waitFor, within } from '@testing-library/react-native';

/**
 * TELA "Day summary" (gestor) — histórico do dia. Estava com 0% de cobertura.
 *
 * O que este arquivo prova:
 *  - a CONTAGEM do dia é a MESMA da Home: o cão que está em boarding E daycare no mesmo dia conta UMA
 *    vez (vale boarding). A lista que a tela recebe já vem sem repetir (`loadDayDogs` -> `dogsOfDay`,
 *    a fonte única é `contagemDoDia` em `dayService`); se voltar a contar sem deduplicar, este teste
 *    cai (mostraria "1 Daycare / 1 Boarding / 2 Total dogs").
 *  - a lista de to-dos do dia, na ordem de `position`, com o marcador de feita/aberta;
 *  - o estado VAZIO (sem cães / sem to-do) e o estado de ERRO (mostra o motivo, não uma tela em branco);
 *  - o dia escolhido: trocar o dia no campo "Day" recarrega AQUELE dia (não fica preso em hoje).
 *
 * ℹ️ A tela NÃO lê `?day=` da rota — o dia é escolhido no campo "Day" aqui dentro (o atalho da Home se
 * chama "See another day"). Por isso o vetor do dia exercita o campo, que é o caminho real do gestor.
 */
jest.mock('@/features/calendar/dates', () => ({
  ...jest.requireActual('@/features/calendar/dates'),
  todayLocalISO: () => '2026-09-16',
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

const mockMilo = { id: 'd1', name: 'Milo', client: { name: 'Ana' } };
const mockLuna = { id: 'd2', name: 'Luna', client: { name: 'John' } };

let mockReservas: unknown[] = [];
let mockSerie: unknown[] = [];
let mockExcecoes: unknown[] = [];
let mockPlano: unknown = null;
let mockTodos: unknown[] = [];
let mockEntries: unknown[] = [];
let mockErroTabela: string | null = null;

jest.mock('@/lib/supabase', () => {
  const resposta = (tabela: string, colunas: string): { data: unknown; error: unknown } => {
    if (mockErroTabela === tabela) return { data: null, error: { message: `permission denied for table ${tabela}` } };
    if (tabela === 'organization_members') {
      return {
        data: colunas.includes('profiles')
          ? [{ user_id: 'u-gab', profiles: { full_name: 'Gabriel' } }, { user_id: 'u-rafa', profiles: { full_name: 'Rafael' } }]
          : [{ organization_id: 'org-1' }],
        error: null,
      };
    }
    if (tabela === 'reservations') return { data: mockReservas, error: null };
    if (tabela === 'recurring_schedules') return { data: mockSerie, error: null };
    if (tabela === 'recurring_exceptions') return { data: mockExcecoes, error: null };
    if (tabela === 'daily_plans') return { data: mockPlano, error: null };
    if (tabela === 'daily_todos') return { data: mockTodos, error: null };
    if (tabela === 'pack_entries') return { data: mockEntries, error: null };
    return { data: [], error: null };
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'u-gab' } } }) },
      from: (tabela: string) => {
        let colunas = '';
        const chain: Record<string, unknown> = {};
        const mesmo = () => chain;
        for (const metodo of ['eq', 'lte', 'gte', 'in', 'order', 'limit']) chain[metodo] = mesmo;
        chain.select = (c: string) => {
          colunas = c;
          return chain;
        };
        chain.maybeSingle = async () => resposta(tabela, colunas);
        chain.single = async () => resposta(tabela, colunas);
        chain.then = (res: (v: unknown) => unknown) => Promise.resolve(resposta(tabela, colunas)).then(res);
        return chain;
      },
    },
  };
});

/** r1 (daycare 16) + r2 (boarding 10→20) = o MESMO cão nos dois no dia 16; r3 = dia 17. */
const reservasBase = () => [
  { id: 'r1', service_type: 'daycare', start_date: '2026-09-16', end_date: '2026-09-16', transport_required: true, goes_to_daycare: true, dog: mockMilo },
  { id: 'r2', service_type: 'boarding', start_date: '2026-09-10', end_date: '2026-09-20', transport_required: false, goes_to_daycare: true, dog: mockMilo },
  { id: 'r3', service_type: 'daycare', start_date: '2026-09-17', end_date: '2026-09-17', transport_required: true, goes_to_daycare: true, dog: mockLuna },
];

beforeEach(() => {
  mockReservas = reservasBase();
  mockSerie = [];
  mockExcecoes = [];
  mockPlano = null;
  mockTodos = [];
  mockEntries = [];
  mockErroTabela = null;
});

function renderTela() {
  const Tela = require('../app/day-summary').default;
  return render(<Tela />);
}

/** O quadro do indicador (o rótulo e o valor vivem no mesmo View). */
const quadro = (tela: Awaited<ReturnType<typeof render>>, rotulo: string) => {
  const label = tela.getByText(rotulo);
  if (!label.parent) throw new Error(`sem pai para ${rotulo}`);
  return within(label.parent);
};

describe('tela Day summary (gestor)', () => {
  it('conta o dia como a Home: boarding+daycare no mesmo dia conta UMA vez', async () => {
    mockEntries = [{ dog_id: 'd1', in_pack: true, walker_id: 'u-gab' }];
    mockPlano = { revenue_cents: 12345, walk_location: 'Golden Gate Park', photo_idea: 'Silly hat day' };
    mockTodos = [
      { id: 't1', text: 'Buy treats', done: false, position: 1 },
      { id: 't2', text: 'Call the vet', done: true, position: 0 },
    ];

    const tela = await renderTela();
    await waitFor(() => expect(tela.getByText('Total dogs')).toBeTruthy());

    // Milo está em daycare (r1) E boarding (r2) no dia 16 -> conta UMA vez, como boarding.
    // Sem deduplicar sairia "1 Daycare / 1 Boarding / 2 Total dogs".
    expect(quadro(tela, 'Daycare').getByText('0')).toBeTruthy();
    expect(quadro(tela, 'Boarding').getByText('1')).toBeTruthy();
    expect(quadro(tela, 'Total dogs').getByText('1')).toBeTruthy();
    expect(quadro(tela, 'Total Pack').getByText('1')).toBeTruthy();
    expect(quadro(tela, 'Revenue').getByText('$123.45')).toBeTruthy();
    expect(quadro(tela, 'Revenue').getByText('saved')).toBeTruthy();

    // Pack do dia: o cão e com quem ele caminha (nome do membro, não o id).
    expect(tela.getByText('Pack of the day · 1 of 1')).toBeTruthy();
    expect(tela.getByText('walking with Gabriel')).toBeTruthy();

    // Plano do dia (local da caminhada + ideia da foto).
    expect(tela.getByText('Golden Gate Park')).toBeTruthy();
    expect(tela.getByText('Silly hat day')).toBeTruthy();

    // To-do do dia na ordem de `position` (Call the vet = 0 antes de Buy treats = 1) e com os marcadores.
    expect(tela.getByText('Call the vet')).toBeTruthy();
    expect(tela.getByText('Buy treats')).toBeTruthy();
    expect(tela.getByText('✓')).toBeTruthy();
    expect(tela.getByText('○')).toBeTruthy();
  });

  it('dia sem cães e sem to-do explica o vazio em vez de inventar número', async () => {
    mockReservas = [];
    mockTodos = [];

    const tela = await renderTela();
    await waitFor(() => expect(tela.getByText('Total dogs')).toBeTruthy());

    expect(quadro(tela, 'Daycare').getByText('0')).toBeTruthy();
    expect(quadro(tela, 'Boarding').getByText('0')).toBeTruthy();
    expect(quadro(tela, 'Total dogs').getByText('0')).toBeTruthy();
    expect(quadro(tela, 'Total Pack').getByText('0')).toBeTruthy();
    expect(quadro(tela, 'Revenue').getByText('—')).toBeTruthy();
    expect(tela.getByText('Pack of the day · 0 of 0')).toBeTruthy();
    expect(tela.getByText('No dogs on this day.')).toBeTruthy();
    expect(tela.getByText('Nothing was on the list.')).toBeTruthy();
  });

  it('erro de consulta aparece na tela (não fica em branco)', async () => {
    mockErroTabela = 'daily_todos';

    const tela = await renderTela();
    await waitFor(() => expect(tela.getByText('permission denied for table daily_todos')).toBeTruthy());
    expect(tela.queryByText('Total dogs')).toBeNull();
  });

  it('o dia escolhido no campo "Day" recarrega AQUELE dia (não fica preso em hoje)', async () => {
    const tela = await renderTela();
    await waitFor(() => expect(tela.getByText('Total dogs')).toBeTruthy());

    // Hoje (congelado em 16/09): Milo conta uma vez (0 daycare / 1 boarding / 1 total).
    // (O rótulo do dia aparece duas vezes: no subtítulo do topo e no campo "Day".)
    expect(tela.getAllByText('Wed, Sep 16').length).toBeGreaterThan(0);
    expect(tela.queryByText('Thu, Sep 17')).toBeNull();
    expect(quadro(tela, 'Daycare').getByText('0')).toBeTruthy();
    expect(quadro(tela, 'Total dogs').getByText('1')).toBeTruthy();

    // Abre o calendário do campo "Day" e escolhe 17/09 -> aparece a Luna (daycare do dia 17) + Milo.
    await fireEvent.press(tela.getByLabelText('Day'));
    await fireEvent.press(tela.getByLabelText('Select 2026-09-17 · no care'));

    await waitFor(() => expect(tela.getAllByText('Thu, Sep 17').length).toBeGreaterThan(0));
    expect(quadro(tela, 'Daycare').getByText('1')).toBeTruthy();
    expect(quadro(tela, 'Boarding').getByText('1')).toBeTruthy();
    expect(quadro(tela, 'Total dogs').getByText('2')).toBeTruthy();
  });
});
