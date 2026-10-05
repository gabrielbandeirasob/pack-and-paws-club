/**
 * A3 DA AUDITORIA (02/10/2026): a janela de datas do Calendário usava `selectedDay`, mas o `load`
 * fechava com `[]` — ficava CONGELADA no dia da montagem. Navegar para frente não recarregava nem
 * deslocava a janela, e dias fora de ≈ hoje−30/+180 apareciam vazios.
 *
 * Prova: mudar o dia (botão Next) dispara NOVA consulta de reservas E a janela acompanha o dia novo.
 */
let focoCallback: (() => void) | null = null;

jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useFocusEffect: (cb: () => void) => {
      focoCallback = cb;
      useEffect(cb, [cb]);
    },
  };
});

jest.mock('@/features/integrations/google/useCalendarConnection', () => ({
  useCalendarConnection: () => ({
    status: 'not_configured', email: null, connect: jest.fn(), disconnect: jest.fn(), getAccessToken: jest.fn(),
  }),
}));

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...a: unknown[]) => mockGetUser(...a), getSession: async () => ({ data: { session: null } }) },
    from: (...a: unknown[]) => mockFrom(...a),
  },
}));

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { addDaysISO, todayLocalISO } from '@/features/calendar/dates';
import CalendarScreen from '@/app/(tabs)/calendar';

jest.mock('@/features/auth/useOrganizationRole', () => ({
  // A tela Calendar é a aba do GESTOR (DRIVER_TABS não tem 'calendar'): a trava de papel entrou em
  // 05/10/2026 porque o cartão do Google Calendar aparecia para o motorista quando ele caía na URL.
  useOrganizationRole: () => ({ role: 'manager', view: 'manager', isLoading: false }),
}));

const gteArgs: unknown[] = [];

/** Cadeia do PostgREST falsa: registra a janela (gte/lte) que a tela pediu. */
function cadeia(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const mesma = () => builder;
  builder.select = mesma;
  builder.eq = mesma;
  builder.in = mesma;
  builder.limit = mesma;
  builder.order = mesma;
  builder.gte = (_col: string, val: unknown) => { gteArgs.push(val); return builder; };
  builder.lte = mesma;
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resultado).then(resolve);
  return builder;
}

beforeEach(() => {
  jest.clearAllMocks();
  focoCallback = null;
  gteArgs.length = 0;
  mockGetUser.mockResolvedValue({ data: { user: { id: 'gerente-1' } } });
  mockFrom.mockImplementation((tabela: string) => {
    if (tabela === 'organization_members') return cadeia({ data: [{ organization_id: 'org-1' }], error: null });
    return cadeia({ data: [], error: null });
  });
});

describe('A3 — janela de datas do Calendário acompanha o dia escolhido', () => {
  it('avançar um dia dispara nova consulta E desloca a janela', async () => {
    const contarReservas = () => mockFrom.mock.calls.filter(([t]) => t === 'reservations').length;
    const tela = await render(<CalendarScreen />);
    await waitFor(() => expect(contarReservas()).toBe(1));

    const hoje = todayLocalISO();
    expect(gteArgs[0]).toBe(addDaysISO(hoje, -30)); // primeira carga: janela de hoje

    await fireEvent.press(tela.getByRole('button', { name: 'Next' }));

    await waitFor(() => expect(contarReservas()).toBe(2));
    const amanha = addDaysISO(hoje, 1);
    expect(gteArgs[gteArgs.length - 1]).toBe(addDaysISO(amanha, -30)); // a janela SEGUIU o dia
  });
});
