import { fireEvent, render, waitFor } from '@testing-library/react-native';

/**
 * Tela "Activity" (só gestor) — a LEITURA da auditoria (`audit_logs`, migration 032).
 *
 * Módulo sem cobertura até aqui. O que se prova: a lista sai do mais NOVO para o mais antigo, o
 * estado vazio explica em vez de ficar em branco, um erro do banco APARECE na tela (nunca vira
 * "Nothing yet" mentiroso) e cada tipo de ação (added / changed / removed) tem o seu texto.
 *
 * Consulta falsificada (nunca rede): o `from('audit_logs')` devolve o que o teste mandar e o
 * `from('profiles')` traduz os ids de autor para nome.
 */

let mockAuditLinhas: unknown[] = [];
let mockAuditErro: string | null = null;
let mockNomes: Record<string, string> = {};
/** Cadeia por tabela, para conferir O QUE a tela pediu (ex.: ordem decrescente por id). */
const mockCadeias: Record<string, Record<string, jest.Mock>> = {};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn((tabela: string) => {
      const b: Record<string, unknown> = {};
      const mesmo = () => b;
      for (const metodo of ['select', 'eq', 'in', 'limit', 'order', 'gte']) {
        b[metodo] = jest.fn(mesmo);
      }
      const resposta = () => {
        if (tabela === 'audit_logs') {
          return mockAuditErro
            ? { data: null, error: { message: mockAuditErro } }
            : { data: mockAuditLinhas, error: null };
        }
        if (tabela === 'profiles') {
          return {
            data: Object.entries(mockNomes).map(([id, full_name]) => ({ id, full_name })),
            error: null,
          };
        }
        return { data: [], error: null };
      };
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(resposta()).then(res);
      mockCadeias[tabela] = b as Record<string, jest.Mock>;
      return b;
    }),
  },
}));

/**
 * O botão de voltar da tela (cliente, 04/10/2026): o `BackHeader` usa `useRouter` — o mock precisa
 * dele. E o espião prova que o toque volta de verdade.
 */
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useRouter: () => ({ back: mockBack, replace: mockReplace, push: jest.fn(), canGoBack: () => true }),
}));

import ActivityScreen from '@/app/activity';

/** Meia-noite local de N dias atrás — a mesma conta que a tela faz. */
function inicioDoDia(diasAtras: number): Date {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - diasAtras);
}

const ALEX = 'u-alex';

/** Três registros "reais": criação de cliente, mudança de status de parada e remoção de reserva. */
function registros() {
  const agora = new Date();
  const quando = (minutosAtras: number) => new Date(agora.getTime() - minutosAtras * 60000).toISOString();
  return [
    {
      id: 103,
      action: 'created',
      entity_type: 'clients',
      entity_id: 'c-1',
      actor_user_id: ALEX,
      created_at: quando(5),
      metadata: { after: { name: 'Ana Souza' } },
    },
    {
      id: 102,
      action: 'updated',
      entity_type: 'route_stops',
      entity_id: 's-1',
      actor_user_id: ALEX,
      created_at: quando(40),
      metadata: { changed: ['status'], before: { status: 'pending' }, after: { status: 'problem' } },
    },
    {
      id: 101,
      action: 'deleted',
      entity_type: 'reservations',
      entity_id: 'r-1',
      actor_user_id: null,
      created_at: quando(90),
      metadata: { before: {} },
    },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuditLinhas = registros();
  mockAuditErro = null;
  mockNomes = { [ALEX]: 'Alex Rivera' };
  for (const tabela of Object.keys(mockCadeias)) delete mockCadeias[tabela];
});

describe('Tela Activity (auditoria do gestor)', () => {
  it('pede os eventos do mais NOVO para o mais antigo e lista nessa ordem', async () => {
    const tela = await render(<ActivityScreen />);

    await waitFor(() => expect(tela.getByTestId('atividade-103')).toBeTruthy());

    // A consulta tem de pedir a ordem decrescente por id (o "mais novo primeiro").
    expect(mockCadeias.audit_logs.order).toHaveBeenCalledWith('id', { ascending: false });

    const cartoes = tela.getAllByTestId(/^atividade-\d+$/);
    expect(cartoes.map((cartao) => cartao.props.testID)).toEqual([
      'atividade-103',
      'atividade-102',
      'atividade-101',
    ]);
  });

  it('mostra o autor pelo nome e o texto de cada tipo de ação', async () => {
    const tela = await render(<ActivityScreen />);

    await waitFor(() => expect(tela.getByTestId('atividade-103')).toBeTruthy());

    const criacao = tela.getByTestId('atividade-103');
    expect(criacao).toHaveTextContent(/Alex Rivera/);
    expect(criacao).toHaveTextContent(/added the client Ana Souza/);

    const mudanca = tela.getByTestId('atividade-102');
    expect(mudanca).toHaveTextContent(/changed the stop — status pending → problem/);

    const remocao = tela.getByTestId('atividade-101');
    expect(remocao).toHaveTextContent(/removed the booking/);
    expect(remocao).toHaveTextContent(/the record no longer exists/);
    // Autor desconhecido nunca recebe crédito errado.
    expect(remocao).toHaveTextContent(/Someone/);
  });

  it('dia sem evento explica o vazio em vez de deixar a tela em branco', async () => {
    mockAuditLinhas = [];
    const tela = await render(<ActivityScreen />);

    await waitFor(() => expect(tela.getByText('Nothing yet')).toBeTruthy());
    expect(tela.getByText(/Actions show up here as the team works/)).toBeTruthy();
  });

  it('erro do banco APARECE na tela — nunca vira uma lista vazia mentirosa', async () => {
    mockAuditErro = 'permission denied for table audit_logs';
    const tela = await render(<ActivityScreen />);

    await waitFor(() =>
      expect(tela.getByText('permission denied for table audit_logs')).toBeTruthy(),
    );
    // O defeito que este vetor trava: mostrar "Nothing yet" (como se ninguém tivesse feito nada)
    // quando na verdade a LEITURA falhou.
    expect(tela.queryByText('Nothing yet')).toBeNull();
  });

  it('o filtro "Last 7 days" busca desde seis dias atrás (não a meia-noite de hoje)', async () => {
    const tela = await render(<ActivityScreen />);
    await waitFor(() => expect(mockCadeias.audit_logs.gte).toHaveBeenCalled());

    expect(mockCadeias.audit_logs.gte).toHaveBeenCalledWith(
      'created_at',
      inicioDoDia(0).toISOString(),
    );

    await fireEvent.press(tela.getByLabelText('Last 7 days'));

    await waitFor(() =>
      expect(mockCadeias.audit_logs.gte).toHaveBeenLastCalledWith(
        'created_at',
        inicioDoDia(6).toISOString(),
      ),
    );
  });

  /**
   * Pedido do cliente (04/10/2026): *"falta de botões pra voltar"*. A Activity era uma das telas SEM
   * nenhum caminho de saída (só um "Back" de texto no FIM da lista, que ninguém encontrava). Agora o
   * voltar está no topo, com o rótulo de leitor de tela, e volta de verdade.
   */
  it('tem o botão de voltar no topo e o toque volta para a tela anterior', async () => {
    mockBack.mockClear();
    const tela = await render(<ActivityScreen />);
    await waitFor(() => expect(tela.getByText('Activity')).toBeTruthy());

    const botao = tela.getByLabelText('Go back');
    expect(tela.getByText('‹ Back')).toBeTruthy();
    await fireEvent.press(botao);

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
