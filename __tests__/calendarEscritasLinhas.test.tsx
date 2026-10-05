/**
 * VISTORIA (02/10/2026) — ESCRITAS DA AGENDA QUE NÃO CONFERIAM LINHAS.
 *
 * Com RLS/policy, o PostgREST devolve SUCESSO com ZERO linha. Quem só olha `error` finge que gravou:
 * a reserva era dada como cancelada, a série como removida e a data como restaurada, sem o banco ter
 * mudado. Este arquivo prova, na TELA de verdade, que 0 linha = AVISO e a tela NÃO segue como sucesso.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockAlert = jest.fn();
jest.mock('@/features/ui/alert', () => ({ showAlert: (...args: unknown[]) => mockAlert(...args) }));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));

jest.mock('@/features/calendar/dates', () => ({
  ...jest.requireActual('@/features/calendar/dates'),
  todayLocalISO: () => '2026-09-28',
}));

jest.mock('@/features/integrations/google/CalendarConnectionCard', () => ({
  CalendarConnectionCard: () => null,
}));

const mockGetUser = jest.fn();
/** O que cada SELECT devolve (por tabela) e o que cada escrita devolve. `mockWriteRows = []` = policy bloqueou. */
let mockRows: Record<string, unknown[]> = {};
let mockWriteRows: unknown[] = [];

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => mockGetUser() },
    from: (tabela: string) => {
      let op = 'select';
      const b: Record<string, unknown> = {};
      const mesmo = () => b;
      for (const metodo of ['select', 'eq', 'in', 'limit', 'order', 'gte', 'lte', 'lt', 'maybeSingle', 'single']) {
        b[metodo] = mesmo;
      }
      b.update = () => { op = 'update'; return b; };
      b.delete = () => { op = 'delete'; return b; };
      b.insert = () => { op = 'insert'; return b; };
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: op === 'select' ? (mockRows[tabela] ?? []) : mockWriteRows, error: null }).then(resolve);
      return b;
    },
  },
}));

import CalendarScreen from '@/app/(tabs)/calendar';

jest.mock('@/features/auth/useOrganizationRole', () => ({
  // A tela Calendar é a aba do GESTOR (DRIVER_TABS não tem 'calendar'): a trava de papel entrou em
  // 05/10/2026 porque o cartão do Google Calendar aparecia para o motorista quando ele caía na URL.
  useOrganizationRole: () => ({ role: 'manager', view: 'manager', isLoading: false }),
}));

const hoje = '2026-09-28';
const diaSemana = new Date(`${hoje}T00:00:00Z`).getUTCDay();

const reserva = {
  id: 'r-kona', status: 'confirmed', service_type: 'daycare', start_date: hoje, end_date: hoje,
  transport_required: true, goes_to_daycare: true, google_event_id: null, source: 'app',
  dog: { id: 'kona', name: 'Kona', client: { name: 'Leigh Ann' } },
};
const serie = {
  id: 'rec-1', weekdays: [diaSemana], start_date: hoje, end_date: null, active: true,
  transport_required: false, google_event_id: null, source: 'app',
  dog: { id: 'kona', name: 'Kona', client: { name: 'Leigh Ann' } },
};

type Botao = { text: string; onPress?: () => void };
/** `showAlert(titulo, mensagem, botoes)` — o alerta chega em 3 argumentos, não num objeto. */
function ultimoAlerta(): { title?: string; message?: string; buttons?: Botao[] } {
  const [title, message, buttons] = (mockAlert.mock.calls.at(-1) ?? []) as [string, string, Botao[]];
  return { title, message, buttons };
}
async function escolher(texto: string) {
  const botoes = ultimoAlerta().buttons ?? [];
  await act(async () => { botoes.find((b) => b.text === texto)?.onPress?.(); });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'manager' } } });
  mockWriteRows = [{ id: 'ok' }];
  mockRows = {
    organization_members: [{ organization_id: 'org' }],
    reservations: [reserva],
    recurring_schedules: [],
    recurring_exceptions: [],
    dogs: [],
  };
});

it('cancelar reserva que o banco não pegou (0 linha): avisa e o cão NÃO some do dia', async () => {
  mockWriteRows = [];
  const tela = await render(<CalendarScreen />);
  await waitFor(() => expect(tela.getByLabelText('Options Kona')).toBeTruthy());

  await fireEvent.press(tela.getByLabelText('Options Kona'));
  await escolher('Remove');

  await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Unable to cancel', expect.stringContaining('did not go through')));
  // A reserva continua no dia: nada de sair como cancelada com o banco intacto.
  expect(tela.getByLabelText('Options Kona')).toBeTruthy();
  expect(mockAlert).not.toHaveBeenCalledWith('Day cancelled', expect.anything());
});

it('remover série recorrente que o banco não apagou (0 linha): avisa', async () => {
  mockRows = { ...mockRows, reservations: [], recurring_schedules: [serie] };
  mockWriteRows = [];
  const tela = await render(<CalendarScreen />);
  await waitFor(() => expect(tela.getByLabelText('Recurring options Kona')).toBeTruthy());

  await fireEvent.press(tela.getByLabelText('Recurring options Kona'));
  await escolher('Remove series');

  await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Unable to remove the series', expect.stringContaining('was not removed')));
});

it('restaurar data pausada que o banco não apagou (0 linha): avisa', async () => {
  mockRows = {
    ...mockRows,
    reservations: [],
    recurring_schedules: [serie],
    recurring_exceptions: [{ id: 'exc-1', recurring_schedule_id: 'rec-1', action: 'skip', start_date: hoje, end_date: hoje, reason: null }],
  };
  mockWriteRows = [];
  const tela = await render(<CalendarScreen />);
  await waitFor(() => expect(tela.getByLabelText('Restore Kona')).toBeTruthy());

  await fireEvent.press(tela.getByLabelText('Restore Kona'));
  await escolher('Restore');

  await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Unable to restore this date', expect.stringContaining('Nothing was restored')));
});
