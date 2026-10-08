import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import CalendarScreen from '@/app/(tabs)/calendar';
import { addDaysISO, todayLocalISO } from '@/features/calendar/dates';
import { readEventColor } from '@/features/calendar/googleColors';
import { esquecerSincronizacao } from '@/features/integrations/google/lastSyncStore';
import { runCalendarImport, type ImportReviewItem } from '@/features/integrations/google/importService';

jest.mock('@/features/calendar/dates', () => ({
  ...jest.requireActual('@/features/calendar/dates'), todayLocalISO: () => '2026-10-07',
}));
jest.mock('@/features/auth/useRoleGuard', () => ({ useRoleGuard: () => ({ role: 'manager', liberado: true, isLoading: false }) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/features/integrations/google/useCalendarConnection', () => {
  const connection = {
    status: 'connected', email: 'office@example.com',
    getAccessToken: async () => 'fake-token', rememberEmail: jest.fn(),
  };
  return { useCalendarConnection: () => connection };
});
jest.mock('@/features/integrations/google/serverCredential', () => ({
  servidorTemCredencial: async () => true,
}));
jest.mock('@/features/integrations/google/calendarApi', () => ({
  listCalendars: async () => [], getCalendarLabels: async () => [],
  calendarIdDaOrigem: async () => 'primary',
}));
jest.mock('@/features/integrations/google/importService', () => ({ runCalendarImport: jest.fn() }));
jest.mock('@/features/integrations/google/importSnapshot', () => ({
  carregarSnapshotDaImportacao: async () => [],
}));
const mockInsert = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'manager' } } }) },
    from: (table: string) => {
      let inserted = false;
      const data = table === 'organization_members' ? [{ organization_id: 'org-1' }]
        : table === 'dogs' ? [{ id: 'luna', name: 'Luna', client: { id: 'maria', name: 'Maria' } }] : [];
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'limit']) chain[method] = () => chain;
      chain.insert = (values: unknown) => { inserted = true; mockInsert(table, values); return chain; };
      chain.maybeSingle = async () => ({ data: null, error: null });
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: inserted ? [{ id: 'new' }] : data, error: null }).then(resolve);
      return chain;
    },
  },
}));

const today = todayLocalISO();
function item(title: string, reason: ImportReviewItem['reason'], date = today): ImportReviewItem {
  return {
    eventId: title, title, reason, date,
    parsed: { color: readEventColor({ colorId: '2' }), goesToDaycare: true, serviceType: reason === 'unrecognized color' ? null : 'boarding', cancels: false,
      dogName: title, startDate: date, endDate: date, weekdays: [], skipDates: [], openEnded: false },
  };
}
const initialItems = [item('Rex', 'unknown dog'), item('Blue', 'unrecognized color'), item('Twin', 'duplicate'),
  item('Tomorrow', 'unknown dog', addDaysISO(today, 1))];

beforeEach(async () => {
  jest.clearAllMocks();
  await esquecerSincronizacao();
  (runCalendarImport as jest.Mock).mockResolvedValue({ created: 0, updated: 0, cancelled: 0, failures: [], review: initialItems });
});

async function openCalendar() {
  const screen = await render(<CalendarScreen />);
  await waitFor(() => expect(runCalendarImport).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByTestId('google-review-toggle')).toBeTruthy());
  return screen;
}

it('conta cada categoria somente no dia selecionado e inicia recolhida com alvo de 44 pontos', async () => {
  (runCalendarImport as jest.Mock).mockResolvedValue({ created: 0, updated: 0, cancelled: 0, failures: [], review: [
    ...initialItems, item('Purple', 'purple without schedule'), item('Other Rex', 'ambiguous dog'), item('', 'unreadable'),
  ] });
  const screen = await openCalendar();
  const toggle = screen.getByRole('button', { name: 'Google: 3 not registered · 1 unrecognized color · 1 duplicate · 1 changed day without schedule, collapsed' });
  expect(toggle.props.accessibilityState).toEqual({ expanded: false });
  expect(toggle).toHaveStyle({ minHeight: 44 });
  expect(screen.queryByTestId('google-review-list')).toBeNull();
});

it('não apresenta faixa quando não há avisos', async () => {
  (runCalendarImport as jest.Mock).mockResolvedValue({ created: 0, updated: 0, cancelled: 0, failures: [], review: [] });
  const screen = await render(<CalendarScreen />);
  await waitFor(() => expect(screen.getByTestId('google-calendar-resumo')).toBeTruthy());
  expect(screen.queryByTestId('google-review-panel')).toBeNull();
});

