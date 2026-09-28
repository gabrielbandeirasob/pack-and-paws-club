import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { LocalReservation } from '@/features/integrations/google/calendarSync';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/features/calendar/dates', () => ({
  ...jest.requireActual('@/features/calendar/dates'), todayLocalISO: () => '2026-09-28',
}));
const mockAlert = jest.fn();
jest.mock('@/features/ui/alert', () => ({ showAlert: (...args: unknown[]) => mockAlert(...args) }));
const mockCard = jest.fn();
jest.mock('@/features/integrations/google/CalendarConnectionCard', () => ({
  CalendarConnectionCard: (props: unknown) => { mockCard(props); return null; },
}));
const mockFrom = jest.fn();
const mockGetUser = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: () => mockGetUser() }, from: (table: string) => mockFrom(table),
} }));
import CalendarScreen from '@/app/(tabs)/calendar';

const row = { id: 'r-kona', status: 'confirmed', service_type: 'daycare', start_date: '2026-09-28',
  end_date: '2026-09-28', transport_required: true, google_event_id: 'g-kona', source: 'google',
  dog: { id: 'kona', name: 'Kona', client: { name: 'Leigh Ann' } } };
const mockUpdate = jest.fn();
const mockEq = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'manager' } } });
  mockUpdate.mockReturnValue({ eq: mockEq });
  mockEq.mockResolvedValue({ error: null });
  mockFrom.mockImplementation((table: string) => {
    let statuses: string[] = [];
    const chain = {
      select: () => chain, eq: () => chain, limit: () => chain,
      in: (column: string, values: string[]) => { expect(column).toBe('status'); statuses = values; return chain; },
      update: mockUpdate,
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ error: null, data:
        table === 'organization_members' ? [{ organization_id: 'org' }] :
        table === 'reservations' ? [row, { ...row, id: 'r-cancelled', status: 'cancelled',
          dog: { ...row.dog, id: 'agnes', name: 'Agnes' } }].filter((r) => statuses.includes(r.status)) : [] }).then(resolve),
    };
    return chain;
  });
});

async function remove(tela: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(tela.getByLabelText('Options Kona'));
  const buttons = mockAlert.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  await act(async () => { buttons.find((button) => button.text === 'Remove')?.onPress?.(); });
}

it('Remove cancela sem DELETE e atualiza o dia e o espelho antes de terminar a recarga', async () => {
  const tela = await render(<CalendarScreen />);
  await waitFor(() => expect(tela.getByLabelText('Options Kona')).toBeTruthy());
  expect(tela.queryByLabelText('Options Agnes')).toBeNull();
  // Recarga fica pendente: a saída do cão deve vir da atualização local após salvar.
  mockGetUser.mockImplementation(() => new Promise(() => {}));
  await remove(tela);
  await waitFor(() => expect(tela.queryByLabelText('Options Kona')).toBeNull());
  expect(mockUpdate).toHaveBeenCalledWith({ status: 'cancelled' });
  expect(mockEq).toHaveBeenCalledWith('id', 'r-kona');
  expect(mockAlert).toHaveBeenLastCalledWith('Day cancelled', expect.stringContaining('next Sync'));
  const props = mockCard.mock.calls.at(-1)?.[0] as { reservations: LocalReservation[] };
  expect(props.reservations).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'res:r-kona', cancelled: true, googleEventId: 'g-kona' }),
  ]));
});

it('erro ao cancelar mantém o cão visível e avisa o gestor', async () => {
  mockEq.mockResolvedValue({ error: { message: 'permission denied' } });
  const tela = await render(<CalendarScreen />);
  await waitFor(() => expect(tela.getByLabelText('Options Kona')).toBeTruthy());
  await remove(tela);
  expect(tela.getByLabelText('Options Kona')).toBeTruthy();
  expect(mockAlert).toHaveBeenLastCalledWith('Unable to cancel', 'permission denied');
});
