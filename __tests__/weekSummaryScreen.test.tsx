import { fireEvent, render, waitFor, within } from '@testing-library/react-native';

/**
 * TELA "Weekly summary" (gestor) — resumo domingo→sábado (7 dias; a semana mudou em 06/10/2026, quando o
 * dono viu no TestFlight que faltava um dia). Estava com 0% de cobertura.
 *
 * O que este arquivo prova:
 *  - os NÚMEROS por dia da semana (os chips) e os TOTAIS ("N dogs this week" / "N visits in total");
 *  - a lista por cão, com em que dias veio e o serviço de cada dia;
 *  - o dia CANCELADO (dono, 13/10/2026): aparece marcado no cartão do cão, conta em "visits cancelled"
 *    e NÃO entra no número de quem veio;
 *  - o estado VAZIO ("No dogs came this week.") — semana sem cão mostra 0, não inventa número;
 *  - o estado de ERRO não mostra número nenhum (nenhum chip, nenhum total);
 *  - a TROCA de semana pelas setas ‹ › (e o "This week" para voltar), recarregando os DIAS daquela semana.
 *
 * `todayLocalISO` é fixado em 16/09/2026 (quarta) -> semana mostrada = domingo 13 a sábado 19.
 */
jest.mock('@/features/calendar/dates', () => ({
  ...jest.requireActual('@/features/calendar/dates'),
  todayLocalISO: () => '2026-09-16',
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  // A tela recarrega no foco; aqui o efeito roda de novo quando o callback muda (troca de semana).
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    (require('react') as typeof import('react')).useEffect(callback, [callback]);
  },
}));

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({ role: 'manager', view: 'manager', isLoading: false }),
}));

const mockLoadWeek = jest.fn();
jest.mock('@/features/dashboard/dayService', () => ({
  loadWeek: (...args: unknown[]) => mockLoadWeek(...args),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: () => {
      const chain: Record<string, unknown> = {};
      const mesmo = () => chain;
      for (const metodo of ['select', 'eq', 'in', 'lte', 'gte', 'order', 'limit']) chain[metodo] = mesmo;
      chain.maybeSingle = async () => ({ data: { organization_id: 'org-1' }, error: null });
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [{ organization_id: 'org-1' }], error: null }).then(res);
      return chain;
    },
  },
}));

const milo = { dogId: 'd1', dogName: 'Milo', clientName: 'Ana', serviceType: 'daycare' as const };
const luna = { dogId: 'd2', dogName: 'Luna', clientName: 'John', serviceType: 'boarding' as const };

/** Cães por dia que `loadWeek` devolve (a tela pede a semana dela e recebe esses). */
let mockDados: Record<string, unknown[]> = {};
/** Quem foi CANCELADO em cada dia (`cancelledByDay`) — o vermelho do Google. */
let mockCancelados: Record<string, unknown[]> = {};

beforeEach(() => {
  mockDados = {};
  mockCancelados = {};
  mockLoadWeek.mockReset();
  mockLoadWeek.mockImplementation(async (_client: unknown, _org: string, dias: string[]) => ({
    dogsByDay: Object.fromEntries(dias.map((dia) => [dia, mockDados[dia] ?? []])),
    cancelledByDay: Object.fromEntries(dias.map((dia) => [dia, mockCancelados[dia] ?? []])),
  }));
});

function renderTela() {
  const Tela = require('../app/week-summary').default;
  return render(<Tela />);
}

/** O chip do dia (o rótulo "Mon 14" e o número vivem no mesmo View; o chip vem ANTES dos cartões). */
const chip = (tela: Awaited<ReturnType<typeof render>>, label: string) => {
  const nodes = tela.getAllByText(label);
  const primeiro = nodes[0];
  if (!primeiro.parent) throw new Error(`sem pai para o chip ${label}`);
  return within(primeiro.parent);
};

/** O cartão do cão (nome + "N days" + cliente + dias). */
const cartao = (tela: Awaited<ReturnType<typeof render>>, nome: string) => {
  const node = tela.getByText(nome);
  if (!node.parent?.parent) throw new Error(`sem cartão para ${nome}`);
  return within(node.parent.parent);
};

