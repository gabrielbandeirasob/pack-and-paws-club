/**
 * Trava o bug relatado: "adicionei um cachorro e não aparece".
 *
 * O dado estava salvo no banco — a tela é que não recarregava, porque as abas ficam MONTADAS
 * (o `useEffect` só rodava na primeira vez). Estes testes simulam voltar para a aba e exigem
 * uma nova busca.
 */
import { render, waitFor } from '@testing-library/react-native';

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

jest.mock('@/features/clients/contactsService', () => ({
  createContactsService: () => ({ requestPermission: async () => 'granted', listContacts: async () => [] }),
}));

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...a: unknown[]) => mockGetUser(...a), getSession: async () => ({ data: { session: null } }) },
    from: (...a: unknown[]) => mockFrom(...a),
  },
}));

import ClientListScreen from '@/app/(tabs)/clients';
import CalendarScreen from '@/app/(tabs)/calendar';

/** Cadeia do PostgREST falsa: aceita select/eq/limit/order e pode ser awaited. */
function cadeia(resultado: unknown) {
  const builder: Record<string, unknown> = {};
  const mesma = () => builder;
  builder.select = mesma;
  builder.eq = mesma;
  builder.limit = mesma;
  builder.order = mesma;
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resultado).then(resolve);
  return builder;
}

beforeEach(() => {
  jest.clearAllMocks();
  focoCallback = null;
  mockGetUser.mockResolvedValue({ data: { user: { id: 'gerente-1' } } });
  mockFrom.mockImplementation((tabela: string) => {
    if (tabela === 'organization_members') return cadeia({ data: [{ organization_id: 'org-1' }], error: null });
    if (tabela === 'clients') {
      return cadeia({
        data: [
          { id: 'c1', name: 'Amor', phone: null, address_line_1: '580 California St', city: 'San Francisco', state: 'CA', active: true, dogs: [{ name: 'Filó' }, { name: 'Melanie' }] },
        ],
        error: null,
      });
    }
    if (tabela === 'dogs') {
      return cadeia({
        data: [
          { id: 'd1', name: 'Filó', client: { name: 'Amor' } },
          { id: 'd2', name: 'Melanie', client: { name: 'Amor' } },
        ],
        error: null,
      });
    }
    return cadeia({ data: [], error: null });
  });
});

describe('aba de clientes', () => {
  it('mostra os DOIS caes do mesmo cliente (era o caso relatado: só aparecia um)', async () => {
    const tela = await render(<ClientListScreen />);
    expect(await tela.findByText('Filó')).toBeTruthy();
    expect(tela.getByText('Melanie')).toBeTruthy();
  });

  it('recarrega ao voltar para a aba (o dado novo aparece sem fechar o app)', async () => {
    const contarClientes = () => mockFrom.mock.calls.filter(([t]) => t === 'clients').length;
    await render(<ClientListScreen />);
    await waitFor(() => expect(contarClientes()).toBe(1));

    focoCallback?.(); // volta para a aba depois de salvar um cao novo

    await waitFor(() => expect(contarClientes()).toBe(2));
  });
});

describe('aba de agenda (seletor de cao)', () => {
  it('recarrega os caes ao voltar para a aba', async () => {
    const contarCaes = () => mockFrom.mock.calls.filter(([t]) => t === 'dogs').length;
    await render(<CalendarScreen />);
    await waitFor(() => expect(contarCaes()).toBe(1));

    focoCallback?.();

    await waitFor(() => expect(contarCaes()).toBe(2));
  });
});
