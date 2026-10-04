import { fireEvent, render, waitFor } from '@testing-library/react-native';

/**
 * TELA "Route history" (gestor) — histórico do que foi executado nas rotas. Estava com 0% de cobertura.
 *
 * O que este arquivo prova:
 *  - a lista das rotas com data, status, MOTORISTA e resumo das paradas;
 *  - o nome do motorista vem de uma consulta que inclui `driver` E `manager` (desde 27/09/2026 o gestor
 *    também dirige): se ela voltar a trazer só `driver`, a rota do gestor aparece como "Driver" —
 *    este teste cai (o gestor tem de aparecer com o NOME);
 *  - o estado VAZIO e o estado de ERRO.
 */
const mockVoltar = jest.fn();

jest.mock('expo-router', () => ({
  router: { back: mockVoltar, push: jest.fn() },
  // A tela usa o `BackHeader` (botão de voltar do cliente, 04/10/2026): ele navega por `useRouter`.
  useRouter: () => ({ back: mockVoltar, replace: jest.fn(), push: jest.fn(), canGoBack: () => true }),
}));

let mockRotas: unknown[] = [];
let mockMembros: unknown[] = [];
let mockErro: string | null = null;

jest.mock('@/lib/supabase', () => {
  const resposta = (tabela: string, colunas: string, roles: string[] | null): { data: unknown; error: unknown } => {
    if (tabela === 'organization_members') {
      // Espelha a consulta REAL: a tela pede `role in (driver, manager)` — o filtro manda no resultado,
      // então um mero `role = driver` deixaria o gestor de fora (era o defeito corrigido em 28/09/2026).
      const membros = roles ? (mockMembros as { user_id: string; role: string }[]).filter((m) => roles.includes(m.role)) : mockMembros;
      return { data: colunas.includes('profiles') ? membros : [{ organization_id: 'org-1' }], error: null };
    }
    if (tabela === 'routes') {
      if (mockErro) return { data: null, error: { message: mockErro } };
      return { data: mockRotas, error: null };
    }
    return { data: [], error: null };
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
      from: (tabela: string) => {
        let colunas = '';
        let roles: string[] | null = null;
        const chain: Record<string, unknown> = {};
        const mesmo = () => chain;
        for (const metodo of ['eq', 'order', 'limit', 'gte', 'lte']) chain[metodo] = mesmo;
        chain.in = (coluna: string, valores: string[]) => {
          if (coluna === 'role') roles = valores;
          return chain;
        };
        chain.select = (c: string) => {
          colunas = c;
          return chain;
        };
        chain.maybeSingle = async () => resposta(tabela, colunas, roles);
        chain.then = (res: (v: unknown) => unknown) => Promise.resolve(resposta(tabela, colunas, roles)).then(res);
        return chain;
      },
    },
  };
});

const rotasBase = () => [
  { id: 'rt-1', route_date: '2026-09-16', status: 'completed', driver_id: 'u-driver', route_stops: [{ status: 'completed' }, { status: 'skipped' }] },
  { id: 'rt-2', route_date: '2026-09-15', status: 'published', driver_id: 'u-manager', route_stops: [{ status: 'completed' }, { status: 'pending' }] },
  { id: 'rt-3', route_date: '2026-09-14', status: 'draft', driver_id: 'u-ghost', route_stops: [] },
];

const membrosBase = () => [
  { user_id: 'u-driver', role: 'driver', profiles: { full_name: 'Rafael' } },
  { user_id: 'u-manager', role: 'manager', profiles: { full_name: 'Gabriel' } },
];

beforeEach(() => {
  mockRotas = rotasBase();
  mockMembros = membrosBase();
  mockErro = null;
  mockVoltar.mockClear();
});

function renderTela() {
  const Tela = require('../app/route-history').default;
  return render(<Tela />);
}

describe('tela Route history (gestor)', () => {
  it('lista as rotas com status, motorista e resumo das paradas', async () => {
    const tela = await renderTela();
    await waitFor(() => expect(tela.getByText('Rafael')).toBeTruthy());

    // dados e status de cada rota
    expect(tela.getByText('2026-09-16')).toBeTruthy();
    expect(tela.getByText('2026-09-15')).toBeTruthy();
    expect(tela.getByText('2026-09-14')).toBeTruthy();
    expect(tela.getByText('Completed')).toBeTruthy();
    expect(tela.getByText('Published')).toBeTruthy();
    expect(tela.getByText('Draft')).toBeTruthy();

    // resumo das paradas
    expect(tela.getByText('1/2 stops · 1 skipped')).toBeTruthy();
    expect(tela.getByText('1/2 stops · 1 pending')).toBeTruthy();
    expect(tela.getByText('0/0 stops')).toBeTruthy();
  });

  it('o GESTOR que também dirige aparece com o NOME, não "Driver"', async () => {
    const tela = await renderTela();
    await waitFor(() => expect(tela.getByText('Rafael')).toBeTruthy());

    // Rafael (driver) e Gabriel (manager) aparecem com nome.
    expect(tela.getByText('Gabriel')).toBeTruthy();
    // Só a rota do motorista DESCONHECIDO cai no rótulo genérico — exatamente UMA.
    expect(tela.getAllByText('Driver')).toHaveLength(1);
  });

  it('sem rota nenhuma explica o vazio', async () => {
    mockRotas = [];
    mockMembros = [];
    const tela = await renderTela();

    await waitFor(() => expect(tela.getByText(/No routes yet/)).toBeTruthy());
  });

  it('erro da consulta aparece na tela (não mostra lista vazia como se fosse verdade)', async () => {
    mockErro = 'permission denied for table routes';
    const tela = await renderTela();

    await waitFor(() => expect(tela.getByText('permission denied for table routes')).toBeTruthy());
    expect(tela.queryByText(/No routes yet/)).toBeNull();
  });

  it('o botão de voltar chama router.back', async () => {
    const tela = await renderTela();
    await waitFor(() => expect(tela.getByLabelText('Go back')).toBeTruthy());

    await fireEvent.press(tela.getByLabelText('Go back'));
    expect(mockVoltar).toHaveBeenCalled();
  });
});