describe('tela Weekly summary (gestor)', () => {
  it('mostra os números de cada dia, os totais e os dias de cada cão', async () => {
    mockDados = {
      '2026-09-14': [milo],
      '2026-09-16': [milo, luna],
      '2026-09-18': [milo],
    };

    const tela = await renderTela();
    await waitFor(() => expect(tela.getByText('2 dogs this week')).toBeTruthy());

    expect(tela.getByText('SEPTEMBER 13 – 19')).toBeTruthy();
    // números por dia (chips): Sun=0, Mon=1, Tue=0, Wed=2, Thu=0, Fri=1, Sat=0
    expect(chip(tela, 'Sun 13').getByText('0')).toBeTruthy();
    expect(chip(tela, 'Mon 14').getByText('1')).toBeTruthy();
    expect(chip(tela, 'Tue 15').getByText('0')).toBeTruthy();
    expect(chip(tela, 'Wed 16').getByText('2')).toBeTruthy();
    expect(chip(tela, 'Thu 17').getByText('0')).toBeTruthy();
    expect(chip(tela, 'Fri 18').getByText('1')).toBeTruthy();
    expect(chip(tela, 'Sat 19').getByText('0')).toBeTruthy();

    // totais: 2 cães diferentes, 4 visitas (Milo 3 dias + Luna 1 dia)
    expect(tela.getByText('4 visits in total')).toBeTruthy();

    // cartões por cão
    expect(cartao(tela, 'Milo').getByText('Ana')).toBeTruthy();
    expect(cartao(tela, 'Milo').getByText('3 days')).toBeTruthy();
    expect(cartao(tela, 'Milo').getAllByText('Daycare')).toHaveLength(3);
    expect(cartao(tela, 'Luna').getByText('John')).toBeTruthy();
    expect(cartao(tela, 'Luna').getByText('1 day')).toBeTruthy();
    expect(cartao(tela, 'Luna').getByText('Boarding')).toBeTruthy();
  });

  it('semana sem cão mostra zero em tudo (não inventa número)', async () => {
    const tela = await renderTela();

    await waitFor(() => expect(tela.getByText('No dogs came this week.')).toBeTruthy());
    expect(tela.getByText('0 dogs this week')).toBeTruthy();
    expect(tela.getByText('0 visits in total')).toBeTruthy();
    // os SETE chips mostram 0 (domingo a sábado)
    expect(tela.getAllByText('0')).toHaveLength(7);
  });

  it('erro ao carregar a semana não mostra número nenhum', async () => {
    mockLoadWeek.mockRejectedValueOnce(new Error('Could not reach the office'));

    const tela = await renderTela();

    await waitFor(() => expect(tela.getByText('Could not reach the office')).toBeTruthy());
    expect(tela.queryByText('0 dogs this week')).toBeNull();
    expect(tela.queryByText('Mon 14')).toBeNull();
  });

  it('as setas trocam a semana e recarregam os DIAS daquela semana', async () => {
    mockDados = {
      '2026-09-14': [milo],
      '2026-09-21': [milo, luna],
    };

    const tela = await renderTela();
    await waitFor(() => expect(tela.getByText('1 dog this week')).toBeTruthy());
    expect(tela.getByText('SEPTEMBER 13 – 19')).toBeTruthy();

    // ‹ semana anterior (06–12): vazia -> 0 cães
    await fireEvent.press(tela.getByLabelText('Previous week'));
    await waitFor(() => expect(tela.getByText('SEPTEMBER 6 – 12')).toBeTruthy());
    await waitFor(() => expect(tela.getByText('0 dogs this week')).toBeTruthy());

    // › volta para a semana de hoje: 1 cão
    await fireEvent.press(tela.getByLabelText('Next week'));
    await waitFor(() => expect(tela.getByText('SEPTEMBER 13 – 19')).toBeTruthy());
    await waitFor(() => expect(tela.getByText('1 dog this week')).toBeTruthy());

    // › próxima semana (21–26): 2 cães
    await fireEvent.press(tela.getByLabelText('Next week'));
    await waitFor(() => expect(tela.getByText('SEPTEMBER 20 – 26')).toBeTruthy());
    await waitFor(() => expect(tela.getByText('2 dogs this week')).toBeTruthy());

    // a tela pediu os dias da semana CERTA (não recarregou hoje de novo)
    const ultimaChamada = mockLoadWeek.mock.calls.at(-1);
    expect(ultimaChamada?.[2]).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);

    // fora da semana atual aparece o "This week" para voltar
    await fireEvent.press(tela.getByLabelText('Back to this week'));
    await waitFor(() => expect(tela.getByText('SEPTEMBER 13 – 19')).toBeTruthy());
    expect(tela.getByText('1 dog this week')).toBeTruthy();
  });

  it('tocar num chip de dia filtra a lista daquele dia, e tocar de novo volta à semana', async () => {
    mockDados = {
      '2026-09-14': [milo],
      '2026-09-16': [milo, luna],
      '2026-09-18': [milo],
    };

    const tela = await renderTela();
    await waitFor(() => expect(tela.getByText('2 dogs this week')).toBeTruthy());

    // semana inteira: os dois cães aparecem
    expect(tela.getByText('Milo')).toBeTruthy();
    expect(tela.getByText('Luna')).toBeTruthy();

    // toca no chip do MON 14 — só o Milo veio nesse dia
    await fireEvent.press(tela.getByLabelText('Mon 14 — 1 dog'));
    await waitFor(() => expect(tela.getByText('Showing only this day of the week.')).toBeTruthy());
    expect(tela.getByText('Mon 14 — 1 dog')).toBeTruthy();
    expect(tela.getByText('Milo')).toBeTruthy();
    expect(tela.queryByText('Luna')).toBeNull();
    expect(tela.queryByText('2 dogs this week')).toBeNull();

    // o chip do dia escolhido fica marcado como selecionado
    expect(tela.getByLabelText('Mon 14 — 1 dog').props.accessibilityState?.selected).toBe(true);

    // toca DE NOVO no mesmo chip: volta para a semana inteira
    await fireEvent.press(tela.getByLabelText('Mon 14 — 1 dog'));
    await waitFor(() => expect(tela.getByText('2 dogs this week')).toBeTruthy());
    expect(tela.getByText('Luna')).toBeTruthy();
  });

  it('dia escolhido sem cão diz que ninguém veio naquele dia (não fica em branco)', async () => {
    mockDados = { '2026-09-16': [milo] };

    const tela = await renderTela();
    await waitFor(() => expect(tela.getByText('1 dog this week')).toBeTruthy());

    // THU 17 não teve cão; o chip mostra 0 e o toque diz isso por extenso
    await fireEvent.press(tela.getByLabelText('Thu 17 — 0 dogs'));
    await waitFor(() => expect(tela.getByText('No dogs came on Thu 17.')).toBeTruthy());
    expect(tela.queryByText('Milo')).toBeNull();

    // o botão "Show whole week" devolve a semana e o cão volta à lista
    await fireEvent.press(tela.getByLabelText('Show whole week'));
    await waitFor(() => expect(tela.getByText('1 dog this week')).toBeTruthy());
    expect(tela.getByText('Milo')).toBeTruthy();
  });

  /**
   * PEDIDO DO DONO (13/10/2026): *"quero que quando esteja vermelho do Google calendário cancele como já
   * fazia antes mas agora apareça no weekly summary que foi cancelado"*.
   */
  it('dia cancelado aparece marcado no cartão do cão e não conta como visita', async () => {
    mockDados = { '2026-09-14': [milo], '2026-09-16': [milo] };
    mockCancelados = { '2026-09-18': [{ dogId: 'd1', dogName: 'Milo', clientName: 'Ana', serviceType: 'daycare' }] };

    const tela = await renderTela();
    await waitFor(() => expect(tela.getByText('1 dog this week')).toBeTruthy());

    // o número do dia é quem VEIO: sexta continua 0 mesmo com o cancelamento do Milo
    expect(chip(tela, 'Fri 18').getByText('0')).toBeTruthy();
    expect(tela.getByText('2 visits in total')).toBeTruthy();
    expect(tela.getByText('1 visit cancelled')).toBeTruthy();

    // o cartão do Milo mostra os 2 dias que ele veio E o dia cancelado, marcado
    expect(cartao(tela, 'Milo').getByText('2 days')).toBeTruthy();
    expect(cartao(tela, 'Milo').getByText('1 cancelled')).toBeTruthy();
    expect(cartao(tela, 'Milo').getByText('Cancelled')).toBeTruthy();
    expect(tela.getByLabelText('Fri 18 — cancelled')).toBeTruthy();
    // e o chip daquele dia diz o cancelamento para quem usa leitor de tela
    expect(tela.getByLabelText('Fri 18 — 0 dogs, 1 cancelled')).toBeTruthy();
  });

  it('cão que só foi cancelado na semana continua na lista (não some)', async () => {
    mockCancelados = { '2026-09-18': [{ dogId: 'd2', dogName: 'Luna', clientName: 'John', serviceType: 'boarding' }] };

    const tela = await renderTela();
    await waitFor(() => expect(tela.getByText('0 dogs this week')).toBeTruthy());

    expect(tela.getByText('0 visits in total')).toBeTruthy();
    expect(tela.getByText('1 visit cancelled')).toBeTruthy();
    // o cão cancelado está na lista, com o cartão sem "dias que veio" e com o cancelamento
    expect(tela.getByText('Luna')).toBeTruthy();
    expect(cartao(tela, 'Luna').getByText('1 cancelled')).toBeTruthy();
    expect(cartao(tela, 'Luna').getByText('Cancelled')).toBeTruthy();
    expect(cartao(tela, 'Luna').queryByText('1 day')).toBeNull();
  });

  it('tocar no chip de um dia só cancelado mostra o cão cancelado (e não "ninguém veio")', async () => {
    mockDados = { '2026-09-16': [milo] };
    mockCancelados = { '2026-09-17': [{ dogId: 'd2', dogName: 'Luna', clientName: 'John', serviceType: 'daycare' }] };

    const tela = await renderTela();
    await waitFor(() => expect(tela.getByText('1 dog this week')).toBeTruthy());

    await fireEvent.press(tela.getByLabelText('Thu 17 — 0 dogs, 1 cancelled'));

    await waitFor(() => expect(tela.getByText('Thu 17 — 0 dogs · 1 cancelled')).toBeTruthy());
    expect(tela.getByText('Luna')).toBeTruthy();
    expect(cartao(tela, 'Luna').getByText('Cancelled')).toBeTruthy();
    expect(tela.queryByText('No dogs came on Thu 17.')).toBeNull();
  });
});
