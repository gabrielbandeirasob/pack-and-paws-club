/**
 * A ABA DO CALENDÁRIO É DO GESTOR — E A INTEGRAÇÃO DO GOOGLE TAMBÉM (05/10/2026).
 *
 * Achado dos testes de papel: o motorista NÃO tem aba Calendar (`DRIVER_TABS`, em
 * `app/(tabs)/_layout.tsx`, lista só Today's Route/Schedule/Assigned/Profile), mas a tela era
 * alcançável pela URL (build web / link direto) e o cartão do Google Calendar — que é a agenda do
 * ESCRITÓRIO — aparecia para ele, com o botão de conectar. A única proteção era a aba estar escondida.
 *
 * O que estes vetores travam, na tela real:
 *  - motorista (visão `driver`) cai na trava e é devolvido para `/(tabs)/driver`, SEM ver o cartão;
 *  - gestor (visão `manager`) vê a tela e o cartão normalmente;
 *  - conta sem vínculo ativo (`role` nulo) recebe uma frase com saída — não uma rodinha eterna
 *    (lição da vistoria de 02/10/2026 na tela do motorista: sem isso o guard nunca redireciona);
 *  - enquanto a visão carrega, ninguém vê conteúdo.
 */
import { render, waitFor } from '@testing-library/react-native';

const papel: { role: 'manager' | 'driver' | null; view: 'manager' | 'driver' | null; isLoading: boolean } = {
  role: 'driver',
  view: 'driver',
  isLoading: false,
};
const trocas: string[] = [];
const mockCard = jest.fn();

jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => papel,
}));

jest.mock('expo-router', () => ({
  router: { replace: (destino: string) => trocas.push(destino), push: jest.fn(), back: jest.fn() },
  useRouter: () => ({ push: jest.fn(), replace: (destino: string) => trocas.push(destino) }),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));

jest.mock('@/features/ui/alert', () => ({ showAlert: jest.fn() }));

jest.mock('@/features/integrations/google/CalendarConnectionCard', () => ({
  CalendarConnectionCard: (props: unknown) => {
    mockCard(props);
    return null;
  },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'gestor' } } }) },
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.gte = () => chain;
      chain.lte = () => chain;
      chain.limit = () => chain;
      chain.update = () => chain;
      chain.insert = () => chain;
      chain.delete = () => chain;
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return chain;
    },
  },
}));

import CalendarScreen from '@/app/(tabs)/calendar';

beforeEach(() => {
  jest.clearAllMocks();
  trocas.length = 0;
});

describe('a tela do calendário respeita o papel', () => {
  it('MOTORISTA: bloqueado, devolvido para a rota dele e sem o cartão do Google', async () => {
    papel.role = 'driver';
    papel.view = 'driver';
    papel.isLoading = false;

    const tela = await render(<CalendarScreen />);

    await waitFor(() => expect(trocas).toEqual(['/(tabs)/driver']));
    // Nada do escritório na tela dele: nem o cartão da integração, nem o cabeçalho da agenda.
    expect(mockCard).not.toHaveBeenCalled();
    expect(tela.queryByText('Calendar')).toBeNull();
    expect(tela.queryByText('Google Calendar')).toBeNull();
  });

  it('GESTOR: vê a tela e o cartão do Google Calendar', async () => {
    papel.role = 'manager';
    papel.view = 'manager';
    papel.isLoading = false;

    const tela = await render(<CalendarScreen />);

    await waitFor(() => expect(mockCard).toHaveBeenCalled());
    expect(trocas).toEqual([]);
    expect(tela.getByText('Calendar')).toBeTruthy();
  });

  it('conta SEM vínculo ativo: frase com saída, sem cartão e sem troca', async () => {
    papel.role = null;
    papel.view = null;
    papel.isLoading = false;

    const tela = await render(<CalendarScreen />);

    await waitFor(() => expect(tela.getByText('This account has no daycare')).toBeTruthy());
    expect(trocas).toEqual([]);
    expect(mockCard).not.toHaveBeenCalled();
  });

  it('visão ainda carregando: ninguém vê conteúdo e não há troca', async () => {
    papel.role = null;
    papel.view = null;
    papel.isLoading = true;

    const tela = await render(<CalendarScreen />);

    await waitFor(() => expect(tela.getByTestId('calendar-loading')).toBeTruthy());
    expect(trocas).toEqual([]);
    expect(mockCard).not.toHaveBeenCalled();
  });
});
