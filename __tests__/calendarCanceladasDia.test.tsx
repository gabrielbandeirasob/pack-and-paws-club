import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { buildDay, type ReservationRecord } from '@/features/calendar/dayMath';
import { colors } from '@/features/theme/tokens';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/features/calendar/dates', () => ({
  ...jest.requireActual('@/features/calendar/dates'), todayLocalISO: () => '2026-10-14',
}));
jest.mock('@/features/auth/useOrganizationRole', () => ({
  useOrganizationRole: () => ({ role: 'manager', view: 'manager', isLoading: false }),
}));
jest.mock('@/features/integrations/google/CalendarConnectionCard', () => ({ CalendarConnectionCard: () => null }));
const mockAlert = jest.fn();
jest.mock('@/features/ui/alert', () => ({ showAlert: (...args: unknown[]) => mockAlert(...args) }));
const mockRows: Record<string, unknown[]> = {};
jest.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'manager' } } }) },
  from: (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'limit', 'gte', 'lte']) chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
      error: null, data: table === 'organization_members' ? [{ organization_id: 'org' }] : mockRows[table] ?? [],
    }).then(resolve);
    return chain;
  },
} }));
import CalendarScreen from '@/app/(tabs)/calendar';

const date = '2026-10-14';
const dog = (name: string) => ({ id: name, name, client: { name: 'Owner' } });
const reservation = (name: string, status = 'confirmed', service_type = 'daycare') => ({
  id: name, dog: dog(name), status, service_type, start_date: date, end_date: date, transport_required: true,
});
beforeEach(() => {
  for (const key of Object.keys(mockRows)) delete mockRows[key];
  mockAlert.mockClear();
  mockRows.reservations = [reservation('Active')];
});
async function loaded() {
  const screen = await render(<CalendarScreen />);
  await waitFor(() => expect(screen.getByLabelText('Options Active')).toBeTruthy());
  return screen;
}

it('calendar: one cancelled dog is struck through, muted and shows the Google reason', async () => {
  mockRows.reservations.push(reservation('Pipoca', 'cancelled'));
  const screen = await loaded();
  const section = within(screen.getByTestId('calendar-cancelled'));
  expect(section.getByText('Cancelled')).toBeTruthy();
  expect(section.getByText('1 cancelled')).toBeTruthy();
  expect(StyleSheet.flatten(section.getByText('Pipoca').props.style)).toMatchObject({
    textDecorationLine: 'line-through', color: colors.muted,
  });
  expect(section.getByText('Cancelled in Google Calendar')).toBeTruthy();
});

it('calendar: without cancellations there is no extra section or row', async () => {
  const screen = await loaded();
  expect(screen.queryByTestId('calendar-cancelled')).toBeNull();
  expect(screen.queryByText('Cancelled')).toBeNull();
  expect(screen.queryByText(/cancelled/i)).toBeNull();
  expect(screen.getByLabelText('Options Active')).toBeTruthy();
});

it('calendar: cancelled daycare and boarding add zero to the day counts', async () => {
  mockRows.reservations.push(reservation('Pipoca', 'cancelled'), reservation('Hotel', 'cancelled', 'boarding'));
  const screen = await loaded();
  expect(screen.getByText('2 cancelled')).toBeTruthy();
  // Check the rendered counters beside both service headings.
  expect(within(screen.getByText('Daycare').parent!).getByText('1')).toBeTruthy();
  expect(within(screen.getByText('Boarding').parent!).getByText('0')).toBeTruthy();
  const rows = (mockRows.reservations as ReturnType<typeof reservation>[]).map(row => ({
    id: row.id, dog: { id: row.dog.id, dogName: row.dog.name, clientName: 'Owner' },
    status: row.status, serviceType: row.service_type, startDate: date, endDate: date, transportRequired: true,
  })) as ReservationRecord[];
  const day = buildDay(date, rows, [], []);
  expect(day.daycare.length + day.boarding.length).toBe(1);
  expect(day).toEqual(buildDay(date, rows.filter(row => row.status === 'confirmed'), [], []));
});

it('calendar: Google skips and app skips retain their distinct reasons', async () => {
  mockRows.recurring_schedules = ['Google', 'App'].map(name => ({
    id: name, dog: dog(name), weekdays: [3], start_date: date, end_date: null, active: true, transport_required: true,
  }));
  mockRows.recurring_exceptions = ['Google', 'App'].map(name => ({
    id: name, recurring_schedule_id: name, action: 'skip', start_date: date, end_date: date,
    reason: name === 'Google' ? 'Cancelled in Google Calendar' : 'Skipped on this date',
  }));
  const screen = await loaded();
  expect(within(screen.getByLabelText('Google — cancelled in Google Calendar')).getByText('Cancelled in Google Calendar')).toBeTruthy();
  expect(within(screen.getByLabelText('App — cancelled — skipped on this date')).getByText('Skipped on this date')).toBeTruthy();
  expect(screen.getByText('2 cancelled')).toBeTruthy();
  expect(within(screen.getByText('Daycare').parent!).getByText('1')).toBeTruthy();
});

it('calendar: cancellation row announces cancelled and has no reservation actions', async () => {
  mockRows.reservations.push(reservation('Pipoca', 'cancelled'));
  const screen = await loaded();
  const row = screen.getByLabelText('Pipoca — cancelled in Google Calendar');
  expect(row.props.accessible).toBe(true);
  expect(within(row).queryAllByRole('button')).toHaveLength(0);
  expect(screen.queryByLabelText('Options Pipoca')).toBeNull();
  await fireEvent.press(row);
  expect(mockAlert).not.toHaveBeenCalled();
});

it('calendar: the new cancellation section is absent from week view', async () => {
  mockRows.reservations.push(reservation('Pipoca', 'cancelled'));
  const screen = await loaded();
  await fireEvent.press(screen.getByLabelText('Week view'));
  expect(screen.queryByTestId('calendar-cancelled')).toBeNull();
});