it('abre os mesmos textos e itens do dia, e um segundo toque recolhe', async () => {
  const screen = await openCalendar();
  await fireEvent.press(screen.getByTestId('google-review-toggle'));
  expect(screen.getByTestId('google-review-toggle').props.accessibilityState).toEqual({ expanded: true });
  expect(screen.getByLabelText(/Google:.*expanded$/)).toBeTruthy();
  const list = within(screen.getByTestId('google-review-list'));
  expect(list.getByText('From Google — not registered in the app')).toBeTruthy();
  expect(list.getByText('From Google — color not recognized')).toBeTruthy();
  expect(list.getByText(/No dog with this name in the app — register the dog and sync again/)).toBeTruthy();
  expect(list.getByText(/A booking like this already exists in the app/)).toBeTruthy();
  expect(list.getByText(/No service in this color — green is boarding, blue or gray is daycare, purple is a changed day/)).toBeTruthy();
  expect(list.queryByText('Tomorrow')).toBeNull();
  await fireEvent.press(screen.getByTestId('google-review-toggle'));
  expect(screen.queryByTestId('google-review-list')).toBeNull();
});

it('regressão: nenhum bloco de revisão fica dentro da lista do dia, mesmo com painel aberto', async () => {
  const screen = await openCalendar();
  await fireEvent.press(screen.getByTestId('google-review-toggle'));
  const day = within(screen.getByTestId('calendar-day-list'));
  expect(day.queryByText(/From Google/)).toBeNull();
  expect(day.queryByLabelText(/Choose dog for/)).toBeNull();
  expect(day.queryByTestId('google-review-panel')).toBeNull();
  expect(day.getByTestId('google-calendar-card')).toBeTruthy();
  expect(within(screen.getByTestId('google-review-panel')).getByText('Rex')).toBeTruthy();
});

it('setas trocam de três avisos para um e depois nenhum', async () => {
  const screen = await openCalendar();
  expect(screen.getByText('Google: 1 not registered · 1 unrecognized color · 1 duplicate')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Next'));
  expect(screen.getByText('Google: 1 not registered')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('google-review-toggle'));
  expect(screen.getByText('Tomorrow')).toBeTruthy();
  expect(screen.queryByText('Rex')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Next'));
  expect(screen.queryByTestId('google-review-panel')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Previous'));
  expect(screen.getByText('Google: 1 not registered')).toBeTruthy();
  expect(screen.queryByTestId('google-review-list')).toBeNull();
});

it.each(['Week', 'Month'])('%s mantém a faixa e selecionar outra célula troca os avisos', async (mode) => {
  const screen = await openCalendar();
  await fireEvent.press(screen.getByText(mode));
  expect(screen.getByText('Google: 1 not registered · 1 unrecognized color · 1 duplicate')).toBeTruthy();
  // Avança o intervalo para provar que as setas em Week/Month também alteram o dia selecionado.
  await fireEvent.press(screen.getByLabelText('Next'));
  expect(screen.queryByTestId('google-review-panel')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Previous'));
  await fireEvent.press(screen.getByLabelText(`Select ${today} · no care`));
  expect(screen.getByText('Google: 1 not registered · 1 unrecognized color · 1 duplicate')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText(`Select ${addDaysISO(today, 1)} · no care`));
  expect(screen.getByText('Google: 1 not registered')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('google-review-toggle'));
  expect(screen.getByText('Tomorrow')).toBeTruthy();
  expect(screen.queryByText('Rex')).toBeNull();
  await fireEvent.press(screen.getByLabelText(`Select ${addDaysISO(today, 2)} · no care`));
  expect(screen.queryByTestId('google-review-panel')).toBeNull();
});

it('Choose dog no rodapé abre a mesma pesquisa e salva pelo fluxo existente', async () => {
  const screen = await openCalendar();
  await fireEvent.press(screen.getByTestId('google-review-toggle'));
  await fireEvent.press(within(screen.getByTestId('google-review-panel')).getByLabelText('Choose dog for Rex'));
  expect(screen.getByText('Which dog is this?')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Select dog'));
  await fireEvent.changeText(screen.getByLabelText('Search dog or client'), 'Luna');
  await fireEvent.press(screen.getByLabelText('Select Luna of Maria'));
  await fireEvent.press(screen.getByLabelText('Save from Google'));
  await waitFor(() => expect(mockInsert).toHaveBeenCalledWith('reservations', expect.objectContaining({
    dog_id: 'luna', google_event_id: 'Rex', source: 'google',
  })));
  await waitFor(() => expect(screen.getByText('Google: 1 unrecognized color · 1 duplicate')).toBeTruthy());
});
